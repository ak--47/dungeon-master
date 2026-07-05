//@ts-nocheck
/**
 * P1.3 unit tests: evaluateFormula.
 *
 * Every expected value below is hand-computed from the Mixpanel formula
 * rules in `api/version_2_0/formulas/util.py` — NOT derived from running
 * the implementation:
 *   - broadcast + key-union with missing→0: operate(), util.py:25-47
 *   - division by zero → 0: util.py:81-86
 *   - missing series → all zeros: util.py:65-66 (VAR .get(arg, 0)),
 *     util.py:17-22 (zero fillers at the callsite)
 *   - unary minus = mul by -1: util.py:90-91
 *   - grammar (PEMDAS, `^` pow left-assoc, atom rhs): formulas/grammar.lark
 */

import { describe, test, expect } from 'vitest';
import { evaluateFormula } from '../../lib/verify/formula.js';

describe('evaluateFormula — scalars', () => {
	test('basic ratio: (A/B)*100', () => {
		// hand-computed: (25/50)*100 = 50
		expect(evaluateFormula('(A/B)*100', { A: 25, B: 50 })).toBe(50);
	});

	test('PEMDAS: 2+3*4 = 14, (2+3)*4 = 20', () => {
		expect(evaluateFormula('2+3*4', {})).toBe(14);
		expect(evaluateFormula('(2+3)*4', {})).toBe(20);
	});

	test('division by zero returns 0 (util.py:81-86)', () => {
		expect(evaluateFormula('A/B', { A: 5, B: 0 })).toBe(0);
		// even mid-expression: 10 + 5/0 = 10 + 0
		expect(evaluateFormula('10 + A/B', { A: 5, B: 0 })).toBe(10);
	});

	test('pow: `^` is LEFT-associative with atom rhs (grammar.lark ?factor)', () => {
		expect(evaluateFormula('A^2', { A: 3 })).toBe(9);
		// hand-computed: (2^3)^2 = 64 — NOT Python's right-assoc 2^(3^2)=512
		expect(evaluateFormula('2^3^2', {})).toBe(64);
	});

	test('`**` accepted as alias for `^`', () => {
		expect(evaluateFormula('A**2', { A: 3 })).toBe(9);
	});

	test('unary minus wraps the factor: -2^2 = -4 (grammar: "-" factor -> neg)', () => {
		expect(evaluateFormula('-2^2', {})).toBe(-4);
		expect(evaluateFormula('-A', { A: 7 })).toBe(-7);
		expect(evaluateFormula('(-2)^2', {})).toBe(4);
	});

	test('number literals: underscores stripped, scientific notation', () => {
		// util.py:59-63 strips underscores; grammar NUMBER regex allows 1e3
		expect(evaluateFormula('1_000 + A', { A: 0 })).toBe(1000);
		expect(evaluateFormula('1e3 * 2', {})).toBe(2000);
		expect(evaluateFormula('.5 * 4', {})).toBe(2);
	});

	test('missing series evaluates as 0 (util.py:65-66, :17-22)', () => {
		expect(evaluateFormula('A + B', { A: 5 })).toBe(5);
		expect(evaluateFormula('A * B', { A: 5 })).toBe(0);
	});
});

describe('evaluateFormula — dict broadcasting (operate, util.py:25-47)', () => {
	test('scalar ⊕ dict broadcasts onto the dict keys', () => {
		// hand-computed: each value doubled
		expect(evaluateFormula('A*2', { A: { x: 1, y: 3 } })).toEqual({ x: 2, y: 6 });
		// scalar on the left too
		expect(evaluateFormula('100*A', { A: { x: 0.5 } })).toEqual({ x: 50 });
	});

	test('dict ⊕ dict takes the UNION of keys; missing side treated as 0 (util.py:38-45)', () => {
		const series = { A: { x: 10, y: 5 }, B: { x: 3, z: 2 } };
		// hand-computed: x: 10-3=7; y: 5-0=5; z: 0-2=-2
		expect(evaluateFormula('A-B', series)).toEqual({ x: 7, y: 5, z: -2 });
	});

	test('per-key division by zero → 0 for that key only', () => {
		const series = { A: { x: 10, y: 10 }, B: { x: 2, y: 0 } };
		// hand-computed: x: 10/2=5; y: 10/0 → 0
		expect(evaluateFormula('A/B', series)).toEqual({ x: 5, y: 0 });
	});

	test('missing series against a dict → all-zero dict of the other side\'s keys', () => {
		// B absent → scalar 0 broadcasts onto A's keys
		expect(evaluateFormula('A+B', { A: { x: 1, y: 2 } })).toEqual({ x: 1, y: 2 });
		expect(evaluateFormula('A*B', { A: { x: 1, y: 2 } })).toEqual({ x: 0, y: 0 });
	});

	test('unary minus broadcasts over dicts (neg = mul by -1, util.py:90-91)', () => {
		expect(evaluateFormula('-A', { A: { x: 1, y: -2 } })).toEqual({ x: -1, y: 2 });
	});

	test('left-operand zero-pad persists across reuse within a formula (util.py:39-41 in-place mutation)', () => {
		// util.py operate() writes the zero-pad INTO val1, so a series dict
		// reused later in the same formula carries the grown key set.
		// Numerically visible via pow(0,0) = 1.
		const series = { A: { x: 2 }, B: { y: 3 }, C: { x: 1 } };
		// hand-computed, evaluation order (A*B) then (A^C) then +:
		//   A*B pads A in place → A = {x:2, y:0}; result {x: 2*0=0, y: 0*3=0}
		//   A^C on the PADDED A → {x: 2^1=2, y: 0^0=1}   (pow(0,0) = 1)
		//   sum → {x: 0+2=2, y: 0+1=1}
		// (without the in-place pad, y would be 0)
		expect(evaluateFormula('A*B + A^C', series)).toEqual({ x: 2, y: 1 });
		// the pad is confined to the evaluation — caller's series untouched
		// (Python leaks it to the shared per-request values dict,
		// api.py:2890-2893; we clone on entry instead)
		expect(series.A).toEqual({ x: 2 });
		expect(series.B).toEqual({ y: 3 });
	});

	test('conversion-rate shape: (A/B)*100 over period dicts', () => {
		const series = {
			A: { '2024-01-15': 25, '2024-01-16': 30 },
			B: { '2024-01-15': 100, '2024-01-16': 60 },
		};
		// hand-computed: 25/100*100=25; 30/60*100=50
		expect(evaluateFormula('(A/B)*100', series)).toEqual({ '2024-01-15': 25, '2024-01-16': 50 });
	});
});

describe('evaluateFormula — errors', () => {
	test('incomplete formula throws', () => {
		expect(() => evaluateFormula('A +', { A: 1 })).toThrow(/incomplete/i);
	});

	test('unexpected character throws', () => {
		expect(() => evaluateFormula('A $ B', { A: 1, B: 2 })).toThrow(/unexpected character/i);
	});

	test('unbalanced parens throw', () => {
		expect(() => evaluateFormula('(A + B', { A: 1, B: 2 })).toThrow();
		expect(() => evaluateFormula('A + B)', { A: 1, B: 2 })).toThrow(/unexpected token/i);
	});

	test('empty expr and bad series argument throw', () => {
		expect(() => evaluateFormula('', {})).toThrow();
		expect(() => evaluateFormula('A', null)).toThrow();
		expect(() => evaluateFormula('A', [1, 2])).toThrow();
	});
});

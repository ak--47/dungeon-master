/**
 * Insights formula evaluation.
 *
 * Mixpanel evaluates formulas in the Python API layer, not the ARB engine
 * (`api/version_2_0/formulas/util.py`, called from `insights/api.py`).
 * This module reimplements that layer's exact semantics:
 *
 *   - `operate()` (util.py:25-47): if both operands are scalars, apply the
 *     op directly. Otherwise cast both to dicts — a scalar broadcasts onto
 *     the other operand's keys — and the result carries the UNION of keys;
 *     a key missing from either side is treated as 0 (util.py:38-45).
 *     Crucially the zero-pad MUTATES the left operand in place
 *     (util.py:39-41 `val1[key] = 0`), so a series dict referenced again
 *     later in the same formula carries the grown key set into that reuse
 *     — visible in output shape (extra zero-valued keys) and numerically
 *     via `^` (pow(0,0) = 1): e.g. in `A*B + A^C`, keys B added to A by
 *     the first term evaluate `0^C.get(k,0)` in the second. We replicate
 *     this within one evaluateFormula() call by cloning each series dict
 *     on entry and letting operate() pad the clones in place.
 *     NOT emulated: Python additionally shares ONE values dict across all
 *     formulas of an Insights request (insights/api.py:2890-2893
 *     `reference_metric_values`), so the pad leaks across formulas and
 *     makes later formulas' key shapes depend on formula ORDER. That
 *     cross-formula leak is an implementation artifact (order-dependent,
 *     zero-valued keys only, pow(0,0) aside) — callers here evaluate one
 *     formula per call with independent series.
 *   - Division by zero returns 0, not NaN/Infinity (util.py:81-86).
 *   - A referenced series absent from `series` evaluates as all-zeros —
 *     the `VAR` transformer defaults with `.get(arg, 0)` (util.py:65-66)
 *     and the API callsite pre-fills missing labels with 0
 *     (util.py:17-22 `get_formula_labels_filler_values` / `ZERO_FILLED_VALUES`).
 *   - Unary minus is `operate(x, -1, mul)` (util.py:90-91) — broadcasts
 *     over dicts.
 *
 * Grammar (formulas/grammar.lark — PEMDAS via LALR):
 *
 *     expr:   term   | expr "+" term | expr "-" term
 *     term:   factor | term "*" factor | term "/" factor
 *     factor: atom   | "-" factor | factor "^" atom
 *     atom:   NUMBER | VAR | "(" expr ")"
 *
 *   - Power is `^`, LEFT-associative (`2^3^2` = 64, unlike Python's `**`),
 *     and its right side is an atom — `2^-3` is a parse error upstream too.
 *   - Unary minus wraps the whole factor: `-2^2` = -(2^2) = -4.
 *   - NUMBER allows readability underscores and scientific notation
 *     (util.py:59-63 strips underscores; grammar.lark NUMBER regex).
 *   - VAR is a C-style name (common.CNAME), not just single letters.
 *   - `**` is accepted here as an alias for `^` (JS convention; the ARB
 *     grammar itself only defines `^`).
 *
 * Recursive-descent parser, no dependency.
 */

/**
 * @typedef {number | Object<string, number>} FormulaValue
 */

/**
 * Evaluate an Insights-style formula over named series.
 *
 * @param {string} expr - e.g. `'(A/B)*100'`
 * @param {Object<string, FormulaValue>} series - values keyed by series
 *   label; each value is a scalar or a dict keyed by segment/period.
 * @returns {FormulaValue}
 */
export function evaluateFormula(expr, series) {
	if (typeof expr !== 'string' || !expr.trim()) {
		throw new Error('evaluateFormula: expr must be a non-empty string');
	}
	if (series == null || typeof series !== 'object' || Array.isArray(series)) {
		throw new Error('evaluateFormula: series must be an object of named values');
	}
	// Clone each series dict: operate() zero-pads its left operand IN PLACE
	// (util.py:39-41), and a var reused within the formula must see the pad
	// — but the caller's series must not (Python leaks the pad to the shared
	// per-request values dict, api.py:2890-2893; we confine it per call).
	const vars = {};
	for (const key of Object.keys(series)) {
		const v = series[key];
		vars[key] = isDict(v) ? { ...v } : v;
	}
	const tokens = tokenize(expr);
	const parser = new Parser(tokens, vars);
	const result = parser.parseExpr();
	if (parser.peek() !== undefined) {
		throw new Error(`evaluateFormula: unexpected token "${parser.peek().text}"`);
	}
	return result;
}

// ── operate(): the util.py:25-47 broadcast/union rule ──

function operate(val1, val2, op) {
	const d1 = isDict(val1);
	const d2 = isDict(val2);
	if (!d1 && !d2) return op(val1, val2);

	// At least one is a dict — a scalar broadcasts onto the other's keys.
	const a = d1 ? val1 : broadcast(val1, /** @type {Object} */ (val2));
	const b = d2 ? val2 : broadcast(val2, /** @type {Object} */ (val1));

	// Union of keys; missing side treated as 0. The pad writes INTO the left
	// operand (util.py:39-41 `val1[key] = 0`) so a series dict reused later
	// in the same formula sees the grown key set — numerically visible via
	// pow(0,0) = 1. evaluateFormula clones series dicts on entry, so the
	// mutation is confined to this evaluation.
	for (const key of Object.keys(b)) {
		if (!(key in a)) a[key] = 0;
	}
	const result = {};
	for (const key of Object.keys(a)) {
		result[key] = op(a[key], key in b ? b[key] : 0);
	}
	return result;
}

/**
 * @param {*} v
 * @returns {v is Object<string, number>}
 */
function isDict(v) {
	return v !== null && typeof v === 'object';
}

function broadcast(scalar, dict) {
	const out = {};
	for (const key of Object.keys(dict)) out[key] = scalar;
	return out;
}

// ── Scalar ops (util.py FormulaTransformer) ──

const OPS = {
	add: (a, b) => a + b,
	sub: (a, b) => a - b,
	mul: (a, b) => a * b,
	pow: (a, b) => Math.pow(a, b),
	// Graceful divide-by-zero → 0 (util.py:81-86).
	div: (a, b) => (b === 0 ? 0 : a / b),
};

// ── Tokenizer ──

const NUMBER_RE = /^(?:[0-9](?:_?[0-9])*(?:\.[0-9](?:_?[0-9])*)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?/;
const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(expr) {
	const tokens = [];
	let s = expr;
	while (s.length) {
		const ws = s.match(/^\s+/);
		if (ws) { s = s.slice(ws[0].length); continue; }
		const num = s.match(NUMBER_RE);
		if (num) {
			// util.py:59-63 — strip readability underscores before parsing.
			tokens.push({ type: 'number', text: num[0], value: Number(num[0].replace(/_/g, '')) });
			s = s.slice(num[0].length);
			continue;
		}
		const v = s.match(VAR_RE);
		if (v) {
			tokens.push({ type: 'var', text: v[0] });
			s = s.slice(v[0].length);
			continue;
		}
		if (s.startsWith('**')) { // alias for the grammar's `^`
			tokens.push({ type: 'op', text: '^' });
			s = s.slice(2);
			continue;
		}
		const ch = s[0];
		if ('+-*/^()'.includes(ch)) {
			tokens.push({ type: ch === '(' || ch === ')' ? 'paren' : 'op', text: ch });
			s = s.slice(1);
			continue;
		}
		throw new Error(`evaluateFormula: unexpected character "${ch}"`);
	}
	return tokens;
}

// ── Recursive-descent parser mirroring grammar.lark ──

class Parser {
	constructor(tokens, series) {
		this.tokens = tokens;
		this.pos = 0;
		this.series = series;
	}

	peek() { return this.tokens[this.pos]; }

	next() {
		const t = this.tokens[this.pos++];
		if (!t) throw new Error('evaluateFormula: incomplete formula');
		return t;
	}

	// expr: term | expr ("+"|"-") term
	parseExpr() {
		let left = this.parseTerm();
		while (this.peek() && this.peek().type === 'op' && (this.peek().text === '+' || this.peek().text === '-')) {
			const op = this.next().text;
			const right = this.parseTerm();
			left = operate(left, right, op === '+' ? OPS.add : OPS.sub);
		}
		return left;
	}

	// term: factor | term ("*"|"/") factor
	parseTerm() {
		let left = this.parseFactor();
		while (this.peek() && this.peek().type === 'op' && (this.peek().text === '*' || this.peek().text === '/')) {
			const op = this.next().text;
			const right = this.parseFactor();
			left = operate(left, right, op === '*' ? OPS.mul : OPS.div);
		}
		return left;
	}

	// factor: atom | "-" factor | factor "^" atom
	// Unary minus wraps the whole factor (-2^2 = -4); pow is left-assoc
	// with an ATOM right side (grammar.lark ?factor).
	parseFactor() {
		if (this.peek() && this.peek().type === 'op' && this.peek().text === '-') {
			this.next();
			// neg = operate(x, -1, mul) — util.py:90-91.
			return operate(this.parseFactor(), -1, OPS.mul);
		}
		let left = this.parseAtom();
		while (this.peek() && this.peek().type === 'op' && this.peek().text === '^') {
			this.next();
			const right = this.parseAtom();
			left = operate(left, right, OPS.pow);
		}
		return left;
	}

	// atom: NUMBER | VAR | "(" expr ")"
	parseAtom() {
		const t = this.next();
		if (t.type === 'number') return t.value;
		if (t.type === 'var') {
			// Missing series → 0 (util.py:65-66 VAR .get(arg, 0); callsite
			// zero-fillers util.py:17-22).
			const v = this.series[t.text];
			return v === undefined ? 0 : v;
		}
		if (t.type === 'paren' && t.text === '(') {
			const inner = this.parseExpr();
			const close = this.next();
			if (close.type !== 'paren' || close.text !== ')') {
				throw new Error(`evaluateFormula: expected ")" but found "${close.text}"`);
			}
			return inner;
		}
		throw new Error(`evaluateFormula: unexpected token "${t.text}"`);
	}
}

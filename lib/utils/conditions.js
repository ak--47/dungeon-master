/**
 * Funnel `conditions` matching (v1.7.0 — P0-1).
 *
 * A funnel with `conditions` is offered only to users whose profile satisfies
 * every key (AND across keys). Each value is either:
 *
 *   - a scalar → strict equality (`profile[key] === value`), unchanged since 1.3
 *   - an operator map → every operator in the map must hold (AND within a key)
 *
 * Operators: `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`.
 * `in` / `nin` take arrays; the rest take scalars. `gt`/`gte`/`lt`/`lte` use
 * JavaScript's `<` / `>` so numbers and ISO date strings both compare.
 *
 * A missing profile key never satisfies `eq`, `in`, or an ordering operator;
 * it does satisfy `neq` and `nin` (the value is not the excluded one).
 *
 * The validator (`validateFunnelConditions`) rejects functions, bare arrays,
 * unknown operators, and `in`/`nin` without an array — those shapes used to
 * silently never match and hand the author an empty funnel.
 */

export const CONDITION_OPERATORS = Object.freeze(['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte']);
const OPERATOR_SET = new Set(CONDITION_OPERATORS);

/**
 * True when `value` is an operator map (plain object, not array/Date).
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isOperatorMap(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Record<string, unknown>} conditions
 * @returns {boolean}
 */
export function matchConditions(profile, conditions) {
	if (!conditions) return true;
	for (const [key, cond] of Object.entries(conditions)) {
		const actual = profile ? profile[key] : undefined;
		if (!isOperatorMap(cond)) {
			if (actual !== cond) return false;
			continue;
		}
		for (const [op, expected] of Object.entries(cond)) {
			if (!OPERATOR_SET.has(op)) return false; // validator throws earlier; defensive
			switch (op) {
				case 'eq': if (actual !== expected) return false; break;
				case 'neq': if (actual === expected) return false; break;
				case 'in': if (!Array.isArray(expected) || !expected.includes(actual)) return false; break;
				case 'nin': if (Array.isArray(expected) && expected.includes(actual)) return false; break;
				case 'gt': if (!(/** @type {any} */ (actual) > /** @type {any} */ (expected))) return false; break;
				case 'gte': if (!(/** @type {any} */ (actual) >= /** @type {any} */ (expected))) return false; break;
				case 'lt': if (!(/** @type {any} */ (actual) < /** @type {any} */ (expected))) return false; break;
				case 'lte': if (!(/** @type {any} */ (actual) <= /** @type {any} */ (expected))) return false; break;
			}
		}
	}
	return true;
}

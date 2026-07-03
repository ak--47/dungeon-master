/**
 * Shared value-coercion + filter-comparison helpers matching Mixpanel's ARB
 * engine semantics. Two DIFFERENT rulebooks live here — do not mix them up:
 *
 * 1. SEGMENT IDENTITY (breakdown bucketing) is case-SENSITIVE and type-tagged.
 *    ARB hashes the raw typed value: strings hash their raw bytes with no case
 *    folding (hash_value.c:114-115 → hash_string_value_with_seed, raw XXH3
 *    over strlen bytes), and segment ordering uses arb_strcmp (cmp.c:24-32).
 *    Each value type mixes a distinct tag into the hash (number_tag,
 *    string_tag, true/false_tag — hash_value.c:92-97), so the number 1 and
 *    the string "1" are DIFFERENT segments even though both display as "1".
 *
 * 2. WHERE-FILTER string comparison is case-INSENSITIVE. value_equal uses
 *    arb_strcasecmp (value.c:285), `contains` uses arb_strcaseinstr
 *    (eval_node.c:2914), and string relational operators use arb_strcasecmp
 *    (eval_node.c:2931). The filter helpers below implement that rulebook and
 *    must NEVER be used to bucket breakdown segments.
 */

/**
 * Coerce a property value to its Mixpanel display/bucket label.
 *
 * - `null` and `undefined` both become the literal string "undefined" — the
 *   string-typecast default (`string(prop, "undefined")`) that produces the
 *   "undefined" segment in every Insights breakdown (arb_selector.py:889-916).
 * - Booleans → "true"/"false"; numbers → decimal string with -0 normalized to
 *   0 (hash_value.c:111 `v.d = v.d == -0.0 ? 0.0 : v.d`).
 * - Strings pass through UNCHANGED — case-preserving (rulebook 1 above).
 * - Objects JSON-stringify (rare; ARB hashes structurally — hash_object).
 * - Lists are NOT handled here: callers fan out per item (ACTION_TYPE_FOR_EACH,
 *   normal_query.cpp:1718-1776) before coercing each item.
 *
 * @param {*} value
 * @returns {string}
 */
export function coerceToBreakdownKey(value) {
	if (value === null || value === undefined) return 'undefined';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return String(Object.is(value, -0) ? 0 : value);
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

/**
 * Internal segment-identity key: type-tagged so number 1 ≠ string "1"
 * (hash_value.c type tag mixins). Case-preserving for strings.
 *
 * @param {*} value
 * @returns {string}
 */
export function breakdownSegmentKey(value) {
	if (value === null || value === undefined) return 'u:';
	if (typeof value === 'boolean') return `b:${value}`;
	if (typeof value === 'number') return `n:${Object.is(value, -0) ? 0 : value}`;
	if (typeof value === 'string') return `s:${value}`;
	return `o:${JSON.stringify(value)}`;
}

/**
 * WHERE-filter equality. Strings compare case-insensitively
 * (value.c:285 — value_equal → arb_strcasecmp). null == null and
 * undefined == undefined are each equal (value.c VALUE_TYPE_UNDEFINED/NULL
 * cases return equal=true) but null != undefined (type mismatch short-circuits
 * before the switch). Cross-type comparisons are never equal.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function filterEquals(a, b) {
	if (typeof a === 'string' && typeof b === 'string') {
		return a.toLowerCase() === b.toLowerCase();
	}
	if (a === null || a === undefined || b === null || b === undefined) {
		return a === b || (a === null && b === null) || (a === undefined && b === undefined);
	}
	return a === b;
}

/**
 * WHERE-filter relational comparison for two strings, case-insensitive
 * (eval_node.c:2931 — string relational operators go through arb_strcasecmp).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative / 0 / positive like strcmp
 */
export function filterCompare(a, b) {
	const la = a.toLowerCase(), lb = b.toLowerCase();
	return la < lb ? -1 : la > lb ? 1 : 0;
}

/**
 * WHERE-filter substring test, case-insensitive
 * (eval_node.c:2914 — BINARY_OPERATOR_IN uses arb_strcaseinstr).
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
export function filterContains(haystack, needle) {
	return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Evaluate a `where` filter object against a flat record using the
 * WHERE-filter rulebook (case-insensitive strings). Shape mirrors funnel step
 * filters: `{ prop: value }` (equality) or `{ prop: { op, value } }` with
 * op ∈ eq | neq | gt | lt | gte | lte | contains | not_contains.
 *
 * Relational ops: numbers compare numerically, strings via filterCompare
 * (eval_node.c:2870-2906 numeric branch, :2931 string branch). Mixed-type or
 * null/undefined operands fail relational tests (value_cmp orders by type
 * first — cross-type never satisfies a within-type comparison here).
 *
 * @param {Object} record flat event/profile record
 * @param {Object<string, *>} [where]
 * @returns {boolean}
 */
export function matchesWhere(record, where) {
	if (!where) return true;
	for (const [prop, cond] of Object.entries(where)) {
		const actual = record[prop];
		const { op, value } = (cond && typeof cond === 'object' && !Array.isArray(cond) && 'op' in cond)
			? cond
			: { op: 'eq', value: cond };
		let pass;
		switch (op) {
			case 'eq': pass = filterEquals(actual, value); break;
			case 'neq': pass = !filterEquals(actual, value); break;
			case 'gt':
			case 'lt':
			case 'gte':
			case 'lte': {
				let cmp;
				if (typeof actual === 'number' && typeof value === 'number') cmp = actual - value;
				else if (typeof actual === 'string' && typeof value === 'string') cmp = filterCompare(actual, value);
				else { pass = false; break; }
				pass = op === 'gt' ? cmp > 0 : op === 'lt' ? cmp < 0 : op === 'gte' ? cmp >= 0 : cmp <= 0;
				break;
			}
			case 'contains':
				pass = typeof actual === 'string' && typeof value === 'string' && filterContains(actual, value);
				break;
			case 'not_contains':
				pass = !(typeof actual === 'string' && typeof value === 'string' && filterContains(actual, value));
				break;
			default:
				throw new Error(`matchesWhere: unknown op "${op}"`);
		}
		if (!pass) return false;
	}
	return true;
}

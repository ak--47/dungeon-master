// Minimal chance type declarations. Hand-rolled because @types/chance breaks
// the codebase (types default export as ChanceStatic, missing instance methods).
// Covers methods actually used in lib + dungeons. Add more as needed.
//
// Uses class declaration so `Chance` resolves as BOTH the constructor (value)
// and the instance type — matches existing JSDoc `@returns {Chance}` patterns.

declare module 'chance' {
	class Chance {
		constructor(seed?: string | number);

		// Numbers
		integer(opts?: { min?: number; max?: number }): number;
		floating(opts?: { min?: number; max?: number; fixed?: number }): number;
		normal(opts?: { mean?: number; dev?: number; pool?: any[] }): number;
		weighted<T>(values: T[], weights: number[]): T;

		// Booleans
		bool(opts?: { likelihood?: number }): boolean;

		// Strings
		string(opts?: { length?: number; pool?: string; alpha?: boolean; numeric?: boolean; symbols?: boolean; casing?: 'lower' | 'upper' }): string;
		character(opts?: { pool?: string; alpha?: boolean; numeric?: boolean; symbols?: boolean; casing?: 'lower' | 'upper' }): string;
		letter(opts?: { casing?: 'lower' | 'upper' }): string;
		word(opts?: { length?: number; syllables?: number; capitalize?: boolean }): string;
		sentence(opts?: { words?: number; punctuation?: boolean | string }): string;
		paragraph(opts?: { sentences?: number }): string;

		// Pickers (extra args tolerated for callers that pass user/context for tracing)
		pick<T>(arr: T[], count?: number, ...rest: any[]): T;
		pickone<T>(arr: T[], ...rest: any[]): T;
		pickset<T>(arr: T[], count: number, ...rest: any[]): T[];
		shuffle<T>(arr: T[]): T[];

		// Identifiers
		guid(opts?: { version?: number }): string;
		hash(opts?: { length?: number; casing?: 'lower' | 'upper' }): string;
		android_id(): string;

		// Dates — defaults to Date; pass `string: true` for string output (cast at call site)
		date(opts?: { year?: number; month?: number; day?: number; string?: boolean; american?: boolean; min?: Date | number; max?: Date | number }): Date;

		// Person
		name(opts?: { middle?: boolean; middle_initial?: boolean; prefix?: boolean; suffix?: boolean; nationality?: string; gender?: string }): string;
		first(opts?: { gender?: string; nationality?: string }): string;
		last(opts?: { gender?: string; nationality?: string }): string;
		profession(opts?: { rank?: boolean }): string;

		// Web
		email(opts?: { domain?: string; length?: number }): string;
		domain(opts?: { tld?: string }): string;
		url(opts?: { protocol?: string; domain?: string; domain_prefix?: string; path?: string; extensions?: string[] }): string;
		ip(): string;

		// Geo
		address(opts?: { short_suffix?: boolean }): string;
		city(): string;
		state(opts?: { full?: boolean; country?: string; territories?: boolean; armed_forces?: boolean }): string;
		country(opts?: { full?: boolean }): string;

		// Misc
		animal(opts?: { type?: string }): string;
		company(): string;
		industry(): string;
		phone(opts?: { country?: string; mobile?: boolean; formatted?: boolean }): string;
		cc(opts?: { type?: string }): string;
		d(sides: number): number;
		random(): number;

		// Allow any other method (escape hatch for uncovered methods)
		[key: string]: any;
	}

	export = Chance;
}

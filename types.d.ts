/**
 * Primitive scalar types that property values resolve to. Property values may
 * also be plain object literals (nested records) — `Record<string, any>` is the
 * narrowest TS can express here without making `Primitives` self-recursive
 * (which it can't be, because `ValueValid` is built on top of it).
 */
type Primitives = string | number | boolean | Date | Record<string, any>;

/**
 * A "validValue" can be a primitive, an array of valid values, or a thunk that
 * returns one. Configs use this everywhere properties are user-defined.
 */
export type ValueValid = Primitives | ValueValid[] | (() => ValueValid);

/**
 * main config object for the entire data generation
 */
export interface Dungeon {
    // ── Core Parameters ──
    /** Mixpanel project token. If provided, data will be imported to Mixpanel after generation. */
    token?: string;
    /** RNG seed for reproducible output. Same seed + concurrency=1 = identical data. */
    seed?: string;
    /** Number of days the dataset spans. Used as fallback when datasetStart/datasetEnd are NOT both set — window becomes (today_start - numDays, today_start). Default: 30. When datasetStart/datasetEnd ARE both set, numDays is recomputed from the window and any user-supplied value is ignored (with a warning). */
    numDays?: number;
    /**
     * Explicit start of the dataset window. Pin BOTH `datasetStart` and `datasetEnd` for
     * bit-exact deterministic runs. Accepts ISO string ("2026-01-01T00:00:00Z"), unix
     * seconds (1735689600), unix milliseconds (1735689600000), or anything `dayjs()`
     * can parse. Setting only one of datasetStart/datasetEnd throws.
     */
    datasetStart?: string | number;
    /**
     * Explicit end of the dataset window. See `datasetStart` — both must be set together.
     */
    datasetEnd?: string | number;
    /** @deprecated Legacy alias internally aliased to datasetStart on validated config. Prefer `datasetStart`. */
    epochStart?: number;
    /** @deprecated Legacy alias internally aliased to datasetEnd on validated config. Prefer `datasetEnd`. */
    epochEnd?: number;
    /** Target total number of events to generate across all users. Fallback when avgEventsPerUserPerDay is not set; otherwise derived from rate × numUsers × numDays. */
    numEvents?: number;
    /** Number of unique users to generate. */
    numUsers?: number;
    /** Average events per user per active day. The canonical event-volume primitive — born-late users get this rate × their remaining window, so per-day density stays constant. If both this and numEvents are set, this wins. */
    avgEventsPerUserPerDay?: number;
    /** Output format for files written to disk. */
    format?: "csv" | "json" | "parquet" | string;
    /** Mixpanel data residency region. */
    region?: "US" | "EU";
    /** User generation concurrency. Default: 1. Values > 1 break seed reproducibility and provide no performance benefit (CPU-bound). */
    concurrency?: number;
    /** Number of records before auto-flushing to disk. Prevents OOM for large datasets. Default: 1,000,000 */
    batchSize?: number;

    // ── Mixpanel Import Credentials (for SCD import) ──
    serviceAccount?: string;
    serviceSecret?: string;
    projectId?: string;

    // ── Identifiers ──
    /** Dataset name prefix for output files. Auto-generated if not set. */
    name?: string;

    // ── Feature Switches ──
    /** If true, users have no distinct_id (anonymous-only tracking). */
    isAnonymous?: boolean;
    /** If true, user profiles include avatar URLs. */
    hasAvatar?: boolean;
    /** If true, events include geo properties (city, region, country, lat/lng). */
    hasLocation?: boolean;
    /**
     * If true, events include UTM campaign properties (utm_source / utm_campaign / utm_medium /
     * utm_content / utm_term).
     *
     * Default: false.
     *
     * Behavior:
     * - false: no UTM stamping anywhere.
     * - true + at least one event in `events[]` has `isAttributionEvent: true`: only the flagged
     *   events are eligible. Within those, ~25% are stamped with a randomly-picked campaign.
     * - true + no event flagged: backwards-compat fallback — ~25% of ALL events are stamped
     *   with a randomly-picked campaign (legacy behavior).
     *
     * @see EventConfig.isAttributionEvent
     */
    hasCampaigns?: boolean;
    /** If true, generates ad spend data (impressions, clicks, cost). */
    hasAdSpend?: boolean;
    /** If true, device pool includes iOS devices. */
    hasIOSDevices?: boolean;
    /** If true, device pool includes Android devices. */
    hasAndroidDevices?: boolean;
    /** If true, device pool includes desktop devices. */
    hasDesktopDevices?: boolean;
    /** If true, events include browser properties. */
    hasBrowser?: boolean;
    /** If true (default), writes output files to ./data/. Can also be a directory path string. */
    writeToDisk?: boolean | string;
    /** If true, gzip-compresses output files. */
    gzip?: boolean;
    /** If true, prints progress to stdout during generation. */
    verbose?: boolean;
    /**
     * @deprecated Prefer `avgDevicePerUser`. `true` is now an alias for `avgDevicePerUser: 1`
     * (single sticky device per user, every event stamped with that `device_id`). `false`
     * (default) leaves the engine in legacy "no device_id stamping" mode unless
     * `avgDevicePerUser` is set.
     *
     * @see Dungeon.avgDevicePerUser
     */
    hasAnonIds?: boolean;
    /**
     * Number of distinct devices each user owns. Whole number ≥ 0. Default: 0 (legacy —
     * no `device_id` stamping anywhere). `≤0` is coerced to `1` if `hasAnonIds: true` is
     * also set; otherwise `0` keeps the engine in legacy mode for backwards compat.
     *
     * Behavior:
     * - `0` (default): no `device_id` stamping. Every event gets `user_id` only. Same as
     *   pre-1.4 behavior when `hasAnonIds` is not set.
     * - `1`: one device per user. All of that user's events that need a device share a
     *   single sticky `device_id`. `hasAnonIds: true` is an alias for this.
     * - `>1`: per-user device pool sized via a normal distribution centered on this value
     *   (sd ≈ value/2, clamped ≥ 1, integer-rounded). Sessions are sticky to a single
     *   device drawn from the user's pool — every event in that session shares the same
     *   `device_id`. Cross-session events for the same user may differ.
     *
     * Identity stamping interactions (multi-device + auth + first funnel):
     * - Pre-existing users (born before dataset window): every event gets both `user_id`
     *   and a per-session `device_id`.
     * - Born-in-dataset users running their `isFirstFunnel`:
     *     * Pre-auth steps (steps before the first `isAuthEvent` in the funnel sequence):
     *       `device_id` only — no `user_id` yet.
     *     * The stitch step (the first `isAuthEvent`): both `user_id` AND `device_id`.
     *     * Post-auth steps in the same funnel: `user_id` only.
     *     * All later (non-firstFunnel) events: `user_id` + per-session sticky `device_id`.
     * - Born-in-dataset users on a `Funnel.attempts` retry that does not reach `isAuthEvent`:
     *   every event in that failed attempt is `device_id` only (pre-auth, never stitched).
     *
     * @see Dungeon.hasAnonIds (deprecated alias when `true`)
     * @see EventConfig.isAuthEvent
     * @see Funnel.attempts
     */
    avgDevicePerUser?: number;
    /** If true, users get session IDs attached to events based on temporal clustering. */
    hasSessionIds?: boolean;
    /** Session timeout in minutes. Events with gaps exceeding this start a new session. Default: 30. Only used when hasSessionIds is true. */
    sessionTimeout?: number;
    /** If true, auto-generates funnels from the events array in addition to any explicit funnels. */
    alsoInferFunnels?: boolean;
    /** Restrict all location data to a single country (e.g., "US", "GB"). */
    singleCountry?: string;
    /** If true, stops generation at exactly numEvents (forces concurrency=1). Without this, event count is approximate. */
    strictEventCount?: boolean;
    /** Internal flag for UI-triggered jobs (affects SCD credential handling). */
    isUIJob?: boolean;

    // ── Data Models ──
    /** Event definitions: names, weights, properties, and behavioral flags. */
    events?: EventConfig[];
    /** Properties that appear on EVERY event (e.g., platform, app_version). */
    superProps?: Record<string, ValueValid>;
    /** Funnel definitions: conversion sequences, rates, ordering strategies. */
    funnels?: Funnel[];
    /** User profile properties set once per user. */
    userProps?: Record<string, ValueValid>;
    /** Slowly Changing Dimension properties: time-series mutations of user/group attributes. */
    scdProps?: Record<string, SCDProp>;
    /** Mirror dataset definitions: create transformed copies of event data. */
    mirrorProps?: Record<string, MirrorProps>;
    /** Group analytics keys. Format: [key, numGroups] or [key, numGroups, [associatedEvents]]. */
    groupKeys?: [string, number][] | [string, number, string[]][];
    /** Properties for each group key's entities. */
    groupProps?: Record<string, Record<string, ValueValid>>;
    /** Group-level events (stub — not yet implemented). */
    groupEvents?: GroupEventConfig[];
    /** Lookup table definitions for dimension tables. */
    lookupTables?: LookupTableSchema[];
    /** TimeSoup configuration: shapes intra-week and intra-day rhythm (peaks, deviation, DOW/HOD weights). Pair with `macro` for big-picture trend control. */
    soup?: soup;
    /** Macro trend shape across the full dataset window: birth distribution + per-user event allocation. Default: "flat". Use "growth"/"viral"/"steady"/"decline" or a custom object. */
    macro?: macro;
    /** Hook function called on every data point. The primary mechanism for engineering deliberate trends and patterns. The `any` is intentional — `record` and `meta` shapes vary by hook type; narrow inside the function (see `HookMeta*` types). */
    hook?: Hook<any>;

    // ── Advanced Features ──
    /** User persona/archetype definitions. Each persona defines a behavioral segment with distinct event volumes, conversion rates, and properties. */
    personas?: Persona[];
    /** World events that affect all users simultaneously (outages, campaigns, product launches). */
    worldEvents?: WorldEvent[] | ResolvedWorldEvent[];
    /** Engagement decay configuration. Controls how user activity decreases over their lifetime. */
    engagementDecay?: EngagementDecay;
    /** Data quality imperfections to inject (nulls, duplicates, bots, late-arriving events). */
    dataQuality?: DataQuality;

    // ── Removed in 1.4 (silently ignored, one deprecation warning per dungeon) ──
    // The following config keys were removed from the engine in 1.4. Existing dungeon
    // files that still set them will load and run — `validateDungeonConfig` strips them
    // with a single deprecation warning per dungeon. Recreate these patterns as hooks
    // (see `lib/hook-patterns/*` once Phase 4 lands).
    //   subscription, attribution, geo, features, anomalies

    /** Allow arbitrary additional properties on the config. */
    [key: string]: any;

    // ── Distribution Controls ──
    // These three knobs are normally set by the `macro` preset (default "flat").
    // Setting them on the dungeon config directly overrides the preset's value.
    /** Percentage of users whose account creation falls within the dataset window (vs. pre-existing). Default (from macro: "flat"): 15 */
    percentUsersBornInDataset?: number;
    /** Bias for birth dates of users born in dataset. -1..1; negative = early skew, positive = recent skew, 0 = uniform. Default (from macro: "flat"): 0 */
    bornRecentBias?: number;
    /** How pre-existing users' first event time is placed. "pinned" stacks them all at FIXED_BEGIN; "uniform" spreads across [FIXED_BEGIN-30d, FIXED_BEGIN]. Default (from macro: "flat"): "uniform" */
    preExistingSpread?: "pinned" | "uniform";
}

export type SCDProp = {
    /** Entity type this SCD applies to. "user" for user profiles; use a group key (e.g., "company_id") for group SCDs. Default: "user" */
    type?: string | "user" | "company_id" | "team_id" | "department_id";
    /** How often the property mutates. Default: "day" */
    frequency?: "day" | "week" | "month" | "year";
    /** Array of possible values, or a function that returns values. */
    values: ValueValid;
    /** "fixed" = mutations at clean boundaries (start of day/week/month/year). "fuzzy" = mutations at any time. Default: "fuzzy" */
    timing?: "fixed" | "fuzzy";
    /** Maximum number of mutations per entity. Default: 10 */
    max?: number;
};

/**
 * Soup preset names for common time distribution patterns
 */
export type SoupPreset = "steady" | "growth" | "spiky" | "seasonal" | "global" | "churny" | "chaotic";

/**
 * Soup configuration object for fine-grained control
 */
export type SoupConfig = {
    /** Use a named preset as base, then override individual fields */
    preset?: SoupPreset;
    /** Controls clustering tightness. Higher = tighter peaks. Default: 2 */
    deviation?: number;
    /** Number of time clusters to distribute events across. Default: numDays*2 */
    peaks?: number;
    /** Offset for the normal distribution center within each peak. Default: 0 */
    mean?: number;
    /** Day-of-week weights (7 elements, index 0=Sunday). Normalized max=1.0. Set null to disable. */
    dayOfWeekWeights?: number[] | null;
    /** Hour-of-day weights (24 elements, index 0=midnight UTC). Normalized max=1.0. Set null to disable. */
    hourOfDayWeights?: number[] | null;
};

/**
 * the soup is a set of parameters that determine the distribution of events over time.
 * Can be a preset name string, a config object, or a config object with a preset base.
 */
type soup = SoupPreset | SoupConfig;

/**
 * Macro preset names for big-picture trend shape across the dataset window.
 * Macro is orthogonal to soup: macro shapes the whole-window trend (births,
 * growth, decline); soup shapes the intra-week and intra-day rhythm.
 */
export type MacroPreset = "flat" | "steady" | "growth" | "viral" | "decline";

/**
 * Macro configuration object — fine-grained big-picture trend control.
 */
export type MacroConfig = {
    /** Use a named macro preset as the base, then override individual fields. */
    preset?: MacroPreset;
    /** Bias for birth dates. -1..1; negative = early skew, positive = recent skew, 0 = uniform. */
    bornRecentBias?: number;
    /** Percentage of users born in dataset window (0..100). */
    percentUsersBornInDataset?: number;
    /** "pinned" = pre-existing users stack at FIXED_BEGIN; "uniform" = spread across [FIXED_BEGIN-30d, FIXED_BEGIN]. */
    preExistingSpread?: "pinned" | "uniform";
};

/** Big-picture trend shape: preset string, config object, or preset+overrides. */
type macro = MacroPreset | MacroConfig;

/** Public alias for the `soup` config union (preset string or config object). */
export type Soup = soup;

/** Public alias for the `macro` config union (preset string or config object). */
export type Macro = macro;

/** Resolved macro values after preset + override resolution. Used internally. */
export interface ResolvedMacro {
    bornRecentBias: number;
    percentUsersBornInDataset: number;
    preExistingSpread: "pinned" | "uniform";
}

/**
 * Hook types and when they fire (in order per user):
 * - "user"        — user profile object (mutate in-place, return ignored)
 * - "scd-pre"     — array of SCD entries (mutate in-place OR return new array to replace)
 * - "funnel-pre"  — funnel config object (mutate conversionRate, timeToConvert, etc. in-place)
 * - "event"       — single event with FLAT properties (return value replaces event)
 * - "funnel-post" — array of generated funnel events (mutate in-place, splice to inject)
 * - "everything"  — array of ALL events for one user (return array to replace; meta.profile available)
 *
 * Storage-only hooks (fire during hookPush, not in generators):
 * - "ad-spend", "group", "mirror", "lookup"
 */
export type hookTypes =
    | "event"
    | "user"
    | "group"
    | "lookup"
    | "scd"
    | "scd-pre"
    | "mirror"
    | "funnel-pre"
    | "funnel-post"
    | "ad-spend"
    | "churn"
    | "group-event"
    | "everything"
    | "";

/**
 * A hook function that receives every piece of data as it flows through the pipeline.
 *
 * The runtime signature is intentionally permissive (`any`) because `record` and `meta`
 * vary by `type`. Use the `HookMeta*` interfaces below as convenience types when narrowing
 * inside your hook (e.g. `if (type === "event") { const m = meta as HookMetaEvent; ... }`).
 *
 * Return-value semantics:
 * - "event": return value REPLACES the event (must be the event object).
 * - "everything": return an array to REPLACE the user's event list (filter/inject/dedupe).
 * - "user", "scd-pre", "funnel-pre", "funnel-post": return value is IGNORED — mutate in place.
 * - storage-only ("ad-spend", "group", "mirror", "lookup"): return value is IGNORED.
 *
 * @param record - The data being processed (event, profile, array of events, funnel config, etc.).
 * @param type - Which hook type is firing — see `hookTypes`.
 * @param meta - Contextual metadata. Shape depends on `type` — see `HookMeta*` interfaces.
 */
export type Hook<T> = (record: any, type: hookTypes, meta: any) => T;

/**
 * Time-window anchors present on every hook's `meta`. Use these to derive relative
 * dates inside hooks (e.g. `dayjs.unix(meta.datasetStart).add(45, 'days')`). NEVER
 * read wall-clock `dayjs()` inside a hook — it makes hooks non-deterministic.
 */
export interface HookMetaTimeAnchors {
    /** Start of the dataset window (unix seconds). Same value the engine uses to bound event generation. */
    datasetStart: number;
    /** End of the dataset window (unix seconds). Same value the engine uses to bound event generation. */
    datasetEnd: number;
}

/** Meta passed to the "event" hook. */
export interface HookMetaEvent extends HookMetaTimeAnchors {
    /** The user this event belongs to (only `distinct_id` is guaranteed). */
    user: { distinct_id: string };
    /** The fully-resolved dungeon config. */
    config: Dungeon;
}

/** Meta passed to the "user" hook (fires when a user profile is created). */
export interface HookMetaUser extends HookMetaTimeAnchors {
    /** The user object being constructed (mutate in place). */
    user: UserProfile;
    /** The fully-resolved dungeon config. */
    config: Dungeon;
    /** True if the user's account creation falls inside the dataset window. */
    userIsBornInDataset: boolean;
}

/** Meta passed to the "scd-pre" hook (fires per SCD prop, before insertion). */
export interface HookMetaScdPre extends HookMetaTimeAnchors {
    /** The user profile that owns these SCD entries. */
    profile: UserProfile;
    /** The SCD prop key being generated (e.g. "plan", "tier"). */
    type: string;
    /** The full SCD entry list for this prop (mutate in place). */
    scd: SCDSchema[];
    /** The fully-resolved dungeon config. */
    config: Dungeon;
    /** All SCD prop arrays generated so far for this user, keyed by prop name. */
    allSCDs: Record<string, SCDSchema[]>;
}

/** Meta passed to the "funnel-pre" hook (mutate funnel before generating events). */
export interface HookMetaFunnelPre extends HookMetaTimeAnchors {
    user: { distinct_id: string };
    profile: UserProfile;
    scd: Record<string, SCDSchema[]>;
    funnel: Funnel;
    config: Dungeon;
    /** Unix seconds — earliest possible event time for this funnel's first step. */
    firstEventTime: number;
    /**
     * Unix seconds — temporal anchor for this funnel run. For usage funnels, advances
     * after each run so successive funnels spread across the user's active window.
     * For first-funnel attempts, matches the attempt cursor. Use this to implement
     * temporal conversion trends (e.g., "conversion increases after day 30").
     */
    funnelRunTime: number;
    /** True if this funnel is the user's `isFirstFunnel`. */
    isFirstFunnel: boolean;
    /** True if the user's account creation falls inside the dataset window. */
    isBorn: boolean;
    /** Resolved attempts config for this funnel run, or null if attempts is not configured. */
    attemptsConfig: AttemptsConfig | null;
    /** 1-indexed attempt number for this run (1..totalAttempts). */
    attemptNumber: number;
    /** Total number of attempts (failed priors + 1 final). When attempts is omitted, this is 1. */
    totalAttempts: number;
    /** True if this is the final attempt (attemptNumber === totalAttempts). */
    isFinalAttempt: boolean;
    /** The user's assigned persona (if `personas` is configured), or null. */
    persona: Persona | null;
    /** Experiment context for this funnel run, or null if no experiment / pre-start-date. */
    experiment: HookMetaExperiment | null;
}

/** Meta passed to the "funnel-post" hook (mutate generated funnel events in place). */
export interface HookMetaFunnelPost extends HookMetaTimeAnchors {
    user: { distinct_id: string };
    profile: UserProfile;
    scd: Record<string, SCDSchema[]>;
    funnel: Funnel;
    config: Dungeon;
    /** Unix seconds — temporal anchor for this funnel run (see HookMetaFunnelPre.funnelRunTime). */
    funnelRunTime: number;
    /** True if this funnel is the user's `isFirstFunnel`. */
    isFirstFunnel: boolean;
    /** True if the user's account creation falls inside the dataset window. */
    isBorn: boolean;
    /** Resolved attempts config for this funnel run, or null if attempts is not configured. */
    attemptsConfig: AttemptsConfig | null;
    /** 1-indexed attempt number for this run (1..totalAttempts). */
    attemptNumber: number;
    /** Total number of attempts. */
    totalAttempts: number;
    /** True if this is the final attempt. */
    isFinalAttempt: boolean;
    /** The user's assigned persona (if `personas` is configured), or null. */
    persona: Persona | null;
    /** Experiment context for this funnel run, or null if no experiment / pre-start-date. */
    experiment: HookMetaExperiment | null;
}

/** Meta passed to the "everything" hook — most powerful hook (sees all events for one user). */
export interface HookMetaEverything extends HookMetaTimeAnchors {
    /** The user's profile, including any merged persona properties. */
    profile: UserProfile;
    /** All SCD entries for this user, keyed by prop name. */
    scd: Record<string, SCDSchema[]>;
    /** The fully-resolved dungeon config. */
    config: Dungeon;
    /** True if the user's account creation falls inside the dataset window. */
    userIsBornInDataset: boolean;
    /**
     * Unix milliseconds of the stitch event (the first `isAuthEvent` in the user's stream).
     * `null` if this user never authed (pre-existing users have no stitch event in the
     * dataset window — they're already authed; born-in-dataset users who never converted
     * remain pre-auth forever).
     */
    authTime: number | null;
    /**
     * Predicate bound to this user's `authTime`. Returns true if the event happened before
     * the stitch (i.e. the user was anonymous at that point). Returns false for pre-existing
     * users (they're considered authed throughout). For born-in-dataset users that never
     * authed, returns true for every event.
     */
    isPreAuth: (event: EventSchema) => boolean;
    /** The user's assigned persona (if `personas` is configured), or null. */
    persona: Persona | null;
}

export interface hookArrayOptions<T> {
    /** Transform/validate function applied to every record on push. */
    hook?: Hook<T>;
    /** What this array stores — controls hook-firing semantics in the storage layer. */
    type?: hookTypes;
    /** Output filename (no extension; format adds it). Used by storage's batch writer. */
    filename?: string;
    /** Output filepath used when writing batches to disk. */
    filepath?: string;
    /** Output serialization format. */
    format?: "csv" | "json" | "parquet" | string;
    /** Max parallel disk writes. */
    concurrency?: number;
    /** Generation context (config, runtime, defaults). */
    context?: Context;
}

/**
 * an enriched array is an array that has a hookPush method that can be used to transform-then-push items into the array.
 *
 * Storage callers also tag the array with a key identifying what it stores
 * (e.g. SCD prop name, group key, lookup table key). The fields are optional
 * because not every HookedArray needs them; mixpanel-sender / user-loop read
 * them when present to route uploads correctly.
 */
export interface HookedArray<T> extends Array<T> {
    /** Transform-then-push. Resolves once the item (and any auto-flushed batch) is persisted. */
    hookPush: (item: T | T[], ...meta: unknown[]) => Promise<void>;
    /** Force-flush any pending batch to disk. */
    flush: () => Promise<void>;
    /** Absolute path of the directory batches will be written to. */
    getWriteDir: () => string;
    /** Absolute path (with extension) of the next batch file. */
    getWritePath: () => string;
    /** SCD prop name this array carries (only set on SCD HookedArrays). */
    scdKey?: string;
    /** Entity type for SCDs ("user" or a group key). */
    entityType?: string;
    /** Group key this array carries (only set on group profile HookedArrays). */
    groupKey?: string;
    /** Lookup table key this array carries (only set on lookup table HookedArrays). */
    lookupKey?: string;
}

export type AllData =
    | HookedArray<EventSchema>
    | HookedArray<UserProfile>
    | HookedArray<GroupProfileSchema>
    | HookedArray<LookupTableSchema>
    | HookedArray<SCDSchema>;

/**
 * the storage object is a key-value store that holds arrays of data
 */
export interface Storage {
    eventData?: HookedArray<EventSchema>;
    mirrorEventData?: HookedArray<EventSchema>;
    userProfilesData?: HookedArray<UserProfile>;
    adSpendData?: HookedArray<EventSchema>;
    groupProfilesData?: HookedArray<GroupProfileSchema>[];
    lookupTableData?: HookedArray<LookupTableSchema>[];
    scdTableData?: HookedArray<SCDSchema>[];
    groupEventData?: HookedArray<EventSchema>;
}

/**
 * Runtime state for tracking execution metrics and flags
 */
export interface RuntimeState {
    operations: number;
    eventCount: number;
    storedEventCount: number;
    userCount: number;
    isBatchMode: boolean;
    verbose: boolean;
}

/**
 * Default data factories for generating realistic test data
 */
/**
 * Default data factories — pre-resolved at context creation time so user-loop
 * doesn't re-evaluate weighted picker arrays on every iteration.
 */
export interface Defaults {
    /** Location pools applied to user profiles (city, region, country, lat/lng). */
    locationsUsers: () => Record<string, ValueValid>[];
    /** Location pools applied to events. */
    locationsEvents: () => Record<string, ValueValid>[];
    /** iOS device pool (model, os version, etc.). */
    iOSDevices: () => Record<string, ValueValid>[];
    /** Android device pool. */
    androidDevices: () => Record<string, ValueValid>[];
    /** Desktop device pool (browser, screen resolution, etc.). */
    desktopDevices: () => Record<string, ValueValid>[];
    /** Browser/UA pool. */
    browsers: () => Record<string, ValueValid>[];
    /** UTM campaign pool used when `hasCampaigns: true`. */
    campaigns: () => Record<string, ValueValid>[];
    /** Pre-built per-platform device arrays selected once at context creation. */
    devicePools: {
        android: Record<string, ValueValid>[];
        ios: Record<string, ValueValid>[];
        desktop: Record<string, ValueValid>[];
    };
    /** Flat union of every device in `devicePools` — used when no platform filter applies. */
    allDevices: Record<string, ValueValid>[];
}

/**
 * Context object that replaces global variables with dependency injection
 * Contains validated config, storage containers, defaults, and runtime state
 */
export interface Context {
    config: Dungeon;
    storage: Storage | null;
    defaults: Defaults;
    /** Pre-built UTM campaign pool (used when `hasCampaigns: true`). */
    campaigns: Record<string, ValueValid>[];
    runtime: RuntimeState;
    /** End of the resolved dataset window (unix seconds). Equal to the user-supplied `datasetEnd`, or fallback `today_start`. */
    FIXED_NOW: number;
    /** Start of the resolved dataset window (unix seconds). Equal to the user-supplied `datasetStart`, or fallback `today_start - numDays`. */
    FIXED_BEGIN?: number;
    /** Alias of `FIXED_BEGIN` — surfaced on hook `meta.datasetStart`. */
    DATASET_START_SECONDS: number;
    /** Alias of `FIXED_NOW` — surfaced on hook `meta.datasetEnd`. */
    DATASET_END_SECONDS: number;

    // State update methods
    incrementOperations(): void;
    incrementEvents(): void;
    incrementUsers(): void;
    incrementStoredEvents(count?: number): void;
    setStorage(storage: Storage): void;

    // State getter methods
    getOperations(): number;
    getEventCount(): number;
    getStoredEventCount(): number;
    getUserCount(): number;
    incrementUserCount(): void;
    incrementEventCount(): void;
    isBatchMode(): boolean;
}

/**
 * how we define events and their properties
 */
export interface EventConfig {
    /** The event name (e.g., "page viewed", "purchase completed"). */
    event?: string;
    /** Relative frequency weight (1-10). Higher = more likely to be selected. Used for both standalone event selection and funnel sequence building. Default: 1 */
    weight?: number;
    /** Properties to attach to this event type. Values can be arrays (random pick), functions, or primitives. */
    properties?: Record<string, ValueValid>;
    /** If true, this is the user's first-ever event (e.g., "sign up"). Used to create onboarding funnels. */
    isFirstEvent?: boolean;
    /** If true, generating this event signals the user has churned. The user stops producing further events unless returnLikelihood allows them to come back. */
    isChurnEvent?: boolean;
    /** Probability (0-1) that a churned user returns and continues generating events. 0 = permanent churn, 1 = always returns. Only used when isChurnEvent is true. Default: 0 */
    returnLikelihood?: number;
    /** If true, this event is automatically prepended 15 seconds before each funnel sequence (e.g., "$session_started"). */
    isSessionStartEvent?: boolean;
    /** Internal: timing offset in milliseconds (set by funnel system, not user-configured). */
    relativeTimeMs?: number;
    /** If true, this event is excluded from auto-generated funnels (inferFunnels and catch-all). Use for system events that shouldn't appear in conversion sequences. */
    isStrictEvent?: boolean;
    /**
     * If true, this event marks the moment a user transitions from anonymous (pre-auth)
     * to identified (post-auth) — typically the "Sign Up" or "Login" event. Multiple events
     * in a dungeon may carry this flag; the engine looks at the first occurrence in a user's
     * stream to determine the identity stitch moment.
     *
     * Default: false.
     *
     * Behavior, when in a funnel marked `isFirstFunnel: true`:
     * - All steps before the first `isAuthEvent` step in the funnel sequence are stamped
     *   with `device_id` only (pre-auth).
     * - The `isAuthEvent` step itself is the stitch — it carries BOTH `user_id` AND
     *   `device_id`. Exactly one such record per converted born-in-dataset user.
     * - Steps after the stitch in that funnel get `user_id` only.
     *
     * Behavior outside `isFirstFunnel`: the flag has no extra effect — those events follow
     * the usual identity rules for that user (per `avgDevicePerUser`).
     *
     * Behavior on born-in-dataset users whose `Funnel.attempts` retries fail to reach the
     * `isAuthEvent`: every event in those failed attempts is `device_id` only (pre-auth,
     * never stitched). If their final attempt also fails, they remain pre-auth forever.
     *
     * @see Dungeon.avgDevicePerUser
     * @see Funnel.isFirstFunnel
     * @see Funnel.attempts
     */
    isAuthEvent?: boolean;
    /**
     * If true, this event is eligible to carry UTM campaign properties when
     * `Dungeon.hasCampaigns: true`. ~25% of flagged events get a randomly-picked campaign
     * stamped (utm_source / utm_campaign / utm_medium / utm_content / utm_term).
     *
     * Default: false.
     *
     * Backwards compat: if `Dungeon.hasCampaigns: true` but no event carries this flag,
     * ~25% of ALL events are stamped (legacy behavior, preserved). Opt-in by flagging at
     * least one event.
     *
     * @see Dungeon.hasCampaigns
     */
    isAttributionEvent?: boolean;
}

export interface GroupEventConfig extends EventConfig {
    frequency: number; //how often the event occurs (in days)
    group_key: string; //the key that the group is based on
    attribute_to_user: boolean; //if true, the event also goes to a user
    group_size: number; //the number of users in the group
}

/**
 * the generated event data
 */
export interface EventSchema {
    event: string;
    time: string;
    source: string;
    insert_id: string;
    device_id?: string;
    session_id?: string;
    user_id?: string;
    [key: string]: ValueValid;
}

/**
 * how we define funnels and their properties
 */
export interface Funnel {
    /**
     * the name of the funnel
     */
    name?: string;
    /**
     * the description of the funnel
     */
    description?: string;
    /**
     * the sequence of events that define the funnel
     */
    sequence: string[];
    /**
     * how likely the funnel is to be selected
     */
    weight?: number;
    /**
     * If true, the funnel will be the first thing the user does
     */
    isFirstFunnel?: boolean;
    /**
     * If true, the funnel will require the user to repeat the sequence of events in order to convert
     * If false, the user does not need to repeat the sequence of events in order to convert
     * ^ when false, users who repeat the repetitive steps are more likely to convert
     */
    requireRepeats?: boolean;
    /**
     * how the events in the funnel are ordered for each user
     */
    order?:
        | "sequential"
        | "first-fixed"
        | "last-fixed"
        | "random" //totally shuffled
        | "first-and-last-fixed"
        | "middle-fixed"
        | "interrupted"
        | string;

    /**
     * the likelihood that a user will convert (0-100%)
     */
    conversionRate?: number;
    /**
     * the time it takes (on average) to convert in hours
     */
    timeToConvert?: number;
    /**
     * funnel properties go onto each event in the funnel and are held constant
     */
    props?: Record<string, ValueValid>;
    /**
     * funnel conditions (user properties) are used to filter users who are eligible for the funnel
     * these conditions must match the current user's profile for the user to be eligible for the funnel
     */
    conditions?: Record<string, ValueValid>;
	/**
	 * Experiment configuration for this funnel.
	 *
	 * - `true` — backward-compatible shorthand: 3 variants (Variant A = worse, Variant B = better, Control),
	 *   active for the entire dataset.
	 * - `ExperimentConfig` object — custom variant names, conversion/TTC multipliers, temporal gating,
	 *   and distribution weights.
	 *
	 * Variant assignment is **deterministic per user** (hash of user_id + experiment name), so the same
	 * user is in the same variant across all funnel runs. `$experiment_started` is prepended to the
	 * sequence for every post-start-date funnel run.
	 *
	 * Hook meta (`meta.experiment`) exposes the resolved variant in `funnel-pre` and `funnel-post`
	 * hooks, enabling variant-specific story injection.
	 *
	 * @see ExperimentConfig
	 */
	experiment?: boolean | ExperimentConfig;
	/**
	 * optional: if set, in sequential funnels, this will determine WHEN the property is bound to the rest of the events in the funnel
	 */
	bindPropsIndex?: number;
	/**
	 * Multi-attempt iteration for this funnel. Models real users who land, abandon, come
	 * back, and try again. Additive — omit for legacy single-attempt behavior.
	 *
	 * @see AttemptsConfig
	 */
	attempts?: AttemptsConfig;
	/** @internal Resolved experiment config set by config-validator. */
	_experiment?: { name: string; variants: Array<{ name: string; conversionMultiplier: number; ttcMultiplier: number; weight: number }>; startUnix: number | null };
	/** @internal Set by funnels.js during experiment handling. */
	_experimentName?: string;
	/** @internal Set by funnels.js during experiment handling. */
	_experimentVariant?: string;
}

/**
 * Per-funnel multi-attempt config. `attempts.min`/`attempts.max` describe the count of
 * **failed prior attempts** (NOT total attempts). The engine picks an integer
 * `failedPriors = chance.integer({min, max})` then runs `failedPriors + 1` total
 * passes through the funnel. The last pass is the "final attempt" — it converts per
 * `attempts.conversionRate ?? funnel.conversionRate`. Each prior attempt is a truncated
 * pre-auth pass that drops out at a random step before reaching any `isAuthEvent`.
 *
 * Identity interaction (when the funnel is `isFirstFunnel`):
 * - Failed prior attempts: every event stamped with `device_id` only — never reach the
 *   stitch step, so `user_id` is never assigned.
 * - Final attempt: follows the standard pre-auth → stitch → post-auth identity model.
 *   If the final attempt also fails, the user remains pre-auth forever.
 *
 * For non-`isFirstFunnel` funnels, each attempt is treated as an independent usage
 * session (e.g. abandon-cart). Identity stamping uses the user's normal post-auth model.
 *
 * @example single attempt (default behavior)
 * { attempts: { min: 0, max: 0 } }   // exactly one pass — equivalent to omitting attempts
 *
 * @example up to 3 failed retries before a 60% final conversion
 * { conversionRate: 60, attempts: { min: 0, max: 3 } }
 *
 * @example heavy churn before final attempt with overridden conversion rate
 * { conversionRate: 80, attempts: { min: 1, max: 5, conversionRate: 30 } }
 */
export interface AttemptsConfig {
	/** Lower bound on the number of FAILED PRIOR attempts. 0 = a single attempt is possible. Whole number, ≥ 0. Default: 0. */
	min?: number;
	/** Upper bound on the number of FAILED PRIOR attempts (inclusive). Whole number, ≥ min. Default: 0. */
	max?: number;
	/**
	 * Conversion rate (0–100) applied to the FINAL attempt only — overrides
	 * `funnel.conversionRate` if set. Omit to inherit `funnel.conversionRate`.
	 * Matches the existing `Funnel.conversionRate` scale (0–100, NOT 0–1).
	 */
	conversionRate?: number;
}

/**
 * Experiment configuration for a funnel. Controls variant assignment, naming,
 * conversion/TTC modifiers, and temporal gating.
 *
 * @example A/B test starting 30 days before dataset end
 * {
 *   name: "Checkout Redesign",
 *   startDaysBeforeEnd: 30,
 *   variants: [
 *     { name: "Control" },
 *     { name: "New Checkout", conversionMultiplier: 1.25, ttcMultiplier: 0.8 },
 *   ]
 * }
 */
export interface ExperimentConfig {
	/** Human-readable experiment name. Default: `funnel.name + " Experiment"`. */
	name?: string;
	/**
	 * Variant definitions. Each variant gets a deterministic share of users.
	 * Default (when omitted): 3 variants — Variant A (worse), Variant B (better), Control.
	 */
	variants?: ExperimentVariant[];
	/**
	 * Days before dataset end that the experiment starts. Funnel runs before
	 * the start date skip experiment logic entirely (no variant, no $experiment_started).
	 * Default: 0 (entire dataset).
	 */
	startDaysBeforeEnd?: number;
}

/** A single variant in an experiment. */
export interface ExperimentVariant {
	/** Display name — appears in the "Variant name" property on $experiment_started. */
	name: string;
	/** Multiplier applied to funnel.conversionRate. 1.0 = unchanged. Default: 1.0. */
	conversionMultiplier?: number;
	/** Multiplier applied to funnel.timeToConvert. 1.0 = unchanged. Default: 1.0. */
	ttcMultiplier?: number;
	/** Distribution weight. Default: 1 (equal split across variants). */
	weight?: number;
}

/** Experiment context exposed in funnel-pre and funnel-post hook meta. */
export interface HookMetaExperiment {
	/** Experiment name. */
	name: string;
	/** Name of the assigned variant. */
	variantName: string;
	/** 0-based index of the assigned variant. */
	variantIndex: number;
	/** Conversion multiplier applied for this variant. */
	conversionMultiplier: number;
	/** TTC multiplier applied for this variant. */
	ttcMultiplier: number;
	/** Unix seconds of experiment start, or null if active for entire dataset. */
	startDate: number | null;
}

/**
 * mirror props are used to show mutations of event data over time
 * there are different strategies for how to mutate the data
 */
export interface MirrorProps {
    /**
     * the event that will be mutated in the new version
     */
    events?: string[] | "*";
    /**
     * "create" - create this key in the new version; value are chosen
     * "update" - update this key in the new version; values are chosen
     * "fill" - update this key in the new version, but only if the existing key is null or unset
     * "delete" - delete this key in the new version; values are ignored
     */
    strategy?: "create" | "update" | "fill" | "delete" | "";
    values?: ValueValid[];
    /**
     * optional: for 'fill' mode, daysUnfilled will dictate where the cutoff is in the unfilled data
     */
    daysUnfilled?: number;
}

export interface UserProfile {
    name?: string;
    email?: string;
    avatar?: string;
    created: string | undefined;
    distinct_id: string;
    [key: string]: ValueValid;
}

export interface Person {
    name: string;
    email?: string;
    avatar?: string;
    created: string | undefined;
    anonymousIds: string[];
    sessionIds: string[];
    distinct_id?: string;
}

/**
 * the generated user data
 */
export interface LookupTableSchema {
    key: string;
    entries: number;
    attributes: Record<string, ValueValid>;
}

export interface LookupTableData {
    key: string;
    /** Generated rows for this lookup table. Each row is a flat record keyed by attribute name. */
    data: Record<string, ValueValid>[];
}

export interface SCDSchema {
    distinct_id: string;
    insertTime: string;
    startTime: string;
    [key: string]: ValueValid;
}

export interface GroupProfileSchema {
    key: string;
    /** Generated group profile rows. Each row is a flat record keyed by group property name. */
    data: Record<string, ValueValid>[];
}

/**
 * the end result of importing data into mixpanel
 */
export interface ImportResults {
    events: ImportResult;
    users: ImportResult;
    groups: ImportResult[];
}
type ImportResult = import("mixpanel-import").ImportResults;

/**
 * the end result of the data generation
 */
export type Result = {
    /** Generated events. */
    eventData: EventSchema[];
    /** Mirror datasets (transformed copies of `eventData`). */
    mirrorEventData: EventSchema[];
    /** User profiles. */
    userProfilesData: UserProfile[];
    /** SCD entries — one inner array per SCD prop. */
    scdTableData: SCDSchema[][];
    /** Ad-spend events (only populated when `hasAdSpend: true`). */
    adSpendData: EventSchema[];
    /** Group profiles — one inner array per group key. */
    groupProfilesData: GroupProfileSchema[][];
    /** Lookup tables — one inner array per table. */
    lookupTableData: LookupTableData[][];
    /** Mixpanel import results (only populated when a token was provided). */
    importResults?: ImportResults;
    /** Absolute paths of all files written to disk. */
    files?: string[];
    /** Timing information. */
    time?: {
        start: number;
        end: number;
        delta: number;
        human: string;
    };
    operations?: number;
    eventCount?: number;
    userCount?: number;
    groupCount?: number;
    avgEPS?: number;
};

// ============= Advanced Feature Types =============

/**
 * User persona/archetype definition.
 * Personas define behavioral segments with distinct event volumes, conversion rates, and properties.
 */
export interface Persona {
    /** Unique name for this persona (e.g., "power_user", "casual", "churner"). */
    name: string;
    /** Relative weight for persona assignment (higher = more users get this persona). */
    weight: number;
    /** Multiplier for number of events this persona generates (1.0 = normal). */
    eventMultiplier?: number;
    /** Multiplier for funnel conversion rates (1.0 = normal, 1.3 = 30% better). */
    conversionModifier?: number;
    /** Base churn rate for this persona (0-1). */
    churnRate?: number;
    /** Properties merged into user profiles for this persona. */
    properties?: Record<string, ValueValid>;
    /** Limit how long this persona is active (e.g., trial users active for 14 days). */
    activeWindow?: { maxDays: number };
    /** Per-persona engagement decay override. */
    engagementDecay?: EngagementDecay;
    /** Per-persona soup/timing override. */
    soupOverride?: SoupConfig;
}

/**
 * World event that affects all users simultaneously.
 */
export interface WorldEvent {
    /** Name of the world event (e.g., "black_friday", "platform_outage"). */
    name: string;
    /** Type category for the event. */
    type?: "campaign" | "outage" | "product_launch" | "holiday" | "incident" | string;
    /** Start day relative to dataset start (e.g., 60 = day 60). */
    startDay: number;
    /** Duration in days (0.25 = 6 hours, null = permanent from startDay onward). */
    duration?: number | null;
    /** Volume multiplier during this event (3.0 = 3x events, 0.1 = 90% drop). */
    volumeMultiplier?: number;
    /** Conversion rate modifier during this event. */
    conversionModifier?: number;
    /** Properties injected into affected events. */
    injectProps?: Record<string, ValueValid>;
    /** Which events are affected ("*" for all, or array of event names). */
    affectsEvents?: string[] | "*";
    /** Aftermath period after the event ends. */
    aftermath?: { duration: number; volumeMultiplier: number };
}

/**
 * Resolved world event with absolute timestamps (internal use).
 */
export interface ResolvedWorldEvent extends WorldEvent {
    /** Absolute start time (unix seconds). */
    startUnix: number;
    /** Absolute end time (unix seconds), or Infinity for permanent events. */
    endUnix: number;
    /** Aftermath end time (unix seconds), if applicable. */
    aftermathEndUnix?: number;
}

/**
 * Engagement decay configuration.
 */
export interface EngagementDecay {
    /** Decay model type. "none" preserves flat engagement (default). */
    model: "exponential" | "linear" | "step" | "none";
    /** Days until engagement halves (for exponential model). */
    halfLife?: number;
    /** Minimum engagement ratio (0 = can fully churn, 0.1 = never below 10%). */
    floor?: number;
    /** Per-day chance of re-engagement spike after decay. */
    reactivationChance?: number;
    /** Multiplier for engagement during reactivation. */
    reactivationMultiplier?: number;
}

/**
 * Data quality imperfection configuration.
 */
export interface DataQuality {
    /** Fraction of property values that become null (0-1). */
    nullRate?: number;
    /** Which properties to null ("*" for any, or array of property names). */
    nullProps?: string[] | "*";
    /** Fraction of events that get duplicated (0-1). */
    duplicateRate?: number;
    /** Fraction of events that arrive late (shifted 1-7 days backward) (0-1). */
    lateArrivingRate?: number;
    /** Number of synthetic bot users to inject. */
    botUsers?: number;
    /** Events per bot user (bots generate repetitive, machine-like patterns). */
    botEventsPerUser?: number;
    /** Fraction of events with timezone offset errors (0-1). */
    timezoneConfusion?: number;
    /** Fraction of events missing their event name (0-1). */
    emptyEvents?: number;
}

// ── Removed types in 1.4 ──
// Subscription, SubscriptionPlan, SubscriptionLifecycle, Attribution, AttributionCampaign,
// GeoConfig, GeoRegion, RegionalLaunch, FeatureConfig, AnomalyConfig were removed from
// the engine in 1.4. Recreate these patterns via hooks (see lib/hook-patterns/* and the
// `write-hooks` skill once Phase 4/5 land). The killed config keys are silently stripped
// by `validateDungeonConfig` with a single deprecation warning per dungeon.

/**
 * dungeon-master: generate realistic Mixpanel data at scale
 *
 * accepts multiple input formats:
 * - config object: `DUNGEON_MASTER({ numUsers: 100, events: [...] })`
 * - file path (.js/.mjs): `DUNGEON_MASTER('./dungeons/simple.js')`
 * - file path (.json): `DUNGEON_MASTER('./dungeons/simple-schema.json')`
 * - array of file paths: `DUNGEON_MASTER(['./dungeons/a.js', './dungeons/b.js'])`
 * - raw JS string: `DUNGEON_MASTER('export default { numUsers: 50, ... }')`
 *
 * @example
 * import DUNGEON_MASTER from '@ak--47/dungeon-master';
 * const data = await DUNGEON_MASTER({ numUsers: 100, numEvents: 10_000, numDays: 30 });
 *
 * @example
 * const data = await DUNGEON_MASTER('./dungeons/simple.js', { writeToDisk: true });
 *
 * @example
 * const results = await DUNGEON_MASTER(['./dungeons/gaming.js', './dungeons/media.js']);
 */
declare function DUNGEON_MASTER(input: Dungeon, overrides?: Partial<Dungeon>): Promise<Result>;
declare function DUNGEON_MASTER(input: string, overrides?: Partial<Dungeon>): Promise<Result>;
declare function DUNGEON_MASTER(input: string[], overrides?: Partial<Dungeon>): Promise<Result[]>;

export default DUNGEON_MASTER;

/** Load and validate a dungeon from a file path */
export declare function loadFromFile(filePath: string): Promise<Dungeon>;
/** Load and validate a dungeon from raw JavaScript text */
export declare function loadFromText(code: string): Promise<Dungeon>;
/** Parse a JSON dungeon (UI schema format) into a runnable config */
export declare function parseJSONDungeon(json: object): Dungeon;
/** Validate that an object has the minimum shape of a dungeon config. Throws on shape violations. */
export declare function validateDungeonShape(config: unknown): void;

// ============= Text Generator Types =============

/**
 * Sentiment tone of generated text
 */
export type TextTone = "pos" | "neg" | "neu";

/**
 * Style of text generation
 * 
 * Supported styles:
 * - "support": Customer support tickets and requests
 * - "review": Product reviews and ratings
 * - "search": Search queries and keywords
 * - "feedback": User feedback and suggestions
 * - "chat": Casual chat messages and conversations
 * - "email": Formal email communications
 * - "forum": Forum posts and discussions
 * - "comments": Social media comments and reactions
 * - "tweet": Twitter-style social media posts
 */
export type TextStyle = "support" | "review" | "search" | "feedback" | "chat" | "email" | "forum" | "comments" | "tweet";

/**
 * Emotional intensity level
 */
export type TextIntensity = "low" | "medium" | "high";

/**
 * Language formality level
 */
export type TextFormality = "casual" | "business" | "technical";

/**
 * Output format for batch generation
 */
export type TextReturnType = "strings" | "objects";

/**
 * Domain-specific keywords to inject into generated text
 * 
 * Common predefined categories include:
 * - features: Product features to mention
 * - products: Product/company names  
 * - competitors: Competitor names for comparisons
 * - technical: Technical terms and jargon
 * - versions: Version numbers and releases
 * - errors: Specific error messages or codes
 * - metrics: Business metrics or KPIs
 * - events: Event types (e.g., 'wedding', 'celebration', 'conference')
 * - emotions: Emotional descriptors (e.g., 'inspiring', 'heartwarming')
 * - issues: Common problems or issues
 * - team: Team or role references
 * - business_impact: Business impact phrases
 * - comparisons: Comparison phrases
 * - credibility: Credibility markers
 * - user_actions: User action descriptions
 * - specific_praise: Specific positive details
 * - specific_issues: Specific negative details
 * - error_messages: Error message text
 * - categories: General categories
 * - brands: Brand names
 * - vendors: Vendor references
 * - services: Service types
 * - locations: Location references
 * 
 * Custom categories can be added as needed.
 */
export interface TextKeywordSet {
    /** Product features to mention */
    features?: string[];
    /** Product/company names */
    products?: string[];
    /** Competitor names for comparisons */
    competitors?: string[];
    /** Technical terms and jargon */
    technical?: string[];
    /** Version numbers and releases */
    versions?: string[];
    /** Specific error messages or codes */
    errors?: string[];
    /** Business metrics or KPIs */
    metrics?: string[];
    /** Event types (e.g., 'wedding', 'celebration', 'conference') */
    events?: string[];
    /** Emotional descriptors (e.g., 'inspiring', 'heartwarming') */
    emotions?: string[];
    /** Common problems or issues */
    issues?: string[];
    /** Team or role references */
    team?: string[];
    /** Business impact phrases */
    business_impact?: string[];
    /** Comparison phrases */
    comparisons?: string[];
    /** Credibility markers */
    credibility?: string[];
    /** User action descriptions */
    user_actions?: string[];
    /** Specific positive details */
    specific_praise?: string[];
    /** Specific negative details */
    specific_issues?: string[];
    /** Error message text */
    error_messages?: string[];
    /** General categories */
    categories?: string[];
    /** Brand names */
    brands?: string[];
    /** Vendor references */
    vendors?: string[];
    /** Service types */
    services?: string[];
    /** Location references */
    locations?: string[];
    /** Allow any custom keyword category */
    [key: string]: string[] | undefined;
}

/**
 * Configuration for text generator instance
 */
export interface TextGeneratorConfig {
    /** Default sentiment tone */
    tone?: TextTone;
    /** Type of text to generate */
    style?: TextStyle;
    /** Emotional intensity */
    intensity?: TextIntensity;
    /** Language formality */
    formality?: TextFormality;
    /** Minimum text length in characters */
    min?: number;
    /** Maximum text length in characters */
    max?: number;
    /** RNG seed for reproducibility */
    seed?: string;
    /** Domain-specific keywords to inject */
    keywords?: TextKeywordSet;
    /** Probability of keyword injection (0-1) */
    keywordDensity?: number;
    /** Enable realistic typos */
    typos?: boolean;
    /** Base typo probability per word */
    typoRate?: number;
    /** Allow sentiment mixing for realism */
    mixedSentiment?: boolean;
    /** Amount of authentic markers (0-1) */
    authenticityLevel?: number;
    /** Add timestamps to some messages */
    timestamps?: boolean;
    /** Include user role/experience markers */
    userPersona?: boolean;
    /** Allow sentiment to drift during generation (0-1) */
    sentimentDrift?: number;
    /** Add metadata to generated text */
    includeMetadata?: boolean;
    /** How specific/detailed to make claims (0-1) */
    specificityLevel?: number;
    /** Filter near-duplicates */
    enableDeduplication?: boolean;
    /** Max generation attempts per item */
    maxAttempts?: number;
    // performanceMode removed - system is always optimized for speed + uniqueness
}

/**
 * Metadata for generated text
 */
export interface TextMetadata {
    /** Timestamp if enabled */
    timestamp?: string;
    /** Sentiment analysis score */
    sentimentScore?: number;
    /** Keywords that were injected */
    injectedKeywords?: string[];
    /** User persona information */
    persona?: Record<string, ValueValid>;
    /** Flesch reading ease score */
    readabilityScore?: number;
    /** Text style used */
    style?: TextStyle | string;
    /** Intensity level used */
    intensity?: TextIntensity | string;
    /** Formality level used */
    formality?: TextFormality | string;
}

/**
 * Simple generated text object (without metadata)
 */
export interface SimpleGeneratedText {
    /** The generated text */
    text: string;
    /** Actual tone of generated text */
    tone: TextTone | string;
}

/**
 * Generated text with metadata
 */
export interface GeneratedText {
    /** The generated text */
    text: string;
    /** Actual tone of generated text */
    tone: TextTone | string;
    /** Additional metadata */
    metadata?: TextMetadata;
}

/**
 * Options for batch text generation
 */
export interface TextBatchOptions {
    /** Number of items to generate */
    n: number;
    /** Output format */
    returnType?: TextReturnType;
    /** Override tone for this batch */
    tone?: TextTone;
    /** Generate related/coherent items */
    related?: boolean;
    /** Shared context/topic for related items */
    sharedContext?: string;
}

/**
 * Statistics for text generator performance
 */
export interface TextGeneratorStats {
    /** Configuration used */
    config: TextGeneratorConfig;
    /** Total items generated */
    generatedCount: number;
    /** Items that were duplicates */
    duplicateCount: number;
    /** Items that failed generation */
    failedCount: number;
    /** Average generation time per item */
    avgGenerationTime: number;
    /** Total generation time */
    totalGenerationTime: number;
}

/**
 * Text generator instance interface
 */
export interface TextGenerator {
    /** Generate a single text item */
    generateOne(): string | GeneratedText | null;
    /** Generate multiple text items in batch */
    generateBatch(options: TextBatchOptions): (string | GeneratedText | SimpleGeneratedText)[];
    /** Get generation statistics */
    getStats(): TextGeneratorStats;
}

/**
 * Creates a new text generator instance
 * @param config - Configuration options for the generator
 * @returns Text generator instance
 */
export declare function createTextGenerator(config?: TextGeneratorConfig): TextGenerator;

/**
 * Generate a batch of text items directly (standalone function)
 * @param options - Combined generator config and batch options
 * @returns Array of generated text items
 */
export declare function generateBatch(options: TextGeneratorConfig & TextBatchOptions): (string | GeneratedText | SimpleGeneratedText)[];

// ============= Additional Utility Types =============

/**
 * File path configuration for data generation output
 */
export interface WritePaths {
    eventFiles: string[];
    userFiles: string[];
    adSpendFiles: string[];
    scdFiles: string[];
    mirrorFiles: string[];
    groupFiles: string[];
    lookupFiles: string[];
    folder: string;
}

/**
 * Configuration for TimeSoup time distribution function
 */
export interface TimeSoupOptions {
    earliestTime?: number;
    latestTime?: number;
    peaks?: number;
    deviation?: number;
    mean?: number;
}

/**
 * Test context configuration for unit/integration tests. Looser than `Context`
 * by design — tests routinely attach ad-hoc fixtures, so the index signature stays.
 */
export interface TestContext {
    config: Dungeon;
    storage: Storage | null;
    defaults: Defaults;
    campaigns: Record<string, ValueValid>[];
    runtime: RuntimeState;
    [key: string]: unknown;
}

// ── Subpath module declarations ──

declare module '@ak--47/dungeon-master/hook-helpers' {
    export function binUsersByEventCount(events: EventSchema[], eventName: string, bins: Record<string, [number, number]>): string;
    export function binUsersByEventInRange(events: EventSchema[], eventName: string, startTime: number | string, endTime: number | string, bins: Record<string, [number, number]>): string;
    export function countEventsBetween(events: EventSchema[], eventA: string, eventB: string): number;
    export function userInProfileSegment(profile: Record<string, unknown>, segmentKey: string, segmentValues: unknown[]): boolean;
    export function cloneEvent(template: EventSchema, overrides?: Partial<EventSchema>): EventSchema;
    export function dropEventsWhere(events: EventSchema[], predicate: (event: EventSchema) => boolean): number;
    export function scaleEventCount(events: EventSchema[], eventName: string, factor: number): void;
    export function scalePropertyValue(events: EventSchema[], predicate: (event: EventSchema) => boolean, propertyName: string, factor: number): void;
    export function shiftEventTime(event: EventSchema, deltaMs: number): EventSchema;
    export function scaleTimingBetween(events: EventSchema[], eventA: string, eventB: string, factor: number): void;
    export function scaleFunnelTTC(funnelEvents: EventSchema[], factor: number): void;
    export function findFirstSequence(events: EventSchema[], eventNames: string[], maxGapMin?: number): EventSchema[] | null;
    export function injectAfterEvent(events: EventSchema[], sourceEvent: EventSchema, templateEvent: EventSchema, gapMs: number, overrides?: Partial<EventSchema>): void;
    export function injectBetween(events: EventSchema[], eventA: EventSchema, eventB: EventSchema, templateEvent: EventSchema, overrides?: Partial<EventSchema>): void;
    export function injectBurst(events: EventSchema[], templateEvent: EventSchema, count: number, anchorTime: number | string, spreadMs: number): void;
    export function isPreAuthEvent(event: EventSchema, authTime: number | null): boolean;
    export function splitByAuth(events: EventSchema[], authTime: number | null): { preAuth: EventSchema[]; postAuth: EventSchema[]; stitch: EventSchema | null };
}

declare module '@ak--47/dungeon-master/hook-patterns' {
    export function applyFrequencyByFrequency(events: EventSchema[], profile: Record<string, unknown> | null, opts: { cohortEvent: string; bins: Record<string, [number, number]>; targetEvent: string; multipliers: Record<string, number> }): void;
    export function applyFunnelFrequencyBreakdown(allUserEvents: EventSchema[], profile: Record<string, unknown> | null, funnelEvents: EventSchema[], opts: { cohortEvent: string; bins: Record<string, [number, number]>; dropMultipliers: Record<string, number> }): void;
    export function applyAggregateByBin(events: EventSchema[], profile: Record<string, unknown> | null, opts: { cohortEvent: string; bins: Record<string, [number, number]>; event: string; propertyName: string; deltas: Record<string, number> }): void;
    export function applyTTCBySegment(funnelEvents: EventSchema[], profile: Record<string, unknown>, opts: { segmentKey: string; factors: Record<string, number> }): void;
    export function applyAttributedBySource(events: EventSchema[], profile: Record<string, unknown> | null, opts: { sourceEvent: string; sourceProperty: string; downstreamEvent: string; weights: Record<string, number>; model?: 'firstTouch' | 'lastTouch' }): void;
}

declare module '@ak--47/dungeon-master/verify' {
    export function emulateBreakdown(events: EventSchema[], config: EmulateOptions): Array<Record<string, unknown>>;
    export function verifyDungeon(config: Dungeon, checks: Array<{ name: string; breakdown: EmulateOptions; assert: (rows: Array<Record<string, unknown>>, ctx: { events: EventSchema[]; profiles: UserProfile[] }) => { pass: boolean; detail?: string } }>): Promise<{ pass: boolean; results: Array<{ name: string; pass: boolean; detail?: string; rows?: Array<Record<string, unknown>> }> }>;
}

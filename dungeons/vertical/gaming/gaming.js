// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, cloneEvent } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       Emberfall (by Cinderlight Games)
 * APP:        Free-to-play fantasy action RPG on PC (Windows, macOS, Linux via
 *             the Emberfall launcher) and mobile (iOS, iPadOS, Android), with
 *             cross-play and one account across devices. Players make a hero
 *             (tank, healer, or damage role), finish a tutorial, then run
 *             five-player dungeons (matchmade, premade, or solo), push through
 *             the story campaign and its four chapter bosses, fight in the
 *             arena, craft gear, and join guilds. Revenue: Ember packs (premium
 *             currency, $0.99-$99.99), the Adventurer's Bundle ($14.99), and a
 *             seasonal Ember Pass ($9.99). Three server regions: NA, EU, APAC.
 * SCALE:      10,000 simulated players (≈4,500 create an account inside the
 *             window; ≈40% of those never finish the tutorial and leave), ~1.02M
 *             events, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  game launched → quest completed / dungeon queued → dungeon started
 *             → dungeon finished → item crafted → store opened → purchase completed
 * VALUE MOMENT: dungeon finished (result = cleared)
 *
 * EVENTS (19):
 *   game launched > quest completed > dungeon started > dungeon finished
 *   > chat message sent > item crafted > arena match > boss fight > store opened
 *   > dungeon queued > level up > friend added > purchase completed > guild joined
 *   > account created > character created > tutorial started > $experiment_started
 *   > tutorial completed
 *
 * FUNNELS (6 declared):
 *   - Onboarding (first funnel, two copies by acquisition_channel, H1/H5):
 *       account created → character created → tutorial started → tutorial
 *       completed (60%; TikTok 36%), carries the "First Flame Tutorial"
 *       experiment (Guided: completion x1.25, step time x0.7, from 2026-07-08)
 *   - Play session (weight 9): game launched → quests, chat, crafting, store (first-fixed)
 *   - Dungeon run (weight 10): dungeon queued → dungeon started → dungeon
 *       finished (100%; the hook decides queue type, party, wait, and result)
 *   - Campaign session (weight 4): game launched → quests and boss fights
 *   - Arena session (weight 3): game launched → arena matches
 *
 * USER PROPS:  server_region, acquisition_channel, main_role, main_class,
 *              account_level, member_since, in_guild, total_spend_usd,
 *              "Experiment: First Flame Tutorial"
 * SUPER PROPS: platform (pc / ios / android, from the device OS of the event),
 *              server_region (sticky per player)
 * SCD PROPS:   none
 * GROUPS:      none (guild_id is an event property on "guild joined")
 * WAREHOUSE:   ua_spend_daily (paid acquisition spend by channel),
 *              server_health_daily (peak concurrent players, instance launch
 *              success, uptime, queue time, incidents by region),
 *              store_revenue_daily (gross bookings, refunds, store fees, net
 *              revenue by platform and product type)
 * LOOKUPS:     none; every attribute is denormalized onto events/profiles
 * SOUP:        weekend-heavy dayOfWeekWeights; three regional evening peaks in
 *              hourOfDayWeights (UTC)
 *
 * IDENTITY: a new player is identified at "account created" (isAuthEvent,
 * user_id + device_id); it is the first event except for test players, whose
 * $experiment_started sits 1 s earlier with the same user_id and device_id.
 * Players use 1-2 devices (avgDevicePerUser 1.3); every event in a play session
 * carries the device of the session's first device-bearing event, so each
 * Mixpanel session (session_id) has one device. Every event carries user_id;
 * there is no anonymous pre-signup activity. The three onboarding steps after
 * signup carry user_id only; every other event also carries device_id (a client
 * event built from a device-less onboarding step takes the signup device).
 * platform agrees with the engine's os field (iOS/iPadOS → ios, Android →
 * android, else pc). session_id is the engine's Mixpanel-rule session (30 idle
 * minutes or a UTC day change); a play session that runs past midnight UTC is
 * two Mixpanel sessions, and the second has no "game launched".
 *
 * DESIGN NOTES:
 * - Sessions: the hook chains a day's activity units (a dungeon run with its
 *   queue, or a burst of quests / boss fights / arena matches) into sessions of
 *   2-5 units on one device, folds standalone actions (chat, crafting, friends,
 *   level ups, store visits, later guild joins) into the same day's sessions,
 *   and starts every session with one "game launched" (client_version 4.0.1 →
 *   4.0.2 on Jul 23 → 4.1.0 on Aug 6). A session ends after 30 idle minutes
 *   (it can cross midnight); during a queue wait or a run longer than 30
 *   minutes the player chats (world chat in a queue or solo, party chat in a
 *   group) every 12-26 minutes, so the session never idles out mid-run. A new
 *   player's first session starts at "account created".
 * - Dungeon runs: one run_id per run. Queue type matchmade 55% (party of 5,
 *   queued by role, H6), premade 30% (2-5 players), solo 15%. Result by party
 *   size (H10, salted per run_id) and difficulty: cleared, else wiped (75%)
 *   or abandoned. Difficulty depends on the persona (core players run more
 *   heroic and mythic) and scales the clear chance (normal x1.08, heroic
 *   x0.97, mythic x0.78, normalized so the run mix averages 1; difficulty does
 *   not depend on party size, so H10 keeps its knobs). Duration and XP follow
 *   the result and difficulty. Clear rate has no platform, region, or patch
 *   input (the Q13 / Q14 nulls); a weak balancing term (gain 0.008) pulls each
 *   platform x party size x difficulty x region x patch-period stratum toward
 *   its target, leaving binomial-like noise in the splits.
 *   A player is in one dungeon at a time: a run that would queue or start
 *   before the previous run finishes moves to 1-4 minutes after it (or is
 *   dropped if that crosses the UTC day); Double XP extra runs queue after
 *   the previous finish.
 * - New players: quests, boss fights, arena matches, and dungeon runs only
 *   happen after "tutorial completed". tutorial_minutes is the real time from
 *   the last "tutorial started" to "tutorial completed"; tutorial length has a
 *   per-player log-normal spread (sigma 0.35) and a slow tail (12% of players
 *   step away and take 1.5-4.5x as long), the same draw in both test arms.
 * - New players: tutorial non-finishers keep only their setup steps (first
 *   visit); 12% of them (salted) come back for one or two sessions 18-68 h
 *   after signup (game launched, often a retried tutorial started) and still
 *   leave. Finishers have a natural lifespan (Pareto, P(still playing after d
 *   days) = (3/d)^0.45) on top of the H2 guild effect.
 * - Purchases: 10% of veterans and 4% of new players are payers (x2 for the
 *   most active players, x0.35 for casual ones; x1.4 for players whose home
 *   device is a phone or tablet, x0.88 on PC: one-tap store billing converts
 *   more mobile players). A payer buys on a share of
 *   their play days (0.45 on average, varying per payer); each purchase follows
 *   a store visit. Pack choice depends on the platform of the purchase device,
 *   resolved after sessions settle each event's device (H7). Payers active after
 *   Aug 6 buy the Season 4 Ember Pass at 55% in their first session; a few buy
 *   the Season 3 pass late in June / early July.
 * - Warehouse drift: store_revenue_daily adds purchases Mixpanel never
 *   received (mean 12% of tracked count; a skewed 0-48% share per day, shared
 *   by every store) and refunds (unbiased mean 3% of tracked count); every
 *   extra or refunded item is a real list price (a pack drawn from the
 *   platform's pack mix, the bundle, or the pass);
 *   server_health_daily peak concurrency is ~22% of the day's active players
 *   with ±12% noise; ua_spend_daily is a half paced budget (weekday shape,
 *   never zero) and half bid x the day's delivered signups, with seeded noise.
 * - retentionCurve (day 1 / 7 / 30 = 0.50 / 0.30 / 0.16) shapes new players'
 *   activity; veterans' activity is flat across the window except for H8.
 *   Personas: hardcore 20% (x2.5 events), regular 50% (x1.4), casual 30% (x0.7).
 * - guild_size on "guild joined" is the guild's roster right after the join: a
 *   per-guild base that grows or shrinks at a per-guild daily rate, with a
 *   ±1 day wobble, capped at 50.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. FIRST FLAME GUIDED TUTORIAL TEST (Onboarding first-funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 new players split 50/50 at account creation.
 *   Guided multiplies tutorial completion by 1.25 (60% → 75%, TikTok 36% →
 *   45%), and its onboarding steps take 0.7x as long (ttcMultiplier), so
 *   tutorial_minutes is shorter. Non-finishers leave within 3 days, so the
 *   lift carries into retention.
 * MIXPANEL: Funnels, account created → tutorial completed, 7-day window, date
 *   range Jul 8 - Oct 1, breakdown "Experiment: First Flame Tutorial" (or the
 *   Experiments report on $experiment_started).
 * REAL WORLD: a shorter first hour keeps more new players.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. EARLY GUILD RETENTION (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 35% of tutorial finishers join a guild within 72 h (salted); 45%
 *   of the rest quit on day 4-12. Day 14-27 return: no guild / guild = 0.55.
 * MIXPANEL: Retention, birth account created, return game launched, custom
 *   bracket day 14-27, cohort of tutorial finishers split by funnel converters
 *   account created → guild joined within 72 hours.
 * REAL WORLD: social ties are the strongest predictor of staying in an MMO.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. ASHEN WARDEN REBALANCE (everything; patch 4.0.2, 2026-07-23)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: chapter 3 boss win rate per attempt 30% → 50%; the other three
 *   bosses unchanged.
 * MIXPANEL: Insights, boss fight (result = victory) / boss fight, breakdown
 *   boss_name, weekly.
 * REAL WORLD: a difficulty wall that the design team tunes down.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. EU INSTANCE OUTAGE (everything + warehouse server_health_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-12 to 2026-09-14, 60% of EU dungeon launches fail (queue
 *   event stays, no start or finish); EU matchmade waits run x4.5 (the group
 *   finder retries launches). Warehouse: incident_severity = sev1,
 *   instance_launch_success_rate ≈ 0.40, uptime ~40-50%, avg_queue_seconds x4.5.
 * MIXPANEL: Insights, dungeon started, daily, breakdown server_region; EU /
 *   other on outage days vs 14 days either side; join the warehouse status.
 * REAL WORLD: a regional infrastructure failure looks like "EU stopped playing".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. PAID CHANNEL ECONOMICS (first funnels + warehouse ua_spend_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $2.5 TikTok, $4.5 Meta, $5.5 Google,
 *   $7 YouTube creators; TikTok signups finish the tutorial at 0.6x, so spend
 *   per tutorial finisher TikTok / Meta ≈ 0.93.
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   ua_spend_daily.spend_usd; Funnels, account created → tutorial completed,
 *   7-day window, breakdown acquisition_channel.
 * REAL WORLD: the cheapest installs often never get through onboarding.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. QUEUE TIME BY ROLE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: matchmade wait (dungeon queued → dungeon started) median 300 s for
 *   damage dealers, x0.4 healers, x0.2 tanks.
 * MIXPANEL: Funnels, dungeon queued → dungeon started, Totals, hold run_id
 *   constant, median time to convert, breakdown main_role.
 * REAL WORLD: the classic tank / healer shortage in group finders.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. PC PACK MIX AND STORE FEES (everything + warehouse store_revenue_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: pack weights by platform give an average Ember pack of $16.27 on
 *   PC vs $8.77 on mobile (x1.855); the app stores take 15% (Apple Small
 *   Business Program, Google Play's reduced tier), the PC webshop 5%, so
 *   warehouse net per Mixpanel Ember purchase is x2.073 on PC.
 * MIXPANEL: Insights, purchase completed (product_type = embers), average
 *   price_usd by platform; join store_revenue_daily.net_revenue_usd.
 * REAL WORLD: PC players buy bigger packs and the platform keeps less.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. SEASON 4 BRINGS VETERANS BACK (everything; 2026-08-06)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 35% of veterans are lapsed (play on 12% of their would-be days);
 *   60% of them return in the first 7 days of Season 4 and play fully. Veteran
 *   DAU Aug 13 - Sep 9 / Jul 9 - Aug 5 = 1.267. Frostspire Vault exists only
 *   from launch (35% of runs after).
 * MIXPANEL: Insights, game launched uniques, daily, cohort "did not do account
 *   created in the window".
 * REAL WORLD: new seasons reactivate lapsed players more than they acquire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. DOUBLE XP WEEKEND (everything; 2026-08-21 to 2026-08-23)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: xp_multiplier = 2 and an extra run after each run with p = 0.6:
 *   dungeon runs per active player x1.6; DAU unchanged.
 * MIXPANEL: Insights, dungeon started (total) / game launched (uniques), daily.
 * REAL WORLD: XP events deepen play from existing players more than they
 *   bring players in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. PARTY SIZE CLEAR RATE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: cleared share by party_size 0.40 / 0.50 / 0.58 / 0.64 / 0.70.
 * MIXPANEL: Insights, dungeon finished (result = cleared) / dungeon finished,
 *   breakdown party_size.
 * REAL WORLD: dungeons are tuned for groups; solo players struggle.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-gaming, 2026-10-07, full
 * fidelity, 10,000 players, 1,018,299 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation                    | Expected | Measured
 * -----|------------------------------------------------|-------------------------------|----------|---------
 * H1   | tutorial completion, Guided / Control          | GUIDED_CONV_MULT              | 1.25     | 1.290 (54.6% → 70.5%)
 * H1   | Guided share of exposed players                | equal 2-arm hash              | 0.50     | 0.511
 * H1   | guided completions in Control / early exposures| exact purity                  | 0        | 0
 * H1   | median tutorial_minutes, Guided / Control      | GUIDED_TTC_MULT               | 0.70     | 0.696 (5.5 vs 7.9 min)
 * H2   | day 14-27 return, no guild / guild (finishers) | 1 − NONJOINER_QUIT_SHARE (≤, floor 0.775) | 0.55 | 0.538 (24.2% vs 45.0%)
 * H3   | Ashen Warden win rate, after / before          | 0.50 / 0.30                   | 1.667    | 1.672 (29.9% → 50.0%)
 * H3   | other bosses' win rate, after / before         | unchanged                     | 1.00     | 0.997
 * H4   | EU / other dungeon starts, outage / ±14 d      | 1 − OUTAGE_FAIL (≤, floor 0.7)| 0.40     | 0.437 (per-queue start rate 0.41)
 * H4   | warehouse instance_launch_success_rate, outage | 1 − OUTAGE_FAIL               | 0.40     | 0.397
 * H4   | EU median queue wait, outage / normal days     | OUTAGE_QUEUE_MULT (not graded)| 4.5      | 4.99 (1,087 s vs 218 s)
 * H5   | spend per signup, TikTok / Google              | 2.5 / 5.5                     | 0.455    | 0.449 ($2.47 vs $5.51)
 * H5   | tutorial completion, TikTok / other channels   | 36 / 60                       | 0.60     | 0.613 (40.6% vs 66.3%)
 * H5   | spend per tutorial finisher, TikTok / Meta     | (2.5 / 0.6) / 4.5             | 0.926    | 0.923 ($6.08 vs $6.59)
 * H6   | median queue wait, healer / dps                | ROLE_QUEUE_MULT.healer        | 0.40     | 0.403 (120 s vs 298 s)
 * H6   | median queue wait, tank / dps                  | ROLE_QUEUE_MULT.tank          | 0.20     | 0.205 (61 s)
 * H7   | average Ember pack price, PC / mobile          | pack weights                  | 1.855    | 2.036 ($16.55 vs $8.13)
 * H7   | warehouse net per Mixpanel Ember purchase, PC / mobile | 1.855 × 0.95 / 0.85   | 2.073    | 2.283 ($16.72 vs $7.32)
 * H8   | veteran DAU, Aug 13 - Sep 9 / Jul 9 - Aug 5     | (1−L+L(R+(1−R)k)) / (1−L+Lk)  | 1.267    | 1.290 (520 → 671)
 * H8   | Frostspire Vault runs before Aug 6             | exact purity                  | 0        | 0
 * H9   | dungeon runs per active player, event / ±1 week| 1 + DOUBLE_XP_EXTRA           | 1.60     | 1.626 (1.96 vs 1.20)
 * H10  | clear rate, solo / full party                  | 0.40 / 0.70                   | 0.571    | 0.570 (39.8% vs 69.9%)
 * H10  | clear rate, duo / full party                   | 0.50 / 0.70                   | 0.714    | 0.712
 * H10  | clear rate, mythic / normal (not graded)       | 0.78 / 1.08                   | 0.722    | 0.719 (48.5% vs 67.4%)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H2 rests on about 315 and 330 retained players (700 joiners,
 * 1,368 non-joiners; relative SE of the ratio about 8%), so it uses the knob
 * as target with a half-effect floor; it reads 0.538 (NAILED). H4's event read
 * rests on 457 EU starts on outage days (565 EU matchmade queues; per-queue
 * start rate 0.41 vs 0.40), so it uses the knob as target with a half-effect
 * floor. H7 rests on 2,354 mobile and 1,387 PC Ember purchases (477 and 308
 * buyers; ratio SE about 4.3%). Mobile drew few $99.99 packs (11 vs about 24
 * expected), so the mobile average sits about 2.4 SE low ($8.13 vs $8.77) and
 * both H7 reads land high: the pack ratio 2.036 is NAILED near the band top and
 * the net ratio 2.283 sits just past it (STRONG). Payers are 9.0% of active
 * players (veterans 11.5%, new players 4.0%). New-player day 1 / 7 / 30
 * retention is 30.1% / 11.2% / 3.4% (tutorial finishers 43.2% / 18.7% / 5.6%).
 * The hook thins events (non-finishers, lapsed veterans, H2 quits, lifespans)
 * and keeps one "game launched" per session, so the run has ~1.02M events
 * against the standard's approximate 1.4M at 1.2 events per player-day. The
 * engine and the hook share one seeded stream, so any change in hook draws
 * reshuffles later players. The Q13 / Q14 nulls rest on a weak clear-rate
 * balancing term (gain 0.008) on top of the design (clear rate has no
 * platform, region, or patch input). On this final data the overall reads are
 * |z| 0.01 (Q13) and 0.40 (Q14); the largest sub-split is Q13's 3-player split
 * (|z| 1.45, p ≈ 0.15; the balancing stratum uses the run's device before
 * sessions settle devices); every other split is |z| ≤ 0.70.
 */

// ── SCALE ──
const SEED = "questforge";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const TUTORIAL_TEST_START = "2026-07-08T00:00:00Z"; // "First Flame" guided tutorial A/B test starts for new players
const PATCH_402 = "2026-07-23T00:00:00Z";           // patch 4.0.2: Ashen Warden (chapter 3 boss) rebalance
const SEASON4_LAUNCH = "2026-08-06T00:00:00Z";      // Season 4 "Frostbound": new Ember Pass + Frostspire Vault dungeon (client 4.1.0)
const DOUBLE_XP_START = "2026-08-21T00:00:00Z";     // Double XP weekend (Fri-Sun)
const DOUBLE_XP_END = "2026-08-24T00:00:00Z";       // exclusive
const EU_OUTAGE_START = "2026-09-12T00:00:00Z";     // EU instance-server outage (Sat-Mon)
const EU_OUTAGE_END = "2026-09-15T00:00:00Z";       // exclusive (3 days: Sep 12-14)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Players have the most free time on weekends; Friday evening starts it.
const DOW_WEIGHTS = [1.22, 0.92, 0.88, 0.9, 0.94, 1.06, 1.28];
// UTC hours. Three server regions play in their evenings: North America
// (19-23 local = 00-06 UTC), Europe (18-23 local = 16-22 UTC), Asia-Pacific
// (19-23 local = 10-14 UTC).
const HOUR_WEIGHTS = [1.0, 1.0, 0.95, 0.85, 0.7, 0.55, 0.42, 0.35, 0.33, 0.36, 0.45, 0.52,
	0.55, 0.55, 0.52, 0.55, 0.65, 0.78, 0.88, 0.95, 0.98, 0.96, 0.92, 0.95];

// ── KNOBS ──
// H1 "First Flame" guided tutorial experiment (new players from TUTORIAL_TEST_START)
const TUTORIAL_EXPERIMENT = "First Flame Tutorial";
const TUTORIAL_VARIANT = "Guided";
const EXP_KEY = `Experiment: ${TUTORIAL_EXPERIMENT}`;
const TUTORIAL_CONV = 60;          // % of new players who finish the classic tutorial
const GUIDED_CONV_MULT = 1.25;     // guided tutorial completion multiplier
const GUIDED_TTC_MULT = 0.7;       // the guided tutorial is shorter: onboarding steps take 0.7x as long (tutorial_minutes = the real started → completed gap)
const TUTORIAL_SPREAD = 0.35;      // per-player log-normal spread of tutorial length
const TUTORIAL_SLOW_SHARE = 0.12;  // players who step away mid-tutorial (x1.5-4.5 as long)
const NONCOMPLETER_HOURS = 48;     // players who never finish the tutorial do their first-visit activity within 2 days
const NF_RETURN_SHARE = 0.12;      // share of non-finishers who come back once or twice on day 1-2 (salted), retry the tutorial, then leave
const NF_RETURN_FROM_H = 18;       // first return session 18-44 h after signup
const NF_RETURN_TO_H = 44;

// H2 guild in the first 72 hours (new players who finished the tutorial)
const GUILD_WINDOW_H = 72;
const GUILD_JOIN_SHARE = 0.35;     // share of tutorial finishers who join a guild within 72 h (salted per player)
const NONJOINER_QUIT_SHARE = 0.45; // share of players without an early guild who quit on day 4-12
const QUIT_DAY_MIN = 4;
const QUIT_DAY_MAX = 12;
const GUILD_COUNT = 320;
const GUILD_CAP = 50;              // guild member cap
// realism: new players' natural lifespan, Pareto: P(still playing after d days) = (LIFE_D0 / d)^LIFE_ALPHA
const LIFE_D0 = 3;
const LIFE_ALPHA = 0.45;

// H3 Ashen Warden rebalance (patch 4.0.2)
const WARDEN = "Ashen Warden";
const WARDEN_WIN_BEFORE = 0.30;
const WARDEN_WIN_AFTER = 0.50;
const BOSSES = {
	"Gravemaw": { chapter: 1, win: 0.72, w: 26 },
	"Hollow Matron": { chapter: 2, win: 0.6, w: 25 },
	[WARDEN]: { chapter: 3, win: null, w: 27 },
	"Cinder King": { chapter: 4, win: 0.42, w: 22 },
};

// H4 EU outage (warehouse server_health_daily)
const OUTAGE_REGION = "EU";
const OUTAGE_FAIL = 0.6;           // share of EU dungeon launches that fail during the outage
const OUTAGE_QUEUE_MULT = 4.5;     // EU matchmade waits during the outage (the group finder retries a launch until an instance opens)

// H5 paid acquisition (warehouse ua_spend_daily) + tutorial completion by channel
const PAID_CHANNELS = ["tiktok_ads", "meta_ads", "google_ads", "youtube_creators"];
const CPI_USD = { tiktok_ads: 2.5, meta_ads: 4.5, google_ads: 5.5, youtube_creators: 7 }; // window spend per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 32, tiktok_ads: 22, meta_ads: 16, google_ads: 14, youtube_creators: 16 };
const TIKTOK_TUTORIAL_MULT = 0.6;  // TikTok signups finish the tutorial at 0.6x the rate of every other channel
const BORN_PCT = 45;
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPI_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.4;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const SPEND_PLAN_SHARE = 0.5;      // half of a day's spend is the paced budget, half is bid x delivered installs
const PLATFORM_INSTALL_INFLATION = 1.2;
const CPC_USD = { tiktok_ads: 0.7, meta_ads: 1.1, google_ads: 1.3, youtube_creators: 0.9 };
const CTR = { tiktok_ads: 0.009, meta_ads: 0.012, google_ads: 0.03, youtube_creators: 0.02 };

// H6 matchmaking queue time by role
const QUEUE_MEDIAN_S = 300;        // median wait for a damage dealer
const QUEUE_SIGMA = 0.6;
const ROLE_QUEUE_MULT = { tank: 0.2, healer: 0.4, dps: 1 };

// H7 store: pack mix by platform; store fees (warehouse store_revenue_daily)
const GEM_PACKS = [
	{ price: 0.99, embers: 100 }, { price: 4.99, embers: 550 }, { price: 9.99, embers: 1200 },
	{ price: 19.99, embers: 2500 }, { price: 49.99, embers: 6500 }, { price: 99.99, embers: 14000 },
];
const PACK_WEIGHTS = {
	mobile: [28, 36, 22, 10, 3, 1],
	pc: [8, 24, 32, 24, 10, 2],
};
const AVG_PACK_PRICE = Object.fromEntries(Object.entries(PACK_WEIGHTS).map(([k, w]) => {
	const tot = w.reduce((a, b) => a + b, 0);
	return [k, w.reduce((s, wi, i) => s + wi * GEM_PACKS[i].price, 0) / tot];
}));
const STORE_FEE = { ios: 0.15, android: 0.15, pc: 0.05 }; // Apple Small Business Program and Google Play's reduced tier take 15%; the PC launcher webshop pays 5% processing
const BUNDLE_SHARE = 0.15;
const BUNDLE = { product: "Adventurer's Bundle", price: 14.99, embers: 1500 };
const EMBER_PASS_PRICE = 9.99;
const PAYER_SHARE_EXISTING = 0.10;
const PAYER_SHARE_NEW = 0.04;
const PURCHASE_PER_DAY = 0.45;     // average chance a payer buys something on a day they play
const PAYER_PERSONA_MULT = { hardcore: 2, regular: 0.95, casual: 0.35 }; // committed players pay more often (mix average ≈ 1)
const PAYER_STORE_MULT = { mobile: 1.4, pc: 0.88 }; // one-tap app store billing converts more mobile-first players into payers (mix average ≈ 1)
const PASS_BUY_SHARE = 0.55;       // payers active after Season 4 who buy the new pass
const PASS3_TRICKLE_SHARE = 0.12;  // payers who buy the Season 3 pass late (June / early July)
const UNTRACKED_PURCHASE_SHARE = 0.12; // billing: purchases Mixpanel never received, mean share of tracked purchases (skewed 0-48% by day, shared by every store)
const REFUND_SHARE = 0.03;         // billing: refunds, mean share of tracked purchases

// H8 Season 4 brings lapsed veterans back (players who joined before the window)
const LAPSED_SHARE = 0.35;
const LAPSED_KEEP = 0.12;          // share of a lapsed veteran's would-be active days kept before they return
const RETURN_SHARE = 0.6;          // lapsed veterans who come back for Season 4
const RETURN_SPREAD_DAYS = 7;
const NEW_DUNGEON = "Frostspire Vault";
const NEW_DUNGEON_SHARE = 0.35;    // share of runs after launch in the new dungeon

// H9 Double XP weekend
const DOUBLE_XP_EXTRA = 0.6;       // each run in the window brings an extra run with this probability

// H10 dungeon clear rate by party size
const CLEAR_RATE = { 1: 0.40, 2: 0.50, 3: 0.58, 4: 0.64, 5: 0.70 };
const CLEAR_BALANCE_GAIN = 0.008;  // weak per-stratum balancing: realized clears drift like binomial data but stay near the knob
const QUEUE_TYPE_WEIGHTS = { matchmade: 55, premade: 30, solo: 15 };
const PREMADE_SIZE_WEIGHTS = { 2: 30, 3: 30, 4: 20, 5: 20 };

// ── DATA ──
const weighted = (obj) => Object.entries(obj).flatMap(([k, w]) => Array(w).fill(isNaN(Number(k)) ? k : Number(k)));
const REGIONS = { NA: 45, EU: 35, APAC: 20 };
const ROLE_WEIGHTS = { dps: 68, healer: 18, tank: 14 };
const CLASSES = {
	tank: ["Bulwark", "Ironclad"],
	healer: ["Lightweaver", "Grovekeeper"],
	dps: ["Pyromancer", "Ranger", "Shadowblade", "Stormcaller"],
};
const DUNGEONS = ["Emberdeep Mines", "Sunken Reliquary", "Ashen Catacombs", "Thornwild Hollow"];
const DIFFICULTY_WEIGHTS = { normal: 55, heroic: 33, mythic: 12 };
// core players run harder content; casual players stay on normal
const DIFFICULTY_BY_PERSONA = {
	hardcore: { normal: 30, heroic: 45, mythic: 25 },
	regular: DIFFICULTY_WEIGHTS,
	casual: { normal: 76, heroic: 21, mythic: 3 },
};
const BASE_XP = { normal: 1200, heroic: 2000, mythic: 3200 };
// harder tiers clear less often; normalized so the run-weighted mix averages 1 and
// each party size keeps its CLEAR_RATE knob (difficulty does not depend on party size)
const DIFFICULTY_CLEAR_RAW = { normal: 1.08, heroic: 0.97, mythic: 0.78 };
const PERSONAS = [
	{ name: "hardcore", weight: 20, eventMultiplier: 2.5 },
	{ name: "regular", weight: 50, eventMultiplier: 1.4 },
	{ name: "casual", weight: 30, eventMultiplier: 0.7 },
];
const PERSONA_RUN_WEIGHT = Object.fromEntries(PERSONAS.map((p) => [p.name, p.weight * p.eventMultiplier]));
const DIFFICULTY_CLEAR_MULT = (() => {
	const mix = { normal: 0, heroic: 0, mythic: 0 };
	let tot = 0;
	for (const [p, pw] of Object.entries(PERSONA_RUN_WEIGHT)) {
		const w = DIFFICULTY_BY_PERSONA[p];
		const wt = Object.values(w).reduce((a, b) => a + b, 0);
		for (const d of Object.keys(mix)) mix[d] += pw * w[d] / wt;
		tot += pw;
	}
	const norm = Object.keys(mix).reduce((s, d) => s + mix[d] / tot * DIFFICULTY_CLEAR_RAW[d], 0);
	return Object.fromEntries(Object.keys(mix).map((d) => [d, DIFFICULTY_CLEAR_RAW[d] / norm]));
})();
const CLIENT_VERSIONS = [[ms(SEASON4_LAUNCH), "4.1.0"], [ms(PATCH_402), "4.0.2"], [0, "4.0.1"]];
const GAME_LAUNCHED = "game launched";
const ONBOARDING = new Set(["account created", "character created", "tutorial started", "tutorial completed"]);
const RUN_STEPS = ["dungeon queued", "dungeon started", "dungeon finished"];
const SESSION_GAP_MS = 30 * MIN_MS;
const MERGE_MAX_GAP = 4 * HOUR_MS;
const DEVICE_FIELDS = ["device_id", "model", "screen_height", "screen_width", "os", "carrier", "radio"];
// onboarding steps the game server sends with user_id only
const SERVER_ONLY = new Set(["character created", "tutorial started", "tutorial completed"]);
const FOLDABLE = new Set(["chat message sent", "item crafted", "friend added", "level up", "store opened", "purchase completed", "guild joined"]);

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byT = (a, b) => T(a) - T(b);
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const pickWeighted = (obj, r) => {
	const entries = Object.entries(obj);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let acc = 0;
	for (const [k, w] of entries) {
		acc += w / total;
		if (r < acc) return k;
	}
	return entries[entries.length - 1][0];
};
const pickIndex = (weights, r) => {
	const total = weights.reduce((a, b) => a + b, 0);
	let acc = 0;
	for (let i = 0; i < weights.length; i++) {
		acc += weights[i] / total;
		if (r < acc) return i;
	}
	return weights.length - 1;
};
const rnd = () => chance.random();
const platformOf = (os) => (os === "iOS" || os === "iPadOS" ? "ios" : os === "Android" ? "android" : "pc");
const storeOf = (platform) => (platform === "pc" ? "pc" : "mobile");
const inOutage = (t) => t >= ms(EU_OUTAGE_START) && t < ms(EU_OUTAGE_END);
const inDoubleXp = (t) => t >= ms(DOUBLE_XP_START) && t < ms(DOUBLE_XP_END);
const clientVersion = (t) => CLIENT_VERSIONS.find(([from]) => t >= from)[1];
const bossWin = (boss, t) => (boss === WARDEN ? (t >= ms(PATCH_402) ? WARDEN_WIN_AFTER : WARDEN_WIN_BEFORE) : BOSSES[boss]?.win ?? 0.5);
// guild roster size right after a join: a per-guild base that grows or shrinks
// at a per-guild daily rate (joins minus leavers), plus a day-level wobble
const guildSize = (gid, t) => {
	const days = (t - ms(DATASET_START)) / DAY_MS;
	const base = 8 + hashFloat(`gsize|${gid}`) * 34;
	const drift = (hashFloat(`gdrift|${gid}`) - 0.3) * 0.16;
	const wobble = Math.floor(hashFloat(`gwob|${gid}|${dayKey(t)}`) * 3) - 1;
	return Math.max(5, Math.min(GUILD_CAP, Math.round(base + drift * days) + wobble));
};
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPI_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
const expectedQueueSeconds = (() => {
	const tot = Object.values(ROLE_WEIGHTS).reduce((a, b) => a + b, 0);
	const meanLn = Math.exp(QUEUE_SIGMA * QUEUE_SIGMA / 2);
	return Object.entries(ROLE_WEIGHTS).reduce((s, [r, w]) => s + w / tot * QUEUE_MEDIAN_S * ROLE_QUEUE_MULT[r] * meanLn, 0);
})();

// per-run clear-rate balance counters, keyed by the run's resolved config (deterministic per run)
const CLEAR_BAL = new WeakMap();
const clearBalance = (cfg, key) => {
	if (!CLEAR_BAL.has(cfg)) CLEAR_BAL.set(cfg, new Map());
	const m = CLEAR_BAL.get(cfg);
	if (!m.has(key)) m.set(key, { n: 0, c: 0 });
	return m.get(key);
};

// an Ember purchase's pack draw (a uniform); finish() turns it into a pack once the
// purchase's device (and so its platform) is final
const PACK_R = new WeakMap();

// events a later pass must not move (the H2 early guild join)
const PINNED = new WeakSet();
const pin = (...args) => { const ev = morph(...args); PINNED.add(ev); return ev; };

// event-specific property keys, from the schema (used to re-type a cloned event)
let EVENT_PROPS = {};
// the current player's signup device (set per player in handleEverything)
let HOME_DEV = null;

/**
 * A new event of type `name` built from one of the player's own events `src`
 * (keeps identity, device, session, and super props), with `src`'s
 * event-specific properties removed and `props` applied. Fresh insert_id.
 */
function morph(src, name, time, props = {}) {
	const ev = cloneEvent(src, { time: iso(time) });
	for (const k of EVENT_PROPS[src.event] || []) delete ev[k];
	ev.event = name;
	Object.assign(ev, props);
	// server-side onboarding steps carry no device; a client event built from
	// one of them takes the player's signup device (the session it belongs to)
	if (SERVER_ONLY.has(name)) for (const k of DEVICE_FIELDS) delete ev[k];
	else if (!ev.device_id && HOME_DEV) for (const k of DEVICE_FIELDS) if (HOME_DEV[k] !== undefined) ev[k] = HOME_DEV[k];
	return ev;
}

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	profile.main_class = CLASSES[profile.main_role][Math.floor(salt(uid, "class") * CLASSES[profile.main_role].length)];
	if (meta.userIsBornInDataset) {
		profile.member_since = dayKey(dayjs.utc(profile.created ?? meta.user?.created).valueOf());
		profile.account_level = 1;
		profile.total_spend_usd = 0;
		profile.in_guild = false;
		return profile;
	}
	// veterans: Emberfall launched 2024-03-12
	const launch = ms("2024-03-12T00:00:00Z");
	const tenure = Math.floor(salt(uid, "tenure") * (ms(DATASET_START) - launch) / DAY_MS);
	profile.member_since = dayjs.utc(launch).add(tenure, "day").format("YYYY-MM-DD");
	profile.account_level = 12 + Math.floor(salt(uid, "level") * 40);
	profile.in_guild = salt(uid, "vet-guild") < 0.6;
	profile.total_spend_usd = salt(uid, "payer") < PAYER_SHARE_EXISTING * (PAYER_PERSONA_MULT[meta.persona?.name] ?? 1) ? round2(20 + salt(uid, "ltv") * 380) : 0;
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const born = meta.userIsBornInDataset;
	const region = profile.server_region;
	const role = profile.main_role;

	for (const e of events) e.platform = platformOf(e.os);

	const signup = events.find((e) => e.event === "account created") || null;
	const devSrc = signup?.device_id ? signup : events.find((e) => e.device_id);
	HOME_DEV = devSrc ? Object.fromEntries(DEVICE_FIELDS.map((k) => [k, devSrc[k]])) : null;
	const birthMs = signup ? T(signup) : null;
	const variant = profile[EXP_KEY] ?? null;

	// ── born players: tutorial (H1/H5 via the first funnels) ──
	const tc = events.find((e) => e.event === "tutorial completed") || null;
	if (born && tc && variant === TUTORIAL_VARIANT) tc.tutorial_version = "guided";
	// tutorial length varies by player (the same draw in both arms): a log-normal spread
	// and a slow tail of players who step away mid-tutorial
	if (born && tc) {
		const ts = events.filter((e) => e.event === "tutorial started" && T(e) <= T(tc)).map(T);
		if (ts.length) {
			const t0 = Math.max(...ts);
			const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, salt(uid, "tut-z1")))) * Math.cos(2 * Math.PI * salt(uid, "tut-z2"));
			let f = Math.exp(TUTORIAL_SPREAD * z);
			if (salt(uid, "tut-slow") < TUTORIAL_SLOW_SHARE) f *= 1.5 + 3 * salt(uid, "tut-slow-x");
			tc.time = iso(t0 + Math.round((T(tc) - t0) * f));
		}
	}
	// tutorial_minutes is the real time from the last "tutorial started" before the completion
	if (tc) {
		const ts = events.filter((e) => e.event === "tutorial started" && T(e) <= T(tc)).map(T);
		const t0 = ts.length ? Math.max(...ts) : (birthMs ?? T(tc));
		tc.tutorial_minutes = Math.round((T(tc) - t0) / MIN_MS * 10) / 10;
	}
	if (born && !tc) {
		// never finished the tutorial: the first visit only, then they leave
		const base = birthMs ?? T(events[0]);
		const lim = base + NONCOMPLETER_HOURS * HOUR_MS;
		events = events.filter((e) => (ONBOARDING.has(e.event) || e.event === "$experiment_started") && T(e) < lim);
		// some come back once or twice on day 1-2, often retry the tutorial, and still leave
		if (signup && salt(uid, "nf-return") < NF_RETURN_SHARE) {
			const hadTutorial = events.some((e) => e.event === "tutorial started");
			const sessions = salt(uid, "nf-sessions") < 0.35 ? 2 : 1;
			let t = base + (NF_RETURN_FROM_H + salt(uid, "nf-at") * (NF_RETURN_TO_H - NF_RETURN_FROM_H)) * HOUR_MS;
			for (let k = 0; k < sessions; k++) {
				events.push(morph(signup, GAME_LAUNCHED, t, { launch_source: pickWeighted({ desktop_launcher: 45, app_icon: 40, push_notification: 15 }, salt(uid, `nf-src|${k}`)) }));
				if (hadTutorial && salt(uid, `nf-retry|${k}`) < 0.7) events.push(morph(signup, "tutorial started", t + chance.integer({ min: 20, max: 180 }) * 1000));
				t += (4 + salt(uid, `nf-gap|${k}`) * 20) * HOUR_MS;
			}
		}
		return finish(events, profile);
	}

	// ── H8: lapsed veterans; Season 4 brings most of them back ──
	if (!born && salt(uid, "lapsed") < LAPSED_SHARE) {
		const returns = salt(uid, "return") < RETURN_SHARE;
		const returnT = ms(SEASON4_LAUNCH) + Math.floor(salt(uid, "return-day") * RETURN_SPREAD_DAYS * DAY_MS);
		events = events.filter((e) => {
			const t = T(e);
			if (returns && t >= returnT) return true;
			return hashFloat(`${uid}|day|${dayKey(t)}`) < LAPSED_KEEP;
		});
		if (!events.length) return events;
	}

	// ── dungeon runs (H4, H6, H9, H10, Season 4 dungeon) ──
	const units = new Map();
	for (const e of events) {
		if (!RUN_STEPS.includes(e.event)) continue;
		if (!units.has(e.run_id)) units.set(e.run_id, {});
		units.get(e.run_id)[e.event] = e;
	}
	const runEvents = [];
	// isExtra: `t` is the earliest time the extra run's queue (or entry) may begin, so
	// it never overlaps the run before it; otherwise `t` is the run's start time
	const buildRun = (unit, t, isExtra) => {
		const st = unit["dungeon started"];
		const qtype = pickWeighted(QUEUE_TYPE_WEIGHTS, rnd());
		const party = qtype === "matchmade" ? 5 : qtype === "solo" ? 1 : Number(pickWeighted(PREMADE_SIZE_WEIGHTS, rnd()));
		const dungeon = t >= ms(SEASON4_LAUNCH) && rnd() < NEW_DUNGEON_SHARE ? NEW_DUNGEON : DUNGEONS[Math.floor(rnd() * DUNGEONS.length)];
		const difficulty = pickWeighted(DIFFICULTY_BY_PERSONA[meta.persona?.name] ?? DIFFICULTY_WEIGHTS, rnd());
		const runId = isExtra ? `run_${chance.hash({ length: 12 })}` : st.run_id;
		// H4: during the EU outage the group finder retries launches, so EU queues run long
		const outageWait = region === OUTAGE_REGION && inOutage(t) ? OUTAGE_QUEUE_MULT : 1;
		const waitS = qtype === "matchmade" ? Math.max(5, Math.round(QUEUE_MEDIAN_S * (ROLE_QUEUE_MULT[role] ?? 1) * outageWait * logNormal(QUEUE_SIGMA))) : 0;
		const startT = isExtra ? t + waitS * 1000 : t;
		const xpMult = inDoubleXp(startT) ? 2 : 1;
		const common = { run_id: runId, dungeon_name: dungeon, difficulty };
		const q = unit["dungeon queued"];
		if (qtype === "matchmade") {
			runEvents.push(isExtra || !q ? morph(st, "dungeon queued", startT - waitS * 1000, { ...common, role }) : Object.assign(q, common, { role, time: iso(startT - waitS * 1000) }));
		}
		// H4: EU launches fail during the outage (the queue event stays; nothing starts)
		if (region === OUTAGE_REGION && inOutage(startT) && rnd() < OUTAGE_FAIL) return null;
		// the outcome is salted per run, independent of the shared random stream. Clear
		// rate depends on party size and difficulty; it has no platform, region, or
		// patch input (the Q13 / Q14 nulls). A weak balancing term pulls each
		// platform x party size x difficulty x region x patch-period stratum toward
		// its target (not a salt choice); the platform is the run's device at this
		// point, before sessions regroup devices.
		const target = CLEAR_RATE[party] * DIFFICULTY_CLEAR_MULT[difficulty];
		const stratum = `${storeOf(platformOf(st.os))}|${party}|${difficulty}|${region}|${startT >= ms(PATCH_402) ? "post" : "pre"}`;
		const bal = clearBalance(meta.config, stratum);
		const pClear = Math.min(0.98, Math.max(0.02, target + CLEAR_BALANCE_GAIN * (bal.n * target - bal.c)));
		const clear = hashFloat(`${runId}|result|9`) < pClear;
		bal.n += 1;
		if (clear) bal.c += 1;
		const result = clear ? "cleared" : hashFloat(`${runId}|fail`) < 0.75 ? "wiped" : "abandoned";
		const durMin = clear ? 24 * logNormal(0.3) : result === "wiped" ? 16 * logNormal(0.45) : 7 * logNormal(0.5);
		const endT = startT + Math.round(durMin * MIN_MS);
		const xp = Math.round(BASE_XP[difficulty] * (clear ? 1 : 0.25) * xpMult * (0.85 + rnd() * 0.3));
		const startProps = { ...common, party_size: party, queue_type: qtype, xp_multiplier: xpMult };
		const finProps = { ...common, party_size: party, result, duration_min: Math.round(durMin * 10) / 10, xp_earned: xp, xp_multiplier: xpMult };
		if (isExtra) {
			runEvents.push(morph(st, "dungeon started", startT, startProps));
			runEvents.push(morph(st, "dungeon finished", endT, finProps));
		} else {
			// the finished event is built from the started one (same session and device)
			runEvents.push(Object.assign(st, startProps, { time: iso(startT) }));
			runEvents.push(morph(st, "dungeon finished", endT, finProps));
		}
		return endT;
	};
	for (const unit of units.values()) {
		const st = unit["dungeon started"];
		if (!st) continue;
		const startT = T(st);
		const endT = buildRun(unit, startT, false);
		// H9: a double XP weekend run often brings an extra run right after
		if (endT !== null && inDoubleXp(startT) && rnd() < DOUBLE_XP_EXTRA) {
			buildRun(unit, endT + chance.integer({ min: 60, max: 300 }) * 1000, true);
		}
	}
	events = events.filter((e) => !RUN_STEPS.includes(e.event)).concat(runEvents);

	// ── play sessions: a day's activities chain into a few sessions on one device ──
	events = regroupSessions(events);

	// ── a player cannot queue, fight bosses, quest, or join the arena before finishing the tutorial ──
	if (born && tc) {
		const tcT = T(tc);
		const GATED = new Set(["quest completed", "boss fight", "arena match"]);
		const earlyRuns = new Set(events.filter((e) => RUN_STEPS.includes(e.event) && T(e) < tcT).map((e) => e.run_id));
		events = events.filter((e) => !(GATED.has(e.event) && T(e) < tcT) && !(RUN_STEPS.includes(e.event) && earlyRuns.has(e.run_id)));
	}

	// ── H2: guild in the first 72 hours; players without one often quit ──
	if (born && tc) {
		const launched = new Set(events.filter((e) => e.event === "dungeon started").map((e) => e.run_id));
		const joiner = salt(uid, "guild") < GUILD_JOIN_SHARE;
		const winEnd = birthMs + GUILD_WINDOW_H * HOUR_MS;
		const tcT = T(tc);
		if (joiner) {
			const cands = events.filter((e) => !ONBOARDING.has(e.event) && e.event !== "$experiment_started" && T(e) > tcT && T(e) < winEnd - 15 * MIN_MS).sort(byT);
			const anchor = cands.length ? cands[Math.floor(salt(uid, "guild-at") * cands.length)] : tc;
			const t = T(anchor) + chance.integer({ min: 60, max: 600 }) * 1000;
			events = events.filter((e) => e.event !== "guild joined");
			const gi = Math.floor(salt(uid, "guild-id") * GUILD_COUNT);
			events.push(pin(anchor, "guild joined", t, { guild_id: `guild_${String(gi).padStart(3, "0")}` }));
		} else {
			// later joins fold into same-day sessions, so drop any on or before the 72 h day
			events = events.filter((e) => !(e.event === "guild joined" && dayKey(T(e)) <= dayKey(winEnd)));
			if (salt(uid, "quit") < NONJOINER_QUIT_SHARE) {
				const cut = birthMs + Math.floor((QUIT_DAY_MIN + salt(uid, "quit-day") * (QUIT_DAY_MAX - QUIT_DAY_MIN)) * DAY_MS);
				events = events.filter((e) => T(e) < cut);
			}
		}
		// realism (not a story): every new player has a natural lifespan in the game
		const lifeDays = LIFE_D0 / Math.pow(Math.max(1e-6, salt(uid, "life")), 1 / LIFE_ALPHA);
		events = events.filter((e) => T(e) < birthMs + lifeDays * DAY_MS);
		// a cut drops whole runs: no queue or start whose finish fell past the cut
		const finished = new Set(events.filter((e) => e.event === "dungeon finished").map((e) => e.run_id));
		events = events.filter((e) => !RUN_STEPS.includes(e.event) || finished.has(e.run_id) || !launched.has(e.run_id));
	}
	// guild joins after the first days: a guild id from the pool
	for (const e of events) {
		if (e.event === "guild joined" && !String(e.guild_id).startsWith("guild_")) {
			const gi = Math.floor(hashFloat(`${e.insert_id}|g`) * GUILD_COUNT);
			e.guild_id = `guild_${String(gi).padStart(3, "0")}`;
		}
	}

	// ── standalone actions happen inside the day's play sessions ──
	events = foldIntoSessions(events);

	// ── H3: boss fights (Ashen Warden rebalance in patch 4.0.2) ──
	for (const e of events) {
		if (e.event !== "boss fight") continue;
		e.chapter = BOSSES[e.boss_name]?.chapter ?? 1;
		// salted per attempt, independent of the shared random stream
		e.result = hashFloat(`${uid}|${e.time}|boss`) < bossWin(e.boss_name, T(e)) ? "victory" : "defeat";
	}

	// ── purchases (H7): the engine's purchase events are replaced ──
	const homeStore = storeOf(platformOf(HOME_DEV?.os));
	const payer = salt(uid, "payer") < (born ? PAYER_SHARE_NEW : PAYER_SHARE_EXISTING) * (PAYER_PERSONA_MULT[meta.persona?.name] ?? 1) * PAYER_STORE_MULT[homeStore];
	events = events.filter((e) => e.event !== "purchase completed");
	if (payer) {
		const extra = [];
		// each payer buys on some of their play days; buying intensity varies by payer
		const intensity = PURCHASE_PER_DAY * (0.35 + 1.3 * salt(uid, "buy-rate"));
		const dayFirst = new Map();
		for (const e of events.slice().sort(byT)) {
			if (ONBOARDING.has(e.event) || e.event === "$experiment_started" || e.event === "purchase completed") continue;
			const d = dayKey(T(e));
			if (!dayFirst.has(d)) dayFirst.set(d, []);
			dayFirst.get(d).push(e);
		}
		for (const dayEvents of dayFirst.values()) {
			if (rnd() >= intensity) continue;
			const a = dayEvents[Math.floor(rnd() * dayEvents.length)];
			const p = morph(a, "purchase completed", T(a) + chance.integer({ min: 30, max: 300 }) * 1000, {});
			if (rnd() < BUNDLE_SHARE) {
				Object.assign(p, { product_type: "bundle", product: BUNDLE.product, price_usd: BUNDLE.price, embers_granted: BUNDLE.embers });
			} else {
				p.product_type = "embers";
				PACK_R.set(p, rnd());
			}
			extra.push(p);
		}
		const sorted = events.slice().sort(byT);
		// Season 4 Ember Pass: bought in the first session after launch (if active)
		if (salt(uid, "pass4") < PASS_BUY_SHARE) {
			const first = sorted.find((e) => T(e) >= ms(SEASON4_LAUNCH) && !ONBOARDING.has(e.event) && e.event !== "$experiment_started");
			if (first) extra.push(morph(first, "purchase completed", T(first) + chance.integer({ min: 90, max: 600 }) * 1000, { product_type: "ember_pass", product: "Season 4 Ember Pass", price_usd: EMBER_PASS_PRICE, embers_granted: 0 }));
		}
		// a few late Season 3 passes before Season 4
		if (salt(uid, "pass3") < PASS3_TRICKLE_SHARE) {
			const pre = sorted.filter((e) => T(e) < ms("2026-07-16T00:00:00Z") && !ONBOARDING.has(e.event) && e.event !== "$experiment_started");
			if (pre.length) {
				const a = pre[Math.floor(salt(uid, "pass3-at") * pre.length)];
				extra.push(morph(a, "purchase completed", T(a) + chance.integer({ min: 90, max: 600 }) * 1000, { product_type: "ember_pass", product: "Season 3 Ember Pass", price_usd: EMBER_PASS_PRICE, embers_granted: 0 }));
			}
		}
		events = events.concat(extra);
		// every purchase follows a store visit
		const stores = [];
		for (const p of events.filter((e) => e.event === "purchase completed")) {
			stores.push(morph(p, "store opened", T(p) - chance.integer({ min: 20, max: 150 }) * 1000, { store_tab: p.product_type === "ember_pass" ? "ember_pass" : p.product_type === "bundle" ? "featured" : "embers" }));
		}
		events = events.concat(stores);
	}

	// ── consistency: arena losses cost rating; guild chat and guild friends only while in a guild ──
	const guildSince = !born && profile.in_guild ? -Infinity
		: Math.min(Infinity, ...events.filter((e) => e.event === "guild joined").map(T));
	for (const e of events) {
		if (e.event === "arena match" && e.result === "loss" && e.rating_change > 0) e.rating_change = -e.rating_change;
		if (T(e) < guildSince) {
			if (e.event === "chat message sent" && e.chat_channel === "guild") e.chat_channel = pickWeighted({ party: 40, world: 20, whisper: 10 }, hashFloat(`${e.insert_id}|chat`));
			if (e.event === "friend added" && e.friend_source === "guild") e.friend_source = pickWeighted({ party: 45, search: 20, contacts: 10 }, hashFloat(`${e.insert_id}|friend`));
		}
	}

	// ── levels: each level up is the next level ──
	events.sort(byT);
	let level = profile.account_level || 1;
	events = events.filter((e) => {
		if (e.event !== "level up") return true;
		if (level >= 60) return false;
		level += 1;
		e.new_level = level;
		return true;
	});
	profile.account_level = level;

	return finish(events, profile);
}

/**
 * Chain a day's activity units (a dungeon run with its queue, or a burst of
 * quests / boss fights / arena matches) into play sessions of 2-5 units, each
 * unit starting 1-5 minutes after the previous one ends, on the device the
 * session started on. Units only move earlier (at most MERGE_MAX_GAP); inside a
 * unit a dungeon run may move later so it starts after the previous run ends,
 * never past the end of its UTC day.
 */
function regroupSessions(events) {
	events.sort(byT);
	const fixed = [];
	const items = []; // { evs, s, e }
	const runs = new Map();
	for (const ev of events) {
		if (ONBOARDING.has(ev.event) || ev.event === "$experiment_started" || FOLDABLE.has(ev.event)) { fixed.push(ev); continue; }
		if (RUN_STEPS.includes(ev.event)) {
			if (!runs.has(ev.run_id)) { const it = { evs: [], s: Infinity, e: -Infinity }; runs.set(ev.run_id, it); items.push(it); }
			const it = runs.get(ev.run_id);
			it.evs.push(ev);
			continue;
		}
		items.push({ evs: [ev], s: 0, e: 0 });
	}
	for (const it of items) {
		const ts = it.evs.map(T);
		it.s = Math.min(...ts);
		it.e = Math.max(...ts);
	}
	items.sort((a, b) => a.s - b.s);
	// units: items closer than the session gap on the same UTC day. A player is in
	// one dungeon at a time: a run that would queue or start before the player's
	// previous run finishes moves to 1-4 minutes after that finish (salted per run);
	// if that pushes it past the end of its UTC day, the whole run is dropped.
	const units = [];
	let runEnd = -Infinity;
	for (const it of items) {
		const isRun = RUN_STEPS.includes(it.evs[0].event);
		if (isRun) {
			const shift = Math.max(0, runEnd + Math.round((60 + hashFloat(`${it.evs[0].run_id}|gap`) * 180) * 1000) - it.s);
			if (shift > 0) {
				if (dayKey(it.e + shift) !== dayKey(it.s) || it.e + shift > ms(DATASET_END)) continue;
				for (const ev of it.evs) ev.time = iso(T(ev) + shift);
				it.s += shift;
				it.e += shift;
			}
			runEnd = it.e;
		}
		const last = units[units.length - 1];
		if (last && it.s - last.e <= SESSION_GAP_MS && dayKey(it.s) === dayKey(last.s)) {
			last.evs.push(...it.evs);
			last.e = Math.max(last.e, it.e);
		} else units.push({ evs: [...it.evs], s: it.s, e: it.e });
	}
	// sessions: chain consecutive units
	let sess = null;
	for (const un of units) {
		const fresh = !sess || sess.left <= 0 || dayKey(un.s) !== dayKey(sess.s) || un.s - sess.e > MERGE_MAX_GAP;
		if (fresh) {
			const devEv = un.evs.find((e) => e.device_id);
			sess = { s: un.s, e: un.e, left: chance.integer({ min: 1, max: 4 }), dev: devEv ? Object.fromEntries(DEVICE_FIELDS.map((k) => [k, devEv[k]])) : null };
			continue;
		}
		const target = sess.e + chance.integer({ min: 60, max: 300 }) * 1000;
		const shift = Math.min(0, target - un.s);
		for (const ev of un.evs) {
			ev.time = iso(T(ev) + shift);
			if (sess.dev && ev.device_id) {
				for (const k of DEVICE_FIELDS) {
					if (sess.dev[k] === undefined) delete ev[k];
					else ev[k] = sess.dev[k];
				}
			}
		}
		sess.e = Math.max(sess.e, un.e + shift);
		sess.left -= 1;
	}
	return fixed.concat(units.flatMap((un) => un.evs));
}

/**
 * Standalone actions (chat, crafting, friends, level ups, store visits,
 * purchases, later guild joins) move into one of the same UTC day's play
 * sessions; on a day with no session they stay where they are.
 */
function foldIntoSessions(events) {
	events.sort(byT);
	const clusters = new Map(); // day -> [{ s, e }]
	let cur = null;
	for (const ev of events) {
		if (FOLDABLE.has(ev.event)) continue;
		const t = T(ev);
		if (cur && t - cur.e <= SESSION_GAP_MS && dayKey(t) === dayKey(cur.s)) { cur.e = t; continue; }
		cur = { s: t, e: t };
		const d = dayKey(t);
		if (!clusters.has(d)) clusters.set(d, []);
		clusters.get(d).push(cur);
	}
	for (const ev of events) {
		if (!FOLDABLE.has(ev.event) || PINNED.has(ev)) continue;
		const day = clusters.get(dayKey(T(ev)));
		if (!day || !day.length) continue;
		const c = day[Math.floor(rnd() * day.length)];
		const span = Math.max(c.e - c.s, 0);
		const t = c.s + Math.floor(rnd() * span) + chance.integer({ min: 20, max: 240 }) * 1000;
		ev.time = iso(Math.min(t, ms(`${dayKey(c.s)}T23:59:59Z`)));
	}
	return events;
}

/** sessions (one game launched per play session), client version, platform, profile totals */
function finish(events, profile) {
	events.sort(byT);
	const out = [];
	const sessions = [];
	let cluster = [];
	const flush = () => {
		if (!cluster.length) return;
		const first = cluster[0];
		const hasSignup = cluster.some((e) => e.event === "account created");
		if (first.event !== GAME_LAUNCHED && !hasSignup) {
			const dayStart = ms(`${dayKey(T(first))}T00:00:00Z`);
			// 5-60 s before the first action, never across midnight, and more than
			// 30 minutes after the previous session's last event
			const t0 = T(first) - Math.min(chance.integer({ min: 5, max: 60 }) * 1000, Math.floor((T(first) - dayStart) * 0.9));
			const t = Math.min(T(first), Math.max(t0, prevEnd + SESSION_GAP_MS + 1000));
			cluster.unshift(morph(first, GAME_LAUNCHED, t, { launch_source: pickWeighted({ desktop_launcher: 45, app_icon: 40, push_notification: 15 }, rnd()) }));
		}
		out.push(...cluster);
		sessions.push(cluster);
		prevEnd = T(cluster[cluster.length - 1]);
		cluster = [];
	};
	let prevEnd = -Infinity;
	let lastT = -Infinity;
	const openRuns = new Set();
	for (const e of events) {
		const t = T(e);
		// a play session ends after 30 idle minutes (a session can run past midnight);
		// a dungeon run in progress (queued or started) keeps its session open until it moves on
		const continuesOpenRun = (e.event === "dungeon started" || e.event === "dungeon finished") && openRuns.has(e.run_id);
		if (cluster.length && t - lastT > SESSION_GAP_MS && !continuesOpenRun) { flush(); openRuns.clear(); }
		// a long queue or a long run: the player chats while they wait or play, so the
		// session never sits idle for 30 minutes (world chat in a queue or solo, party chat in a group)
		if (cluster.length && continuesOpenRun) {
			const prev = cluster[cluster.length - 1];
			const channel = prev.event === "dungeon started" && prev.party_size > 1 ? "party" : "world";
			while (t - lastT > SESSION_GAP_MS) {
				lastT += chance.integer({ min: 12, max: 26 }) * MIN_MS;
				cluster.push(morph(prev, "chat message sent", lastT, { chat_channel: channel }));
			}
		}
		// a later launch inside a session is dropped and does not extend it
		if (e.event === GAME_LAUNCHED && cluster.length) continue;
		if (e.event === "dungeon queued" || e.event === "dungeon started") openRuns.add(e.run_id);
		cluster.push(e);
		lastT = t;
	}
	flush();
	// one play session = one session_id and one device: every event in the session takes
	// the session_id of its first event and the device of its first device-bearing event
	// (server-sent onboarding steps stay device-less)
	const usedSids = new Set();
	for (const sess of sessions) {
		let sid = sess[0].session_id;
		if (!sid || usedSids.has(sid)) {
			const h = (k) => String(Math.floor(hashFloat(`${profile.distinct_id}|sid|${T(sess[0])}|${k}`) * 90000) + 10000);
			sid = [0, 1, 2, 3].map(h).join("-");
		}
		usedSids.add(sid);
		const anchor = sess.find((e) => e.device_id);
		for (const e of sess) {
			e.session_id = sid;
			if (!anchor || !e.device_id || e === anchor) continue;
			for (const k of DEVICE_FIELDS) {
				if (anchor[k] === undefined) delete e[k];
				else e[k] = anchor[k];
			}
		}
	}
	let spend = profile.total_spend_usd || 0;
	let guild = !!profile.in_guild;
	for (const e of out) {
		e.platform = platformOf(e.os);
		if (e.event === GAME_LAUNCHED) {
			e.client_version = clientVersion(T(e));
			if (e.platform !== "pc" && e.launch_source === "desktop_launcher") e.launch_source = "app_icon";
			if (e.platform === "pc" && e.launch_source !== "desktop_launcher") e.launch_source = "desktop_launcher";
		}
		const r = PACK_R.get(e);
		if (r !== undefined) {
			const pk = GEM_PACKS[pickIndex(PACK_WEIGHTS[storeOf(e.platform)], r)];
			Object.assign(e, { product: `${pk.embers.toLocaleString("en-US")} Embers`, price_usd: pk.price, embers_granted: pk.embers });
		}
		if (e.event === "purchase completed") spend += e.price_usd;
		if (e.event === "guild joined") { guild = true; e.guild_size = guildSize(e.guild_id, T(e)); }
	}
	profile.total_spend_usd = round2(spend);
	profile.in_guild = guild;
	return out.filter((e) => T(e) >= ms(DATASET_START));
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "ua_spend_daily") {
		const k = `${row.date}|${row.acquisition_channel}`;
		const spend = paidSpend(row.date, row.acquisition_channel, row.spend_usd);
		row.spend_usd = spend;
		row.installs_reported = Math.round(spend * PLATFORM_INSTALL_INFLATION / CPI_USD[row.acquisition_channel] * jitter(`inst|${k}`, 0.2));
		row.clicks = Math.round(spend / (CPC_USD[row.acquisition_channel] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[row.acquisition_channel] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "server_health_daily") {
		const k = `${row.date}|${row.server_region}`;
		row.peak_concurrent_players = Math.round(row.peak_concurrent_players * 0.22 * jitter(`ccu|${k}`, 0.12));
		// queues back up while instances fail to launch
		if (row.server_region === OUTAGE_REGION && inOutage(ms(`${row.date}T00:00:00Z`))) row.avg_queue_seconds = Math.round(row.avg_queue_seconds * OUTAGE_QUEUE_MULT);
		return row;
	}
	if (meta.metricName === "store_revenue_daily") {
		// billing differs from Mixpanel: purchases from players who opted out of
		// analytics or whose client never sent the event, and refunds
		const k = `${row.date}|${row.platform}|${row.product_type}`;
		const count = meta.raw?.plus?.count ?? 0;
		// an extra or refunded item is a real list price: an Ember pack drawn from the
		// platform's pack mix, the bundle, or the pass. A refunded item that would take
		// refunds past the day's gross is not refunded.
		const itemsValue = (n, tag, cap = Infinity) => {
			let v = 0;
			for (let i = 0; i < n; i++) {
				const price = row.product_type === "bundle" ? BUNDLE.price
					: row.product_type === "ember_pass" ? EMBER_PASS_PRICE
						: GEM_PACKS[pickIndex(PACK_WEIGHTS[storeOf(row.platform)], hashFloat(`${tag}|${k}|${i}`))].price;
				if (v + price <= cap + 1e-9) v += price;
			}
			return v;
		};
		// the untracked share is a property of the day (an SDK or network problem hits every
		// store): skewed, 0-48%, mean = knob (the product of two uniforms has mean 1/4)
		const dayShare = 4 * UNTRACKED_PURCHASE_SHARE * hashFloat(`untracked|${row.date}`) * hashFloat(`untracked2|${row.date}`);
		const untrackedN = Math.floor(dayShare * count + hashFloat(`untracked|${k}`));
		// unbiased refund count: expected REFUND_SHARE of tracked purchases on every row
		const refundN = Math.min(count + untrackedN, Math.floor(REFUND_SHARE * count + hashFloat(`refund|${k}`)));
		const gross = round2(row.gross_bookings_usd + itemsValue(untrackedN, "untracked-item"));
		const refunds = round2(itemsValue(refundN, "refund-item", gross));
		const fees = round2((gross - refunds) * STORE_FEE[row.platform]);
		row.gross_bookings_usd = gross;
		row.transactions = count + untrackedN;
		row.refunds_usd = refunds;
		row.store_fees_usd = fees;
		row.net_revenue_usd = round2(gross - refunds - fees);
		return row;
	}
	return row;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	numUsers: NUM_USERS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	format: "json",
	gzip: true,
	concurrency: 1,
	writeToDisk: false,
	macro: { percentUsersBornInDataset: BORN_PCT, bornRecentBias: 0, preExistingSpread: "uniform" },
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: false,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 1.3 },
	stickyEventProps: ["server_region"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { emberfall_id: 45, google: 25, apple: 18, discord: 12 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "character created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				class_name: (ctx) => ctx.profile.main_class,
				role: (ctx) => ctx.profile.main_role,
			},
		},
		{
			event: "tutorial started",
			weight: 1,
			isStrictEvent: true,
			properties: {},
		},
		{
			event: "tutorial completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				tutorial_version: ["classic"],
				tutorial_minutes: u.weighNumRange(6, 30, 0.8, 12),
			},
		},
		{
			event: GAME_LAUNCHED,
			weight: 1,
			isStrictEvent: true,
			properties: {
				launch_source: { __weights: { desktop_launcher: 45, app_icon: 40, push_notification: 15 } },
				client_version: ["4.0.1"],
			},
		},
		{
			event: "dungeon queued",
			weight: 1,
			isStrictEvent: true,
			properties: {
				run_id: ["unassigned"],
				dungeon_name: [DUNGEONS[0]],
				difficulty: ["normal"],
				role: ["dps"],
			},
		},
		{
			event: "dungeon started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				run_id: ["unassigned"],
				dungeon_name: [DUNGEONS[0]],
				difficulty: ["normal"],
				party_size: [5],
				queue_type: ["matchmade"],
				xp_multiplier: [1],
			},
		},
		{
			event: "dungeon finished",
			weight: 1,
			isStrictEvent: true,
			properties: {
				run_id: ["unassigned"],
				dungeon_name: [DUNGEONS[0]],
				difficulty: ["normal"],
				party_size: [5],
				result: ["cleared"],
				duration_min: [20],
				xp_earned: [1000],
				xp_multiplier: [1],
			},
		},
		{
			event: "boss fight",
			weight: 1,
			isStrictEvent: true,
			properties: {
				boss_name: { __weights: Object.fromEntries(Object.entries(BOSSES).map(([k, b]) => [k, b.w])) },
				chapter: [1],
				result: ["defeat"],
			},
		},
		{
			event: "quest completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				quest_type: { __weights: { daily: 50, side: 32, main_story: 18 } },
				xp_earned: u.weighNumRange(150, 1500, 0.7, 400),
				gold_earned: u.weighNumRange(20, 600, 0.6, 120),
			},
		},
		{
			event: "arena match",
			weight: 1,
			isStrictEvent: true,
			properties: {
				arena_mode: { __weights: { "3v3": 60, "1v1": 40 } },
				result: ["win", "loss"],
				rating_change: u.weighNumRange(5, 30, 1, 15),
			},
		},
		{
			event: "chat message sent",
			weight: 3,
			properties: {
				chat_channel: { __weights: { party: 40, guild: 30, world: 20, whisper: 10 } },
			},
		},
		{
			event: "item crafted",
			weight: 2,
			properties: {
				item_slot: ["weapon", "helm", "chest", "gloves", "boots", "trinket"],
				item_rarity: { __weights: { common: 50, rare: 32, epic: 15, legendary: 3 } },
			},
		},
		{
			event: "friend added",
			weight: 1,
			properties: {
				friend_source: { __weights: { party: 45, guild: 25, search: 20, contacts: 10 } },
			},
		},
		{
			event: "guild joined",
			weight: 1,
			properties: {
				guild_id: ["unassigned"],
				guild_size: [20],
			},
		},
		{
			event: "level up",
			weight: 2,
			properties: {
				new_level: [2],
			},
		},
		{
			event: "store opened",
			weight: 2,
			properties: {
				store_tab: { __weights: { featured: 45, embers: 30, cosmetics: 15, ember_pass: 10 } },
			},
		},
		{
			event: "purchase completed",
			weight: 1,
			properties: {
				product_type: ["embers"],
				product: ["550 Embers"],
				price_usd: [4.99],
				embers_granted: [550],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [TUTORIAL_EXPERIMENT],
				"Variant name": ["Control", TUTORIAL_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "character created", "tutorial started", "tutorial completed"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: { neq: "tiktok_ads" } },
			conversionRate: TUTORIAL_CONV,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 1,
			experiment: {
				name: TUTORIAL_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(TUTORIAL_TEST_START)) / DAY_MS,
				variants: [{ name: "Control", conversionMultiplier: 1, ttcMultiplier: 1 }, { name: TUTORIAL_VARIANT, conversionMultiplier: GUIDED_CONV_MULT, ttcMultiplier: GUIDED_TTC_MULT }],
			},
		},
		{
			name: "Onboarding",
			sequence: ["account created", "character created", "tutorial started", "tutorial completed"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: "tiktok_ads" },
			conversionRate: Math.round(TUTORIAL_CONV * TIKTOK_TUTORIAL_MULT),
			timeToConvert: 0.5,
			order: "sequential",
			weight: 1,
			experiment: {
				name: TUTORIAL_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(TUTORIAL_TEST_START)) / DAY_MS,
				variants: [{ name: "Control", conversionMultiplier: 1, ttcMultiplier: 1 }, { name: TUTORIAL_VARIANT, conversionMultiplier: GUIDED_CONV_MULT, ttcMultiplier: GUIDED_TTC_MULT }],
			},
		},
		{
			// a play session: launch, quests, chat, crafting, store
			name: "Play session",
			sequence: [GAME_LAUNCHED, "quest completed", "chat message sent", "quest completed", "item crafted", "quest completed", "store opened"],
			conversionRate: 55,
			timeToConvert: 0.6,
			order: "first-fixed",
			weight: 9,
		},
		{
			// one dungeon run; the hook decides queue, party, timing, and result
			name: "Dungeon run",
			sequence: RUN_STEPS,
			conversionRate: 100,
			timeToConvert: 0.4,
			order: "sequential",
			weight: 10,
			props: {
				run_id: () => `run_${chance.hash({ length: 12 })}`,
			},
		},
		{
			// story campaign: quests and chapter boss attempts
			name: "Campaign session",
			sequence: [GAME_LAUNCHED, "quest completed", "boss fight", "boss fight", "quest completed", "boss fight"],
			conversionRate: 60,
			timeToConvert: 0.7,
			order: "first-fixed",
			weight: 4,
		},
		{
			name: "Arena session",
			sequence: [GAME_LAUNCHED, "arena match", "arena match", "arena match", "chat message sent", "arena match"],
			conversionRate: 60,
			timeToConvert: 0.6,
			order: "first-fixed",
			weight: 3,
		},
	],

	warehouseMetrics: [
		{
			name: "ua_spend_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "account created",
				measure: "count",
				where: (e) => PAID_CHANNELS.includes(e.acquisition_channel),
				groupBy: "acquisition_channel",
			},
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				installs_reported: 0,
				clicks: 0,
				impressions: 0,
			},
		},
		{
			name: "server_health_daily",
			type: "additive",
			grain: "day",
			source: {
				event: GAME_LAUNCHED,
				measure: "users",
				groupBy: "server_region",
			},
			timeColumn: "date",
			valueColumn: "peak_concurrent_players",
			columns: {
				instance_launch_success_rate: (ctx) => {
					const j = hashFloat(`ils|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return ctx.row.server_region === OUTAGE_REGION && inOutage(ctx.time)
						? Math.round((1 - OUTAGE_FAIL + (j - 0.5) * 0.04) * 1000) / 1000
						: Math.round((0.991 + j * 0.008) * 1000) / 1000;
				},
				avg_queue_seconds: (ctx) => Math.round(expectedQueueSeconds * jitter(`aq|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15)),
				uptime_pct: (ctx) => {
					const j = hashFloat(`up|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return ctx.row.server_region === OUTAGE_REGION && inOutage(ctx.time)
						? Math.round((38 + j * 12) * 100) / 100
						: Math.round((99.85 + j * 0.15) * 100) / 100;
				},
				incident_severity: (ctx) => (ctx.row.server_region === OUTAGE_REGION && inOutage(ctx.time) ? "sev1" : "none"),
			},
		},
		{
			name: "store_revenue_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "purchase completed",
				measure: "sum",
				property: "price_usd",
				groupBy: ["platform", "product_type"],
			},
			timeColumn: "date",
			valueColumn: "gross_bookings_usd",
			columns: {
				transactions: 0,
				refunds_usd: 0,
				store_fees_usd: 0,
				net_revenue_usd: 0,
			},
		},
	],

	superProps: {
		platform: ["pc"],
		server_region: ["NA"],
	},

	userProps: {
		server_region: weighted(REGIONS),
		acquisition_channel: weighted(CHANNEL_WEIGHTS),
		main_role: weighted(ROLE_WEIGHTS),
		main_class: ["Pyromancer"],
		account_level: [1],
		member_since: ["2025-01-01"],
		in_guild: [false],
		total_spend_usd: [0],
	},

	personas: PERSONAS,

	retentionCurve: { type: "logarithmic", day1: 0.5, day7: 0.3, day30: 0.16 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

EVENT_PROPS = Object.fromEntries(config.events.map((e) => [e.event, Object.keys(e.properties || {})]));

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/gaming/gaming.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the player seen with it on any event
// that carries both ids (the way Mixpanel stitches). Every Emberfall event
// carries user_id, so uid = user_id in practice.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const addDays = (isoStr, n) => dayjs.utc(isoStr).add(n, "day").toISOString();

const TUTORIAL_WINDOW_DAYS = 7;          // H1/H5 read: Funnels conversion window account created → tutorial completed
const RET_FROM = 14, RET_TO = 28;        // H2 read: game launched on day 14-27 after signup
const RET_BIRTH_END = TS(addDays(DATASET_END, -RET_TO));
const INC_BASE_DAYS = 14;                // H4 read: baseline days either side of the outage
const H8_BEFORE = ["2026-07-09T00:00:00Z", SEASON4_LAUNCH];                         // 4 whole weeks before launch
const H8_AFTER = [addDays(SEASON4_LAUNCH, RETURN_SPREAD_DAYS), addDays(SEASON4_LAUNCH, RETURN_SPREAD_DAYS + 28)]; // 4 whole weeks after returns
const H8_EXPECTED = (1 - LAPSED_SHARE + LAPSED_SHARE * (RETURN_SHARE + (1 - RETURN_SHARE) * LAPSED_KEEP)) / (1 - LAPSED_SHARE + LAPSED_SHARE * LAPSED_KEEP);
const DXP_COMPARE = [addDays(DOUBLE_XP_START, -7), addDays(DOUBLE_XP_START, 7)];   // the same Fri-Sun one week before and after
const GEM_RATIO = AVG_PACK_PRICE.pc / AVG_PACK_PRICE.mobile;
const NET_RATIO = GEM_RATIO * (1 - STORE_FEE.pc) / (1 - STORE_FEE.ios);
const NON_WARDEN = Object.keys(BOSSES).filter((b) => b !== WARDEN);

const H1_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created'),
c AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'tutorial completed' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${TUTORIAL_WINDOW_DAYS} DAY GROUP BY 1)
SELECT v.variant AS grp, count(*) AS user_count, count(c.uid)::DOUBLE / count(*) AS completion
FROM s JOIN v ON v.uid = s.uid LEFT JOIN c ON c.uid = s.uid GROUP BY 1`;

const H2_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t <= TIMESTAMP '${RET_BIRTH_END}'),
f AS (SELECT s.uid, s.t0 FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'tutorial completed' GROUP BY 1, 2),
g AS (SELECT f.uid,
  bool_or(e.event = 'guild joined' AND e.t >= f.t0 AND e.t < f.t0 + INTERVAL ${GUILD_WINDOW_H} HOUR) AS early_guild,
  bool_or(e.event = '${GAME_LAUNCHED}' AND e.t >= f.t0 + INTERVAL ${RET_FROM} DAY AND e.t < f.t0 + INTERVAL ${RET_TO} DAY) AS retained
  FROM f JOIN ev e ON e.uid = f.uid GROUP BY 1)
SELECT CASE WHEN early_guild THEN 'guild' ELSE 'no_guild' END AS grp, count(*) AS user_count, avg(retained::INT) AS retention FROM g GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN boss_name = '${WARDEN}' THEN 'warden' ELSE 'other' END AS grp, count(DISTINCT uid) AS user_count,
 avg((result = 'victory')::INT) FILTER (WHERE t < TIMESTAMP '${TS(PATCH_402)}') AS win_before,
 avg((result = 'victory')::INT) FILTER (WHERE t >= TIMESTAMP '${TS(PATCH_402)}') AS win_after,
 avg((result = 'victory')::INT) FILTER (WHERE t >= TIMESTAMP '${TS(PATCH_402)}') / avg((result = 'victory')::INT) FILTER (WHERE t < TIMESTAMP '${TS(PATCH_402)}') AS lift
FROM ev WHERE event = 'boss fight' GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
c AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'tutorial completed' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${TUTORIAL_WINDOW_DAYS} DAY GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("ua_spend_daily")} GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(c.uid) AS completed FROM s LEFT JOIN c ON c.uid = s.uid GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.completed::DOUBLE / g.signups AS completion,
 sp.spend / g.signups AS spend_per_signup, sp.spend / g.completed AS spend_per_completer
FROM g LEFT JOIN sp ON sp.ch = g.ch
UNION ALL
SELECT 'non_tiktok' AS grp, sum(signups)::BIGINT AS user_count, sum(completed)::DOUBLE / sum(signups) AS completion, NULL, NULL FROM g WHERE ch <> 'tiktok_ads'`;

const H6_SQL = `WITH ${ID_CTE},
q AS (SELECT run_id, uid, t AS tq FROM ev WHERE event = 'dungeon queued'),
st AS (SELECT run_id, min(t) AS ts FROM ev WHERE event = 'dungeon started' GROUP BY 1),
u AS (SELECT distinct_id::VARCHAR AS uid, main_role FROM ${US})
SELECT u.main_role AS grp, count(DISTINCT q.uid) AS user_count, count(*) AS runs, median(date_diff('millisecond', q.tq, st.ts) / 1000.0) AS median_wait_s
FROM q JOIN st ON st.run_id = q.run_id JOIN u ON u.uid = q.uid GROUP BY 1`;

const H7_SQL = `WITH ${ID_CTE},
p AS (SELECT CASE WHEN platform = 'pc' THEN 'pc' ELSE 'mobile' END AS store, uid, price_usd FROM ev WHERE event = 'purchase completed' AND product_type = 'embers'),
w AS (SELECT CASE WHEN platform = 'pc' THEN 'pc' ELSE 'mobile' END AS store, sum(net_revenue_usd) AS net FROM ${WH("store_revenue_daily")} WHERE product_type = 'embers' GROUP BY 1)
SELECT p.store AS grp, count(DISTINCT p.uid) AS user_count, count(*) AS purchases, avg(p.price_usd) AS avg_price, any_value(w.net) / count(*) AS net_per_purchase
FROM p JOIN w ON w.store = p.store GROUP BY 1`;

const H8_SQL = `WITH ${ID_CTE},
newp AS (SELECT DISTINCT uid FROM ev WHERE event = 'account created'),
d AS (SELECT t::DATE AS d, count(DISTINCT uid) AS dau FROM ev
  WHERE event = '${GAME_LAUNCHED}' AND uid NOT IN (SELECT uid FROM newp) GROUP BY 1)
SELECT 'veterans' AS grp, (SELECT count(DISTINCT uid) FROM ev WHERE uid NOT IN (SELECT uid FROM newp)) AS user_count,
 avg(dau) FILTER (WHERE d >= DATE '${D(H8_BEFORE[0])}' AND d < DATE '${D(H8_BEFORE[1])}') AS dau_before,
 avg(dau) FILTER (WHERE d >= DATE '${D(H8_AFTER[0])}' AND d < DATE '${D(H8_AFTER[1])}') AS dau_after,
 avg(dau) FILTER (WHERE d >= DATE '${D(H8_AFTER[0])}' AND d < DATE '${D(H8_AFTER[1])}') / avg(dau) FILTER (WHERE d >= DATE '${D(H8_BEFORE[0])}' AND d < DATE '${D(H8_BEFORE[1])}') AS lift
FROM d`;

const H9_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(DOUBLE_XP_START)}' AND t < TIMESTAMP '${TS(DOUBLE_XP_END)}' THEN 'double_xp'
  WHEN (t >= TIMESTAMP '${TS(DXP_COMPARE[0])}' AND t < TIMESTAMP '${TS(addDays(DXP_COMPARE[0], 3))}') OR (t >= TIMESTAMP '${TS(DXP_COMPARE[1])}' AND t < TIMESTAMP '${TS(addDays(DXP_COMPARE[1], 3))}') THEN 'normal' END AS grp,
  uid, t::DATE AS d, event FROM ev WHERE event IN ('dungeon started', '${GAME_LAUNCHED}'))
SELECT grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE event = 'dungeon started') AS runs,
 count(DISTINCT uid || '|' || d::VARCHAR) FILTER (WHERE event = '${GAME_LAUNCHED}') AS player_days,
 count(*) FILTER (WHERE event = 'dungeon started')::DOUBLE / count(DISTINCT uid || '|' || d::VARCHAR) FILTER (WHERE event = '${GAME_LAUNCHED}') AS runs_per_dau
FROM w WHERE grp IS NOT NULL GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE}
SELECT 'p' || party_size AS grp, count(DISTINCT uid) AS user_count, count(*) AS runs, avg((result = 'cleared')::INT) AS clear_rate
FROM ev WHERE event = 'dungeon finished' GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-first-flame-tutorial-test",
		hook: "H1",
		archetype: "experiment-lift",
		narrative: `The "${TUTORIAL_EXPERIMENT}" test starts ${D(TUTORIAL_TEST_START)}: every new player is assigned 50/50 at account creation (sticky; $experiment_started 1 s before "account created", carrying user_id and the signup device; profile property "${EXP_KEY}"). The "${TUTORIAL_VARIANT}" arm gets a shorter, guided tutorial (onboarding steps take ${GUIDED_TTC_MULT}x as long; tutorial_minutes on "tutorial completed" is the real time since "tutorial started"); its players finish the tutorial ${GUIDED_CONV_MULT}x as often as Control (${TUTORIAL_CONV}% → ${TUTORIAL_CONV * GUIDED_CONV_MULT}% for non-TikTok signups; TikTok signups move from ${Math.round(TUTORIAL_CONV * TIKTOK_TUTORIAL_MULT)}% by the same factor). The engine experiment knob on the two declared Onboarding first funnels applies it. tutorial_version = guided marks a guided completion and never appears in Control. Players who never finish the tutorial leave: ${NF_RETURN_SHARE * 100}% come back for a session or two on day 1-2, none later. Read: account created → tutorial completed within ${TUTORIAL_WINDOW_DAYS} days, by variant.`,
		mixpanelReport: { type: "Funnels", steps: ["account created", "tutorial completed"], window: `${TUTORIAL_WINDOW_DAYS} days`, dateRange: `${D(TUTORIAL_TEST_START)} to ${D(DATASET_END)}`, breakdown: `user property "${EXP_KEY}"`, alt: "Experiments report on $experiment_started" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { g: { where: { grp: TUTORIAL_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "g.completion / c.completion", op: "between", target: band(GUIDED_CONV_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${TUTORIAL_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US})
SELECT 'all' AS grp, count(DISTINCT ev.uid) AS user_count,
 count(*) FILTER (WHERE (ev.event = 'tutorial completed' AND tutorial_version = 'guided' AND v.variant IS DISTINCT FROM '${TUTORIAL_VARIANT}')
   OR (ev.event = '$experiment_started' AND ev.t < TIMESTAMP '${TS(TUTORIAL_TEST_START)}')) AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE ev.event IN ('tutorial completed', '$experiment_started')`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: guided completions only in the variant; no exposure before the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL)
SELECT v.variant AS grp, count(DISTINCT ev.uid) AS user_count, median(tutorial_minutes) AS median_minutes
FROM ev JOIN v ON v.uid = ev.uid WHERE ev.event = 'tutorial completed' GROUP BY 1`,
				},
				select: { g: { where: { grp: TUTORIAL_VARIANT } }, c: { where: { grp: "Control" } } },
				// the guided tutorial is shorter: tutorial_minutes is the real started → completed gap
				expect: { metric: "g.median_minutes / c.median_minutes", op: "between", target: band(GUIDED_TTC_MULT) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H2-early-guild-retention",
		hook: "H2",
		archetype: "retention-divergence",
		narrative: `New players who join a guild within ${GUILD_WINDOW_H} hours of creating their account stay. ${GUILD_JOIN_SHARE * 100}% of tutorial finishers join a guild in that window (salted per player, independent of activity); of the rest, ${NONJOINER_QUIT_SHARE * 100}% quit for good on a salted day ${QUIT_DAY_MIN}-${QUIT_DAY_MAX}. Every new player also has a natural lifespan (Pareto; same for both groups). Read: among players who finished the tutorial and signed up by ${RET_BIRTH_END.slice(0, 10)} (complete bracket), the share with "${GAME_LAUNCHED}" on day ${RET_FROM}-${RET_TO - 1} after signup; no-guild over guild reads 1 - ${NONJOINER_QUIT_SHARE} = ${(1 - NONJOINER_QUIT_SHARE).toFixed(2)}.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: GAME_LAUNCHED, brackets: `custom: day ${RET_FROM}-${RET_TO - 1}`, cohorts: `players who did "tutorial completed"; split by funnel converters account created → guild joined within ${GUILD_WINDOW_H} hours`, dateRange: `births ${D(DATASET_START)} to ${RET_BIRTH_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { n: { where: { grp: "no_guild" } }, g: { where: { grp: "guild" } } },
				// about 320 retained players per group (relative SE ≈ 8%): knob target, half-effect floor
				expect: { metric: "n.retention / g.retention", op: "<=", target: 1 - NONJOINER_QUIT_SHARE, floor: 1 - 0.5 * NONJOINER_QUIT_SHARE },
				minCohort: 500,
			},
		],
	},
	{
		id: "H3-ashen-warden-rebalance",
		hook: "H3",
		archetype: "temporal-inflection",
		narrative: `Patch 4.0.2 (${D(PATCH_402)}) rebalances the Ashen Warden, the chapter 3 boss that players called a wall: the win rate per attempt ("boss fight" result = victory) moves from ${WARDEN_WIN_BEFORE * 100}% to ${WARDEN_WIN_AFTER * 100}% (x${(WARDEN_WIN_AFTER / WARDEN_WIN_BEFORE).toFixed(3)}). The other three chapter bosses (${NON_WARDEN.join(", ")}) keep their win rates (control). Read: victories / attempts per boss, before vs from the patch date.`,
		mixpanelReport: { type: "Insights", events: ["boss fight (result = victory)", "boss fight"], formula: "A / B", breakdown: "boss_name", chart: "weekly line; before vs from Jul 23" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { w: { where: { grp: "warden" } } },
				expect: { metric: "w.lift", op: "between", target: band(WARDEN_WIN_AFTER / WARDEN_WIN_BEFORE) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { o: { where: { grp: "other" } } },
				// control: bosses the patch did not touch
				expect: { metric: "o.lift", op: "between", target: band(1) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H4-eu-instance-outage",
		hook: "H4",
		archetype: "bespoke",
		narrative: `From ${D(EU_OUTAGE_START)} to ${D(EU_OUTAGE_END)} (exclusive) the EU instance servers fail: ${OUTAGE_FAIL * 100}% of EU dungeon launches never start (no "dungeon started" or "dungeon finished"; a matchmade run's "dungeon queued" still fires), and EU matchmade waits run x${OUTAGE_QUEUE_MULT} (the group finder retries launches; warehouse avg_queue_seconds carries the same factor). NA and APAC are untouched. The outage days and region come from warehouse server_health_daily (incident_severity = 'sev1', instance_launch_success_rate ≈ ${(1 - OUTAGE_FAIL).toFixed(2)}). Event read: EU / other-region "dungeon started" on outage days vs the ${INC_BASE_DAYS} days either side reads 1 - ${OUTAGE_FAIL} = ${(1 - OUTAGE_FAIL).toFixed(2)}.`,
		mixpanelReport: { type: "Insights", event: "dungeon started", measure: "total", breakdown: "server_region", chart: "daily line", join: "warehouse server_health_daily.incident_severity / instance_launch_success_rate" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, server_region FROM ${WH("server_health_daily")} WHERE incident_severity = 'sev1'),
od AS (SELECT DISTINCT d FROM o), orr AS (SELECT DISTINCT server_region FROM o),
w AS (SELECT t::DATE AS d, uid, (server_region IN (SELECT server_region FROM orr)) AS hit FROM ev
  WHERE event = 'dungeon started' AND t >= TIMESTAMP '${TS(addDays(EU_OUTAGE_START, -INC_BASE_DAYS))}' AND t < TIMESTAMP '${TS(addDays(EU_OUTAGE_END, INC_BASE_DAYS))}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE hit)::DOUBLE / count(*) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				// about 460 EU launches survive on outage days (relative SE ≈ 5%): knob target, half-effect floor
				expect: { metric: "a.did", op: "<=", target: 1 - OUTAGE_FAIL, floor: 1 - 0.5 * OUTAGE_FAIL },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE incident_severity = 'sev1') AS outage_rows,
 avg(instance_launch_success_rate) FILTER (WHERE incident_severity = 'sev1') AS outage_success
FROM ${WH("server_health_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse launch success during the outage = 1 - the failure knob
				expect: { metric: "a.outage_success", op: "between", target: band(1 - OUTAGE_FAIL) },
			},
		],
	},
	{
		id: "H5-paid-channel-economics",
		hook: "H5",
		archetype: "funnel-conversion-by-segment",
		narrative: `TikTok is Emberfall's cheapest paid channel per install and its weakest at onboarding. Warehouse ua_spend_daily bills install-optimized campaigns: each day ${SPEND_PLAN_SHARE * 100}% of spend is a paced budget (a weekday shape above a ${SPEND_FLAT_SHARE * 100}% floor) and ${(1 - SPEND_PLAN_SHARE) * 100}% is the bid x that day's delivered signups, with seeded ±${SPEND_NOISE * 100}% day noise: $${CPI_USD.tiktok_ads} TikTok, $${CPI_USD.meta_ads} Meta, $${CPI_USD.google_ads} Google, $${CPI_USD.youtube_creators} YouTube creators per Mixpanel signup over the window. TikTok signups finish the tutorial at ${TIKTOK_TUTORIAL_MULT}x the rate of every other channel in both experiment arms (two declared Onboarding first funnels with acquisition_channel conditions). Spend per tutorial finisher therefore comes out close between TikTok and Meta: (${CPI_USD.tiktok_ads} / ${TIKTOK_TUTORIAL_MULT}) / ${CPI_USD.meta_ads} = ${(CPI_USD.tiktok_ads / TIKTOK_TUTORIAL_MULT / CPI_USD.meta_ads).toFixed(3)}.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "ua_spend_daily.spend_usd", funnel: `account created → tutorial completed, ${TUTORIAL_WINDOW_DAYS}-day window, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, g: { where: { grp: "google_ads" } } },
				expect: { metric: "t.spend_per_signup / g.spend_per_signup", op: "between", target: band(CPI_USD.tiktok_ads / CPI_USD.google_ads) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, o: { where: { grp: "non_tiktok" } } },
				expect: { metric: "t.completion / o.completion", op: "between", target: band(Math.round(TUTORIAL_CONV * TIKTOK_TUTORIAL_MULT) / TUTORIAL_CONV) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, m: { where: { grp: "meta_ads" } } },
				expect: { metric: "t.spend_per_completer / m.spend_per_completer", op: "between", target: band(CPI_USD.tiktok_ads / TIKTOK_TUTORIAL_MULT / CPI_USD.meta_ads) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H6-queue-time-by-role",
		hook: "H6",
		archetype: "funnel-ttc-by-segment",
		narrative: `Matchmade dungeon queues pop by role scarcity: the wait from "dungeon queued" to "dungeon started" (same run_id) is log-normal with a ${QUEUE_MEDIAN_S}-second median for damage dealers, x${ROLE_QUEUE_MULT.healer} for healers and x${ROLE_QUEUE_MULT.tank} for tanks (profile main_role; the queue event carries role). Premade and solo runs do not queue. Read: median wait per run by main_role, healer/dps and tank/dps.`,
		mixpanelReport: { type: "Funnels", steps: ["dungeon queued", "dungeon started"], counting: "totals", holdPropertyConstant: "run_id", window: "1 hour", measure: "median time to convert", breakdown: "user property main_role (or event property role)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { h: { where: { grp: "healer" } }, d: { where: { grp: "dps" } } },
				expect: { metric: "h.median_wait_s / d.median_wait_s", op: "between", target: band(ROLE_QUEUE_MULT.healer) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { k: { where: { grp: "tank" } }, d: { where: { grp: "dps" } } },
				expect: { metric: "k.median_wait_s / d.median_wait_s", op: "between", target: band(ROLE_QUEUE_MULT.tank) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H7-pc-pack-mix-and-store-fees",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `PC players buy bigger Ember packs, and PC keeps more of each dollar. Ember pack choice depends on the platform of the purchase: the declared pack mix gives an average pack price of $${AVG_PACK_PRICE.pc.toFixed(2)} on PC vs $${AVG_PACK_PRICE.mobile.toFixed(2)} on iOS/Android (x${GEM_RATIO.toFixed(3)}). Store fees exist only in warehouse store_revenue_daily: the app stores take ${STORE_FEE.ios * 100}% and the PC launcher webshop pays ${STORE_FEE.pc * 100}% processing, so warehouse net revenue per Mixpanel Ember purchase is x${GEM_RATIO.toFixed(3)} x ${1 - STORE_FEE.pc} / ${1 - STORE_FEE.ios} = x${NET_RATIO.toFixed(3)} on PC (untracked purchases and refunds in the warehouse have the same expected share on every platform).`,
		mixpanelReport: { type: "Insights + warehouse", event: "purchase completed (product_type = embers)", measure: "average price_usd", breakdown: "platform (pc vs ios + android)", join: "store_revenue_daily.net_revenue_usd by date, platform, product_type" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { p: { where: { grp: "pc" } }, m: { where: { grp: "mobile" } } },
				expect: { metric: "p.avg_price / m.avg_price", op: "between", target: band(GEM_RATIO) },
				// about 480 mobile Ember buyers (≈2,350 purchases carry the read)
				minCohort: 200,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { p: { where: { grp: "pc" } }, m: { where: { grp: "mobile" } } },
				expect: { metric: "p.net_per_purchase / m.net_per_purchase", op: "between", target: band(NET_RATIO) },
				// about 480 mobile Ember buyers (≈2,350 purchases carry the read)
				minCohort: 200,
			},
		],
	},
	{
		id: "H8-season4-brings-veterans-back",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `Before Season 4, ${LAPSED_SHARE * 100}% of veterans (players who joined before ${D(DATASET_START)}) had lapsed: they played on only ${LAPSED_KEEP * 100}% of the days they otherwise would (salted per day). Season 4 "Frostbound" launches ${D(SEASON4_LAUNCH)} with a new Ember Pass and the ${NEW_DUNGEON} dungeon (${NEW_DUNGEON_SHARE * 100}% of runs after launch; none before). ${RETURN_SHARE * 100}% of lapsed veterans return on a salted day in the first ${RETURN_SPREAD_DAYS} days and play fully from then on. Read: veteran DAU ("${GAME_LAUNCHED}" uniques among players with no "account created" in the window), ${D(H8_AFTER[0])} to ${D(addDays(H8_AFTER[1], -1))} over ${D(H8_BEFORE[0])} to ${D(addDays(H8_BEFORE[1], -1))}: (1 - L + L(R + (1 - R)k)) / (1 - L + Lk) = ${H8_EXPECTED.toFixed(3)}.`,
		mixpanelReport: { type: "Insights", event: GAME_LAUNCHED, measure: "uniques, daily", filter: "cohort: did not do account created in the window", chart: "4 weeks before Aug 6 vs Aug 13 - Sep 9" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "veterans" } } },
				expect: { metric: "a.lift", op: "between", target: band(H8_EXPECTED) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE t < TIMESTAMP '${TS(SEASON4_LAUNCH)}') AS early,
 count(*) FILTER (WHERE t >= TIMESTAMP '${TS(SEASON4_LAUNCH)}')::DOUBLE / (SELECT count(*) FROM ev WHERE event = 'dungeon started' AND t >= TIMESTAMP '${TS(SEASON4_LAUNCH)}') AS share_after
FROM ev WHERE event = 'dungeon started' AND dungeon_name = '${NEW_DUNGEON}'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: the new dungeon does not exist before launch
				expect: { metric: "a.early", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H9-double-xp-weekend",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative: `The Double XP weekend runs ${D(DOUBLE_XP_START)} to ${D(DOUBLE_XP_END)} (exclusive, Fri-Sun). Every run in the window carries xp_multiplier = 2 and doubled xp_earned, and each run brings an extra run right after it with probability ${DOUBLE_XP_EXTRA} (players chain runs while XP is doubled), so dungeon runs per daily active player rise x${1 + DOUBLE_XP_EXTRA}; the number of players who log in does not change. Read: "dungeon started" per "${GAME_LAUNCHED}" unique player-day, event Fri-Sun vs the same Fri-Sun one week before and one week after.`,
		mixpanelReport: { type: "Insights", events: ["dungeon started (total)", `${GAME_LAUNCHED} (uniques)`], formula: "A / B", chart: "daily; Aug 21-23 vs Aug 14-16 and Aug 28-30" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { x: { where: { grp: "double_xp" } }, n: { where: { grp: "normal" } } },
				expect: { metric: "x.runs_per_dau / n.runs_per_dau", op: "between", target: band(1 + DOUBLE_XP_EXTRA) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H10-party-size-clear-rate",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative: `Dungeons are tuned for groups. The chance that a run ends with result = cleared depends on party_size: solo ${CLEAR_RATE[1] * 100}%, 2 players ${CLEAR_RATE[2] * 100}%, 3 ${CLEAR_RATE[3] * 100}%, 4 ${CLEAR_RATE[4] * 100}%, a full party of 5 ${CLEAR_RATE[5] * 100}%. Matchmade runs are always a full party; premade parties have 2-5 players; ${QUEUE_TYPE_WEIGHTS.solo}% of runs are solo. Read: cleared share of "dungeon finished" by party_size, solo / full and duo / full.`,
		mixpanelReport: { type: "Insights", events: ["dungeon finished (result = cleared)", "dungeon finished"], formula: "A / B", breakdown: "party_size" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { s: { where: { grp: "p1" } }, f: { where: { grp: "p5" } } },
				expect: { metric: "s.clear_rate / f.clear_rate", op: "between", target: band(CLEAR_RATE[1] / CLEAR_RATE[5]) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { d: { where: { grp: "p2" } }, f: { where: { grp: "p5" } } },
				expect: { metric: "d.clear_rate / f.clear_rate", op: "between", target: band(CLEAR_RATE[2] / CLEAR_RATE[5]) },
				minCohort: 1000,
			},
		],
	},
];

export default config;

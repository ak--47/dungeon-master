// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       Forgebench
 * APP:        Developer platform: import a repository, push branches that build
 *             a preview deployment each, run CI builds on hosted runners, review
 *             and merge pull requests, ship to production. Free plus Pro ($12
 *             per developer), Team ($29 per seat; runner-minute overage billed
 *             from 2026-09-01), and sales-led Enterprise. Forge Assist (AI code
 *             review) is a Pro/Team/Enterprise feature from 2026-07-29. The plan
 *             belongs to the organization (Free, Team, or Enterprise); at Free
 *             organizations some developers pay for their own Pro seat.
 * SCALE:      10,000 developers (9,987 with events; 4,544 sign up inside the
 *             window), ~0.98M events (981,965), 120 days (2026-06-04 → 2026-10-01, UTC),
 *             500 customer organizations (492 with developers, 1 to 270 each)
 * CORE LOOP:  commit pushed → preview deployed; build started → build finished;
 *             pull request opened → review submitted → pull request merged →
 *             production deployed
 * VALUE MOMENT: preview deployed (the first one ends setup)
 *
 * EVENTS (21):
 *   build started / build finished (CI Build funnel, weight 8) > code browsed (9,
 *   catch-all) > pull request opened → review submitted → pull request merged →
 *   production deployed (Pull Request funnel, weight 4) > commit pushed →
 *   preview deployed (Preview funnel, weight 5) > cli command run (4) > docs
 *   viewed (3) > logs viewed (3) > issue created (2) > environment variable
 *   updated (1) > teammate invited (1, thinned in the hook) > funnel-only:
 *   account created, repository imported, pipeline configured, upgrade page
 *   viewed, subscription started, $experiment_started
 *
 * FUNNELS (9):
 *   - Onboarding (first funnel, four copies by stack group × paid social, H3/H7):
 *       account created → repository imported → pipeline configured → preview deployed
 *       (64% Node/Python/Go/Ruby/Rust, 35% Java/.NET; × 0.6 for paid social: 38% / 21%)
 *   - Pull Request: opened → review submitted → merged → production deployed
 *       (62%, pr_id per PR; the hook rebuilds the PR clock)
 *   - CI Build: build started → build finished (94%, build_id per build; A/B
 *       "Remote Build Cache" from 2026-07-08, assignment + exposure only)
 *   - Preview: commit pushed → preview deployed (72%, commit_sha per push)
 *   - Upgrade (Free new signups, customer_since ≥ window start): upgrade page
 *       viewed → subscription started (34%); Upgrade (established Free
 *       developers): same steps (40%, then a 13% base keep in the hook)
 *
 * USER PROPS:  org_id, org_name, org_size, industry, role, primary_stack,
 *              plan_tier, customer_since, acquisition_channel,
 *              "Experiment: Remote Build Cache" (enrolled developers)
 * SUPER PROPS: plan_tier (plan at event time), primary_stack (sticky per developer)
 * SCD PROPS:   none
 * GROUPS:      org_id (500 organizations; every event carries the developer's own org)
 * WAREHOUSE:   marketing_spend_daily (spend by paid channel),
 *              build_fleet_daily (fleet and registry mirror health by ecosystem),
 *              usage_billing_daily (billed runner minutes and overage by plan)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        weekday-heavy dayOfWeekWeights (Friday lighter), Americas + Europe +
 *              Asia working hours overlapping in UTC (profiles use the engine's
 *              location mix: about 60% US; 01-business says so)
 *
 * IDENTITY: new developers are identified at "account created" (isAuthEvent,
 * first event, carries user_id + device_id); 2 devices per developer on
 * average. Every event carries user_id; there is no anonymous pre-signup
 * activity. The post-auth onboarding steps (repository imported, pipeline
 * configured, the onboarding preview deployed) carry user_id only; every other
 * event also carries device_id.
 *
 * DESIGN NOTES:
 * - Hooks draw randomness only from hashFloat salts (per developer, PR, build,
 *   org, or insert_id), never from the shared chance stream, so hook edits do
 *   not reshuffle the engine's population, funnels, or timing.
 * - Organizations come from one seeded table of 500. Each org draws a size, a
 *   plan (hash by size: startups mostly Free, enterprises mostly Enterprise,
 *   with Free at every size for bottom-up adoption), and a developer target,
 *   log-uniform inside its size's range (startup 3-14, smb 6-35, mid-market
 *   15-75, enterprise 60-400; realized ≈ 0.8x). Free orgs fill 75% of their
 *   seats with in-window signups (self-serve evaluators), paying orgs 20%, so
 *   developers map to orgs through two hash cumulatives (established, new).
 *   employee_count follows the expected developer count inside the size's
 *   bands ('1-10' under 4 developers, '5000+' from 150), so headcount and
 *   developers agree. The group hook writes the table onto the org profiles.
 *   Established developers take the org's plan; 35% of developers at Free orgs
 *   pay for their own Pro seat. A new signup at a Team or Enterprise org joins
 *   that plan and has nothing to buy. A Team purchase at a Free org opens a
 *   Team workspace for that developer's group; teammates stay on Free
 *   (01-business says so).
 * - Builds: the hook decides status and failure stage per build (14% fail; a
 *   new developer's first build 40%), and sets build_duration_sec as the real
 *   start → finish gap: log-normal (median 7 min, σ 0.55) × runner size
 *   (large 0.8, xlarge 0.65) × the H2 arm; a failed build stops at its stage.
 *   tests_run is 0 for configuration, dependency-install, and compile failures
 *   and a salted 20-100% of the suite for test failures and timeouts.
 * - Scheduled (cron) builds move to a hashed day of their own Monday-Sunday
 *   week at the repository's nightly hour (01:00-05:59 UTC), so they run flat
 *   across all seven days; the holiday drop skips them. They stay inside the
 *   window and after signup; the H2 exposure moves with them (1 s before the
 *   first build in the test). Activity cuts still remove them: churned
 *   evaluators' cron jobs stop with their account.
 * - Pull requests: lines_changed is log-normal (median 120); each developer
 *   works in 1-3 repositories whose test coverage (10-95%) comes from a hash.
 *   The hook rebuilds each PR's clock from the open: review wait (H4), review →
 *   merge (H1), merge → deploy. 80% of developers pause reviews and merges over
 *   the weekend: a step that would land Saturday 06:00 - Monday 00:00 UTC lands
 *   on Monday 07:00-18:00 UTC in the same order (the Monday catch-up), and a
 *   production deploy that would land in the weekend ships Monday morning.
 *   review_wait_hours is the final open → review gap, weekend pause included.
 * - Low-discrepancy draws (frac(offset + n·φ), per developer-repository and per
 *   developer) place rollbacks (H9) and scheduled-build cuts (H8), so realized
 *   rates follow the knobs without binomial noise.
 * - Purchases: one per developer, and no upgrade visits after it. A new
 *   developer's would-be purchases (Upgrade funnel conversions) count only in
 *   their first 42 days, and each one happens at the H10 keep share, so a
 *   developer who passes on one visit can buy on a later one. Window start:
 *   established Free developers buy at a steady base rate (13% of first
 *   would-be purchases), plus (in June) developers who signed up in the six
 *   weeks before June 4 and are still in their buying window (their
 *   customer_since is moved into that span; the extra share fades as
 *   0.5 × 0.87 × (1 − d/42)²), so purchases hold near 15-20 a week from the
 *   start while in-window signups' purchases build up (monthly 68 in the
 *   partial June, then 71, 92, 82).
 * - Upgrade page warm start: established Free developers' upgrade visits taper
 *   linearly from all of them on June 4 to 50% at the window end (the visit
 *   before a purchase stays), while in-window Free signups' visits build up
 *   with the Free base.
 * - New developers who never finish onboarding: 60% stop on a salted day
 *   0.2-3 (at least 1 h after the last setup step they reached); the rest keep
 *   a salted 25-60% of their work units (whole builds, PRs, pushes; the first
 *   build always stays), exploring docs and public code.
 * - Evaluation churn: 45% of new developers stop on day 1 + 27·u² after
 *   signup (most leave early; at least 12 h after their last setup step),
 *   whatever happened in setup. New-signup activity: day 1 71%, days 7-13
 *   43%, days 30-36 27%. The draw is independent of the first build, so
 *   H5's ratio holds. A stop removes every later event, and an upgrade visit
 *   whose purchase would land after the stop goes with it (one unit).
 * - Collaboration volume: new developers keep every teammate invite in their
 *   first 14 days; other invites are thinned to 25% (≈10 per org in 120 days).
 * - Experiment exposure: the engine sends one $experiment_started per developer,
 *   1 s before their first CI build in the test. The hook moves scheduled
 *   builds and cuts activity, so it keeps the exposure 1 s before the
 *   developer's first surviving build in the test (the arm applies from there)
 *   and drops the exposure and the profile's assignment when no build in the
 *   test survives.
 * - US holidays (Jul 3, Sep 7): for US-based developers (country_code US,
 *   about 60% of profiles), 55% of work units (whole PRs, builds, previews,
 *   standalone events) that would start that day do not happen; developers in
 *   other countries work as usual.
 * - Warehouse drift: build_fleet_daily adds seeded API-triggered jobs (corr ≈
 *   0.98 with the event count); usage_billing_daily meters runner minutes
 *   across parallel jobs (×2-14 by plan), shifts 30% of a UTC day to the next
 *   billing day, and adds retries and API minutes (corr ≈ 0.93); Team overage
 *   follows pooled monthly allowances that reset on the 1st (allowances
 *   uniform over 15-150% of an org's monthly usage), so overage is zero for
 *   the first days of a month and grows as orgs run out;
 *   marketing_spend_daily bills target cost per signup × (25% of the day's
 *   Mixpanel signups + 75% of the planned signups at that week's budget) ×
 *   seeded ±12% noise (corr ≈ 0.93).
 * - Weekly media budget (H7): each paid channel has a weekly budget level (a
 *   9-week swing of ±25% plus a seeded ±10% week-to-week change, window mean
 *   1). A new signup's acquisition_channel is drawn with each paid channel's
 *   weight scaled by that week's budget, so spending more buys more paid
 *   signups (weekly paid share vs budget: corr ≈ 0.75).
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, or a cohort. Dates live in the TIMELINE constants and are
 * shared by hooks, stories, SQL, warehouse columns, and the timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. FORGE ASSIST LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-29, 50% of developers on Pro, Team, or Enterprise
 *   (plan at the PR's open) turn on Forge Assist, each on a salted day in the
 *   28 days after launch, and use it on a salted 60-100% of their PRs (mean
 *   80%), so the assisted share of eligible PRs ramps for four weeks and then
 *   holds at 40% (review_mode = "forge_assist" on all four PR steps). Assisted
 *   PRs go from review to merge in 0.6x the time. Review wait and rollbacks
 *   are untouched (honest nulls).
 * MIXPANEL: Funnels, review submitted → pull request merged, hold pr_id
 *   constant, median time to convert, breakdown review_mode, filter plan_tier
 *   in (pro, team, enterprise), from 2026-07-29; weekly share of review_mode on
 *   pull request opened shows the ramp.
 * REAL WORLD: an AI first pass catches the obvious problems, so the human
 *   approval round is shorter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. REMOTE BUILD CACHE EXPERIMENT (declarative assignment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 developers split 50/50 at their first build in the
 *   test (one $experiment_started each); "Remote Cache" builds take 0.6x as
 *   long (build_duration_sec and the start → finish gap). Pass/fail does not
 *   change.
 * MIXPANEL: Insights, build finished, median build_duration_sec, filter
 *   build_status = success, breakdown user property "Experiment: Remote Build
 *   Cache"; success share by arm for the control.
 * REAL WORLD: restoring dependencies and build outputs from a shared cache
 *   skips most of the work on unchanged code.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. JAVA / .NET ONBOARDING FRICTION (declarative first funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new developers whose primary stack is Java or .NET finish setup at
 *   0.55x the rate of the other stacks (35% vs 64%; 21% vs 38% for paid
 *   social). Losses spread over the import, pipeline, and preview steps.
 * MIXPANEL: Funnels, account created → repository imported → pipeline
 *   configured → preview deployed, 7-day window, breakdown primary_stack.
 * REAL WORLD: JVM and .NET builds need more configuration (build tool,
 *   runtime version, private package feeds) before the first green deploy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. LARGE PULL REQUESTS WAIT FOR REVIEW (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: open → first review wait is a log-normal (median 3 h) × a size
 *   multiplier: 1 up to 100 lines changed, rising log-linearly to 2.5 at
 *   1,000+ lines. Organization size has no effect (honest null).
 * MIXPANEL: Funnels, pull request opened → review submitted, hold pr_id
 *   constant, median time to convert, breakdown lines_changed (custom buckets).
 * REAL WORLD: reviewers put off big diffs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. RED FIRST BUILD → CHURN (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a new developer's first build fails 40% of the time (mostly
 *   configuration). 50% of developers whose first build fails stop 1-4 days
 *   after it. D30 retention passed / failed (first build within 14 days of
 *   signup) = 1/(1 − 0.5) = 2.0.
 * MIXPANEL: Funnels, account created → build finished (14-day window),
 *   breakdown build_status of step 2; save cohorts; Retention account created →
 *   any event, custom bracket day 30-36, breakdown by those cohorts.
 * REAL WORLD: a red first run before anything works is where evaluators give up.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. NPM REGISTRY MIRROR INCIDENT (everything + warehouse build_fleet_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-19 to 2026-08-20, 60% of npm builds that would have passed
 *   fail at dependency_install. The warehouse shows registry_mirror_status =
 *   "degraded" and dependency_fetch_error_rate ≈ 0.6 for npm on those days.
 *   Events carry no incident flag.
 * MIXPANEL: Insights, build finished, share build_status = success, daily,
 *   breakdown ecosystem; join the warehouse status.
 * REAL WORLD: a flaky package mirror looks like "our builds broke" until
 *   someone checks the status page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. PAID CHANNEL ECONOMICS (declarative funnel copies + warehouse marketing_spend_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: window spend per Mixpanel signup is $55 paid social, $85 paid
 *   search, $120 newsletter (target cost per signup; spend = a quarter of the
 *   day's signups plus three quarters of the planned signups at the week's
 *   budget, × cost per signup × seeded ±12% noise, never zero). The weekly
 *   budget moves each channel's share of new signups. Paid social signups
 *   finish onboarding at 0.6x, so per onboarded developer paid search is
 *   cheaper than paid social.
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   marketing_spend_daily.spend_usd; Funnels onboarding steps, 7-day window,
 *   breakdown acquisition_channel.
 * REAL WORLD: social clicks are cheap and low intent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. TEAM OVERAGE BILLING (everything + warehouse usage_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-09-01 Team pays $0.015 per runner minute above its pooled
 *   allowance. Each Team org acts on a salted day in Sep 1-14 and turns off a
 *   salted 30-70% (mean 50%) of its scheduled builds (whole build units).
 *   Scheduled per push builds, Team, Sep 15-30 vs August = 0.5; other plans
 *   1.0. Overage revenue exists only in the warehouse (zero before Sep 1 and on
 *   other plans); allowances reset monthly, so no overage on days 1-3 of a
 *   month and some on every Team day from Sep 8.
 * MIXPANEL: Insights, build started, breakdown trigger and plan_tier, weekly,
 *   formula schedule / push; join usage_billing_daily.overage_revenue_usd.
 * REAL WORLD: metering makes customers switch off nightly builds nobody reads.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. TEST COVERAGE AND ROLLBACKS (everything, dose-response)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: production deploys roll back at 20% from repositories at ≤30% test
 *   coverage, falling linearly to 5% at ≥75%. PR size and Forge Assist do not
 *   change rollbacks (honest nulls).
 * MIXPANEL: Insights, production deployed, share deploy_outcome = rolled_back,
 *   breakdown test_coverage_pct (custom buckets).
 * REAL WORLD: tests catch regressions before users do.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. PREVIEW HABIT → PAID SEAT (everything, threshold)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new developers with 3+ preview deploys in their first 14 days keep
 *   every would-be purchase; everyone else keeps 40% of each one. Purchases per
 *   upgrade-page visit in the first 42 days, habit vs light (1-2 previews),
 *   read 1.0/0.4 = 2.5 (a developer stops visiting after buying, so the visit
 *   count does not bias it). Paid rate within 42 days, habit vs light, is ≥ 2.5
 *   (a floor: habit developers also reach the upgrade page more often).
 * MIXPANEL: Funnels account created → preview deployed ×3 (14-day window) to
 *   build the cohorts; Funnels account created → subscription started (42-day
 *   window), filter account created plan_tier = free, breakdown by cohort;
 *   Insights, total subscription started ÷ total upgrade page viewed (formula
 *   B/A), filter the same cohorts (purchases per visit).
 * REAL WORLD: developers who use previews in their review loop have adopted
 *   the product and buy it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-devtools, 2026-10-07)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation                | Expected | Measured
 * -----|------------------------------------------------|---------------------------|----------|---------
 * H1   | assisted rows pre-launch or on Free            | exact purity              | 0        | 0
 * H1   | median review → merge, assisted / standard     | ASSIST_MERGE_MULT         | 0.60     | 0.593 (3.58 vs 6.03 h)
 * H1   | assisted share of eligible PRs after the ramp  | 0.5 × 0.8                 | 0.40     | 0.387 (weekly 1.3% → 39%)
 * H2   | median passed build time, Remote Cache/Control | CACHE_TTC_MULT            | 0.60     | 0.604 (235 vs 389 s)
 * H2   | build success rate, Remote Cache/Control       | unchanged                 | 1.00     | 1.004 (85.3% vs 85.0%)
 * H2   | Remote Cache share of exposed developers       | equal 2-arm hash          | 0.50     | 0.497
 * H3   | 7-day onboarding, Java+.NET / other stacks     | SLOW_STACK_MULT           | 0.55     | 0.593 (36.2% vs 61.0%)
 * H4   | median open → review, 1,000+ / ≤100 lines      | LARGE_PR_WAIT_MULT        | 2.50     | 2.509 (8.07 vs 3.21 h)
 * H5   | D30 retention, first build passed / failed     | 1/(1 − RED_DARK_SHARE)    | 2.00     | 2.027 (46.1% vs 22.8%)
 * H6   | npm/other success, incident vs ±7 days         | 1 − INCIDENT_FAIL         | 0.40     | 0.440
 * H6   | warehouse dependency_fetch_error_rate, degraded| INCIDENT_FAIL             | 0.60     | 0.615
 * H7   | spend per signup, paid social / paid search    | 55 / 85                   | 0.647    | 0.644 ($53.51 vs $83.05)
 * H7   | 7-day onboarding, paid social / other channels | SOCIAL_ONBOARD_MULT       | 0.60     | 0.613 (35.4% vs 57.7%)
 * H8   | Team scheduled per push, Sep 15-30 / August    | 1 − SCHEDULED_CUT_MEAN    | 0.50     | 0.480 (0.125 vs 0.261)
 * H8   | other plans scheduled per push (control)       | unchanged                 | 1.00     | 0.918
 * H8   | overage rows off Team or before Sep 1 / missing| exact                     | 0 / 0    | 0 / 0 ($4,720 in September)
 * H9   | rollback rate, ≤30% / ≥75% coverage            | 0.20 / 0.05               | 4.00     | 4.218 (19.8% vs 4.70%)
 * H10  | 42-day paid rate, 3+ / 1-2 previews (14 days)  | ≥ 1.0 / 0.4 (floor)       | ≥ 2.50   | 5.324 (29.3% vs 5.5%, STRONG)
 * H10  | purchases per upgrade visit (42 days), 3+ / 1-2| PQL_KEEP / NON_PQL_KEEP   | 2.50     | 2.298 (31.5% vs 13.7%)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * H10's paid rate is a knob floor: developers with 3+ early previews are also
 * heavier users who reach the upgrade page more often (59.3% vs 29.2% visit it
 * within 42 days, 2.0x), so the expected ratio is about 2.5 × 2.0 ≈ 5 before
 * noise; realized 5.32 on 110 + 55 buyers (Free signups only: 376 habit, 1,001
 * light). Purchases per visit control for that reach and read the keep ratio
 * (2.30 on 349 and 401 visits). H6 (0.440) sits at the band edge: npm builds on
 * the two incident days number 1,072, so the incident success rate (37.2% vs
 * 34.2% expected) carries about ±1.5 points of noise. H8's control (0.918) is
 * noise on about 3,000 (August) and 1,500 (Sep 15-30) scheduled builds. H3 and H7 come from engine
 * funnel draws; H8 and H9 use low-discrepancy draws within each developer.
 */

// ── SCALE ──
const SEED = "dm4-devtools";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const REMOTE_CACHE_START = "2026-07-08T00:00:00Z";      // "Remote Build Cache" CI experiment starts
const ASSIST_LAUNCH = "2026-07-29T00:00:00Z";           // Forge Assist (AI code review) for Pro, Team, Enterprise
const REGISTRY_INCIDENT_START = "2026-08-19T00:00:00Z"; // npm registry mirror degraded
const REGISTRY_INCIDENT_END = "2026-08-21T00:00:00Z";   // exclusive (2 days)
const METERED_START = "2026-09-01T00:00:00Z";           // Team plan build-minute overage billing starts
const HOLIDAYS = ["2026-07-03", "2026-09-07"];          // US Independence Day (observed), Labor Day

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const D0 = DATASET_START.slice(0, 10);

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Engineers ship on weekdays; Friday is lighter, weekends are side projects.
const DOW_WEIGHTS = [0.22, 1.0, 1.02, 1.0, 0.95, 0.78, 0.2];
// UTC hours: India (03-12 UTC), Europe (07-16 UTC), and the Americas (13-01 UTC) overlap.
const HOUR_WEIGHTS = [0.42, 0.34, 0.3, 0.36, 0.44, 0.52, 0.6, 0.7, 0.8, 0.86, 0.88, 0.86,
	0.88, 0.96, 1.0, 1.0, 0.97, 0.9, 0.82, 0.72, 0.64, 0.58, 0.52, 0.47];

// ── KNOBS ──
// H1 Forge Assist (AI code review): review → merge time for assisted PRs
const ASSIST_PLANS = ["pro", "team", "enterprise"];
const ASSIST_ADOPTER_SHARE = 0.5;  // share of eligible developers who turn it on (salted per user)
const ASSIST_USE = 0.8;            // mean share of an adopter's PRs that get an assisted review (per adopter: ±0.2)
const ASSIST_USE_SPREAD = 0.2;
const ASSIST_RAMP_DAYS = 28;       // each adopter starts on a salted day in the 4 weeks after launch
const ASSIST_SHARE = ASSIST_ADOPTER_SHARE * ASSIST_USE; // 0.40 of eligible PRs once ramped
const ASSIST_MERGE_MULT = 0.6;     // review → merge time with Forge Assist

// H2 Remote Build Cache experiment (declarative funnel experiment on CI Build)
const CACHE_EXPERIMENT = "Remote Build Cache";
const CACHE_VARIANT = "Remote Cache";
const EXP_KEY = `Experiment: ${CACHE_EXPERIMENT}`; // profile key the engine stamps
const CACHE_TTC_MULT = 0.6;        // build duration with the remote cache
const BUILD_MEDIAN_SEC = 420;      // median pipeline time on a standard runner
const BUILD_DURATION_SIGMA = 0.55;
const RUNNER_SPEED = { standard: 1, large: 0.8, xlarge: 0.65 };
const BUILD_CONV = 94;             // share of started builds that finish (the rest are cancelled)
const BUILD_TTC_H = 0.3;

// H3 onboarding by stack (declarative first funnels)
const ONBOARD_CONV = 64;
const SLOW_STACKS = ["java", "dotnet"];
const SLOW_STACK_MULT = 0.55;
const ONBOARD_TTC_H = 36;

// H4 review wait by PR size (log-linear between 100 and 1,000 lines changed)
const REVIEW_WAIT_MEDIAN_H = 3;
const SMALL_PR_LINES = 100;
const LARGE_PR_LINES = 1000;
const LARGE_PR_WAIT_MULT = 2.5;
const reviewWaitMult = (lines) => {
	if (lines <= SMALL_PR_LINES) return 1;
	if (lines >= LARGE_PR_LINES) return LARGE_PR_WAIT_MULT;
	return 1 + (LARGE_PR_WAIT_MULT - 1) * Math.log10(lines / SMALL_PR_LINES);
};
const MERGE_GAP_MEDIAN_H = 6;
const WEEKENDS_OFF_SHARE = 0.8;    // developers who pause reviews, merges, and production deploys on weekends
const WEEKEND_PAUSE_MS = 42 * HOUR_MS; // Saturday 06:00 → Monday 00:00 UTC
const MONDAY_CATCHUP_FROM_H = 7;     // paused reviews and merges land Monday 07:00-18:00 UTC
const MONDAY_CATCHUP_SPAN_H = 11;
const DEPLOY_GAP_MEDIAN_MIN = 30;

// H5 first build red → new developers go quiet
const FIRST_BUILD_FAIL = 0.4;      // a new developer's first CI build (config mistakes)
const BASE_BUILD_FAIL = 0.14;      // every other build
const RED_DARK_SHARE = 0.5;        // share of red-first new users who stop 1-4 days after that build
const RED_DARK_MIN_D = 1;
const RED_DARK_MAX_D = 4;
const FIRST_BUILD_DAYS = 14;       // story cohort: first build within 14 days of signup
const SETUP_ABANDON_SHARE = 0.6;   // new users who never finish onboarding: share who stop on day 1-4
const SETUP_ABANDON_MIN_D = 0.2;
const SETUP_ABANDON_MAX_D = 3;

// H6 npm registry mirror incident (warehouse build_fleet_daily)
const INCIDENT_ECOSYSTEM = "npm";
const INCIDENT_FAIL = 0.6;         // share of would-be successful npm builds that fail during the incident

// H7 paid channel economics (warehouse marketing_spend_daily)
const PAID_CHANNELS = ["paid_search", "paid_social", "newsletter"];
const CPL_USD = { paid_search: 85, paid_social: 55, newsletter: 120 }; // window spend per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 28, referral: 14, community: 10, paid_search: 20, paid_social: 16, newsletter: 12 };
const SOCIAL_ONBOARD_MULT = 0.6;   // paid social signups finish onboarding at 0.6x
const BORN_PCT = 45;               // percentUsersBornInDataset
const WINDOW_DAYS = 120;
// weekly media budget per paid channel (the growth team's plan, set before each week):
// a slow seasonal swing plus a seeded week-to-week change, normalized to a window mean of 1.
// A bigger budget buys more paid signups: a new signup's channel is drawn with each paid
// channel's weight scaled by that week's budget level (handleUserHook).
const BUDGET_SWING = 0.25;        // amplitude of the slow budget swing
const BUDGET_PERIOD_WEEKS = 9;
const BUDGET_WEEK_NOISE = 0.1;    // seeded week-to-week change (±)
const WINDOW_WEEKS = Math.ceil(WINDOW_DAYS / 7);
const BUDGET = Object.fromEntries(PAID_CHANNELS.map((ch, i) => {
	const raw = Array.from({ length: WINDOW_WEEKS }, (_, w) => 1 + BUDGET_SWING * Math.sin(2 * Math.PI * (w / BUDGET_PERIOD_WEEKS + i / PAID_CHANNELS.length))
		+ (hashFloat(`budget|${ch}|${w}`) - 0.5) * 2 * BUDGET_WEEK_NOISE);
	const mean = raw.reduce((x, y) => x + y, 0) / raw.length;
	return [ch, raw.map((x) => x / mean)];
}));
const weekOf = (t) => Math.min(WINDOW_WEEKS - 1, Math.max(0, Math.floor((t - ms(DATASET_START)) / (7 * DAY_MS))));
const channelWeightsAt = (t) => Object.fromEntries(Object.entries(CHANNEL_WEIGHTS).map(([ch, w]) => [ch, PAID_CHANNELS.includes(ch) ? w * BUDGET[ch][weekOf(t)] : w]));
// expected Mixpanel signups on a day for a paid channel: new signups per day × that day's
// weekday share × the channel's budget-scaled share of signups
const DOW_MEAN = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
const expectedSignups = (ch, t) => {
	const w = channelWeightsAt(t);
	const total = Object.values(w).reduce((a, b) => a + b, 0);
	return (NUM_USERS * BORN_PCT / 100) / WINDOW_DAYS * (DOW_WEIGHTS[new Date(t).getUTCDay()] / DOW_MEAN) * (w[ch] / total);
};
// billed spend: campaigns bid to a target cost per signup, so a quarter of a day's spend
// follows that day's conversions and the rest follows the planned budget (expected signups
// at this week's budget level)
const SPEND_SAME_DAY_SHARE = 0.25;
const SPEND_NOISE = 0.12;
const billingCarry = new Map(); // warehouse hook state: previous UTC day's build minutes per plan (reset at bucket 0)
const BILLING_DAY_SHIFT = 0.3;  // share of a UTC day's minutes that bill on the next billing day
const PLATFORM_CLICK_CPC = { paid_search: 4.2, paid_social: 1.6, newsletter: 6.5 };
const PLATFORM_CTR = { paid_search: 0.035, paid_social: 0.009, newsletter: 0.012 };
const PLATFORM_SIGNUP_INFLATION = 1.2; // ad platforms claim ~20% more signups than Mixpanel records

// H8 Team plan metered overage (warehouse usage_billing_daily)
const METERED_PLAN = "team";
const SCHEDULED_CUT_MEAN = 0.5;    // per org: share of scheduled builds switched off (uniform ±0.2)
const SCHEDULED_CUT_SPREAD = 0.2;
const SCHEDULED_CUT_RAMP_DAYS = 14; // each Team org acts on a salted day in Sep 1-14
const OVERAGE_PRICE_PER_MIN = 0.015;
// Team orgs' pooled monthly allowances, as a share of each org's own monthly usage, spread
// uniformly over [0.15, 1.5]: an org past its allowance bills every further minute that month
const ALLOWANCE_LO = 0.15;
const ALLOWANCE_HI = 1.5;
const overageShareAt = (monthFrac) => Math.min(1, Math.max(0, (monthFrac - ALLOWANCE_LO) / (ALLOWANCE_HI - ALLOWANCE_LO)));
const teamUsage = { trail: [], month: null, mtd: 0 }; // warehouse hook state (reset at bucket 0)
const PARALLEL_JOBS = { free: 2, pro: 4, team: 10, enterprise: 14 }; // parallel jobs per pipeline (billing)

// H9 rollback rate by repository test coverage (linear between 30% and 75%)
const COVERAGE_LOW = 30;
const COVERAGE_HIGH = 75;
const ROLLBACK_HIGH_COV = 0.05;
const ROLLBACK_LOW_COV = 0.2;
const rollbackRate = (cov) => {
	if (cov >= COVERAGE_HIGH) return ROLLBACK_HIGH_COV;
	if (cov <= COVERAGE_LOW) return ROLLBACK_LOW_COV;
	return ROLLBACK_LOW_COV - (ROLLBACK_LOW_COV - ROLLBACK_HIGH_COV) * (cov - COVERAGE_LOW) / (COVERAGE_HIGH - COVERAGE_LOW);
};

// H10 preview habit → paid conversion (new signups)
const PQL_DAYS = 14;
const PQL_MIN_PREVIEWS = 3;        // preview deploys in the first 14 days (the onboarding preview counts)
const PQL_KEEP = 1.0;              // share of would-be purchases kept with 3+ previews in the first 14 days
const NON_PQL_KEEP = 0.4;          // everyone else
const UPGRADE_CONV = 34;           // new signups, per upgrade-page visit
const UPGRADE_CONV_ESTABLISHED = 40; // per upgrade-page visit, before the base keep below
const BUY_WINDOW_DAYS = 42;        // self-serve purchases land in a developer's first six weeks
const EST_BASE_KEEP = 0.13;        // established free users' steady purchase rate (share of would-be purchases)
// window start: established developers who joined in the six weeks before June 4 are still
// evaluating in June; they add a share of would-be purchases that fades over 42 days
const EST_EXTRA_AMP = 0.5;
const EST_EXTRA_POW = 2;
// established Free developers' upgrade visits taper from all of them on June 4 to this share
// at the window end, as the June evaluators settle and in-window signups take over
const EST_VIEW_KEEP_END = 0.5;
const EVAL_CHURN_SHARE = 0.45;     // new users who stop on a salted day in their first four weeks (any setup outcome)
const EVAL_CHURN_MIN_D = 1;
const EVAL_CHURN_SKEW = 2;         // stop day = MIN + (MAX − MIN) · u^2: most evaluators who leave do so early
const EVAL_CHURN_MAX_D = 28;
const EVAL_CHURN_AFTER_SETUP_H = 12; // an evaluator who leaves stays at least 12 h past their last setup step
const EXPLORER_KEEP_MIN = 0.25;    // non-onboarded new users who stay: share of activity kept
const EXPLORER_KEEP_MAX = 0.6;

// collaboration volume (realism, not a story)
const INVITE_EARLY_DAYS = 14;
const INVITE_KEEP_LATE = 0.25;

// holidays (US public holidays): share of a US-based developer's user-initiated work
// units that do not happen; developers outside the US work as usual
const HOLIDAY_COUNTRY = "US";
const HOLIDAY_DROP = 0.55;

// ── DATA ARRAYS (seeded) ──
const ORG_COUNT = 500;
const SIZE_WEIGHTS = { startup: 50, smb: 28, mid_market: 15, enterprise: 7 };
// developers on Forgebench per organization: log-uniform inside the size's range (hash per org);
// realized counts land near 0.8x these targets
const DEV_RANGE = { startup: [3, 14], smb: [6, 35], mid_market: [15, 75], enterprise: [60, 400] };
const ORG_SUFFIX = ["Labs", "Systems", "Software", "Cloud", "Works", "Digital", "Health", "Pay", "Logistics", "Games"];
const INDUSTRIES = ["saas", "fintech", "ecommerce", "healthtech", "media", "gaming", "logistics", "agency"];
const STACK_WEIGHTS = { node: 32, python: 20, go: 9, ruby: 5, java: 17, dotnet: 11, rust: 6 };
const ECOSYSTEM = { node: "npm", python: "pypi", go: "go_modules", ruby: "rubygems", java: "maven", dotnet: "nuget", rust: "cargo" };
// organization plan by size (Pro is an individual plan, so no organization is "on Pro");
// larger companies also try Forgebench bottom-up on Free before anyone buys
const ORG_PLAN_MIX = {
	startup: { free: 65, team: 35, enterprise: 0 },
	smb: { free: 50, team: 45, enterprise: 5 },
	mid_market: { free: 45, team: 37, enterprise: 18 },
	enterprise: { free: 35, team: 20, enterprise: 45 },
};
const INDIVIDUAL_PRO_SHARE = 0.35;   // developers at Free organizations who pay for their own Pro seat
// share of an org's developers who signed up inside the window: Free organizations are mostly
// self-serve evaluators; paying organizations grow by onboarding colleagues
const NEW_DEV_SHARE = { free: 0.75, paid: 0.2 };
const FRAMEWORK = { node: "nextjs", python: "django", go: "go_http", ruby: "rails", java: "spring", dotnet: "aspnet", rust: "axum" };

const pickWeighted = (weights, r) => {
	const entries = Object.entries(weights);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let acc = 0;
	for (const [k, w] of entries) {
		acc += w / total;
		if (r < acc) return k;
	}
	return entries[entries.length - 1][0];
};

const ORGS = Array.from({ length: ORG_COUNT }, (_, i) => {
	const size = pickWeighted(SIZE_WEIGHTS, chance.floating({ min: 0, max: 1 }));
	return {
		id: String(i + 1),
		name: `${chance.word({ syllables: 2, capitalize: true })} ${chance.pickone(ORG_SUFFIX)}`,
		size,
		industry: chance.pickone(INDUSTRIES),
	};
});
// one plan and one developer target per organization (hash per org, so the chance stream is untouched)
for (const o of ORGS) {
	o.plan = pickWeighted(ORG_PLAN_MIX[o.size], hashFloat(`${o.id}|org-plan`));
	const [lo, hi] = DEV_RANGE[o.size];
	o.devTarget = lo * Math.pow(hi / lo, hashFloat(`${o.id}|devs`));
	o.newShare = o.plan === "free" ? NEW_DEV_SHARE.free : NEW_DEV_SHARE.paid;
}
const orgCum = (weightOf) => {
	const w = ORGS.map(weightOf);
	const total = w.reduce((a, b) => a + b, 0);
	let acc = 0;
	return w.map((x) => (acc += x / total));
};
const ORG_CUM = orgCum((o) => o.devTarget * (1 - o.newShare));
const ORG_CUM_NEW = orgCum((o) => o.devTarget * o.newShare);
// employee band from the org's expected developer count, inside its size's band range
{
	const est = NUM_USERS * (1 - BORN_PCT / 100), born = NUM_USERS * BORN_PCT / 100;
	const sumEst = ORGS.reduce((a, o) => a + o.devTarget * (1 - o.newShare), 0);
	const sumNew = ORGS.reduce((a, o) => a + o.devTarget * o.newShare, 0);
	for (const o of ORGS) {
		o.expectedDevs = est * o.devTarget * (1 - o.newShare) / sumEst + born * o.devTarget * o.newShare / sumNew;
		o.employees = o.size === "startup" ? (o.expectedDevs < 4 ? "1-10" : "11-50")
			: o.size === "smb" ? "51-200"
			: o.size === "mid_market" ? "201-1000"
			: o.expectedDevs >= 150 ? "5000+" : "1001-5000";
	}
}
const orgFor = (uid, isNew) => {
	const r = hashFloat(`${uid}|org`);
	const cum = isNew ? ORG_CUM_NEW : ORG_CUM;
	const i = cum.findIndex((c) => r < c);
	return ORGS[i < 0 ? ORGS.length - 1 : i];
};

// ── HELPERS ──
const salt = (key, tag) => hashFloat(`${key}|${tag}`);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
// seeded log-normal (median 1) from a salt key, so one unit's timing never shifts other draws
const logNormalAt = (key, sigma) => {
	const u1 = Math.max(1e-9, hashFloat(`${key}|n1`));
	const u2 = hashFloat(`${key}|n2`);
	return Math.exp(sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
};
// low-discrepancy draw for the n-th item of a stream: frac(offset + n * golden ratio).
// Rates over a repository's or an org's items stay close to the knob instead of
// carrying binomial noise.
const PHI = 0.6180339887498949;
const weyl = (key, n) => (salt(key, "weyl-offset") + n * PHI) % 1;
const inIncident = (t) => t >= ms(REGISTRY_INCIDENT_START) && t < ms(REGISTRY_INCIDENT_END);
// a developer's repositories (1-3) and each repository's test coverage (10-95%)
const reposFor = (uid) => {
	const n = 1 + Math.floor(salt(uid, "repo-count") * 3);
	return Array.from({ length: n }, (_, i) => `repo_${Math.floor(salt(uid, `repo-${i}`) * 0xffffffff).toString(16).padStart(8, "0")}`);
};
const coverageFor = (repo) => Math.round(10 + salt(repo, "coverage") * 85);
// PR size: log-normal lines changed, median 120
const prLines = (prId) => Math.max(1, Math.min(6000, Math.round(120 * logNormalAt(`${prId}|lines`, 1.4))));
const PR_STEPS = ["pull request opened", "review submitted", "pull request merged", "production deployed"];

// a developer who stops at `cut` leaves no events after it; an upgrade visit whose purchase
// would land after the cut goes with it (a visit and its purchase are one unit)
const cutAt = (events, cut) => {
	const lost = new Set();
	const views = events.filter((e) => e.event === "upgrade page viewed").sort((a, b) => T(a) - T(b));
	for (const buy of events) {
		if (buy.event !== "subscription started" || T(buy) < cut) continue;
		const view = views.filter((v) => T(v) <= T(buy)).pop();
		if (view) lost.add(view);
	}
	return events.filter((e) => T(e) < cut && !lost.has(e));
};

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const isNew = Boolean(meta.userIsBornInDataset);
	const org = orgFor(uid, isNew);
	profile.org_id = org.id;
	profile.org_name = org.name;
	profile.org_size = org.size;
	profile.industry = org.industry;
	// the plan comes from the organization: Team and Enterprise organizations put every
	// developer on their plan; at Free organizations some developers buy their own Pro seat
	// (new signups start on Free, or join their company's Team / Enterprise workspace)
	if (isNew) {
		const created = ms(profile.created ?? meta.user.created);
		profile.plan_tier = org.plan;
		profile.customer_since = dayKey(created);
		// H7: paid channels win more of the week's signups when their budget is higher
		profile.acquisition_channel = pickWeighted(channelWeightsAt(created), salt(uid, "channel"));
		return profile;
	}
	// established developers joined between 2022-03 and the window start
	const tenureDays = Math.floor(salt(uid, "tenure") * (dayjs.utc(DATASET_START).diff(dayjs.utc("2022-03-01T00:00:00Z"), "day")));
	profile.customer_since = dayjs.utc("2022-03-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	profile.plan_tier = org.plan === "free" && salt(uid, "plan") < INDIVIDUAL_PRO_SHARE ? "pro" : org.plan;
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;
	const ecosystem = ECOSYSTEM[profile.primary_stack] || "npm";
	const repos = reposFor(uid);

	// a work unit: one build, one pull request, or one push and its preview
	const unitKey = (e) => e.build_id || (PR_STEPS.includes(e.event) ? e.pr_id : null) || ((e.event === "commit pushed" || e.event === "preview deployed") && e.commit_sha !== "onboarding" ? e.commit_sha : null);
	// every event carries the developer's own org (the engine stamps group keys at random)
	for (const e of events) e.org_id = profile.org_id;

	// ── CI builds: status, failure stage, real duration (H5 first build, H6 incident) ──
	const builds = new Map();
	for (const e of events) {
		if (e.event !== "build started" && e.event !== "build finished") continue;
		if (!builds.has(e.build_id)) builds.set(e.build_id, {});
		builds.get(e.build_id)[e.event] = e;
	}
	// scheduled (cron) builds run on the clock, not on the developer's working week: each one
	// moves to a hashed day of its own Monday-Sunday week at the repository's nightly hour.
	// The move stays inside the window and after signup; a developer outside the CI test never
	// gets a build moved into it.
	const testStart = ms(REMOTE_CACHE_START);
	const exposure = events.find((e) => e.event === "$experiment_started");
	for (const b of builds.values()) {
		const st = b["build started"];
		if (!st || st.trigger !== "schedule") continue;
		const t0 = T(st);
		const repo = repos[Math.floor(salt(st.build_id, "repo") * repos.length)];
		const weekStart = dayjs.utc(t0).startOf("day").valueOf() - ((new Date(t0).getUTCDay() + 6) % 7) * DAY_MS;
		const atHour = (1 + Math.floor(salt(repo, "cron-hour") * 5)) * HOUR_MS + Math.floor(salt(st.build_id, "cron-min") * 50) * MIN_MS;
		let lo = Math.max(ms(DATASET_START), birthMs ?? -Infinity);
		let hi = END - HOUR_MS;
		if (!exposure) { if (t0 < testStart) hi = Math.min(hi, testStart - 1000); else lo = Math.max(lo, testStart); }
		const valid = [0, 1, 2, 3, 4, 5, 6].map((d) => weekStart + d * DAY_MS + atHour).filter((t) => t >= lo && t <= hi);
		if (valid.length) st.time = iso(valid[Math.floor(salt(st.build_id, "cron-day") * valid.length)]);
	}
	// H2: the engine logs the exposure just before a developer's first build in the test; keep it
	// there after the cron moves. A developer's arm applies to builds from that exposure on.
	if (exposure) {
		const firstInTest = Math.min(...[...builds.values()].map((b) => b["build started"]).filter((st) => st && T(st) >= testStart).map(T));
		if (firstInTest < Infinity) exposure.time = iso(firstInTest - 1000);
	}
	const cacheVariant = profile[EXP_KEY];
	const exposureMs = exposure ? T(exposure) : Infinity;
	const buildList = [...builds.values()].sort((a, b) => T(a["build started"] || a["build finished"]) - T(b["build started"] || b["build finished"]));
	let firstBuild = null;
	for (const b of buildList) {
		const st = b["build started"], fin = b["build finished"];
		const any = st || fin;
		const repo = repos[Math.floor(salt(any.build_id, "repo") * repos.length)];
		for (const e of [st, fin]) if (e) { e.repo_id = repo; e.ecosystem = ecosystem; }
		if (!fin) continue; // cancelled before it finished
		const isFirst = Boolean(signup && !firstBuild && st);
		if (isFirst) firstBuild = b;
		const bid = fin.build_id;
		let failed = salt(bid, "fail") < (isFirst ? FIRST_BUILD_FAIL : BASE_BUILD_FAIL);
		let stage = "none";
		if (failed) {
			stage = isFirst
				? pickWeighted({ configuration: 55, dependency_install: 10, compile: 15, test: 20 }, salt(bid, "stage"))
				: pickWeighted({ test: 58, compile: 22, dependency_install: 10, timeout: 10 }, salt(bid, "build-stage"));
		}
		const startT = st ? T(st) : null;
		if (!failed && ecosystem === INCIDENT_ECOSYSTEM && startT !== null && inIncident(startT) && salt(bid, "incident") < INCIDENT_FAIL) {
			failed = true;
			stage = "dependency_install";
		}
		fin.build_status = failed ? "failed" : "success";
		fin.failure_stage = stage;
		// duration: log-normal pipeline time × runner size × H2 cache arm; a failed build
		// stops at its failing stage
		const runner = (st || fin).runner_size || "standard";
		const inTest = cacheVariant && startT !== null && startT >= exposureMs;
		const armMult = inTest && cacheVariant === CACHE_VARIANT ? CACHE_TTC_MULT : 1;
		const frac = !failed ? 1 : { configuration: 0.08, dependency_install: 0.15, compile: 0.35, timeout: 1.6, test: 0.6 }[stage];
		const durMs = Math.max(15_000, BUILD_MEDIAN_SEC * 1000 * logNormalAt(`${bid}|dur`, BUILD_DURATION_SIGMA) * (RUNNER_SPEED[runner] ?? 1) * armMult * frac);
		fin.build_duration_sec = Math.round(durMs / 1000);
		// a build that fails before its test stage runs no tests; a test failure or a timeout
		// stops part-way through the suite
		if (stage === "configuration" || stage === "dependency_install" || stage === "compile") fin.tests_run = 0;
		else if (stage === "test" || stage === "timeout") fin.tests_run = Math.round(fin.tests_run * (0.2 + 0.8 * salt(bid, "tests-frac")));
		if (startT !== null) fin.time = iso(Math.min(startT + durMs, END));
	}

	// ── H5 + setup abandonment + evaluation churn (new users): one activity cut ──
	let cut = Infinity;
	let abandoned = false;
	const isOnboardingPreview = (e) => e.event === "preview deployed" && e.commit_sha === "onboarding";
	const onboarded = Boolean(signup) && events.some(isOnboardingPreview);
	if (signup) {
		const lastSetup = Math.max(birthMs, ...events.filter((e) => e.event === "repository imported" || e.event === "pipeline configured" || isOnboardingPreview(e)).map(T));
		if (!onboarded && salt(uid, "abandon") < SETUP_ABANDON_SHARE) {
			// a developer who gives up on setup stops after the last setup step they reached
			abandoned = true;
			const stopAt = birthMs + (SETUP_ABANDON_MIN_D + salt(uid, "abandon-day") * (SETUP_ABANDON_MAX_D - SETUP_ABANDON_MIN_D)) * DAY_MS;
			cut = Math.min(cut, Math.max(stopAt, lastSetup + HOUR_MS));
		}
		if (firstBuild && firstBuild["build finished"].build_status === "failed" && salt(uid, "red-dark") < RED_DARK_SHARE) {
			cut = Math.min(cut, T(firstBuild["build finished"]) + (RED_DARK_MIN_D + salt(uid, "red-dark-day") * (RED_DARK_MAX_D - RED_DARK_MIN_D)) * DAY_MS);
		}
		// most evaluators leave during their first month whatever happened in setup; the stop
		// day never lands before the developer's last setup step
		if (salt(uid, "eval-churn") < EVAL_CHURN_SHARE) {
			const stopAt = birthMs + (EVAL_CHURN_MIN_D + Math.pow(salt(uid, "eval-churn-day"), EVAL_CHURN_SKEW) * (EVAL_CHURN_MAX_D - EVAL_CHURN_MIN_D)) * DAY_MS;
			cut = Math.min(cut, Math.max(stopAt, lastSetup + EVAL_CHURN_AFTER_SETUP_H * HOUR_MS));
		}
	}
	if (cut < Infinity) events = cutAt(events, cut);
	// new users who never finish onboarding and do not abandon keep exploring at a low rate
	// (public repos, docs, the CLI): a salted 25-60% of their activity, thinned by whole
	// work unit (a build, a PR, a push and its preview); the first build always stays
	if (signup && !onboarded && !abandoned) {
		const keepShare = EXPLORER_KEEP_MIN + salt(uid, "explorer-keep") * (EXPLORER_KEEP_MAX - EXPLORER_KEEP_MIN);
		const firstBuildId = firstBuild ? firstBuild["build finished"].build_id : null;
		events = events.filter((e) => e === signup || e.event === "repository imported" || e.event === "pipeline configured"
			|| (firstBuildId && e.build_id === firstBuildId) || salt(unitKey(e) || e.insert_id, "explorer") < keepShare);
	}

	// ── purchases: one per user; H10 preview habit decides which would-be purchases happen ──
	const buys = events.filter((e) => e.event === "subscription started").sort((a, b) => T(a) - T(b));
	let purchase = null;
	if (signup) {
		// a new developer's would-be purchases (one per upgrade visit that converts) land in
		// their first six weeks; each one happens with the H10 keep share for their preview
		// habit, so a developer who passes on one visit can still buy on a later one
		const previews = events.filter((e) => e.event === "preview deployed" && T(e) >= birthMs && T(e) < birthMs + PQL_DAYS * DAY_MS).length;
		const keep = previews >= PQL_MIN_PREVIEWS ? PQL_KEEP : NON_PQL_KEEP;
		purchase = buys.find((b) => T(b) < birthMs + BUY_WINDOW_DAYS * DAY_MS && salt(b.insert_id, "pql-keep") < keep) || null;
	} else {
		purchase = buys[0] || null;
	}
	// established free users: a steady base rate, plus (early in the window) developers who
	// signed up in the weeks before June 4 and are still inside their first six weeks
	if (purchase && !signup) {
		const d = (T(purchase) - ms(DATASET_START)) / DAY_MS;
		const extra = EST_EXTRA_AMP * (1 - EST_BASE_KEEP) * Math.pow(Math.max(0, 1 - d / BUY_WINDOW_DAYS), EST_EXTRA_POW);
		const r = salt(uid, "est-keep");
		if (r >= EST_BASE_KEEP + extra) {
			purchase = null;
		} else if (r >= EST_BASE_KEEP) {
			const hi = ms(DATASET_START) - DAY_MS;
			const lo = Math.min(hi, T(purchase) - BUY_WINDOW_DAYS * DAY_MS);
			profile.customer_since = dayKey(lo + salt(uid, "recent-since") * (hi - lo));
		}
	}
	// one purchase per developer, and no upgrade visits after it
	if (buys.length) {
		const t0 = purchase ? T(purchase) : Infinity;
		events = events.filter((e) => {
			if (e.event === "subscription started") return e === purchase;
			if (e.event === "upgrade page viewed" && T(e) > t0) return false;
			return true;
		});
	}
	if (purchase && purchase.plan === "pro") purchase.seats = 1;
	// established Free developers' upgrade visits taper over the window (EST_VIEW_KEEP_END);
	// the visit that leads to a purchase stays
	if (!signup) {
		const buyAt = purchase ? T(purchase) : Infinity;
		const leadView = purchase ? events.filter((e) => e.event === "upgrade page viewed" && T(e) <= buyAt).sort((a, b) => T(b) - T(a))[0] : null;
		const span = END - ms(DATASET_START);
		events = events.filter((e) => {
			if (e.event !== "upgrade page viewed" || e === leadView) return true;
			const keep = 1 - (1 - EST_VIEW_KEEP_END) * Math.max(0, T(e) - ms(DATASET_START)) / span;
			return salt(e.insert_id, "est-view") < keep;
		});
	}

	const initialPlan = profile.plan_tier;
	const buyMs = purchase ? T(purchase) : Infinity;
	const planAt = (t) => (t >= buyMs ? purchase.plan : initialPlan);

	// ── pull requests: timing (H4, H1), Forge Assist (H1), rollback (H9) ──
	const prs = new Map();
	for (const e of events) {
		if (!PR_STEPS.includes(e.event)) continue;
		if (!prs.has(e.pr_id)) prs.set(e.pr_id, {});
		prs.get(e.pr_id)[e.event] = e;
	}
	const assistAdopter = salt(uid, "assist-adopter") < ASSIST_ADOPTER_SHARE;
	const assistStart = ms(ASSIST_LAUNCH) + salt(uid, "assist-start") * ASSIST_RAMP_DAYS * DAY_MS;
	const assistUse = ASSIST_USE + (salt(uid, "assist-use") - 0.5) * 2 * ASSIST_USE_SPREAD;
	const dropPr = new Set();
	// most developers pause review work over the weekend: a review or merge that would land
	// between Saturday 06:00 and Monday 00:00 UTC happens on Monday instead, in the order it
	// would have happened, spread over Monday 07:00-18:00 UTC (the Monday catch-up)
	const weekendsOff = salt(uid, "weekends-off") < WEEKENDS_OFF_SHARE;
	const skipWeekend = (t) => {
		if (!weekendsOff) return t;
		const wd = new Date(t).getUTCDay();
		if (wd !== 6 && wd !== 0) return t;
		const pauseStart = dayjs.utc(t).startOf("day").subtract(wd === 0 ? 1 : 0, "day").valueOf() + 6 * HOUR_MS;
		if (t < pauseStart) return t;
		const monday = pauseStart + WEEKEND_PAUSE_MS;
		return monday + MONDAY_CATCHUP_FROM_H * HOUR_MS + (t - pauseStart) / WEEKEND_PAUSE_MS * MONDAY_CATCHUP_SPAN_H * HOUR_MS;
	};
	for (const [prId, p] of prs) {
		const steps = PR_STEPS.map((n) => p[n]).filter(Boolean);
		const lines = prLines(prId);
		const repo = repos[Math.floor(salt(prId, "repo") * repos.length)];
		const cov = coverageFor(repo);
		const files = Math.max(1, Math.round(lines / 35 * jitter(`${prId}|files`, 0.5)));
		for (const e of steps) {
			e.lines_changed = lines;
			e.files_changed = files;
			e.repo_id = repo;
			e.test_coverage_pct = cov;
			e.review_mode = "standard";
		}
		const open = p["pull request opened"], rev = p["review submitted"], mer = p["pull request merged"], dep = p["production deployed"];
		const waitH = REVIEW_WAIT_MEDIAN_H * logNormalAt(`${prId}|wait`, 0.8) * reviewWaitMult(lines);
		if (open) {
			// rebuild the PR's clock from the open: review wait (H4), review → merge (H1), merge → deploy
			let t = T(open);
			if (rev) {
				t = skipWeekend(t + waitH * HOUR_MS);
				rev.time = iso(t);
				// the wait as the reviewer saw it, weekend pause included (the open → review gap)
				rev.review_wait_hours = round1((t - T(open)) / HOUR_MS);
				if (t > END) dropPr.add(rev);
			}
			// H1: Forge Assist reviews the PR when its author has turned it on and is on an eligible plan
			const assisted = assistAdopter && T(open) >= assistStart && ASSIST_PLANS.includes(planAt(T(open))) && salt(prId, "assist-use") < assistUse;
			if (assisted) for (const e of steps) e.review_mode = "forge_assist";
			if (rev && mer) {
				const g = MERGE_GAP_MEDIAN_H * HOUR_MS * logNormalAt(`${prId}|merge`, 0.8) * (assisted ? ASSIST_MERGE_MULT : 1);
				t = skipWeekend(t + g);
				mer.time = iso(t);
				if (t > END) dropPr.add(mer);
			}
			if (rev && mer && dep) {
				t += DEPLOY_GAP_MEDIAN_MIN * MIN_MS * logNormalAt(`${prId}|deploy`, 0.5);
				// weekend freeze: a merge that would ship between Saturday 06:00 and Monday
				// 00:00 UTC ships Monday morning (UTC) instead
				const wd = new Date(t).getUTCDay(), hr = new Date(t).getUTCHours();
				if (weekendsOff && ((wd === 6 && hr >= 6) || wd === 0)) {
					const monday = dayjs.utc(t).startOf("day").add(wd === 6 ? 2 : 1, "day").valueOf();
					t = monday + (7 + salt(prId, "monday") * 4) * HOUR_MS;
				}
				dep.time = iso(t);
				if (t > END) dropPr.add(dep);
			}
		}
	}
	// H9: a repository's production deploys roll back at the rate its test coverage implies
	const deploysByRepo = new Map();
	for (const p of prs.values()) {
		const dep = p["production deployed"];
		if (!dep) continue;
		if (!deploysByRepo.has(dep.repo_id)) deploysByRepo.set(dep.repo_id, []);
		deploysByRepo.get(dep.repo_id).push(dep);
	}
	for (const [repo, deps] of deploysByRepo) {
		deps.sort((a, b) => T(a) - T(b));
		const rate = rollbackRate(coverageFor(repo));
		deps.forEach((dep, n) => { dep.deploy_outcome = weyl(`${uid}|${repo}|rollback`, n) < rate ? "rolled_back" : "healthy"; });
	}
	if (dropPr.size) events = events.filter((e) => !dropPr.has(e));
	if (cut < Infinity) events = cutAt(events, cut);

	// ── H8: Team orgs switch off part of their scheduled builds once overage billing starts ──
	const cutDay = ms(METERED_START) + salt(profile.org_id, "metered-day") * SCHEDULED_CUT_RAMP_DAYS * DAY_MS;
	const cutShare = SCHEDULED_CUT_MEAN + (salt(profile.org_id, "metered-share") - 0.5) * 2 * SCHEDULED_CUT_SPREAD;
	const dropBuild = new Set();
	const scheduled = [...builds.entries()]
		.filter(([, b]) => b["build started"] && b["build started"].trigger === "schedule" && T(b["build started"]) >= cutDay && planAt(T(b["build started"])) === METERED_PLAN)
		.sort((a, b) => T(a[1]["build started"]) - T(b[1]["build started"]));
	scheduled.forEach(([bid], n) => { if (weyl(`${uid}|metered`, n) < cutShare) dropBuild.add(bid); });

	// ── collaboration volume: a new workspace invites its team in its first two weeks;
	// after that (and for established developers) invites are occasional ──
	events = events.filter((e) => {
		if (e.event !== "teammate invited") return true;
		if (signup && T(e) < birthMs + INVITE_EARLY_DAYS * DAY_MS) return true;
		return salt(e.insert_id, "invite-keep") < INVITE_KEEP_LATE;
	});

	// ── US holidays: a share of a US-based developer's work units that would have started
	// that day do not happen; everyone else works as usual ──
	const unitStart = new Map();
	for (const e of events) {
		const k = unitKey(e);
		if (!k) continue;
		const t = T(e);
		if (!unitStart.has(k) || t < unitStart.get(k)) unitStart.set(k, t);
	}
	const STRUCTURAL = new Set(["account created", "repository imported", "pipeline configured", "upgrade page viewed", "subscription started", "$experiment_started"]);
	events = events.filter((e) => {
		if (e.build_id && dropBuild.has(e.build_id)) return false;
		if (STRUCTURAL.has(e.event) || (e.event === "preview deployed" && e.commit_sha === "onboarding")) return true;
		if (e.build_id && e.trigger === "schedule") return true; // cron builds run on holidays too
		const k = unitKey(e);
		const t0 = k ? unitStart.get(k) : T(e);
		if (profile.country_code !== HOLIDAY_COUNTRY || !HOLIDAYS.includes(dayKey(t0))) return true;
		return salt(k || e.insert_id, "holiday") >= HOLIDAY_DROP;
	});

	// ── plan at event time (superProp plan_tier) + final profile plan ──
	for (const e of events) e.plan_tier = planAt(T(e));
	if (purchase && events.includes(purchase)) profile.plan_tier = purchase.plan;

	// the exposure stays 1 s before the developer's first surviving build in the test (the
	// cuts above can remove the build it preceded); with no build left in the test there is
	// no exposure, and the assignment stays on the profile only for exposed developers
	const expo = events.find((e) => e.event === "$experiment_started");
	if (expo) {
		const first = Math.min(...events.filter((e) => e.event === "build started" && T(e) >= testStart).map(T));
		if (first < Infinity) expo.time = iso(first - 1000);
		else events = events.filter((e) => e !== expo);
	}
	if (profile[EXP_KEY] !== undefined && !events.some((e) => e.event === "$experiment_started")) delete profile[EXP_KEY];

	return events;
}

// warehouse rows: exogenous business facts layered on the event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		// the source counts the day's Mixpanel signups (row.spend_usd before this hook).
		// Spend = target cost per signup × (a quarter of the day's conversions + three
		// quarters of the planned volume at this week's budget), with day-level noise; never zero.
		const ch = row.acquisition_channel;
		const date = row.date;
		const planned = expectedSignups(ch, ms(`${date}T00:00:00Z`));
		const spend = round2(Math.max(0.2 * planned, SPEND_SAME_DAY_SHARE * row.spend_usd + (1 - SPEND_SAME_DAY_SHARE) * planned) * CPL_USD[ch] * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
		row.spend_usd = spend;
		row.clicks = Math.round(spend / (PLATFORM_CLICK_CPC[ch] * jitter(`cpc|${date}|${ch}`, 0.15)));
		row.impressions = Math.round(row.clicks / (PLATFORM_CTR[ch] * jitter(`ctr|${date}|${ch}`, 0.15)));
		row.platform_reported_signups = Math.round(spend * PLATFORM_SIGNUP_INFLATION / CPL_USD[ch] * jitter(`lead|${date}|${ch}`, 0.25));
		return row;
	}
	if (meta.metricName === "build_fleet_daily") {
		// the fleet also runs API-triggered and partner jobs that never send a product event
		const k = `${row.date}|${row.ecosystem}`;
		const base = { npm: 160, pypi: 100, go_modules: 45, rubygems: 28, maven: 65, nuget: 36, cargo: 28 }[row.ecosystem] || 30;
		row.builds_started = Math.round(row.builds_started + base * jitter(`api|${k}`, 0.6) * jitter(`api|${row.date}`, 0.4));
		return row;
	}
	if (meta.metricName === "usage_billing_daily") {
		// billing meters every runner minute: API-triggered jobs and retries that send no product event
		// The billing day closes at 07:00 UTC, so about 30% of a UTC day's minutes bill on the
		// next billing day; retries add 3-13% and API-triggered jobs up to ~3,000 runner minutes a day.
		const k = `${row.date}|${row.plan_tier}`;
		const today = row.billable_runner_minutes;
		const prev = meta.bucketIndex === 0 || !billingCarry.has(row.plan_tier) ? today : billingCarry.get(row.plan_tier);
		billingCarry.set(row.plan_tier, today);
		const shifted = (1 - BILLING_DAY_SHIFT) * today + BILLING_DAY_SHIFT * prev;
		// a pipeline fans out into parallel jobs (matrix builds, test shards); billing meters
		// runner minutes across every job
		const jobs = PARALLEL_JOBS[row.plan_tier] * jitter(`jobs|${k}`, 0.15);
		row.billable_runner_minutes = Math.round(shifted * jobs * (1.08 + 0.1 * (hashFloat(`retry|${k}`) - 0.5)) + 3000 * hashFloat(`api-min|${k}`) * jitter(`api-day|${row.date}`, 0.5));
		const metered = row.plan_tier === METERED_PLAN && dayjs.utc(row.date).valueOf() >= ms(METERED_START);
		// pooled monthly allowances reset on the 1st: an org bills overage once its month-to-date
		// minutes pass its allowance, so overage starts near zero each month and grows as orgs run out
		row.overage_minutes = 0;
		if (row.plan_tier === METERED_PLAN) {
			if (meta.bucketIndex === 0) Object.assign(teamUsage, { trail: [], month: null, mtd: 0 });
			const month = row.date.slice(0, 7);
			if (teamUsage.month !== month) Object.assign(teamUsage, { month, mtd: 0 });
			teamUsage.trail.push(row.billable_runner_minutes);
			const recent = teamUsage.trail.slice(-28);
			const expectedMonth = recent.reduce((a, b) => a + b, 0) / recent.length * dayjs.utc(row.date).daysInMonth();
			const rMid = (teamUsage.mtd + row.billable_runner_minutes / 2) / expectedMonth;
			teamUsage.mtd += row.billable_runner_minutes;
			if (metered) row.overage_minutes = Math.round(row.billable_runner_minutes * overageShareAt(rMid) * jitter(`over|${k}`, 0.15));
		}
		row.overage_revenue_usd = round2(row.overage_minutes * row.overage_price_per_minute_usd);
		return row;
	}
	return row;
}

function handleGroup(record) {
	const org = ORGS[Number(record.org_id) - 1];
	if (!org) return record;
	record.name = org.name;
	record.org_size = org.size;
	record.industry = org.industry;
	record.employee_count = org.employees;
	return record;
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
	// B2B developer tool: weekday-heavy, India + Europe + Americas working hours (UTC)
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: true,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 2 },
	stickyEventProps: ["primary_stack"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { github: 46, google: 24, gitlab: 12, email: 18 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "repository imported",
			weight: 1,
			isStrictEvent: true,
			properties: {
				repo_source: { __weights: { github: 52, gitlab: 16, bitbucket: 7, template: 15, empty: 10 } },
				monorepo: { __weights: { false: 82, true: 18 } },
			},
		},
		{
			event: "pipeline configured",
			weight: 1,
			isStrictEvent: true,
			properties: {
				config_mode: { __weights: { auto_detected: 58, starter_template: 24, custom_yaml: 18 } },
			},
		},
		{
			event: "preview deployed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				commit_sha: ["unassigned"],
				preview_build_sec: u.weighNumRange(20, 600, 0.5, 40),
				framework: (ctx) => FRAMEWORK[ctx.profile?.primary_stack] || "other",
			},
		},
		{
			event: "commit pushed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				commit_sha: ["unassigned"],
				branch_type: { __weights: { feature: 62, main: 18, fix: 15, release: 5 } },
				commits_in_push: u.weighNumRange(1, 12, 0.3, 30),
			},
		},
		{
			event: "build started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				build_id: ["unassigned"],
				trigger: ["push"],
				repo_id: ["unassigned"],
				ecosystem: ["npm"],
				runner_size: { __weights: { standard: 72, large: 22, xlarge: 6 } },
			},
		},
		{
			event: "build finished",
			weight: 1,
			isStrictEvent: true,
			properties: {
				build_id: ["unassigned"],
				trigger: ["push"],
				repo_id: ["unassigned"],
				ecosystem: ["npm"],
				build_status: ["success"],
				failure_stage: ["none"],
				build_duration_sec: [0],
				tests_run: u.weighNumRange(20, 4000, 0.3, 40),
			},
		},
		{
			event: "pull request opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				pr_id: ["unassigned"],
				repo_id: ["unassigned"],
				lines_changed: [0],
				files_changed: [0],
				test_coverage_pct: [0],
				review_mode: ["standard"],
			},
		},
		{
			event: "review submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				pr_id: ["unassigned"],
				repo_id: ["unassigned"],
				lines_changed: [0],
				files_changed: [0],
				test_coverage_pct: [0],
				review_mode: ["standard"],
				review_decision: { __weights: { approved: 68, changes_requested: 24, commented: 8 } },
				review_wait_hours: [0],
			},
		},
		{
			event: "pull request merged",
			weight: 1,
			isStrictEvent: true,
			properties: {
				pr_id: ["unassigned"],
				repo_id: ["unassigned"],
				lines_changed: [0],
				files_changed: [0],
				test_coverage_pct: [0],
				review_mode: ["standard"],
				merge_method: { __weights: { squash: 64, merge_commit: 24, rebase: 12 } },
			},
		},
		{
			event: "production deployed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				pr_id: ["unassigned"],
				repo_id: ["unassigned"],
				lines_changed: [0],
				files_changed: [0],
				test_coverage_pct: [0],
				review_mode: ["standard"],
				deploy_outcome: ["healthy"],
				deploy_region: { __weights: { "us-east": 42, "eu-west": 30, "us-west": 16, "ap-south": 12 } },
			},
		},
		{
			event: "upgrade page viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				upgrade_trigger: { __weights: { build_minutes_limit: 34, private_repo_limit: 22, preview_limit: 18, feature_gate: 16, billing_settings: 10 } },
			},
		},
		{
			event: "subscription started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: ["pro"],
				seats: [1],
				billing_cycle: { __weights: { monthly: 70, annual: 30 } },
			},
		},
		{
			event: "code browsed",
			weight: 9,
			properties: {
				view_type: { __weights: { file: 46, commits: 18, blame: 8, branches: 10, compare: 18 } },
			},
		},
		{
			event: "docs viewed",
			weight: 3,
			properties: {
				doc_section: { __weights: { getting_started: 20, ci_configuration: 24, preview_environments: 14, cli: 12, api: 14, billing: 6, troubleshooting: 10 } },
				time_on_page_sec: u.weighNumRange(5, 600, 0.4, 40),
			},
		},
		{
			event: "cli command run",
			weight: 4,
			properties: {
				command: { __weights: { "forge logs": 30, "forge deploy": 18, "forge env pull": 20, "forge run": 22, "forge login": 10 } },
				cli_version: { __weights: { "3.4.1": 30, "3.5.0": 45, "3.5.2": 25 } },
			},
		},
		{
			event: "logs viewed",
			weight: 3,
			properties: {
				log_source: { __weights: { build: 44, runtime: 40, edge: 16 } },
				time_range: { __weights: { "15m": 30, "1h": 34, "24h": 26, "7d": 10 } },
			},
		},
		{
			event: "issue created",
			weight: 2,
			properties: {
				issue_type: { __weights: { bug: 46, feature: 30, chore: 16, security: 8 } },
				labels_count: [0, 1, 1, 2, 2, 3],
			},
		},
		{
			event: "teammate invited",
			weight: 1,
			properties: {
				invite_role: { __weights: { developer: 70, admin: 12, viewer: 18 } },
			},
		},
		{
			event: "environment variable updated",
			weight: 1,
			properties: {
				environment: { __weights: { production: 40, preview: 35, development: 25 } },
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [CACHE_EXPERIMENT],
				"Variant name": ["Control", CACHE_VARIANT],
			},
		},
	],

	funnels: [
		// H3 + H7: four declared copies of onboarding, one per (stack group × paid social) cell
		...[
			{ cond: { primary_stack: { nin: SLOW_STACKS }, acquisition_channel: { neq: "paid_social" } }, mult: 1 },
			{ cond: { primary_stack: { in: SLOW_STACKS }, acquisition_channel: { neq: "paid_social" } }, mult: SLOW_STACK_MULT },
			{ cond: { primary_stack: { nin: SLOW_STACKS }, acquisition_channel: "paid_social" }, mult: SOCIAL_ONBOARD_MULT },
			{ cond: { primary_stack: { in: SLOW_STACKS }, acquisition_channel: "paid_social" }, mult: SLOW_STACK_MULT * SOCIAL_ONBOARD_MULT },
		].map(({ cond, mult }) => ({
			name: "Onboarding",
			sequence: ["account created", "repository imported", "pipeline configured", "preview deployed"],
			isFirstFunnel: true,
			conditions: cond,
			conversionRate: Math.round(ONBOARD_CONV * mult),
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
			props: { commit_sha: ["onboarding"] },
		})),
		{
			name: "Pull Request",
			sequence: PR_STEPS,
			conversionRate: 62,
			timeToConvert: 24,
			order: "sequential",
			weight: 4,
			props: {
				pr_id: (ctx) => `pr_${chance.hash({ length: 12 })}`,
			},
		},
		{
			name: "CI Build",
			sequence: ["build started", "build finished"],
			conversionRate: BUILD_CONV,
			timeToConvert: BUILD_TTC_H,
			order: "sequential",
			weight: 8,
			props: {
				build_id: (ctx) => `bld_${chance.hash({ length: 12 })}`,
				trigger: { __weights: { push: 52, pull_request: 32, schedule: 13, manual: 3 } },
			},
			experiment: {
				name: CACHE_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(REMOTE_CACHE_START)) / DAY_MS,
				// assignment + exposure only; the hook applies CACHE_TTC_MULT to build durations
				variants: [
					{ name: "Control" },
					{ name: CACHE_VARIANT },
				],
			},
		},
		{
			name: "Preview",
			sequence: ["commit pushed", "preview deployed"],
			conversionRate: 72,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 5,
			props: {
				commit_sha: (ctx) => chance.hash({ length: 10 }),
			},
		},
		{
			name: "Upgrade",
			sequence: ["upgrade page viewed", "subscription started"],
			conditions: { plan_tier: "free", customer_since: { gte: D0 } },
			conversionRate: UPGRADE_CONV,
			timeToConvert: 24,
			order: "sequential",
			weight: 1,
			props: {
				plan: { __weights: { pro: 62, team: 38 } },
				seats: u.weighNumRange(3, 20, 1, 40),
			},
		},
		{
			name: "Upgrade",
			sequence: ["upgrade page viewed", "subscription started"],
			conditions: { plan_tier: "free", customer_since: { lt: D0 } },
			conversionRate: UPGRADE_CONV_ESTABLISHED,
			timeToConvert: 24,
			order: "sequential",
			weight: 1,
			props: {
				plan: { __weights: { pro: 62, team: 38 } },
				seats: u.weighNumRange(3, 20, 1, 40),
			},
		},
	],

	warehouseMetrics: [
		{
			name: "marketing_spend_daily",
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
				// set in the warehouse hook: platform metrics follow the day's spend
				clicks: 0,
				impressions: 0,
				platform_reported_signups: 0,
			},
		},
		{
			name: "build_fleet_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "build started",
				measure: "count",
				groupBy: "ecosystem",
			},
			timeColumn: "date",
			valueColumn: "builds_started",
			columns: {
				dependency_fetch_error_rate: (ctx) => {
					const hit = ctx.row.ecosystem === INCIDENT_ECOSYSTEM && inIncident(ctx.time);
					const j = hashFloat(`dep-err|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? round2(INCIDENT_FAIL + (j - 0.5) * 0.04) : Math.round((0.002 + j * 0.008) * 10000) / 10000;
				},
				registry_mirror_status: (ctx) => (ctx.row.ecosystem === INCIDENT_ECOSYSTEM && inIncident(ctx.time) ? "degraded" : "operational"),
				queue_p95_seconds: (ctx) => Math.round(18 + hashFloat(`queue|${dayKey(ctx.time)}|${ctx.seriesKey}`) * 30),
				remote_cache_hit_rate: (ctx) => (ctx.time >= ms(REMOTE_CACHE_START) ? round2(0.64 + (hashFloat(`cache|${dayKey(ctx.time)}|${ctx.seriesKey}`) - 0.5) * 0.12) : 0),
			},
		},
		{
			name: "usage_billing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "build finished",
				measure: "sum",
				property: "build_duration_sec",
				groupBy: "plan_tier",
			},
			scale: 1 / 60,
			timeColumn: "date",
			valueColumn: "billable_runner_minutes",
			columns: {
				overage_price_per_minute_usd: (ctx) => (ctx.row.plan_tier === METERED_PLAN && ctx.time >= ms(METERED_START) ? OVERAGE_PRICE_PER_MIN : 0),
				overage_minutes: 0,
				overage_revenue_usd: 0,
			},
		},
	],

	superProps: {
		plan_tier: ["free"],
	},

	userProps: {
		org_id: ["1"],
		org_name: ["unknown"],
		org_size: ["smb"],
		industry: ["saas"],
		role: ["developer"],
		primary_stack: { __weights: STACK_WEIGHTS },
		plan_tier: ["free"],
		customer_since: ["2025-01-01"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
	},

	personas: [
		{ name: "developer", weight: 55, eventMultiplier: 1.0, properties: { role: "developer" } },
		{ name: "tech_lead", weight: 20, eventMultiplier: 1.25, properties: { role: "tech_lead" } },
		{ name: "platform_engineer", weight: 15, eventMultiplier: 1.5, properties: { role: "platform_engineer" } },
		{ name: "engineering_manager", weight: 10, eventMultiplier: 0.45, properties: { role: "engineering_manager" } },
	],

	groupKeys: [["org_id", ORG_COUNT, []]],
	groupProps: {
		org_id: {
			name: ["unknown"],
			org_size: ["smb"],
			industry: ["saas"],
			employee_count: ["11-50"],
		},
	},

	// retention shape (also pins each new user's signup to their creation day)
	retentionCurve: { type: "logarithmic", day1: 0.55, day7: 0.4, day30: 0.3 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		if (type === "group") return handleGroup(record);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/devtools/devtools.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user who appears with it on any
// event carrying both ids (emitted stitch evidence, not the profile pool).
// Every Forgebench event carries user_id, so uid = user_id in practice.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const D = (iso) => iso.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const ONBOARDING_STEPS = ["account created", "repository imported", "pipeline configured", "preview deployed"];
const ASSIST_RAMPED = TS(dayjs.utc(ASSIST_LAUNCH).add(ASSIST_RAMP_DAYS, "day"));
const INC_BASE_FROM = TS(dayjs.utc(REGISTRY_INCIDENT_START).subtract(7, "day"));
const INC_BASE_TO = TS(dayjs.utc(REGISTRY_INCIDENT_END).add(7, "day"));
const METERED_PRE_FROM = "2026-08-01 00:00:00";   // August: a full month before overage billing
const METERED_POST_FROM = TS(dayjs.utc(METERED_START).add(SCHEDULED_CUT_RAMP_DAYS, "day")); // every Team org has acted
const METERED_POST_TO = "2026-10-01 00:00:00";
const METERED_MONTH_END = "2026-10-01";
// allowances are at least 15% of an org's monthly usage, so no org runs out before about day 4.5
const ALLOWANCE_RESET_DAYS = 3;
const OVERAGE_FROM_DAY = 8;
const RETENTION_DAY = 30;
const PQL_COHORT_END = TS(dayjs.utc(DATASET_END).subtract(BUY_WINDOW_DAYS, "day")); // full six-week purchase window

/** step_counts conversion for a set of segments from a timeToConvert breakdown. */
const convOf = (rows, segs) => {
	const rs = (rows || []).filter((x) => segs.includes(x.segment_value) && Array.isArray(x.step_counts) && x.step_counts[0]);
	if (!rs.length) return null;
	const entered = rs.reduce((a, r) => a + r.step_counts[0], 0);
	const converted = rs.reduce((a, r) => a + r.step_counts[r.step_counts.length - 1], 0);
	return { entered, converted, rate: converted / entered };
};

// H1 per-PR clock: review → merge for PRs that reached both steps, eligible plans, after launch
const H1_SQL = `WITH ${ID_CTE},
p AS (SELECT pr_id, any_value(uid) AS uid, any_value(review_mode) AS mode,
    min(t) FILTER (WHERE event = 'review submitted') AS t1, min(t) FILTER (WHERE event = 'pull request merged') AS t2,
    any_value(plan_tier) FILTER (WHERE event = 'review submitted') AS plan
  FROM ev WHERE event IN ('review submitted', 'pull request merged') GROUP BY 1)
SELECT mode AS grp, count(DISTINCT uid) AS user_count, count(*) AS prs, median(date_diff('second', t1, t2)) / 3600.0 AS med_merge_h
FROM p WHERE t1 IS NOT NULL AND t2 IS NOT NULL AND t1 >= TIMESTAMP '${TS(ASSIST_LAUNCH)}' AND plan IN (${SQL_LIST(ASSIST_PLANS)}) GROUP BY 1`;

const H2_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL)
SELECT v.variant AS grp, count(DISTINCT ev.uid) AS user_count, count(*) AS builds,
  avg((build_status = 'success')::INT) AS success_rate,
  median(build_duration_sec) FILTER (WHERE build_status = 'success') AS med_success_sec
FROM ev JOIN v ON v.uid = ev.uid WHERE ev.event = 'build finished' AND ev.t >= TIMESTAMP '${TS(REMOTE_CACHE_START)}' GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
p AS (SELECT pr_id, any_value(uid) AS uid, any_value(lines_changed) AS lines,
    min(t) FILTER (WHERE event = 'pull request opened') AS t0, min(t) FILTER (WHERE event = 'review submitted') AS t1
  FROM ev WHERE event IN ('pull request opened', 'review submitted') GROUP BY 1)
SELECT CASE WHEN lines <= ${SMALL_PR_LINES} THEN 'small' WHEN lines >= ${LARGE_PR_LINES} THEN 'large' ELSE 'medium' END AS grp,
  count(DISTINCT uid) AS user_count, count(*) AS prs, median(date_diff('second', t0, t1)) / 3600.0 AS med_wait_h
FROM p WHERE t0 IS NOT NULL AND t1 IS NOT NULL GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL ${RETENTION_DAY + 7} DAY),
fb AS (SELECT s.uid, arg_min(e.build_status, e.t) AS first_status, min(e.t) AS tb
  FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'build finished' AND e.t >= s.t0 GROUP BY 1),
f AS (SELECT s.uid, fb.first_status,
    count(e.t) FILTER (WHERE e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY AND e.t < s.t0 + INTERVAL ${RETENTION_DAY + 7} DAY) AS ret
  FROM s JOIN fb ON fb.uid = s.uid AND fb.tb < s.t0 + INTERVAL ${FIRST_BUILD_DAYS} DAY
  JOIN ev e ON e.uid = s.uid GROUP BY 1, 2)
SELECT first_status AS grp, count(*) AS user_count, avg((ret > 0)::INT) AS retention FROM f GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, ecosystem FROM ${WH("build_fleet_daily")} WHERE registry_mirror_status = 'degraded'),
od AS (SELECT DISTINCT d FROM o), oe AS (SELECT DISTINCT ecosystem FROM o),
w AS (SELECT t::DATE AS d, uid, (ecosystem IN (SELECT ecosystem FROM oe)) AS hit, (build_status = 'success') AS ok
  FROM ev WHERE event = 'build finished' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS incident, avg(ok::INT) FILTER (WHERE hit) / avg(ok::INT) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS incident_days, min(users) AS user_count,
  max(rel) FILTER (WHERE incident) / max(rel) FILTER (WHERE NOT incident) AS did
FROM g`;

const H8_SQL = `WITH ${ID_CTE},
b AS (SELECT uid, CASE WHEN plan_tier = '${METERED_PLAN}' THEN 'team' ELSE 'other_plans' END AS grp,
    (t >= TIMESTAMP '${METERED_POST_FROM}') AS post, trigger
  FROM ev WHERE event = 'build started' AND ((t >= TIMESTAMP '${METERED_PRE_FROM}' AND t < TIMESTAMP '${TS(METERED_START)}') OR (t >= TIMESTAMP '${METERED_POST_FROM}' AND t < TIMESTAMP '${METERED_POST_TO}'))),
r AS (SELECT grp, post, count(*) FILTER (WHERE trigger = 'schedule')::DOUBLE / count(*) FILTER (WHERE trigger = 'push') AS sched_per_push, count(DISTINCT uid) AS users FROM b GROUP BY 1, 2)
SELECT grp, min(users) AS user_count, max(sched_per_push) FILTER (WHERE post) / max(sched_per_push) FILTER (WHERE NOT post) AS did FROM r GROUP BY 1`;

const H9_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN test_coverage_pct <= ${COVERAGE_LOW} THEN 'low' WHEN test_coverage_pct >= ${COVERAGE_HIGH} THEN 'high' ELSE 'middle' END AS grp,
  count(DISTINCT uid) AS user_count, count(*) AS deploys, avg((deploy_outcome = 'rolled_back')::INT) AS rollback_rate
FROM ev WHERE event = 'production deployed' GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND plan_tier = 'free' AND t < TIMESTAMP '${PQL_COHORT_END}'),
f AS (SELECT s.uid,
    count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL ${PQL_DAYS} DAY) AS previews,
    count(*) FILTER (WHERE e.event = 'subscription started' AND e.t < s.t0 + INTERVAL ${BUY_WINDOW_DAYS} DAY) AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN previews >= ${PQL_MIN_PREVIEWS} THEN 'habit' WHEN previews >= 1 THEN 'light' ELSE 'none' END AS grp,
  count(*) AS user_count, avg((buys > 0)::INT) AS paid_rate
FROM f GROUP BY 1`;

// H10 controlled read: purchases per upgrade-page visit in the first 42 days. Each visit
// that would convert keeps its purchase at the habit's keep share, and a developer stops
// visiting after buying, so purchases / visits reads the keep ratio whatever the visit count
const H10_VISIT_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND plan_tier = 'free' AND t < TIMESTAMP '${PQL_COHORT_END}'),
f AS (SELECT s.uid,
    count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL ${PQL_DAYS} DAY) AS previews,
    count(*) FILTER (WHERE e.event = 'upgrade page viewed' AND e.t < s.t0 + INTERVAL ${BUY_WINDOW_DAYS} DAY) AS visits,
    count(*) FILTER (WHERE e.event = 'subscription started' AND e.t < s.t0 + INTERVAL ${BUY_WINDOW_DAYS} DAY) AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN previews >= ${PQL_MIN_PREVIEWS} THEN 'habit' WHEN previews >= 1 THEN 'light' ELSE 'none' END AS grp,
  count(*) FILTER (WHERE visits > 0) AS user_count, sum(visits) AS visits, sum(buys) AS buys, sum(buys)::DOUBLE / sum(visits) AS buys_per_visit
FROM f GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-forge-assist-launch",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Forge Assist (AI code review) launches ${D(ASSIST_LAUNCH)} for Pro, Team, and Enterprise seats. ${ASSIST_ADOPTER_SHARE * 100}% of eligible developers turn it on, each on a day in the ${ASSIST_RAMP_DAYS} days after launch, and use it on ${(ASSIST_USE - ASSIST_USE_SPREAD) * 100}-${(ASSIST_USE + ASSIST_USE_SPREAD) * 100}% of their pull requests (mean ${ASSIST_USE * 100}%), so the share of eligible PRs with review_mode = 'forge_assist' ramps for four weeks and then holds at ${ASSIST_SHARE * 100}%. An assisted PR goes from review to merge in ${ASSIST_MERGE_MULT}x the time. The wait for the first review is untouched (honest null), and so is the rollback rate. Free seats and pre-launch PRs never get it, so purity is exact. plan_tier on each event is the seat plan at that moment.`,
		mixpanelReport: { type: "Funnels", steps: ["review submitted", "pull request merged"], measure: "median time to convert", holdPropertyConstant: "pr_id", breakdown: "review_mode", filter: "plan_tier in (pro, team, enterprise), on or after 2026-07-29" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE review_mode = 'forge_assist' AND (t < TIMESTAMP '${TS(ASSIST_LAUNCH)}' OR plan_tier NOT IN (${SQL_LIST(ASSIST_PLANS)}))) AS impure_rows
FROM ev WHERE event IN (${SQL_LIST(PR_STEPS)})`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: an assisted PR before launch or on a Free seat is a bug
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "forge_assist" } }, s: { where: { grp: "standard" } } },
				expect: { metric: "a.med_merge_h / s.med_merge_h", op: "between", target: band(ASSIST_MERGE_MULT) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'eligible' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE review_mode = 'forge_assist')::DOUBLE / count(*) AS assist_share
FROM ev WHERE event = 'pull request opened' AND t >= TIMESTAMP '${ASSIST_RAMPED}' AND plan_tier IN (${SQL_LIST(ASSIST_PLANS)})`,
				},
				select: { e: { where: { grp: "eligible" } } },
				// after the ramp every adopter has started
				expect: { metric: "e.assist_share", op: "between", target: band(ASSIST_SHARE) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H2-remote-build-cache-experiment",
		hook: "H2",
		archetype: "experiment-lift",
		narrative: `The "${CACHE_EXPERIMENT}" CI test starts ${D(REMOTE_CACHE_START)} and splits developers 50/50 (sticky hash, exposure logged once at a developer's first build in the test). "${CACHE_VARIANT}" builds take ${CACHE_TTC_MULT}x as long as Control builds (the experiment config only assigns arms; the hook applies CACHE_TTC_MULT to build_duration_sec and to the start → finish gap). Pass/fail does not change: failures come from the code, not the cache, so the success rate is the same in both arms (control assertion).`,
		mixpanelReport: { type: "Insights", event: "build finished", measure: "median build_duration_sec", filter: "build_status = success, on or after 2026-07-08", breakdown: `user property "${EXP_KEY}"` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { r: { where: { grp: CACHE_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "r.med_success_sec / c.med_success_sec", op: "between", target: band(CACHE_TTC_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { r: { where: { grp: CACHE_VARIANT } }, c: { where: { grp: "Control" } } },
				// control: the cache does not change whether a build passes
				expect: { metric: "r.success_rate / c.success_rate", op: "between", target: band(1) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${CACHE_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H3-jvm-dotnet-onboarding-friction",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `New developers whose primary stack is Java or .NET finish onboarding (account created → repository imported → pipeline configured → preview deployed) at ${SLOW_STACK_MULT}x the rate of Node, Python, Go, Ruby, and Rust developers (${Math.round(ONBOARD_CONV * SLOW_STACK_MULT)}% vs ${ONBOARD_CONV}% for non-paid-social signups; the paid social cells carry H7's multiplier on top, so the pooled ratio is the same). Declared first funnels with primary_stack conditions; every step but the last is onboarding-only, and the first preview after the pipeline step is the onboarding preview.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARDING_STEPS, breakdown: "user property primary_stack", window: "7 days" },
		assertions: [
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: "primary_stack", conversionWindowMs: 7 * DAY_MS },
				// custom assert: conversion lives in each segment row's step_counts ARRAY and
				// both sides pool several segments; the expect grammar cannot index arrays
				// or sum value-like rows
				assert: (rows) => {
					const slow = convOf(rows, SLOW_STACKS), rest = convOf(rows, Object.keys(STACK_WEIGHTS).filter((k) => !SLOW_STACKS.includes(k)));
					if (!slow || !rest) return { verdict: "NONE", detail: "missing segment rows" };
					if (slow.entered < 600 || rest.entered < 1500) return { verdict: "WEAK", detail: `small segments ${slow.entered}/${rest.entered}` };
					const ratio = slow.rate / rest.rate;
					const [lo, hi] = band(SLOW_STACK_MULT);
					const detail = `onboarding conversion java+dotnet ${slow.converted}/${slow.entered}=${slow.rate.toFixed(4)} vs others ${rest.converted}/${rest.entered}=${rest.rate.toFixed(4)}; ratio ${ratio.toFixed(4)} (knob ${SLOW_STACK_MULT}, band [${lo}, ${hi}])`;
					if (ratio >= lo && ratio <= hi) return { verdict: "NAILED", detail };
					return { verdict: ratio < 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H4-large-pr-review-wait",
		hook: "H4",
		archetype: "funnel-ttc-by-segment",
		narrative: `The wait from "pull request opened" to the first "review submitted" grows with PR size: flat up to ${SMALL_PR_LINES} lines changed, rising log-linearly to ${LARGE_PR_WAIT_MULT}x at ${LARGE_PR_LINES}+ lines (base median ${REVIEW_WAIT_MEDIAN_H} h, log-normal). Every PR's steps share a pr_id, so a funnel holding pr_id constant measures each PR on its own; the median for ${LARGE_PR_LINES}+ line PRs over the median for PRs of ${SMALL_PR_LINES} lines or fewer reads the knob. Forge Assist (H1) acts after the review and does not change the wait.`,
		mixpanelReport: { type: "Funnels", steps: ["pull request opened", "review submitted"], measure: "median time to convert", holdPropertyConstant: "pr_id", breakdown: "lines_changed (custom buckets: ≤100, 101-999, ≥1000)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { l: { where: { grp: "large" } }, s: { where: { grp: "small" } } },
				expect: { metric: "l.med_wait_h / s.med_wait_h", op: "between", target: band(LARGE_PR_WAIT_MULT) },
				minCohort: 800,
			},
		],
	},
	{
		id: "H5-first-build-red-churn",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `A new developer's first CI build fails ${FIRST_BUILD_FAIL * 100}% of the time (mostly configuration mistakes) vs ${BASE_BUILD_FAIL * 100}% for later builds. ${RED_DARK_SHARE * 100}% of developers whose first build fails stop using Forgebench ${RED_DARK_MIN_D}-${RED_DARK_MAX_D} days after it; the rest behave like developers whose first build passed. Day-${RETENTION_DAY} retention (any event in days ${RETENTION_DAY}-${RETENTION_DAY + 6} after signup; signups at least ${RETENTION_DAY + 7} days before the window end) of developers whose first build in their first ${FIRST_BUILD_DAYS} days passed vs failed reads 1/(1 − ${RED_DARK_SHARE}). First-build status is drawn independently of engagement, so the ratio is not confounded. Mixpanel: Funnels account created → build finished (${FIRST_BUILD_DAYS}-day window), breakdown build_status on step 2 (the first build), save each status as a cohort, then Retention account created → any event, custom bracket day ${RETENTION_DAY}-${RETENTION_DAY + 6}, breakdown by those cohorts.`,
		mixpanelReport: { type: "Funnels → cohorts → Retention", cohortFunnel: `account created → build finished, ${FIRST_BUILD_DAYS}-day window, breakdown build_status of step 2; save success / failed as cohorts`, birth: "account created", return: "any event", brackets: `custom: day ${RETENTION_DAY}-${RETENTION_DAY + 6}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { g: { where: { grp: "success" } }, r: { where: { grp: "failed" } } },
				expect: { metric: "g.retention / r.retention", op: "between", target: band(1 / (1 - RED_DARK_SHARE)) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H6-npm-registry-incident",
		hook: "H6",
		archetype: "external-join",
		narrative: `Forgebench's npm registry mirror degrades from ${D(REGISTRY_INCIDENT_START)} to ${D(REGISTRY_INCIDENT_END)} (exclusive): ${INCIDENT_FAIL * 100}% of npm-ecosystem builds that would have passed fail at dependency_install. The incident days and ecosystem come from the warehouse table build_fleet_daily (registry_mirror_status = 'degraded'); events carry no incident flag. The event-side read is a ratio of ratios (npm success rate / other ecosystems, incident days vs the 7 days either side), which reads the 1 − ${INCIDENT_FAIL} keep rate while cancelling weekday volume and the experiment mix.`,
		mixpanelReport: { type: "Insights", event: "build finished", measure: "share with build_status = success", breakdown: "ecosystem", chart: "daily line", join: "warehouse build_fleet_daily.registry_mirror_status" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - INCIDENT_FAIL) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE registry_mirror_status = 'degraded') AS degraded_rows,
 avg(dependency_fetch_error_rate) FILTER (WHERE registry_mirror_status = 'degraded') AS degraded_err,
 count(*) FILTER (WHERE registry_mirror_status = 'degraded' AND (date::DATE < DATE '${D(REGISTRY_INCIDENT_START)}' OR date::DATE >= DATE '${D(REGISTRY_INCIDENT_END)}' OR ecosystem <> '${INCIDENT_ECOSYSTEM}')) AS misplaced
FROM ${WH("build_fleet_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse dependency fetch error rate during the incident = the failure knob
				expect: { metric: "a.degraded_err", op: "between", target: band(INCIDENT_FAIL) },
			},
		],
	},
	{
		id: "H7-paid-channel-economics",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative: `Paid social looks cheapest per signup: over the window marketing_spend_daily bills $${CPL_USD.paid_social} per Mixpanel signup on paid social vs $${CPL_USD.paid_search} on paid search and $${CPL_USD.newsletter} on newsletter sponsorships (campaigns bid to a target cost per signup within a weekly budget: a day's bill is the cost per signup × a quarter of that day's signups plus three quarters of the signups planned at the week's budget, with seeded noise, never zero; a bigger weekly budget wins the channel a bigger share of new signups). But paid social signups finish onboarding at ${SOCIAL_ONBOARD_MULT}x the rate of every other channel (declared onboarding funnel copies with an acquisition_channel condition), so per onboarded developer paid search is cheaper. Spend per signup needs the warehouse join; the onboarding read is the Mixpanel funnel broken down by acquisition_channel.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "marketing_spend_daily.spend_usd", funnel: "onboarding steps, 7-day window, breakdown user property acquisition_channel" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT acquisition_channel AS ch, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} GROUP BY 1)
SELECT s.ch AS grp, s.users AS user_count, sp.spend / s.signups AS spend_per_signup FROM s JOIN sp ON sp.ch = s.ch`,
				},
				select: { so: { where: { grp: "paid_social" } }, se: { where: { grp: "paid_search" } } },
				expect: { metric: "so.spend_per_signup / se.spend_per_signup", op: "between", target: band(CPL_USD.paid_social / CPL_USD.paid_search) },
				minCohort: 500,
			},
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: "acquisition_channel", conversionWindowMs: 7 * DAY_MS },
				// custom assert: conversion lives in each segment row's step_counts ARRAY and
				// the control pools five channels; the expect grammar cannot express it
				assert: (rows) => {
					const soc = convOf(rows, ["paid_social"]), rest = convOf(rows, Object.keys(CHANNEL_WEIGHTS).filter((k) => k !== "paid_social"));
					if (!soc || !rest) return { verdict: "NONE", detail: "missing segment rows" };
					if (soc.entered < 400 || rest.entered < 1500) return { verdict: "WEAK", detail: `small segments ${soc.entered}/${rest.entered}` };
					const ratio = soc.rate / rest.rate;
					const [lo, hi] = band(SOCIAL_ONBOARD_MULT);
					const detail = `onboarding conversion paid_social ${soc.converted}/${soc.entered}=${soc.rate.toFixed(4)} vs other channels ${rest.converted}/${rest.entered}=${rest.rate.toFixed(4)}; ratio ${ratio.toFixed(4)} (knob ${SOCIAL_ONBOARD_MULT}, band [${lo}, ${hi}])`;
					if (ratio >= lo && ratio <= hi) return { verdict: "NAILED", detail };
					return { verdict: ratio < 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H8-team-overage-billing",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `From ${D(METERED_START)} Team seats pay $${OVERAGE_PRICE_PER_MIN} per build minute above the included allowance (announced two weeks earlier). Each Team org reacts on a day in the ${SCHEDULED_CUT_RAMP_DAYS} days after the switch by turning off ${(SCHEDULED_CUT_MEAN - SCHEDULED_CUT_SPREAD) * 100}-${(SCHEDULED_CUT_MEAN + SCHEDULED_CUT_SPREAD) * 100}% of its scheduled (cron) builds (mean ${SCHEDULED_CUT_MEAN * 100}%); push and pull-request builds do not change. Scheduled builds per push build for Team seats (plan_tier at event time), ${METERED_POST_FROM.slice(0, 10)} to Sep 30 vs August, reads 1 − ${SCHEDULED_CUT_MEAN}; Free, Pro, and Enterprise are unmetered and stay at 1.0. The overage itself exists only in the warehouse table usage_billing_daily (zero before the switch and on every other plan). Pooled allowances reset on the 1st, so overage is zero on days 1-${ALLOWANCE_RESET_DAYS} of a month and grows as orgs run out; every Team day from September ${OVERAGE_FROM_DAY} bills some.`,
		mixpanelReport: { type: "Insights", event: "build started", measure: "total, formula schedule / push", breakdown: "trigger, plan_tier", chart: "weekly line", join: "usage_billing_daily.overage_revenue_usd" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { t: { where: { grp: "team" } } },
				expect: { metric: "t.did", op: "between", target: band(1 - SCHEDULED_CUT_MEAN) },
				minCohort: 800,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { o: { where: { grp: "other_plans" } } },
				// control: unmetered plans keep their scheduled builds
				expect: { metric: "o.did", op: "between", target: band(1) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE overage_revenue_usd > 0 AND (plan_tier <> '${METERED_PLAN}' OR date::DATE < DATE '${D(METERED_START)}')) AS misplaced_rows
FROM ${WH("usage_billing_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: overage is billed only to Team, only from the switch
				expect: { metric: "a.misplaced_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE plan_tier = '${METERED_PLAN}' AND date::DATE >= DATE '${D(METERED_START)}' AND date::DATE < DATE '${METERED_MONTH_END}'
   AND day(date::DATE) >= ${OVERAGE_FROM_DAY} AND overage_revenue_usd <= 0)
 + count(*) FILTER (WHERE plan_tier = '${METERED_PLAN}' AND day(date::DATE) <= ${ALLOWANCE_RESET_DAYS} AND overage_revenue_usd > 0) AS missing_rows
FROM ${WH("usage_billing_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: allowances reset on the 1st, so no Team day 1-3 of a month bills overage,
				// and every Team day from September 8 to 30 bills some
				expect: { metric: "a.missing_rows", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H9-test-coverage-rollbacks",
		hook: "H9",
		archetype: "cohort-prop-scale",
		narrative: `Production deploys from repositories with low test coverage roll back more often: ${ROLLBACK_LOW_COV * 100}% at ${COVERAGE_LOW}% coverage or less, falling linearly to ${ROLLBACK_HIGH_COV * 100}% at ${COVERAGE_HIGH}% or more (each repository's deploys follow its rate through a low-discrepancy sequence, so per-repository rates sit close to the curve). test_coverage_pct is a property of the repository, carried on every PR step. Rollback rate for deploys at ≤${COVERAGE_LOW}% coverage over ≥${COVERAGE_HIGH}% reads ${ROLLBACK_LOW_COV}/${ROLLBACK_HIGH_COV}. Forge Assist and PR size do not change rollbacks.`,
		mixpanelReport: { type: "Insights", event: "production deployed", measure: "share with deploy_outcome = rolled_back", breakdown: "test_coverage_pct (custom buckets: ≤30, 31-74, ≥75)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { l: { where: { grp: "low" } }, h: { where: { grp: "high" } } },
				expect: { metric: "l.rollback_rate / h.rollback_rate", op: "between", target: band(ROLLBACK_LOW_COV / ROLLBACK_HIGH_COV) },
				minCohort: 800,
			},
		],
	},
	{
		id: "H10-preview-habit-converts",
		hook: "H10",
		archetype: "cohort-count-scale",
		narrative: `New developers who ship ${PQL_MIN_PREVIEWS}+ preview deploys in their first ${PQL_DAYS} days (the onboarding preview counts) buy a paid seat far more often: every would-be purchase of a habit user happens, while only ${NON_PQL_KEEP * 100}% of everyone else's do. Read: share of Free signups (plan_tier = free on account created; developers who join their company's Team or Enterprise workspace have nothing to buy) through ${PQL_COHORT_END.slice(0, 10)}, so each has a full ${BUY_WINDOW_DAYS}-day purchase window, who start a subscription within ${BUY_WINDOW_DAYS} days, habit (${PQL_MIN_PREVIEWS}+ previews) vs light (1-2 previews; users with no preview never finished onboarding and are excluded). The keep ratio ${PQL_KEEP}/${NON_PQL_KEEP} is a floor for that paid rate: habit users are also heavier users who reach the upgrade page more often, so the realized ratio sits above it (STRONG by design). The controlled read is purchases per upgrade-page visit in the first ${BUY_WINDOW_DAYS} days: each would-be purchase is kept at the habit's share and a developer stops visiting after buying, so habit / light reads ${PQL_KEEP}/${NON_PQL_KEEP} whatever the visit counts. Mixpanel: Funnels account created → preview deployed → preview deployed → preview deployed, ${PQL_DAYS}-day window; completed = habit, dropped after step 2 or 3 = light; save as cohorts; then Funnels account created → subscription started, ${BUY_WINDOW_DAYS}-day window, breakdown by those cohorts.`,
		mixpanelReport: { type: "Funnels → cohorts → Funnels", cohortFunnel: `account created → preview deployed ×3, ${PQL_DAYS}-day window`, funnel: `account created → subscription started, ${BUY_WINDOW_DAYS}-day window`, breakdown: "habit / light cohorts" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { h: { where: { grp: "habit" } }, l: { where: { grp: "light" } } },
				// engagement adds to the keep ratio: knob-derived floor, STRONG above +10%
				expect: { metric: "h.paid_rate / l.paid_rate", op: ">=", target: PQL_KEEP / NON_PQL_KEEP, floor: 0.9 * PQL_KEEP / NON_PQL_KEEP },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H10_VISIT_SQL },
				select: { h: { where: { grp: "habit" } }, l: { where: { grp: "light" } } },
				// controls for upgrade-page reach: purchases per visit read the keep ratio
				expect: { metric: "h.buys_per_visit / l.buys_per_visit", op: "between", target: band(PQL_KEEP / NON_PQL_KEEP) },
				minCohort: 150,
			},
		],
	},
];

export default config;

// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       CloudForge
 * APP:        B2B SaaS that fuses infrastructure monitoring (Datadog-style) with
 *             deployment automation (Terraform-style). Engineering teams create
 *             workspaces, deploy services across AWS/GCP/Azure, monitor uptime
 *             and cost, and respond to alerts via Slack/PagerDuty runbooks.
 *             Pricing: Free / Team / Business / Enterprise (seats + usage).
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  workspace created → service deployed → dashboard viewed → alert/resolve
 *
 * EVENTS (19):
 *   dashboard viewed (20) > api call (16) > query executed (15) > alert triggered (12)
 *   > service deployed (10) > deployment pipeline run (9) > alert acknowledged (8)
 *   > alert resolved (7) > documentation viewed (7) > security scan (6)
 *   > infrastructure scaled (5) > cost report generated (4) > integration configured (4)
 *   > feature flag toggled (4) > team member invited (3) > runbook executed (3)
 *   > billing event (3) > workspace created (1) > incident created (1)
 *
 * FUNNELS (8):
 *   - Onboarding:           workspace created → service deployed → dashboard viewed (70%)
 *   - Daily Monitoring:     dashboard viewed → query executed → api call (80%)
 *   - Incident Response:    alert triggered → alert acknowledged → alert resolved (55%)
 *   - Deployment:           deployment pipeline run → service deployed → dashboard viewed (65%, Canary A/B)
 *   - Infrastructure Mgmt:  cost report generated → infrastructure scaled → security scan (50%)
 *   - Team & Config:        team member invited → integration configured → feature flag toggled (40%)
 *   - Docs & Runbooks:      documentation viewed → runbook executed → service deployed (45%)
 *   - Billing:              billing event → dashboard viewed (60%)
 *
 * USER PROPS:  company_size, primary_role, team_name, seat_count, annual_contract_value,
 *              customer_success_manager, customer_health_score, plan_tier, cloud_provider
 * SUPER PROPS: plan_tier, cloud_provider
 * SCD PROPS:   primary_role (viewer/editor/admin/owner, monthly fuzzy, max 6),
 *              plan_tier (starter/growth/enterprise/scale, monthly fixed, max 6, company_id-scoped)
 * GROUPS:      company_id (300 companies)
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * behavioral cohorts or raw-prop breakdowns (company_size, day, doc_section).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. END-OF-QUARTER SPIKE (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Days 100-110 billing events shift event_type toward "plan_upgraded"
 * 40% of the time and team member invitations are duplicated 50% of the time.
 * No flag — discover via line chart by day.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Plan Upgrades Over Time
 *   - Report type: Insights
 *   - Event: "billing event"
 *   - Measure: Total
 *   - Filter: event_type = "plan_upgraded"
 *   - Line chart by day
 *   - Expected: ~3.9x upgrades/day during days 100-110 (2026-04-11 to
 *     2026-04-21). Mechanism: baseline plan_upgraded share is 1/8 of
 *     billing events (~0.113 measured); in-window 40% are forced +
 *     60% x baseline = ~0.45 share at flat billing volume.
 *
 *   Report 2: Team Expansion Surge
 *   - Report type: Insights
 *   - Event: "team member invited"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: ~1.55x invites/day during days 100-110 (50% clone
 *     likelihood -> 1.5x; clones land +1-60min, mostly in-window)
 *
 * REAL-WORLD ANALOGUE: B2B SaaS revenue clusters at quarter-close as sales
 * teams pull deals forward and customers expand seats to lock in pricing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. CHURNED ACCOUNT SILENCING (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: ~20% of users (deterministic: charCode-sum of user_id % 5 === 0)
 * go completely silent after day 30. All post-d30 events are removed via
 * splice(). No flag — derive cohort via behavioral retention bucket (users
 * with zero activity past d30 vs the rest).
 *
 * MEASUREMENT NOTES (verified at 2K reduced scale):
 *   - Churn-hashed users born AFTER day 30 lose their ENTIRE stream: they
 *     appear as zero-event profiles (~2.4% of all profiles have no events).
 *   - Among event-visible users, the hashed cohort is ~19%; every one of
 *     them is born in days 1-30 (born_early share = 1.0 for the cohort).
 *   - Hook 5/10 deploy clones spawn at lastEvent + 1-48h AFTER the churn
 *     splice runs, so a churned sweet-spot user can carry clones up to
 *     ~day 33. Use day 34 (2026-02-04) as the behavioral silence cutoff
 *     to read the cohort cleanly (silent share 1.00 at that cutoff).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention Cliff
 *   - Cohort A: users with at least 1 event after 2026-02-04
 *   - Cohort B: users with events only before 2026-02-04
 *   - Compare cohort sizes — B should be ~19% of event-visible users
 *
 *   Report 2: Activity Volume Pre/Post Day 30
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Total per user
 *   - Line chart by day
 *   - Expected: a visible drop after d30 driven by the silent cohort
 *
 * REAL-WORLD ANALOGUE: Most SaaS churn happens silently — accounts simply
 * stop logging in long before the formal cancellation lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. ALERT ESCALATION REPLACEMENT (event)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 30% of critical/emergency "alert triggered" events are REPLACED
 * with an escalated "incident created" event. The escalated event keeps the
 * source alert's properties (alert_id, severity, escalation fields).
 *
 * MEASUREMENT NOTES (verified at 2K reduced scale):
 *   - "incident created" is ALSO a weight-1 organic event in the events
 *     array. Organic incidents have NO alert_id (NULL); escalated ones
 *     carry alert_id from the source alert. Escalated is ~45% of total
 *     incident volume — don't count organic incidents against the 30%.
 *   - The exact invariant: escalated / (escalated + remaining crit/emerg
 *     alerts) = 0.30, because escalation removes the source alert.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Incident Created Discovery
 *   - Report type: Insights
 *   - Event: "incident created"
 *   - Measure: Total
 *   - Breakdown: "escalation_level"
 *   - Filter: alert_id is set (escalated only)
 *   - Expected: P1 and P2 incidents; 30% of pre-replacement crit/emerg volume
 *
 *   Report 2: Alert vs Incident Ratio
 *   - Report type: Insights
 *   - Events: "alert triggered" (severity critical/emergency) AND
 *     "incident created" (alert_id set)
 *   - Measure: Total
 *   - Expected: incidents / (incidents + remaining crit/emerg alerts) = 0.30
 *
 * REAL-WORLD ANALOGUE: Severe alerts get auto-promoted into incident
 * tickets that page on-call engineers and trigger customer comms.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 4. INTEGRATION USERS SUCCEED (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with BOTH "slack" AND "pagerduty" "integration configured"
 * events resolve alerts faster: response_time_mins reduced 60%, resolution_time_mins
 * reduced 50%. No flag — derive cohort behaviorally.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Response Time by Integration Cohort
 *   - Cohort A: users who configured BOTH slack AND pagerduty integrations
 *   - Cohort B: rest
 *   - Event: "alert acknowledged"
 *   - Measure: Average of "response_time_mins"
 *   - Expected: A / B avg response ~ 0.39 (knob 0.4; H9 company-size
 *     scaling mixes evenly across both cohorts so the ratio stays clean)
 *
 *   Report 2: Resolution Time by Integration Cohort
 *   - Cohort A vs B (as above)
 *   - Event: "alert resolved"
 *   - Measure: Average of "resolution_time_mins"
 *   - Expected: A / B avg resolution ~ 0.50 (knob 0.5)
 *
 * REAL-WORLD ANALOGUE: Teams that wire alerting into their existing comms
 * stack respond minutes faster — the alert literally finds the human.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 5. DOCS READERS DEPLOY MORE (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the 4-7 documentation-viewed sweet spot get 2-3 extra
 * production "service deployed" events cloned into their stream (clones at
 * lastEvent + 1-48h; shared implementation with Hook 10 — same code block).
 * Any doc view counts — there is no doc_section condition. No flag — derive
 * cohort by counting doc views per user.
 *
 * MEASUREMENT NOTES (verified at 2K reduced scale, organic counterfactual):
 *   - ~1/3 of clones are shaved by the future-time guard (end-active users
 *     spawn clones past dataset end) → net ~ +1.7 deploys/user engineered.
 *   - Raw deploys/user by bucket is dominated by the ACTIVITY confound:
 *     users with more doc views have more of everything (organic
 *     deploys-per-other-event rises ~18% from low to over bucket).
 *   - The clean read is rate-over-rate: deploys per non-doc/non-deploy
 *     event, restricted to NON-CHURNED users (churn splice truncates doc
 *     counts and migrates users between buckets).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Per-User Deploy Rate by Docs Cohort
 *   - Cohort A: non-churned users with 4-7 "documentation viewed" events
 *   - Cohort B: non-churned users with 0-3
 *   - Event: "service deployed"
 *   - Measure: Total per user, normalized by overall activity
 *   - Expected: A / B deploys-per-other-event ~ 1.26
 *
 * REAL-WORLD ANALOGUE: Engineers who read the docs ship more confidently
 * and more often than those who guess at the platform.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 6. COST OVERRUN PATTERN (event — closure state)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: When cost_change_percent > 25 on a "cost report generated" event,
 * the user is stored in a module-level Map. Their next "infrastructure scaled"
 * event is forced to scale_direction = "down". No flag — discover by
 * sequencing cost-report → infrastructure-scaled per user.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Scale Direction Distribution
 *   - Report type: Insights
 *   - Event: "infrastructure scaled"
 *   - Measure: Total
 *   - Breakdown: "scale_direction"
 *   - Expected: "down" share elevated above the 25% baseline (the
 *     scale_direction array is ["up","up","up","down"], NOT 50/50)
 *
 *   Report 2: Sequencing Check
 *   - Inspect users whose most recent cost report had
 *     cost_change_percent > 25; their next "infrastructure scaled"
 *     should be scale_direction="down"
 *   - Expected: ~90% down-share for armed-state scale events vs ~27%
 *     unarmed. Not 100%: the hook arms on event-generation order while
 *     the read sequences by timestamp, and those orders differ slightly.
 *
 * REAL-WORLD ANALOGUE: A surprise cloud bill triggers an immediate
 * downscale; no engineer ignores a 25% month-over-month cost jump.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 7. FAILED DEPLOYMENT RECOVERY (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: After a failed pipeline run, the user's next successful deploy has
 * duration_sec * 1.5 (recovery deploys are slower). No flag — discover by
 * sequencing failed → next-success pipeline events per user and comparing
 * duration.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Pipeline Duration After Failure (sequencing query)
 *   - For each user, find runs where prior run was status="failed"
 *   - Compare avg duration_sec of those "next" runs vs all other successful runs
 *   - Expected: post-failure runs ~ 1.5x longer duration (measured 1.52
 *     at 2K when excluding each user's first run, which has no prior)
 *
 * REAL-WORLD ANALOGUE: After a bad deploy, teams add manual gates and
 * extra verification steps that slow the very next release.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 8. ENTERPRISE VS STARTUP (user)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Company size determines seat_count, annual_contract_value, and
 * customer_success_manager (enterprise only). All users get a
 * customer_health_score on the profile.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: ACV by Company Size
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Unique users
 *   - Breakdown: "company_size" (user property)
 *   - Expected: startup ($0-3.6K), smb ($3.6K-12K), mid_market ($12K-50K),
 *     enterprise ($50K-500K)
 *
 *   Report 2: Seat Count by Company Size
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Average of "seat_count" (user property)
 *   - Breakdown: "company_size"
 *   - Expected: monotonic ramp from startup to enterprise
 *
 * REAL-WORLD ANALOGUE: B2B SaaS pricing scales orders of magnitude across
 * customer segments — from a $99/mo startup to a $500K Fortune 500 contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 9. INCIDENT RESPONSE TTC (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Enterprise companies resolve incidents faster; startups resolve
 * slower. Two legs, same factors (enterprise 0.67x, startup 1.5x,
 * smb/mid_market unchanged):
 *   1. Property leg (everything hook): scales response_time_mins (on
 *      "alert acknowledged") and resolution_time_mins (on "alert
 *      resolved"). Carries the FULL engineered effect.
 *   2. Funnel-timestamp leg (funnel-post hook, 1.6 rework): EVERY
 *      incident-funnel instance has its inter-step gaps scaled
 *      per-instance. Pre-1.6 this scaled one findFirstSequence chain in
 *      the everything hook — often stitched across separate funnel
 *      instances — so the report median was dominated by unscaled
 *      instances and the delta never survived.
 * Compounds with Hook 4 (integration users) — an enterprise user with
 * both Slack and PagerDuty stacks 0.4 x 0.67 on response time.
 *
 * MEASUREMENT NOTES (verified at 2K reduced scale):
 *   - The funnel TTC read ATTENUATES ASYMMETRICALLY under Mixpanel's
 *     greedy funnel evaluation. Organic standalone "alert triggered"
 *     soup events also start chains; the greedy evaluator takes the
 *     first completing chain. Compressed (enterprise) instances win
 *     that race → most of the 0.67 survives (observed ~0.79x baseline
 *     median). Stretched (startup) instances lose the race to organic
 *     alerts completing first → observed ~1.11x, not 1.5x.
 *   - Use a 24h conversion window: the TTC distribution is unimodal
 *     within 24h; longer windows only add a slow organic tail that
 *     dilutes the segment medians.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Response Time by Company Size
 *   - Report type: Insights
 *   - Event: "alert acknowledged"
 *   - Measure: Average of "response_time_mins"
 *   - Breakdown: "company_size" (user property)
 *   - Expected: enterprise ~ 0.65x the smb/mid_market average;
 *     startup ~ 1.5x (full factors — property leg is unattenuated)
 *
 *   Report 2: Incident Funnel TTC by Company Size
 *   - Report type: Funnels
 *   - Steps: "alert triggered" → "alert acknowledged" → "alert resolved"
 *   - Conversion window: 24 hours
 *   - Measure: Median time to convert
 *   - Breakdown: "company_size"
 *   - Expected: enterprise ~ 0.79x the smb/mid_market median;
 *     startup ~ 1.11x (greedy attenuation — see MEASUREMENT NOTES)
 *
 *   Report 3: Avg Resolution Time by Company Size
 *   - Report type: Insights
 *   - Event: "alert resolved"
 *   - Measure: Average of "resolution_time_mins"
 *   - Breakdown: "company_size"
 *   - Expected: enterprise ~ 0.66x the smb/mid_market average;
 *     startup ~ 1.49x
 *
 * REAL-WORLD ANALOGUE: Enterprise teams have dedicated SRE rotations,
 * automated runbooks, and premium support contracts that compress
 * incident timelines. Startups rely on smaller teams with less tooling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 10. DOCS MAGIC NUMBER (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the 4-7 documentation-viewed sweet spot get 2-3 extra
 * production "service deployed" events cloned into their stream; users
 * with 8+ documentation views are over-engaged browsers and 25% of their
 * "service deployed" events are dropped (shared implementation with Hook
 * 5 — same code block). No flag is stamped — discoverable only by binning
 * users on doc-view count and comparing per-user deploy rate.
 *
 * MEASUREMENT NOTES (verified at 2K reduced scale, organic counterfactual):
 *   - The 25% drop is EXACT per user (paired organic-vs-hooked delta =
 *     0.750), but the raw bucket comparison is confounded by the organic
 *     activity curve: over-bucket users are the most active, so their
 *     organic deploys-per-other-event runs ~1.18x the low bucket.
 *   - Net observed rate-over-rate (non-churned users): over/low ~ 0.89
 *     (= 0.75 engineered x 1.18 activity curve), over/sweet ~ 0.70
 *     (drop leg vs clone leg, confounds mostly cancel).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Deploy Rate by Docs-View Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort C: non-churned users with >= 8 "documentation viewed" events
 *   - Cohort B: non-churned users with 0-3
 *   - Event: "service deployed"
 *   - Measure: Total per user, normalized by overall activity
 *   - Expected: C / B deploys-per-other-event ~ 0.89
 *
 *   Report 2: Heavy Readers vs Sweet Spot
 *   - Cohort C (8+) vs Cohort A (4-7), non-churned
 *   - Expected: C / A deploys-per-other-event ~ 0.70
 *
 * REAL-WORLD ANALOGUE: Engineers who read just enough docs deploy with
 * confidence; those who read excessively may be stuck troubleshooting
 * and never ship, or are evaluating the product without committing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 11. DEPLOY PIPELINE EXPERIMENT (funnel experiment — engine-managed)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: The deployment funnel (deployment pipeline run → service deployed
 * → dashboard viewed) runs a "Canary Deploys" experiment starting 45 days
 * before dataset end (2026-03-17). Users are deterministically assigned to
 * Control or "Canary Deploys" variant (hash of user:experiment). The Canary
 * variant gets 1.2x conversion multiplier and 0.85x time-to-convert
 * multiplier. The engine emits `$experiment_started` events with
 * `Experiment name` and `Variant name` properties (lowercase n — engine
 * column casing). No hook code needed.
 *
 * MEASUREMENT NOTES (verified at 2K reduced scale):
 *   - Read PER-INSTANCE, not per-user: each $experiment_started anchors
 *     one funnel attempt (steps within 24h after it). User-level reads
 *     dilute the lift because multi-attempt users mix converted and
 *     unconverted instances (measured 1.15 user-level vs 1.21
 *     per-instance at 2K).
 *   - Both arms read HIGHER than the configured rates (0.87 vs knob
 *     0.78, 0.72 vs 0.65) because organic deploy/dashboard soup events
 *     complete some engineered-failed instances. The RATIO survives:
 *     ~1.21 observed vs 1.2 knob.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Experiment Enrollment
 *   - Report type: Insights
 *   - Event: "$experiment_started"
 *   - Measure: Total
 *   - Breakdown: "Variant name"
 *   - Expected: roughly even user split between "Control" and
 *     "Canary Deploys" (deterministic hash, ~47-53%)
 *
 *   Report 2: Deploy Funnel by Variant
 *   - Report type: Funnels
 *   - Steps: "deployment pipeline run" → "service deployed" → "dashboard viewed"
 *   - Breakdown: "Variant name"
 *   - Expected: Canary ~ 1.2x conversion vs Control (per-instance read)
 *
 *   Report 3: Deploy TTC by Variant
 *   - Report type: Funnels
 *   - Steps: same as above
 *   - Measure: Median time to convert
 *   - Breakdown: "Variant name"
 *   - Expected: Canary median TTC ~ 0.81x Control (knob 0.85; small-n
 *     median noise at reduced scale)
 *
 * REAL-WORLD ANALOGUE: Teams A/B test canary deployment strategies.
 * Canary deploys catch issues earlier, improving both success rate and
 * deployment velocity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPECTED METRICS SUMMARY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All values measured at 2K reduced scale (seed harness-sass); ratios are
 * scale-stable. "Organic" columns come from an exact counterfactual run:
 * same seed with an identity hook — the dungeon's own chance instance is
 * separate from the engine RNG, so users and organic events are identical.
 *
 * Hook                     | Metric                                | Expected
 * -------------------------|---------------------------------------|----------
 * H1a EOQ Spike            | upgrades/day, days 100-110 vs rest    | ~3.95x
 * H1a EOQ Spike            | plan_upgraded share in-window         | ~0.45 (baseline 0.11)
 * H1b EOQ Spike            | invites/day, days 100-110 vs rest     | ~1.55x
 * H2 Churned Accounts      | hash cohort share of event-users      | ~19%
 * H2 Churned Accounts      | hash-true silent before 2026-02-04    | 100%
 * H2 Churned Accounts      | zero-event profiles (late-born churn) | ~2.4%
 * H3 Alert Escalation      | esc / (esc + remaining crit/emerg)    | 0.30
 * H3 Alert Escalation      | esc share of total incidents          | ~0.45
 * H4 Integration Users     | both-integ / rest avg response        | ~0.39
 * H4 Integration Users     | both-integ / rest avg resolution      | ~0.50
 * H5 Docs Readers          | sweet/low deploys-per-other (non-ch)  | ~1.26
 * H6 Cost Overrun          | armed down-share vs unarmed           | ~0.90 vs ~0.27
 * H7 Deploy Recovery       | recovery / other success duration     | ~1.52
 * H8 Enterprise v Startup  | ACV ent/mid/smb/startup ($K)          | ~273/31/7.8/1.8
 * H9 Incident TTC (props)  | ent & startup resp vs smb/mid avg     | ~0.65x & ~1.50x
 * H9 Incident TTC (funnel) | median TTC @24h window, ent & startup | ~0.79x & ~1.11x
 * H10 Docs Magic Number    | over/low deploys-per-other (non-ch)   | ~0.89 (0.75 x 1.18 activity)
 * H10 Docs Magic Number    | over/sweet deploys-per-other          | ~0.70
 * H11 Deploy Experiment    | per-instance conversion lift          | ~1.21 (knob 1.2)
 * H11 Deploy Experiment    | Canary/Control median TTC             | ~0.81 (knob 0.85)
 *
 * MEASUREMENT CAVEATS:
 *   - Activity confound: doc-view buckets correlate with overall activity;
 *     read deploys as a rate over other events, never raw counts.
 *   - Future-time guard shaves ~1/3 of H5 deploy clones (spawn past
 *     dataset end) — engineered +2.5 clones reads as ~+1.7.
 *   - Greedy funnel evaluation attenuates H9's stretched (startup) leg
 *     far more than the compressed (enterprise) leg — see Hook 9 notes.
 *   - H2 churn splice truncates doc counts: restrict H5/H10 cohorts to
 *     non-churned users or bucket membership migrates.
 */

// ── SCALE ──
const SEED = "harness-sass";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const EOQ_START_DAY = 100;
const EOQ_END_DAY = 110;
const EOQ_UPGRADE_LIKELIHOOD = 40;
const EOQ_INVITE_CLONE_LIKELIHOOD = 50;

const CHURN_USER_HASH_MOD = 5;
const CHURN_CUTOFF_DAYS = 30;

const ALERT_ESCALATION_LIKELIHOOD = 30;

const INTEGRATION_RESPONSE_FACTOR = 0.4;
const INTEGRATION_RESOLUTION_FACTOR = 0.5;

const COST_OVERRUN_THRESHOLD = 25;

const FAILED_DEPLOY_RECOVERY_MULT = 1.5;

const DOCS_SWEET_MIN = 4;
const DOCS_SWEET_MAX = 7;
const DOCS_OVER_THRESHOLD = 8;
const DOCS_EXTRA_DEPLOYS_MIN = 2;
const DOCS_EXTRA_DEPLOYS_MAX = 3;
const DOCS_DEPLOY_DROP_LIKELIHOOD = 25;

const TTC_ENTERPRISE_FACTOR = 0.67;
const TTC_STARTUP_FACTOR = 1.5;

// ── DATA ARRAYS ──
const serviceIds = v.range(1, 201).map(() => `svc_${v.uid(8)}`);
const alertIds = v.range(1, 501).map(() => `alert_${v.uid(6)}`);
const pipelineIds = v.range(1, 101).map(() => `pipe_${v.uid(6)}`);
const runbookIds = v.range(1, 51).map(() => `rb_${v.uid(6)}`);

// ── HOOK STATE ──
// Module-level Map for closure-based state tracking across event-hook calls
const costOverrunUsers = new Map();

// ── HELPER FUNCTIONS ──
function handleEventHooks(record) {
	// H3: ALERT ESCALATION REPLACEMENT — critical/emergency alerts sometimes
	// become incident-created events.
	if (record.event === "alert triggered") {
		const severity = record.severity;
		if ((severity === "critical" || severity === "emergency") && chance.bool({ likelihood: ALERT_ESCALATION_LIKELIHOOD })) {
			return {
				...record,
				event: "incident created",
				escalation_level: chance.pickone(["P1", "P2"]),
				teams_paged: chance.integer({ min: 1, max: 5 }),
				incident_id: `inc_${v.uid(8)}`,
				original_severity: severity,
				original_alert_type: record.alert_type,
				auto_escalated: true,
			};
		}
	}

	// H6: COST OVERRUN PATTERN — cost reports with cost_change > 25% record
	// the user, then the next infrastructure-scaled event from that user is
	// forced to scale_direction = "down".
	if (record.event === "cost report generated" && record.cost_change_percent > COST_OVERRUN_THRESHOLD) {
		costOverrunUsers.set(record.user_id, true);
	}
	if (record.event === "infrastructure scaled" && costOverrunUsers.has(record.user_id)) {
		record.scale_direction = "down";
		costOverrunUsers.delete(record.user_id);
	}

	return record;
}

function handleUserHooks(record) {
	// H8: ENTERPRISE VS STARTUP — company size determines seat count, ACV,
	// and CSM. Real profile attrs.
	const companySize = record.company_size;
	if (companySize === "enterprise") {
		record.seat_count = chance.integer({ min: 50, max: 500 });
		record.annual_contract_value = chance.integer({ min: 50000, max: 500000 });
		record.customer_success_manager = true;
	} else if (companySize === "mid_market") {
		record.seat_count = chance.integer({ min: 10, max: 50 });
		record.annual_contract_value = chance.integer({ min: 12000, max: 50000 });
		record.customer_success_manager = false;
	} else if (companySize === "smb") {
		record.seat_count = chance.integer({ min: 3, max: 10 });
		record.annual_contract_value = chance.integer({ min: 3600, max: 12000 });
		record.customer_success_manager = false;
	} else if (companySize === "startup") {
		record.seat_count = chance.integer({ min: 1, max: 5 });
		record.annual_contract_value = chance.integer({ min: 0, max: 3600 });
		record.customer_success_manager = false;
	}
	record.customer_health_score = chance.integer({ min: 1, max: 100 });
	return record;
}

function handleFunnelPostHooks(record, meta) {
	// H9: INCIDENT RESPONSE TTC — scale EVERY incident-funnel instance's
	// inter-step gaps by company_size. Pre-1.6 this used findFirstSequence
	// with a 30-day window in the everything hook: it scaled ONE sequence
	// per user (often stitched across separate funnel instances), so the
	// funnel median TTC was dominated by the user's unscaled instances and
	// the engineered delta never survived to the report. Per-instance
	// funnel-post scaling is what Mixpanel's funnel TTC actually reads.
	// No other funnel shares the alert-step prefix, so scaling only this
	// funnel cannot dilute reads elsewhere (marketplace H9 lesson).
	if (meta?.funnel?.sequence?.[0] !== "alert triggered") return record;
	const size = meta?.profile?.company_size;
	const factor = (
		size === "enterprise" ? TTC_ENTERPRISE_FACTOR :
		size === "startup" ? TTC_STARTUP_FACTOR :
		1.0
	);
	if (factor !== 1.0 && Array.isArray(record) && record.length > 1) {
		for (let i = 1; i < record.length; i++) {
			const prev = dayjs(record[i - 1].time);
			const newGap = Math.round(dayjs(record[i].time).diff(prev) * factor);
			record[i].time = prev.add(newGap, "milliseconds").toISOString();
		}
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	const userEvents = record;
	const profile = meta.profile;

	userEvents.forEach(e => {
		e.plan_tier = profile.plan_tier;
		e.cloud_provider = profile.cloud_provider;
	});

	// H1a: END-OF-QUARTER SPIKE — days 100-110, billing events flip
	// event_type to plan_upgraded 40% of the time.
	userEvents.forEach(e => {
		if (e.event !== "billing event") return;
		const dayInDataset = dayjs(e.time).diff(datasetStart, "days", true);
		if (dayInDataset >= EOQ_START_DAY && dayInDataset <= EOQ_END_DAY && chance.bool({ likelihood: EOQ_UPGRADE_LIKELIHOOD })) {
			e.event_type = "plan_upgraded";
		}
	});

	// H1b: END-OF-QUARTER TEAM INVITE SPIKE — days 100-110, clone 50% of
	// team-member-invited events (push, not return).
	for (let i = userEvents.length - 1; i >= 0; i--) {
		const e = userEvents[i];
		if (e.event !== "team member invited") continue;
		const dayInDataset = dayjs(e.time).diff(datasetStart, "days", true);
		if (dayInDataset >= EOQ_START_DAY && dayInDataset <= EOQ_END_DAY && chance.bool({ likelihood: EOQ_INVITE_CLONE_LIKELIHOOD })) {
			userEvents.push({
				...e,
				time: dayjs(e.time).add(chance.integer({ min: 1, max: 60 }), "minutes").toISOString(),
				user_id: e.user_id,
				role: chance.pickone(["editor", "viewer"]),
				invitation_method: chance.pickone(["email", "sso", "slack"]),
			});
		}
	}

	// H2: CHURNED ACCOUNT SILENCING — ~20% of users (hash %5) have post-day-30
	// events removed.
	if (userEvents && userEvents.length > 0) {
		const firstEvent = userEvents[0];
		const idHash = String(firstEvent.user_id || firstEvent.device_id).split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
		if ((idHash % CHURN_USER_HASH_MOD) === 0) {
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const dayInDataset = dayjs(userEvents[i].time).diff(datasetStart, "days", true);
				if (dayInDataset > CHURN_CUTOFF_DAYS) {
					userEvents.splice(i, 1);
				}
			}
		}
	}

	// H4: INTEGRATION USERS SUCCEED — Slack+PagerDuty users get alert
	// response_time_mins 0.4x and resolution_time_mins 0.5x.
	let hasSlack = false;
	let hasPagerduty = false;
	userEvents.forEach((event) => {
		if (event.event === "integration configured") {
			if (event.integration_type === "slack") hasSlack = true;
			if (event.integration_type === "pagerduty") hasPagerduty = true;
		}
	});
	if (hasSlack && hasPagerduty) {
		userEvents.forEach((event) => {
			if (event.event === "alert acknowledged" && event.response_time_mins) {
				event.response_time_mins = Math.floor(event.response_time_mins * INTEGRATION_RESPONSE_FACTOR);
			}
			if (event.event === "alert resolved" && event.resolution_time_mins) {
				event.resolution_time_mins = Math.floor(event.resolution_time_mins * INTEGRATION_RESOLUTION_FACTOR);
			}
		});
	}

	// H5 + H10: DOCS MAGIC NUMBER — sweet 4-7 docs → +40% extra cloned
	// service-deployed events; over 8+ → drop 25% of service-deployed events.
	const docsCount = userEvents.filter(e => e.event === "documentation viewed").length;
	const deployTemplate = userEvents.find(e => e.event === "service deployed");
	if (docsCount >= DOCS_SWEET_MIN && docsCount <= DOCS_SWEET_MAX && deployTemplate) {
		const lastEvent = userEvents[userEvents.length - 1];
		const extraDeploys = chance.integer({ min: DOCS_EXTRA_DEPLOYS_MIN, max: DOCS_EXTRA_DEPLOYS_MAX });
		for (let i = 0; i < extraDeploys; i++) {
			userEvents.push({
				...deployTemplate,
				time: dayjs(lastEvent.time).add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
				user_id: lastEvent.user_id,
				service_id: chance.pickone(serviceIds),
				service_type: chance.pickone(["web_app", "api", "database", "cache", "queue", "ml_model"]),
				environment: "production",
				cloud_provider: profile.cloud_provider,
			});
		}
	} else if (docsCount >= DOCS_OVER_THRESHOLD) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "service deployed" && chance.bool({ likelihood: DOCS_DEPLOY_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// H7: FAILED DEPLOYMENT RECOVERY — find failed→success pairs in this
	// user's pipeline events, multiply duration_sec by 1.5 on the recovery
	// deploy.
	const pipelineEvents = userEvents
		.filter(e => e.event === "deployment pipeline run")
		.sort((a, b) => a.time.localeCompare(b.time));
	for (let i = 1; i < pipelineEvents.length; i++) {
		if (pipelineEvents[i - 1].status === "failed" && pipelineEvents[i].status === "success") {
			pipelineEvents[i].duration_sec = Math.floor((pipelineEvents[i].duration_sec || 300) * FAILED_DEPLOY_RECOVERY_MULT);
		}
	}

	// H9 (property leg): INCIDENT RESPONSE TTC — enterprise resolves faster,
	// startup slower. Scale response_time_mins on acknowledged events and
	// resolution_time_mins on resolved events by company_size. The funnel
	// timestamp leg lives in handleFunnelPostHooks (per-instance scaling).
	// Compounds with H4 (integration users) — runs AFTER it, so an
	// enterprise Slack+PagerDuty user stacks 0.4 x 0.67 on response time.
	const companySegment = profile?.company_size;
	const ttcFactor = (
		companySegment === "enterprise" ? TTC_ENTERPRISE_FACTOR :
		companySegment === "startup" ? TTC_STARTUP_FACTOR :
		1.0
	);
	if (ttcFactor !== 1.0) {
		// Property scale: affects Insights AVG reports
		userEvents.forEach(e => {
			if (e.event === "alert acknowledged" && e.response_time_mins) {
				e.response_time_mins = Math.max(1, Math.round(e.response_time_mins * ttcFactor));
			}
			if (e.event === "alert resolved" && e.resolution_time_mins) {
				e.resolution_time_mins = Math.max(1, Math.round(e.resolution_time_mins * ttcFactor));
			}
		});
	}

	return record;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: "json",
	gzip: true,
	credentials: {
		token,
	},
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
	// Phase 2 identity model — B2B SaaS reference. Engineers commonly use 1-2
	// devices (desktop + work laptop). avgDevicePerUser:2 puts a meaningful
	// per-session sticky-device pattern in Mixpanel device dashboards.
	identity: {
		avgDevicePerUser: 2,
	},
	concurrency: 1,
	writeToDisk: false,
	scdProps: {
		primary_role: {
			values: ["viewer", "editor", "admin", "owner"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		},
		plan_tier: {
			values: ["starter", "growth", "enterprise", "scale"],
			frequency: "month",
			timing: "fixed",
			max: 6,
			type: "company_id"
		}
	},

	funnels: [
		{
			// First funnel — `workspace created` is the auth event for B2B users.
			// Models real B2B onboarding: most teams take ≤1 retry before sticking.
			sequence: ["workspace created", "service deployed", "dashboard viewed"],
			isFirstFunnel: true,
			conversionRate: 70,
			timeToConvert: 2,
			attempts: { min: 0, max: 1 },
		},
		{
			// Daily monitoring: dashboards, queries, API calls (most common)
			sequence: ["dashboard viewed", "query executed", "api call"],
			conversionRate: 80,
			timeToConvert: 0.5,
			weight: 5,
		},
		{
			// Incident response pipeline
			sequence: ["alert triggered", "alert acknowledged", "alert resolved"],
			conversionRate: 55,
			timeToConvert: 6,
			weight: 4,
		},
		{
			// Deployment cycle
			sequence: ["deployment pipeline run", "service deployed", "dashboard viewed"],
			conversionRate: 65,
			timeToConvert: 1,
			weight: 3,
			experiment: {
				name: "Canary Deploys",
				variants: [
					{ name: "Control" },
					{ name: "Canary Deploys", conversionMultiplier: 1.2, ttcMultiplier: 0.85 },
				],
				startDaysBeforeEnd: 45,
			},
		},
		{
			// Infrastructure management
			sequence: ["cost report generated", "infrastructure scaled", "security scan"],
			conversionRate: 50,
			timeToConvert: 4,
			weight: 2,
		},
		{
			// Team and config management
			sequence: ["team member invited", "integration configured", "feature flag toggled"],
			conversionRate: 40,
			timeToConvert: 8,
			weight: 2,
		},
		{
			// Documentation and runbook usage
			sequence: ["documentation viewed", "runbook executed", "service deployed"],
			conversionRate: 45,
			timeToConvert: 2,
			weight: 2,
		},
		{
			// Billing and account management
			sequence: ["billing event", "dashboard viewed"],
			conversionRate: 60,
			timeToConvert: 1,
			weight: 1,
		},
	],

	events: [
		{
			event: "workspace created",
			weight: 1,
			isFirstEvent: true,
			// Phase 2 identity: workspace creation is the B2B equivalent of Sign Up
			// — engine stamps user_id+device_id on this event when it fires inside
			// the user's first funnel.
			isAuthEvent: true,
			properties: {
				company_size: ["startup", "smb", "mid_market", "enterprise"],
				industry: ["tech", "finance", "healthcare", "retail", "media"],
			}
		},
		{
			event: "service deployed",
			weight: 10,
			isStrictEvent: false,
			properties: {
				service_id: serviceIds,
				service_type: ["web_app", "api", "database", "cache", "queue", "ml_model"],
				environment: ["production", "staging", "dev"],
				cloud_provider: ["aws", "gcp", "azure"],
			}
		},
		{
			event: "dashboard viewed",
			weight: 20,
			isStrictEvent: false,
			properties: {
				dashboard_type: ["overview", "cost", "performance", "security", "custom"],
				time_range: ["1h", "6h", "24h", "7d", "30d"],
			}
		},
		{
			event: "alert triggered",
			weight: 12,
			isStrictEvent: false,
			properties: {
				alert_id: alertIds,
				severity: ["info", "warning", "critical", "emergency"],
				alert_type: ["cpu", "memory", "latency", "error_rate", "disk", "network"],
				service_id: serviceIds,
			}
		},
		{
			event: "incident created",
			weight: 1,
			properties: {
				escalation_level: ["P1", "P2"],
				teams_paged: u.weighNumRange(1, 5),
				incident_id: () => `inc_${v.uid(8)}`,
				original_severity: ["critical", "emergency"],
				original_alert_type: ["cpu", "memory", "latency", "error_rate", "disk", "network"],
				service_id: serviceIds,
				auto_escalated: [true],
			}
		},
		{
			event: "alert acknowledged",
			weight: 8,
			isStrictEvent: false,
			properties: {
				alert_id: alertIds,
				response_time_mins: u.weighNumRange(1, 120),
				acknowledged_by_role: ["engineer", "sre", "manager", "oncall"],
			}
		},
		{
			event: "alert resolved",
			weight: 7,
			isStrictEvent: false,
			properties: {
				alert_id: alertIds,
				resolution_time_mins: u.weighNumRange(5, 1440),
				root_cause: ["config_change", "capacity", "bug", "dependency", "network"],
			}
		},
		{
			event: "deployment pipeline run",
			weight: 9,
			isStrictEvent: false,
			properties: {
				pipeline_id: pipelineIds,
				status: ["success", "failed", "cancelled"],
				duration_sec: u.weighNumRange(30, 1800),
				commit_count: u.weighNumRange(1, 20),
			}
		},
		{
			event: "infrastructure scaled",
			weight: 5,
			isStrictEvent: false,
			properties: {
				service_id: serviceIds,
				scale_direction: ["up", "up", "up", "down"],
				previous_capacity: u.weighNumRange(1, 100),
				new_capacity: u.weighNumRange(1, 100),
				auto_scaled: [false, false, false, false, false, false, true],
			}
		},
		{
			event: "cost report generated",
			weight: 4,
			isStrictEvent: false,
			properties: {
				report_period: ["daily", "weekly", "monthly"],
				total_cost: u.weighNumRange(100, 50000),
				cost_change_percent: u.weighNumRange(-30, 50),
			}
		},
		{
			event: "team member invited",
			weight: 3,
			isStrictEvent: false,
			properties: {
				role: ["admin", "editor", "viewer", "billing"],
				invitation_method: ["email", "sso", "slack"],
			}
		},
		{
			event: "integration configured",
			weight: 4,
			isStrictEvent: false,
			properties: {
				integration_type: ["slack", "pagerduty", "jira", "github", "datadog", "terraform"],
				status: ["active", "paused", "error"],
			}
		},
		{
			event: "query executed",
			weight: 15,
			properties: {
				query_type: ["metrics", "logs", "traces"],
				time_range_hours: u.weighNumRange(1, 720),
				result_count: u.weighNumRange(0, 10000),
			}
		},
		{
			event: "runbook executed",
			weight: 3,
			properties: {
				runbook_id: runbookIds,
				trigger: ["manual", "automated", "alert_triggered"],
				success: [false, false, false, false, false, false, true],
			}
		},
		{
			event: "billing event",
			weight: 3,
			isStrictEvent: false,
			properties: {
				event_type: ["invoice_generated", "invoice_generated", "payment_received", "payment_received", "payment_received", "payment_failed", "plan_upgraded", "plan_downgraded"],
				amount: u.weighNumRange(99, 25000),
			}
		},
		{
			event: "security scan",
			weight: 6,
			properties: {
				scan_type: ["vulnerability", "compliance", "access_audit"],
				findings_count: u.weighNumRange(0, 50),
				critical_findings: u.weighNumRange(0, 10),
			}
		},
		{
			event: "api call",
			weight: 16,
			properties: {
				endpoint: ["/deploy", "/status", "/metrics", "/alerts", "/config", "/billing"],
				method: ["GET", "POST", "PUT", "DELETE"],
				response_time_ms: u.weighNumRange(10, 5000),
				status_code: [200, 201, 400, 401, 403, 500, 503],
			}
		},
		{
			event: "documentation viewed",
			weight: 7,
			isStrictEvent: false,
			properties: {
				doc_section: ["getting_started", "api_reference", "best_practices", "troubleshooting", "changelog"],
				time_on_page_sec: u.weighNumRange(5, 600),
			}
		},
		{
			event: "feature flag toggled",
			weight: 4,
			properties: {
				flag_name: () => `flag_${chance.word()}`,
				new_state: ["disabled", "disabled", "disabled", "disabled", "disabled", "disabled", "enabled"],
				environment: ["production", "staging", "dev"],
			}
		},
	],

	superProps: {
		plan_tier: ["free", "free", "team", "team", "business", "enterprise"],
		cloud_provider: ["aws", "gcp", "azure", "multi_cloud"],
	},

	userProps: {
		company_size: ["startup", "startup", "smb", "mid_market", "enterprise"],
		primary_role: ["engineer", "sre", "devops", "manager", "executive"],
		team_name: ["Platform", "Backend", "Frontend", "Data", "Security", "Infrastructure"],
		seat_count: [1],
		annual_contract_value: [0],
		customer_success_manager: [false],
		customer_health_score: u.weighNumRange(1, 100),
		plan_tier: ["free", "free", "team", "team", "business", "enterprise"],
		cloud_provider: ["aws", "gcp", "azure", "multi_cloud"],
	},

	groupKeys: [
		["company_id", 300, ["workspace created", "service deployed", "billing event", "team member invited"]],
	],

	groupProps: {
		company_id: {
			name: () => `${chance.word({ capitalize: true })} ${chance.pickone(["Systems", "Technologies", "Labs", "Cloud", "Digital", "Networks", "Solutions"])}`,
			industry: ["tech", "finance", "healthcare", "retail", "media", "manufacturing", "logistics"],
			employee_count: ["1-10", "11-50", "51-200", "201-1000", "1001-5000", "5000+"],
			arr_bucket: ["<10k", "10k-50k", "50k-200k", "200k-1M", "1M+"],
		}
	},

	lookupTables: [],

	hook(record, type, meta) {
		if (type === "event") return handleEventHooks(record);
		if (type === "user") return handleUserHooks(record);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

export default config;

// ── STORIES (verification contract — consumed by sass.verify.mjs) ──
/*
 * DERIVATION NOTES (all numbers measured at 2K reduced scale, seed
 * harness-sass, plus an exact organic counterfactual run — same seed,
 * identity hook — used to separate engineered effects from the organic
 * activity curve):
 *
 *   - H1a: upgrades/day 18.8 in-window vs 4.76 rest = 3.95x; in-window
 *     plan_upgraded share 0.447 vs 0.113 baseline (1/8 of event_type array).
 *   - H1b: invites/day 128.1 vs 82.4 = 1.55x.
 *   - H2: hash cohort 368/1952 event-users = 18.9%, all born days 1-30;
 *     silent-before-Feb-4 = 1.00 for hashed (H5 deploy clones reach at most
 *     ~day 33 = last kept event + 48h), 0.00 for non-hashed; zero-event
 *     profiles 48/2000 = 2.4% (churn-hashed users born after day 30).
 *   - H3: esc 3067 / (3067 esc + 7124 remaining crit) = 0.301 (knob 0.30);
 *     esc share of all incidents 3067/6881 = 0.446.
 *   - H4: both-integ/rest avg response 24.54/62.85 = 0.390 (knob 0.4);
 *     resolution 356.0/713.3 = 0.499 (knob 0.5).
 *   - H5/H10 (non-churned, deploys-per-other-event): low 0.0777, sweet
 *     0.0979, over 0.0690 → sweet/low 1.26, over/low 0.89, over/sweet 0.70.
 *     Organic counterfactual: over/low activity curve = 1.18; paired
 *     per-user deltas: low 0.000 (exact), over 0.750 (exact knob).
 *   - H6: armed down-share 0.896 (n=1394) vs unarmed 0.269 (n=6195).
 *   - H7: recovery avg duration 1193 vs 787 = 1.52 (first-run rows with no
 *     prior excluded).
 *   - H8: ACV 272.6K/31.3K/7.8K/1.8K; seats 270/29.6/6.6/3.0; csm 1/0/0/0.
 *   - H9 props: response ent 29.5 / startup 68.4 vs smb+mid avg 45.7 →
 *     0.646 / 1.495; resolution → 0.664 / 1.486.
 *   - H9 funnel TTC (24h window, greedy attenuation — see Hook 9 doc):
 *     medians ent 3.21h, mid 4.04h, smb 4.06h, startup 4.50h → ent 0.79x,
 *     startup 1.11x vs smb/mid baseline.
 *   - H11 per-instance (each $experiment_started anchors one attempt,
 *     greedy min-chain within 24h): canary 0.871 (147 attempts) vs control
 *     0.720 (207) → lift 1.21; median TTC 34 vs 42 min = 0.81; enrolled
 *     user split 35/74 = 0.47.
 *   - Identity: uid share 1.0 (auth on first event), device share 0.998,
 *     devices/user 2.08 (avgDevicePerUser: 2).
 *
 * Scale guards sit at ~50% of expected 10K populations, so 2K runs trip
 * WEAK by design; verdicts ship only from full-fidelity runs.
 *
 * Fix-round Q5 (2026-07-04, adversarial-review S1): NAILED bands re-derived
 * as knob ±10% wherever the knob converts directly to the metric; where the
 * realized magnitude is confounded (activity curves, greedy-evaluator
 * attenuation, clone-lift base rates, engine birth curves — H2 zero-event
 * share, H3 mix, H5 rate lift, H6 armed share, H9 funnel TTC, H10 both
 * legs), the assertion is a knob-bounded floor/ceiling/corridor that grades
 * STRONG by design. The measured values above remain as documentation of
 * the realized run, not as verdict targets.
 */

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;

const bandVerdict = (x, nailed, strong, detail, inverse = () => false) => {
	if (x == null || Number.isNaN(Number(x))) return { verdict: "NONE", detail: `${detail} — metric missing` };
	const v = Number(x);
	if (inverse(v)) return { verdict: "INVERSE", detail };
	if (v >= nailed[0] && v <= nailed[1]) return { verdict: "NAILED", detail };
	if (v >= strong[0] && v <= strong[1]) return { verdict: "STRONG", detail };
	return { verdict: "WEAK", detail };
};
const guarded = (ok, detail, inner) => ok ? inner() : { verdict: "WEAK", detail: `${detail} — cohort below scale guard (expected at reduced scale)` };
const worstOf = (...verdicts) => { const order = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"]; return order.find(o => verdicts.some(v => v.verdict === o)) || "NONE"; };
const cellsOf = (rows, key) => Object.fromEntries((rows || []).map(r => [r[key], r]));

const EOQ_WIN = `time::TIMESTAMP >= TIMESTAMP '2026-04-11 00:00:00' AND time::TIMESTAMP <= TIMESTAMP '2026-04-21 00:00:00'`;

const DOC_BUCKETS_SQL = `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'documentation viewed') AS docs,
    COUNT(*) FILTER (WHERE event = 'service deployed') AS deploys,
    COUNT(*) FILTER (WHERE event NOT IN ('service deployed', 'documentation viewed')) AS other,
    MAX(time::TIMESTAMP) AS last_t
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN docs >= 8 THEN 'over' WHEN docs >= 4 THEN 'sweet' ELSE 'low' END AS bucket,
  COUNT(*) AS users,
  SUM(deploys)::DOUBLE / SUM(other) AS d_per_o
FROM pu WHERE last_t >= TIMESTAMP '2026-02-04 00:00:00'
GROUP BY 1 ORDER BY 1`;

export const stories = [
	{
		id: "sass-h1-eoq-spike",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: "End-of-quarter (days 100-110): billing events shift toward plan_upgraded ~4x and team invites run ~1.55x.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  COUNT(*) FILTER (WHERE in_win) AS bill_win,
  COUNT(*) FILTER (WHERE NOT in_win) AS bill_rest,
  COUNT(*) FILTER (WHERE in_win AND event_type = 'plan_upgraded') AS upg_win,
  COUNT(*) FILTER (WHERE NOT in_win AND event_type = 'plan_upgraded') AS upg_rest
FROM (SELECT event_type, ${EOQ_WIN} AS in_win FROM ${EV} WHERE event = 'billing event')`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.bill_win) >= 1000 && Number(r.upg_rest) >= 1300, `billing volume: in-window=${r.bill_win ?? 0} rest-upgrades=${r.upg_rest ?? 0}`, () => {
						const rateRatio = (Number(r.upg_win) / 10) / (Number(r.upg_rest) / 111);
						const share = Number(r.upg_win) / Number(r.bill_win);
						const detail = `upgrades/day EOQ vs rest=${rateRatio.toFixed(2)} (knob-implied 3.8); in-window share=${share.toFixed(3)} (knob-implied 0.475, baseline 0.113)`;
						// Fix-round Q5 (S1): NAILED bands are knob ±10%. Implied in-window
						// share = 0.40 + 0.60×0.125 = 0.475 → rate ratio 0.475/0.125 = 3.8
						// → [3.42, 4.18]; share 0.475 → [0.43, 0.52].
						const legRate = bandVerdict(rateRatio, [3.42, 4.18], [2.9, 5.2], detail, v => v <= 1.3);
						const legShare = bandVerdict(share, [0.43, 0.52], [0.35, 0.55], detail, v => v <= 0.16);
						return { verdict: worstOf(legRate, legShare), detail };
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  COUNT(*) FILTER (WHERE in_win) AS inv_win,
  COUNT(*) FILTER (WHERE NOT in_win) AS inv_rest
FROM (SELECT ${EOQ_WIN} AS in_win FROM ${EV} WHERE event = 'team member invited')`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.inv_win) >= 3200, `in-window invites=${r.inv_win ?? 0}`, () => {
						const ratio = (Number(r.inv_win) / 10) / (Number(r.inv_rest) / 111);
						const detail = `invites/day EOQ vs rest=${ratio.toFixed(3)} (50% clone knob → 1.5x)`;
						// Fix-round Q5 (S1): knob 1 + 0.5 = 1.5x → NAILED = knob ±10%.
						return bandVerdict(ratio, [1.35, 1.65], [1.32, 1.80], detail, v => v <= 1.05);
					});
				},
			},
		],
	},
	{
		id: "sass-h2-churn-silence",
		hook: "H2",
		archetype: "retention-divergence",
		narrative: "~20% hash cohort goes fully silent after day 30; late-born churners appear as zero-event profiles.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ue AS (
  SELECT user_id::VARCHAR AS uid, MAX(time::TIMESTAMP) AS last_t
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (list_sum([ascii(x) for x in string_split(uid, '')]) % 5 = 0) AS churn_hash,
  COUNT(*) AS users,
  AVG((last_t < TIMESTAMP '2026-02-04 00:00:00')::INT) AS silent_share
FROM ue GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "churn_hash");
					const hashed = by.true, rest = by.false;
					return guarded(Number(hashed?.users) >= 900, `hash cohort=${hashed?.users ?? 0}`, () => {
						const silentT = Number(hashed.silent_share), silentF = Number(rest?.silent_share);
						const share = Number(hashed.users) / (Number(hashed.users) + Number(rest?.users || 0));
						const detail = `hashed silent(<Feb 4)=${silentT.toFixed(3)} (expect 1.0), non-hashed=${silentF.toFixed(3)} (expect 0), cohort share=${share.toFixed(3)} (measured 0.189)`;
						const legT = bandVerdict(silentT, [0.97, 1.0], [0.90, 1.0], detail, v => v < 0.3);
						const legF = bandVerdict(silentF, [0, 0.02], [0, 0.05], detail, v => v >= 0.5);
						// Fix-round Q5 (S1): hash knob mod 5 → 0.20 → NAILED = knob ±10%
						// (event-visible share sits near the low edge — late-born
						// zero-event churners never appear in event data).
						const legShare = bandVerdict(share, [0.18, 0.22], [0.14, 0.25], detail);
						return { verdict: worstOf(legT, legF, legShare), detail };
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT (SELECT COUNT(*) FROM ${US}) AS profiles,
  (SELECT COUNT(DISTINCT user_id::VARCHAR) FROM ${EV} WHERE user_id IS NOT NULL) AS event_users`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.profiles) >= 5000, `profiles=${r.profiles ?? 0}`, () => {
						const share = 1 - Number(r.event_users) / Number(r.profiles);
						const detail = `zero-event profile share=${share.toFixed(4)} (churn-hashed users born after day 30; hash-cohort ceiling 0.20)`;
						// Fix-round Q5 (S1): share = P(churn-hash) × P(born after day 30),
						// and the birth-time curve is engine behavior, not a knob — the
						// magnitude is not knob-derivable. Knob-derived corridor (0 <
						// share ≤ 0.20 hash-cohort ceiling) grades STRONG by design.
						if (share === 0) return { verdict: "NONE", detail: `${detail} — no zero-event profiles; late-born churn signal absent` };
						if (share > 0 && share <= 0.20) return { verdict: "STRONG", detail };
						return { verdict: "WEAK", detail };
					});
				},
			},
		],
	},
	{
		id: "sass-h3-alert-escalation",
		hook: "H3",
		archetype: "composition-drift",
		narrative: "30% of critical/emergency alerts are replaced by escalated incidents carrying alert_id; organic incidents have NULL alert_id.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  COUNT(*) FILTER (WHERE event = 'incident created' AND alert_id IS NOT NULL) AS esc,
  COUNT(*) FILTER (WHERE event = 'incident created' AND alert_id IS NULL) AS organic,
  COUNT(*) FILTER (WHERE event = 'alert triggered' AND severity IN ('critical', 'emergency')) AS crit
FROM ${EV}`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.esc) >= 7500, `escalated incidents=${r.esc ?? 0}`, () => {
						const escRate = Number(r.esc) / (Number(r.esc) + Number(r.crit));
						const escOfInc = Number(r.esc) / (Number(r.esc) + Number(r.organic));
						const detail = `esc/(esc+remaining crit)=${escRate.toFixed(3)} (knob 0.30); esc share of incidents=${escOfInc.toFixed(3)} (mix confounded — corridor check)`;
						const legRate = bandVerdict(escRate, [0.27, 0.33], [0.24, 0.37], detail, v => v < 0.05);
						// Fix-round Q5 (S1): escalated/organic mix depends on funnel-driven
						// alert volume vs weight-1 soup, not on a knob (naive weight math
						// gives ~0.64, far from the realized value). Corridor sanity check
						// grades STRONG by design; legRate carries the knob-derived 0.30
						// invariant.
						const legMix = escOfInc >= 0.2 && escOfInc <= 0.8 && Number(r.organic) > 0
							? { verdict: "STRONG", detail }
							: { verdict: "WEAK", detail };
						return { verdict: worstOf(legRate, legMix), detail };
					});
				},
			},
		],
	},
	{
		id: "sass-h4-integration-speed",
		hook: "H4",
		archetype: "cohort-prop-scale",
		narrative: "Users with both Slack and PagerDuty configured respond 0.4x and resolve 0.5x vs the rest.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH integ AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'integration configured' AND integration_type = 'slack') AS s,
    BOOL_OR(event = 'integration configured' AND integration_type = 'pagerduty') AS p
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (s AND p) AS both_integ, COUNT(DISTINCT e.user_id::VARCHAR) AS users,
  AVG(response_time_mins) FILTER (WHERE event = 'alert acknowledged') AS avg_resp,
  AVG(resolution_time_mins) FILTER (WHERE event = 'alert resolved') AS avg_reso
FROM ${EV} e JOIN integ i ON e.user_id::VARCHAR = i.uid GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "both_integ");
					const both = by.true, rest = by.false;
					return guarded(Number(both?.users) >= 1100 && Number(rest?.users) >= 3700, `cohorts: both=${both?.users ?? 0} rest=${rest?.users ?? 0}`, () => {
						const respRatio = Number(both.avg_resp) / Number(rest.avg_resp);
						const resoRatio = Number(both.avg_reso) / Number(rest.avg_reso);
						const detail = `both/rest response=${respRatio.toFixed(3)} (knob 0.4, measured 0.390); resolution=${resoRatio.toFixed(3)} (knob 0.5, measured 0.499)`;
						// Fix-round Q5 (S1): NAILED = knob ±10% (0.4 → [0.36, 0.44],
						// 0.5 → [0.45, 0.55]).
						const legResp = bandVerdict(respRatio, [0.36, 0.44], [0.31, 0.50], detail, v => v >= 0.95);
						const legReso = bandVerdict(resoRatio, [0.45, 0.55], [0.40, 0.62], detail, v => v >= 0.95);
						return { verdict: worstOf(legResp, legReso), detail };
					});
				},
			},
		],
	},
	{
		id: "sass-h5-docs-deploy-lift",
		hook: "H5",
		archetype: "frequency-sweet-spot",
		narrative: "Sweet-spot doc readers (4-7 views) get cloned deploys: deploys-per-other-event lifts above the low bucket (measured ~1.26x; asserted as a knob-derived floor >1.05 — the rate magnitude is activity-confounded, fix-round Q5).",
		assertions: [
			{
				breakdown: { type: "duckdb", sql: DOC_BUCKETS_SQL },
				assert: (rows) => {
					const by = cellsOf(rows, "bucket");
					const sweet = by.sweet, low = by.low;
					return guarded(Number(sweet?.users) >= 1800 && Number(low?.users) >= 950, `buckets: sweet=${sweet?.users ?? 0} low=${low?.users ?? 0}`, () => {
						const ratio = Number(sweet.d_per_o) / Number(low.d_per_o);
						const detail = `sweet/low deploys-per-other=${ratio.toFixed(3)} (+2.5 clones engineered; rate lift not knob-derivable)`;
						// Fix-round Q5 (S1): the +2.5-clone knob converts to a RATE ratio
						// only through the organic deploy base rate, the future-guard
						// shave, and the activity curve — none knob-derivable. Knob-derived
						// floor (clones strictly add deploys → sweet/low > 1.05) grades
						// STRONG by design; INVERSE at ≤1.02 (no lift).
						if (ratio <= 1.02) return { verdict: "INVERSE", detail };
						if (ratio > 1.05) return { verdict: "STRONG", detail };
						return { verdict: "WEAK", detail };
					});
				},
			},
		],
	},
	{
		id: "sass-h6-cost-overrun",
		hook: "H6",
		archetype: "bespoke",
		narrative: "After a >25% cost spike, the user's next infrastructure scale is forced down: armed-state down-share ≥0.75 floor (mechanism-implied 1.0, read-side order gap attenuates; measured ~0.90) vs the 0.25-array baseline (knob ±10%).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH seq AS (
  SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t, event, cost_change_percent, scale_direction
  FROM ${EV} WHERE event IN ('cost report generated', 'infrastructure scaled') AND user_id IS NOT NULL
), marked AS (
  SELECT *,
    MAX(CASE WHEN event = 'cost report generated' AND cost_change_percent > 25 THEN t END)
      OVER (PARTITION BY uid ORDER BY t ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS last_spike,
    MAX(CASE WHEN event = 'infrastructure scaled' THEN t END)
      OVER (PARTITION BY uid ORDER BY t ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS last_infra
  FROM seq
)
SELECT (last_spike IS NOT NULL AND (last_infra IS NULL OR last_spike > last_infra)) AS armed,
  COUNT(*) AS n, AVG((scale_direction = 'down')::INT) AS down_share
FROM marked WHERE event = 'infrastructure scaled' GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "armed");
					const armed = by.true, unarmed = by.false;
					return guarded(Number(armed?.n) >= 3400 && Number(unarmed?.n) >= 15000, `scale events: armed=${armed?.n ?? 0} unarmed=${unarmed?.n ?? 0}`, () => {
						const a = Number(armed.down_share), u = Number(unarmed.down_share);
						const detail = `down-share armed=${a.toFixed(3)} (mechanism-implied 1.0; time-vs-generation order gap attenuates) vs unarmed=${u.toFixed(3)} (baseline 0.25 array)`;
						// Fix-round Q5 (S1): the mechanism forces scale_direction="down"
						// (implied 1.0), but the read-side generation-vs-timestamp order
						// gap attenuates it non-derivably. Knob-derived floor (≥0.75 = 3x
						// the 0.25 array baseline) grades STRONG by design.
						const legArmed = a <= 0.35 ? { verdict: "INVERSE", detail }
							: a >= 0.75 ? { verdict: "STRONG", detail }
							: { verdict: "WEAK", detail };
						// Fix-round Q5 (S1): NAILED = knob ±10% (0.25 → [0.225, 0.275]).
						const legBase = bandVerdict(u, [0.225, 0.275], [0.21, 0.34], detail);
						return { verdict: worstOf(legArmed, legBase), detail };
					});
				},
			},
		],
	},
	{
		id: "sass-h7-deploy-recovery",
		hook: "H7",
		archetype: "bespoke",
		narrative: "The first successful pipeline run after a failure runs ~1.5x longer.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH p AS (
  SELECT user_id::VARCHAR AS uid, status, duration_sec,
    LAG(status) OVER (PARTITION BY user_id::VARCHAR ORDER BY time) AS prev
  FROM ${EV} WHERE event = 'deployment pipeline run' AND user_id IS NOT NULL
)
SELECT (prev = 'failed') AS recovery, COUNT(*) AS n, AVG(duration_sec) AS avg_dur
FROM p WHERE status = 'success' AND prev IS NOT NULL GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "recovery");
					const rec = by.true, other = by.false;
					return guarded(Number(rec?.n) >= 3400 && Number(other?.n) >= 8000, `runs: recovery=${rec?.n ?? 0} other=${other?.n ?? 0}`, () => {
						const ratio = Number(rec.avg_dur) / Number(other.avg_dur);
						const detail = `recovery/other success duration=${ratio.toFixed(3)} (knob 1.5, measured 1.52)`;
						return bandVerdict(ratio, [1.43, 1.60], [1.33, 1.72], detail, v => v <= 1.03);
					});
				},
			},
		],
	},
	{
		id: "sass-h8-enterprise-startup",
		hook: "H8",
		archetype: "cohort-prop-scale",
		narrative: "Company size drives ACV (~$273K enterprise to ~$1.8K startup), seat count, and CSM assignment (enterprise only).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT company_size, COUNT(*) AS users, AVG(annual_contract_value) AS acv,
  AVG(seat_count) AS seats, AVG(customer_success_manager::INT) AS csm
FROM ${US} GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "company_size");
					const ent = by.enterprise, mid = by.mid_market, smb = by.smb, st = by.startup;
					const sizes = `ent=${ent?.users ?? 0} mid=${mid?.users ?? 0} smb=${smb?.users ?? 0} startup=${st?.users ?? 0}`;
					return guarded(
						Number(ent?.users) >= 1000 && Number(mid?.users) >= 1000 && Number(smb?.users) >= 950 && Number(st?.users) >= 1900,
						`segments: ${sizes}`,
						() => {
							const detail = `ACV ent=${Math.round(ent.acv)} mid=${Math.round(mid.acv)} smb=${Math.round(smb.acv)} startup=${Math.round(st.acv)}; seats ${Number(ent.seats).toFixed(1)}/${Number(mid.seats).toFixed(1)}/${Number(smb.seats).toFixed(1)}/${Number(st.seats).toFixed(1)}; csm ${Number(ent.csm).toFixed(3)}/${Number(mid.csm).toFixed(3)}/${Number(smb.csm).toFixed(3)}/${Number(st.csm).toFixed(3)}`;
							// Fix-round Q5 (S1): NAILED = uniform-range mean ±10% (ent 275K,
							// mid 31K, smb 7.8K, startup 1.8K).
							const legEnt = bandVerdict(ent.acv, [255000, 295000], [235000, 315000], detail, v => v < 50000);
							const legMid = bandVerdict(mid.acv, [27900, 34100], [26000, 37500], detail);
							const legSmb = bandVerdict(smb.acv, [7200, 8400], [6500, 9200], detail);
							const legSt = bandVerdict(st.acv, [1620, 1980], [1300, 2300], detail);
							const seatsMonotonic = Number(ent.seats) > Number(mid.seats) && Number(mid.seats) > Number(smb.seats) && Number(smb.seats) > Number(st.seats);
							const legSeats = { verdict: seatsMonotonic ? "NAILED" : "INVERSE", detail };
							const csmOthers = Math.max(Number(mid.csm), Number(smb.csm), Number(st.csm));
							const legCsm = Number(ent.csm) === 1 && csmOthers === 0 ? { verdict: "NAILED", detail }
								: Number(ent.csm) >= 0.99 && csmOthers <= 0.01 ? { verdict: "STRONG", detail }
								: Number(ent.csm) < 0.5 ? { verdict: "INVERSE", detail }
								: { verdict: "WEAK", detail };
							return { verdict: worstOf(legEnt, legMid, legSmb, legSt, legSeats, legCsm), detail };
						}
					);
				},
			},
		],
	},
	{
		id: "sass-h9-incident-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: "Enterprise responds/resolves 0.67x, startup 1.5x (property legs carry the knob ±10% NAILED read; funnel TTC attenuates asymmetrically under greedy evaluation and is asserted as knob-bounded corridors grading STRONG — fix-round Q5).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT u.company_size AS seg,
  COUNT(*) FILTER (WHERE event = 'alert acknowledged') AS n_ack,
  AVG(response_time_mins) FILTER (WHERE event = 'alert acknowledged') AS resp,
  AVG(resolution_time_mins) FILTER (WHERE event = 'alert resolved') AS reso
FROM ${EV} e JOIN ${US} u ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "seg");
					const ent = by.enterprise, mid = by.mid_market, smb = by.smb, st = by.startup;
					const counts = `ent=${ent?.n_ack ?? 0} mid=${mid?.n_ack ?? 0} smb=${smb?.n_ack ?? 0} startup=${st?.n_ack ?? 0}`;
					return guarded(
						[ent, mid, smb, st].every(s => Number(s?.n_ack) >= 7500),
						`acks by segment: ${counts}`,
						() => {
							const respBase = (Number(mid.resp) + Number(smb.resp)) / 2;
							const resoBase = (Number(mid.reso) + Number(smb.reso)) / 2;
							const respEnt = Number(ent.resp) / respBase, respSt = Number(st.resp) / respBase;
							const resoEnt = Number(ent.reso) / resoBase, resoSt = Number(st.reso) / resoBase;
							const detail = `property legs vs smb/mid avg: response ent=${respEnt.toFixed(3)} startup=${respSt.toFixed(3)} (knobs 0.67/1.5, measured 0.646/1.495); resolution ent=${resoEnt.toFixed(3)} startup=${resoSt.toFixed(3)} (measured 0.664/1.486)`;
							const legs = [
								bandVerdict(respEnt, [0.60, 0.70], [0.55, 0.76], detail, v => v >= 0.95),
								bandVerdict(respSt, [1.40, 1.59], [1.30, 1.71], detail, v => v <= 1.02),
								bandVerdict(resoEnt, [0.61, 0.71], [0.56, 0.77], detail, v => v >= 0.95),
								bandVerdict(resoSt, [1.39, 1.58], [1.29, 1.70], detail, v => v <= 1.02),
							];
							return { verdict: worstOf(...legs), detail };
						}
					);
				},
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["alert triggered", "alert acknowledged", "alert resolved"],
					breakdownByUserProperty: "company_size",
					conversionWindowMs: 24 * 3600 * 1000,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const ent = by.enterprise, mid = by.mid_market, smb = by.smb, st = by.startup;
					const counts = `ent=${ent?.user_count ?? 0} mid=${mid?.user_count ?? 0} smb=${smb?.user_count ?? 0} startup=${st?.user_count ?? 0}`;
					return guarded(
						Number(ent?.user_count) >= 540 && Number(mid?.user_count) >= 580 && Number(smb?.user_count) >= 480 && Number(st?.user_count) >= 1100,
						`converters: ${counts}`,
						() => {
							const base = (Number(mid.median_ttc_ms) + Number(smb.median_ttc_ms)) / 2;
							const entRatio = Number(ent.median_ttc_ms) / base;
							const stRatio = Number(st.median_ttc_ms) / base;
							const detail = `funnel median TTC @24h vs smb/mid: ent=${entRatio.toFixed(3)} startup=${stRatio.toFixed(3)} (greedy attenuation of 0.67/1.5 knobs — corridor check; medians ${(Number(ent.median_ttc_ms) / 3600000).toFixed(2)}h/${(base / 3600000).toFixed(2)}h/${(Number(st.median_ttc_ms) / 3600000).toFixed(2)}h)`;
							// Fix-round Q5 (S1): greedy-evaluator attenuation of the 0.67/1.5
							// knobs is not knob-derivable (organic soup alerts win the greedy
							// race). Knob-bounded corridors — the true effect lies between
							// the full knob (±10%) and no-effect 1.0 — grade STRONG by
							// design; the property legs above carry the knob-derived NAILED
							// read.
							const legEnt = entRatio >= 1.0 ? { verdict: "INVERSE", detail }
								: entRatio >= 0.603 && entRatio <= 0.95 ? { verdict: "STRONG", detail }
								: { verdict: "WEAK", detail };
							const legSt = stRatio <= 0.98 ? { verdict: "INVERSE", detail }
								: stRatio > 1.03 && stRatio <= 1.65 ? { verdict: "STRONG", detail }
								: { verdict: "WEAK", detail };
							return { verdict: worstOf(legEnt, legSt), detail };
						}
					);
				},
			},
		],
	},
	{
		id: "sass-h10-docs-magic-number",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative: "Over-engaged doc readers (8+) lose 25% of deploys: asserted as knob-bounded corridors (over/low ∈ [0.675, 1.0), over/sweet ≤ 0.825) grading STRONG — the realized ratios compose the 0.75 keep-rate knob with a non-derivable activity curve and clone lift (fix-round Q5).",
		assertions: [
			{
				breakdown: { type: "duckdb", sql: DOC_BUCKETS_SQL },
				assert: (rows) => {
					const by = cellsOf(rows, "bucket");
					const over = by.over, sweet = by.sweet, low = by.low;
					return guarded(
						Number(over?.users) >= 1150 && Number(sweet?.users) >= 1800 && Number(low?.users) >= 950,
						`buckets: over=${over?.users ?? 0} sweet=${sweet?.users ?? 0} low=${low?.users ?? 0}`,
						() => {
							const overLow = Number(over.d_per_o) / Number(low.d_per_o);
							const overSweet = Number(over.d_per_o) / Number(sweet.d_per_o);
							const detail = `deploys-per-other over/low=${overLow.toFixed(3)} (0.75 keep-rate knob x non-derivable activity curve — corridor check); over/sweet=${overSweet.toFixed(3)} (0.75 knob ÷ non-derivable clone lift)`;
							// Fix-round Q5 (S1): the realized ratios compose the 0.75
							// keep-rate knob with the organic activity curve (over-readers
							// are more active) and the H5 clone lift — both measured, not
							// knob-derivable. Knob-bounded corridors grade STRONG by design:
							// over/low ∈ [0.675 (knob −10%), 1.0) — the drop can only reduce,
							// the activity curve alone would push ≥1; over/sweet ≤ 0.825
							// (= 0.75 × 1.1, assuming clone lift ≥ 1).
							const legLow = overLow >= 1.12 ? { verdict: "INVERSE", detail }
								: overLow >= 0.675 && overLow < 1.0 ? { verdict: "STRONG", detail }
								: { verdict: "WEAK", detail };
							const legSweet = overSweet >= 0.97 ? { verdict: "INVERSE", detail }
								: overSweet > 0 && overSweet <= 0.825 ? { verdict: "STRONG", detail }
								: { verdict: "WEAK", detail };
							return { verdict: worstOf(legLow, legSweet), detail };
						}
					);
				},
			},
		],
	},
	{
		id: "sass-h11-canary-experiment",
		hook: "H11",
		archetype: "experiment-lift",
		narrative: "Canary Deploys experiment: per-instance conversion lift ~1.21x (knob 1.2) and median TTC ~0.81x; even enrollment split. Identity invariants ride as the final assertion.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH exp AS (
  SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t0, "Variant name" AS variant
  FROM ${EV} WHERE event = '$experiment_started'
), ev2 AS (
  SELECT user_id::VARCHAR AS uid, event, time::TIMESTAMP AS t FROM ${EV}
  WHERE event IN ('deployment pipeline run', 'service deployed', 'dashboard viewed')
), c1 AS (
  SELECT x.uid, x.variant, x.t0,
    (SELECT MIN(t) FROM ev2 e WHERE e.uid = x.uid AND e.event = 'deployment pipeline run' AND e.t >= x.t0) AS tp
  FROM exp x
), c2 AS (
  SELECT c.*, (SELECT MIN(t) FROM ev2 e WHERE e.uid = c.uid AND e.event = 'service deployed' AND e.t >= c.tp) AS td
  FROM c1 c
), c3 AS (
  SELECT c.*, (SELECT MIN(t) FROM ev2 e WHERE e.uid = c.uid AND e.event = 'dashboard viewed' AND e.t >= c.td) AS tb
  FROM c2 c
)
SELECT variant, COUNT(*) AS attempts, COUNT(DISTINCT uid) AS users,
  AVG((tb IS NOT NULL AND tb <= t0 + INTERVAL 24 HOUR)::INT) AS conv_rate,
  median(CASE WHEN tb IS NOT NULL AND tb <= t0 + INTERVAL 24 HOUR THEN date_diff('minute', tp, tb) END) AS med_ttc_min
FROM c3 GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "variant");
					const canary = by["Canary Deploys"], control = by.Control;
					return guarded(
						Number(canary?.attempts) >= 360 && Number(control?.attempts) >= 500,
						`attempts: canary=${canary?.attempts ?? 0} control=${control?.attempts ?? 0}`,
						() => {
							const lift = Number(canary.conv_rate) / Number(control.conv_rate);
							const ttcRatio = Number(canary.med_ttc_min) / Number(control.med_ttc_min);
							const detail = `per-instance conversion lift=${lift.toFixed(3)} (knob 1.2, measured 1.21; rates ${Number(canary.conv_rate).toFixed(3)}/${Number(control.conv_rate).toFixed(3)}); median TTC ratio=${ttcRatio.toFixed(3)} (knob 0.85, measured 0.81)`;
							// Fix-round Q5 (S1): NAILED = knob ±10% (1.2 → [1.08, 1.32],
							// 0.85 → [0.765, 0.935]).
							const legLift = bandVerdict(lift, [1.08, 1.32], [1.04, 1.42], detail, v => v <= 1.00);
							const legTtc = bandVerdict(ttcRatio, [0.765, 0.935], [0.65, 0.98], detail, v => v >= 1.03);
							return { verdict: worstOf(legLift, legTtc), detail };
						}
					);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT "Variant name" AS variant, COUNT(DISTINCT user_id::VARCHAR) AS users
FROM ${EV} WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "variant");
					const canary = Number(by["Canary Deploys"]?.users || 0), control = Number(by.Control?.users || 0);
					return guarded(canary + control >= 180, `enrolled users=${canary + control}`, () => {
						const split = canary / (canary + control);
						const detail = `enrollment split canary=${split.toFixed(3)} of ${canary + control} users (deterministic 2-arm hash → 0.50)`;
						// Fix-round Q5 (S1): implied split 0.50 → NAILED = knob ±10%.
						return bandVerdict(split, [0.45, 0.55], [0.35, 0.62], detail);
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT COUNT(*) AS n,
  AVG((user_id IS NOT NULL)::INT) AS uid_share,
  AVG((device_id IS NOT NULL)::INT) AS device_share,
  COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id) AS devices_per_user
FROM ${EV}`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.n) >= 500000, `events=${r.n ?? 0}`, () => {
						const uid = Number(r.uid_share), dev = Number(r.device_share), dpu = Number(r.devices_per_user);
						const detail = `identity invariants: uid_share=${uid} device_share=${dev.toFixed(4)} devices/user=${dpu.toFixed(2)} over ${r.n} events (auth on first event; avgDevicePerUser: 2)`;
						// Fix-round Q5 (S1): dpu NAILED = knob ±10% (avgDevicePerUser: 2
						// → [1.8, 2.2]).
						if (uid === 1 && dev >= 0.99 && dpu >= 1.8 && dpu <= 2.2) return { verdict: "NAILED", detail };
						if (uid >= 0.999 && dev >= 0.98) return { verdict: "STRONG", detail };
						if (uid < 0.9) return { verdict: "INVERSE", detail };
						return { verdict: "WEAK", detail };
					});
				},
			},
		],
	},
];

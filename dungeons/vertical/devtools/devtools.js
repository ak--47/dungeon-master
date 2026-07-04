// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
/** @typedef {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       CodeForge
 * APP:        Developer platform for builds, deploys, monitoring, code review,
 *             and team collaboration. Think GitHub + Vercel + PagerDuty in a
 *             unified CI/CD experience. Multi-role devs ship code through a
 *             connect-repo → configure-pipeline → build → deploy → monitor loop.
 * SCALE:      10,000 users, ~2.2M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  connect repo → configure pipeline → build → deploy → monitor
 *
 * EVENTS (18):
 *   build completed (8) > app session (8) > pull request created (6)
 *   > notification received (6) > deployment completed (5)
 *   > code review completed (5) > monitoring dashboard viewed (5)
 *   > alert triggered (4) > log searched (4) > incident created (2)
 *   > incident resolved (2) > repository connected (2) > pipeline configured (2)
 *   > collaboration invited (2) > environment created (2) > account created (1)
 *   > billing updated (1) > account deactivated (1)
 *
 * FUNNELS (5):
 *   - Onboarding:            account created → repository connected → pipeline configured → build completed (45%)
 *   - Build-Deploy Pipeline: build completed → deployment completed → monitoring dashboard viewed (40%)
 *   - PR Review Flow:        pull request created → code review completed → build completed → deployment completed (35%)
 *   - Incident Response:     alert triggered → incident created → incident resolved (50%)
 *   - Upgrade Path:          app session → billing updated → collaboration invited (20%)
 *
 * USER PROPS:  dev_role, segment, team_size, repos_connected, org_name, experience_level, subscription_tier, Platform, language
 * SUPER PROPS: subscription_tier, Platform, language
 * SCD PROPS:   subscription_tier (free/pro/enterprise, monthly fuzzy, max 6)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — discoverable only via behavioral
 * cohorts or raw-prop breakdowns. No cohort flag is stamped on events.
 *
 * ---------------------------------------------------------------
 * 1. BUILD FAILURE CASCADE (event hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Builds with status "failed" get 2x build_duration_sec.
 * Failed builds take longer because the full test suite runs before
 * failing, and retries compound the duration.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Build Duration by Status
 *   - Report type: Insights
 *   - Event: "build completed"
 *   - Measure: Average of "build_duration_sec"
 *   - Breakdown: "build_status"
 *   - Expected: failed ~ 2x longer than success (median ~400s vs
 *     ~200s; cancelled tracks success — the hook only touches failed).
 *     Use median, not average: the extreme-value anomaly (10x
 *     build_duration_sec at 0.3% frequency) fattens the mean tail.
 *
 * REAL-WORLD ANALOGUE: Failed CI builds run full test suites,
 * timeout, and trigger retry cascades that inflate build times.
 *
 * ---------------------------------------------------------------
 * 2. NIGHT DEPLOY RISK (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Deployments between 10PM-6AM UTC get deploy_status forced
 * to "failed" 40% of the time. No flag — analyst breaks down by
 * hour-of-day on deployment-completed events to discover the risk window.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Deploy Failure Rate by Hour of Day
 *   - Report type: Insights
 *   - Event: "deployment completed"
 *   - Measure: Total
 *   - Filter: deploy_status = "failed"
 *   - Breakdown: hour of day
 *   - Expected: 22:00-05:59 UTC hours show ~52% failure vs ~21% day
 *     baseline. Mechanism: organic failed share is 1/5 = 20% (pool
 *     ["success","success","success","failed","rolled_back"]); the
 *     hook forces "failed" on 40% of night deploys, so night share =
 *     0.4 + 0.6*0.2 = 0.52. Exclude days 43-49 when measuring: H6
 *     recovery clones (success/rolled_back only, never failed) dilute
 *     the failure share inside the recovery window.
 *
 * REAL-WORLD ANALOGUE: Night deploys fail more due to skeleton crews
 * and delayed incident response.
 *
 * ---------------------------------------------------------------
 * 3. COPILOT ADOPTION -> PR VELOCITY (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: A hash-based cohort (~37.5% of users — GUID first char in
 * {2,3,4,d,e,f}, i.e. charCodeAt(0) % 10 < 3) are copilot adopters:
 * they get ai_assist="copilot" stamped on PR/review events and
 * floor(PRs * 0.5) extra pull-request events cloned into their
 * stream (~1.5x PR volume).
 *
 * MEASUREMENT CAVEAT: the copilot_integration feature (launchDay 30,
 * fast adoption) ALSO flips ai_assist to "copilot" on PR/review
 * events for feature adopters regardless of cohort — so a raw
 * ai_assist breakdown mixes the two populations. The clean read is
 * behavioral: bin users by per-user PR volume, or reproduce the hash
 * cohort (first char of user_id) in a cohort definition.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: PR Volume by AI Assist Mode
 *   - Report type: Insights
 *   - Event: "pull request created"
 *   - Measure: Total per user (average)
 *   - Breakdown: "ai_assist"
 *   - Expected: copilot-heavy users ~1.5x more PRs than manual users
 *     (directional only — see measurement caveat above)
 *
 * REAL-WORLD ANALOGUE: AI coding assistants measurably increase
 * developer throughput, particularly for boilerplate and tests.
 *
 * ---------------------------------------------------------------
 * 4. ON-CALL ROTATION FATIGUE (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with >20 alert_triggered events get increasing
 * response_time_minutes on incident events. Alert fatigue causes
 * slower response as on-call rotations grind engineers down.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Response Time vs Alert Volume
 *   - Report type: Insights
 *   - Event: "incident resolved"
 *   - Measure: Average of "response_time_minutes"
 *   - Filter: users with high alert counts
 *   - Expected: fatigued users (>20 alerts, ~31% of incident users)
 *     show ~2.6x mean response time (~138min vs ~53min). The
 *     multiplier is 1 + min(alerts/20, 3), so the fatigued-cohort
 *     mean multiplier lands ~2.67; measured ratio tracks it.
 *
 * REAL-WORLD ANALOGUE: On-call burnout is a top cause of attrition
 * in SRE/DevOps. Alert fatigue degrades response quality over time.
 *
 * ---------------------------------------------------------------
 * 5. OPEN SOURCE POWER USAGE (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: OSS-segment users with >15 events get extra cloned build
 * + deploy events in their later activity (representing power usage).
 * Cloned events use unique offset timestamps. No flag — discover via
 * cohort by segment + event count, observing per-user build/deploy volume.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Build Share — Active OSS Users vs Active Non-OSS
 *   - Report type: Insights (with cohort)
 *   - Cohort A: segment = "oss_user" AND events > 15
 *   - Cohort B: segment != "oss_user" AND events > 15
 *   - Event: "build completed"
 *   - Measure: share of each cohort's total events
 *   - Expected: A's build share ~1.3x B's (~0.25 vs ~0.19). Note:
 *     nearly all surviving oss users clear the >15 threshold (121
 *     days x 1.2/day x 0.5 multiplier ≈ 72 events), so the
 *     within-oss A-vs-B comparison mostly captures churn, not the
 *     hook — compare against active non-oss users instead. The
 *     deploy share also rises (~1.65x) but is coupled with H9
 *     (oss builds land in the 15-30 sweet spot; heavy non-oss
 *     builders lose deploys), so the build share is the clean read.
 *
 * REAL-WORLD ANALOGUE: Power OSS users hit free-tier limits via
 * heavy build/deploy volume.
 *
 * ---------------------------------------------------------------
 * 6. POST-OUTAGE RECOVERY (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: After the major outage ends (day 42.25), deployment
 * events get a frequency boost -- extra cloned deployment events
 * represent the flurry of hotfixes and rollback-then-redeploy cycles.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Deployment Spike Post-Outage
 *   - Report type: Insights
 *   - Event: "deployment completed"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: ~3.7x deploy volume on days 44-47 vs surrounding
 *     baseline, normalized against builds (ratio-of-ratios cancels
 *     the growth ramp). Mechanism: 3 clones per window deploy = 4x,
 *     minus ~5% of clones spilling past the window edge (offsets are
 *     +1-8h, so late-day-47 sources push clones into day 48). Clones
 *     carry status success/rolled_back only — never "failed" — which
 *     is why H2's failure-share read excludes this window.
 *
 * REAL-WORLD ANALOGUE: After a major outage, teams push a burst
 * of hotfixes, rollbacks, and emergency deploys to stabilize.
 *
 * ---------------------------------------------------------------
 * 7. DEVOPS LEAD PROFILE ENRICHMENT (user hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users in the "devops" segment get team_size boosted
 * to 10-50 and repos_connected boosted to 5-20. DevOps leads
 * manage larger teams and more infrastructure.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Team Size by Segment
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Average of user property "team_size"
 *   - Breakdown: user property "segment"
 *   - Expected: devops ~30 avg (uniform 10-50), platform_eng ~15,
 *     junior ~4.5. CAVEAT: full_stack/oss keep the DEFAULT pool
 *     u.weighNumRange(1, 50, 0.4, 5), whose mean is ~24 — NOT ~10 —
 *     so the clean team_size contrast is devops vs junior.
 *     repos_connected is the crisper signal: defaults to [0], so
 *     devops ~12.5, platform_eng ~9, junior ~1.5, full_stack/oss
 *     exactly 0.
 *
 * REAL-WORLD ANALOGUE: DevOps leads oversee platform teams and
 * manage organization-wide CI/CD infrastructure.
 *
 * ---------------------------------------------------------------
 * 8. ENTERPRISE BUILD-DEPLOY FUNNEL LIFT (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Non-paid users (free AND team tier — everyone except
 * enterprise/business) drop 35% of final funnel step events
 * ("monitoring dashboard viewed"), creating a visible conversion
 * gap. Enterprise/business users keep all their events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Build-Deploy Conversion by Tier
 *   - Report type: Funnels
 *   - Steps: "build completed" -> "deployment completed" -> "monitoring dashboard viewed"
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Expected: free/team step-3 conversion ~0.65x of
 *     enterprise/business. Normalized read: monitoring-views per
 *     deployment — free/team ~0.63x paid (the 0.65 keep-rate minus
 *     small drift; deploy-count hooks H6/H9 hit all tiers evenly
 *     and cancel in the ratio).
 *
 * REAL-WORLD ANALOGUE: Enterprise CI/CD customers get priority
 * runners, dedicated support, and SLA-backed uptime guarantees.
 *
 * ---------------------------------------------------------------
 * 9. BUILD-COUNT MAGIC NUMBER (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with 15-30 "build completed" events sit in the
 * healthy CI sweet spot — +50% deploy events are cloned (unique
 * timestamps, offsets 5-360min). Users with 31+ builds suffer
 * flaky-CI burnout: 40% of their deploy events drop. No flag —
 * discover by binning users on build-count and comparing
 * deploys-per-build.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Deploys per Build by Build Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 15-30 "build completed" (sweet)
 *   - Cohort B: users with 1-14 (base)
 *   - Cohort C: users with >= 31 (over)
 *   - Event: "deployment completed" / "build completed"
 *   - Measure: ratio of totals per cohort
 *   - Expected: C/A ~ 0.40 (the clean read: 0.6/1.5 — organic
 *     deploys-per-build cancels between two high-activity buckets).
 *     A/B ~ 1.35 (1.5x minus a base-bucket organic offset: low-build
 *     users run slightly deploy-richer mixes, ~0.70 vs ~0.63
 *     organic). Segment to full_stack to hold persona constant and
 *     exclude recovery-window (days 43-49) deploys to decouple H6.
 *
 * REAL-WORLD ANALOGUE: Healthy CI cadence drives reliable deploys;
 * runaway builds signal a flaky pipeline that scares teams off ships.
 *
 * ---------------------------------------------------------------
 * 10. BUILD-DEPLOY TIME-TO-CONVERT (funnel-post)
 * ---------------------------------------------------------------
 *
 * PATTERN: Enterprise and business tier users complete the Build-Deploy
 * Pipeline funnel (build completed -> deployment completed -> monitoring
 * dashboard viewed) 1.5x faster (factor 0.67). Free-tier users complete
 * it 1.33x slower (factor 1.33). The hook intercepts funnel-post arrays,
 * computes the time gap between consecutive steps, and scales each gap
 * by the tier-specific factor before rewriting the step timestamps.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Build-Deploy Pipeline Median TTC by Tier
 *   - Report type: Funnels
 *   - Steps: "build completed" -> "deployment completed" -> "monitoring dashboard viewed"
 *   - Measure: Median time to convert
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Expected: enterprise/business ~ 0.67x baseline; free ~ 1.33x
 *     baseline; team = 1.0 control. Fully engineered enterprise/free
 *     ratio = 0.67/1.33 ≈ 0.50, but the OBSERVED funnel-report ratio
 *     lands ~0.60-0.70: greedy min-gap step picks plus clone
 *     pollution (H9 sweet-spot deploy clones at +5-360min, H6
 *     recovery clones at +1-8h) compress observed gaps for every
 *     tier, and free-tier stretched conversions censor past the
 *     window — both pull the ratio toward 1.
 *
 *   NOTE (funnel-post measurement): visible only via funnel-instance
 *   reads (Mixpanel funnels, or emulateBreakdown timeToConvert).
 *   Cross-event MIN→MIN SQL queries on raw events do NOT show this —
 *   funnel-post adjusts gaps within funnel instances, not across the
 *   user's full event history.
 *
 * REAL-WORLD ANALOGUE: Enterprise CI/CD customers get priority build
 * runners and dedicated deploy infrastructure, yielding faster
 * end-to-end pipeline throughput.
 *
 * ===============================================================
 * EXPECTED METRICS SUMMARY
 * ===============================================================
 *
 * Bands were mechanism-derived and confirmed at reduced scale (2K
 * users, same seed) BEFORE the full run; "Measured" is the
 * full-fidelity 10K read (2,198,972 events). All 10 stories NAILED.
 *
 * Hook                        | Metric                        | Baseline | Effect     | Measured @10K
 * ----------------------------|-------------------------------|----------|------------|--------------
 * Build Failure Cascade       | median build_duration_sec     | ~200s    | 2.0x       | 2.000
 * Night Deploy Risk           | deploy failure share          | ~21% day | 0.52 night | 0.503 / 0.208
 * Copilot PR Velocity         | PRs/user (hash cohort)        | ~23      | ~1.5x      | 1.437
 * On-Call Fatigue             | mean response_time_min        | ~53min   | ~2.6x      | 2.599
 * OSS Power Usage             | build share of events (active)| ~0.19    | ~1.28x     | 1.280
 * Post-Outage Recovery        | deploys d44-47, RoR vs builds | 1x       | ~3.7x      | 3.774
 * DevOps Lead Profiles        | repos_connected               | 0 (dflt) | ~12.5      | 12.4
 * Enterprise Funnel Lift      | monitoring views per deploy   | paid 1x  | keep 0.65  | 0.632
 * Build-Count Magic Number    | deploys/build sweet vs base   | 1x       | ~1.35x     | 1.452
 * Build-Count Magic Number    | deploys/build over vs sweet   | 1x       | 0.40x      | 0.406
 * Build-Deploy TTC            | median TTC vs free (emulator) | 1x       | ~0.6-0.7x  | ent 0.642 / biz 0.607 / team 0.795
 */

// ── SCALE ──
const SEED = "dm4-devtools";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const BUILD_FAILURE_DURATION_MULT = 2;

const NIGHT_DEPLOY_HOUR_START = 22;
const NIGHT_DEPLOY_HOUR_END = 6;
const NIGHT_DEPLOY_FAIL_LIKELIHOOD = 40;

const COPILOT_USER_HASH_MOD = 10;
const COPILOT_USER_HASH_THRESHOLD = 3;
const COPILOT_PR_CLONE_RATE = 0.5;

const ONCALL_ALERT_THRESHOLD = 20;
const ONCALL_FATIGUE_DIVISOR = 20;
const ONCALL_FATIGUE_CAP = 3;

const OSS_EVENT_THRESHOLD = 15;
const OSS_CONVERSION_POINT_PCT = 0.7;
const OSS_BUILD_CLONE_LIKELIHOOD = 30;
const OSS_DEPLOY_CLONE_LIKELIHOOD = 20;

const RECOVERY_START_DAY = 44;
const RECOVERY_END_DAY = 48;
const RECOVERY_CLONES_PER_EVENT = 3;

const ENTERPRISE_DROP_LIKELIHOOD = 35;

const BUILD_SWEET_MIN = 15;
const BUILD_SWEET_MAX = 30;
const BUILD_OVER_THRESHOLD = 31;
const BUILD_SWEET_CLONE_RATE = 0.5;
const BUILD_OVER_DROP_LIKELIHOOD = 40;

const TTC_FAST_FACTOR = 0.67;
const TTC_SLOW_FACTOR = 1.33;

// ── DATA ARRAYS ──
// Generate consistent pipeline/repo IDs at module level
const pipelineIds = v.range(1, 80).map(() => `PIPE_${v.uid(6)}`);
const repoIds = v.range(1, 150).map(() => `REPO_${v.uid(6)}`);

// ── HELPER FUNCTIONS ──
function handleFunnelPostHooks(record, meta) {
	// H10: BUILD-DEPLOY TIME-TO-CONVERT
	// Enterprise tier completes Build-Deploy Pipeline funnel 1.5x faster
	// (factor 0.67); free tier 1.33x slower (factor 1.33).
	const segment = meta?.profile?.subscription_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "enterprise" || segment === "business" ? TTC_FAST_FACTOR :
			segment === "free" ? TTC_SLOW_FACTOR :
			1.0
		);
		if (factor !== 1.0) {
			for (let i = 1; i < record.length; i++) {
				const prev = dayjs(record[i - 1].time);
				const newGap = Math.round(dayjs(record[i].time).diff(prev) * factor);
				record[i].time = prev.add(newGap, "milliseconds").toISOString();
			}
		}
	}
	return record;
}

function handleUserHooks(record) {
	// H7: DEVOPS LEAD PROFILE ENRICHMENT
	// DevOps leads get team_size 10-50 and repos_connected 5-20.
	// Platform engineers get moderate boosts. Others stay at defaults.
	if (record.segment === "devops") {
		record.team_size = chance.integer({ min: 10, max: 50 });
		record.repos_connected = chance.integer({ min: 5, max: 20 });
		record.experience_level = "senior";
	} else if (record.segment === "platform_eng") {
		record.team_size = chance.integer({ min: 5, max: 25 });
		record.repos_connected = chance.integer({ min: 3, max: 15 });
		record.experience_level = chance.pickone(["mid", "senior"]);
	} else if (record.segment === "junior") {
		record.team_size = chance.integer({ min: 1, max: 8 });
		record.repos_connected = chance.integer({ min: 0, max: 3 });
		record.experience_level = "junior";
	}
	return record;
}

function handleEventHooks(record) {
	// H1: BUILD FAILURE CASCADE
	// Failed builds get 2x duration (retries take longer).
	if (record.event === "build completed" && record.build_status === "failed") {
		record.build_duration_sec = Math.floor((record.build_duration_sec || 240) * BUILD_FAILURE_DURATION_MULT);
	}
	// (HOOK 2: NIGHT DEPLOY RISK moved to everything hook — hour checks
	// must run after bunchIntoSessions redistributes timestamps)
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	let events = record;
	if (!events.length) return record;
	const profile = meta && meta.profile ? meta.profile : {};

	// SUPERPROP STAMPING
	// Stamp superProp values from profile onto every event so they stay
	// consistent per-user instead of randomizing per-event.
	events.forEach(e => {
		if (profile.subscription_tier) e.subscription_tier = profile.subscription_tier;
		if (profile.Platform) e.Platform = profile.Platform;
		if (profile.language) e.language = profile.language;
	});

	// H2: NIGHT DEPLOY RISK
	// Deployments between 10PM-6AM get deploy_status forced to "failed"
	// 40% of the time. No flag — analyst breaks down by hour-of-day.
	events.forEach(e => {
		if (e.event === "deployment completed") {
			const hour = new Date(e.time).getUTCHours();
			if ((hour >= NIGHT_DEPLOY_HOUR_START || hour < NIGHT_DEPLOY_HOUR_END) && chance.bool({ likelihood: NIGHT_DEPLOY_FAIL_LIKELIHOOD })) {
				e.deploy_status = "failed";
			}
		}
	});

	// H8: ENTERPRISE BUILD-DEPLOY FUNNEL LIFT
	// Free-tier users drop 35% of final funnel step events to create
	// visible conversion gap vs paid subscribers.
	if (profile.subscription_tier !== "enterprise" && profile.subscription_tier !== "business") {
		events = events.filter(e => {
			if (e.event === "monitoring dashboard viewed" && chance.bool({ likelihood: ENTERPRISE_DROP_LIKELIHOOD })) return false;
			return true;
		});
	}

	// H3: COPILOT PR VELOCITY
	// ~30% of users are copilot adopters (hash-based cohort).
	// Copilot users get ai_assist="copilot" stamped and 1.5x more PRs.
	const uid = events[0]?.user_id || "";
	const isCopilotUser = (typeof uid === "string" ? uid.charCodeAt(0) : uid) % COPILOT_USER_HASH_MOD < COPILOT_USER_HASH_THRESHOLD;
	if (isCopilotUser) {
		events.forEach(e => {
			if (e.event === "pull request created" || e.event === "code review completed") {
				e.ai_assist = "copilot";
			}
		});
		const prEvents = events.filter(e => e.event === "pull request created");
		const extraCount = Math.floor(prEvents.length * COPILOT_PR_CLONE_RATE);
		for (let i = 0; i < extraCount; i++) {
			const templateEvent = prEvents[i % prEvents.length];
			if (templateEvent) {
				events.push({
					...templateEvent,
					time: dayjs(templateEvent.time).add(chance.integer({ min: 1, max: 12 }), "hours").toISOString(),
					user_id: templateEvent.user_id,
					ai_assist: "copilot",
					files_changed: chance.integer({ min: 1, max: 30 }),
					lines_added: chance.integer({ min: 10, max: 800 }),
				});
			}
		}
	}

	// H4: ON-CALL ROTATION FATIGUE
	// Users with >20 alerts get increasing response_time_minutes.
	const alertCount = events.filter(e => e.event === "alert triggered").length;
	if (alertCount > ONCALL_ALERT_THRESHOLD) {
		const fatigueMultiplier = 1 + Math.min(alertCount / ONCALL_FATIGUE_DIVISOR, ONCALL_FATIGUE_CAP);
		events.forEach(e => {
			if (e.event === "incident resolved" && e.response_time_minutes) {
				e.response_time_minutes = Math.floor(e.response_time_minutes * fatigueMultiplier);
			}
			if (e.event === "incident created" && e.response_time_minutes) {
				e.response_time_minutes = Math.floor(e.response_time_minutes * fatigueMultiplier);
			}
		});
	}

	// H5: OPEN SOURCE POWER USAGE
	// OSS users with >15 events get extra cloned build + deploy events
	// in their later activity (representing power usage that pushes them
	// toward limits). No flag — discover via cohort by segment + event count.
	if (profile.segment === "oss_user" && events.length > OSS_EVENT_THRESHOLD) {
		const buildTemplate = events.find(e => e.event === "build completed");
		const deployTemplate = events.find(e => e.event === "deployment completed");
		if (buildTemplate || deployTemplate) {
			const conversionPoint = Math.floor(events.length * OSS_CONVERSION_POINT_PCT);
			const tail = events.slice(conversionPoint);
			tail.forEach(e => {
				const tBase = dayjs(e.time);
				if (buildTemplate && chance.bool({ likelihood: OSS_BUILD_CLONE_LIKELIHOOD })) {
					events.push({
						...buildTemplate,
						time: tBase.add(chance.integer({ min: 5, max: 240 }), "minutes").toISOString(),
						user_id: e.user_id,
					});
				}
				if (deployTemplate && chance.bool({ likelihood: OSS_DEPLOY_CLONE_LIKELIHOOD })) {
					events.push({
						...deployTemplate,
						time: tBase.add(chance.integer({ min: 10, max: 240 }), "minutes").toISOString(),
						user_id: e.user_id,
					});
				}
			});
		}
	}

	// H9: BUILD-COUNT MAGIC NUMBER (no flags)
	// Sweet 15-30 builds → +50% deploys (clone with unique offset).
	// Over 31+ → drop 40% of deploys (flaky CI burnout).
	const buildCount = events.filter(e => e.event === "build completed").length;
	if (buildCount >= BUILD_SWEET_MIN && buildCount <= BUILD_SWEET_MAX) {
		const deploys = events.filter(e => e.event === "deployment completed");
		const extras = Math.max(Math.floor(deploys.length * BUILD_SWEET_CLONE_RATE), 1);
		for (let k = 0; k < extras; k++) {
			const tpl = deploys[k % deploys.length];
			if (tpl) {
				events.push({
					...tpl,
					time: dayjs(tpl.time).add(chance.integer({ min: 5, max: 360 }), "minutes").toISOString(),
					user_id: tpl.user_id,
				});
			}
		}
	} else if (buildCount >= BUILD_OVER_THRESHOLD) {
		for (let i = events.length - 1; i >= 0; i--) {
			if (events[i].event === "deployment completed" && chance.bool({ likelihood: BUILD_OVER_DROP_LIKELIHOOD })) {
				events.splice(i, 1);
			}
		}
	}

	// H6: POST-OUTAGE RECOVERY
	// After the outage volume rebound (days 44-47: window [start+44d,
	// start+48d)), deployment events get aggressively cloned to
	// produce a visible spike above baseline.
	// Shifted later than outage end (d42.25) so natural volume has
	// recovered from the 0.05x suppression before cloning kicks in.
	const RECOVERY_START = datasetStart.add(RECOVERY_START_DAY, "days");
	const RECOVERY_END = datasetStart.add(RECOVERY_END_DAY, "days");
	const deployEvents = events.filter(e => {
		if (e.event !== "deployment completed") return false;
		const t = dayjs(e.time);
		return t.isAfter(RECOVERY_START) && t.isBefore(RECOVERY_END);
	});
	deployEvents.forEach(dep => {
		// 100% clone rate with 3 copies per event to clearly
		// exceed baseline deploy volume (d35-41)
		for (let c = 0; c < RECOVERY_CLONES_PER_EVENT; c++) {
			events.push({
				...dep,
				time: dayjs(dep.time).add(chance.integer({ min: 1, max: 8 }), "hours").toISOString(),
				user_id: dep.user_id,
				deploy_status: chance.pickone(["success", "success", "rolled_back"]),
				environment: "production",
			});
		}
	});

	return events;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	version: 2,
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
	identity: {
		avgDevicePerUser: 2,
	},
	concurrency: 1,
	writeToDisk: false,
	scdProps: {
		subscription_tier: {
			values: ["free", "pro", "enterprise"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		}
	},
	mirrorProps: {},
	lookupTables: [],

	// -- Events (18) ------------------------------------------
	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				referral_source: ["organic", "github", "conference", "blog_post", "colleague", "search"],
			},
		},
		{
			event: "build completed",
			weight: 8,
			isStrictEvent: false,
			properties: {
				pipeline_id: chance.pickone.bind(chance, pipelineIds),
				repo_id: chance.pickone.bind(chance, repoIds),
				build_status: ["success", "success", "success", "success", "failed", "cancelled"],
				build_duration_sec: u.weighNumRange(10, 600, 0.4, 240),
				branch: ["main", "main", "develop", "feature", "feature", "hotfix"],
				test_count: u.weighNumRange(10, 500, 0.5, 100),
				test_pass_rate: u.weighNumRange(70, 100, 0.8, 95),
			},
		},
		{
			event: "deployment completed",
			weight: 5,
			isStrictEvent: false,
			properties: {
				pipeline_id: chance.pickone.bind(chance, pipelineIds),
				repo_id: chance.pickone.bind(chance, repoIds),
				deploy_status: ["success", "success", "success", "failed", "rolled_back"],
				environment: ["production", "production", "staging", "staging", "dev", "preview"],
				deploy_duration_sec: u.weighNumRange(15, 300, 0.4, 90),
				preview_enabled: [false],
			},
		},
		{
			event: "pull request created",
			weight: 6,
			isStrictEvent: false,
			properties: {
				repo_id: chance.pickone.bind(chance, repoIds),
				pr_size: ["small", "small", "medium", "medium", "large", "xlarge"],
				files_changed: u.weighNumRange(1, 50, 0.4, 8),
				lines_added: u.weighNumRange(1, 2000, 0.3, 150),
				lines_removed: u.weighNumRange(0, 500, 0.3, 40),
				ai_assist: ["manual"],
			},
		},
		{
			event: "code review completed",
			weight: 5,
			isStrictEvent: false,
			properties: {
				repo_id: chance.pickone.bind(chance, repoIds),
				review_result: ["approved", "approved", "approved", "changes_requested", "commented"],
				review_duration_hours: u.weighNumRange(0.5, 72, 0.3, 8),
				comments_count: u.weighNumRange(0, 20, 0.5, 3),
				ai_assist: ["manual"],
			},
		},
		{
			event: "alert triggered",
			weight: 4,
			isStrictEvent: false,
			properties: {
				alert_type: ["error_rate", "latency", "cpu", "memory", "disk", "custom_metric"],
				severity: ["info", "warning", "warning", "critical", "critical"],
				service: ["api", "web", "worker", "database", "cdn", "auth"],
				acknowledged: [true, true, true, false],
			},
		},
		{
			event: "incident created",
			weight: 2,
			isStrictEvent: false,
			properties: {
				severity: ["sev1", "sev2", "sev2", "sev3", "sev3", "sev3"],
				service: ["api", "web", "worker", "database", "cdn", "auth"],
				response_time_minutes: u.weighNumRange(1, 120, 0.3, 30),
				root_cause: ["deploy", "config_change", "dependency", "traffic_spike", "hardware", "unknown"],
			},
		},
		{
			event: "incident resolved",
			weight: 2,
			isStrictEvent: false,
			properties: {
				severity: ["sev1", "sev2", "sev2", "sev3", "sev3", "sev3"],
				resolution_time_minutes: u.weighNumRange(5, 480, 0.3, 60),
				response_time_minutes: u.weighNumRange(1, 120, 0.3, 30),
				resolution_type: ["hotfix", "rollback", "config_change", "scaling", "restart", "manual"],
			},
		},
		{
			event: "repository connected",
			weight: 2,
			properties: {
				provider: ["github", "github", "github", "gitlab", "bitbucket"],
				repo_visibility: ["private", "private", "private", "public"],
				language: ["javascript", "python", "go", "rust", "java", "typescript"],
			},
		},
		{
			event: "pipeline configured",
			weight: 2,
			properties: {
				pipeline_id: chance.pickone.bind(chance, pipelineIds),
				pipeline_type: ["build_test", "build_test_deploy", "deploy_only", "lint_test"],
				trigger: ["push", "push", "pull_request", "schedule", "manual"],
				runtime: ["docker", "docker", "node", "python", "go"],
			},
		},
		{
			event: "collaboration invited",
			weight: 2,
			properties: {
				invite_role: ["developer", "developer", "admin", "viewer"],
				invite_method: ["email", "email", "link", "github_team"],
			},
		},
		{
			event: "monitoring dashboard viewed",
			weight: 5,
			isStrictEvent: false,
			properties: {
				dashboard_type: ["overview", "performance", "errors", "deploys", "custom"],
				time_range: ["1h", "6h", "24h", "7d", "30d"],
				widgets_count: u.weighNumRange(1, 12, 0.5, 4),
			},
		},
		{
			event: "log searched",
			weight: 4,
			properties: {
				query_type: ["full_text", "structured", "regex"],
				time_range: ["15m", "1h", "6h", "24h", "7d"],
				results_count: u.weighNumRange(0, 500, 0.3, 50),
				service: ["api", "web", "worker", "database", "auth"],
			},
		},
		{
			event: "notification received",
			weight: 6,
			properties: {
				notification_type: ["build_failed", "deploy_completed", "pr_review_requested", "alert_fired", "mention", "billing"],
				channel: ["in_app", "in_app", "email", "slack", "webhook"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "billing updated",
			weight: 1,
			properties: {
				change_type: ["plan_upgrade", "plan_downgrade", "payment_method", "add_seats", "remove_seats"],
				payment_method: ["credit_card", "credit_card", "invoice", "paypal"],
			},
		},
		{
			event: "app session",
			weight: 8,
			properties: {
				session_duration_sec: u.weighNumRange(10, 3600, 0.4, 180),
				pages_viewed: u.weighNumRange(1, 20, 0.5, 4),
			},
		},
		{
			event: "environment created",
			weight: 2,
			properties: {
				env_type: ["production", "staging", "dev", "preview", "test"],
				cloud_provider: ["aws", "aws", "gcp", "azure", "self_hosted"],
				region: ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"],
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.15,
			isStrictEvent: true,
			properties: {
				reason: ["switched_provider", "cost", "no_longer_needed", "poor_experience", "team_dissolved", "acquired"],
			},
		},
	],

	// -- Funnels (5) ------------------------------------------
	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "repository connected", "pipeline configured", "build completed"],
			conversionRate: 45,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Build-Deploy Pipeline",
			sequence: ["build completed", "deployment completed", "monitoring dashboard viewed"],
			conversionRate: 40,
			order: "sequential",
			timeToConvert: 48,
			weight: 5,
			reentry: true,
		},
		{
			name: "PR Review Flow",
			sequence: ["pull request created", "code review completed", "build completed", "deployment completed"],
			conversionRate: 35,
			order: "sequential",
			timeToConvert: 72,
			weight: 4,
		},
		{
			name: "Incident Response",
			sequence: ["alert triggered", "incident created", "incident resolved"],
			conversionRate: 50,
			order: "sequential",
			timeToConvert: 24,
			weight: 3,
			reentry: true,
		},
		{
			name: "Upgrade Path",
			sequence: ["app session", "billing updated", "collaboration invited"],
			conversionRate: 20,
			order: "sequential",
			timeToConvert: 168,
			weight: 2,
		},
	],

	// -- SuperProps --------------------------------------------
	superProps: {
		subscription_tier: ["free", "free", "free", "team", "team", "business", "enterprise"],
		Platform: ["web", "web", "desktop_app", "cli"],
		language: ["javascript", "python", "go", "rust", "java", "typescript"],
	},

	// -- UserProps ---------------------------------------------
	userProps: {
		dev_role: ["full_stack"],
		segment: ["full_stack"],
		team_size: u.weighNumRange(1, 50, 0.4, 5),
		repos_connected: [0],
		org_name: ["personal"],
		experience_level: ["junior", "junior", "mid", "mid", "mid", "senior", "senior"],
		subscription_tier: ["free", "free", "free", "team", "team", "business", "enterprise"],
		Platform: ["web", "web", "desktop_app", "cli"],
		language: ["javascript", "python", "go", "rust", "java", "typescript"],
	},

	// -- Phase 2: Personas ------------------------------------
	personas: [
		{
			name: "platform_engineer",
			weight: 15,
			eventMultiplier: 4.0,
			conversionModifier: 1.5,
			churnRate: 0.01,
			properties: {
				dev_role: "platform_engineer",
				segment: "platform_eng",
			},
		},
		{
			name: "full_stack_dev",
			weight: 35,
			eventMultiplier: 1.5,
			conversionModifier: 1.0,
			churnRate: 0.05,
			properties: {
				dev_role: "full_stack",
				segment: "full_stack",
			},
		},
		{
			name: "junior_dev",
			weight: 30,
			eventMultiplier: 0.8,
			conversionModifier: 0.6,
			churnRate: 0.12,
			properties: {
				dev_role: "junior",
				segment: "junior",
			},
		},
		{
			name: "devops_lead",
			weight: 10,
			eventMultiplier: 2.0,
			conversionModifier: 1.3,
			churnRate: 0.02,
			properties: {
				dev_role: "devops_lead",
				segment: "devops",
			},
		},
		{
			name: "open_source_user",
			weight: 10,
			eventMultiplier: 0.5,
			conversionModifier: 0.3,
			churnRate: 0.15,
			properties: {
				dev_role: "open_source",
				segment: "oss_user",
			},
		},
	],

	// -- Phase 2: World Events --------------------------------
	worldEvents: [
		{
			name: "major_outage",
			startDay: 42,
			duration: 0.25,
			volumeMultiplier: 0.05,
			affectsEvents: ["deployment completed", "build completed"],
			injectProps: { outage_window: true },
		},
		{
			name: "conference_launch",
			startDay: 60,
			duration: 3,
			volumeMultiplier: 2.0,
			affectsEvents: ["account created"],
			injectProps: { promo: "devcon2024" },
		},
	],

	// -- Phase 2: Data Quality --------------------------------
	dataQuality: {
		lateArrivingRate: 0.01,
		duplicateRate: 0.005,
		botUsers: 2,
		botEventsPerUser: 300,
	},

	hook(record, type, meta) {
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "user") return handleUserHooks(record);
		if (type === "event") return handleEventHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;

// ── STORIES (v1.6 machine-checkable contract) ──────────────────────
// One story per numbered hook. Bands are mechanism-derived (see each
// narrative) and confirmed at reduced scale (2K users, same seed)
// BEFORE the full-fidelity run — never fit to full output post-hoc.
// Scale guards are sized at ~50% of the expected full-fidelity (10K)
// population so reduced-scale runs intentionally read WEAK.

const EV_CTE = `WITH ev AS (
  SELECT e.user_id::VARCHAR AS uid, e.time::TIMESTAMP AS t,
    hour(e.time::TIMESTAMP) AS hr,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', e.time::TIMESTAMP) AS day_idx,
    e.*
  FROM read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true) e
)`;

const US_CTE = `us AS (
  SELECT distinct_id::VARCHAR AS uid, segment
  FROM read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)
)`;

/**
 * @param {number|null|undefined} x measured value
 * @param {[number, number]} nailed tight mechanism band
 * @param {[number, number]} strong wide band
 * @param {string} detail
 * @param {(x: number) => boolean} [inverse] effect-reversed predicate
 */
const bandVerdict = (x, nailed, strong, detail, inverse = () => false) => {
	if (x == null || Number.isNaN(Number(x))) return { verdict: "NONE", detail: `${detail} — metric missing` };
	const v = Number(x);
	if (inverse(v)) return { verdict: "INVERSE", detail };
	if (v >= nailed[0] && v <= nailed[1]) return { verdict: "NAILED", detail };
	if (v >= strong[0] && v <= strong[1]) return { verdict: "STRONG", detail };
	return { verdict: "WEAK", detail };
};

export const stories = [
	{
		id: "devtools-h1-failed-build-duration",
		hook: "H1",
		archetype: "cohort-prop-scale",
		narrative:
			"Failed builds run 2x longer than successful ones (BUILD_FAILURE_DURATION_MULT=2, " +
			"event hook multiplies build_duration_sec in place). Median is the clean read: the " +
			"extreme-value anomaly (10x duration at 0.3%) fattens means but not medians, and " +
			"cancelled builds are untouched (they track success). Mechanism ratio is exactly 2.0 " +
			"(both cohorts draw from the same weighNumRange(10,600,0.4,240) pool). Measured 2.000 " +
			"at 2K. Bot events carry null build_status and fall out of the status groups.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}
SELECT
  median(TRY_CAST(build_duration_sec AS DOUBLE)) FILTER (WHERE build_status='failed')
    / median(TRY_CAST(build_duration_sec AS DOUBLE)) FILTER (WHERE build_status='success') AS med_ratio,
  count(*) FILTER (WHERE build_status='failed') AS n_failed
FROM ev WHERE event='build completed';`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const detail = `median failed/success duration ratio ${Number(r.med_ratio).toFixed(3)} (n_failed=${r.n_failed}; mechanism 2.0)`;
					if (Number(r.n_failed) < 35000) return { verdict: "WEAK", detail: `${detail} — scale guard: n_failed < 35000 (expect ~70K at 10K users)` };
					return bandVerdict(r.med_ratio, [1.9, 2.1], [1.7, 2.4], detail, (x) => x <= 1.1);
				},
			},
		],
	},
	{
		id: "devtools-h2-night-deploy-risk",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative:
			"Deploys at 22:00-05:59 UTC are forced to failed 40% of the time. Organic failed " +
			"share is 1/5=0.20 (status pool), so night share = 0.4 + 0.6*0.2 = 0.52; day stays " +
			"~0.20 plus a small smear from H9 sweet-spot clones of night deploys landing in " +
			"daytime (+5-360min offsets). Days 43-49 are excluded: H6 recovery clones carry " +
			"success/rolled_back only and dilute the share. Measured 0.506 night / 0.213 day at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}
SELECT
  avg((deploy_status='failed')::INT) FILTER (WHERE (hr>=22 OR hr<6) AND day_idx NOT BETWEEN 43 AND 49) AS night_fail,
  avg((deploy_status='failed')::INT) FILTER (WHERE hr BETWEEN 6 AND 21 AND day_idx NOT BETWEEN 43 AND 49) AS day_fail,
  count(*) FILTER (WHERE (hr>=22 OR hr<6) AND day_idx NOT BETWEEN 43 AND 49) AS n_night
FROM ev WHERE event='deployment completed';`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const night = Number(r.night_fail), day = Number(r.day_fail);
					const detail = `night failure share ${night.toFixed(4)} vs day ${day.toFixed(4)} excl. recovery window (n_night=${r.n_night}; mechanism 0.52 vs ~0.21)`;
					if (Number(r.n_night) < 35000) return { verdict: "WEAK", detail: `${detail} — scale guard: n_night < 35000 (expect ~70K at 10K users)` };
					return bandVerdict(night, [0.46, 0.56], [0.42, 0.62], detail, (x) => x <= day + 0.05);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}
SELECT avg((deploy_status='failed')::INT) AS day_fail
FROM ev WHERE event='deployment completed' AND hr BETWEEN 6 AND 21 AND day_idx NOT BETWEEN 43 AND 49;`,
				},
				assert: (rows) => {
					const day = Number(rows?.[0]?.day_fail);
					const detail = `daytime failure share ${day.toFixed(4)} — organic control (pool 0.20 + H9 clone smear)`;
					return bandVerdict(day, [0.18, 0.26], [0.15, 0.3], detail, (x) => x >= 0.4);
				},
			},
		],
	},
	{
		id: "devtools-h3-copilot-pr-velocity",
		hook: "H3",
		archetype: "cohort-count-scale",
		narrative:
			"Hash cohort (user_id charCodeAt(0) % 10 < 3 — GUID first char in {2,3,4,d,e,f}, " +
			"6/16 hex = 37.5% of users) gets floor(PRs*0.5) cloned PR events → ~1.5x PR volume. " +
			"The ai_assist prop is NOT the cohort key: the copilot_integration feature (launchDay " +
			"30) also flips it for feature adopters. Floor drag is negligible at ~23 organic " +
			"PRs/user. Measured ratio 1.491, cohort share 0.386 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, pu AS (
  SELECT uid, (ascii(substr(uid,1,1)) % 10 < 3) AS copilot,
    count(*) FILTER (WHERE event='pull request created') AS prs
  FROM ev GROUP BY 1, 2
)
SELECT
  (sum(prs) FILTER (WHERE copilot))::DOUBLE / count(*) FILTER (WHERE copilot) AS prs_cop,
  (sum(prs) FILTER (WHERE NOT copilot))::DOUBLE / count(*) FILTER (WHERE NOT copilot) AS prs_manual,
  count(*) FILTER (WHERE copilot) AS n_cop,
  (count(*) FILTER (WHERE copilot))::DOUBLE / count(*) AS cohort_share
FROM pu;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const ratio = Number(r.prs_cop) / Number(r.prs_manual);
					const detail = `PRs/user copilot ${Number(r.prs_cop).toFixed(2)} vs manual ${Number(r.prs_manual).toFixed(2)} → ratio ${ratio.toFixed(3)} (mechanism 1.5 minus floor drag)`;
					if (Number(r.n_cop) < 1900) return { verdict: "WEAK", detail: `${detail} — scale guard: cohort users < 1900 (expect ~3860 at 10K)` };
					return bandVerdict(ratio, [1.4, 1.6], [1.25, 1.75], detail, (x) => x <= 1.05);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, pu AS (SELECT uid, (ascii(substr(uid,1,1)) % 10 < 3) AS copilot FROM ev GROUP BY 1, 2)
SELECT (count(*) FILTER (WHERE copilot))::DOUBLE / count(*) AS cohort_share FROM pu;`,
				},
				assert: (rows) => {
					const share = Number(rows?.[0]?.cohort_share);
					const detail = `hash cohort share ${share.toFixed(4)} (mechanism 6/16 = 0.375 of hex-GUID first chars)`;
					return bandVerdict(share, [0.35, 0.41], [0.32, 0.45], detail);
				},
			},
		],
	},
	{
		id: "devtools-h4-oncall-fatigue",
		hook: "H4",
		archetype: "cohort-prop-scale",
		narrative:
			"Users with >20 alert-triggered events get response_time_minutes scaled by " +
			"1 + min(alerts/20, 3) on incident created/resolved. The fatigued cohort's mean " +
			"multiplier measured 2.67 at 2K, and the fatigued/normal mean-response ratio tracks " +
			"it: 137.9 vs 53.4 min = 2.58. Cohort is behavioral (alert volume), no flag stamped.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, pu AS (
  SELECT uid,
    count(*) FILTER (WHERE event='alert triggered') AS alerts,
    avg(TRY_CAST(response_time_minutes AS DOUBLE)) FILTER (WHERE event IN ('incident created','incident resolved')) AS rt,
    count(*) FILTER (WHERE event IN ('incident created','incident resolved')) AS incidents
  FROM ev GROUP BY 1
)
SELECT
  avg(rt) FILTER (WHERE alerts > 20) / avg(rt) FILTER (WHERE alerts <= 20) AS rt_ratio,
  count(*) FILTER (WHERE alerts > 20) AS n_fatigued,
  (count(*) FILTER (WHERE alerts > 20))::DOUBLE / count(*) AS fatigued_share
FROM pu WHERE incidents > 0;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const detail = `fatigued/normal mean response-time ratio ${Number(r.rt_ratio).toFixed(3)} (fatigued share ${Number(r.fatigued_share).toFixed(3)} of incident users; mechanism ~2.6)`;
					if (Number(r.n_fatigued) < 1500) return { verdict: "WEAK", detail: `${detail} — scale guard: fatigued users < 1500 (expect ~3000 at 10K)` };
					return bandVerdict(r.rt_ratio, [2.3, 2.9], [2.0, 3.3], detail, (x) => x <= 1.15);
				},
			},
		],
	},
	{
		id: "devtools-h5-oss-power-usage",
		hook: "H5",
		archetype: "cohort-count-scale",
		narrative:
			"OSS users with >15 events get tail-of-lifetime build clones (30% chance per tail " +
			"event) and deploy clones (20%). Nearly all surviving oss users clear the threshold " +
			"(~72 organic events), so the read is oss-active vs non-oss-active BUILD SHARE of " +
			"events: mechanism (0.19 + 0.3*0.3) / (1.15 * 0.19) ≈ 1.28, measured 1.305 at 2K. " +
			"Deploy share also rises (measured 1.66x) but couples with H9 (oss builds land in " +
			"the sweet spot → +50% deploys; heavy non-oss builders lose 40%), so it gets a wider " +
			"band. Per-event shares cancel the 0.5x persona event multiplier.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, ${US_CTE}, pu AS (
  SELECT ev.uid, count(*) AS n_ev,
    count(*) FILTER (WHERE event='build completed') AS builds,
    count(*) FILTER (WHERE event='deployment completed') AS deploys
  FROM ev GROUP BY 1
)
SELECT
  (sum(builds) FILTER (WHERE u.segment='oss_user' AND n_ev > 25))::DOUBLE / sum(n_ev) FILTER (WHERE u.segment='oss_user' AND n_ev > 25) AS oss_build_share,
  (sum(builds) FILTER (WHERE u.segment != 'oss_user' AND n_ev > 25))::DOUBLE / sum(n_ev) FILTER (WHERE u.segment != 'oss_user' AND n_ev > 25) AS ctl_build_share,
  (sum(deploys) FILTER (WHERE u.segment='oss_user' AND n_ev > 25))::DOUBLE / sum(n_ev) FILTER (WHERE u.segment='oss_user' AND n_ev > 25) AS oss_deploy_share,
  (sum(deploys) FILTER (WHERE u.segment != 'oss_user' AND n_ev > 25))::DOUBLE / sum(n_ev) FILTER (WHERE u.segment != 'oss_user' AND n_ev > 25) AS ctl_deploy_share,
  count(*) FILTER (WHERE u.segment='oss_user' AND n_ev > 25) AS n_oss_hi
FROM pu p JOIN us u ON p.uid = u.uid;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const ratio = Number(r.oss_build_share) / Number(r.ctl_build_share);
					const detail = `active-oss build share ${Number(r.oss_build_share).toFixed(4)} vs active-non-oss ${Number(r.ctl_build_share).toFixed(4)} → ratio ${ratio.toFixed(3)} (mechanism ~1.28)`;
					if (Number(r.n_oss_hi) < 480) return { verdict: "WEAK", detail: `${detail} — scale guard: active oss users < 480 (expect ~985 at 10K)` };
					return bandVerdict(ratio, [1.2, 1.42], [1.1, 1.55], detail, (x) => x <= 1.02);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, ${US_CTE}, pu AS (
  SELECT ev.uid, count(*) AS n_ev,
    count(*) FILTER (WHERE event='deployment completed') AS deploys
  FROM ev GROUP BY 1
)
SELECT
  (sum(deploys) FILTER (WHERE u.segment='oss_user' AND n_ev > 25))::DOUBLE / sum(n_ev) FILTER (WHERE u.segment='oss_user' AND n_ev > 25) AS oss_deploy_share,
  (sum(deploys) FILTER (WHERE u.segment != 'oss_user' AND n_ev > 25))::DOUBLE / sum(n_ev) FILTER (WHERE u.segment != 'oss_user' AND n_ev > 25) AS ctl_deploy_share
FROM pu p JOIN us u ON p.uid = u.uid;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const ratio = Number(r.oss_deploy_share) / Number(r.ctl_deploy_share);
					const detail = `active-oss deploy share ratio ${ratio.toFixed(3)} (H5 clones + H9 coupling: oss sweet-spot boost vs non-oss over-threshold drop)`;
					return bandVerdict(ratio, [1.4, 1.95], [1.2, 2.2], detail, (x) => x <= 1.0);
				},
			},
		],
	},
	{
		id: "devtools-h6-post-outage-recovery",
		hook: "H6",
		archetype: "temporal-inflection",
		narrative:
			"Every deploy in days 44-47 gets 3 clones (+1-8h offsets, status success/rolled_back). " +
			"Read is ratio-of-ratios vs builds (win/base deploys over win/base builds) to cancel " +
			"the growth ramp and soup DOW. Mechanism: 4x minus clone spill — offsets average +4.5h, " +
			"so ~4.7% of clones exit the 96h window (4x → 3.86) and land in the baseline zone " +
			"(day 49), deflating the ratio to ~3.71. Measured 3.705 at 2K; re-measured with a " +
			"spill-free baseline (excluding days 48-49) at 3.703 — the two effects nearly cancel.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, agg AS (
  SELECT CASE WHEN day_idx BETWEEN 44 AND 47 THEN 'win'
    WHEN day_idx BETWEEN 35 AND 41 OR day_idx BETWEEN 49 AND 55 THEN 'base' END AS zone,
    count(*) FILTER (WHERE event='deployment completed') AS deploys,
    count(*) FILTER (WHERE event='build completed') AS builds
  FROM ev WHERE event IN ('deployment completed','build completed') AND day_idx BETWEEN 35 AND 55
  GROUP BY 1
)
SELECT
  ((max(CASE WHEN zone='win' THEN deploys END)::DOUBLE / max(CASE WHEN zone='base' THEN deploys END))
   / (max(CASE WHEN zone='win' THEN builds END)::DOUBLE / max(CASE WHEN zone='base' THEN builds END))) AS ror,
  max(CASE WHEN zone='win' THEN deploys END) AS deploys_win
FROM agg;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const detail = `recovery-window deploy ratio-of-ratios vs builds ${Number(r.ror).toFixed(3)} (deploys_win=${r.deploys_win}; mechanism 4x − spill ≈ 3.7)`;
					if (Number(r.deploys_win) < 12000) return { verdict: "WEAK", detail: `${detail} — scale guard: window deploys < 12000 (expect ~25K at 10K)` };
					return bandVerdict(r.ror, [3.45, 3.95], [3.0, 4.4], detail, (x) => x <= 1.5);
				},
			},
		],
	},
	{
		id: "devtools-h7-devops-profile-enrichment",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative:
			"User hook rewrites profile props by segment: devops → team_size U(10,50) (mean 30), " +
			"repos_connected U(5,20) (mean 12.5), experience senior; platform_eng → U(5,25)/U(3,15); " +
			"junior → U(1,8)/U(0,3). full_stack and oss_user keep DEFAULTS: repos [0] exactly, and " +
			"team_size from weighNumRange(1,50,0.4,5) whose mean is ~24 — so the team-size contrast " +
			"is devops-vs-junior, and repos_connected (default 0) is the crisp cross-segment signal.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT segment, count(*) AS users,
  avg(TRY_CAST(team_size AS DOUBLE)) AS avg_team,
  avg(TRY_CAST(repos_connected AS DOUBLE)) AS avg_repos,
  mode(experience_level) AS mode_exp
FROM read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY segment;`,
				},
				assert: (rows) => {
					const seg = Object.fromEntries((rows || []).map((r) => [r.segment, r]));
					const d = seg.devops || {};
					const detail = `devops team_size ${Number(d.avg_team).toFixed(1)} (mean-30 target), repos ${Number(d.avg_repos).toFixed(1)} (mean-12.5 target), mode exp ${d.mode_exp} (n=${d.users})`;
					if (Number(d.users || 0) < 480) return { verdict: "WEAK", detail: `${detail} — scale guard: devops users < 480 (expect ~1000 at 10K)` };
					if (d.mode_exp !== "senior") return { verdict: "INVERSE", detail };
					const team = bandVerdict(d.avg_team, [28.5, 31.5], [27, 33], detail, (x) => x <= 8);
					const repos = bandVerdict(d.avg_repos, [11.8, 13.2], [11, 14], detail, (x) => x <= 1);
					const worst = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"].find((v) => v === team.verdict || v === repos.verdict);
					return { verdict: worst, detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT segment, count(*) AS users,
  avg(TRY_CAST(team_size AS DOUBLE)) AS avg_team,
  avg(TRY_CAST(repos_connected AS DOUBLE)) AS avg_repos
FROM read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY segment;`,
				},
				assert: (rows) => {
					const seg = Object.fromEntries((rows || []).map((r) => [r.segment, r]));
					const jr = Number(seg.junior?.avg_team), pe = Number(seg.platform_eng?.avg_repos), fs = Number(seg.full_stack?.avg_repos);
					const detail = `junior team_size ${jr.toFixed(2)} (mean-4.5 target), platform_eng repos ${pe.toFixed(2)} (mean-9 target), full_stack repos ${fs.toFixed(3)} (default [0])`;
					if (fs > 0.01) return { verdict: "INVERSE", detail: `${detail} — full_stack repos nonzero: default pool violated` };
					const jrV = bandVerdict(jr, [4.2, 4.9], [3.8, 5.4], detail, (x) => x >= 20);
					const peV = bandVerdict(pe, [8.4, 9.8], [8.0, 10.5], detail);
					const worst = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"].find((v) => v === jrV.verdict || v === peV.verdict);
					return { verdict: worst, detail };
				},
			},
		],
	},
	{
		id: "devtools-h8-enterprise-funnel-lift",
		hook: "H8",
		archetype: "funnel-conversion-by-segment",
		narrative:
			"Free/team users (everyone except enterprise/business) drop 35% of monitoring-dashboard-" +
			"viewed events (keep rate 0.65). Read is monitoring views PER DEPLOYMENT by tier group — " +
			"the per-deploy normalization cancels H6/H9 deploy inflation (both hit all tiers evenly). " +
			"Mechanism 0.65; measured 0.626 at 2K (small drift from tier/activity covariance).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, pu AS (
  SELECT uid, any_value(subscription_tier) AS tier,
    count(*) FILTER (WHERE event='monitoring dashboard viewed') AS mv,
    count(*) FILTER (WHERE event='deployment completed') AS dep
  FROM ev WHERE event IN ('monitoring dashboard viewed','deployment completed')
  GROUP BY 1
)
SELECT
  (sum(mv) FILTER (WHERE tier IN ('free','team')))::DOUBLE / nullif(sum(dep) FILTER (WHERE tier IN ('free','team')), 0) AS ft_mv_per_dep,
  (sum(mv) FILTER (WHERE tier IN ('enterprise','business')))::DOUBLE / nullif(sum(dep) FILTER (WHERE tier IN ('enterprise','business')), 0) AS paid_mv_per_dep,
  count(*) FILTER (WHERE tier IN ('free','team')) AS n_ft,
  count(*) FILTER (WHERE tier IN ('enterprise','business')) AS n_paid
FROM pu WHERE tier IS NOT NULL;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const keep = Number(r.ft_mv_per_dep) / Number(r.paid_mv_per_dep);
					const detail = `free/team mv-per-deploy ${Number(r.ft_mv_per_dep).toFixed(4)} vs paid ${Number(r.paid_mv_per_dep).toFixed(4)} → keep ratio ${keep.toFixed(3)} (knob 0.65)`;
					if (Number(r.n_ft) < 3400 || Number(r.n_paid) < 1400) return { verdict: "WEAK", detail: `${detail} — scale guard: free/team < 3400 or paid < 1400 users (expect ~7000/~3000 at 10K)` };
					return bandVerdict(keep, [0.58, 0.7], [0.52, 0.78], detail, (x) => x >= 0.92);
				},
			},
		],
	},
	{
		id: "devtools-h9-build-count-magic-number",
		hook: "H9",
		archetype: "frequency-sweet-spot",
		narrative:
			"Users with 15-30 builds get +50% deploy clones; 31+ builds drop 40% of deploys. Read " +
			"is deploys-per-build within full_stack only (holds persona constant) excluding " +
			"recovery-window deploys (decouples H6). The clean pair is over/sweet = 0.6/1.5 = 0.40 " +
			"exactly — organic deploys-per-build cancels between two high-activity buckets; " +
			"measured 0.403 at 2K. sweet/base carries a base-bucket organic offset (low-build " +
			"users run deploy-richer organic mixes, ~0.70 vs ~0.63): mechanism 1.5x lands ~1.35 " +
			"observed; measured 1.347 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, ${US_CTE}, pu AS (
  SELECT ev.uid,
    count(*) FILTER (WHERE event='build completed') AS builds,
    count(*) FILTER (WHERE event='deployment completed' AND day_idx NOT BETWEEN 43 AND 49) AS deploys
  FROM ev GROUP BY 1
), b AS (
  SELECT CASE WHEN builds BETWEEN 15 AND 30 THEN 'sweet' WHEN builds >= 31 THEN 'over' ELSE 'base' END AS bucket,
    count(*) AS users, sum(deploys)::DOUBLE / sum(builds) AS dpb
  FROM pu p JOIN us u ON p.uid = u.uid
  WHERE u.segment = 'full_stack' AND builds >= 1
  GROUP BY 1
)
SELECT
  max(CASE WHEN bucket='over' THEN dpb END) / max(CASE WHEN bucket='sweet' THEN dpb END) AS over_sweet,
  max(CASE WHEN bucket='sweet' THEN users END) AS n_sweet,
  max(CASE WHEN bucket='over' THEN users END) AS n_over
FROM b;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const detail = `deploys-per-build over/sweet ${Number(r.over_sweet).toFixed(3)} (mechanism 0.6/1.5 = 0.40 exact; n_sweet=${r.n_sweet}, n_over=${r.n_over})`;
					if (Number(r.n_sweet) < 350 || Number(r.n_over) < 1200) return { verdict: "WEAK", detail: `${detail} — scale guard: sweet < 350 or over < 1200 full_stack users (expect ~710/~2500 at 10K)` };
					return bandVerdict(r.over_sweet, [0.36, 0.44], [0.3, 0.5], detail, (x) => x >= 0.85);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}, ${US_CTE}, pu AS (
  SELECT ev.uid,
    count(*) FILTER (WHERE event='build completed') AS builds,
    count(*) FILTER (WHERE event='deployment completed' AND day_idx NOT BETWEEN 43 AND 49) AS deploys
  FROM ev GROUP BY 1
), b AS (
  SELECT CASE WHEN builds BETWEEN 15 AND 30 THEN 'sweet' WHEN builds >= 31 THEN 'over' ELSE 'base' END AS bucket,
    count(*) AS users, sum(deploys)::DOUBLE / sum(builds) AS dpb
  FROM pu p JOIN us u ON p.uid = u.uid
  WHERE u.segment = 'full_stack' AND builds >= 1
  GROUP BY 1
)
SELECT
  max(CASE WHEN bucket='sweet' THEN dpb END) / max(CASE WHEN bucket='base' THEN dpb END) AS sweet_base,
  max(CASE WHEN bucket='base' THEN users END) AS n_base
FROM b;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const detail = `deploys-per-build sweet/base ${Number(r.sweet_base).toFixed(3)} (mechanism 1.5x minus base-bucket organic offset ≈ 1.35; n_base=${r.n_base})`;
					if (Number(r.n_base) < 130) return { verdict: "WEAK", detail: `${detail} — scale guard: base bucket < 130 full_stack users (expect ~275 at 10K)` };
					return bandVerdict(r.sweet_base, [1.2, 1.55], [1.05, 1.75], detail, (x) => x <= 1.0);
				},
			},
		],
	},
	{
		id: "devtools-h10-build-deploy-ttc-by-tier",
		hook: "H10",
		archetype: "funnel-ttc-by-segment",
		narrative:
			"funnel-post scales Build-Deploy Pipeline step gaps by tier: enterprise/business x0.67, " +
			"free x1.33, team 1.0 control. Engineered ent/free ratio = 0.504, but the observed " +
			"2-step (build→deploy) median-TTC ratio lands ~0.6-0.7: greedy min-gap picks plus H9/H6 " +
			"deploy-clone pollution compress gaps for every tier, and free's stretched conversions " +
			"censor past the window — both attenuate toward 1. Window 96h = 2x the funnel's 48h " +
			"timeToConvert, covering the 1.33x-stretched support. Measured at 2K (96h window): " +
			"ent/free 0.683, biz/free 0.604, team/free 0.798. Second assertion pins the identity " +
			"model: auth-on-first means every event carries user_id; device_id and tier stamps " +
			"miss only the 2 bot users (~0.13% of events).",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["build completed", "deployment completed"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: 96 * 3600 * 1000,
				},
				assert: (rows) => {
					const cells = Object.fromEntries((rows || []).map((r) => [r.segment_value, r]));
					const med = (t) => (cells[t] ? cells[t].median_ttc_ms : null);
					const free = med("free"), ent = med("enterprise"), biz = med("business"), team = med("team");
					if (!free || !ent || !biz || !team) return { verdict: "NONE", detail: "missing tier cell in timeToConvert breakdown" };
					const entR = ent / free, bizR = biz / free, teamR = team / free;
					const detail = `median TTC ratios vs free — enterprise ${entR.toFixed(3)}, business ${bizR.toFixed(3)}, team ${teamR.toFixed(3)} (engineered 0.504/0.504/0.752, attenuation documented; free n=${cells.free.user_count})`;
					if (Number(cells.free.user_count) < 1200) return { verdict: "WEAK", detail: `${detail} — scale guard: free converters < 1200 (expect ~2780 at 10K)` };
					if (Math.min(entR, bizR) >= 0.95) return { verdict: "INVERSE", detail };
					if (entR >= 0.5 && entR <= 0.8 && bizR >= 0.5 && bizR <= 0.8 && teamR >= 0.68 && teamR <= 0.9) return { verdict: "NAILED", detail };
					if (entR >= 0.42 && entR <= 0.9 && bizR >= 0.42 && bizR <= 0.9 && teamR >= 0.6 && teamR <= 0.98) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `${EV_CTE}
SELECT
  avg((uid IS NOT NULL)::INT) AS uid_share,
  avg((device_id IS NOT NULL)::INT) AS dev_share,
  avg((subscription_tier IS NOT NULL)::INT) AS tier_share
FROM ev;`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					const uid = Number(r.uid_share), dev = Number(r.dev_share), tier = Number(r.tier_share);
					const detail = `identity invariants — user_id share ${uid.toFixed(4)}, device_id share ${dev.toFixed(4)}, tier stamp share ${tier.toFixed(4)} (auth-on-first: 1.0 / ~0.999 / ~0.999; bots lack device+tier)`;
					if (uid === 1 && dev >= 0.995 && tier >= 0.995) return { verdict: "NAILED", detail };
					if (uid >= 0.999 && dev >= 0.99 && tier >= 0.99) return { verdict: "STRONG", detail };
					if (uid < 0.9) return { verdict: "INVERSE", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
];

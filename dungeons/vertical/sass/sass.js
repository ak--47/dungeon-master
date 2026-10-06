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
 * NAME:       Tallyboard
 * APP:        B2B cloud operations platform for engineering teams: connect a
 *             cloud account, install the agent, watch service dashboards, get
 *             paged on alerts, ship through hosted CI pipelines, and review
 *             cloud cost. Free plan plus paid Team ($20 → $25 per seat per
 *             month from 2026-08-17) and Business ($45 per seat); Enterprise
 *             is sales-led. Root Cause Assist (AI incident help) is a Business
 *             and Enterprise feature from 2026-07-22.
 * SCALE:      10,000 users (≈4,490 sign up inside the window), ~1.11M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC), 300 customer companies
 * CORE LOOP:  dashboard viewed → query executed; alert triggered → alert
 *             acknowledged → alert resolved; deployment pipeline run → service deployed
 * VALUE MOMENT: alert acknowledged (the platform got a human to a problem)
 *
 * EVENTS (23):
 *   dashboard viewed (10) > query executed (8) > api call (6) > teammate invited (3)
 *   > documentation viewed (3) > integration configured (2) > cost report generated (2)
 *   > infrastructure scaled (2) > security scan (2) > feature flag toggled (2)
 *   > runbook executed (1) > funnel-only: account created, cloud account connected,
 *   agent installed, dashboard created, alert triggered / acknowledged / resolved,
 *   deployment pipeline run, service deployed, upgrade page viewed,
 *   subscription started, $experiment_started
 *
 * FUNNELS (10):
 *   - Onboarding (first funnel, two copies by cloud_provider, H3):
 *       account created → cloud account connected → agent installed → dashboard created
 *       (62% AWS/GCP/multi-cloud, 34% Azure)
 *   - Monitoring: dashboard viewed → query executed (75%)
 *   - Incident Response: alert triggered → alert acknowledged → alert resolved
 *       (72%, alert_id/severity/alert_type held per alert)
 *   - Deploy Pipeline: deployment pipeline run → service deployed (68%, deploy_id
 *       per run, runner_region per run, A/B "Smart Test Selection" from 2026-07-15)
 *   - Upgrade (new signups, customer_since ≥ window start): upgrade page viewed →
 *       subscription started (35%); Upgrade (established free users): same steps (6%)
 *   - Cost Review: cost report generated → infrastructure scaled (45%)
 *   - Runbooks: documentation viewed → runbook executed (35%)
 *
 * USER PROPS:  company_id, company_name, company_size, industry, primary_role,
 *              plan_tier, customer_since, cloud_provider, acquisition_channel,
 *              seat_count, annual_contract_value, customer_success_manager,
 *              "Experiment: Smart Test Selection" (enrolled users)
 * SUPER PROPS: plan_tier (plan at event time), cloud_provider (sticky per user)
 * SCD PROPS:   account_health (healthy/neutral/at_risk, monthly, max 4)
 * GROUPS:      company_id (300 companies; every event carries the user's own company)
 * WAREHOUSE:   paid_marketing_daily (spend by paid channel),
 *              ci_runner_health_daily (hosted CI runner health by region),
 *              subscription_bookings_daily (new seats, list price, new MRR by plan)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 *
 * IDENTITY: new users are identified at "account created" (isAuthEvent, first
 * event, carries user_id + device_id); 2 devices per user on average. Every
 * event carries user_id.
 *
 * DESIGN NOTES:
 * - Company attributes (size, industry, cloud, ACV, contracted seats, CSM) come
 *   from one seeded table of 300 companies; users map to companies by a hash
 *   weighted toward larger companies. The group hook writes the same table onto
 *   the company group profiles, so profiles, events, and groups agree.
 * - Alert timing is rebuilt per alert in the everything hook: trigger → ack and
 *   ack → resolve gaps are seeded log-normals scaled by severity and the story
 *   knobs, and response_time_mins / resolution_time_mins are the real gaps.
 * - Pipeline status is coherent with the funnel: a run is "success" exactly
 *   when its deploy (same deploy_id) happened.
 * - retentionCurve (not engagementDecay) shapes activity and pins each new
 *   user's signup to their creation day.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, or a cohort. Dates live in the TIMELINE constants and are
 * shared by hooks, stories, SQL, warehouse columns, and the timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. Q3 QUARTER-CLOSE SEAT PUSH (declarative world event)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-16 through 2026-09-30, the sales team's quarter-close seat
 *   promotion multiplies "teammate invited" by 1.5. Dashboard views are
 *   untouched.
 * MIXPANEL: Insights, teammate invited and dashboard viewed, daily, formula
 *   A/B; Sep 16-30 vs Sep 1-15.
 * REAL WORLD: discounts on added seats at quarter close pull expansion forward.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. ROOT CAUSE ASSIST LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-22, 50% of users on a Business or Enterprise plan
 *   (plan at event time) adopt Root Cause Assist and use it on 80% of their
 *   resolutions: 40% of eligible resolutions carry resolution_method =
 *   "ai_assist", and their acknowledge → resolve time is 0.55x. Free and Team
 *   never use it. Time to acknowledge is untouched (honest null).
 * MIXPANEL: Insights, alert resolved, average resolution_time_mins, breakdown
 *   resolution_method, filter plan_tier in (business, enterprise), after launch.
 * REAL WORLD: AI summaries of logs and recent changes shorten diagnosis, not
 *   the time it takes to notice a page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. AZURE ONBOARDING FRICTION (declarative duplicate first funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new accounts at Azure companies finish onboarding at 34% vs 62%
 *   for AWS, GCP, and multi-cloud (0.55x). Losses spread over the connect and
 *   install steps.
 * MIXPANEL: Funnels, account created → cloud account connected → agent
 *   installed → dashboard created, 7-day window, breakdown cloud_provider.
 * REAL WORLD: a newer cloud integration with more setup steps leaks signups.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. SLACK + PAGERDUTY SPEED UP RESPONSE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: users who configured both the Slack and PagerDuty integrations
 *   acknowledge alerts in 0.4x the time. Acknowledge → resolve is unchanged.
 * MIXPANEL: Insights, alert acknowledged, average response_time_mins,
 *   breakdown by a cohort "configured slack AND pagerduty".
 * REAL WORLD: the page reaches the on-call where they already are.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. FIRST-WEEK TEAM ACTIVATION (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new users with fewer than 2 "teammate invited" in their first 7
 *   days: 50% go dark after day 14. Separately, 70% of all new users lapse on
 *   a uniform day 4-75 (organic, independent of activation). D30 retention
 *   ratio activated / not activated ≥ 2.
 * MIXPANEL: Retention, account created → any event, cohort "≥2 teammate
 *   invited in first 7 days".
 * REAL WORLD: a tool one engineer uses alone is easy to abandon; a team tool
 *   is not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. SMART TEST SELECTION EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-15 users split 50/50; "Smart Selection" multiplies the
 *   share of pipeline runs that deploy by 1.2 and run → deploy time by 0.75.
 * MIXPANEL: Funnels, deployment pipeline run → service deployed, totals, hold
 *   deploy_id constant, breakdown user property "Experiment: Smart Test
 *   Selection", 1-day window; or Insights share of pipeline_status = success.
 * REAL WORLD: running only the tests a change touches cuts flaky failures and
 *   pipeline time.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. CI RUNNER INCIDENT (everything + warehouse ci_runner_health_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-25 to 2026-08-27, hosted runners in us-east degrade: 60%
 *   of would-be successful us-east runs fail and their deploys never happen.
 *   The warehouse shows runner_status = "major_outage" and infra_error_rate ≈
 *   0.6 for us-east on those days. Events carry no failure reason.
 * MIXPANEL: Insights, deployment pipeline run, share pipeline_status =
 *   success, daily, breakdown runner_region; join the warehouse status.
 * REAL WORLD: a capacity incident in one region looks like "our builds got
 *   flaky" until someone checks the status page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. PAID CHANNEL ECONOMICS (everything + warehouse paid_marketing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup is $420 LinkedIn Ads, $210 G2, $140 paid
 *   search (seeded ±12% day noise). Share of would-be paid subscriptions kept
 *   by channel: LinkedIn 1.0, outbound 0.9, referral 0.8, G2 0.7, organic 0.65,
 *   paid search 0.5, so LinkedIn signups buy at 2x the paid-search rate.
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   paid_marketing_daily.spend_usd; Funnels account created → subscription
 *   started by acquisition_channel.
 * REAL WORLD: account-based LinkedIn targeting reaches buyers, at a price.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. TEAM PLAN PRICE CHANGE (everything + warehouse subscription_bookings_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-08-17 Team rises from $20 to $25 per seat per month.
 *   New Team subscriptions keep their volume but start with 0.7x the seats;
 *   Business is unchanged. Prices exist only in the warehouse.
 * MIXPANEL: Insights, subscription started, average seats, breakdown plan,
 *   weekly; new MRR needs the warehouse list_price_per_seat_usd.
 * REAL WORLD: buyers absorb a per-seat price rise by buying fewer seats.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. TIME TO ACKNOWLEDGE BY COMPANY SIZE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: trigger → ack time is 0.6x at enterprise companies and 1.5x at
 *   startups, vs SMB and mid-market.
 * MIXPANEL: Funnels, alert triggered → alert acknowledged, hold alert_id
 *   constant, median time to convert, breakdown company_size.
 * REAL WORLD: dedicated on-call rotations vs part-time ownership.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H11. ALERT FATIGUE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: users who receive more than 12 alerts in the window leave a
 *   growing share unacknowledged: the loss ramps linearly to 50% of would-be
 *   acks at 30+ alerts (no cliff).
 * MIXPANEL: Funnels, alert triggered → alert acknowledged, totals, hold
 *   alert_id constant, breakdown by a cohort on alert count bins.
 * REAL WORLD: noisy alerting trains people to ignore pages.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-sass, 2026-10-06)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                       | Derivation               | Expected | Measured
 * -----|----------------------------------------------|--------------------------|----------|---------
 * H1   | invites per dashboard view, promo/before     | QUARTER_CLOSE_INVITE_MULT| 1.50     | 1.495
 * H2   | ai_assist rows pre-launch or Free/Team       | exact purity             | 0        | 0
 * H2   | ai/other resolution time, Biz+Ent post-launch| RCA_RESOLVE_MULT         | 0.55     | 0.545 (71.4 vs 130.9 min)
 * H2   | ai share of eligible resolutions             | 0.5 × 0.8                | 0.40     | 0.391
 * H3   | onboarding conversion Azure/others           | 34/62                    | 0.548    | 0.537 (33.4% vs 62.1%)
 * H4   | avg response time Slack+PD / rest            | INTEGRATED_RESPONSE_MULT | 0.40     | 0.399 (10.9 vs 27.3 min)
 * H5   | D30 retention activated/not activated        | ≥ 1/(1 − 0.5) (floor)    | ≥ 2.0    | 2.093 (70.4% vs 33.6%)
 * H6   | per-run deploy rate Smart/Control            | SMART_TEST_CONV_MULT     | 1.20     | 1.203 (81.1% vs 67.4%)
 * H6   | median run → deploy time Smart/Control       | SMART_TEST_TTC_MULT      | 0.75     | 0.749 (22.5 vs 30.0 min)
 * H6   | Smart Selection share of enrolled users      | equal 2-arm hash         | 0.50     | 0.495
 * H7   | us-east / other success, incident vs ±7 days | 1 − RUNNER_INCIDENT_FAIL | 0.40     | 0.378
 * H7   | warehouse infra_error_rate during incident   | RUNNER_INCIDENT_FAIL     | 0.60     | 0.610
 * H8   | spend per signup LinkedIn / paid search      | 420 / 140                | 3.00     | 2.976
 * H8   | same-week paid rate LinkedIn / paid search   | 1.0 / 0.5 (floor 1.5)    | 2.00     | 2.270 (STRONG)
 * H9   | avg seats Team post/pre                      | TEAM_SEAT_MULT           | 0.70     | 0.737 (8.87 vs 12.04)
 * H9   | avg seats Business post/pre (control)        | unchanged                | 1.00     | 0.950
 * H9   | new MRR per Team subscription post/pre       | 0.7 × 25/20              | 0.875    | 0.921
 * H10  | median trigger → ack, enterprise / SMB+mid   | RESPONSE_SIZE_MULT       | 0.60     | 0.599
 * H10  | median trigger → ack, startup / SMB+mid      | RESPONSE_SIZE_MULT       | 1.50     | 1.516
 * H11  | ack rate 30+ alerts / ≤12 alerts             | 1 − FATIGUE_FLIP         | 0.50     | 0.492
 * ═════════════════════════════════════════════════════════════════════════
 *
 * H8's paid-rate ratio grades STRONG: a few hundred paying signups per
 * channel give it about ±10% sampling error, so the knob is the target and
 * half the effect (1.5) is the floor.
 */

// ── SCALE ──
const SEED = "harness-sass";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const SMART_TEST_START = "2026-07-15T00:00:00Z";      // "Smart Test Selection" pipeline A/B starts
const RCA_LAUNCH = "2026-07-22T00:00:00Z";            // Root Cause Assist (AI) for Business + Enterprise
const TEAM_PRICE_CHANGE = "2026-08-17T00:00:00Z";     // Team plan $20 → $25 per seat per month
const RUNNER_INCIDENT_START = "2026-08-25T00:00:00Z"; // hosted CI runner incident, us-east
const RUNNER_INCIDENT_END = "2026-08-28T00:00:00Z";   // exclusive (3 days)
const QUARTER_CLOSE_START = "2026-09-16T00:00:00Z";   // Q3 quarter-close seat promotion
const QUARTER_CLOSE_DAYS = 15;                        // through 2026-09-30

const ms = (iso) => dayjs.utc(iso).valueOf();
const dayIndex = (iso) => Math.round((ms(iso) - ms(DATASET_START)) / 86_400_000);
const DAY_MS = 86_400_000;
const D0 = DATASET_START.slice(0, 10);
const MIN_MS = 60_000;

// ── KNOBS ──
// H1 quarter-close seat push (world event on "teammate invited")
const QUARTER_CLOSE_INVITE_MULT = 1.5;

// H2 Root Cause Assist: Business/Enterprise resolutions after launch
const RCA_PLANS = ["business", "enterprise"];
const RCA_ADOPTER_SHARE = 0.5;     // share of eligible users who adopt Root Cause Assist (salted per user)
const RCA_ADOPTER_USE = 0.8;       // share of an adopter's resolutions that use it
const RCA_ADOPTION = RCA_ADOPTER_SHARE * RCA_ADOPTER_USE; // 0.40 of eligible resolutions
const RCA_RESOLVE_MULT = 0.55;     // ack → resolve time with Root Cause Assist

// H3 onboarding by cloud provider (declarative duplicate first funnels)
const ONBOARD_CONV = 62;
const AZURE_ONBOARD_MULT = 0.55;
const ONBOARD_TTC_H = 30;

// H4 Slack + PagerDuty: alerts reach the on-call faster (ack only)
const INTEGRATION_PAIR = ["slack", "pagerduty"];
const INTEGRATED_RESPONSE_MULT = 0.4;

// H5 first-week activation → retention (new signups only)
const ACTIVATION_EVENT = "teammate invited";
const ACTIVATION_DAYS = 7;
const ACTIVATION_MIN = 2;          // invites in the first 7 days that mark an activated workspace
const DARK_SHARE = 0.5;            // share of non-activated new users who go dark after day 14
const DARK_AFTER_DAYS = 14;
const LAPSE_SHARE = 0.7;           // organic lapse, every new user, independent of activation
const LAPSE_DAY_MIN = 4;
const LAPSE_DAY_MAX = 75;

// H6 Smart Test Selection experiment on the deploy pipeline funnel
const SMART_TEST_EXPERIMENT = "Smart Test Selection";
const SMART_TEST_VARIANT = "Smart Selection";
const SMART_TEST_CONV_MULT = 1.2;
const SMART_TEST_TTC_MULT = 0.75;
const DEPLOY_CONV = 68;
const DEPLOY_TTC_H = 1;

// H7 hosted CI runner incident (warehouse ci_runner_health_daily)
const RUNNER_REGIONS = { "us-east": 40, "us-west": 25, "eu-west": 25, "ap-south": 10 };
const RUNNER_INCIDENT_REGION = "us-east";
const RUNNER_INCIDENT_FAIL = 0.6;  // share of would-be successful us-east runs that fail during the incident

// H8 paid channel economics (warehouse paid_marketing_daily)
const PAID_CHANNELS = ["paid_search", "linkedin_ads", "g2_reviews"];
const CPL_USD = { paid_search: 140, linkedin_ads: 420, g2_reviews: 210 }; // cost per Mixpanel signup
const CPL_NOISE = 0.12;            // ± day-level cost variation per channel (seeded)
// share of would-be paid subscriptions that happen, by acquisition channel
const PURCHASE_KEEP = { linkedin_ads: 1.0, outbound_sales: 0.9, referral: 0.8, g2_reviews: 0.7, organic: 0.65, paid_search: 0.5 };

// H9 Team plan price change (warehouse subscription_bookings_daily)
const TEAM_PRICE_OLD = 20;
const TEAM_PRICE_NEW = 25;
const BUSINESS_PRICE = 45;
const TEAM_SEAT_MULT = 0.7;        // seats per new Team subscription after the change
const UPGRADE_CONV = 35;           // new signups, per upgrade-page visit
const UPGRADE_CONV_ESTABLISHED = 6; // long-time free users rarely convert

// H10 time to acknowledge by company size (scales trigger → ack)
const RESPONSE_SIZE_MULT = { enterprise: 0.6, mid_market: 1, smb: 1, startup: 1.5 };
const ACK_MEDIAN_MIN = 22;         // base median trigger → ack, warning severity
const RESOLVE_MEDIAN_MIN = 95;     // base median ack → resolve
const SEVERITY_SPEED = { critical: 0.5, warning: 1, info: 1.6 };

// H11 alert fatigue: the more alerts a user receives, the fewer they acknowledge
const FATIGUE_START = 12;          // ≈ median alerts per alert-receiving user in the window
const FATIGUE_FULL = 30;           // ≈ p85
const FATIGUE_FLIP = 0.5;          // share of would-be acks lost once fully fatigued
const fatigueFlip = (n) => FATIGUE_FLIP * Math.min(1, Math.max(0, (n - FATIGUE_START) / (FATIGUE_FULL - FATIGUE_START)));

// ── DATA ARRAYS (seeded) ──
const COMPANY_COUNT = 300;
const SIZE_WEIGHTS = { startup: 35, smb: 30, mid_market: 22, enterprise: 13 };       // share of companies
const USERS_PER_COMPANY_WEIGHT = { startup: 1, smb: 1.5, mid_market: 2.5, enterprise: 4 };
const EMPLOYEE_BAND = { startup: ["1-10", "11-50"], smb: ["11-50", "51-200"], mid_market: ["201-1000"], enterprise: ["1001-5000", "5000+"] };
const ACV_RANGE = { startup: [0, 6000], smb: [6000, 24000], mid_market: [24000, 90000], enterprise: [90000, 600000] };
const SEAT_RANGE = { startup: [2, 10], smb: [8, 30], mid_market: [25, 120], enterprise: [100, 900] };
const NAME_SUFFIX = ["Systems", "Labs", "Cloud", "Digital", "Networks", "Logistics", "Health", "Financial", "Media", "Retail"];
const INDUSTRIES = ["software", "fintech", "healthcare", "retail", "media", "logistics", "gaming", "manufacturing"];
const CLOUD_WEIGHTS = { aws: 45, gcp: 21, azure: 24, multi_cloud: 10 };

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

const COMPANIES = Array.from({ length: COMPANY_COUNT }, (_, i) => {
	const size = pickWeighted(SIZE_WEIGHTS, chance.floating({ min: 0, max: 1 }));
	const [acvLo, acvHi] = ACV_RANGE[size];
	const [seatLo, seatHi] = SEAT_RANGE[size];
	return {
		id: String(i + 1),
		name: `${chance.word({ syllables: 2, capitalize: true })} ${chance.pickone(NAME_SUFFIX)}`,
		size,
		industry: chance.pickone(INDUSTRIES),
		employees: chance.pickone(EMPLOYEE_BAND[size]),
		cloud: pickWeighted(CLOUD_WEIGHTS, chance.floating({ min: 0, max: 1 })),
		acv: Math.round(chance.integer({ min: acvLo, max: acvHi }) / 100) * 100,
		seats: chance.integer({ min: seatLo, max: seatHi }),
		csm: size === "enterprise" || (size === "mid_market" && chance.bool({ likelihood: 30 })),
	};
});
const COMPANY_CUM = (() => {
	const w = COMPANIES.map((c) => USERS_PER_COMPANY_WEIGHT[c.size]);
	const total = w.reduce((a, b) => a + b, 0);
	let acc = 0;
	return w.map((x) => (acc += x / total));
})();
const companyFor = (uid) => {
	const r = hashFloat(`${uid}|company`);
	const i = COMPANY_CUM.findIndex((c) => r < c);
	return COMPANIES[i < 0 ? COMPANIES.length - 1 : i];
};

const serviceIds = Array.from({ length: 240 }, () => `svc_${chance.hash({ length: 8 })}`);
const runbookIds = Array.from({ length: 60 }, () => `rb_${chance.hash({ length: 6 })}`);
const flagNames = Array.from({ length: 80 }, () => `${chance.word({ syllables: 2 })}_${chance.pickone(["rollout", "killswitch", "beta", "v2", "migration"])}`);

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const T = (e) => dayjs.utc(e.time).valueOf();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const inRunnerIncident = (t) => t >= ms(RUNNER_INCIDENT_START) && t < ms(RUNNER_INCIDENT_END);
const teamPrice = (t) => (t >= ms(TEAM_PRICE_CHANGE) ? TEAM_PRICE_NEW : TEAM_PRICE_OLD);
// seeded log-normal multiplier with median 1 (sigma in log space)
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const co = companyFor(uid);
	profile.company_id = co.id;
	profile.company_name = co.name;
	profile.company_size = co.size;
	profile.industry = co.industry;
	profile.cloud_provider = co.cloud;
	profile.seat_count = co.seats;
	profile.annual_contract_value = co.acv;
	profile.customer_success_manager = co.csm;
	if (meta.userIsBornInDataset) {
		profile.plan_tier = "free";
		profile.customer_since = dayjs.utc(meta.user.created).format("YYYY-MM-DD");
		return profile;
	}
	// established users joined between 2023-01 and the window start
	const tenureDays = Math.floor(salt(uid, "tenure") * (dayIndex(DATASET_START) - dayIndex("2023-01-01T00:00:00Z")));
	profile.customer_since = dayjs.utc("2023-01-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	const mix = {
		startup: [55, 35, 10, 0],
		smb: [35, 40, 22, 3],
		mid_market: [15, 30, 45, 10],
		enterprise: [5, 10, 35, 50],
	}[co.size];
	profile.plan_tier = chance.weighted(["free", "team", "business", "enterprise"], mix);
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;

	// ── company pin: every event carries the user's own company (engine stamps group keys at random) ──
	for (const e of events) e.company_id = profile.company_id;

	// ── purchase hygiene: one paid subscription per user; later upgrade passes vanish ──
	const firstBuy = events.filter((e) => e.event === "subscription started").sort((a, b) => T(a) - T(b))[0];
	if (firstBuy) {
		const t0 = T(firstBuy);
		events = events.filter((e) => {
			if (e === firstBuy) return true;
			if (e.event === "subscription started") return false;
			if (e.event === "upgrade page viewed" && T(e) > t0) return false;
			return true;
		});
	}
	let purchase = firstBuy || null;

	// ── H8: channel quality — only a share of would-be buyers from each channel buy ──
	const keep = PURCHASE_KEEP[profile.acquisition_channel] ?? 1;
	if (purchase && salt(uid, "channel-keep") >= keep) {
		events = events.filter((e) => e !== purchase);
		purchase = null;
	}

	// ── H5: first-week activation, plus organic lapse (new signups only) ──
	if (signup) {
		const actEnd = birthMs + ACTIVATION_DAYS * DAY_MS;
		const early = events.filter((e) => e.event === ACTIVATION_EVENT && T(e) >= birthMs && T(e) < actEnd).length;
		const cuts = [];
		if (early < ACTIVATION_MIN && salt(uid, "dark") < DARK_SHARE) cuts.push(birthMs + DARK_AFTER_DAYS * DAY_MS);
		if (salt(uid, "lapse") < LAPSE_SHARE) cuts.push(birthMs + (LAPSE_DAY_MIN + salt(uid, "lapse-day") * (LAPSE_DAY_MAX - LAPSE_DAY_MIN)) * DAY_MS);
		if (cuts.length) {
			const cut = Math.min(...cuts);
			events = events.filter((e) => T(e) < cut);
			if (purchase && T(purchase) >= cut) purchase = null;
		}
	}

	// ── H9: after the Team price change, Team buyers start with fewer seats ──
	if (purchase && purchase.plan === "team" && T(purchase) >= ms(TEAM_PRICE_CHANGE)) {
		purchase.seats = Math.max(1, Math.round(purchase.seats * TEAM_SEAT_MULT));
	}

	// plan at a moment in time: the starting plan until the user buys, then the purchased plan
	const initialPlan = profile.plan_tier;
	const buyMs = purchase ? T(purchase) : Infinity;
	const planAt = (t) => (t >= buyMs ? purchase.plan : initialPlan);

	// ── incident response timing (H4, H10, H11, H2) ──
	const byAlert = new Map();
	for (const e of events) {
		if (!e.alert_id || !["alert triggered", "alert acknowledged", "alert resolved"].includes(e.event)) continue;
		if (!byAlert.has(e.alert_id)) byAlert.set(e.alert_id, {});
		byAlert.get(e.alert_id)[e.event] = e;
	}
	const alertCount = events.filter((e) => e.event === "alert triggered").length;
	const flip = fatigueFlip(alertCount);
	const integrations = new Set(events.filter((e) => e.event === "integration configured").map((e) => e.integration_type));
	const integrated = INTEGRATION_PAIR.every((x) => integrations.has(x));
	const sizeMult = RESPONSE_SIZE_MULT[profile.company_size] ?? 1;
	const rcaAdopter = salt(uid, "rca-adopter") < RCA_ADOPTER_SHARE;
	const drop = new Set();
	for (const a of byAlert.values()) {
		const trig = a["alert triggered"], ack = a["alert acknowledged"], res = a["alert resolved"];
		if (!trig) {
			if (ack) drop.add(ack);
			if (res) drop.add(res);
			continue;
		}
		if (!ack) {
			if (res) drop.add(res);
			continue;
		}
		// H11: a fatigued user leaves some alerts unacknowledged (and so unresolved)
		if (flip > 0 && chance.bool({ likelihood: flip * 100 })) {
			drop.add(ack);
			if (res) drop.add(res);
			continue;
		}
		// trigger → ack: base log-normal × severity × H10 company size × H4 integrations
		const sev = SEVERITY_SPEED[trig.severity] ?? 1;
		const ackGap = ACK_MEDIAN_MIN * MIN_MS * logNormal(0.7) * sev * sizeMult * (integrated ? INTEGRATED_RESPONSE_MULT : 1);
		const ackT = T(trig) + ackGap;
		ack.time = new Date(ackT).toISOString();
		ack.response_time_mins = round1(ackGap / MIN_MS);
		if (ackT > END) drop.add(ack);
		if (!res) continue;
		// ack → resolve: base log-normal; H2 Root Cause Assist shortens it
		let resGap = RESOLVE_MEDIAN_MIN * MIN_MS * logNormal(0.8) * Math.sqrt(sev);
		// eligibility is checked at the (earlier) assisted resolve time, so every
		// ai_assist row lands after launch on a Business/Enterprise plan
		const resTai = ackT + resGap * RCA_RESOLVE_MULT;
		const eligible = resTai >= ms(RCA_LAUNCH) && RCA_PLANS.includes(planAt(resTai));
		if (eligible && rcaAdopter && chance.bool({ likelihood: RCA_ADOPTER_USE * 100 })) {
			res.resolution_method = "ai_assist";
			resGap *= RCA_RESOLVE_MULT;
		} else if (res.resolution_method === "ai_assist") {
			res.resolution_method = "manual";
		}
		const resT = ackT + resGap;
		res.time = new Date(resT).toISOString();
		res.resolution_time_mins = round1(resGap / MIN_MS);
		if (resT > END) drop.add(res);
	}
	if (drop.size) events = events.filter((e) => !drop.has(e));

	// ── deploy pipeline coherence + H7 runner incident ──
	const deploys = new Map();
	for (const e of events) {
		if (!e.deploy_id || (e.event !== "deployment pipeline run" && e.event !== "service deployed")) continue;
		if (!deploys.has(e.deploy_id)) deploys.set(e.deploy_id, {});
		deploys.get(e.deploy_id)[e.event] = e;
	}
	const dropDeploy = new Set();
	for (const d of deploys.values()) {
		const run = d["deployment pipeline run"], dep = d["service deployed"];
		if (!run) {
			if (dep) dropDeploy.add(dep);
			continue;
		}
		let ok = Boolean(dep);
		if (ok && run.runner_region === RUNNER_INCIDENT_REGION && inRunnerIncident(T(run)) && chance.bool({ likelihood: RUNNER_INCIDENT_FAIL * 100 })) {
			ok = false;
			dropDeploy.add(dep);
		}
		if (ok) {
			run.pipeline_status = "success";
		} else {
			run.pipeline_status = chance.bool({ likelihood: 80 }) ? "failed" : "cancelled";
			run.duration_sec = Math.max(20, Math.round(run.duration_sec * 0.55));
		}
	}
	if (dropDeploy.size) events = events.filter((e) => !dropDeploy.has(e));

	// ── plan at event time (superProp plan_tier) + final profile plan ──
	for (const e of events) e.plan_tier = planAt(T(e));
	if (purchase) profile.plan_tier = purchase.plan;

	return events;
}

// warehouse rows: exogenous business facts layered on the event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "paid_marketing_daily") {
		const ch = row.acquisition_channel;
		const noise = 1 + (hashFloat(`cpl|${row.date}|${ch}`) - 0.5) * 2 * CPL_NOISE;
		row.spend_usd = round2(meta.raw.plus.count * CPL_USD[ch] * noise);
		return row;
	}
	if (meta.metricName === "subscription_bookings_daily") {
		row.new_subscriptions = meta.raw.plus.count;
		return row;
	}
	return row;
}

function handleGroup(record) {
	const co = COMPANIES[Number(record.company_id) - 1];
	if (!co) return record;
	record.name = co.name;
	record.company_size = co.size;
	record.industry = co.industry;
	record.employee_count = co.employees;
	record.cloud_provider = co.cloud;
	record.annual_contract_value = co.acv;
	record.contracted_seats = co.seats;
	record.customer_success_manager = co.csm;
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
	macro: { percentUsersBornInDataset: 45, bornRecentBias: 0, preExistingSpread: "uniform" },
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
	stickyEventProps: ["cloud_provider"],

	scdProps: {
		account_health: {
			values: ["healthy", "healthy", "neutral", "at_risk"],
			frequency: "month",
			timing: "fuzzy",
			max: 4,
		},
	},

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { google: 35, github: 30, email: 20, sso: 15 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "cloud account connected",
			weight: 1,
			isStrictEvent: true,
			properties: {
				regions_connected: [1, 1, 1, 2, 2, 3, 4],
			},
		},
		{
			event: "agent installed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				install_method: ["helm", "helm", "docker", "package", "terraform"],
				hosts_reporting: u.weighNumRange(1, 60, 0.4, 30),
			},
		},
		{
			event: "dashboard created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				template: ["service_overview", "kubernetes", "cost_explorer", "slo_tracker", "blank"],
			},
		},
		{
			event: "dashboard viewed",
			weight: 10,
			isStrictEvent: false,
			properties: {
				dashboard_type: ["service_overview", "service_overview", "kubernetes", "cost_explorer", "slo_tracker", "custom"],
				time_range: ["1h", "6h", "24h", "24h", "7d", "30d"],
			},
		},
		{
			event: "query executed",
			weight: 8,
			isStrictEvent: false,
			properties: {
				query_type: ["metrics", "metrics", "logs", "traces"],
				time_range_hours: [1, 1, 6, 24, 24, 168, 720],
				result_rows: u.weighNumRange(0, 20000, 0.3, 40),
			},
		},
		{
			event: "api call",
			weight: 6,
			properties: {
				endpoint: ["/v1/metrics", "/v1/alerts", "/v1/deploys", "/v1/dashboards", "/v1/costs"],
				method: ["GET", "GET", "GET", "POST", "PUT"],
				status_code: [200, 200, 200, 200, 201, 400, 401, 429, 500],
				latency_ms: u.weighNumRange(20, 2500, 0.3, 40),
			},
		},
		{
			event: "alert triggered",
			weight: 1,
			isStrictEvent: true,
			properties: {
				alert_id: ["unassigned"],
				severity: ["warning"],
				alert_type: ["latency"],
				service_id: serviceIds,
			},
		},
		{
			event: "alert acknowledged",
			weight: 1,
			isStrictEvent: true,
			properties: {
				alert_id: ["unassigned"],
				severity: ["warning"],
				alert_type: ["latency"],
				response_time_mins: [0],
			},
		},
		{
			event: "alert resolved",
			weight: 1,
			isStrictEvent: true,
			properties: {
				alert_id: ["unassigned"],
				severity: ["warning"],
				alert_type: ["latency"],
				resolution_time_mins: [0],
				resolution_method: { __weights: { manual: 75, runbook: 25 } },
				root_cause: ["config_change", "capacity", "bug", "dependency", "network"],
			},
		},
		{
			event: "deployment pipeline run",
			weight: 1,
			isStrictEvent: true,
			properties: {
				deploy_id: ["unassigned"],
				pipeline_status: ["failed"],
				runner_region: ["us-east"],
				duration_sec: u.weighNumRange(90, 1500, 0.6, 40),
				commit_count: u.weighNumRange(1, 25, 0.4, 25),
				service_id: serviceIds,
			},
		},
		{
			event: "service deployed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				deploy_id: ["unassigned"],
				environment: ["production", "production", "staging"],
				service_type: ["web_app", "api", "worker", "database", "ml_model"],
			},
		},
		{
			event: "upgrade page viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				upgrade_trigger: ["usage_limit", "feature_gate", "billing_settings", "seat_limit"],
			},
		},
		{
			event: "subscription started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: ["team"],
				seats: [5],
				billing_cycle: ["monthly", "monthly", "annual"],
			},
		},
		{
			event: "teammate invited",
			weight: 3,
			isStrictEvent: false,
			properties: {
				invitee_role: ["member", "member", "admin", "viewer"],
				invite_method: ["email", "email", "sso", "slack"],
			},
		},
		{
			event: "integration configured",
			weight: 2,
			isStrictEvent: false,
			properties: {
				integration_type: { __weights: { slack: 28, github: 20, jira: 16, pagerduty: 14, terraform: 9, opsgenie: 7, microsoft_teams: 6 } },
			},
		},
		{
			event: "documentation viewed",
			weight: 3,
			isStrictEvent: false,
			properties: {
				doc_section: ["getting_started", "api_reference", "alerting", "integrations", "troubleshooting", "changelog"],
				time_on_page_sec: u.weighNumRange(5, 600, 0.4, 40),
			},
		},
		{
			event: "runbook executed",
			weight: 1,
			isStrictEvent: false,
			properties: {
				runbook_id: runbookIds,
				runbook_trigger: ["manual", "manual", "scheduled"],
				succeeded: [true, true, true, true, false],
			},
		},
		{
			event: "cost report generated",
			weight: 2,
			isStrictEvent: false,
			properties: {
				report_period: ["daily", "weekly", "weekly", "monthly"],
				total_cost_usd: u.weighNumRange(200, 80000, 0.3, 40),
				cost_change_percent: u.weighNumRange(-30, 45, 1, 40),
			},
		},
		{
			event: "infrastructure scaled",
			weight: 2,
			isStrictEvent: false,
			properties: {
				scale_direction: ["up", "up", "up", "down"],
				previous_capacity: u.weighNumRange(1, 100, 0.5, 30),
				auto_scaled: [false, false, false, true],
			},
		},
		{
			event: "security scan",
			weight: 2,
			properties: {
				scan_type: ["vulnerability", "compliance", "access_audit"],
				findings_count: u.weighNumRange(0, 60, 0.3, 30),
				critical_findings: [0, 0, 0, 0, 1, 1, 2, 3],
			},
		},
		{
			event: "feature flag toggled",
			weight: 2,
			properties: {
				flag_name: flagNames,
				new_state: ["enabled", "disabled"],
				environment: ["production", "staging", "dev"],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [SMART_TEST_EXPERIMENT],
				"Variant name": ["Control", SMART_TEST_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "cloud account connected", "agent installed", "dashboard created"],
			isFirstFunnel: true,
			conditions: { cloud_provider: { nin: ["azure"] } },
			conversionRate: ONBOARD_CONV,
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Onboarding",
			sequence: ["account created", "cloud account connected", "agent installed", "dashboard created"],
			isFirstFunnel: true,
			conditions: { cloud_provider: "azure" },
			conversionRate: Math.round(ONBOARD_CONV * AZURE_ONBOARD_MULT),
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Monitoring",
			sequence: ["dashboard viewed", "query executed"],
			conversionRate: 75,
			timeToConvert: 0.25,
			order: "sequential",
			weight: 4,
		},
		{
			name: "Incident Response",
			sequence: ["alert triggered", "alert acknowledged", "alert resolved"],
			conversionRate: 72,
			timeToConvert: 2,
			order: "sequential",
			weight: 4,
			props: {
				alert_id: (ctx) => `alt_${chance.hash({ length: 12 })}`,
				severity: ["info", "warning", "warning", "warning", "critical"],
				alert_type: ["cpu", "memory", "latency", "error_rate", "disk", "saturation"],
			},
		},
		{
			name: "Deploy Pipeline",
			sequence: ["deployment pipeline run", "service deployed"],
			conversionRate: DEPLOY_CONV,
			timeToConvert: DEPLOY_TTC_H,
			order: "sequential",
			weight: 3,
			props: {
				deploy_id: (ctx) => `dep_${chance.hash({ length: 12 })}`,
				runner_region: Object.entries(RUNNER_REGIONS).flatMap(([r, w]) => Array(w / 5).fill(r)),
			},
			experiment: {
				name: SMART_TEST_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) / 1000 - ms(SMART_TEST_START) / 1000) / 86400,
				variants: [
					{ name: "Control" },
					{ name: SMART_TEST_VARIANT, conversionMultiplier: SMART_TEST_CONV_MULT, ttcMultiplier: SMART_TEST_TTC_MULT },
				],
			},
		},
		{
			name: "Upgrade",
			sequence: ["upgrade page viewed", "subscription started"],
			conditions: { plan_tier: "free", customer_since: { gte: D0 } },
			conversionRate: UPGRADE_CONV,
			timeToConvert: 24,
			order: "sequential",
			weight: 2,
			props: {
				plan: ["team", "team", "business"],
				seats: u.weighNumRange(3, 25, 1, 40),
			},
		},
		{
			name: "Upgrade",
			sequence: ["upgrade page viewed", "subscription started"],
			conditions: { plan_tier: "free", customer_since: { lt: D0 } },
			conversionRate: UPGRADE_CONV_ESTABLISHED,
			timeToConvert: 24,
			order: "sequential",
			weight: 2,
			props: {
				plan: ["team", "team", "business"],
				seats: u.weighNumRange(3, 25, 1, 40),
			},
		},
		{
			name: "Cost Review",
			sequence: ["cost report generated", "infrastructure scaled"],
			conversionRate: 45,
			timeToConvert: 6,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Runbooks",
			sequence: ["documentation viewed", "runbook executed"],
			conversionRate: 35,
			timeToConvert: 2,
			order: "sequential",
			weight: 1,
		},
	],

	warehouseMetrics: [
		{
			name: "paid_marketing_daily",
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
				// ad platforms claim more leads than product analytics records signups
				platform_reported_leads: (ctx) => Math.round(ctx.value * (1.1 + 0.15 * hashFloat(`lead|${dayKey(ctx.time)}|${ctx.seriesKey}`))),
				clicks: (ctx) => Math.round(ctx.value / ((ctx.seriesKey === "linkedin_ads" ? 0.035 : 0.06) * (0.85 + 0.3 * hashFloat(`cvr|${dayKey(ctx.time)}|${ctx.seriesKey}`)))),
				impressions: (ctx) => Math.round(ctx.row.clicks / ((ctx.seriesKey === "linkedin_ads" ? 0.006 : 0.025) * (0.85 + 0.3 * hashFloat(`ctr|${dayKey(ctx.time)}|${ctx.seriesKey}`)))),
			},
		},
		{
			name: "ci_runner_health_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "deployment pipeline run",
				measure: "count",
				groupBy: "runner_region",
			},
			timeColumn: "date",
			valueColumn: "jobs_started",
			columns: {
				infra_error_rate: (ctx) => {
					const hit = ctx.row.runner_region === RUNNER_INCIDENT_REGION && inRunnerIncident(ctx.time);
					const j = hashFloat(`err|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? round2(RUNNER_INCIDENT_FAIL + (j - 0.5) * 0.04) : Math.round((0.002 + j * 0.008) * 10000) / 10000;
				},
				queue_p95_seconds: (ctx) => {
					const hit = ctx.row.runner_region === RUNNER_INCIDENT_REGION && inRunnerIncident(ctx.time);
					const j = hashFloat(`q|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? Math.round(1500 + j * 900) : Math.round(25 + j * 40);
				},
				runner_status: (ctx) => (ctx.row.runner_region === RUNNER_INCIDENT_REGION && inRunnerIncident(ctx.time) ? "major_outage" : "operational"),
				runner_capacity_vcpu: (ctx) => ({ "us-east": 640, "us-west": 384, "eu-west": 384, "ap-south": 160 }[ctx.row.runner_region] || 160),
			},
		},
		{
			name: "subscription_bookings_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "subscription started",
				measure: "sum",
				property: "seats",
				groupBy: "plan",
			},
			timeColumn: "date",
			valueColumn: "new_seats",
			columns: {
				new_subscriptions: 0,
				list_price_per_seat_usd: (ctx) => (ctx.row.plan === "business" ? BUSINESS_PRICE : teamPrice(ctx.time)),
				new_mrr_usd: (ctx) => round2(ctx.value * ctx.row.list_price_per_seat_usd),
				new_arr_usd: (ctx) => round2(ctx.value * ctx.row.list_price_per_seat_usd * 12),
			},
		},
	],

	superProps: {
		plan_tier: ["free"],
		cloud_provider: ["aws"],
	},

	userProps: {
		company_id: ["1"],
		company_name: ["unknown"],
		company_size: ["smb"],
		industry: ["software"],
		primary_role: ["developer"],
		plan_tier: ["free"],
		customer_since: ["2025-01-01"],
		cloud_provider: ["aws"],
		acquisition_channel: { __weights: { organic: 25, paid_search: 22, linkedin_ads: 20, g2_reviews: 10, referral: 13, outbound_sales: 10 } },
		seat_count: [1],
		annual_contract_value: [0],
		customer_success_manager: [false],
	},

	personas: [
		{ name: "sre_oncall", weight: 20, eventMultiplier: 2.2, properties: { primary_role: "sre" } },
		{ name: "platform_engineer", weight: 35, eventMultiplier: 1.3, properties: { primary_role: "platform_engineer" } },
		{ name: "app_developer", weight: 30, eventMultiplier: 0.8, properties: { primary_role: "developer" } },
		{ name: "eng_manager", weight: 15, eventMultiplier: 0.5, properties: { primary_role: "engineering_manager" } },
	],

	groupKeys: [["company_id", COMPANY_COUNT, []]],
	groupProps: {
		company_id: {
			name: ["unknown"],
			company_size: ["smb"],
			industry: ["software"],
			employee_count: ["11-50"],
			cloud_provider: ["aws"],
			annual_contract_value: [0],
			contracted_seats: [1],
			customer_success_manager: [false],
		},
	},

	worldEvents: [
		{
			name: "q3_quarter_close_seat_promo",
			type: "campaign",
			startDay: dayIndex(QUARTER_CLOSE_START),
			duration: QUARTER_CLOSE_DAYS,
			affectsEvents: ["teammate invited"],
			volumeMultiplier: QUARTER_CLOSE_INVITE_MULT,
		},
	],

	// retention shape (also pins each new user's signup to their creation day)
	retentionCurve: { type: "logarithmic", day1: 0.75, day7: 0.6, day30: 0.5 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		if (type === "group") return handleGroup(record);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H11. Evaluate with:
//   node dungeons/vertical/sass/sass.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user who appears with it on any
// event carrying both ids (emitted stitch evidence, not the profile pool).
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const D = (iso) => iso.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const ONBOARDING_STEPS = ["account created", "cloud account connected", "agent installed", "dashboard created"];
const EXP_KEY = `Experiment: ${SMART_TEST_EXPERIMENT}`;
const QC_BASE_FROM = TS(dayjs.utc(QUARTER_CLOSE_START).subtract(QUARTER_CLOSE_DAYS, "day"));
const QC_END = TS(dayjs.utc(QUARTER_CLOSE_START).add(QUARTER_CLOSE_DAYS, "day"));
const INC_BASE_FROM = TS(dayjs.utc(RUNNER_INCIDENT_START).subtract(7, "day"));
const INC_BASE_TO = TS(dayjs.utc(RUNNER_INCIDENT_END).add(7, "day"));
const RETENTION_DAY = 30;
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");

/** step_counts conversion for a set of segments from a timeToConvert breakdown. */
const convOf = (rows, segs) => {
	const rs = (rows || []).filter((x) => segs.includes(x.segment_value) && Array.isArray(x.step_counts) && x.step_counts[0]);
	if (!rs.length) return null;
	const entered = rs.reduce((a, r) => a + r.step_counts[0], 0);
	const converted = rs.reduce((a, r) => a + r.step_counts[r.step_counts.length - 1], 0);
	return { entered, converted, rate: converted / entered };
};

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-quarter-close-seat-push",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `The Q3 quarter-close seat promotion (${D(QUARTER_CLOSE_START)} for ${QUARTER_CLOSE_DAYS} days, through Sep 30) is a world event that multiplies teammate invitations by ${QUARTER_CLOSE_INVITE_MULT}. Dashboard views are untouched, so invites per dashboard view during the promotion vs the ${QUARTER_CLOSE_DAYS} days before reads the multiplier while cancelling weekday mix and the overall trend.`,
		mixpanelReport: { type: "Insights", events: ["teammate invited", "dashboard viewed"], measure: "total", chart: "daily line, formula A/B" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (t >= TIMESTAMP '${TS(QUARTER_CLOSE_START)}') AS promo, event, uid FROM ev
  WHERE event IN ('teammate invited', 'dashboard viewed') AND t >= TIMESTAMP '${QC_BASE_FROM}' AND t < TIMESTAMP '${QC_END}'),
g AS (SELECT promo, count(*) FILTER (WHERE event = 'teammate invited')::DOUBLE / count(*) FILTER (WHERE event = 'dashboard viewed') AS r, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count, max(r) FILTER (WHERE promo) / max(r) FILTER (WHERE NOT promo) AS did FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(QUARTER_CLOSE_INVITE_MULT) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H2-root-cause-assist-launch",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `Root Cause Assist launches ${D(RCA_LAUNCH)} for Business and Enterprise plans. ${RCA_ADOPTER_SHARE * 100}% of eligible users adopt it and use it on ${RCA_ADOPTER_USE * 100}% of their resolutions, so ${RCA_ADOPTION * 100}% of eligible post-launch resolutions carry resolution_method = 'ai_assist'; those take ${RCA_RESOLVE_MULT}x as long from acknowledgement to resolution. Free and Team plans and every pre-launch resolution never use it, so purity is exact. plan_tier on each event is the plan at that moment; the acknowledgement step is untouched.`,
		mixpanelReport: { type: "Insights", event: "alert resolved", measure: "average resolution_time_mins", breakdown: "resolution_method", filter: "plan_tier in (business, enterprise), after launch" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE resolution_method = 'ai_assist' AND (t < TIMESTAMP '${TS(RCA_LAUNCH)}' OR plan_tier NOT IN (${SQL_LIST(RCA_PLANS)}))) AS impure_rows
FROM ev WHERE event = 'alert resolved'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: an ai_assist row before launch or on a Free/Team event is a bug
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN resolution_method = 'ai_assist' THEN 'ai' ELSE 'other' END AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(resolution_time_mins) AS avg_res
FROM ev WHERE event = 'alert resolved' AND t >= TIMESTAMP '${TS(RCA_LAUNCH)}' AND plan_tier IN (${SQL_LIST(RCA_PLANS)}) GROUP BY 1`,
				},
				select: { a: { where: { grp: "ai" } }, o: { where: { grp: "other" } } },
				expect: { metric: "a.avg_res / o.avg_res", op: "between", target: band(RCA_RESOLVE_MULT) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'eligible' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE resolution_method = 'ai_assist')::DOUBLE / count(*) AS ai_share
FROM ev WHERE event = 'alert resolved' AND t >= TIMESTAMP '${TS(RCA_LAUNCH)}' AND plan_tier IN (${SQL_LIST(RCA_PLANS)})`,
				},
				select: { e: { where: { grp: "eligible" } } },
				expect: { metric: "e.ai_share", op: "between", target: band(RCA_ADOPTION) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H3-azure-onboarding-friction",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `New accounts whose company runs on Azure finish onboarding (account created → cloud account connected → agent installed → dashboard created) at ${AZURE_ONBOARD_MULT}x the rate of AWS, GCP, and multi-cloud accounts (${Math.round(ONBOARD_CONV * AZURE_ONBOARD_MULT)}% vs ${ONBOARD_CONV}%). Two declared first funnels with cloud_provider conditions; every step is an onboarding-only event, so the unique-user funnel reads the knobs directly.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARDING_STEPS, breakdown: "user property cloud_provider", window: "7 days" },
		assertions: [
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: "cloud_provider", conversionWindowMs: 7 * DAY_MS },
				// custom assert: conversion lives in the step_counts ARRAY of each
				// segment row and the control pools three segments; the expect
				// grammar cannot index arrays or sum across value-like rows
				assert: (rows) => {
					const az = convOf(rows, ["azure"]), rest = convOf(rows, ["aws", "gcp", "multi_cloud"]);
					if (!az || !rest) return { verdict: "NONE", detail: "missing segment rows" };
					if (az.entered < 400 || rest.entered < 1500) return { verdict: "WEAK", detail: `small segments ${az.entered}/${rest.entered}` };
					const ratio = az.rate / rest.rate;
					const [lo, hi] = band(Math.round(ONBOARD_CONV * AZURE_ONBOARD_MULT) / ONBOARD_CONV);
					const detail = `onboarding conversion azure ${az.converted}/${az.entered}=${az.rate.toFixed(4)} vs others ${rest.converted}/${rest.entered}=${rest.rate.toFixed(4)}; ratio ${ratio.toFixed(4)} (knob ${AZURE_ONBOARD_MULT}, band [${lo}, ${hi}])`;
					if (ratio >= lo && ratio <= hi) return { verdict: "NAILED", detail };
					return { verdict: ratio < 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H4-slack-pagerduty-response",
		hook: "H4",
		archetype: "cohort-prop-scale",
		narrative: `Users who have configured both the Slack and PagerDuty integrations acknowledge alerts in ${INTEGRATED_RESPONSE_MULT}x the time of everyone else: the page reaches the on-call engineer where they already are. Only trigger → acknowledge is affected; acknowledge → resolve is not. response_time_mins on "alert acknowledged" is the real gap between the trigger and the acknowledgement. Company size, severity, and alert fatigue are independent of the integration cohort, so the ratio of averages reads the knob.`,
		mixpanelReport: { type: "Insights", event: "alert acknowledged", measure: "average response_time_mins", breakdown: "cohort: configured slack AND pagerduty" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
i AS (SELECT uid, bool_or(integration_type = 'slack') AND bool_or(integration_type = 'pagerduty') AS both_integ FROM ev WHERE event = 'integration configured' GROUP BY 1)
SELECT CASE WHEN coalesce(i.both_integ, false) THEN 'integrated' ELSE 'rest' END AS grp, count(DISTINCT ev.uid) AS user_count,
 avg(response_time_mins) AS avg_resp
FROM ev LEFT JOIN i ON i.uid = ev.uid WHERE ev.event = 'alert acknowledged' GROUP BY 1`,
				},
				select: { i: { where: { grp: "integrated" } }, r: { where: { grp: "rest" } } },
				expect: { metric: "i.avg_resp / r.avg_resp", op: "between", target: band(INTEGRATED_RESPONSE_MULT) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H5-first-week-team-activation",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `New users who invite fewer than ${ACTIVATION_MIN} teammates in their first ${ACTIVATION_DAYS} days are at risk: ${DARK_SHARE * 100}% of them go dark after day ${DARK_AFTER_DAYS}. Classification uses first-week activity only. Every new user also faces organic lapse (${LAPSE_SHARE * 100}% stop on a uniform day ${LAPSE_DAY_MIN}-${LAPSE_DAY_MAX}), independent of the split. Day-${RETENTION_DAY} retention (any event in days ${RETENTION_DAY}-${RETENTION_DAY + 6} after signup, signups at least ${RETENTION_DAY + 7} days before the window end) is at least 1/(1−${DARK_SHARE}) = ${1 / (1 - DARK_SHARE)}x higher for activated users; organic selection (busier people invite more and also stay active) can only push it higher, so the knob is a floor.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: "any event", breakdown: `cohort: ≥${ACTIVATION_MIN} teammate invited in first ${ACTIVATION_DAYS} days` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL ${RETENTION_DAY + 7} DAY),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = '${ACTIVATION_EVENT}' AND e.t < s.t0 + INTERVAL ${ACTIVATION_DAYS} DAY) AS early,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY AND e.t < s.t0 + INTERVAL ${RETENTION_DAY + 7} DAY) AS ret
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN early >= ${ACTIVATION_MIN} THEN 'activated' ELSE 'not_activated' END AS grp, count(*) AS user_count,
 avg((ret > 0)::INT) AS retention
FROM f GROUP BY 1`,
				},
				select: { a: { where: { grp: "activated" } }, n: { where: { grp: "not_activated" } } },
				expect: { metric: "a.retention / n.retention", op: ">=", target: 1 / (1 - DARK_SHARE), floor: 0.9 / (1 - DARK_SHARE) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H6-smart-test-selection-experiment",
		hook: "H6",
		archetype: "experiment-lift",
		narrative: `The "${SMART_TEST_EXPERIMENT}" pipeline test starts ${D(SMART_TEST_START)} and splits users 50/50 (sticky hash). "${SMART_TEST_VARIANT}" multiplies the share of pipeline runs that reach "service deployed" by ${SMART_TEST_CONV_MULT} and the run-to-deploy time by ${SMART_TEST_TTC_MULT}. Every run and its deploy share a deploy_id, so a totals funnel holding deploy_id constant measures per-run success; pipeline_status agrees with it (success exactly when the deploy happened). The runner incident (H7) hits both arms alike.`,
		mixpanelReport: { type: "Funnels", steps: ["deployment pipeline run", "service deployed"], counting: "totals", holdPropertyConstant: "deploy_id", breakdown: `user property "${EXP_KEY}"`, window: "1 day" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
r AS (SELECT uid, deploy_id, t AS t0 FROM ev WHERE event = 'deployment pipeline run' AND t >= TIMESTAMP '${TS(SMART_TEST_START)}'),
d AS (SELECT deploy_id, min(t) AS t1 FROM ev WHERE event = 'service deployed' GROUP BY 1),
x AS (SELECT v.variant, r.uid, (d.t1 IS NOT NULL AND d.t1 >= r.t0 AND d.t1 < r.t0 + INTERVAL 1 DAY) AS ok,
  CASE WHEN d.t1 >= r.t0 AND d.t1 < r.t0 + INTERVAL 1 DAY THEN date_diff('second', r.t0, d.t1) END AS ttc_s
  FROM r JOIN v ON v.uid = r.uid LEFT JOIN d ON d.deploy_id = r.deploy_id)
SELECT variant AS grp, count(DISTINCT uid) AS user_count, count(*) AS runs, avg(ok::INT) AS conv, median(ttc_s) AS med_ttc
FROM x GROUP BY 1`,
				},
				select: { s: { where: { grp: SMART_TEST_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "s.conv / c.conv", op: "between", target: band(SMART_TEST_CONV_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
r AS (SELECT uid, deploy_id, t AS t0 FROM ev WHERE event = 'deployment pipeline run' AND t >= TIMESTAMP '${TS(SMART_TEST_START)}'),
d AS (SELECT deploy_id, min(t) AS t1 FROM ev WHERE event = 'service deployed' GROUP BY 1),
x AS (SELECT v.variant, r.uid, CASE WHEN d.t1 >= r.t0 AND d.t1 < r.t0 + INTERVAL 1 DAY THEN date_diff('second', r.t0, d.t1) END AS ttc_s
  FROM r JOIN v ON v.uid = r.uid LEFT JOIN d ON d.deploy_id = r.deploy_id)
SELECT variant AS grp, count(DISTINCT uid) AS user_count, median(ttc_s) AS med_ttc FROM x GROUP BY 1`,
				},
				select: { s: { where: { grp: SMART_TEST_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "s.med_ttc / c.med_ttc", op: "between", target: band(SMART_TEST_TTC_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${SMART_TEST_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
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
		id: "H7-ci-runner-incident",
		hook: "H7",
		archetype: "bespoke",
		narrative: `Tallyboard's hosted CI runners in ${RUNNER_INCIDENT_REGION} degrade from ${D(RUNNER_INCIDENT_START)} to ${D(RUNNER_INCIDENT_END)} (exclusive): ${RUNNER_INCIDENT_FAIL * 100}% of pipeline runs that would have succeeded there fail, and their deploys never happen. The incident days and region come from the warehouse table ci_runner_health_daily (runner_status = 'major_outage'); the event-side read is a ratio of ratios (affected-region success rate / other regions, incident days vs the 7 days either side), which reads the 1 − ${RUNNER_INCIDENT_FAIL} keep rate while cancelling the experiment mix and weekday volume.`,
		mixpanelReport: { type: "Insights", event: "deployment pipeline run", measure: "share with pipeline_status = success", breakdown: "runner_region", chart: "daily line", join: "warehouse ci_runner_health_daily.runner_status" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, runner_region FROM ${WH("ci_runner_health_daily")} WHERE runner_status = 'major_outage'),
od AS (SELECT DISTINCT d FROM o), orr AS (SELECT DISTINCT runner_region FROM o),
w AS (SELECT t::DATE AS d, uid, (runner_region IN (SELECT runner_region FROM orr)) AS hit, (pipeline_status = 'success') AS ok
  FROM ev WHERE event = 'deployment pipeline run' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, avg(ok::INT) FILTER (WHERE hit) / avg(ok::INT) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - RUNNER_INCIDENT_FAIL) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE runner_status = 'major_outage') AS outage_rows,
 avg(infra_error_rate) FILTER (WHERE runner_status = 'major_outage') AS outage_err,
 count(*) FILTER (WHERE runner_status = 'major_outage' AND (date::DATE < DATE '${D(RUNNER_INCIDENT_START)}' OR date::DATE >= DATE '${D(RUNNER_INCIDENT_END)}' OR runner_region <> '${RUNNER_INCIDENT_REGION}')) AS misplaced
FROM ${WH("ci_runner_health_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse infra error rate during the incident = the failure knob
				expect: { metric: "a.outage_err", op: "between", target: band(RUNNER_INCIDENT_FAIL) },
			},
		],
	},
	{
		id: "H8-paid-channel-economics",
		hook: "H8",
		archetype: "attribution-bias",
		narrative: `LinkedIn Ads signups cost ${CPL_USD.linkedin_ads / CPL_USD.paid_search}x as much as paid search signups (warehouse paid_marketing_daily bills spend = Mixpanel signups × cost per signup × seeded ±${CPL_NOISE * 100}% day noise: $${CPL_USD.linkedin_ads} vs $${CPL_USD.paid_search}), but they buy a paid plan ${PURCHASE_KEEP.linkedin_ads / PURCHASE_KEEP.paid_search}x as often (share of would-be purchases kept: ${PURCHASE_KEEP.linkedin_ads} vs ${PURCHASE_KEEP.paid_search}; channel is drawn independently of company size and persona). Spend per signup needs the warehouse join; the purchase-rate read compares signups from the same weeks so later signups' shorter time to buy cancels. Paid-subscription counts per channel are a few hundred, so the purchase-rate ratio uses the knob as target with a knob-derived floor.`,
		mixpanelReport: { type: "Insights + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_marketing_daily.spend_usd", funnel: "account created → subscription started by acquisition_channel" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT acquisition_channel AS ch, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_marketing_daily")} GROUP BY 1)
SELECT s.ch AS grp, s.users AS user_count, sp.spend / s.signups AS spend_per_signup FROM s JOIN sp ON sp.ch = s.ch`,
				},
				select: { l: { where: { grp: "linkedin_ads" } }, p: { where: { grp: "paid_search" } } },
				expect: { metric: "l.spend_per_signup / p.spend_per_signup", op: "between", target: band(CPL_USD.linkedin_ads / CPL_USD.paid_search) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, date_trunc('week', t) AS wk, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'subscription started'),
w AS (SELECT wk,
  count(*) FILTER (WHERE ch = 'linkedin_ads') AS ln, count(b.uid) FILTER (WHERE ch = 'linkedin_ads') AS lb,
  count(*) FILTER (WHERE ch = 'paid_search') AS pn, count(b.uid) FILTER (WHERE ch = 'paid_search') AS pb
  FROM s LEFT JOIN b ON b.uid = s.uid GROUP BY 1)
SELECT 'all' AS grp, LEAST(sum(ln), sum(pn))::BIGINT AS user_count,
 sum(lb)::DOUBLE / sum(ln * pb::DOUBLE / nullif(pn, 0)) AS std_ratio
FROM w WHERE pn > 0`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.std_ratio", op: ">=", target: PURCHASE_KEEP.linkedin_ads / PURCHASE_KEEP.paid_search, floor: 1 + 0.5 * (PURCHASE_KEEP.linkedin_ads / PURCHASE_KEEP.paid_search - 1) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H9-team-price-change",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative: `On ${D(TEAM_PRICE_CHANGE)} the Team plan list price rises from $${TEAM_PRICE_OLD} to $${TEAM_PRICE_NEW} per seat per month; Business stays $${BUSINESS_PRICE}. The number of new Team subscriptions does not change, but Team buyers start with ${TEAM_SEAT_MULT}x as many seats. Business is the control (seats per new subscription unchanged). Prices exist only in the warehouse table subscription_bookings_daily, so new MRR per Team subscription needs the join: ${TEAM_SEAT_MULT} × ${TEAM_PRICE_NEW}/${TEAM_PRICE_OLD} = ${(TEAM_SEAT_MULT * TEAM_PRICE_NEW / TEAM_PRICE_OLD).toFixed(3)} of before.`,
		mixpanelReport: { type: "Insights", event: "subscription started", measure: "average seats", breakdown: "plan", chart: "weekly line", join: "subscription_bookings_daily.list_price_per_seat_usd" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT plan || CASE WHEN t >= TIMESTAMP '${TS(TEAM_PRICE_CHANGE)}' THEN '_post' ELSE '_pre' END AS grp, count(DISTINCT uid) AS user_count, avg(seats) AS avg_seats
FROM ev WHERE event = 'subscription started' GROUP BY 1`,
				},
				select: { a: { where: { grp: "team_post" } }, b: { where: { grp: "team_pre" } } },
				expect: { metric: "a.avg_seats / b.avg_seats", op: "between", target: band(TEAM_SEAT_MULT) },
				minCohort: 150,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT plan || CASE WHEN t >= TIMESTAMP '${TS(TEAM_PRICE_CHANGE)}' THEN '_post' ELSE '_pre' END AS grp, count(DISTINCT uid) AS user_count, avg(seats) AS avg_seats
FROM ev WHERE event = 'subscription started' GROUP BY 1`,
				},
				select: { a: { where: { grp: "business_post" } }, b: { where: { grp: "business_pre" } } },
				// control: Business seats per new subscription unchanged
				expect: { metric: "a.avg_seats / b.avg_seats", op: "between", target: band(1) },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT uid, t::DATE AS d, plan, seats FROM ev WHERE event = 'subscription started' AND plan = 'team'),
j AS (SELECT p.*, p.seats * b.list_price_per_seat_usd AS mrr FROM p JOIN ${WH("subscription_bookings_daily")} b ON b.date::DATE = p.d AND b.plan = p.plan)
SELECT CASE WHEN d >= DATE '${D(TEAM_PRICE_CHANGE)}' THEN 'post' ELSE 'pre' END AS grp, count(DISTINCT uid) AS user_count, avg(mrr) AS mrr_per_sub
FROM j GROUP BY 1`,
				},
				select: { a: { where: { grp: "post" } }, b: { where: { grp: "pre" } } },
				expect: { metric: "a.mrr_per_sub / b.mrr_per_sub", op: "between", target: band(Math.round(TEAM_SEAT_MULT * TEAM_PRICE_NEW / TEAM_PRICE_OLD * 1000) / 1000) },
				minCohort: 150,
			},
		],
	},
	{
		id: "H10-response-time-by-company-size",
		hook: "H10",
		archetype: "funnel-ttc-by-segment",
		narrative: `Time from "alert triggered" to "alert acknowledged" scales with company size: enterprise ${RESPONSE_SIZE_MULT.enterprise}x, startup ${RESPONSE_SIZE_MULT.startup}x the SMB and mid-market time (dedicated on-call rotations vs part-time ownership). Every alert's three events share an alert_id, so a funnel holding alert_id constant measures each alert on its own; integrations (H4) and severity are independent of company size, so the median ratio reads the knob.`,
		mixpanelReport: { type: "Funnels", steps: ["alert triggered", "alert acknowledged"], measure: "median time to convert", holdPropertyConstant: "alert_id", breakdown: "user property company_size" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
a AS (SELECT alert_id, any_value(uid) AS uid, min(t) FILTER (WHERE event = 'alert triggered') AS t0, min(t) FILTER (WHERE event = 'alert acknowledged') AS t1
  FROM ev WHERE event IN ('alert triggered', 'alert acknowledged') GROUP BY 1),
x AS (SELECT u.company_size AS seg, a.uid, date_diff('millisecond', a.t0, a.t1) AS ttc FROM a JOIN ${US} u ON u.distinct_id::VARCHAR = a.uid WHERE a.t1 >= a.t0)
SELECT seg AS grp, count(DISTINCT uid) AS user_count, median(ttc) AS med_ttc FROM x GROUP BY 1
UNION ALL
SELECT 'smb_mid' AS grp, count(DISTINCT uid) AS user_count, median(ttc) AS med_ttc FROM x WHERE seg IN ('smb', 'mid_market')`,
				},
				select: { e: { where: { grp: "enterprise" } }, b: { where: { grp: "smb_mid" } } },
				expect: { metric: "e.med_ttc / b.med_ttc", op: "between", target: band(RESPONSE_SIZE_MULT.enterprise) },
				minCohort: 800,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
a AS (SELECT alert_id, any_value(uid) AS uid, min(t) FILTER (WHERE event = 'alert triggered') AS t0, min(t) FILTER (WHERE event = 'alert acknowledged') AS t1
  FROM ev WHERE event IN ('alert triggered', 'alert acknowledged') GROUP BY 1),
x AS (SELECT u.company_size AS seg, a.uid, date_diff('millisecond', a.t0, a.t1) AS ttc FROM a JOIN ${US} u ON u.distinct_id::VARCHAR = a.uid WHERE a.t1 >= a.t0)
SELECT seg AS grp, count(DISTINCT uid) AS user_count, median(ttc) AS med_ttc FROM x GROUP BY 1
UNION ALL
SELECT 'smb_mid' AS grp, count(DISTINCT uid) AS user_count, median(ttc) AS med_ttc FROM x WHERE seg IN ('smb', 'mid_market')`,
				},
				select: { s: { where: { grp: "startup" } }, b: { where: { grp: "smb_mid" } } },
				expect: { metric: "s.med_ttc / b.med_ttc", op: "between", target: band(RESPONSE_SIZE_MULT.startup) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H11-alert-fatigue",
		hook: "H11",
		archetype: "frequency-sweet-spot",
		narrative: `Alert fatigue: the more alerts a user receives in the window, the larger the share they never acknowledge. Up to ${FATIGUE_START} alerts nothing changes; from there the share of would-be acknowledgements lost ramps linearly to ${FATIGUE_FLIP * 100}% at ${FATIGUE_FULL}+ alerts (no cliff). The ramp is applied to the user's final alert count, so per-alert acknowledgement rate for users with ${FATIGUE_FULL}+ alerts vs users with at most ${FATIGUE_START} reads 1 − ${FATIGUE_FLIP}.`,
		mixpanelReport: { type: "Funnels", steps: ["alert triggered", "alert acknowledged"], counting: "totals", holdPropertyConstant: "alert_id", breakdown: "cohort: count of alert triggered in window (bins)" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
n AS (SELECT uid, count(*) FILTER (WHERE event = 'alert triggered') AS alerts, count(*) FILTER (WHERE event = 'alert acknowledged') AS acks
  FROM ev WHERE event IN ('alert triggered', 'alert acknowledged') GROUP BY 1 HAVING count(*) FILTER (WHERE event = 'alert triggered') > 0)
SELECT CASE WHEN alerts >= ${FATIGUE_FULL} THEN 'heavy' WHEN alerts <= ${FATIGUE_START} THEN 'light' ELSE 'middle' END AS grp, count(*) AS user_count,
 sum(acks)::DOUBLE / sum(alerts) AS ack_rate
FROM n GROUP BY 1`,
				},
				select: { h: { where: { grp: "heavy" } }, l: { where: { grp: "light" } } },
				expect: { metric: "h.ack_rate / l.ack_rate", op: "between", target: band(1 - FATIGUE_FLIP) },
				minCohort: 500,
			},
		],
	},
];

export default config;

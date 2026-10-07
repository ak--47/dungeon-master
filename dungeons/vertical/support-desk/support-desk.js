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
 * NAME:       Ticketloop
 * APP:        B2B help desk for small and mid-size support teams (web app):
 *             tickets arrive by email, chat, web form, or API and are routed
 *             to an agent; agents reply, escalate, and resolve; the customer
 *             may reopen the ticket or answer a CSAT survey. Agents save
 *             macros (canned replies), search and read the knowledge base, and
 *             watch queue and report views. Plans: Free (one agent), Starter
 *             ($19 per agent per month), Growth ($39 → $49 for new
 *             subscriptions from 2026-08-18), Enterprise ($89, sales-led). New
 *             workspaces start a 14-day trial. Reply Assist (AI reply drafts)
 *             launches 2026-07-21 for Growth and Enterprise.
 * SCALE:      10,000 users (≈4,510 trial signups inside the window), ~0.84M
 *             events, 120 days (2026-06-04 → 2026-10-01, UTC); 374 customer
 *             companies with several agents (2-60 each, ≈4,590 users) plus
 *             single-agent workspaces: Free (≈590 before the window), trials
 *             in flight on June 4 (≈300), and one new workspace per trial signup.
 *             Tickets per agent are far below a full workload: the guides say
 *             most customer teams route only part of their volume (one brand
 *             or queue) through Ticketloop while they migrate (owner decision
 *             forced by the fixed 1.2 events/user/day scale)
 * CORE LOOP:  ticket assigned → reply sent → ticket resolved (→ csat received)
 * VALUE MOMENT: ticket resolved
 *
 * EVENTS (22):
 *   queue viewed > search performed > kb article viewed > internal note added
 *   > customer profile viewed > report viewed > macro created > kb article
 *   published > automation rule created > integration connected > widget
 *   installed (kept once per new workspace) > funnel-only: account created,
 *   inbox connected, ticket assigned, reply sent, ticket escalated, ticket
 *   resolved, ticket reopened, csat received, pricing page viewed,
 *   subscription started, $experiment_started
 *
 * FUNNELS (3 declared, 4 entries):
 *   - Onboarding (first funnel, two copies by email_provider, H3):
 *       account created → inbox connected (86%; Microsoft 365 47%); the hook
 *       adds widget installed for 80% of connectors a few hours later
 *   - Ticket (weight 3): ticket assigned → reply sent → ticket escalated → reply
 *       sent → ticket resolved → ticket reopened → csat received. Engine 100%;
 *       the everything hook rebuilds every ticket from its arrival (see below).
 *       Carries the Skills Routing experiment (multipliers 1.0; the hook sets
 *       the arm per customer account and applies the effect).
 *   - Trial purchase (plan_tier = trial, weight 1): pricing page viewed →
 *       subscription started (templates; the hook decides the one purchase)
 *
 * USER PROPS:  company_id, company_name, company_size, industry, region,
 *              role, plan_tier (current company plan), email_provider,
 *              acquisition_channel (the workspace's), customer_since,
 *              agent_seats, "Experiment: Skills Routing" (exposed users)
 * SUPER PROPS: plan_tier (company plan at event time)
 * SCD PROPS:   none
 * GROUPS:      company_id (every event carries the user's own company; group
 *              profile: name, size, industry, region, plan, seats, email
 *              provider, customer since, acquisition channel; ids without
 *              users emit no profile)
 * WAREHOUSE:   paid_marketing_daily (spend by paid channel),
 *              inbound_channel_daily (ticket ingestion health by channel),
 *              subscription_billing_daily (new subscriptions, seats, list
 *              price, new MRR by plan)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        weekday-heavy dayOfWeekWeights; Americas + EMEA working hours (UTC)
 *
 * IDENTITY: a trial signup is identified at "account created" (isAuthEvent,
 * first event, user_id + device_id); 1.6 browser devices per user on average.
 * Every event carries user_id; there is no anonymous pre-signup activity.
 * inbox connected (post-auth onboarding step, sent by the mail integration
 * service) carries user_id only, and so do the server-side events (ticket
 * assigned, ticket reopened, csat received, subscription started); none of
 * them carries device fields. Device fields
 * (os, browser, model, screen) are sticky per device_id (engine).
 *
 * DESIGN NOTES:
 * - Companies: established customers come from a seeded table (size → planned
 *   agents 2-8 / 8-25 / 25-60, plan mix by size, seats = agents x 1.0-1.3,
 *   industry, region, email provider, acquisition channel). Customer agents
 *   fill the planned seats in processing order (every account's first two
 *   seats first, then the rest, each list shuffled by a salt), so every
 *   customer account has at least two agents. Established single-agent
 *   workspaces are on the Free plan (10% of established users) or own a trial
 *   that started in the 14 days before June 4 (5.5%, the in-window pace of
 *   trial signups who connect an inbox), so trials are in flight on day 1.
 *   Every trial signup gets a new workspace (sequential ids; concurrency 1).
 *   Run state resets when a new run's config arrives.
 * - Tickets: the engine's Ticket units supply arrival times (soup-shaped) and
 *   per-ticket channel, priority, and category. The hook rebuilds each ticket:
 *   first reply after a log-normal first-response time, 0-2 follow-up replies,
 *   an optional escalation, resolution after a log-normal gap (93% resolve),
 *   an optional reopen (customer reply → agent reply → second resolution), and
 *   an optional CSAT answer (30%) 0.5-30 h after the final resolution.
 *   Established agents have tickets in flight at June 4 (arrivals in the 14
 *   days before; only the in-window steps remain).
 * - First-response time = FRT_MED_MIN x priority x channel x weekend arrival
 *   x (Skills Routing variant) x (Reply Assist draft) x log-normal. Resolution
 *   gap = RESOLVE_GAP_MED_H x priority x log-normal. The priority multiplier
 *   scales the whole ticket, so resolution time by priority reads the knob.
 *   first_response_mins on ticket resolved and csat received is measured from
 *   assignment.
 * - Trial purchases: a trial owner who connected an inbox buys with
 *   probability BUY_MAX x a channel keep share, 1-21 days after signup
 *   (skewed to the trial end), one purchase per workspace: Growth or Starter,
 *   1-4 seats, monthly or annual. After the trial the workspace is on Free
 *   unless it bought. Plan choice and the post-change downgrade are salted
 *   per buyer. A buyer with no engine template clones the run's first purchase
 *   event (identity and company re-stamped); macros and the widget do the same
 *   with device fields from the user's own signup. Trial signups who never
 *   connect an inbox browse for up to 3 days and leave.
 * - Pricing page views: every trial owner who set up compares plans a salted
 *   0-3 times on salted days of the trial (a buyer at least once, the last
 *   view minutes before the purchase). Views stop at the would-be purchase
 *   time even when that falls after the window, so the weekly series is flat
 *   to the right edge.
 * - New workspaces set themselves up in their first 21 days (integrations
 *   once per tool, most automation rules and articles); admins own
 *   integrations and automation rules; established customers change them
 *   rarely.
 * - US holidays (Jul 3 observed, Sep 7): Americas companies get 60% fewer
 *   tickets and their agents skip 70% of their own actions.
 * - The hook re-places $experiment_started 1 s before the agent's first
 *   rebuilt ticket after the test start (the engine's marker sits before the
 *   engine's own funnel step, which the ticket rebuild moves or drops).
 * - retentionCurve shapes trial signups' activity; established users are flat.
 * - Warehouse drift: inbound_channel_daily counts every ingested ticket,
 *   including tickets closed automatically (auto-replies and notifications
 *   move with the day's traffic; spam follows the trailing 7-day traffic
 *   level with ±50% day noise and occasional 2-4x spam waves) and tickets
 *   merged into another; subscription_billing_daily adds a few
 *   invoice purchases Mixpanel never received and pre-invoice seat edits;
 *   paid spend is half a paced budget (weekday shape, never zero) and half
 *   bid x the day's delivered signups, with seeded day noise. During the
 *   email incident the stuck share of spam/auto-replies is processed with the
 *   backlog on Aug 28 (tickets_auto_closed dips, then spikes).
 * - Per-ticket and per-user draws are salted (hashFloat) or seeded; no even
 *   cycles, so reads carry honest sampling noise around the knobs.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. REPLY ASSIST LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Reply Assist (AI drafts) launches 2026-07-21 for Growth and
 *   Enterprise. 50% of agents on those plans adopt it on a salted day in the
 *   21 days after launch and draft a salted 60-100% (mean 80%) of their
 *   replies with it, so about 40% of eligible first replies are AI drafts
 *   once the ramp is done. An AI-drafted first reply arrives in 0.5x the
 *   time. Starter, Free, and trial workspaces never use it.
 * MIXPANEL: Funnels, ticket assigned → reply sent, Totals, hold ticket_id
 *   constant, 7-day window, filter step-1 plan_tier in (growth, enterprise),
 *   date range Jul 21 - Sep 24, breakdown reply_method (step 2), median time
 *   to convert.
 * REAL WORLD: a good first draft removes the blank-page delay.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. RESOLUTION TIME BY PRIORITY (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: every timing of a ticket scales with its priority: urgent 0.3x,
 *   high 0.6x, normal 1x, low 1.5x.
 * MIXPANEL: Funnels, ticket assigned → ticket resolved, Totals, hold
 *   ticket_id constant, 14-day window, breakdown priority, median time to
 *   convert. Insights, ticket resolved, median resolution_mins by priority
 *   reads slightly higher: it includes the second resolution of reopened
 *   tickets and has no 14-day window.
 * REAL WORLD: SLA policies put urgent tickets at the top of every queue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. MICROSOFT 365 ONBOARDING FRICTION (declarative duplicate first funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: trial signups whose company mail runs on Microsoft 365 connect
 *   their support inbox at 47% vs 86% for Google Workspace and other
 *   providers (0.547x). 80% of connectors install the widget whatever the
 *   provider, so full setup reads the same ratio.
 * MIXPANEL: Funnels, account created → inbox connected → widget installed,
 *   7-day window, breakdown email_provider.
 * REAL WORLD: admin consent for a Microsoft 365 mailbox stalls many trials.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. PAID CHANNEL ECONOMICS (everything + warehouse paid_marketing_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: window spend per Mixpanel signup $80 Google Ads, $40 Capterra,
 *   $240 LinkedIn Ads (half paced budget, half bid x delivered signups).
 *   Share of would-be purchases kept by channel: LinkedIn 1.0, partner
 *   referral 0.85, organic 0.7, Google 0.6, Shopify App Store 0.5, Capterra
 *   0.4, so Capterra signups buy within 30 days at 0.4x LinkedIn's rate.
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   paid_marketing_daily.spend_usd; Funnels, account created → subscription
 *   started, 30-day window, signups Jun 4 - Sep 1, breakdown acquisition_channel.
 * REAL WORLD: review-site clicks are cheap and window-shopping.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. SKILLS ROUTING EXPERIMENT (Ticket funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 customer accounts (2+ agents) split 50/50. The
 *   routing method is a workspace setting, so the arm is assigned per
 *   company_id: within each plan, accounts are paired by size and one of each
 *   pair (salted) gets the variant; all its agents share the arm. Single-agent
 *   workspaces (Free, trials, self-serve buyers) are not in the test.
 *   "Skills Routing" (tickets routed by agent skill instead of round robin)
 *   makes the first reply take 0.7x the time and multiplies the reopen rate
 *   by 0.6 (12% → 7.2%). Escalations do not change (honest null).
 * MIXPANEL: Funnels, ticket assigned → reply sent, Totals, hold ticket_id
 *   constant, 7-day window, date range Jul 8 - Sep 24, breakdown
 *   "Experiment: Skills Routing", median time to convert; reopens per ticket
 *   (ticket resolved → ticket reopened, hold ticket_id constant), or Insights
 *   ticket reopened / ticket resolved by the same breakdown (reads lower,
 *   because second resolutions sit in the denominator).
 * REAL WORLD: the right agent answers faster and right the first time.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. EMAIL INGESTION INCIDENT (everything + warehouse inbound_channel_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-26 to 2026-08-27, 70% of email tickets (salted per
 *   ticket) are stuck in the ingestion queue and reach agents only after the
 *   fix (Aug 28, 00:00-10:00 UTC). Other channels are untouched. The warehouse
 *   shows ingestion_status = degraded for email on those days, and the stuck
 *   spam/auto-replies are auto-closed with the backlog on Aug 28.
 * MIXPANEL: Insights, ticket assigned, daily, breakdown channel; email/other
 *   ratio on the degraded days vs the 14 days either side (Aug 28 excluded).
 * REAL WORLD: a stuck mail queue looks like a quiet inbox, then a flood.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. FAST FIRST REPLIES EARN BETTER CSAT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the chance a CSAT answer is positive (score 4-5) is 0.92 when the
 *   first reply came within 60 minutes, 0.60 after 8 hours, falling linearly
 *   in log(time) in between.
 * MIXPANEL: Insights, csat received, filter first_response_mins ≤ 60 vs > 480,
 *   share with score ≥ 4.
 * REAL WORLD: customers forgive a lot if someone answers quickly.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. BACK-TO-SCHOOL SURGE FOR EDUCATION CUSTOMERS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-17 to 2026-09-13 (the back-to-school season in North
 *   America and Europe) education companies in the Americas and EMEA receive
 *   1.8x their usual tickets on average: extra same-day tickets follow a
 *   half-sine over the four weeks (near 1x at the edges, about 2.25x in the
 *   middle). APAC education companies (other school calendars) and other
 *   industries are unchanged.
 * MIXPANEL: Insights, ticket assigned, weekly, breakdown user property
 *   industry, filter user property region in (americas, emea) and
 *   customer_since before 2026-06-04; season vs the 8 weeks before.
 * REAL WORLD: term start brings password resets, enrollment, and billing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. MACROS IN THE FIRST TWO WEEKS (everything; magic number)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: every trial signup who connects an inbox saves a salted
 *   negative-binomial number of macros in the first 14 days (mean 2.6, size
 *   2: 0 → 19%, 1 → 21%, 2 → 18%, 3 → 14%, then a falling tail), independent
 *   of activity. The chance to go dark 21-24 days after signup is a logistic
 *   in that count: 0.75 / (1 + e^(1.2 x (macros - 2.5))), i.e. 0.71 at 0,
 *   0.48 at 2, 0.27 at 3, 0.04 at 5. Day 28-41 retention (queue viewed)
 *   rises smoothly with macros, steepest between 2 and 3; fewer than 3 vs 3+
 *   reads 0.435x (implied by the count distribution and the curve). Day 7-13
 *   retention is the same in both groups.
 * MIXPANEL: Funnels, account created → macro created → macro created → macro
 *   created, 14-day window; save completers / non-completers as cohorts.
 *   Retention, account created → queue viewed, custom bracket day 28-41,
 *   filter did inbox connected, breakdown by those cohorts.
 * REAL WORLD: a team that builds its canned replies has moved in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. GROWTH PRICE CHANGE (everything + warehouse subscription_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-08-18 Growth rises from $39 to $49 per agent per month
 *   for new subscriptions. Purchases do not fall, but 40% of would-be Growth
 *   buyers (salted) pick Starter, so Growth's share of new subscriptions is
 *   0.6x by design (65% → 39%), and new MRR per new subscription does not rise.
 * MIXPANEL: Insights, subscription started, breakdown plan, before vs after
 *   Aug 18; new MRR needs warehouse list_price_per_seat_usd.
 * REAL WORLD: a price rise on the middle tier pushes buyers down a tier.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-support-desk, 2026-10-07, full
 * fidelity, 10,000 users, 841,092 events, 97,528 tickets assigned)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                           | Derivation              | Expected | Measured
 * -----|--------------------------------------------------|-------------------------|----------|---------
 * H1   | median FRT, AI draft / other, Growth+Ent post-launch | AI_FRT_MULT          | 0.50     | 0.510 (54.6 vs 107.1 min)
 * H1   | AI share of eligible first replies after the ramp | 0.5 x mean use 0.8      | 0.40     | 0.402
 * H1   | AI drafts before launch or off Growth/Enterprise | exact purity            | 0        | 0
 * H2   | median assigned → resolved, urgent / normal      | PRIORITY_MULT.urgent    | 0.30     | 0.302 (6.1 vs 20.2 h)
 * H2   | median assigned → resolved, low / normal         | PRIORITY_MULT.low       | 1.50     | 1.488 (30.1 vs 20.2 h)
 * H3   | 7-day setup completion, Microsoft 365 / others   | 47 / 86                 | 0.547    | 0.560 (38.0% vs 67.8%)
 * H3   | 7-day inbox connected, Microsoft 365 / others    | 47 / 86                 | 0.547    | 0.562 (48.4% vs 86.1%)
 * H4   | spend per signup, Capterra / Google Ads          | 40 / 80                 | 0.50     | 0.496 ($40.17 vs $80.96)
 * H4   | 30-day paid rate, Capterra / LinkedIn            | BUY_KEEP 0.4 / 1.0      | 0.40     | 0.371 (17.0% vs 46.0%)
 * H5   | median FRT, Skills Routing / Control             | ROUTING_FRT_MULT        | 0.70     | 0.704 (77.3 vs 109.7 min)
 * H5   | reopen rate, Skills Routing / Control            | ROUTING_REOPEN_MULT     | 0.60     | 0.582 (7.0% vs 12.0%)
 * H5   | Skills Routing share of exposed users            | size-paired accounts    | 0.50     | 0.499 (187 vs 187 accounts)
 * H6   | email/other tickets, degraded days / ±14 days    | 1 − INCIDENT_DELAY_SHARE| 0.30     | 0.295 (0.244 vs 0.826)
 * H6   | warehouse email rows with ingestion degraded     | exact                   | 2        | 2
 * H7   | positive CSAT, FRT > 8 h / FRT ≤ 60 min          | 0.60 / 0.92             | 0.652    | 0.670 (61.7% vs 92.1%)
 * H8   | education vs other tickets, Americas+EMEA, season / 8 wks before | BTS_MULT (mean) | 1.80 | 1.728
 * H9   | D28-41 retention, under 3 / 3+ macros            | NB counts x logistic    | 0.435    | 0.427 (27.8% vs 65.1%)
 * H10  | Growth share of new subscriptions, after / before| 1 − GROWTH_DOWNGRADE_AFTER | 0.60  | 0.594 (64.6% → 38.4%)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Verdicts: 10 NAILED. H6 and H10 use a knob-centred custom assert:
 * NAILED at the knob ±10%, STRONG between half the knob ratio (a sanity lower
 * bound, so an overshoot cannot pass) and the half-effect floor. H10 rests on
 * about 480 post-change buyers (salted plan draws). Noise notes: H8 rests on
 * 38 Americas and EMEA education customer accounts plus about 90
 * single-agent workspaces (the weekly education/other
 * ratio moves about ±7% outside the season). H9 compares 1,255 vs 899
 * workspaces (ratio SE about 5%); non-dark retention is flat across macro
 * counts (about 0.70-0.77), so the read is the dark curve. H5 clusters by
 * account (374 accounts), so its ratios move a few percent between draws.
 * H4's paid-rate read rests on about 125 Capterra and 225 LinkedIn buyers.
 * Honest nulls (eval): escalation rate by Skills Routing arm (7.41% vs 7.31%,
 * z = 0.43; plain per-ticket salt, no salt search; of 23 ticket-level splits
 * one reads |z| > 2: large companies 7.9% vs 7.0%, z = 2.19, account-level
 * t = 2.18 on 37 accounts, in the direction opposite to the prompt's
 * hypothesis; the eval grading treats it as the expected chance split) and
 * 30-day paid conversion of Microsoft 365 vs other workspaces after setup
 * (37.9% vs 39.7%, z = -0.78; every channel and region split |z| ≤ 1.54).
 * Not engineered: weekend arrivals wait about 1.8x longer for a first reply
 * (WEEKEND_FRT_MULT, realism), and chat replies are faster.
 */

// ── SCALE ──
const SEED = "harness-support-desk";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const ROUTING_START = "2026-07-08T00:00:00Z";        // "Skills Routing" A/B test starts
const AI_LAUNCH = "2026-07-21T00:00:00Z";            // Reply Assist (AI drafts) for Growth + Enterprise
const BTS_START = "2026-08-17T00:00:00Z";            // back-to-school season (North America and Europe) starts
const BTS_END = "2026-09-14T00:00:00Z";              // exclusive (4 weeks: Aug 17 - Sep 13)
const GROWTH_PRICE_CHANGE = "2026-08-18T00:00:00Z";  // Growth $39 → $49 per agent per month
const EMAIL_INCIDENT_START = "2026-08-26T00:00:00Z"; // email ingestion incident starts
const EMAIL_INCIDENT_END = "2026-08-28T00:00:00Z";   // exclusive (2 days: Aug 26-27); backlog flushes Aug 28
const US_HOLIDAYS = ["2026-07-03", "2026-09-07"];    // Independence Day (observed), Labor Day

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const D0 = DATASET_START.slice(0, 10);
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Support teams staff weekends lightly.
const DOW_WEIGHTS = [0.36, 1.0, 1.0, 0.98, 0.96, 0.88, 0.38];
// UTC hours: EMEA working hours (07-16 UTC) overlap the Americas (13-01 UTC);
// APAC customers keep the overnight from going silent.
const HOUR_WEIGHTS = [0.42, 0.34, 0.28, 0.24, 0.22, 0.24, 0.32, 0.5, 0.68, 0.78, 0.82, 0.82,
	0.88, 0.96, 1.0, 1.0, 0.98, 0.92, 0.84, 0.74, 0.66, 0.58, 0.52, 0.46];

// ── KNOBS ──
// Ticket timing (all tickets)
const FRT_MED_MIN = 170;            // median first-response minutes: normal priority, email, weekday, control, no AI
const FRT_SIGMA = 1.05;
const FRT_MAX_MIN = 6 * 24 * 60;
const CHANNEL_FRT_MULT = { email: 1, web_form: 1, api: 1.2, chat: 0.25 };
const WEEKEND_FRT_MULT = 1.8;       // tickets that arrive on Saturday or Sunday wait longer
const RESOLVE_GAP_MED_H = 16;       // median hours first reply → resolution (normal priority)
const RESOLVE_SIGMA = 0.9;
const RESOLVE_MAX_H = 20 * 24;
const RESOLVE_SHARE = 0.93;         // share of tickets resolved (the rest stay pending)
const ESCALATE_SHARE = { urgent: 0.18, high: 0.14, normal: 0.05, low: 0.02 };
const ESCALATE_SALT = "escalate";   // per-ticket escalation draw (hashFloat only, so it never shifts the seeded stream); independent of the routing arm (honest null, Q13)
const FOLLOWUP_WEIGHTS = { 0: 35, 1: 45, 2: 20 };
const REOPEN_BASE = 0.12;           // share of resolved tickets the customer reopens
const CSAT_RESPONSE = 0.3;          // share of final resolutions that get a CSAT answer
const PRE_WINDOW_DAYS = 14;         // established agents: tickets arriving in the 14 days before June 4 are in flight

// H1 Reply Assist (AI drafts)
const AI_PLANS = ["growth", "enterprise"];
const AI_ADOPTER_SHARE = 0.5;
const AI_RAMP_DAYS = 21;
const AI_USE_MIN = 0.6, AI_USE_MAX = 1.0; // per adopter, salted uniform (mean 0.8)
const AI_ADOPTION = AI_ADOPTER_SHARE * (AI_USE_MIN + AI_USE_MAX) / 2; // 0.40 of eligible first replies once ramped
const AI_FRT_MULT = 0.5;

// H2 priority scales every timing of a ticket
const PRIORITY_MULT = { urgent: 0.3, high: 0.6, normal: 1, low: 1.5 };
const PRIORITY_WEIGHTS = { low: 20, normal: 50, high: 22, urgent: 8 };
const CHANNEL_WEIGHTS_T = { email: 45, chat: 22, web_form: 23, api: 10 };
const CATEGORY_WEIGHTS = { billing: 22, technical_issue: 26, account_access: 16, how_to: 18, shipping: 10, feature_request: 8 };

// H3 onboarding by email provider (declarative duplicate first funnels)
const INBOX_CONV = 86;              // trial signups who connect their support inbox (Google Workspace, other)
const M365_INBOX_MULT = 0.55;
const M365_INBOX_CONV = Math.round(INBOX_CONV * M365_INBOX_MULT); // 47
const ONBOARD_TTC_H = 6;
const WIDGET_SHARE = 0.8;           // inbox connectors who also install the help widget (any provider)
const WIDGET_DELAY_MEDIAN_H = 3;
const WIDGET_DELAY_MAX_H = 5 * 24;
const PROVIDER_WEIGHTS = { google_workspace: 50, microsoft_365: 35, other: 15 };
const NONCOMPLETER_DAYS = 3;
const SETUP_DAYS = 21;              // a new workspace connects its tools and writes its first rules in its first 3 weeks

// H4 paid channel economics (warehouse paid_marketing_daily)
const PAID_CHANNELS = ["google_ads", "capterra", "linkedin_ads"];
const CPL_USD = { google_ads: 80, capterra: 40, linkedin_ads: 240 }; // window spend per Mixpanel signup
// established customers also came through outbound sales (larger accounts)
const CUSTOMER_ACQ_WEIGHTS = { organic: 28, google_ads: 16, capterra: 10, linkedin_ads: 10, partner_referral: 14, shopify_app_store: 6, outbound_sales: 16 };
const ACQ_WEIGHTS = { organic: 30, google_ads: 22, capterra: 18, linkedin_ads: 12, partner_referral: 10, shopify_app_store: 8 };
const BUY_KEEP = { linkedin_ads: 1.0, partner_referral: 0.85, organic: 0.7, google_ads: 0.6, shopify_app_store: 0.5, capterra: 0.4 };
const BUY_MAX = 0.6;                // purchase probability for a fully kept channel (trial owners who finished setup)
const TRIAL_DAYS = 14;
const BUY_GRACE_DAYS = 7;
const PRICING_VIEW_WEIGHTS = { 0: 35, 1: 40, 2: 18, 3: 7 }; // plan comparisons per trial owner who set up (a buyer has at least one)
const PLAN_VIEWED_WEIGHTS = { growth: 55, starter: 35, enterprise: 10 };           // some workspaces buy in the week after the trial ends
const BORN_PCT = 45;
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(ACQ_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPL_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (ACQ_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.3;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const SPEND_PLAN_SHARE = 0.5;
const CPC_USD = { google_ads: 6.5, capterra: 3.2, linkedin_ads: 11 };
const CTR = { google_ads: 0.045, capterra: 0.02, linkedin_ads: 0.006 };
const PLATFORM_LEAD_INFLATION = 1.15; // ad platforms claim more sign-ups than Mixpanel records

// H5 Skills Routing experiment
const ROUTING_EXPERIMENT = "Skills Routing";
const ROUTING_VARIANT = "Skills Routing";
const EXP_KEY = `Experiment: ${ROUTING_EXPERIMENT}`;
const ROUTING_FRT_MULT = 0.7;
const ROUTING_REOPEN_MULT = 0.6;

// H6 email ingestion incident (warehouse inbound_channel_daily)
const INCIDENT_CHANNEL = "email";
const INCIDENT_DELAY_SHARE = 0.7;   // share of email tickets stuck until the fix
const BACKLOG_FLUSH_H = 10;         // stuck tickets reach agents in the first 10 hours of Aug 28
// tickets closed automatically and never assigned: auto-replies and notifications
// move with the day's traffic; spam follows the number of connected inboxes (the
// trailing 7-day traffic level), with no weekday shape
const AUTO_REPLY_SHARE = { email: 0.15, chat: 0.05, web_form: 0.08, api: 0.45 };
const SPAM_SHARE = { email: 0.3, chat: 0.1, web_form: 0.17, api: 0.15 };
const AUTO_NOISE = 0.25;            // ± day-level spread of the auto-reply share
const SPAM_NOISE = 0.5;             // ± day-level spread of spam
const SPAM_WAVE_SHARE = 0.1;        // channel-days hit by a spam wave (2-4x the usual spam)
const INCIDENT_DAYS = Array.from({ length: Math.round((ms(EMAIL_INCIDENT_END) - ms(EMAIL_INCIDENT_START)) / DAY_MS) }, (_, i) => dayjs.utc(EMAIL_INCIDENT_START).add(i, "day").format("YYYY-MM-DD"));
const BACKLOG_DAY = EMAIL_INCIDENT_END.slice(0, 10);
const INTAKE_DRIFT = 0.04;          // ± day-level gap between routed tickets and intake (manual tickets, deletions)
const MERGED_SHARE = 0.07;          // mean share of ingested tickets merged into another ticket (0-14% by day)

// H7 CSAT by first-response time
const CSAT_FAST_MIN = 60;
const CSAT_SLOW_MIN = 480;
const CSAT_POS_FAST = 0.92;
const CSAT_POS_SLOW = 0.6;

// H8 back-to-school surge
const BTS_INDUSTRY = "education";
const BTS_REGIONS = ["americas", "emea"]; // northern-hemisphere school year (US mid-August, Europe late August - early September); APAC terms run on other calendars
const BTS_MULT = 1.8;

// H9 macros in the first two weeks
const MACRO_DAYS = 14;
const MACRO_MIN = 3;                // the threshold the read splits on
const MACRO_MEAN = 2.6;             // macros saved in the first 14 days: negative binomial (salted per user)
const MACRO_DISPERSION = 2;         // NB size r (smaller = more skewed)
const MACRO_CAP = 12;
const DARK_MAX = 0.75;              // chance to go dark for a workspace with no macros (logistic upper level)
const DARK_MID = 2.5;               // macro count where the chance falls through half of DARK_MAX
const DARK_SLOPE = 1.2;             // logistic steepness per macro
const DARK_AFTER_DAYS = 21;
const DARK_SPREAD_DAYS = 3;
// NB pmf over 0..MACRO_CAP (tail mass folded into the cap)
const MACRO_PMF = (() => {
	const r = MACRO_DISPERSION, q = MACRO_MEAN / (r + MACRO_MEAN);
	const pmf = [Math.pow(1 - q, r)];
	for (let k = 1; k < MACRO_CAP; k++) pmf.push(pmf[k - 1] * q * (k - 1 + r) / k);
	pmf.push(1 - pmf.reduce((a, b) => a + b, 0));
	return pmf;
})();
const darkProb = (m) => DARK_MAX / (1 + Math.exp(DARK_SLOPE * (m - DARK_MID)));
const macroCount = (u) => { let acc = 0; for (let k = 0; k < MACRO_PMF.length; k++) { acc += MACRO_PMF[k]; if (u < acc) return k; } return MACRO_CAP; };
// expected read (knob-derived): stay share below the threshold over stay share at or above it
const H9_KEEP = (lo, hi) => {
	let w = 0, keep = 0;
	for (let k = lo; k <= hi; k++) { w += MACRO_PMF[k]; keep += MACRO_PMF[k] * (1 - darkProb(k)); }
	return keep / w;
};
const H9_EXPECTED = H9_KEEP(0, MACRO_MIN - 1) / H9_KEEP(MACRO_MIN, MACRO_CAP);

// H10 Growth price change (warehouse subscription_billing_daily)
const PRICE_PER_SEAT = { starter: [19, 19], growth: [39, 49], enterprise: [89, 89] };
const GROWTH_CHOICE = 0.65;         // share of trial buyers who pick Growth before the change
const GROWTH_DOWNGRADE_AFTER = 0.4; // share of would-be Growth buyers who pick Starter after the change
const SEAT_WEIGHTS = { 1: 55, 2: 28, 3: 12, 4: 5 };
const ANNUAL_SHARE = 0.3;
const UNTRACKED_PURCHASE_SHARE = 0.12; // plan-days with one invoice purchase Mixpanel never received
const SEAT_EDIT_SHARE = 0.15;          // plan-days with a pre-invoice seat edit (±1 seat)

// US holidays: Americas teams run skeleton crews
const HOLIDAY_TICKET_DROP = 0.6;
const HOLIDAY_ACTION_DROP = 0.7;

// ── COMPANIES ──
const COMPANY_ID_CAP = 7000;
const RECENT_TRIAL_SHARE = 0.055;   // established users who own a trial started in the 14 days before June 4
const FREE_SHARE = 0.10;            // established users on a Free single-agent workspace
const INDUSTRY_WEIGHTS = { ecommerce: 26, saas: 22, education: 12, fintech: 10, healthcare: 10, travel: 10, gaming: 10 };
const REGION_WEIGHTS = { americas: 55, emea: 33, apac: 12 };
const SIZE_WEIGHTS = { small: 60, mid: 30, large: 10 };
const SIZE_AGENTS = { small: [2, 8], mid: [8, 25], large: [25, 60] };
const PLAN_MIX = {
	small: { starter: 55, growth: 40, enterprise: 5 },
	mid: { starter: 20, growth: 60, enterprise: 20 },
	large: { starter: 5, growth: 40, enterprise: 55 },
};
const NAME_SUFFIX = {
	ecommerce: ["Supply", "Goods", "Outfitters", "Co", "Market"], saas: ["Labs", "Cloud", "Software", "HQ"],
	education: ["Academy", "Learning", "School", "Tutors"], fintech: ["Pay", "Capital", "Finance"],
	healthcare: ["Health", "Care", "Clinic"], travel: ["Travel", "Trips", "Journeys"], gaming: ["Games", "Studios", "Play"],
};

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byT = (a, b) => T(a) - T(b);
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const hashInt = (key, lo, hi) => lo + Math.floor(hashFloat(key) * (hi - lo + 1));
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
const draw = (obj) => pickWeighted(obj, chance.floating({ min: 0, max: 1 }));
const isWeekend = (t) => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6; };
const isUsHoliday = (t) => US_HOLIDAYS.includes(dayKey(t));
const inIncident = (t) => t >= ms(EMAIL_INCIDENT_START) && t < ms(EMAIL_INCIDENT_END);
// H8: extra tickets per arrival on a season day: a half-sine over the season
// whose mean over the days is BTS_MULT - 1 (starts and ends near zero)
const BTS_DAYS = Math.round((ms(BTS_END) - ms(BTS_START)) / DAY_MS);
const BTS_SHAPE_MEAN = Array.from({ length: BTS_DAYS }, (_, d) => Math.sin(Math.PI * (d + 0.5) / BTS_DAYS)).reduce((a, b) => a + b, 0) / BTS_DAYS;
const btsExtra = (t) => {
	const d = Math.floor((t - ms(BTS_START)) / DAY_MS);
	return d < 0 || d >= BTS_DAYS ? 0 : (BTS_MULT - 1) * Math.sin(Math.PI * (d + 0.5) / BTS_DAYS) / BTS_SHAPE_MEAN;
};
const pricePerSeat = (plan, t) => (PRICE_PER_SEAT[plan] ?? [0, 0])[t >= ms(GROWTH_PRICE_CHANGE) ? 1 : 0];
// H7: chance a CSAT answer is positive, by first-response minutes
const csatPositive = (frtMin) => {
	if (frtMin <= CSAT_FAST_MIN) return CSAT_POS_FAST;
	if (frtMin >= CSAT_SLOW_MIN) return CSAT_POS_SLOW;
	return CSAT_POS_FAST - (CSAT_POS_FAST - CSAT_POS_SLOW) * Math.log(frtMin / CSAT_FAST_MIN) / Math.log(CSAT_SLOW_MIN / CSAT_FAST_MIN);
};
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPL_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));

const NAME_POOL = Array.from({ length: COMPANY_ID_CAP }, () => chance.word({ syllables: 2, capitalize: true }));
const companyName = (id, industry) => { const sx = NAME_SUFFIX[industry] ?? ["Co"]; return `${NAME_POOL[id - 1]} ${sx[hashInt(`co|${id}|suffix`, 0, sx.length - 1)]}`; };

// established customers: enough planned agents for the expected customer agents
const EXPECTED_CUSTOMER_AGENTS = NUM_USERS * (1 - BORN_PCT / 100) * (1 - RECENT_TRIAL_SHARE - FREE_SHARE);
const CUSTOMERS = [];
{
	let planned = 0;
	while (planned < EXPECTED_CUSTOMER_AGENTS) {
		const id = CUSTOMERS.length + 1;
		const size = pickWeighted(SIZE_WEIGHTS, hashFloat(`co|${id}|size`));
		const [lo, hi] = SIZE_AGENTS[size];
		const agents = hashInt(`co|${id}|agents`, lo, hi);
		const plan = pickWeighted(PLAN_MIX[size], hashFloat(`co|${id}|plan`));
		const sinceDays = hashInt(`co|${id}|since`, 60, 1400);
		const industry = pickWeighted(INDUSTRY_WEIGHTS, hashFloat(`co|${id}|industry`));
		CUSTOMERS.push({
			id: String(id), name: companyName(id, industry), kind: "customer", size, planned: agents, industry,
			region: pickWeighted(REGION_WEIGHTS, hashFloat(`co|${id}|region`)),
			email_provider: pickWeighted(PROVIDER_WEIGHTS, hashFloat(`co|${id}|provider`)),
			plan, seats: Math.ceil(agents * (1 + 0.3 * hashFloat(`co|${id}|seats`))),
			acquisition_channel: pickWeighted(CUSTOMER_ACQ_WEIGHTS, hashFloat(`co|${id}|acq`)),
			customer_since: dayjs.utc(DATASET_START).subtract(sinceDays, "day").format("YYYY-MM-DD"),
		});
		planned += agents;
	}
}
// customer seats filled in processing order: every company's first two seats
// come first (shuffled), then the rest (shuffled), so every customer account
// has at least two agents in the data; beyond the planned seats, a salted pick
const CUSTOMER_CUM = (() => {
	const total = CUSTOMERS.reduce((s, c) => s + c.planned, 0);
	let acc = 0;
	return CUSTOMERS.map((c) => (acc += c.planned / total));
})();
const CUSTOMER_SLOTS = (() => {
	const first = [], rest = [];
	for (const c of CUSTOMERS) for (let j = 0; j < c.planned; j++) (j < 2 ? first : rest).push({ id: c.id, k: hashFloat(`slot|${c.id}|${j}`) });
	const byK = (a, b) => a.k - b.k;
	return first.sort(byK).concat(rest.sort(byK)).map((x) => x.id);
})();

// H5: the routing method is a workspace setting, so the test randomizes
// customer accounts: within each plan, accounts are paired by size and one of
// each pair (salted) gets Skills Routing. Single-agent workspaces (Free,
// trials, self-serve buyers) have no one to route between and are not in the test.
const COMPANY_ARM = (() => {
	const arm = new Map();
	for (const plan of Object.keys(PLAN_MIX.small)) {
		const cs = CUSTOMERS.filter((c) => c.plan === plan).sort((a, b) => b.planned - a.planned || Number(a.id) - Number(b.id));
		for (let i = 0; i < cs.length; i += 2) {
			const flip = hashFloat(`arm|${plan}|${i}`) < 0.5;
			arm.set(cs[i].id, flip ? ROUTING_VARIANT : "Control");
			if (cs[i + 1]) arm.set(cs[i + 1].id, flip ? "Control" : ROUTING_VARIANT);
		}
	}
	return arm;
})();

// run state (reset when a new run's config arrives): single-agent workspaces
const RUN = { cfg: null, companies: new Map(), next: CUSTOMERS.length + 1, slot: 0, buyTemplate: null, macroTemplate: null, widgetTemplate: null, expTemplate: null, pricingTemplate: null };
const resetRun = (cfg) => {
	RUN.cfg = cfg;
	RUN.slot = 0;
	RUN.buyTemplate = null;
	RUN.macroTemplate = null;
	RUN.widgetTemplate = null;
	RUN.expTemplate = null;
	RUN.pricingTemplate = null;
	RUN.companies = new Map(CUSTOMERS.map((c) => [c.id, { ...c, members: 0, finalPlan: c.plan }]));
	RUN.next = CUSTOMERS.length + 1;
};
const companyOf = (id) => RUN.companies.get(String(id));

/** a new single-agent workspace (Free, recent trial, or in-window trial) */
function newWorkspace(uid, kind, sinceDay) {
	const id = RUN.next++;
	if (id > COMPANY_ID_CAP) throw new Error(`support-desk: more than ${COMPANY_ID_CAP} companies; raise COMPANY_ID_CAP`);
	const industry = pickWeighted(INDUSTRY_WEIGHTS, salt(uid, "industry"));
	const co = {
		id: String(id), name: companyName(id, industry), kind, size: "small", planned: 1, industry,
		region: pickWeighted(REGION_WEIGHTS, salt(uid, "region")),
		email_provider: pickWeighted(PROVIDER_WEIGHTS, salt(uid, "provider")),
		plan: kind === "free" ? "free" : "trial", seats: 1, customer_since: sinceDay, acquisition_channel: null,
		members: 0, finalPlan: kind === "free" ? "free" : "trial",
	};
	RUN.companies.set(co.id, co);
	return co;
}

const stampCompany = (profile, co, plan) => {
	profile.company_id = co.id;
	profile.company_name = co.name;
	profile.company_size = co.size;
	profile.industry = co.industry;
	profile.region = co.region;
	profile.email_provider = co.email_provider;
	profile.customer_since = co.customer_since;
	profile.agent_seats = co.seats;
	profile.plan_tier = plan;
};

function handleUserHook(profile, meta) {
	if (meta.config !== RUN.cfg) resetRun(meta.config);
	const uid = profile.distinct_id;
	let co;
	if (meta.userIsBornInDataset) {
		const birthMs = ms(profile.created ?? meta.user.created);
		co = newWorkspace(uid, "trial", dayKey(birthMs));
		profile.role = "admin";
	} else {
		const r = salt(uid, "kind");
		if (r < RECENT_TRIAL_SHARE) {
			const daysBefore = 1 + Math.floor(salt(uid, "trial-age") * TRIAL_DAYS);
			co = newWorkspace(uid, "recent_trial", dayjs.utc(DATASET_START).subtract(daysBefore, "day").format("YYYY-MM-DD"));
			profile.role = "admin";
		} else if (r < RECENT_TRIAL_SHARE + FREE_SHARE) {
			co = newWorkspace(uid, "free", dayjs.utc(DATASET_START).subtract(hashInt(`${uid}|free-since`, 30, 900), "day").format("YYYY-MM-DD"));
			profile.role = "admin";
		} else if (RUN.slot < CUSTOMER_SLOTS.length) {
			co = companyOf(CUSTOMER_SLOTS[RUN.slot++]);
		} else {
			const x = salt(uid, "company");
			const idx = CUSTOMER_CUM.findIndex((c) => x < c);
			co = companyOf(CUSTOMERS[idx < 0 ? CUSTOMERS.length - 1 : idx].id);
		}
	}
	co.members += 1;
	// acquisition channel belongs to the workspace: a single-agent workspace takes its owner's
	if (co.acquisition_channel === null) co.acquisition_channel = profile.acquisition_channel;
	profile.acquisition_channel = co.acquisition_channel;
	stampCompany(profile, co, co.plan);
	return profile;
}

// ── TICKETS ──
const UNIT_STEPS = ["ticket assigned", "reply sent", "ticket escalated", "ticket resolved", "ticket reopened", "csat received"];
const SERVER_EVENTS = new Set(["inbox connected", "ticket assigned", "ticket reopened", "csat received", "subscription started"]);
const DEVICE_FIELDS = ["device_id", "os", "model", "browser", "screen_height", "screen_width", "carrier", "radio", "manufacturer", "osVersion", "browserVersion", "Platform", "platform"];
const AGENT_ACTIONS = new Set(["queue viewed", "search performed", "kb article viewed", "internal note added", "customer profile viewed",
	"report viewed", "macro created", "kb article published", "automation rule created", "integration connected"]);
const BROWSE_ONLY = new Set(["queue viewed", "kb article viewed", "search performed", "report viewed"]);
const ONBOARDING = new Set(["account created", "inbox connected", "widget installed"]);

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const co = companyOf(profile.company_id);
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;
	const americas = co.region === "americas";
	const finish = (evs, planAt) => {
		for (const e of evs) {
			e.company_id = co.id;
			e.plan_tier = planAt(T(e));
			if (SERVER_EVENTS.has(e.event)) for (const k of DEVICE_FIELDS) if (k in e) delete e[k];
		}
		return evs;
	};

	// ── trial signups who never connect an inbox browse briefly, then leave ──
	if (signup && !events.some((e) => e.event === "inbox connected")) {
		const lim = birthMs + NONCOMPLETER_DAYS * DAY_MS;
		const trialEnd = birthMs + TRIAL_DAYS * DAY_MS;
		events = events.filter((e) => e.event === "account created" || (BROWSE_ONLY.has(e.event) && T(e) < lim));
		if (profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];
		profile.plan_tier = END >= trialEnd ? "free" : "trial";
		co.finalPlan = profile.plan_tier;
		return finish(events, (t) => (t < trialEnd ? "trial" : "free"));
	}

	// ── plan over time: trials buy once (H4 channel, H10 plan choice) ──
	const isTrial = co.kind === "trial" || co.kind === "recent_trial";
	const trialStart = isTrial ? (birthMs ?? ms(`${co.customer_since}T00:00:00Z`) + Math.floor(salt(uid, "trial-hour") * DAY_MS)) : null;
	const trialEnd = isTrial ? trialStart + TRIAL_DAYS * DAY_MS : null;
	let purchase = null; // { t, plan, seats, period }
	let buyAt = null;    // would-be purchase time, kept even when it falls after the window
	const buyTemplates = events.filter((e) => e.event === "subscription started").sort(byT);
	if (!RUN.buyTemplate && buyTemplates.length) RUN.buyTemplate = { ...buyTemplates[0] };
	if (!RUN.macroTemplate) { const m = events.find((e) => e.event === "macro created"); if (m) RUN.macroTemplate = { ...m }; }
	if (!RUN.widgetTemplate) { const w = events.find((e) => e.event === "widget installed"); if (w) RUN.widgetTemplate = { ...w }; }

	// ── widget: a new workspace installs it once, soon after connecting its inbox ──
	const widgets = events.filter((e) => e.event === "widget installed");
	let widgetEv = null;
	const inbox = signup ? events.find((e) => e.event === "inbox connected") : null;
	if (inbox && salt(uid, "widget") < WIDGET_SHARE && (widgets.length || RUN.widgetTemplate)) {
		const t = T(inbox) + Math.min(WIDGET_DELAY_MAX_H, WIDGET_DELAY_MEDIAN_H * logNormal(1.2)) * HOUR_MS;
		if (widgets.length) widgetEv = widgets[0];
		else {
			widgetEv = cloneEvent(RUN.widgetTemplate, { time: iso(t), user_id: uid });
			for (const k of DEVICE_FIELDS) { if (k in signup) widgetEv[k] = signup[k]; else delete widgetEv[k]; }
			widgetEv.install_method = draw({ snippet: 55, shopify_app: 25, wordpress_plugin: 20 });
			events.push(widgetEv);
		}
		widgetEv.time = iso(Math.floor(t));
	}
	events = events.filter((e) => e.event !== "widget installed" || e === widgetEv);
	if (isTrial && salt(uid, "buy") < BUY_MAX * (BUY_KEEP[profile.acquisition_channel] ?? 0.7)) {
		// delay in days after signup: 80% inside the trial (skewed to its end), 20% in the grace week
		const r = salt(uid, "buy-delay");
		const d = r < 0.8 ? 1 + (TRIAL_DAYS - 1) * Math.sqrt(r / 0.8) : TRIAL_DAYS + BUY_GRACE_DAYS * (r - 0.8) / 0.2;
		const t = Math.floor(trialStart + d * DAY_MS);
		buyAt = t;
		// plan choice (salted per buyer); after the price change some would-be
		// Growth buyers pick Starter (a second, independent salt)
		const after = t >= ms(GROWTH_PRICE_CHANGE);
		const wantsGrowth = salt(uid, "plan") < GROWTH_CHOICE;
		const plan = wantsGrowth && !(after && salt(uid, "plan-down") < GROWTH_DOWNGRADE_AFTER) ? "growth" : "starter";
		purchase = {
			t, plan,
			seats: Number(pickWeighted(SEAT_WEIGHTS, salt(uid, "seats"))),
			period: salt(uid, "period") < ANNUAL_SHARE ? "annual" : "monthly",
		};
		if (t >= END) purchase = null; // no purchase inside the window
		else if (t >= BEGIN && !buyTemplates.length && !RUN.buyTemplate) purchase = null; // nothing to clone yet (first users of the run only)
	}
	const planAt = (t) => {
		if (!isTrial) return co.plan;
		if (purchase && t >= purchase.t) return purchase.plan;
		return t < trialEnd ? "trial" : "free";
	};

	// ── H9: macros in the first two weeks; the chance to go dark after day 21
	// falls smoothly with the number saved (logistic around 2.5 macros) ──
	let cut = Infinity;
	const keepMacros = new Set(); // first-14-day macros: exempt from the holiday thinning below
	if (signup) {
		const macroEnd = birthMs + MACRO_DAYS * DAY_MS;
		const early = events.filter((e) => e.event === "macro created" && T(e) < macroEnd).sort(byT);
		// a user with no engine macro template clones the run's first one, with
		// identity and device fields taken from the user's own signup
		let template = events.find((e) => e.event === "macro created");
		if (!template && RUN.macroTemplate) {
			template = cloneEvent(RUN.macroTemplate, { time: signup.time, user_id: uid });
			for (const k of DEVICE_FIELDS) { if (k in signup) template[k] = signup[k]; else delete template[k]; }
		}
		// one skewed count for every new workspace (salted, independent of activity)
		const want = template ? macroCount(salt(uid, "macro-n")) : 0;
		const kept = early.slice(0, want);
		for (const e of kept) keepMacros.add(e);
		// extra macros sit on the user's own active moments in the first 14 days
		const anchors = events.filter((e) => AGENT_ACTIONS.has(e.event) && T(e) >= birthMs && T(e) < macroEnd);
		for (let k = kept.length; k < want; k++) {
			const a = anchors.length ? anchors[chance.integer({ min: 0, max: anchors.length - 1 })] : signup;
			const t = Math.min(macroEnd - MIN_MS, T(a) + chance.integer({ min: 1, max: 40 }) * MIN_MS);
			const c = cloneEvent(template, { time: iso(t) });
			c.macro_category = draw({ greeting: 15, refund: 18, shipping_status: 16, password_reset: 18, troubleshooting: 20, closing: 13 });
			events.push(c);
			keepMacros.add(c);
		}
		if (early.length > want) {
			const drop = new Set(early.slice(want));
			events = events.filter((e) => !drop.has(e));
		}
		if (salt(uid, "dark") < darkProb(want)) cut = Math.floor(birthMs + (DARK_AFTER_DAYS + salt(uid, "dark-day") * DARK_SPREAD_DAYS) * DAY_MS);
	} else {
		// established agents save macros now and then; owners of trials that started
		// just before the window are still building theirs in their first 14 days
		const macroUntil = co.kind === "recent_trial" ? trialStart + MACRO_DAYS * DAY_MS : -Infinity;
		events = events.filter((e) => e.event !== "macro created" || T(e) < macroUntil || chance.bool({ likelihood: 25 }));
	}
	if (purchase && purchase.t >= cut) purchase = null;

	// ── tickets ──
	const pool = [];
	const byId = new Map();
	const templates = {};
	let exposure = null;
	for (const e of events) {
		if (e.event === "$experiment_started") { exposure = exposure || e; if (!RUN.expTemplate) RUN.expTemplate = { ...e }; continue; }
		if (!UNIT_STEPS.includes(e.event)) continue;
		if (!templates[e.event]) templates[e.event] = { ...e };
		if (!byId.has(e.ticket_id)) { const unit = { id: e.ticket_id, steps: {} }; byId.set(e.ticket_id, unit); pool.push(unit); }
		const unit = byId.get(e.ticket_id);
		(unit.steps[e.event] = unit.steps[e.event] || []).push(e);
	}
	const haveTemplates = UNIT_STEPS.every((s) => templates[s]);
	// H5: the arm belongs to the customer account (single-agent workspaces are not in the test)
	const variant = co.kind === "customer" ? COMPANY_ARM.get(co.id) ?? null : null;
	const aiAdopter = salt(uid, "ai") < AI_ADOPTER_SHARE;
	const aiStart = ms(AI_LAUNCH) + salt(uid, "ai-day") * AI_RAMP_DAYS * DAY_MS;
	const aiUse = AI_USE_MIN + (AI_USE_MAX - AI_USE_MIN) * salt(uid, "ai-use");
	const macroHeavy = signup ? events.filter((e) => e.event === "macro created").length >= MACRO_MIN : salt(uid, "macro-style") < 0.35;

	// arrivals: engine units (soup-shaped); then the hook's own extra arrivals
	const slots = [];
	if (haveTemplates) {
		for (const unit of pool) {
			const a = unit.steps["ticket assigned"]?.[0];
			if (!a) continue;
			slots.push({ t0: T(a), unit, channel: a.channel, priority: a.priority, category: a.category });
		}
	}
	const fresh = (t0) => ({ t0, unit: null, channel: draw(CHANNEL_WEIGHTS_T), priority: draw(PRIORITY_WEIGHTS), category: draw(CATEGORY_WEIGHTS) });
	const timeOfDay = (s) => s.t0 - Math.floor(s.t0 / DAY_MS) * DAY_MS;
	const base = slots.slice();
	// warm start: established agents have tickets in flight on June 4
	if (!signup && base.length) {
		const x = base.length * PRE_WINDOW_DAYS / WINDOW_DAYS;
		const n = Math.floor(x) + (chance.bool({ likelihood: (x % 1) * 100 }) ? 1 : 0);
		for (let i = 0; i < n; i++) {
			const day = Math.floor(BEGIN / DAY_MS) - 1 - chance.integer({ min: 0, max: PRE_WINDOW_DAYS - 1 });
			slots.push(fresh(day * DAY_MS + timeOfDay(base[chance.integer({ min: 0, max: base.length - 1 })])));
		}
	}
	// H8: Americas and EMEA education companies get extra same-day tickets during
	// the back-to-school season, rising and falling over the four weeks (mean BTS_MULT)
	if (co.industry === BTS_INDUSTRY && BTS_REGIONS.includes(co.region) && base.length) {
		for (const s of base) {
			if (s.t0 < ms(BTS_START) || s.t0 >= ms(BTS_END)) continue;
			const x = btsExtra(s.t0);
			const n = Math.floor(x) + (chance.bool({ likelihood: (x % 1) * 100 }) ? 1 : 0);
			for (let k = 0; k < n; k++) {
				const tod = timeOfDay(base[chance.integer({ min: 0, max: base.length - 1 })]);
				const t0 = Math.floor(s.t0 / DAY_MS) * DAY_MS + tod;
				if (t0 > END || (birthMs && t0 <= birthMs)) continue;
				slots.push(fresh(t0));
			}
		}
	}

	const unitEvents = [];
	const usedIds = new Set();
	for (const s of slots) {
		// US holidays: Americas companies get fewer tickets
		if (americas && isUsHoliday(s.t0) && chance.bool({ likelihood: HOLIDAY_TICKET_DROP * 100 })) continue;
		const src = s.unit;
		const id = src ? src.id : `tk_${chance.hash({ length: 12 })}`;
		// H6: stuck email tickets (salted per ticket) reach agents after the fix
		if (s.channel === INCIDENT_CHANNEL && inIncident(s.t0) && hashFloat(`${id}|stuck`) < INCIDENT_DELAY_SHARE) {
			s.t0 = ms(EMAIL_INCIDENT_END) + Math.floor(chance.floating({ min: 0, max: BACKLOG_FLUSH_H }) * HOUR_MS);
		}
		if (s.t0 >= cut || s.t0 > END) continue;
		usedIds.add(id);
		const used = {};
		const put = (step, t, set) => {
			if (t >= cut || t < BEGIN || t > END) return null;
			const k = used[step] = (used[step] || 0) + 1;
			let ev = src?.steps[step]?.[k - 1];
			if (!ev) ev = cloneEvent(templates[step], { time: iso(t) });
			ev.time = iso(Math.floor(t));
			ev.ticket_id = id;
			Object.assign(ev, set);
			unitEvents.push(ev);
			return ev;
		};
		const pm = PRIORITY_MULT[s.priority] ?? 1;
		const variantOn = variant === ROUTING_VARIANT && s.t0 >= ms(ROUTING_START);
		const plan0 = planAt(s.t0);
		const aiOk = aiAdopter && AI_PLANS.includes(plan0) && s.t0 >= aiStart;
		const replyMethod = () => (aiOk && chance.bool({ likelihood: aiUse * 100 }) ? "ai_draft"
			: chance.bool({ likelihood: macroHeavy ? 45 : 20 }) ? "macro" : "typed");
		const firstMethod = replyMethod();
		const frt = Math.min(FRT_MAX_MIN, FRT_MED_MIN * pm * (CHANNEL_FRT_MULT[s.channel] ?? 1) * logNormal(FRT_SIGMA)
			* (isWeekend(s.t0) ? WEEKEND_FRT_MULT : 1) * (variantOn ? ROUTING_FRT_MULT : 1) * (firstMethod === "ai_draft" ? AI_FRT_MULT : 1));
		const frtMins = Math.max(1, Math.round(frt));
		const t1 = s.t0 + frtMins * MIN_MS - chance.integer({ min: 0, max: 59 }) * 1000;
		const gap = Math.min(RESOLVE_MAX_H, RESOLVE_GAP_MED_H * pm * logNormal(RESOLVE_SIGMA)) * HOUR_MS;
		const t2 = t1 + gap;
		const resolved = chance.bool({ likelihood: RESOLVE_SHARE * 100 });
		const escalated = hashFloat(`${id}|${ESCALATE_SALT}`) < (ESCALATE_SHARE[s.priority] ?? 0.05); // salted per ticket
		const followups = Number(draw(FOLLOWUP_WEIGHTS));
		const reopened = resolved && chance.bool({ likelihood: REOPEN_BASE * (variantOn ? ROUTING_REOPEN_MULT : 1) * 100 });
		const csat = resolved && chance.bool({ likelihood: CSAT_RESPONSE * 100 });

		put("ticket assigned", s.t0, { channel: s.channel, priority: s.priority, category: s.category });
		put("reply sent", t1, { reply_method: firstMethod, is_first_reply: true, reply_length_chars: chance.integer({ min: 80, max: firstMethod === "ai_draft" ? 1400 : 1100 }) });
		if (escalated) put("ticket escalated", t1 + (0.1 + 0.4 * hashFloat(`${id}|escalate-at`)) * gap, { escalation_tier: hashFloat(`${id}|escalate-tier`) < 0.75 ? "tier_2" : "tier_3" });
		const fuEnd = resolved ? t2 : Math.min(END, t1 + 2 * gap);
		const fuTimes = Array.from({ length: followups }, () => t1 + chance.floating({ min: 0.15, max: 0.95 }) * (fuEnd - t1)).sort((a, b) => a - b);
		for (const tf of fuTimes) {
			const m = replyMethod();
			put("reply sent", tf, { reply_method: m, is_first_reply: false, reply_length_chars: chance.integer({ min: 40, max: 900 }) });
		}
		if (!resolved) continue;
		let replies = 1 + followups;
		put("ticket resolved", t2, { channel: s.channel, priority: s.priority, first_response_mins: frtMins, resolution_mins: Math.round((t2 - s.t0) / MIN_MS), replies_count: replies });
		let tFinal = t2;
		if (reopened) {
			const tR = t2 + Math.min(10 * DAY_MS, 20 * HOUR_MS * logNormal(0.8));
			put("ticket reopened", tR, { reopen_source: chance.bool({ likelihood: 85 }) ? "customer_reply" : "agent" });
			const tR1 = tR + Math.min(FRT_MAX_MIN, FRT_MED_MIN * pm * logNormal(FRT_SIGMA)) * MIN_MS;
			const m = replyMethod();
			put("reply sent", tR1, { reply_method: m, is_first_reply: false, reply_length_chars: chance.integer({ min: 40, max: 900 }) });
			replies += 1;
			tFinal = tR1 + 0.5 * gap;
			put("ticket resolved", tFinal, { channel: s.channel, priority: s.priority, first_response_mins: frtMins, resolution_mins: Math.round((tFinal - s.t0) / MIN_MS), replies_count: replies });
		}
		if (csat) {
			const pos = chance.bool({ likelihood: csatPositive(frtMins) * 100 });
			const score = pos ? (chance.bool({ likelihood: 60 }) ? 5 : 4) : Number(draw({ 3: 45, 2: 30, 1: 25 }));
			put("csat received", tFinal + chance.floating({ min: 0.5, max: 30 }) * HOUR_MS, { score, first_response_mins: frtMins, comment_left: chance.bool({ likelihood: pos ? 18 : 40 }) });
		}
	}
	events = events.filter((e) => !UNIT_STEPS.includes(e.event) && e.event !== "$experiment_started");

	// ── experiment exposure: 1 s before the first ticket after the test starts ──
	const firstAfter = unitEvents.filter((e) => e.event === "ticket assigned" && T(e) >= ms(ROUTING_START)).sort(byT)[0];
	if (variant !== null && firstAfter && (exposure || RUN.expTemplate)) {
		if (!exposure) {
			exposure = cloneEvent(RUN.expTemplate, { time: iso(T(firstAfter) - 1000), user_id: uid });
			const own = events.find((e) => e.device_id) || {};
			for (const k of DEVICE_FIELDS) { if (k in own) exposure[k] = own[k]; else delete exposure[k]; }
		}
		exposure.time = iso(T(firstAfter) - 1000);
		exposure["Variant name"] = variant;
		profile[EXP_KEY] = variant;
		events.push(exposure);
	} else if (profile[EXP_KEY] !== undefined) {
		delete profile[EXP_KEY];
	}

	// ── purchase: one subscription started ──
	let buyEv = null;
	if (purchase && purchase.t >= BEGIN) {
		// the purchase is a billing-server event: a workspace with no engine
		// template clones the run's first one (identity and company re-stamped)
		buyEv = buyTemplates[0] || null;
		if (!buyEv) {
			buyEv = cloneEvent(RUN.buyTemplate, { time: iso(purchase.t), user_id: uid });
			events.push(buyEv);
		}
		buyEv.time = iso(purchase.t);
		buyEv.plan = purchase.plan;
		buyEv.seats = purchase.seats;
		buyEv.billing_period = purchase.period;
	}
	// ── pricing page views: a trial owner who set up compares plans a salted
	// number of times on salted days of the trial; a buyer's last view sits
	// minutes before the purchase. Placement uses the would-be purchase time even
	// when it falls after the window, so the in-window series has no right edge ──
	const enginePricing = events.filter((e) => e.event === "pricing page viewed");
	if (!RUN.pricingTemplate && enginePricing.length) RUN.pricingTemplate = { ...enginePricing[0] };
	const pricingViews = [];
	const pricingOwn = signup || events.find((e) => e.device_id) || null;
	if (isTrial && RUN.pricingTemplate && pricingOwn?.device_id) {
		const own = pricingOwn;
		const until = buyAt ?? trialEnd + BUY_GRACE_DAYS * DAY_MS;
		const n = Number(pickWeighted(PRICING_VIEW_WEIGHTS, salt(uid, "pricing-n")));
		const view = (t, k) => {
			const v = cloneEvent(RUN.pricingTemplate, { time: iso(t), user_id: uid });
			for (const f of DEVICE_FIELDS) { if (f in own) v[f] = own[f]; else delete v[f]; }
			v.plan_viewed = pickWeighted(PLAN_VIEWED_WEIGHTS, salt(uid, `pricing-plan|${k}`));
			return v;
		};
		const others = buyAt !== null ? Math.max(0, n - 1) : n;
		for (let k = 0; k < others; k++) pricingViews.push(view(Math.floor(trialStart + salt(uid, `pricing-at|${k}`) * (until - trialStart)), k));
		if (buyAt !== null) pricingViews.push(view(buyAt - hashInt(`${uid}|pricing-lead`, 2, 25) * MIN_MS, "buy"));
	}
	events = events.filter((e) => (e.event !== "subscription started" || e === buyEv) && e.event !== "pricing page viewed").concat(pricingViews);

	// ── agent actions: holidays, volume realism ──
	// a new workspace's setup clock: its signup, or the trial start for trials begun just before June 4
	const setupStart = birthMs ?? (co.kind === "recent_trial" ? trialStart : null);
	const seenIntegration = new Set();
	events = events.filter((e) => {
		const t = T(e);
		if (t >= cut && !ONBOARDING.has(e.event)) return false;
		if (!AGENT_ACTIONS.has(e.event)) return true;
		if (keepMacros.has(e)) return true;
		if (americas && isUsHoliday(t) && chance.bool({ likelihood: HOLIDAY_ACTION_DROP * 100 })) return false;
		// workspace setup belongs to admins; new workspaces connect each tool once,
		// established customers only now and then (their tools are already connected)
		// a new workspace sets itself up in its first weeks, then settles
		const settingUp = setupStart !== null && t < setupStart + SETUP_DAYS * DAY_MS;
		if (e.event === "integration connected") {
			if (profile.role !== "admin" || seenIntegration.has(e.integration)) return false;
			if (setupStart !== null && !settingUp) return false;
			seenIntegration.add(e.integration);
			return chance.bool({ likelihood: settingUp ? 50 : 15 });
		}
		if (e.event === "automation rule created") {
			if (profile.role === "agent") return false;
			return chance.bool({ likelihood: settingUp ? 60 : profile.role === "admin" ? 25 : 12 });
		}
		if (e.event === "kb article published") return chance.bool({ likelihood: settingUp ? 50 : profile.role === "agent" ? 8 : 35 });
		if (e.event === "macro created" && setupStart !== null && t >= setupStart + MACRO_DAYS * DAY_MS) return chance.bool({ likelihood: 35 });
		return true;
	});

	events = events.concat(unitEvents).filter((e) => T(e) >= BEGIN);
	finish(events, planAt);
	profile.plan_tier = planAt(END);
	if (purchase) {
		co.seats = purchase.seats;
		profile.agent_seats = purchase.seats;
	}
	co.finalPlan = profile.plan_tier;
	return events;
}

// warehouse rows: exogenous business facts layered on event-derived volumes
// email incident days → stuck tickets / stuck spam (keyed by date); per channel, the
// last 7 days' arrivals (rows of one channel arrive in date order; reset on the first day)
const WH_STATE = { stuck: new Map(), autoStuck: new Map(), arrivals: new Map() };
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "paid_marketing_daily") {
		const k = `${row.date}|${row.acquisition_channel}`;
		const spend = paidSpend(row.date, row.acquisition_channel, row.spend_usd);
		row.spend_usd = spend;
		row.signups_reported = Math.round(spend * PLATFORM_LEAD_INFLATION / CPL_USD[row.acquisition_channel] * jitter(`lead|${k}`, 0.25));
		row.clicks = Math.round(spend / (CPC_USD[row.acquisition_channel] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[row.acquisition_channel] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "inbound_channel_daily") {
		const k = `${row.date}|${row.channel}`;
		if (row.date === D0) WH_STATE.arrivals.delete(row.channel);
		const assigned = row.tickets_ingested;
		const merged = Math.round(assigned * MERGED_SHARE * jitter(`merged|${k}`, 1));
		// spam and notifications arrive with the day's real traffic (weekday shape,
		// growth). During the email incident the stuck share of tickets and of
		// spam is processed with the backlog on the fix day. Rows of one channel
		// arrive in date order, so the incident days are seen before the backlog day.
		const isEmail = row.channel === INCIDENT_CHANNEL;
		let arrivals = assigned;
		if (isEmail && INCIDENT_DAYS.includes(row.date)) {
			arrivals = assigned / (1 - INCIDENT_DELAY_SHARE);
			WH_STATE.stuck.set(row.date, arrivals - assigned);
		} else if (isEmail && row.date === BACKLOG_DAY) {
			const missing = INCIDENT_DAYS.filter((d) => !WH_STATE.stuck.has(d));
			if (missing.length) throw new Error(`support-desk: backlog row ${row.date} seen before incident rows ${missing.join(", ")}`);
			arrivals = Math.max(0, assigned - INCIDENT_DAYS.reduce((sum, d) => sum + WH_STATE.stuck.get(d), 0));
		}
		const hist = WH_STATE.arrivals.get(row.channel) ?? [];
		const level = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : arrivals;
		WH_STATE.arrivals.set(row.channel, hist.concat(arrivals).slice(-7));
		const autoArrived = Math.round(arrivals * (AUTO_REPLY_SHARE[row.channel] ?? 0) * jitter(`auto|${k}`, AUTO_NOISE)
			+ level * (SPAM_SHARE[row.channel] ?? 0) * jitter(`spam|${k}`, SPAM_NOISE)
			* (hashFloat(`spam-wave|${k}`) < SPAM_WAVE_SHARE ? 2 + 2 * hashFloat(`spam-wave-size|${k}`) : 1));
		let auto = autoArrived;
		if (isEmail && INCIDENT_DAYS.includes(row.date)) {
			const stuck = Math.round(autoArrived * INCIDENT_DELAY_SHARE * jitter(`auto-stuck|${row.date}`, 0.1));
			WH_STATE.autoStuck.set(row.date, stuck);
			auto -= stuck;
		}
		if (isEmail && row.date === BACKLOG_DAY) for (const d of INCIDENT_DAYS) auto += WH_STATE.autoStuck.get(d);
		// intake and routing disagree a little every day: agents log some tickets by
		// hand (phone calls, imports) that never pass intake, and delete a few ingested
		// tickets before they are routed
		row.tickets_ingested = Math.round(assigned * jitter(`drift|${k}`, INTAKE_DRIFT)) + merged + auto;
		row.tickets_auto_closed = auto;
		row.tickets_merged = merged;
		if (row.ingestion_status === "degraded") {
			// stuck tickets are logged when they were received; most of the day's mail
			row.tickets_delayed_over_1h = Math.round(WH_STATE.stuck.get(row.date) * jitter(`delay|${k}`, 0.08)) + WH_STATE.autoStuck.get(row.date);
		}
		return row;
	}
	if (meta.metricName === "subscription_billing_daily") {
		const k = `${row.date}|${row.plan}`;
		let subs = meta.raw?.plus?.count ?? 0;
		let seats = row.seats_purchased;
		if (hashFloat(`untracked|${k}`) < UNTRACKED_PURCHASE_SHARE) { subs += 1; seats += 1 + Math.floor(hashFloat(`untracked-seats|${k}`) * 3); }
		if (seats > 1 && hashFloat(`edit|${k}`) < SEAT_EDIT_SHARE) seats += hashFloat(`edit-dir|${k}`) < 0.5 ? -1 : 1;
		row.seats_purchased = seats;
		row.new_subscriptions = subs;
		row.new_mrr_usd = round2(seats * row.list_price_per_seat_usd);
		return row;
	}
	return row;
}

function handleGroup(record) {
	const co = companyOf(record.company_id);
	if (!co || co.members === 0) return null;
	record.name = co.name;
	record.company_size = co.size;
	record.industry = co.industry;
	record.region = co.region;
	record.plan_tier = co.finalPlan;
	record.agent_seats = co.seats;
	record.email_provider = co.email_provider;
	record.customer_since = co.customer_since;
	record.acquisition_channel = co.acquisition_channel;
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
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
	credentials: { token },
	switches: {
		hasSessionIds: false,
		alsoInferFunnels: false,
		hasLocation: false,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 1.6 },

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { google: 45, email: 35, microsoft: 20 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
				email_provider: (ctx) => ctx.profile.email_provider,
			},
		},
		{
			event: "inbox connected",
			weight: 1,
			isStrictEvent: true,
			properties: {
				email_provider: (ctx) => ctx.profile.email_provider,
				connection_method: { __weights: { oauth: 70, forwarding: 30 } },
			},
		},
		{
			event: "widget installed",
			weight: 1,
			isStrictEvent: false,
			properties: {
				install_method: { __weights: { snippet: 55, shopify_app: 25, wordpress_plugin: 20 } },
			},
		},
		{
			event: "ticket assigned",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ticket_id: ["unassigned"],
				channel: { __weights: CHANNEL_WEIGHTS_T },
				priority: { __weights: PRIORITY_WEIGHTS },
				category: { __weights: CATEGORY_WEIGHTS },
			},
		},
		{
			event: "reply sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ticket_id: ["unassigned"],
				reply_method: ["typed"],
				is_first_reply: [false],
				reply_length_chars: [300],
			},
		},
		{
			event: "ticket escalated",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ticket_id: ["unassigned"],
				escalation_tier: ["tier_2"],
			},
		},
		{
			event: "ticket resolved",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ticket_id: ["unassigned"],
				channel: ["email"],
				priority: ["normal"],
				first_response_mins: [0],
				resolution_mins: [0],
				replies_count: [1],
			},
		},
		{
			event: "ticket reopened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ticket_id: ["unassigned"],
				reopen_source: ["customer_reply"],
			},
		},
		{
			event: "csat received",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ticket_id: ["unassigned"],
				score: [4],
				first_response_mins: [0],
				comment_left: [false],
			},
		},
		{
			event: "queue viewed",
			weight: 8,
			properties: {
				view_name: { __weights: { my_open_tickets: 40, unassigned: 22, urgent: 10, all_open: 16, sla_at_risk: 12 } },
			},
		},
		{
			event: "search performed",
			weight: 3,
			properties: {
				search_scope: { __weights: { tickets: 55, customers: 25, knowledge_base: 20 } },
				results_count: u.weighNumRange(0, 60, 0.4, 8),
			},
		},
		{
			event: "kb article viewed",
			weight: 3,
			properties: {
				article_category: { __weights: { billing: 20, troubleshooting: 30, account: 18, shipping: 14, getting_started: 18 } },
				view_source: { __weights: { search: 55, ticket_sidebar: 45 } },
			},
		},
		{
			event: "internal note added",
			weight: 3,
			properties: {
				mentions_count: [0, 0, 0, 1, 1, 2],
			},
		},
		{
			event: "customer profile viewed",
			weight: 3,
			properties: {
				customer_tier: { __weights: { standard: 70, vip: 18, at_risk: 12 } },
			},
		},
		{
			event: "report viewed",
			weight: 2,
			properties: {
				report_type: { __weights: { first_response_time: 24, csat: 22, ticket_volume: 26, agent_performance: 16, sla_compliance: 12 } },
			},
		},
		{
			event: "macro created",
			weight: 2,
			properties: {
				macro_category: { __weights: { greeting: 15, refund: 18, shipping_status: 16, password_reset: 18, troubleshooting: 20, closing: 13 } },
			},
		},
		{
			event: "kb article published",
			weight: 1,
			properties: {
				article_category: { __weights: { billing: 20, troubleshooting: 30, account: 18, shipping: 14, getting_started: 18 } },
			},
		},
		{
			event: "automation rule created",
			weight: 1,
			properties: {
				trigger_type: { __weights: { ticket_created: 40, sla_breach: 20, tag_added: 25, customer_replied: 15 } },
			},
		},
		{
			event: "integration connected",
			weight: 1,
			properties: {
				integration: { __weights: { slack: 30, shopify: 25, jira: 18, salesforce: 15, stripe: 12 } },
			},
		},
		{
			event: "pricing page viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan_viewed: { __weights: { growth: 55, starter: 35, enterprise: 10 } },
			},
		},
		{
			event: "subscription started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: ["growth"],
				seats: [1],
				billing_period: ["monthly"],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [ROUTING_EXPERIMENT],
				"Variant name": ["Control", ROUTING_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "inbox connected"],
			isFirstFunnel: true,
			conditions: { email_provider: { neq: "microsoft_365" } },
			conversionRate: INBOX_CONV,
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Onboarding",
			sequence: ["account created", "inbox connected"],
			isFirstFunnel: true,
			conditions: { email_provider: "microsoft_365" },
			conversionRate: M365_INBOX_CONV,
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Ticket",
			sequence: ["ticket assigned", "reply sent", "ticket escalated", "reply sent", "ticket resolved", "ticket reopened", "csat received"],
			conversionRate: 100,
			timeToConvert: 4,
			order: "sequential",
			weight: 3,
			props: {
				ticket_id: () => `tk_${chance.hash({ length: 12 })}`,
			},
			experiment: {
				name: ROUTING_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(ROUTING_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: ROUTING_VARIANT }],
			},
		},
		{
			name: "Trial purchase",
			sequence: ["pricing page viewed", "subscription started"],
			conditions: { plan_tier: "trial" },
			conversionRate: 100,
			timeToConvert: 0.5,
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
				// set by the warehouse hook from the day's spend
				signups_reported: 0,
				clicks: 0,
				impressions: 0,
			},
		},
		{
			name: "inbound_channel_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "ticket assigned",
				measure: "count",
				groupBy: "channel",
			},
			timeColumn: "date",
			valueColumn: "tickets_ingested",
			columns: {
				tickets_auto_closed: 0,
				tickets_merged: 0,
				tickets_delayed_over_1h: (ctx) => Math.round(ctx.value * 0.004 * (0.5 + hashFloat(`d1h|${dayKey(ctx.time)}|${ctx.seriesKey}`))),
				p95_ingest_latency_sec: (ctx) => {
					const hit = ctx.row.channel === INCIDENT_CHANNEL && inIncident(ctx.time);
					const j = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? Math.round(21_600 + j * 30_000) : Math.round(18 + j * 40);
				},
				ingestion_status: (ctx) => (ctx.row.channel === INCIDENT_CHANNEL && inIncident(ctx.time) ? "degraded" : "operational"),
			},
		},
		{
			name: "subscription_billing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "subscription started",
				measure: "sum",
				property: "seats",
				groupBy: "plan",
			},
			timeColumn: "date",
			valueColumn: "seats_purchased",
			columns: {
				new_subscriptions: 0,
				list_price_per_seat_usd: (ctx) => pricePerSeat(ctx.row.plan, ctx.time),
				new_mrr_usd: 0,
			},
		},
	],

	superProps: {
		plan_tier: ["trial"],
	},

	userProps: {
		company_id: ["1"],
		company_name: ["unknown"],
		company_size: ["small"],
		industry: ["ecommerce"],
		region: ["americas"],
		role: ["agent"],
		plan_tier: ["trial"],
		email_provider: ["google_workspace"],
		acquisition_channel: { __weights: ACQ_WEIGHTS },
		customer_since: ["2025-01-01"],
		agent_seats: [1],
	},

	personas: [
		{ name: "frontline_agent", weight: 50, eventMultiplier: 1.6, properties: { role: "agent" } },
		{ name: "occasional_agent", weight: 22, eventMultiplier: 0.6, properties: { role: "agent" } },
		{ name: "team_lead", weight: 16, eventMultiplier: 1.0, properties: { role: "team_lead" } },
		{ name: "support_admin", weight: 12, eventMultiplier: 0.6, properties: { role: "admin" } },
	],

	groupKeys: [["company_id", COMPANY_ID_CAP, []]],
	groupProps: {
		company_id: {
			name: ["unknown"],
			company_size: ["small"],
			industry: ["ecommerce"],
			region: ["americas"],
			plan_tier: ["trial"],
			agent_seats: [1],
			email_provider: ["google_workspace"],
			customer_since: ["2025-01-01"],
			acquisition_channel: ["organic"],
		},
	},

	retentionCurve: { type: "logarithmic", day1: 0.65, day7: 0.5, day30: 0.38 },

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
//   node dungeons/vertical/support-desk/support-desk.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user seen with it on any event
// that carries both ids (emitted stitch evidence). Every Ticketloop event
// carries user_id, so the device map only matters for completeness.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;
// one row per ticket: assignment (with plan at that moment), first reply, first resolution
const TICKET_CTE = `a AS (SELECT ticket_id, any_value(uid) AS uid, min(t) AS t0, any_value(priority) AS priority, any_value(channel) AS channel,
  any_value(plan_tier) AS plan FROM ev WHERE event = 'ticket assigned' GROUP BY 1),
r AS (SELECT ticket_id, min(t) AS t1, arg_min(reply_method, t) AS method FROM ev WHERE event = 'reply sent' GROUP BY 1),
s AS (SELECT ticket_id, min(t) AS t2 FROM ev WHERE event = 'ticket resolved' GROUP BY 1)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
// knob-centred assertion with both bounds: NAILED within ±10% of the knob,
// STRONG inside [lower, upper] (a knob-derived sanity bound and floor), WEAK outside
const knobAssert = (observe, knob, lower, upper) => (rows) => {
	const x = observe(rows);
	if (!Number.isFinite(x)) return { verdict: "NONE", detail: `observed ${x}: not computable` };
	const f = (n) => Math.round(n * 10000) / 10000;
	if (Math.abs(x - knob) <= 0.1 * Math.abs(knob)) return { verdict: "NAILED", detail: `observed ${f(x)} within ±10% of knob ${f(knob)}` };
	if (x >= lower && x <= upper) return { verdict: "STRONG", detail: `observed ${f(x)} within [${f(lower)}, ${f(upper)}]` };
	return { verdict: "WEAK", detail: `observed ${f(x)} outside [${f(lower)}, ${f(upper)}]` };
};
const pickRow = (rows, grp) => rows.find((r) => r.grp === grp) ?? {};
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const daysBeforeEnd = (n) => TS(dayjs.utc(DATASET_END).subtract(n, "day").toISOString());
const FRT_WINDOW_DAYS = 7;          // H1/H5 read: Funnels window ticket assigned → reply sent
const RESOLVE_WINDOW_DAYS = 14;     // H2 read: Funnels window ticket assigned → ticket resolved
const ONBOARD_WINDOW_DAYS = 7;      // H3 read
const PAID_WINDOW_DAYS = 30;        // H4 read: account created → subscription started (Mixpanel default window)
const REOPEN_READ_DAYS = 21;        // H5 read: tickets assigned at least 21 days before the end
const AI_RAMPED = TS(dayjs.utc(AI_LAUNCH).add(AI_RAMP_DAYS, "day").toISOString());
const INC_BASE_DAYS = 14;           // H6 read: baseline days either side of the incident (backlog day excluded)
const INC_BASE_FROM = TS(dayjs.utc(EMAIL_INCIDENT_START).subtract(INC_BASE_DAYS, "day").toISOString());
const INC_BACKLOG_DAY = D(EMAIL_INCIDENT_END);
const INC_BASE_TO = TS(dayjs.utc(EMAIL_INCIDENT_END).add(INC_BASE_DAYS + 1, "day").toISOString());
const BTS_BASE_WEEKS = 8;          // H8 read: season vs the 8 weeks before
const BTS_BEFORE = TS(dayjs.utc(BTS_START).subtract(BTS_BASE_WEEKS * 7, "day").toISOString());
const RET_FROM = 28, RET_TO = 42;   // H9 read: queue viewed on day 28-41 after signup
const GROWTH_KEEP = 1 - GROWTH_DOWNGRADE_AFTER;

const H1_SQL = `WITH ${ID_CTE}, ${TICKET_CTE}
SELECT CASE WHEN r.method = 'ai_draft' THEN 'ai' ELSE 'other' END AS grp, count(DISTINCT a.uid) AS user_count, count(*) AS tickets,
 median(date_diff('second', a.t0, r.t1)) / 60.0 AS med_frt,
 count(*) FILTER (WHERE a.t0 >= TIMESTAMP '${AI_RAMPED}') AS ramped_tickets
FROM a JOIN r ON r.ticket_id = a.ticket_id
WHERE a.plan IN (${SQL_LIST(AI_PLANS)}) AND a.t0 >= TIMESTAMP '${TS(AI_LAUNCH)}' AND a.t0 < TIMESTAMP '${daysBeforeEnd(FRT_WINDOW_DAYS)}'
  AND r.t1 < a.t0 + INTERVAL ${FRT_WINDOW_DAYS} DAY
GROUP BY 1`;

const H2_SQL = `WITH ${ID_CTE}, ${TICKET_CTE}
SELECT a.priority AS grp, count(DISTINCT a.uid) AS user_count, count(*) AS tickets,
 median(date_diff('second', a.t0, s.t2)) / 3600.0 AS med_hours
FROM a JOIN s ON s.ticket_id = a.ticket_id
WHERE a.t0 < TIMESTAMP '${daysBeforeEnd(RESOLVE_WINDOW_DAYS)}' AND s.t2 < a.t0 + INTERVAL ${RESOLVE_WINDOW_DAYS} DAY
GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE},
su AS (SELECT uid, min(t) AS t0, any_value(email_provider) AS prov FROM ev WHERE event = 'account created' GROUP BY 1),
ib AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'inbox connected' GROUP BY 1),
wg AS (SELECT uid, min(t) AS t2 FROM ev WHERE event = 'widget installed' GROUP BY 1),
x AS (SELECT su.uid, su.prov, coalesce(ib.t1 >= su.t0 AND wg.t2 >= ib.t1 AND wg.t2 < su.t0 + INTERVAL ${ONBOARD_WINDOW_DAYS} DAY, false) AS done,
  coalesce(ib.t1 >= su.t0 AND ib.t1 < su.t0 + INTERVAL ${ONBOARD_WINDOW_DAYS} DAY, false) AS inbox
  FROM su LEFT JOIN ib ON ib.uid = su.uid LEFT JOIN wg ON wg.uid = su.uid WHERE su.t0 < TIMESTAMP '${daysBeforeEnd(ONBOARD_WINDOW_DAYS)}')
SELECT CASE WHEN prov = 'microsoft_365' THEN 'microsoft_365' ELSE 'others' END AS grp, count(*) AS user_count, avg(done::INT) AS completion, avg(inbox::INT) AS inbox_rate
FROM x GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
su AS (SELECT uid, min(t) AS t0, any_value(acquisition_channel) AS ch FROM ev WHERE event = 'account created' GROUP BY 1),
b AS (SELECT uid, min(t) AS tb FROM ev WHERE event = 'subscription started' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_marketing_daily")} GROUP BY 1),
g AS (SELECT su.ch, count(*) AS signups,
  count(*) FILTER (WHERE su.t0 < TIMESTAMP '${daysBeforeEnd(PAID_WINDOW_DAYS)}') AS mature,
  count(*) FILTER (WHERE su.t0 < TIMESTAMP '${daysBeforeEnd(PAID_WINDOW_DAYS)}' AND b.tb >= su.t0 AND b.tb < su.t0 + INTERVAL ${PAID_WINDOW_DAYS} DAY) AS paid30
  FROM su LEFT JOIN b ON b.uid = su.uid GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.paid30::DOUBLE / g.mature AS paid_rate, sp.spend / g.signups AS spend_per_signup,
 sp.spend / nullif(g.paid30, 0) AS spend_per_paid
FROM g LEFT JOIN sp ON sp.ch = g.ch`;

const H5_SQL = `WITH ${ID_CTE}, ${TICKET_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
ro AS (SELECT DISTINCT ticket_id FROM ev WHERE event = 'ticket reopened'),
x AS (SELECT v.variant, a.uid, a.t0, date_diff('second', a.t0, r.t1) / 60.0 AS frt, r.t1 < a.t0 + INTERVAL ${FRT_WINDOW_DAYS} DAY AS replied,
  s.t2 IS NOT NULL AS resolved, ro.ticket_id IS NOT NULL AS reopened
  FROM a JOIN v ON v.uid = a.uid LEFT JOIN r ON r.ticket_id = a.ticket_id LEFT JOIN s ON s.ticket_id = a.ticket_id LEFT JOIN ro ON ro.ticket_id = a.ticket_id
  WHERE a.t0 >= TIMESTAMP '${TS(ROUTING_START)}')
SELECT variant AS grp, count(DISTINCT uid) AS user_count,
 median(frt) FILTER (WHERE replied AND t0 < TIMESTAMP '${daysBeforeEnd(FRT_WINDOW_DAYS)}') AS med_frt,
 avg(reopened::INT) FILTER (WHERE resolved AND t0 < TIMESTAMP '${daysBeforeEnd(REOPEN_READ_DAYS)}') AS reopen_rate
FROM x GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, channel FROM ${WH("inbound_channel_daily")} WHERE ingestion_status = 'degraded'),
od AS (SELECT DISTINCT d FROM o), oc AS (SELECT DISTINCT channel FROM o),
w AS (SELECT t::DATE AS d, uid, (channel IN (SELECT channel FROM oc)) AS hit FROM ev
  WHERE event = 'ticket assigned' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}' AND t::DATE <> DATE '${INC_BACKLOG_DAY}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE hit)::DOUBLE / count(*) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`;

const H8_SQL = `WITH ${ID_CTE},
u AS (SELECT distinct_id::VARCHAR AS uid, industry FROM ${US} WHERE customer_since < '${D0}' AND region IN (${SQL_LIST(BTS_REGIONS)})),
w AS (SELECT CASE WHEN ev.t >= TIMESTAMP '${TS(BTS_START)}' AND ev.t < TIMESTAMP '${TS(BTS_END)}' THEN 'season'
    WHEN ev.t >= TIMESTAMP '${BTS_BEFORE}' AND ev.t < TIMESTAMP '${TS(BTS_START)}' THEN 'before' END AS per,
  u.industry = '${BTS_INDUSTRY}' AS hit, ev.uid FROM ev JOIN u ON u.uid = ev.uid WHERE ev.event = 'ticket assigned'),
g AS (SELECT per, hit, count(*) AS n, count(DISTINCT uid) AS users FROM w WHERE per IS NOT NULL GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) FILTER (WHERE hit) AS user_count,
 (max(n) FILTER (WHERE hit AND per = 'season')::DOUBLE / max(n) FILTER (WHERE hit AND per = 'before'))
 / (max(n) FILTER (WHERE NOT hit AND per = 'season')::DOUBLE / max(n) FILTER (WHERE NOT hit AND per = 'before')) AS did
FROM g`;

const H9_SQL = `WITH ${ID_CTE},
su AS (SELECT uid, min(t) AS t0 FROM ev WHERE event = 'account created' GROUP BY 1),
ib AS (SELECT DISTINCT uid FROM ev WHERE event = 'inbox connected'),
x AS (SELECT su.uid,
  count(*) FILTER (WHERE e.event = 'macro created' AND e.t >= su.t0 AND e.t < su.t0 + INTERVAL ${MACRO_DAYS} DAY) AS macros,
  bool_or(e.event = 'queue viewed' AND e.t >= su.t0 + INTERVAL ${RET_FROM} DAY AND e.t < su.t0 + INTERVAL ${RET_TO} DAY) AS ret
  FROM su JOIN ib ON ib.uid = su.uid LEFT JOIN ev e ON e.uid = su.uid
  WHERE su.t0 <= TIMESTAMP '${daysBeforeEnd(RET_TO)}' GROUP BY 1)
SELECT CASE WHEN macros >= ${MACRO_MIN} THEN 'macros_3plus' ELSE 'under_3' END AS grp, count(*) AS user_count, avg(coalesce(ret, false)::INT) AS retention
FROM x GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${TS(GROWTH_PRICE_CHANGE)}' THEN 'after' ELSE 'before' END AS grp, count(DISTINCT uid) AS user_count,
 count(*) AS subs, avg((plan = 'growth')::INT) AS growth_share
FROM ev WHERE event = 'subscription started' GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-reply-assist-launch",
		hook: "H1",
		archetype: "funnel-ttc-by-segment",
		narrative: `Reply Assist (AI reply drafts) launches ${D(AI_LAUNCH)} for Growth and Enterprise workspaces. ${AI_ADOPTER_SHARE * 100}% of agents on those plans adopt it on a salted day in the ${AI_RAMP_DAYS} days after launch and draft a salted ${AI_USE_MIN * 100}-${AI_USE_MAX * 100}% of their replies with it (reply_method = ai_draft), so about ${AI_ADOPTION * 100}% of eligible first replies are AI drafts once the ramp is done. An AI-drafted first reply arrives in ${AI_FRT_MULT}x the time. Read: per ticket, minutes from ticket assigned to the first reply sent (7-day window) for tickets on Growth/Enterprise assigned after launch, AI drafts vs other replies. No AI draft exists before launch or on another plan.`,
		mixpanelReport: { type: "Funnels", steps: ["ticket assigned", "reply sent"], counting: "totals", holdPropertyConstant: "ticket_id", window: `${FRT_WINDOW_DAYS} days`, filter: "step 1 plan_tier in (growth, enterprise)", dateRange: `${D(AI_LAUNCH)} to ${daysBeforeEnd(FRT_WINDOW_DAYS).slice(0, 10)}`, breakdown: "reply_method (step 2)", measure: "median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { ai: { where: { grp: "ai" } }, o: { where: { grp: "other" } } },
				expect: { metric: "ai.med_frt / o.med_frt", op: "between", target: band(AI_FRT_MULT) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${TICKET_CTE}
SELECT 'all' AS grp, count(DISTINCT a.uid) AS user_count, avg((r.method = 'ai_draft')::INT) AS ai_share
FROM a JOIN r ON r.ticket_id = a.ticket_id
WHERE a.plan IN (${SQL_LIST(AI_PLANS)}) AND a.t0 >= TIMESTAMP '${AI_RAMPED}'`,
				},
				select: { a: { where: { grp: "all" } } },
				// adopters (salted per agent, independent of volume) x mean use share
				expect: { metric: "a.ai_share", op: "between", target: band(AI_ADOPTION) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE reply_method = 'ai_draft' AND (t < TIMESTAMP '${TS(AI_LAUNCH)}' OR plan_tier NOT IN (${SQL_LIST(AI_PLANS)}))) AS impure
FROM ev WHERE event = 'reply sent'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: an AI draft before launch or on Free/Starter/trial is a bug
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-resolution-time-by-priority",
		hook: "H2",
		archetype: "funnel-ttc-by-segment",
		narrative: `Every timing of a ticket scales with its priority (first reply and the work to resolve it): urgent ${PRIORITY_MULT.urgent}x, high ${PRIORITY_MULT.high}x, normal 1x, low ${PRIORITY_MULT.low}x. Channel, weekend, Reply Assist, and the routing test act on all priorities alike, so the median time from ticket assigned to ticket resolved (per ticket, ${RESOLVE_WINDOW_DAYS}-day window) reads the multiplier against normal.`,
		mixpanelReport: { type: "Funnels", steps: ["ticket assigned", "ticket resolved"], counting: "totals", holdPropertyConstant: "ticket_id", window: `${RESOLVE_WINDOW_DAYS} days`, breakdown: "priority", measure: "median time to convert", alt: "Insights, ticket resolved, median resolution_mins by priority (reads slightly higher: it includes the second resolution of reopened tickets and has no 14-day window)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { x: { where: { grp: "urgent" } }, n: { where: { grp: "normal" } } },
				expect: { metric: "x.med_hours / n.med_hours", op: "between", target: band(PRIORITY_MULT.urgent) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { x: { where: { grp: "low" } }, n: { where: { grp: "normal" } } },
				expect: { metric: "x.med_hours / n.med_hours", op: "between", target: band(PRIORITY_MULT.low) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H3-microsoft-365-onboarding",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `Trial signups whose company mail runs on Microsoft 365 stall at the inbox step (admin consent): ${M365_INBOX_CONV}% connect their support inbox vs ${INBOX_CONV}% for Google Workspace and other providers (two declared first funnels with email_provider conditions). ${WIDGET_SHARE * 100}% of those who connect install the help widget a few hours later, whatever the provider, so full setup (account created → inbox connected → widget installed, ${ONBOARD_WINDOW_DAYS} days) reads the same ${(M365_INBOX_CONV / INBOX_CONV).toFixed(3)}x. Signups who never connect an inbox browse for up to ${NONCOMPLETER_DAYS} days and leave.`,
		mixpanelReport: { type: "Funnels", steps: ["account created", "inbox connected", "widget installed"], window: `${ONBOARD_WINDOW_DAYS} days`, breakdown: "email_provider" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { m: { where: { grp: "microsoft_365" } }, o: { where: { grp: "others" } } },
				expect: { metric: "m.completion / o.completion", op: "between", target: band(M365_INBOX_CONV / INBOX_CONV) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { m: { where: { grp: "microsoft_365" } }, o: { where: { grp: "others" } } },
				// the loss sits at the inbox step
				expect: { metric: "m.inbox_rate / o.inbox_rate", op: "between", target: band(M365_INBOX_CONV / INBOX_CONV) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H4-paid-channel-economics",
		hook: "H4",
		archetype: "external-join",
		narrative: `Capterra is the cheapest paid channel per trial signup and the weakest at turning trials into customers. Warehouse paid_marketing_daily bills each paid channel: half of each day's spend is a paced budget (weekday shape above a ${SPEND_FLAT_SHARE * 100}% floor), half the bid x that day's delivered signups, with seeded ±${SPEND_NOISE * 100}% day noise: $${CPL_USD.google_ads} Google Ads, $${CPL_USD.capterra} Capterra, $${CPL_USD.linkedin_ads} LinkedIn Ads per Mixpanel signup over the window. Each trial owner who connects an inbox buys with probability ${BUY_MAX} x a channel keep share (LinkedIn ${BUY_KEEP.linkedin_ads}, partner referral ${BUY_KEEP.partner_referral}, organic ${BUY_KEEP.organic}, Google ${BUY_KEEP.google_ads}, Shopify App Store ${BUY_KEEP.shopify_app_store}, Capterra ${BUY_KEEP.capterra}), 1-21 days after signup. Setup completion does not depend on channel, so 30-day paid conversion reads the keep ratio: Capterra / LinkedIn = ${BUY_KEEP.capterra}.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_marketing_daily.spend_usd", funnel: `account created → subscription started, ${PAID_WINDOW_DAYS}-day window, signups ${D0} to ${daysBeforeEnd(PAID_WINDOW_DAYS).slice(0, 10)}, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { c: { where: { grp: "capterra" } }, g: { where: { grp: "google_ads" } } },
				expect: { metric: "c.spend_per_signup / g.spend_per_signup", op: "between", target: band(CPL_USD.capterra / CPL_USD.google_ads) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { c: { where: { grp: "capterra" } }, l: { where: { grp: "linkedin_ads" } } },
				expect: { metric: "c.paid_rate / l.paid_rate", op: "between", target: band(BUY_KEEP.capterra / BUY_KEEP.linkedin_ads) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H5-skills-routing-experiment",
		hook: "H5",
		archetype: "experiment-lift",
		narrative: `The "${ROUTING_EXPERIMENT}" test starts ${D(ROUTING_START)}. Routing is a workspace setting, so customer accounts (2+ agents) are randomized: within each plan, accounts are paired by size and one of each pair gets the variant; every agent in the account shares the arm (profile "${EXP_KEY}", exposure $experiment_started 1 s before the agent's first ticket after the start). Single-agent workspaces (Free, trials, self-serve buyers) have no one to route between and are not in the test. In the "${ROUTING_VARIANT}" arm tickets are routed by agent skill instead of round robin: first replies take ${ROUTING_FRT_MULT}x the time and the reopen rate is ${ROUTING_REOPEN_MULT}x (${REOPEN_BASE * 100}% → ${Math.round(REOPEN_BASE * ROUTING_REOPEN_MULT * 1000) / 10}%). Reply Assist adoption is independent of the arm. Read: per ticket assigned after the start, median minutes to the first reply (7-day window) and the share of resolved tickets later reopened, by profile "${EXP_KEY}".`,
		mixpanelReport: { type: "Funnels + Insights", steps: ["ticket assigned", "reply sent"], counting: "totals", holdPropertyConstant: "ticket_id", window: `${FRT_WINDOW_DAYS} days`, dateRange: `from ${D(ROUTING_START)}`, breakdown: `user property "${EXP_KEY}"`, measure: "median time to convert; Insights ticket reopened / ticket resolved by the same breakdown" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { v: { where: { grp: ROUTING_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.med_frt / c.med_frt", op: "between", target: band(ROUTING_FRT_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { v: { where: { grp: ROUTING_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.reopen_rate / c.reopen_rate", op: "between", target: band(ROUTING_REOPEN_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${ROUTING_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(ROUTING_START)}') AS early
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// size-matched account pairs, one arm each → about 0.5 of exposed agents
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H6-email-ingestion-incident",
		hook: "H6",
		archetype: "external-join",
		narrative: `From ${D(EMAIL_INCIDENT_START)} to ${D(EMAIL_INCIDENT_END)} (exclusive) a fault in the email ingestion pipeline leaves ${INCIDENT_DELAY_SHARE * 100}% of incoming email tickets stuck (a salted draw per ticket); the stuck share of spam and auto-replies is processed with the backlog too (warehouse tickets_auto_closed); they reach agents only after the fix, in the first ${BACKLOG_FLUSH_H} hours of ${INC_BACKLOG_DAY}. Chat, web form, and API tickets are untouched. The incident days come from warehouse inbound_channel_daily (ingestion_status = 'degraded' for email). Event read: email/other ratio of "ticket assigned" on the degraded days vs the ${INC_BASE_DAYS} days either side (the backlog day excluded) reads 1 - ${INCIDENT_DELAY_SHARE} (knob target; a half-effect floor absorbs the per-ticket draw noise).`,
		mixpanelReport: { type: "Insights", event: "ticket assigned", measure: "total", breakdown: "channel", chart: "daily line", join: "warehouse inbound_channel_daily.ingestion_status" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { a: { where: { grp: "all" } } },
				// the stuck share is a salted draw per ticket over about 1,100 email tickets, and the
				// day counts carry their own noise (ratio SE about 6%): NAILED at the knob ±10%,
				// STRONG between half the knob ratio (an overshoot must not pass) and the half-effect floor
				assert: knobAssert((rows) => pickRow(rows, "all").did, 1 - INCIDENT_DELAY_SHARE, 0.5 * (1 - INCIDENT_DELAY_SHARE), 1 - 0.5 * INCIDENT_DELAY_SHARE),
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE ingestion_status = 'degraded' AND channel = '${INCIDENT_CHANNEL}') AS email_degraded_rows,
 count(*) FILTER (WHERE ingestion_status = 'degraded' AND channel <> '${INCIDENT_CHANNEL}') AS other_degraded_rows
FROM ${WH("inbound_channel_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: two degraded email days, nothing else
				expect: { metric: "a.email_degraded_rows", op: "between", target: [2, 2] },
			},
		],
	},
	{
		id: "H7-fast-replies-csat",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `Customers reward a fast first reply: the chance that a CSAT answer is positive (score 4-5) is ${CSAT_POS_FAST} when the first reply came within ${CSAT_FAST_MIN} minutes and ${CSAT_POS_SLOW} when it took more than ${CSAT_SLOW_MIN / 60} hours, falling linearly in log(time) in between (no cliff). csat received carries first_response_mins. Read: positive share for > ${CSAT_SLOW_MIN} min over ≤ ${CSAT_FAST_MIN} min = ${(CSAT_POS_SLOW / CSAT_POS_FAST).toFixed(3)}.`,
		mixpanelReport: { type: "Insights", event: "csat received", filter: `first_response_mins ≤ ${CSAT_FAST_MIN} vs > ${CSAT_SLOW_MIN}`, measure: "share with score ≥ 4 (formula A / B)" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN first_response_mins <= ${CSAT_FAST_MIN} THEN 'fast' WHEN first_response_mins > ${CSAT_SLOW_MIN} THEN 'slow' ELSE 'middle' END AS grp,
 count(DISTINCT uid) AS user_count, count(*) AS answers, avg((score >= 4)::INT) AS positive_share
FROM ev WHERE event = 'csat received' GROUP BY 1`,
				},
				select: { s: { where: { grp: "slow" } }, f: { where: { grp: "fast" } } },
				expect: { metric: "s.positive_share / f.positive_share", op: "between", target: band(CSAT_POS_SLOW / CSAT_POS_FAST) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H8-back-to-school-surge",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `During the back-to-school season in North America and Europe (${D(BTS_START)} to ${D(BTS_END)}, exclusive) education companies in the ${BTS_REGIONS.join(" and ")} regions receive ${BTS_MULT}x their usual tickets on average: each arrival brings extra same-day tickets whose expected number follows a half-sine over the season (near zero at the edges, about ${(1 + (BTS_MULT - 1) / BTS_SHAPE_MEAN).toFixed(2)}x in the middle; mean ${BTS_MULT - 1}). Education companies in APAC (other school calendars) and other industries do not change. Read: tickets assigned to ${BTS_REGIONS.join(" and ")} workspaces that existed before ${D0} (customer_since earlier; new trial workspaces keep arriving, and education has a different size mix, so their growth would blur the comparison) in the season vs the ${BTS_BASE_WEEKS} weeks before, education over every other industry (difference in differences of weekly averages).`,
		mixpanelReport: { type: "Insights", event: "ticket assigned", measure: "total", breakdown: "user property industry", filter: `user property region in (${BTS_REGIONS.join(", ")}) and customer_since before ${D0}`, chart: "weekly", compare: `${D(BTS_START)} - 2026-09-13 vs the ${BTS_BASE_WEEKS} weeks before (${BTS_BEFORE.slice(0, 10)} - 2026-08-16), weekly average` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(BTS_MULT) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H9-macros-first-two-weeks",
		hook: "H9",
		archetype: "retention-divergence",
		narrative: `New workspaces that save about ${MACRO_MIN}+ macros (canned replies) in their first ${MACRO_DAYS} days stay. Every trial owner who connects an inbox saves a salted negative-binomial number of macros in that window (mean ${MACRO_MEAN}, size ${MACRO_DISPERSION}, independent of activity), so the count histogram falls smoothly from 0. The chance to go dark ${DARK_AFTER_DAYS}-${DARK_AFTER_DAYS + DARK_SPREAD_DAYS} days after signup is a logistic in the count: ${DARK_MAX} x 1/(1 + e^(${DARK_SLOPE} x (macros - ${DARK_MID}))), i.e. ${darkProb(0).toFixed(2)} at 0, ${darkProb(2).toFixed(2)} at 2, ${darkProb(3).toFixed(2)} at 3, ${darkProb(5).toFixed(2)} at 5 (salted per user). Read: among trial owners who connected an inbox and signed up by ${daysBeforeEnd(RET_TO).slice(0, 10)}, share with queue viewed on day ${RET_FROM}-${RET_TO - 1}; fewer than ${MACRO_MIN} over ${MACRO_MIN}+ reads the stay-share ratio implied by the count distribution and the curve: ${H9_EXPECTED.toFixed(3)}.`,
		mixpanelReport: { type: "Funnels → cohorts → Retention", cohortFunnel: `account created → macro created → macro created → macro created, ${MACRO_DAYS}-day window (completers vs not)`, retention: `account created → queue viewed, custom bracket day ${RET_FROM}-${RET_TO - 1}`, filter: "did inbox connected" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { lo: { where: { grp: "under_3" } }, hi: { where: { grp: "macros_3plus" } } },
				expect: { metric: "lo.retention / hi.retention", op: "between", target: band(H9_EXPECTED) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H10-growth-price-change",
		hook: "H10",
		archetype: "composition-drift",
		narrative: `On ${D(GROWTH_PRICE_CHANGE)} Growth rises from $${PRICE_PER_SEAT.growth[0]} to $${PRICE_PER_SEAT.growth[1]} per agent per month; Starter stays $${PRICE_PER_SEAT.starter[0]}. Trial purchases do not fall (the buy decision is unchanged), but ${GROWTH_DOWNGRADE_AFTER * 100}% of would-be Growth buyers pick Starter instead, so Growth's share of new subscriptions drops from ${GROWTH_CHOICE * 100}% to ${Math.round(GROWTH_CHOICE * GROWTH_KEEP * 100)}% (${GROWTH_KEEP}x). Prices live only in warehouse subscription_billing_daily. New subscriptions after the change number in the low hundreds, so the read uses the knob as target with a half-effect floor.`,
		mixpanelReport: { type: "Insights", event: "subscription started", breakdown: "plan", chart: "before vs after Aug 18 (share of total)", join: "subscription_billing_daily.list_price_per_seat_usd for new MRR" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				// NAILED at the knob ±10%; STRONG between half the knob ratio (an overshoot
				// must not pass) and the half-effect floor
				assert: knobAssert((rows) => pickRow(rows, "after").growth_share / pickRow(rows, "before").growth_share, GROWTH_KEEP, 0.5 * GROWTH_KEEP, 1 - 0.5 * (1 - GROWTH_KEEP)),
				minCohort: 200,
			},
		],
	},
];

export default config;

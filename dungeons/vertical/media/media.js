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
 * NAME:       The Lantern
 * APP:        Independent national digital news publication (web + iOS and
 *             Android apps): politics, US and world news, business, climate,
 *             culture, sports, opinion, technology, and investigations;
 *             six email newsletters; three podcasts; push alerts. Revenue is
 *             reader subscriptions behind a metered paywall: anonymous visitors
 *             get one free article, then a free-account registration wall;
 *             registered readers get 5 free articles in any rolling 30 days.
 *             Plans: Lantern Digital ($12/month or $120/year) and Lantern All
 *             Access ($20/month or $200/year; adds podcasts ad-free and the
 *             archive). Subscribers can comment and (from 2026-08-11) gift
 *             articles.
 * SCALE:      10,000 simulated readers (≈4,500 new visitors arrive inside the
 *             window and ≈1,800 of them register; ≈2,500 subscribers at the
 *             start, ≈3,000 at the end), ~0.83M events, 120 days
 *             (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  article viewed → (meter) → paywall shown → subscription started
 * VALUE MOMENT: subscription started
 *
 * EVENTS (17):
 *   article viewed > paywall shown > front page viewed > recommendation clicked
 *   > newsletter opened > search performed > podcast played > article shared
 *   > push alert opened > article saved > newsletter signup > $experiment_started
 *   > regwall shown > comment posted > account registered > subscription started
 *   > subscription cancelled
 *
 * FUNNELS (12 declared):
 *   - Registration (first funnel, two copies by acquisition_channel, H5/H8):
 *       article viewed → regwall shown → account registered (50%; social 25%)
 *   - Home session (w12): front page viewed → article viewed → article viewed
 *   - Home feed (w8; carries the For You Feed experiment, multipliers 1.0):
 *       front page viewed → recommendation clicked → article viewed → article viewed
 *   - Drive-in read (w10): article viewed → recommendation clicked → article viewed
 *   - Newsletter read (w10): newsletter opened → article viewed → article viewed
 *   - Push read (w6): push alert opened → article viewed
 *   - Search read (w4): search performed → article viewed
 *   - Share (w4), Save (w3), Comment (w2): article viewed → the action
 *   - Account (w2): paywall shown → subscription started → subscription
 *       cancelled (templates only; the hook rebuilds the subscription lifecycle)
 *
 * USER PROPS:  acquisition_channel, region, age_band, reader_tier, member_since,
 *              "Experiment: For You Feed"
 * SUPER PROPS: reader_tier (anonymous / registered / digital / all_access at
 *              event time), platform (web / ios_app / android_app, from the
 *              device), acquisition_channel (sticky per reader, like an initial
 *              UTM source)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (spend by paid channel),
 *              platform_reliability_daily (pageviews served, meter error rate,
 *              page load, status by platform), subscription_billing_daily (new
 *              subscriptions, list and first-period prices, bookings by plan and
 *              billing period)
 * LOOKUPS:     none — article attributes are denormalized onto events
 * SOUP:        weekday-heavy dayOfWeekWeights; US morning and evening
 *              hourOfDayWeights (UTC)
 *
 * IDENTITY: a new visitor reads one article anonymously (device_id only,
 * reader_tier = anonymous) and sees the registration wall; registering
 * ("account registered", isAuthEvent) carries user_id + device_id and stitches
 * the earlier anonymous read, which happened on the same device. Visitors who
 * never register stay device-only and have no profile in Mixpanel (_drop).
 * Every other event carries user_id and device_id. Readers use 1-3 devices
 * (avgDevicePerUser 1.6); platform is sticky per device: desktop OS → web;
 * phones and tablets → the app (75%) or the mobile web.
 *
 * DESIGN NOTES:
 * - The meter: every "article viewed" by a registered (non-subscriber) reader is
 *   an attempted read. With fewer than 5 free reads in the trailing 30 days it is
 *   delivered; otherwise it becomes "paywall shown" (same time, section,
 *   article_id, referrer). Established free readers arrive with a meter already
 *   in use (their reading ~100 days before the window mirrors their reading in it,
 *   with a per-reader phase), so June does not start with every meter empty.
 * - Subscriptions: each paywall view converts with probability BASE_PAYWALL_CONV
 *   x referrer (H6) x sale (H7); the subscription lands 1-8 minutes later and the
 *   meter stops. Cancellations come only from H9; a cancelled member goes back to
 *   the meter and can resubscribe.
 * - Referrer and module follow the preceding event within 30 minutes (newsletter
 *   open → newsletter, push → push, search → site_search, recommendation click →
 *   recommendation, front page → front_page, another article → internal);
 *   otherwise an outside entry (search_engine, social, direct).
 * - Established readers' plans depend on how much they read (persona): heavy
 *   readers are mostly subscribers, casual readers mostly free.
 * - Comments are a subscriber perk (non-subscriber comment events are dropped);
 *   push alerts open only in an app.
 * - Warehouse drift: pageviews_served adds reads Mixpanel never received (ad
 *   blockers and SDK opt-outs, ~16% on web, ~3% in apps, varying by day) plus bot
 *   traffic; billing adds app-store purchases Mixpanel missed and same-day
 *   refunds; paid spend is half a paced plan and half cost per visitor x the day's
 *   new visitors, with seeded day noise.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. WORLD CUP SPORTS SURGE (everything; world event)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: during the FIFA World Cup (2026-06-11 to 2026-07-19) each sports
 *   read brings extra sports reads by a daily multiplier that follows the
 *   bracket (1.7x group stage → 3.0x final weekend; mean 1.97 over tournament
 *   days), scaled per reader by a salted appetite (0-2x, mean 1).
 * MIXPANEL: Insights, article viewed, filter reader_tier in (digital,
 *   all_access), breakdown section, daily; sports share Jun 11 - Jul 19 vs
 *   Jun 4-7 + Jul 23 - Aug 19.
 * REAL WORLD: a home World Cup is the biggest sports story in a generation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. FOR YOU FEED EXPERIMENT (Home feed funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-15 signed-in app readers split 50/50. The For You arm's
 *   personalized home module gets 1.5x the clicks per home screen view
 *   (recommendation clicked, module = home_feed); each extra click opens an
 *   article.
 * MIXPANEL: Insights, recommendation clicked (module = home_feed) / front page
 *   viewed (page = home), filter platform in (ios_app, android_app), Jul 15 -
 *   Oct 1, breakdown "Experiment: For You Feed".
 * REAL WORLD: personalization lifts recirculation on the home screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. GIFT ARTICLES LAUNCH (everything; launch)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-11 (7-day staged rollout) subscribers share 1.6x as
 *   often per article read; the extra shares are gift links (share_method =
 *   gift_link). Free readers are unchanged (control).
 * MIXPANEL: Insights, article shared / (article viewed + paywall shown),
 *   breakdown reader_tier, Jul 20 - Aug 10 vs Aug 18 - Oct 1; breakdown
 *   share_method.
 * REAL WORLD: gifting turns subscribers into a distribution channel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. WEB METER OUTAGE (everything + warehouse platform_reliability_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-25 to 2026-08-27 the web metering service fails open: 70%
 *   of web reads that should hit the paywall go through free. Apps untouched.
 *   The warehouse shows service_status = major_outage and meter_error_rate ≈
 *   0.7 for web on those days.
 * MIXPANEL: Insights, paywall shown, daily, breakdown platform; web/app ratio
 *   on incident days vs 14 days either side; join the warehouse status.
 * REAL WORLD: a fail-open paywall gives away the product and the sign-ups.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. PAID CHANNEL ECONOMICS (first funnels + warehouse marketing_spend_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per new visitor $1.50 Meta, $2.40 Google, $3.20 podcast ads
 *   (half paced plan, half cost per visitor x delivered visitors); social
 *   visitors (Meta ads + organic social) register within 7 days at 0.5x the
 *   rate of everyone else, so spend per registration is 1.25x higher on Meta
 *   than Google.
 * MIXPANEL: Funnels, article viewed (reader_tier = anonymous) → account
 *   registered, 7 days, breakdown acquisition_channel; Insights uniques of
 *   anonymous article viewed by channel joined to marketing_spend_daily.
 * REAL WORLD: cheap social clicks rarely turn into accounts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. NEWSLETTER READERS CONVERT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a paywall view whose blocked read came from a newsletter converts at
 *   2.5x the base per-view rate (0.7%).
 * MIXPANEL: Insights, subscription started / paywall shown, breakdown referrer.
 * REAL WORLD: newsletter readers already have the habit; the paywall asks them
 *   to pay for something they use.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. LABOR DAY SALE (everything + warehouse subscription_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-03 to 2026-09-09, 60% off the first billing period; paywall
 *   conversion per view 2.0x; first-period bookings per paywall view 0.8x (the
 *   price cut outweighs the extra sign-ups in the first period).
 * MIXPANEL: Insights, subscription started / paywall shown, sale week vs the
 *   four weeks before; bookings need first_period_price_usd from the warehouse.
 * REAL WORLD: discounts buy volume, not first-period revenue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. REGISTRATION SPEED BY CHANNEL (everything; time to convert)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: first anonymous article → registration gap is log-normal, median 4 h
 *   (search, podcast, direct) vs 12 h (Meta ads + organic social; 3x).
 * MIXPANEL: Funnels, article viewed (reader_tier = anonymous) → account
 *   registered, 7 days, median time to convert, breakdown acquisition_channel.
 * REAL WORLD: a social click is a passing glance; a search is an intent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. READING HABIT CHURN (everything; magic number)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: monthly cancel probability 16% for subscribers who read on fewer
 *   than 4 distinct days the prior month vs 4% for the rest (4x).
 * MIXPANEL: cohorts of subscribers by distinct reading days in month M-1;
 *   Insights uniques of subscription cancelled in month M / cohort size.
 * REAL WORLD: subscribers who stop reading notice the bill.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. WEEKEND LONG READS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Saturday and Sunday (UTC) reads have read_time_sec x1.35; scroll
 *   depth follows.
 * MIXPANEL: Insights, article viewed, average read_time_sec, breakdown day of
 *   week.
 * REAL WORLD: weekend readers have time for the long pieces.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-media, 2026-10-07, full
 * fidelity, 10,000 readers, 833,974 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation            | Expected | Measured
 * -----|------------------------------------------------|-----------------------|----------|---------
 * H1   | subscriber sports/non-sports reads, WC / base  | WC_MEAN_LIFT          | 1.972    | 1.961 (share 16.6% vs 9.0%)
 * H2   | home_feed clicks per app home view, For You / Control | FOR_YOU_CLICK_MULT | 1.50  | 1.441 (49.7% vs 34.5%)
 * H2   | For You share of exposed readers               | equal 2-arm hash      | 0.50     | 0.488 (1,695 of 3,476)
 * H3   | shares per attempted read, after/before, subscribers over free | GIFT_SHARE_MULT | 1.60 | 1.544 (1.575 / 1.020)
 * H3   | gift_link before launch or from non-subscribers | exact purity         | 0        | 0
 * H4   | web/app paywall views, outage / ±14 days       | 1 − OUTAGE_FAIL       | 0.30     | 0.307 (0.62 vs 2.01)
 * H4   | warehouse meter_error_rate on outage days      | OUTAGE_FAIL           | 0.70     | 0.700
 * H5   | 7-day registration rate, social / other        | SOCIAL_REG_MULT       | 0.50     | 0.512 (25.2% vs 49.3%)
 * H5   | spend per new visitor, Meta / Google           | 1.5 / 2.4             | 0.625    | 0.616 ($1.48 vs $2.41)
 * H5   | spend per registration, Meta / Google          | (1.5/0.5) / 2.4       | 1.25     | 1.187 ($5.83 vs $4.91)
 * H6   | subscriptions per paywall view, newsletter / other | REFERRER_CONV_MULT | 2.50     | 2.418 (1.79% vs 0.74%)
 * H7   | conversion per paywall view, sale / 4 weeks before | SALE_CONV_MULT (≥, floor 1.5) | 2.00 | 2.250 (1.62% vs 0.72%)
 * H7   | first-period bookings per paywall view, sale / before | 2.0 × 0.4 (≤, floor 0.9) | 0.80 | 0.877 ($0.40 vs $0.46)
 * H8   | median hours first read → registration, social / other | SOCIAL_TTC_MULT (≥, floor 2.0) | 3.00 | 3.129 (11.9 h vs 3.8 h)
 * H9   | monthly cancel rate, < 4 / 4+ reading days prior month | 0.16 / 0.04 (≥, floor 2.5) | 4.00 | 3.516 (15.1% vs 4.3%)
 * H10  | average read_time_sec, weekend / weekday       | WEEKEND_READ_MULT     | 1.35     | 1.354 (246 s vs 182 s)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H7 rests on about 127 sale-week subscriptions and H9 on about
 * 420 cancellations, so both use the knob as target with a half-effect floor
 * (H7 conversion and H9 grade STRONG on this seed: 2.25 is above the ±10% band,
 * 3.52 below it). H8 rests on about 400 social registrants (median relative SE
 * about 6%). Not engineered and flat: paywall conversion per view by For You
 * arm (0.88% vs 0.85%, z = 0.31), by section (chi-square 2.65, 9 dof), and
 * registrations per day during the World Cup (15.4 vs 15.1, t = 0.28).
 */

// ── SCALE ──
const SEED = "harness-media";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const WORLD_CUP_START = "2026-06-11T00:00:00Z";  // FIFA World Cup opening match
const WORLD_CUP_END = "2026-07-20T00:00:00Z";    // exclusive (final on Jul 19)
const FOR_YOU_START = "2026-07-15T00:00:00Z";    // "For You" home-feed A/B test starts in the apps
const GIFT_LAUNCH = "2026-08-11T00:00:00Z";      // Gift Articles launches for subscribers (staged over 7 days)
const OUTAGE_START = "2026-08-25T00:00:00Z";     // web metering service incident starts
const OUTAGE_END = "2026-08-28T00:00:00Z";       // exclusive (3 days: Aug 25-27)
const SALE_START = "2026-09-03T00:00:00Z";       // Labor Day subscription sale starts
const SALE_END = "2026-09-10T00:00:00Z";         // exclusive (7 days: Sep 3-9)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. News readership is weekday-heavy with a softer weekend.
const DOW_WEIGHTS = [0.84, 1.0, 1.0, 0.99, 0.97, 0.9, 0.78];
// UTC hours. Readers are mostly in US time zones: a morning peak 7-9 am ET
// (11-13 UTC) and a longer evening peak 6-10 pm ET (22-02 UTC).
const HOUR_WEIGHTS = [0.86, 0.8, 0.68, 0.52, 0.38, 0.28, 0.22, 0.2, 0.24, 0.36, 0.62, 0.92,
	1.0, 0.94, 0.82, 0.76, 0.8, 0.76, 0.66, 0.62, 0.64, 0.72, 0.84, 0.9];

// ── KNOBS ──
// H1 World Cup: sports reading lift by day (date → multiplier on sports article reads)
const WC_LIFT_STEPS = [
	["2026-06-08", 1.15], // previews
	["2026-06-11", 1.7],  // group stage
	["2026-06-28", 2.0],  // round of 32
	["2026-07-04", 2.3],  // round of 16 + quarterfinals
	["2026-07-12", 1.6],  // rest days
	["2026-07-14", 2.6],  // semifinals
	["2026-07-16", 1.6],  // rest days
	["2026-07-18", 3.0],  // third place + final
	["2026-07-20", 1.15], // aftermath
	["2026-07-23", 1.0],
];
const wcLift = (t) => {
	const d = new Date(t).toISOString().slice(0, 10);
	let lift = 1;
	for (const [from, m] of WC_LIFT_STEPS) if (d >= from) lift = m;
	return lift;
};
// mean lift over tournament days (Jun 11 - Jul 19): the story's knob
const WC_MEAN_LIFT = (() => {
	let s = 0, n = 0;
	for (let t = ms(WORLD_CUP_START); t < ms(WORLD_CUP_END); t += DAY_MS) { s += wcLift(t); n++; }
	return Math.round((s / n) * 1000) / 1000;
})();

// H2 For You experiment: home-feed clicks per home view in the variant arm
const FOR_YOU_EXPERIMENT = "For You Feed";
const FOR_YOU_VARIANT = "For You";
const EXP_KEY = `Experiment: ${FOR_YOU_EXPERIMENT}`;
const FOR_YOU_CLICK_MULT = 1.5;

// H3 Gift Articles: subscriber shares per subscriber article read
const GIFT_RAMP_DAYS = 7;
const GIFT_SHARE_MULT = 1.6;

// H4 web metering incident: share of blocked web reads that failed open
const OUTAGE_FAIL = 0.7;

// H5 / H8 acquisition: social-platform visitors register less often and more slowly
const SOCIAL_CHANNELS = ["meta_ads", "social"];
const PAID_CHANNELS = ["google_ads", "meta_ads", "podcast_ads"];
const REG_CONV = 50;              // % of new visitors who register within the first funnel (non-social)
const SOCIAL_REG_MULT = 0.5;      // social-platform visitors register at half the rate
const REG_TTC_H = 4;              // median hours, first article → registration (non-social)
const SOCIAL_TTC_MULT = 3;        // social-platform registrants take 3x as long
const REG_TTC_SIGMA = 0.9;        // log-normal spread of the first article → registration gap
const REG_TTC_MAX_H = 156;        // every registration lands inside the 7-day window
const CPV_USD = { google_ads: 2.4, meta_ads: 1.5, podcast_ads: 3.2 }; // window spend per new visitor
const CHANNEL_WEIGHTS = { organic_search: 22, google_ads: 18, meta_ads: 25, social: 12, podcast_ads: 10, direct: 13 };
const BORN_PCT = 45;

// H6 newsletter readers convert: per paywall-view conversion multiplier by the blocked read's referrer
const BASE_PAYWALL_CONV = 0.007;
const REFERRER_CONV_MULT = { newsletter: 2.5 };

// H7 Labor Day sale: conversion multiplier and first-period discount
const SALE_CONV_MULT = 2.0;
const SALE_DISCOUNT = 0.6;

// H9 engagement churn: monthly cancel probability by reading days in the prior calendar month
const READING_DAYS_MIN = 4;
const CANCEL_Q = { low: 0.16, high: 0.04 };

// H10 weekend long reads: read time multiplier on Saturday and Sunday (UTC)
const WEEKEND_READ_MULT = 1.35;

// meter: registered readers get a number of free articles in any rolling 30 days
const METER_FREE_ARTICLES = 5;
const METER_WINDOW_DAYS = 30;

// prices (USD per billing period)
const PRICES = {
	digital: { monthly: 12, annual: 120 },
	all_access: { monthly: 20, annual: 200 },
};
const PLAN_WEIGHTS = { digital: 72, all_access: 28 };
const BILLING_WEIGHTS = { monthly: 62, annual: 38 };

// ── DATA ──
const SECTIONS = { politics: 17, us_news: 14, world: 11, business: 10, sports: 9, climate: 7, culture: 9, opinion: 10, technology: 8, investigations: 5 };
const CONTENT_TYPES = { news: 46, analysis: 18, feature: 12, explainer: 10, live_blog: 6, opinion: 8 };
const READ_BASE_SEC = { news: 95, analysis: 190, feature: 310, explainer: 170, live_blog: 140, opinion: 160 };
const ARTICLE_IDS = Array.from({ length: 2400 }, () => `art_${chance.hash({ length: 10 })}`);
const ARTICLE_POP = (() => { // power-law popularity weights
	const w = ARTICLE_IDS.map((_, i) => 1 / Math.pow(i + 1, 0.85));
	const s = w.reduce((a, b) => a + b, 0);
	let acc = 0;
	return w.map((x) => (acc += x / s));
})();
const NEWSLETTERS = { the_morning_lantern: 40, politics_briefing: 18, weekend_edition: 16, climate_desk: 10, sports_extra: 8, tech_week: 8 };
const ENTRY_REFERRERS = {
	default: { search_engine: 40, social: 18, direct: 42 },
	social: { search_engine: 25, social: 45, direct: 30 },
};
const LANDING_REFERRER = { organic_search: "search_engine", google_ads: "search_engine", meta_ads: "social", social: "social", podcast_ads: "direct", direct: "direct" };
const PERSONA_TIER = {
	news_junkie: { registered: 20, digital: 50, all_access: 30 },
	regular: { registered: 50, digital: 36, all_access: 14 },
	casual: { registered: 82, digital: 14, all_access: 4 },
};

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
const byT = (a, b) => T(a) - T(b);
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
const draw = (obj) => pickWeighted(obj, chance.floating({ min: 0, max: 1 }));
const drawArticle = () => {
	const r = chance.floating({ min: 0, max: 1 });
	let lo = 0, hi = ARTICLE_POP.length - 1;
	while (lo < hi) { const mid = (lo + hi) >> 1; if (ARTICLE_POP[mid] < r) lo = mid + 1; else hi = mid; }
	return ARTICLE_IDS[lo];
};
const isSubscriber = (tier) => tier === "digital" || tier === "all_access";
const inOutage = (t) => t >= ms(OUTAGE_START) && t < ms(OUTAGE_END);
const inSale = (t) => t >= ms(SALE_START) && t < ms(SALE_END);
const isWeekend = (t) => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6; };
const price = (plan, period) => PRICES[plan]?.[period] ?? 0;
const firstPeriodPrice = (plan, period, t) => round2(price(plan, period) * (inSale(t) ? 1 - SALE_DISCOUNT : 1));

// read time (seconds) for one article read, by content type; scroll depth follows read time
function readTimeFor(type) {
	const base = READ_BASE_SEC[type] ?? 120;
	return Math.max(8, Math.round(base * Math.exp(chance.normal({ mean: 0, dev: 0.55 }))));
}
function scrollFor(type, sec) {
	const base = READ_BASE_SEC[type] ?? 120;
	const s = 100 * (1 - Math.exp(-sec / base)) + chance.normal({ mean: 0, dev: 6 });
	return Math.max(5, Math.min(100, Math.round(s)));
}
function drawContentType(section) {
	if (section === "opinion") return "opinion";
	const t = draw(CONTENT_TYPES);
	return t === "opinion" ? "analysis" : t;
}
function freshArticle(ev, section) {
	ev.section = section;
	ev.article_id = drawArticle();
	ev.content_type = drawContentType(section);
	ev.read_time_sec = readTimeFor(ev.content_type);
	ev.scroll_depth_pct = scrollFor(ev.content_type, ev.read_time_sec);
}

// device fields that travel with a device_id
const DEVICE_KEYS = ["device_id", "os", "model", "screen_height", "screen_width", "carrier", "radio", "platform"];
const copyDevice = (to, from) => {
	for (const k of DEVICE_KEYS) {
		if (from[k] !== undefined) to[k] = from[k];
		else delete to[k];
	}
};
const MOBILE_OS = new Set(["iOS", "iPadOS", "Android"]);
const platformFor = (deviceId, os) => {
	if (!MOBILE_OS.has(os)) return "web";
	// 75% of phones and tablets read in the app, the rest on the mobile web (sticky per device)
	if (hashFloat(`${deviceId}|app`) >= 0.75) return "web";
	return os === "Android" ? "android_app" : "ios_app";
};

// a template pool for events a member may not have in their own stream
const POOL = {};
const TEMPLATE_EVENTS = ["paywall shown", "subscription started", "subscription cancelled", "article shared", "recommendation clicked", "article viewed", "$experiment_started"];
function remember(events) {
	for (const e of events) {
		if (TEMPLATE_EVENTS.includes(e.event) && !POOL[e.event]) POOL[e.event] = { ...e };
	}
}
function makeFrom(own, name, t, near, uid) {
	const tpl = own[name] || POOL[name];
	if (!tpl) return null;
	const ev = cloneEvent(tpl, { time: iso(t) });
	if (uid) ev.user_id = uid;
	if (near) copyDevice(ev, near);
	return ev;
}

// ── USER HOOK ──
function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	// the engine's persona label is internal; keep it out of the Mixpanel profile
	delete profile._persona;
	if (meta.userIsBornInDataset) {
		profile.reader_tier = "anonymous";
		profile.member_since = dayKey(dayjs.utc(profile.created ?? meta.user?.created ?? DATASET_START).valueOf());
		return profile;
	}
	const tenureDays = Math.floor(salt(uid, "tenure") * (ms(DATASET_START) - ms("2021-03-01T00:00:00Z")) / DAY_MS);
	profile.member_since = dayjs.utc("2021-03-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	const persona = meta.persona?.name || "regular";
	profile.reader_tier = pickWeighted(PERSONA_TIER[persona] || PERSONA_TIER.regular, salt(uid, "tier"));
	return profile;
}

// ── EVERYTHING HOOK ──
const META_EVENTS = new Set(["paywall shown", "subscription started", "subscription cancelled", "$experiment_started"]);

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const born = meta.userIsBornInDataset;
	const authT = meta.authTime ?? null;
	events.sort(byT);
	remember(events);

	// own templates (copies) for events the hook rebuilds
	const own = {};
	for (const e of events) if (META_EVENTS.has(e.event) && !own[e.event]) own[e.event] = { ...e };

	// ── platform per device ──
	const stampPlatform = (evs) => { for (const e of evs) e.platform = platformFor(e.device_id, e.os); };

	// ── anonymous visitors: the first funnel only, on one device ──
	if (born && authT === null) {
		const first = events[0];
		let keep = events.filter((e) => e.event === "article viewed" || e.event === "regwall shown");
		keep = keep.slice(0, 2);
		for (const e of keep) {
			copyDevice(e, first);
			e.reader_tier = "anonymous";
		}
		stampPlatform(keep);
		const art = keep.find((e) => e.event === "article viewed");
		if (art) {
			freshArticle(art, art.section);
			art.referrer = LANDING_REFERRER[profile.acquisition_channel] || "direct";
			const wall = keep.find((e) => e.event === "regwall shown");
			if (wall) {
				wall.time = iso(T(art) + chance.integer({ min: 20, max: 150 }) * 1000);
				wall.section = art.section;
				wall.referrer = art.referrer;
			}
		}
		profile.reader_tier = "anonymous";
		return keep;
	}

	// ── registered members ──
	let authEv = null;
	if (born) {
		authEv = events.find((e) => e.event === "account registered") || null;
		// pre-registration reads happen on the device they registered with
		const preAuth = events.filter((e) => authEv && T(e) < T(authEv));
		for (const e of preAuth) copyDevice(e, authEv);
	}
	const regT = born ? (authEv ? T(authEv) : authT) : -Infinity;
	if (born) profile.member_since = dayKey(regT); // the account exists from registration

	// drop engine copies the hook rebuilds; drop pre-registration activity other
	// than the first funnel; push alerts only open on an app
	stampPlatform(events);
	events = events.filter((e) => {
		if (META_EVENTS.has(e.event)) return false;
		if (T(e) < regT && e.event !== "article viewed" && e.event !== "regwall shown") return false;
		if (e.event === "push alert opened" && e.platform === "web") return false;
		return true;
	});
	// first-funnel steps (H8): the first read comes a log-normal gap before the
	// registration (median REG_TTC_H, x SOCIAL_TTC_MULT for social platforms) and the
	// wall follows the read within a few minutes
	if (born) {
		const art = events.find((e) => e.event === "article viewed" && T(e) < regT);
		const wall = events.find((e) => e.event === "regwall shown");
		const med = REG_TTC_H * (SOCIAL_CHANNELS.includes(profile.acquisition_channel) ? SOCIAL_TTC_MULT : 1);
		const gapMs = Math.max(4 * MIN_MS, Math.min(REG_TTC_MAX_H, med * Math.exp(chance.normal({ mean: 0, dev: REG_TTC_SIGMA }))) * HOUR_MS);
		if (art) art.time = iso(Math.floor(regT - gapMs));
		if (art && wall) wall.time = iso(Math.min(regT - 1000, T(art) + chance.integer({ min: 20, max: 150 }) * 1000));
		// a visit that started before June 4 is outside the data
		if (art && T(art) < BEGIN) events = events.filter((e) => !(T(e) < regT && (e.event === "article viewed" || e.event === "regwall shown") && T(e) < BEGIN));
	}

	// ── article content ──
	for (const e of events) if (e.event === "article viewed") freshArticle(e, e.section);
	const firstAnon = born ? events.find((e) => e.event === "article viewed" && T(e) < regT) : null;
	if (born) {
		const wall = events.find((e) => e.event === "regwall shown");
		if (wall && firstAnon) wall.section = firstAnon.section;
	}

	// ── H1 World Cup: extra sports reads during the tournament ──
	// each reader's appetite for tournament coverage varies (x0-2, mean 1)
	const fandom = 2 * salt(uid, "wc-fan");
	const added = [];
	for (const e of events) {
		if (e.event !== "article viewed" || e.section !== "sports" || T(e) < regT) continue;
		const lift = wcLift(T(e));
		if (lift <= 1) continue;
		const extra = (lift - 1) * fandom;
		const n = Math.floor(extra) + (chance.bool({ likelihood: (extra % 1) * 100 }) ? 1 : 0);
		for (let i = 0; i < n; i++) {
			const c = cloneEvent(e, { time: iso(Math.min(END, T(e) + chance.integer({ min: 3 * 60, max: 40 * 60 }) * 1000)) });
			freshArticle(c, "sports");
			added.push(c);
		}
	}
	events = events.concat(added).sort(byT);

	// ── H2 For You experiment (apps, identified readers) ──
	const variant = profile[EXP_KEY];
	const expStart = ms(FOR_YOU_START);
	// exposure: 1 s before the first app event after the start (and after registration)
	const firstApp = events.find((e) => T(e) >= expStart && T(e) > regT && e.platform !== "web");
	let exposure = null;
	const forYouClones = new Set();
	if (variant !== undefined && firstApp) {
		exposure = makeFrom(own, "$experiment_started", Math.max(T(firstApp) - 1000, regT + 1), firstApp, uid);
		if (exposure) {
			exposure["Experiment name"] = FOR_YOU_EXPERIMENT;
			exposure["Variant name"] = variant;
		}
	}
	if (!exposure && profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];

	// rec-click module and article referrer follow the preceding event
	const assignContext = (evs) => {
		let prev = null;
		for (const e of evs) {
			const gap = prev ? T(e) - T(prev) : Infinity;
			if (e.event === "recommendation clicked" && !forYouClones.has(e)) {
				e.module = prev && gap <= 30 * MIN_MS && prev.event === "front page viewed" && prev.page === "home"
					? "home_feed"
					: pickWeighted({ related: 45, more_in_section: 35, most_read: 20 }, hashFloat(`${e.insert_id}|mod`));
			}
			if (e.event === "article viewed" && !e._ref) {
				let ref;
				if (prev && gap <= 30 * MIN_MS) {
					ref = { "newsletter opened": "newsletter", "push alert opened": "push", "search performed": "site_search", "recommendation clicked": "recommendation", "front page viewed": "front_page" }[prev.event] || "internal";
				} else {
					ref = pickWeighted(SOCIAL_CHANNELS.includes(profile.acquisition_channel) ? ENTRY_REFERRERS.social : ENTRY_REFERRERS.default, hashFloat(`${e.insert_id}|ref`));
				}
				e.referrer = ref;
			}
			prev = e;
		}
	};
	if (firstAnon) {
		firstAnon.referrer = LANDING_REFERRER[profile.acquisition_channel] || "direct";
		firstAnon._ref = true;
		const wall = events.find((e) => e.event === "regwall shown");
		if (wall) wall.referrer = firstAnon.referrer;
	}
	assignContext(events);

	if (exposure && variant === FOR_YOU_VARIANT) {
		// each variant reader's response to the feed varies (extra clicks x0.4-1.6 of the mean)
		const extraShare = (FOR_YOU_CLICK_MULT - 1) * (0.4 + 1.2 * salt(uid, "foryou-taste"));
		const clones = [];
		for (const e of events) {
			if (e.event !== "recommendation clicked" || e.module !== "home_feed" || e.platform === "web" || T(e) < T(exposure)) continue;
			if (!chance.bool({ likelihood: extraShare * 100 })) continue;
			const t1 = T(e) + chance.integer({ min: 2 * 60, max: 6 * 60 }) * 1000;
			const click = cloneEvent(e, { time: iso(t1) });
			click.module = "home_feed";
			click.position = chance.integer({ min: 1, max: 8 });
			forYouClones.add(click);
			const tpl = events.find((x) => x.event === "article viewed" && T(x) >= regT) || POOL["article viewed"];
			if (!tpl) continue;
			const read = cloneEvent(tpl, { time: iso(t1 + chance.integer({ min: 3, max: 15 }) * 1000) });
			copyDevice(read, e);
			read.user_id = uid;
			freshArticle(read, draw(SECTIONS));
			read.referrer = "recommendation";
			read._ref = true;
			clones.push(click, read);
		}
		events = events.concat(clones).sort(byT);
	}

	// ── subscriptions, the meter, and cancellations (H4, H6, H7, H9) ──
	const initialTier = born ? "registered" : (profile.reader_tier || "registered");
	// reading days per calendar month from attempted reads (identified only)
	const readDays = {};
	for (const e of events) {
		if (e.event !== "article viewed" || T(e) < regT) continue;
		const m = monthKey(T(e));
		(readDays[m] ||= new Set()).add(dayKey(T(e)));
	}
	const monthStart = (m) => ms(`${m}-01T00:00:00Z`);
	const monthEnd = (m) => dayjs.utc(`${m}-01T00:00:00Z`).add(1, "month").valueOf();
	const nextMonth = (m) => dayjs.utc(`${m}-01T00:00:00Z`).add(1, "month").format("YYYY-MM");
	const prevMonth = (m) => dayjs.utc(`${m}-01T00:00:00Z`).subtract(1, "month").format("YYYY-MM");

	let tier = initialTier;
	let subSince = isSubscriber(tier) ? -Infinity : null; // pre-existing subscribers subscribed before the window
	let subPlan = isSubscriber(tier) ? tier : null;
	let cancelAt = Infinity;
	let cancelLow = false; // the scheduled cancellation came from a light-reading month
	let freeReads = []; // delivered free reads in the rolling meter window
	const tierChanges = []; // [t, tier]
	const out = [];
	const subs = [];
	const cancels = [];
	const meterOpen = (t) => {
		const lim = t - METER_WINDOW_DAYS * DAY_MS;
		while (freeReads.length && freeReads[0] <= lim) freeReads.shift();
		return freeReads.length < METER_FREE_ARTICLES;
	};
	// warm start: established free readers arrive with a meter already in use. Their
	// reading in the ~100 days before the window repeats their reading in it, shifted
	// back by 90 days plus a per-member phase (so meter cycles are not aligned to June 4).
	if (!born && !isSubscriber(tier)) {
		const shift = 3 * METER_WINDOW_DAYS * DAY_MS + Math.floor(salt(uid, "meter-phase") * METER_WINDOW_DAYS * DAY_MS);
		for (const e of events) {
			if (e.event !== "article viewed") continue;
			const tv = T(e) - shift;
			if (tv >= BEGIN) break;
			if (meterOpen(tv)) freeReads.push(tv);
		}
	}

	const decideCancel = (m) => {
		if (subPlan === null) return;
		let p, from, to;
		if (m === "2026-06") {
			if (subSince !== -Infinity) return;
			// proxy for May: June's own reading days, scaled to a month
			const days = (readDays["2026-06"]?.size ?? 0) * 30 / 27;
			cancelLow = days < READING_DAYS_MIN;
			p = (cancelLow ? CANCEL_Q.low : CANCEL_Q.high) * 27 / 30;
			from = BEGIN; to = monthEnd(m);
		} else {
			const pm = prevMonth(m);
			if (!(subSince <= monthStart(pm))) return; // subscribed for the whole prior month
			const days = readDays[pm]?.size ?? 0;
			cancelLow = days < READING_DAYS_MIN;
			p = cancelLow ? CANCEL_Q.low : CANCEL_Q.high;
			from = monthStart(m); to = monthEnd(m);
			if (m === "2026-10") { p = p / 31; to = END; }
		}
		if (salt(uid, `cancel|${m}`) < p) cancelAt = Math.floor(from + salt(uid, `cancel-t|${m}`) * (to - from));
	};
	let lastNear = events.find((e) => T(e) >= regT) || events[0];
	const doCancel = (t) => {
		const c = makeFrom(own, "subscription cancelled", t, lastNear, uid);
		if (c) {
			c.plan = subPlan;
			// the stated reason leans on how much the member was reading
			c.cancel_reason = draw(cancelLow
				? { not_reading_enough: 45, price: 22, too_many_subscriptions: 12, financial: 11, other: 10 }
				: { price: 34, not_reading_enough: 12, too_many_subscriptions: 20, financial: 18, other: 16 });
			cancels.push(c);
		}
		tier = "registered";
		subPlan = null;
		subSince = null;
		cancelAt = Infinity;
		freeReads = [];
		tierChanges.push([t, "registered"]);
	};

	// walk month by month (months without events still get their cancel decision)
	const firstMonth = born ? monthKey(regT) : "2026-06";
	let curMonth = null;
	const enterMonth = (m) => {
		if (cancelAt < monthStart(m)) doCancel(cancelAt);
		curMonth = m;
		if (!(born && m === firstMonth)) decideCancel(m);
	};
	for (const e of events) {
		const t = T(e);
		if (t < regT) { out.push(e); continue; }
		const m = monthKey(t);
		if (curMonth === null) enterMonth(firstMonth);
		while (curMonth < m) enterMonth(nextMonth(curMonth));
		if (cancelAt <= t) doCancel(cancelAt);
		lastNear = e;
		if (e.event !== "article viewed" || isSubscriber(tier)) { out.push(e); continue; }
		// a metered read by a registered reader
		if (meterOpen(t)) { freeReads.push(t); out.push(e); continue; }
		if (e.platform === "web" && inOutage(t) && chance.bool({ likelihood: OUTAGE_FAIL * 100 })) { out.push(e); continue; }
		const wall = makeFrom(own, "paywall shown", t, e, uid);
		if (!wall) { out.push(e); continue; }
		wall.section = e.section;
		wall.article_id = e.article_id;
		wall.referrer = e.referrer;
		out.push(wall);
		const p = BASE_PAYWALL_CONV * (REFERRER_CONV_MULT[e.referrer] ?? 1) * (inSale(t) ? SALE_CONV_MULT : 1);
		if (chance.bool({ likelihood: p * 100 })) {
			const ts = Math.min(END, t + chance.integer({ min: 60, max: 8 * 60 }) * 1000);
			const s = makeFrom(own, "subscription started", ts, e, uid);
			if (s) {
				subPlan = draw(PLAN_WEIGHTS);
				s.plan = subPlan;
				s.billing_period = draw(BILLING_WEIGHTS);
				s.offer = inSale(ts) ? "labor_day_sale" : "standard";
				s.referrer = e.referrer;
				s.section = e.section;
				subs.push(s);
				tier = subPlan;
				subSince = ts;
				tierChanges.push([ts, subPlan]);
			}
		}
	}
	// months after the member's last event still carry cancel decisions
	if (curMonth !== null) {
		while (curMonth < "2026-10") enterMonth(nextMonth(curMonth));
		if (cancelAt <= END && subPlan !== null) doCancel(cancelAt);
	}
	events = out.concat(subs, cancels).sort(byT);

	const tierAt = (t) => {
		if (t < regT) return "anonymous";
		let cur = initialTier;
		for (const [ct, ctier] of tierChanges) if (ct <= t) cur = ctier;
		return cur;
	};

	// ── perks: comments are for subscribers ──
	events = events.filter((e) => e.event !== "comment posted" || isSubscriber(tierAt(T(e))));

	// ── H3 Gift Articles: subscribers share more after launch ──
	const gift = ms(GIFT_LAUNCH);
	// each subscriber's gifting habit varies (x0.35-1.65 of the mean)
	const giftHabit = 0.35 + 1.3 * salt(uid, "gift-habit");
	const giftClones = [];
	for (const e of events) {
		if (e.event !== "article shared") continue;
		const t = T(e);
		if (t < gift || !isSubscriber(tierAt(t))) continue;
		const ramp = Math.min(1, (t - gift) / (GIFT_RAMP_DAYS * DAY_MS));
		if (!chance.bool({ likelihood: Math.min(1, (GIFT_SHARE_MULT - 1) * giftHabit) * ramp * 100 })) continue;
		const c = cloneEvent(e, { time: iso(Math.min(END, t + chance.integer({ min: 30, max: 20 * 60 }) * 1000)) });
		c.share_method = "gift_link";
		giftClones.push(c);
	}
	events = events.concat(giftClones);

	// ── H10 weekend long reads ──
	for (const e of events) {
		if (e.event !== "article viewed" || !isWeekend(T(e))) continue;
		e.read_time_sec = Math.round(e.read_time_sec * WEEKEND_READ_MULT);
		e.scroll_depth_pct = scrollFor(e.content_type, e.read_time_sec);
	}

	// ── stamp tier and platform; final profile ──
	if (exposure) events.push(exposure);
	events = events.filter((e) => T(e) >= BEGIN && T(e) <= END).sort(byT);
	for (const e of events) {
		delete e._ref;
		// a cancellation carries the plan being cancelled
		e.reader_tier = tierAt(e.event === "subscription cancelled" ? T(e) - 1 : T(e));
		e.platform = platformFor(e.device_id, e.os);
	}
	profile.reader_tier = tierAt(END);
	return events;
}

// ── WAREHOUSE ──
const VISITORS_PER_DAY = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_PLAN_SHARE = 0.5;   // half of each day's spend is the paced plan, half follows delivered visitors
const SPEND_NOISE = 0.12;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => 0.5 + 0.5 * w / m);
})();
const CTR = { google_ads: 0.045, meta_ads: 0.009, podcast_ads: 0.004 }; // podcast: vanity-URL visits per download
const CLICK_INFLATION = 1.25; // networks report more clicks than visitors who reach the site and load an article
const paidSpend = (date, ch, visitors) => round2((SPEND_PLAN_SHARE * CPV_USD[ch] * VISITORS_PER_DAY[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPV_USD[ch] * visitors) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
const UNTRACKED_VIEW_SHARE = { web: 0.16, ios_app: 0.03, android_app: 0.03 }; // ad blockers and SDK opt-outs (mean, varies by day)
const STORE_UNTRACKED_SHARE = 0.1;
const REFUND_SHARE = 0.05;

function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		const ch = row.acquisition_channel;
		const k = `${row.date}|${ch}`;
		const visitors = row.spend_usd;
		const spend = paidSpend(row.date, ch, visitors);
		row.spend_usd = spend;
		// network-reported clicks follow the spend (implied visitors x over-count); impressions follow clicks
		row.clicks = Math.round(spend / CPV_USD[ch] * CLICK_INFLATION * jitter(`clk|${k}`, 0.15));
		row.impressions = Math.round(row.clicks / CTR[ch] * jitter(`imp|${k}`, 0.15));
		return row;
	}
	if (meta.metricName === "platform_reliability_daily") {
		const k = `${row.date}|${row.platform}`;
		const share = UNTRACKED_VIEW_SHARE[row.platform] ?? 0.05;
		row.pageviews_served = Math.round(row.pageviews_served * (1 + share * jitter(`untracked|${k}`, 0.8)) + 25 * jitter(`bots|${k}`, 0.9));
		return row;
	}
	if (meta.metricName === "subscription_billing_daily") {
		const k = `${row.date}|${row.plan}|${row.billing_period}`;
		let n = row.new_subscriptions;
		if (hashFloat(`store|${k}`) < STORE_UNTRACKED_SHARE) n += 1;
		if (n > 0 && hashFloat(`refund|${k}`) < REFUND_SHARE) n -= 1;
		row.new_subscriptions = n;
		row.gross_bookings_usd = round2(n * row.first_period_price_usd);
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
		hasSessionIds: false,
		alsoInferFunnels: false,
		hasLocation: false,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: false,
	},
	identity: { avgDevicePerUser: 1.6 },
	stickyEventProps: ["acquisition_channel"],

	events: [
		{
			event: "account registered",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				registration_method: { __weights: { email: 52, google: 30, apple: 18 } },
			},
		},
		{
			event: "article viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				section: { __weights: SECTIONS },
				article_id: ["art_unassigned"],
				content_type: ["news"],
				referrer: ["direct"],
				read_time_sec: [60],
				scroll_depth_pct: [50],
			},
		},
		{
			event: "front page viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				page: { __weights: { home: 72, politics: 7, sports: 6, business: 5, world: 4, culture: 3, climate: 3 } },
			},
		},
		{
			event: "recommendation clicked",
			weight: 1,
			isStrictEvent: true,
			properties: {
				module: ["related"],
				position: u.weighNumRange(1, 10, 0.6, 2),
			},
		},
		{
			event: "search performed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				query_topic: { __weights: { ...SECTIONS, people: 8, archive: 4 } },
				results_count: u.weighNumRange(0, 60, 0.5, 18),
			},
		},
		{
			event: "newsletter opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				newsletter: { __weights: NEWSLETTERS },
			},
		},
		{
			event: "push alert opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				alert_type: { __weights: { breaking_news: 45, daily_briefing: 30, live_updates: 15, sports: 10 } },
			},
		},
		{
			event: "regwall shown",
			weight: 1,
			isStrictEvent: true,
			properties: {
				section: { __weights: SECTIONS },
				referrer: ["direct"],
			},
		},
		{
			event: "paywall shown",
			weight: 1,
			isStrictEvent: true,
			properties: {
				section: { __weights: SECTIONS },
				article_id: ["art_unassigned"],
				referrer: ["direct"],
			},
		},
		{
			event: "subscription started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: ["digital"],
				billing_period: ["monthly"],
				offer: ["standard"],
				referrer: ["direct"],
				section: ["politics"],
			},
		},
		{
			event: "subscription cancelled",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: ["digital"],
				cancel_reason: ["other"],
			},
		},
		{
			event: "newsletter signup",
			weight: 1,
			properties: {
				newsletter: { __weights: NEWSLETTERS },
			},
		},
		{
			event: "article shared",
			weight: 3,
			properties: {
				share_method: { __weights: { copy_link: 38, email: 18, x_twitter: 12, facebook: 14, whatsapp: 10, linkedin: 8 } },
				section: { __weights: SECTIONS },
			},
		},
		{
			event: "article saved",
			weight: 3,
			properties: {
				section: { __weights: SECTIONS },
			},
		},
		{
			event: "comment posted",
			weight: 2,
			properties: {
				section: { __weights: { politics: 30, opinion: 25, us_news: 12, world: 8, sports: 8, climate: 7, business: 5, culture: 5 } },
				is_reply: [false, false, true],
			},
		},
		{
			event: "podcast played",
			weight: 4,
			properties: {
				show: { __weights: { the_lantern_daily: 60, inside_politics: 25, the_long_read: 15 } },
				listen_sec: u.weighNumRange(30, 2400, 0.5, 900),
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [FOR_YOU_EXPERIMENT],
				"Variant name": ["Control", FOR_YOU_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Registration",
			sequence: ["article viewed", "regwall shown", "account registered"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: { nin: SOCIAL_CHANNELS } },
			conversionRate: REG_CONV,
			timeToConvert: REG_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Registration",
			sequence: ["article viewed", "regwall shown", "account registered"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: { in: SOCIAL_CHANNELS } },
			conversionRate: Math.round(REG_CONV * SOCIAL_REG_MULT),
			timeToConvert: REG_TTC_H * SOCIAL_TTC_MULT,
			order: "sequential",
			weight: 1,
		},
		{
			// a reading session from the home page: headlines
			name: "Home session",
			sequence: ["front page viewed", "article viewed", "article viewed"],
			conversionRate: 45,
			timeToConvert: 0.35,
			order: "sequential",
			weight: 12,
		},
		{
			// a reading session from the home page: the personalized feed module
			name: "Home feed",
			sequence: ["front page viewed", "recommendation clicked", "article viewed", "article viewed"],
			conversionRate: 50,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 8,
			experiment: {
				name: FOR_YOU_EXPERIMENT,
				startDaysBeforeEnd: Math.round((ms(DATASET_END) - ms(FOR_YOU_START)) / DAY_MS),
				variants: [{ name: "Control" }, { name: FOR_YOU_VARIANT }],
			},
		},
		{
			// a read that starts outside (search engine, social, direct link)
			name: "Drive-in read",
			sequence: ["article viewed", "recommendation clicked", "article viewed"],
			conversionRate: 30,
			timeToConvert: 0.25,
			order: "sequential",
			weight: 10,
		},
		{
			name: "Newsletter read",
			sequence: ["newsletter opened", "article viewed", "article viewed"],
			conversionRate: 50,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 10,
		},
		{
			name: "Push read",
			sequence: ["push alert opened", "article viewed"],
			conversionRate: 80,
			timeToConvert: 0.1,
			order: "sequential",
			weight: 6,
		},
		{
			name: "Search read",
			sequence: ["search performed", "article viewed"],
			conversionRate: 70,
			timeToConvert: 0.1,
			order: "sequential",
			weight: 4,
		},
		{
			name: "Share",
			sequence: ["article viewed", "article shared"],
			conversionRate: 55,
			timeToConvert: 0.15,
			order: "sequential",
			weight: 4,
		},
		{
			name: "Save",
			sequence: ["article viewed", "article saved"],
			conversionRate: 50,
			timeToConvert: 0.1,
			order: "sequential",
			weight: 3,
		},
		{
			name: "Comment",
			sequence: ["article viewed", "comment posted"],
			conversionRate: 45,
			timeToConvert: 0.2,
			order: "sequential",
			weight: 2,
		},
		{
			// templates for the subscription lifecycle (the hook rebuilds these)
			name: "Account",
			sequence: ["paywall shown", "subscription started", "subscription cancelled"],
			conversionRate: 100,
			timeToConvert: 0.2,
			order: "sequential",
			weight: 2,
		},
	],

	warehouseMetrics: [
		{
			name: "marketing_spend_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "article viewed",
				measure: "count",
				where: (e) => e.reader_tier === "anonymous" && PAID_CHANNELS.includes(e.acquisition_channel),
				groupBy: "acquisition_channel",
			},
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				// set by the warehouse hook from the day's spend
				clicks: 0,
				impressions: 0,
			},
		},
		{
			name: "platform_reliability_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "article viewed",
				measure: "count",
				groupBy: "platform",
			},
			timeColumn: "date",
			valueColumn: "pageviews_served",
			columns: {
				meter_error_rate: (ctx) => {
					const hit = ctx.row.platform === "web" && inOutage(ctx.time);
					const j = hashFloat(`meter|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? round2(OUTAGE_FAIL + (j - 0.5) * 0.04) : Math.round((0.0008 + j * 0.003) * 10000) / 10000;
				},
				p75_page_load_ms: (ctx) => {
					const j = hashFloat(`load|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					const base = ctx.row.platform === "web" ? 1450 : 900;
					return Math.round(base * (0.85 + j * 0.3) * (ctx.row.platform === "web" && inOutage(ctx.time) ? 1.25 : 1));
				},
				service_status: (ctx) => (ctx.row.platform === "web" && inOutage(ctx.time) ? "major_outage" : "operational"),
			},
		},
		{
			name: "subscription_billing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "subscription started",
				measure: "count",
				groupBy: ["plan", "billing_period"],
			},
			timeColumn: "date",
			valueColumn: "new_subscriptions",
			columns: {
				list_price_usd: (ctx) => price(ctx.row.plan, ctx.row.billing_period),
				first_period_price_usd: (ctx) => firstPeriodPrice(ctx.row.plan, ctx.row.billing_period, ctx.time),
				gross_bookings_usd: (ctx) => round2(ctx.value * firstPeriodPrice(ctx.row.plan, ctx.row.billing_period, ctx.time)),
			},
		},
	],

	superProps: {
		platform: ["web"],
		reader_tier: ["registered"],
		// sticky per member from the profile (stickyEventProps); declared here too so
		// warehouse groupBy validation sees it on every event
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
	},

	userProps: {
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		region: { __weights: { us_northeast: 26, us_south: 24, us_west: 22, us_midwest: 16, canada: 5, uk: 4, other_international: 3 } },
		age_band: { __weights: { "18-24": 9, "25-34": 22, "35-44": 23, "45-54": 19, "55-64": 15, "65+": 12 } },
		reader_tier: ["registered"],
		member_since: ["2025-01-01"],
	},

	personas: [
		{ name: "news_junkie", weight: 22, eventMultiplier: 1.8 },
		{ name: "regular", weight: 45, eventMultiplier: 1.0 },
		{ name: "casual", weight: 33, eventMultiplier: 0.45 },
	],

	retentionCurve: { type: "logarithmic", day1: 0.6, day7: 0.42, day30: 0.28 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/media/media.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the member seen with it on any event
// that carries both ids (the registration event stitches a new reader's earlier
// anonymous reads). Devices never seen with a user_id stay anonymous visitors.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped, e.device_id) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const half = (k) => Math.round((1 + 0.5 * (k - 1)) * 1000) / 1000; // half-effect floor for a ratio knob
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const SUB_TIERS = SQL_LIST(["digital", "all_access"]);

// H1 read windows: tournament days vs the days before previews and four weeks after the aftermath
const WC_BASE_A_END = "2026-06-08 00:00:00";
const WC_BASE_B = ["2026-07-23 00:00:00", "2026-08-20 00:00:00"];
// H3 read windows: three weeks before launch vs after the ramp
const GIFT_PRE = ["2026-07-20 00:00:00", TS(GIFT_LAUNCH)];
const GIFT_POST_FROM = TS(dayjs.utc(GIFT_LAUNCH).add(GIFT_RAMP_DAYS, "day").toISOString());
// H4 baseline: 14 days either side of the incident
const INC_BASE_DAYS = 14;
const INC_FROM = TS(dayjs.utc(OUTAGE_START).subtract(INC_BASE_DAYS, "day").toISOString());
const INC_TO = TS(dayjs.utc(OUTAGE_END).add(INC_BASE_DAYS, "day").toISOString());
// H5/H8 new-visitor cohort: first visits with a full 7-day registration window
const REG_WINDOW_DAYS = 7;
const VISIT_READ_END = TS(dayjs.utc(DATASET_END).subtract(REG_WINDOW_DAYS, "day").startOf("day").toISOString());
// H7 baseline: the four weeks before the sale
const SALE_PRE_FROM = TS(dayjs.utc(SALE_START).subtract(28, "day").toISOString());

const H1_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(WORLD_CUP_START)}' AND t < TIMESTAMP '${TS(WORLD_CUP_END)}' THEN 'in'
    WHEN t < TIMESTAMP '${WC_BASE_A_END}' OR (t >= TIMESTAMP '${WC_BASE_B[0]}' AND t < TIMESTAMP '${WC_BASE_B[1]}') THEN 'base' END AS per,
  section, uid FROM ev WHERE event = 'article viewed' AND reader_tier IN (${SUB_TIERS}))
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 (count(*) FILTER (WHERE per = 'in' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'in' AND section <> 'sports'))
 / (count(*) FILTER (WHERE per = 'base' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'base' AND section <> 'sports')) AS sports_lift
FROM w WHERE per IS NOT NULL`;

const H2_SQL = `WITH ${ID_CTE},
x AS (SELECT uid, any_value("Variant name") AS variant, min(t) AS t0 FROM ev WHERE event = '$experiment_started' GROUP BY 1)
SELECT x.variant AS grp, count(DISTINCT x.uid) AS user_count,
 count(*) FILTER (WHERE event = 'recommendation clicked' AND module = 'home_feed') AS feed_clicks,
 count(*) FILTER (WHERE event = 'front page viewed' AND page = 'home') AS home_views,
 count(*) FILTER (WHERE event = 'recommendation clicked' AND module = 'home_feed')::DOUBLE / count(*) FILTER (WHERE event = 'front page viewed' AND page = 'home') AS feed_ctr
FROM ev JOIN x ON x.uid = ev.uid
WHERE ev.t >= x.t0 AND ev.platform IN ('ios_app', 'android_app') GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN t >= TIMESTAMP '${GIFT_PRE[0]}' AND t < TIMESTAMP '${GIFT_PRE[1]}' THEN 'pre' WHEN t >= TIMESTAMP '${GIFT_POST_FROM}' THEN 'post' END AS per,
  CASE WHEN reader_tier IN (${SUB_TIERS}) THEN 'subscriber' WHEN reader_tier = 'registered' THEN 'free' END AS grp, event, uid
  FROM ev WHERE event IN ('article shared', 'article viewed', 'paywall shown')),
g AS (SELECT per, grp, count(DISTINCT uid) AS users,
  count(*) FILTER (WHERE event = 'article shared')::DOUBLE / count(*) FILTER (WHERE event IN ('article viewed', 'paywall shown')) AS share_rate
  FROM w WHERE per IS NOT NULL AND grp IS NOT NULL GROUP BY 1, 2)
SELECT grp, min(users) AS user_count,
 max(share_rate) FILTER (WHERE per = 'pre') AS share_rate_pre, max(share_rate) FILTER (WHERE per = 'post') AS share_rate_post,
 max(share_rate) FILTER (WHERE per = 'post') / max(share_rate) FILTER (WHERE per = 'pre') AS change
FROM g GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
v AS (SELECT uid, min(t) AS t0, any_value(acquisition_channel) AS ch FROM ev WHERE event = 'article viewed' AND reader_tier = 'anonymous' GROUP BY 1),
r AS (SELECT uid, min(t) AS tr FROM ev WHERE event = 'account registered' GROUP BY 1),
j AS (SELECT v.uid, v.ch, (r.tr IS NOT NULL AND r.tr >= v.t0 AND r.tr < v.t0 + INTERVAL ${REG_WINDOW_DAYS} DAY) AS reg,
  date_diff('second', v.t0, r.tr) / 3600.0 AS hours, v.t0 FROM v LEFT JOIN r ON r.uid = v.uid),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} GROUP BY 1),
c AS (SELECT ch, count(*) AS visitors, count(*) FILTER (WHERE reg) AS regs FROM j GROUP BY 1)
SELECT c.ch AS grp, c.visitors AS user_count, sp.spend / c.visitors AS spend_per_visitor, sp.spend / c.regs AS spend_per_registration, NULL AS reg_rate, NULL AS median_hours
FROM c JOIN sp ON sp.ch = c.ch
UNION ALL
SELECT CASE WHEN ch IN (${SQL_LIST(SOCIAL_CHANNELS)}) THEN 'social' ELSE 'other' END AS grp, count(*) AS user_count, NULL, NULL,
 avg(reg::INT) AS reg_rate, median(hours) FILTER (WHERE reg) AS median_hours
FROM j WHERE t0 < TIMESTAMP '${VISIT_READ_END}' GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN referrer = 'newsletter' THEN 'newsletter' ELSE 'other' END AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'paywall shown') AS paywall_views,
 count(*) FILTER (WHERE event = 'subscription started') AS subscriptions,
 count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'paywall shown') AS conv_per_view
FROM ev WHERE event IN ('paywall shown', 'subscription started') GROUP BY 1`;

const H7_SQL = `WITH ${ID_CTE},
p AS (SELECT DISTINCT date::DATE AS d, plan, billing_period, first_period_price_usd FROM ${WH("subscription_billing_daily")}),
w AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(SALE_START)}' AND t < TIMESTAMP '${TS(SALE_END)}' THEN 'sale'
    WHEN t >= TIMESTAMP '${SALE_PRE_FROM}' AND t < TIMESTAMP '${TS(SALE_START)}' THEN 'pre' END AS per, ev.event, ev.uid, p.first_period_price_usd
  FROM ev LEFT JOIN p ON ev.event = 'subscription started' AND p.d = ev.t::DATE AND p.plan = ev.plan AND p.billing_period = ev.billing_period
  WHERE ev.event IN ('paywall shown', 'subscription started'))
SELECT per AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE event = 'paywall shown') AS paywall_views,
 count(*) FILTER (WHERE event = 'subscription started') AS subscriptions,
 count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'paywall shown') AS conv_per_view,
 sum(first_period_price_usd) FILTER (WHERE event = 'subscription started') / count(*) FILTER (WHERE event = 'paywall shown') AS bookings_per_view
FROM w WHERE per IS NOT NULL GROUP BY 1`;

const H9_SQL = `WITH ${ID_CTE},
m AS (SELECT * FROM (VALUES (DATE '2026-07-01', DATE '2026-06-01'), (DATE '2026-08-01', DATE '2026-07-01'), (DATE '2026-09-01', DATE '2026-08-01')) x(ms, pms)),
um AS (SELECT m.ms, ev.uid, bool_and(ev.reader_tier IN (${SUB_TIERS})) AS all_sub,
  bool_or(ev.event IN ('subscription started', 'subscription cancelled')) AS changed,
  count(DISTINCT ev.t::DATE) FILTER (WHERE ev.event = 'article viewed') AS reading_days
  FROM ev JOIN m ON ev.t >= m.pms AND ev.t < m.ms GROUP BY 1, 2),
c AS (SELECT DISTINCT m.ms, ev.uid FROM ev JOIN m ON ev.t >= m.ms AND ev.t < m.ms + INTERVAL 1 MONTH WHERE ev.event = 'subscription cancelled')
SELECT CASE WHEN reading_days < ${READING_DAYS_MIN} THEN 'low' ELSE 'high' END AS grp, count(DISTINCT um.uid) AS user_count,
 count(*) AS subscriber_months, count(c.uid) AS cancels, count(c.uid)::DOUBLE / count(*) AS cancel_rate
FROM um LEFT JOIN c ON c.ms = um.ms AND c.uid = um.uid WHERE all_sub AND NOT changed GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-world-cup-sports-surge",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `The FIFA World Cup (${D(WORLD_CUP_START)} to 2026-07-19, hosted in the US, Canada, and Mexico) lifts sports reading. Each sports article read during the tournament brings extra sports reads in the same visit, by a daily multiplier that follows the bracket (group stage ${WC_LIFT_STEPS[1][1]}x, round of 32 ${WC_LIFT_STEPS[2][1]}x, round of 16 and quarterfinals ${WC_LIFT_STEPS[3][1]}x, semifinals ${WC_LIFT_STEPS[5][1]}x, final weekend ${WC_LIFT_STEPS[7][1]}x; previews and aftermath ${WC_LIFT_STEPS[0][1]}x), scaled per reader by a salted appetite (0-2x, mean 1). The mean daily multiplier over tournament days is ${WC_MEAN_LIFT}. Read on subscribers (no meter): sports / non-sports article views during the tournament over the same ratio in the baseline (Jun 4-7 and Jul 23 - Aug 19). Free readers' extra sports reads partly hit the meter, so the all-reader lift is smaller.`,
		mixpanelReport: { type: "Insights", event: "article viewed", filter: "reader_tier in (digital, all_access)", breakdown: "section", measure: "total", chart: "daily line; sports share of reads, Jun 11 - Jul 19 vs Jun 4-7 + Jul 23 - Aug 19" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.sports_lift", op: "between", target: band(WC_MEAN_LIFT) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H2-for-you-feed-experiment",
		hook: "H2",
		archetype: "experiment-lift",
		narrative: `The "${FOR_YOU_EXPERIMENT}" test starts ${D(FOR_YOU_START)} in the iOS and Android apps. Signed-in app readers are split 50/50 (sticky per member; exposure $experiment_started 1 s before their first app event on or after the start). The "${FOR_YOU_VARIANT}" arm replaces the home screen's Top Stories module with a personalized feed: clicks on the home module (recommendation clicked, module = home_feed) per home screen view rise ${FOR_YOU_CLICK_MULT}x (per-reader response salted 0.4-1.6x of the mean extra). Every extra click opens an article. Read: home_feed clicks per home view (page = home) on the apps since exposure, ${FOR_YOU_VARIANT} over Control.`,
		mixpanelReport: { type: "Insights", events: ["recommendation clicked (module = home_feed)", "front page viewed (page = home)"], formula: "A / B", filter: "platform in (ios_app, android_app)", dateRange: `${D(FOR_YOU_START)} to ${D(DATASET_END)}`, breakdown: `user property "${EXP_KEY}"` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { v: { where: { grp: FOR_YOU_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.feed_ctr / c.feed_ctr", op: "between", target: band(FOR_YOU_CLICK_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${FOR_YOU_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
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
		id: "H3-gift-articles-launch",
		hook: "H3",
		archetype: "temporal-inflection",
		narrative: `Gift Articles launches ${D(GIFT_LAUNCH)} for subscribers (staged over ${GIFT_RAMP_DAYS} days): a subscriber can send a link that opens one article free. Each subscriber share after the launch brings an extra gift share (share_method = gift_link) with probability ${(GIFT_SHARE_MULT - 1).toFixed(1)} x the ramp x a salted per-subscriber habit (0.35-1.65, mean 1), so subscriber shares per subscriber article read rise ${GIFT_SHARE_MULT}x; free readers (who cannot gift) are the control. Read: shares per attempted read (article viewed + paywall shown; a blocked read can still be shared), after the ramp (from ${GIFT_POST_FROM.slice(0, 10)}) vs the three weeks before launch, subscribers over free readers. gift_link never appears before the launch or from a non-subscriber.`,
		mixpanelReport: { type: "Insights", events: ["article shared", "article viewed", "paywall shown"], formula: "A / (B + C)", breakdown: "reader_tier", chart: `Jul 20 - Aug 10 vs Aug 18 - Oct 1` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { s: { where: { grp: "subscriber" } }, f: { where: { grp: "free" } } },
				expect: { metric: "s.change / f.change", op: "between", target: band(GIFT_SHARE_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE share_method = 'gift_link' AND (t < TIMESTAMP '${TS(GIFT_LAUNCH)}' OR reader_tier NOT IN (${SUB_TIERS}))) AS impure
FROM ev WHERE event = 'article shared'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: gift links exist only for subscribers after launch
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H4-web-meter-outage",
		hook: "H4",
		archetype: "bespoke",
		narrative: `From ${D(OUTAGE_START)} to ${D(OUTAGE_END)} (exclusive) the web metering service fails: ${OUTAGE_FAIL * 100}% of the web reads that should hit the paywall go through free (they stay "article viewed" and never fire "paywall shown"). The apps keep their own meter and are untouched. The days and platform come from warehouse platform_reliability_daily (service_status = 'major_outage', meter_error_rate ≈ ${OUTAGE_FAIL}). Read: web/app ratio of paywall shown on incident days vs the ${INC_BASE_DAYS} days either side reads 1 - ${OUTAGE_FAIL}.`,
		mixpanelReport: { type: "Insights", event: "paywall shown", measure: "total", breakdown: "platform", chart: "daily line", join: "warehouse platform_reliability_daily.service_status" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, platform FROM ${WH("platform_reliability_daily")} WHERE service_status = 'major_outage'),
od AS (SELECT DISTINCT d FROM o), op AS (SELECT DISTINCT platform FROM o),
w AS (SELECT t::DATE AS d, uid, (platform IN (SELECT platform FROM op)) AS hit FROM ev
  WHERE event = 'paywall shown' AND t >= TIMESTAMP '${INC_FROM}' AND t < TIMESTAMP '${INC_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE hit)::DOUBLE / count(*) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - OUTAGE_FAIL) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE service_status = 'major_outage') AS outage_rows,
 avg(meter_error_rate) FILTER (WHERE service_status = 'major_outage') AS outage_error_rate
FROM ${WH("platform_reliability_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse error rate during the incident = the failure knob
				expect: { metric: "a.outage_error_rate", op: "between", target: band(OUTAGE_FAIL) },
			},
		],
	},
	{
		id: "H5-paid-channel-economics",
		hook: "H5",
		archetype: "funnel-conversion-by-segment",
		narrative: `Meta ads buy The Lantern's cheapest new visitors and its weakest registrations. Warehouse marketing_spend_daily bills each paid channel ${SPEND_PLAN_SHARE * 100}% as a paced daily plan (expected visitors x cost per visitor, weekday-shaped above a 50% floor) and ${(1 - SPEND_PLAN_SHARE) * 100}% as cost per visitor x that day's new visitors, with seeded ±${SPEND_NOISE * 100}% day noise: $${CPV_USD.google_ads} Google, $${CPV_USD.meta_ads} Meta, $${CPV_USD.podcast_ads} podcast ads per new visitor over the window. Visitors from social platforms (Meta ads and organic social) register within ${REG_WINDOW_DAYS} days at ${SOCIAL_REG_MULT}x the rate of every other channel (${Math.round(REG_CONV * SOCIAL_REG_MULT)}% vs ${REG_CONV}%; two declared first funnels with acquisition_channel conditions). Spend per registration therefore runs ${((CPV_USD.meta_ads / SOCIAL_REG_MULT) / CPV_USD.google_ads).toFixed(2)}x higher on Meta than Google even though each Meta visitor costs ${(CPV_USD.meta_ads / CPV_USD.google_ads).toFixed(3)}x as much. A new visitor is a reader whose first read is anonymous (reader_tier = anonymous); a registration stitches it to the member.`,
		mixpanelReport: { type: "Funnels + Insights + warehouse", funnel: "article viewed (reader_tier = anonymous) → account registered, 7-day window, breakdown acquisition_channel", insights: "uniques of article viewed (reader_tier = anonymous) by acquisition_channel", join: "marketing_spend_daily.spend_usd by acquisition_channel" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { s: { where: { grp: "social" } }, o: { where: { grp: "other" } } },
				expect: { metric: "s.reg_rate / o.reg_rate", op: "between", target: band(SOCIAL_REG_MULT) },
				minCohort: 800,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { m: { where: { grp: "meta_ads" } }, g: { where: { grp: "google_ads" } } },
				expect: { metric: "m.spend_per_visitor / g.spend_per_visitor", op: "between", target: band(CPV_USD.meta_ads / CPV_USD.google_ads) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { m: { where: { grp: "meta_ads" } }, g: { where: { grp: "google_ads" } } },
				expect: { metric: "m.spend_per_registration / g.spend_per_registration", op: "between", target: band((CPV_USD.meta_ads / SOCIAL_REG_MULT) / CPV_USD.google_ads) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H6-newsletter-readers-convert",
		hook: "H6",
		archetype: "funnel-conversion-by-segment",
		narrative: `Newsletter readers are The Lantern's best prospects. Every blocked read becomes a "paywall shown" that converts to "subscription started" with probability ${BASE_PAYWALL_CONV * 100}% (x${SALE_CONV_MULT} during the sale, H7); when the blocked read came from a newsletter (referrer = newsletter: the read followed a newsletter open) the probability is ${REFERRER_CONV_MULT.newsletter}x. A reader subscribes at most once per paid stint and the paywall stops at that moment, so subscriptions per paywall view read the per-view probability directly. The subscription carries the converting read's referrer and section.`,
		mixpanelReport: { type: "Insights", events: ["subscription started", "paywall shown"], formula: "A / B", breakdown: "referrer" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { n: { where: { grp: "newsletter" } }, o: { where: { grp: "other" } } },
				expect: { metric: "n.conv_per_view / o.conv_per_view", op: "between", target: band(REFERRER_CONV_MULT.newsletter) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H7-labor-day-sale",
		hook: "H7",
		archetype: "temporal-inflection",
		narrative: `The Labor Day sale (${D(SALE_START)} to ${D(SALE_END)}, exclusive) takes ${SALE_DISCOUNT * 100}% off the first billing period of any plan (offer = labor_day_sale). Paywall conversion per view is ${SALE_CONV_MULT}x the four weeks before. Prices live only in warehouse subscription_billing_daily (first_period_price_usd), so first-period bookings per paywall view need the join: ${SALE_CONV_MULT} x ${(1 - SALE_DISCOUNT).toFixed(1)} = ${(SALE_CONV_MULT * (1 - SALE_DISCOUNT)).toFixed(2)} of before (the sale doubles sign-ups and takes in less first-period money per paywall view). The sale week holds about 150 subscriptions, so both reads use the knob as target with a half-effect floor.`,
		mixpanelReport: { type: "Insights + warehouse", events: ["subscription started", "paywall shown"], formula: "A / B", chart: `${D(SALE_START)} - 2026-09-09 vs ${SALE_PRE_FROM.slice(0, 10)} - 2026-09-02`, join: "subscription_billing_daily.first_period_price_usd on date, plan, billing_period" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { s: { where: { grp: "sale" } }, p: { where: { grp: "pre" } } },
				expect: { metric: "s.conv_per_view / p.conv_per_view", op: ">=", target: SALE_CONV_MULT, floor: half(SALE_CONV_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { s: { where: { grp: "sale" } }, p: { where: { grp: "pre" } } },
				expect: { metric: "s.bookings_per_view / p.bookings_per_view", op: "<=", target: Math.round(SALE_CONV_MULT * (1 - SALE_DISCOUNT) * 1000) / 1000, floor: half(SALE_CONV_MULT * (1 - SALE_DISCOUNT)) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H8-registration-speed-by-channel",
		hook: "H8",
		archetype: "funnel-ttc-by-segment",
		narrative: `Visitors from social platforms who do register take longer to do it. The gap from a new reader's first (anonymous) article to "account registered" is log-normal (sigma ${REG_TTC_SIGMA}) with median ${REG_TTC_H} h for search, podcast, and direct visitors and ${SOCIAL_TTC_MULT}x that (${REG_TTC_H * SOCIAL_TTC_MULT} h) for Meta and organic social visitors; every registration lands within ${REG_WINDOW_DAYS} days. Read: median hours first article → registration, visitors with a full ${REG_WINDOW_DAYS}-day window, social over other. About 400 social registrants, so the read uses the knob as target with a half-effect floor.`,
		mixpanelReport: { type: "Funnels", steps: ["article viewed (reader_tier = anonymous)", "account registered"], window: "7 days", measure: "median time to convert", breakdown: "acquisition_channel (Meta ads + social vs the rest)", dateRange: `${D(DATASET_START)} to ${VISIT_READ_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { s: { where: { grp: "social" } }, o: { where: { grp: "other" } } },
				expect: { metric: "s.median_hours / o.median_hours", op: ">=", target: SOCIAL_TTC_MULT, floor: half(SOCIAL_TTC_MULT) },
				minCohort: 800,
			},
		],
	},
	{
		id: "H9-reading-habit-churn",
		hook: "H9",
		archetype: "frequency-sweet-spot",
		narrative: `Subscribers who stop reading cancel. At the start of each calendar month, a subscriber who was paid for the whole prior month cancels during the month with probability ${CANCEL_Q.low} if they read on fewer than ${READING_DAYS_MIN} distinct days in the prior month, else ${CANCEL_Q.high} (${(CANCEL_Q.low / CANCEL_Q.high).toFixed(0)}x); the cancellation lands at a salted moment in the month and the member goes back to the meter. Read: subscriber-months July-September (subscribed with no plan change in the prior month and active in it), cancel rate by prior-month reading days (< ${READING_DAYS_MIN} vs ${READING_DAYS_MIN}+). About 300 cancellations in the read, so it uses the knob as target with a half-effect floor.`,
		mixpanelReport: { type: "Insights + cohorts", cohort: `subscribers (reader_tier in digital, all_access all month) with article viewed on fewer than ${READING_DAYS_MIN} distinct days in month M-1`, event: "subscription cancelled in month M, uniques", formula: "cancellers / cohort size, low vs high reading" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { l: { where: { grp: "low" } }, h: { where: { grp: "high" } } },
				expect: { metric: "l.cancel_rate / h.cancel_rate", op: ">=", target: CANCEL_Q.low / CANCEL_Q.high, floor: half(CANCEL_Q.low / CANCEL_Q.high) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H10-weekend-long-reads",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative: `Weekend reading is slower and deeper: every article read on Saturday or Sunday (UTC) has read_time_sec x${WEEKEND_READ_MULT}, and scroll depth follows the longer read. The content mix does not change by day of week, so average read time weekend over weekday reads the knob.`,
		mixpanelReport: { type: "Insights", event: "article viewed", measure: "average read_time_sec", breakdown: "day of week" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 avg(read_time_sec) FILTER (WHERE dayofweek(t) IN (0, 6)) / avg(read_time_sec) FILTER (WHERE dayofweek(t) NOT IN (0, 6)) AS weekend_ratio
FROM ev WHERE event = 'article viewed'`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.weekend_ratio", op: "between", target: band(WEEKEND_READ_MULT) },
				minCohort: 2000,
			},
		],
	},
];


export default config;

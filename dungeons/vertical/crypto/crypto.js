// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
/** @typedef {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       CoinNest
 * APP:        DeFi cryptocurrency exchange platform. Users connect wallets,
 *             swap tokens, stake for yield, mint NFTs, claim airdrops, and
 *             trade. Features KYC verification, pro trading tiers, and
 *             portfolio tracking.
 * SCALE:      10,000 users, ~2.2M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  wallet connected → KYC → deposit → swap → stake/unstake → portfolio viewed → withdrawal
 *
 * NOTE:       MOON/* and SCAM/* token pairs never occur organically — hooks
 *             flip them onto the declared token_pair column (H3, H8). All
 *             boundary days below are UTC calendar days from 2026-01-01.
 *
 * EVENTS (16):
 *   swap (10) > portfolio viewed (8) > deposit (5) > stake (4) > withdrawal (3)
 *   > price alert set (3) > limit order placed (3) > transfer (3) > kyc started (2)
 *   > unstake (2) > claim airdrop (2) > nft mint (2) > referral sent (2)
 *   > wallet connected (1) > kyc completed (1)
 *
 * FUNNELS (3):
 *   - Onboarding: wallet connected → kyc started → deposit (60%)
 *   - Trading:    deposit → swap → withdrawal (70%)
 *   - DeFi:       swap → stake → claim airdrop (35%)
 *
 * USER PROPS:  trading_tier, preferred_chain, wallet_type, total_trade_volume, portfolio_value, kyc_status
 * SUPER PROPS: trading_tier, preferred_chain, wallet_type
 * SCD PROPS:   trading_tier (Standard/Pro, monthly fuzzy, max 4)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * ---------------------------------------------------------------
 * 1. WHALE WALLETS (everything)
 *
 * PATTERN: ~13% of wallets (deterministic: user_id charCodeAt(0) % 50
 * === 0 — user_ids are hex uuids, so only '2' and 'd' match, 2 of 16
 * hex digits) get swap trade_amount_usd boosted 50x. No flag — analyst
 * sees long-tail trade-amount distribution.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Trade Amount Distribution
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Distribution of "trade_amount_usd"
 *   - Expected: heavy long tail; whale avg trade ~48x non-whale
 *     (measured 281K vs 5.8K; organic ratio 1.0)
 *
 *   Report 2: Volume Share by Top Traders Cohort
 *   - Cohort A: top 5% by total swap volume per user
 *   - Event: "swap"
 *   - Measure: Total of "trade_amount_usd"
 *   - Expected: cohort A drives ~75% of total volume (organic ~10%)
 *
 * REAL-WORLD ANALOGUE: Whale wallets dominate exchange volume.
 *
 * ---------------------------------------------------------------
 * 2. GAS PRICE SPIKE (event + everything)
 *
 * PATTERN: Days 35-37, gas_fee_usd 10x on swap + transfer events.
 * In window, 40% of swaps get swap_status flipped to "failed". No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Gas Fee Over Time
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Average of "gas_fee_usd"
 *   - Line chart by day
 *   - Expected: spike days 35-37 (~10x baseline; measured in-window
 *     avg 138 vs 13.7 outside)
 *
 *   Report 2: Swap Failure Rate Over Time
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Total
 *   - Filter: swap_status = "failed"
 *   - Line chart by day
 *   - Expected: in-window fail share ~0.52 vs ~0.17 baseline
 *     (40% of the non-failed remainder flipped: 0.17 + 0.4 × 0.83)
 *
 * REAL-WORLD ANALOGUE: Network congestion breaks transactions.
 *
 * ---------------------------------------------------------------
 * 3. TOKEN LAUNCH SURGE (event + everything)
 *
 * PATTERN: Day 50+, 25% of swaps get token_pair flipped to a MOON
 * pair. Each MOON swap clones 4 extra swap events with unique offset.
 * The 25% flip compounds through the 4x cloning to ~58% of post-d50
 * swap volume ((0.25 × 5) / (0.75 + 1.25), diluted by other hooks'
 * non-MOON clones). No flag — discover via token_pair breakdown.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Swap Volume by Token Pair Over Time
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Total
 *   - Filter: token_pair contains "MOON"
 *   - Line chart by day
 *   - Expected: exactly zero before day 50 (flips are post-launch
 *     only; clones offset forward), ~58% of swaps thereafter
 *
 * REAL-WORLD ANALOGUE: Meme/altcoin listings drive frenzied volume.
 *
 * ---------------------------------------------------------------
 * 4. AIRDROP HUNTER CHURN (everything)
 *
 * PATTERN: ~14% of users (deterministic: charCodeAt(1) % 25 === 0 on
 * hex uuids — only '2' and 'd' match) are airdrop-farming bots. After
 * their first "claim airdrop" event, 95% of subsequent events are
 * removed.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Airdrop Claim
 *   - Report type: Retention
 *   - Event A: "claim airdrop"
 *   - Event B: any event
 *   - Expected: bot claimers' post/pre-claim event ratio ~1.5 vs ~25
 *     for non-bot claimers (contrast ~0.06; organic contrast 1.0)
 *
 *   Report 2: Airdrop Hunters vs Real Traders
 *   - Report type: Insights
 *   - Events: "claim airdrop" unique users vs "swap" unique users
 *   - Expected: large overlap gap — many claimers never swap again
 *
 * REAL-WORLD ANALOGUE: Airdrop farms are a well-known DeFi growth
 * tax — bots claim free tokens and immediately abandon the platform.
 *
 * ---------------------------------------------------------------
 * 5. KYC FUNNEL COMPLETION (everything)
 *
 * PATTERN: Users with kyc-completed get post-KYC deposit_amount_usd
 * boosted 4x and 7 extra cloned swaps per existing post-KYC swap.
 * No flag — discover via cohort builder.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Deposit by KYC Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 "kyc completed"
 *   - Cohort B: rest
 *   - Event: "deposit"
 *   - Measure: Average of "deposit_amount_usd"
 *   - Expected: A ~3.4x B (4x knob diluted: whale-boosted amounts
 *     inflate the non-KYC mean, and pre-KYC deposits are unboosted;
 *     organic ratio 1.0). Swaps/user ~7.6x from the 7x cloning
 *     (organic activity confound alone is 2.0x — KYC completers pass
 *     more funnels).
 *
 * REAL-WORLD ANALOGUE: KYC unlocks higher limits.
 *
 * ---------------------------------------------------------------
 * 6. STAKE-TO-RETAIN (everything)
 *
 * PATTERN: Users who stake any token within first 14 calendar days get
 * extra cloned swap + portfolio events past day 60. Non-stakers lose
 * 85% of post-day-60 events — except each user's first 24 hours, which
 * are never dropped (churn erases return visits, not the signup; the
 * grace window keeps late-born users' onboarding funnel + auth event
 * intact). No flag — discover via engagement cohort.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Post-D60 Volume by Early Stake Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 "stake" in first 14 days
 *   - Cohort B: rest
 *   - Event: any event, Measure: Total per user, Filter: after day 60
 *   - Expected: A ~5.3x B events/user post-d60 (measured 153 vs 29;
 *     organic 1.1x). NOTE: binary D60 retention curves barely move —
 *     15% survival of a high-volume history still leaves >0 events
 *     for ~96% of non-stakers. The read is volume, not presence.
 *
 * REAL-WORLD ANALOGUE: Staking creates skin in the game.
 *
 * ---------------------------------------------------------------
 * 7. PRO TIER MAKER FEES (everything)
 *
 * PATTERN: Pro-tier users (profile.trading_tier, ~25% of users) get
 * maker_fee_pct pinned to 0.05 (vs Standard 0.30) on swap events plus
 * 5 extra cloned swaps per existing (~5.2x swaps/user measured, after
 * compounding with other hooks' clones). The hook also pins every
 * event's trading_tier to the profile value — organically the engine
 * stamps superProps per-event at random, so tier splits are only
 * meaningful in hooked data.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Maker Fee by Tier
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Average of "maker_fee_pct"
 *   - Breakdown: "trading_tier"
 *   - Expected: Pro = 0.05, Standard = 0.30 (exact — every swap pinned)
 *
 * REAL-WORLD ANALOGUE: Tiered fees retain volume traders.
 *
 * ---------------------------------------------------------------
 * 8. RUG-PULL AFTERMATH (everything)
 *
 * PATTERN: ~2% of day-10-to-70 swaps get token_pair flipped to a SCAM
 * pair; holders lose 80% of post-day-70 events. The flip is per-swap,
 * but active traders carry hundreds of swaps by day 70, so the holder
 * cohort is the MAJORITY of eventful users (~59% measured), not a
 * small victim group. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: SCAM Holder Post-D70 Collapse
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 swap where token_pair contains "SCAM"
 *   - Cohort B: rest
 *   - Measure: post-d70 / pre-d70 event ratio per user
 *   - Expected: A ~0.21 vs B ~1.25 (contrast ~0.17; organic all-user
 *     baseline 0.93 — no SCAM pairs exist organically)
 *
 * REAL-WORLD ANALOGUE: Rug-pulls collapse trust.
 *
 * ---------------------------------------------------------------
 * 9. ONBOARDING FUNNEL TIME-TO-CONVERT (funnel-post)
 *
 * PATTERN: Pro tier users complete the onboarding funnel (wallet
 * connected → kyc started → deposit) faster (gap factor 0.7);
 * Standard slower (factor 1.3). Mutates funnel event timestamps.
 * Scoped to the onboarding funnel only: the trading and DeFi funnels
 * share the swap step, and H3/H5/H7 clone swaps at arbitrary offsets,
 * which lets greedy funnel evaluation assemble chains across unscaled
 * clones and collapse the read. Onboarding's first step is
 * isFirstEvent — unique per user — anchoring the evaluator to the
 * exact instance the hook touched.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Onboarding Funnel Median Time-to-Convert by Tier
 *   - Report type: Funnels
 *   - Steps: "wallet connected" -> "kyc started" -> "deposit"
 *   - Measure: Median time to convert
 *   - Breakdown: "trading_tier"
 *   - Conversion window: 6 hours (covers the 1.3x-stretched support)
 *   - Expected: Pro/Standard median ratio ~0.74 (measured 32 vs 43
 *     min; the 0.7/1.3 knobs attenuate through median position;
 *     organic ratio 1.0). Only born-in users have this funnel
 *     (~13% of users — growth macro).
 *
 * REAL-WORLD ANALOGUE: Pro traders execute faster end-to-end.
 *
 * ---------------------------------------------------------------
 * 10. SWAP-COUNT MAGIC NUMBER (everything)
 *
 * PATTERN: Users with 8-20 swaps in dataset get +30% on stake
 * amount_usd plus 1-2 extra cloned stake events per existing.
 * Users with 21+ swaps drop 75% of portfolio-viewed events
 * and halve total_value_usd on survivors (over-active traders
 * ignore portfolio review). No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Stake Amount by Swap-Count Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 8-20 "swap"
 *   - Cohort B: users with 0-7
 *   - Event: "stake"
 *   - Measure: Average of "amount_usd"
 *   - Expected: A ~1.3x B (measured 1.32; organic 0.95)
 *
 *   Report 2: Portfolio Value on Heavy Swappers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 21 "swap"
 *   - Cohort A: users with 8-20
 *   - Event: "portfolio viewed"
 *   - Measure: Average of "total_value_usd"
 *   - Expected: C ~0.50x A (the halving on survivors is the clean
 *     read; the views-per-user contrast is confounded — over-active
 *     traders organically view portfolios more, so the 75% drop only
 *     nets out to parity per user)
 *
 * REAL-WORLD ANALOGUE: Engaged swappers grow stake; over-active
 * day-traders ignore long-term portfolio review.
 *
 * ---------------------------------------------------------------
 * 11. EARLY STAKER RETENTION (everything — retention magic number)
 *
 * PATTERN: Born-in-dataset users with 2+ "stake" events in their
 * first 10 lifetime days retain normally. Those with fewer than 2
 * early stakes lose 60% of events past lifetime day 40. Born-in ≈
 * has "wallet connected" (isFirstEvent). No flag — discover via
 * behavioral cohort on early stake count.
 *
 * NOTE (H6 interaction): H6 runs first and drops 85% of post-d60
 * calendar events for non-14d-stakers, which removes most late-born
 * users' day-2-to-10 stakes. The effective early-staker cohort is
 * therefore defined on post-H6 data (~14% of born-in users).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Post-Day-40 Event Volume by Early Stakers (born-in)
 *   - Report type: Insights (with cohort)
 *   - Cohort A: born-in users with >= 2 "stake" in first 10 days
 *   - Cohort B: born-in users with 0-1
 *   - Event: any event, Measure: Total per user, after lifetime d40
 *   - Expected: A ~1.3x B (organic baseline is 0.52 — INVERSE: most
 *     born-in users lack 40d of runway, so the hook must flip the
 *     sign, not just widen a gap)
 *
 * REAL-WORLD ANALOGUE: Users who stake early have skin in the game
 * and stick around; the "magic number" for retention is 2 stakes
 * in the first 10 days.
 *
 * ===================================================================
 * MEASURED METRICS SUMMARY (2K reduced run vs organic counterfactual)
 * ===================================================================
 *
 * Hook                  | Metric                          | Organic | Hooked
 * ----------------------|---------------------------------|---------|-------
 * 1 Whale Wallets       | whale/non avg trade amount      | 1.0x    | ~48x
 * 1 Whale Wallets       | top-5% volume share             | 0.10    | ~0.75
 * 2 Gas Price Spike     | in/out-window avg gas ratio     | 1.0x    | ~10x
 * 2 Gas Price Spike     | in-window swap fail share       | 0.17    | ~0.52
 * 3 Token Launch Surge  | post-d50 MOON swap share        | 0       | ~0.58
 * 4 Airdrop Churn       | claimer post/pre contrast (b/n) | ~1.0    | ~0.06
 * 5 KYC Completion      | avg deposit ratio (kyc/non)     | 1.0x    | ~3.4x
 * 5 KYC Completion      | swaps/user ratio (kyc/non)      | 2.0x    | ~7.6x
 * 6 Stake-to-Retain     | post-d60 events/user ratio      | 1.1x    | ~5.3x
 * 7 Pro Tier Fees       | maker_fee_pct (Pro / Standard)  | .30/.30 | .05/.30
 * 7 Pro Tier Fees       | swaps/user ratio (Pro/Std)      | n/a     | ~5.2x
 * 8 Rug-Pull Aftermath  | post/pre-d70 contrast (scam/non)| n/a     | ~0.17
 * 9 Onboarding TTC      | Pro/Std median TTC @6h window   | ~1.0    | ~0.74
 * 10 Swap Magic Number  | sweet/low avg stake amount      | 0.95    | ~1.32
 * 10 Swap Magic Number  | over/sweet avg portfolio value  | 1.00    | ~0.50
 * 11 Early Staker Retain| born-in early/non post-d40 ratio| 0.52    | ~1.31
 *
 * Identity: uid_share 1.0, device_share ≥0.999, devices/user ~2.06.
 * Organic "n/a" = cohort does not exist organically (no SCAM pairs;
 * tier stamped per-event at random).
 */

// ── SCALE ──
const SEED = "coinnest";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 0.83;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const WHALE_HASH_MOD = 50;
const WHALE_AMOUNT_MULT = 50;

const GAS_SPIKE_START_DAY = 35;
const GAS_SPIKE_END_DAY = 38;
const GAS_SPIKE_MULT = 10;
const GAS_SPIKE_FAIL_LIKELIHOOD = 40;

const MOON_LAUNCH_DAY = 50;
const MOON_FLIP_LIKELIHOOD = 25;
const MOON_CLONE_COUNT = 4;

const AIRDROP_BOT_HASH_MOD = 25;
const AIRDROP_DROP_LIKELIHOOD = 95;

const KYC_DEPOSIT_MULT = 4;
const KYC_SWAP_CLONE_COUNT = 7;

const STAKE_EARLY_WINDOW_DAYS = 14;
const STAKE_RETENTION_CUTOFF_DAYS = 60;
const STAKE_NON_STAKER_DROP_LIKELIHOOD = 85;
const STAKE_INJECT_SWAP_COUNT = 8;
const STAKE_INJECT_PORTFOLIO_COUNT = 4;

const PRO_MAKER_FEE = 0.05;
const STANDARD_MAKER_FEE = 0.30;
const PRO_SWAP_CLONE_COUNT = 5;

const SCAM_WINDOW_START_DAY = 10;
const SCAM_WINDOW_END_DAY = 70;
const SCAM_FLIP_LIKELIHOOD = 2;
const SCAM_DROP_LIKELIHOOD = 80;

const FUNNEL_TTC_PRO = 0.7;
const FUNNEL_TTC_STANDARD = 1.3;

const SWAP_SWEET_MIN = 8;
const SWAP_SWEET_MAX = 20;
const SWAP_OVER_THRESHOLD = 21;
const SWAP_STAKE_BOOST = 1.3;
const SWAP_OVER_PORTFOLIO_DROP_LIKELIHOOD = 75;
const SWAP_OVER_PORTFOLIO_VALUE_FACTOR = 0.5;

const EARLY_STAKE_MIN = 2;
const EARLY_STAKE_WINDOW_DAYS = 10;
const EARLY_STAKE_CUTOFF_DAYS = 40;
const EARLY_STAKE_DROP_LIKELIHOOD = 60;

// ── DATA ARRAYS ──
const TOKEN_PAIRS = [
	"ETH/USDC", "ETH/USDT", "BTC/USDC", "SOL/USDC",
	"MATIC/ETH", "ARB/ETH", "OP/USDC", "AVAX/USDC",
	"LINK/ETH", "UNI/USDC", "AAVE/ETH", "CRV/USDC",
	"DOGE/USDT", "PEPE/ETH", "APE/USDC"
];

const AIRDROP_NAMES = [
	"LayerZero Season 1", "zkSync Drop", "Starknet STRK",
	"Arbitrum ARB", "Optimism OP", "Blur Season 3",
	"EigenLayer Points", "Celestia TIA", "Jupiter JUP",
	"Wormhole W"
];

const NFT_COLLECTIONS = [
	"Bored Apes", "Azuki", "DeGods", "Pudgy Penguins",
	"Milady", "Doodles", "CloneX", "Moonbirds",
	"CryptoPunks", "Art Blocks"
];

// ── HELPER FUNCTIONS ──
function handleFunnelPostHooks(record, meta) {
	// H9: onboarding funnel TTC scaled by tier (Pro faster, Standard slower).
	// Scoped to the ONBOARDING funnel only. The trading and DeFi funnels share
	// the swap step, and H3/H5/H7 clone swaps at arbitrary offsets — scaling
	// those instances lets greedy evaluation (Mixpanel funnels + the emulator)
	// assemble chains across unscaled clones, collapsing the read. Onboarding's
	// first step (wallet connected, isFirstEvent) is unique per user, anchoring
	// the evaluator to the exact instance this hook touched.
	if (meta?.funnel?.sequence?.[0] !== "wallet connected") return record;
	const segment = meta?.profile?.trading_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "Pro" ? FUNNEL_TTC_PRO :
			segment === "Standard" ? FUNNEL_TTC_STANDARD :
			1.0
		);
		if (factor !== 1.0) {
			for (let i = 1; i < record.length; i++) {
				const prev = dayjs.utc(record[i - 1].time);
				const newGap = Math.round(dayjs.utc(record[i].time).diff(prev) * factor);
				record[i].time = prev.add(newGap, "milliseconds").toISOString();
			}
		}
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	// All boundary arithmetic in UTC: local-mode dayjs would place day-N
	// boundaries at machine-local midnight and shift them across the 2026-03-08
	// US DST transition — output would differ by machine timezone, breaking the
	// seeded byte-identical guarantee.
	const datasetStart = dayjs.unix(meta.datasetStart).utc();
	const userEvents = record;
	const profile = meta.profile;

	// Stamp superProps from profile for consistency
	userEvents.forEach(e => {
		e.trading_tier = profile.trading_tier;
		e.preferred_chain = profile.preferred_chain;
		e.wallet_type = profile.wallet_type;
	});

	// H1: Whale wallets — 2% of users (charCodeAt(0) % 50 === 0) get 50x swap volume
	const userId = userEvents.length > 0 ? (userEvents[0].user_id || userEvents[0].distinct_id || "") : "";
	const isWhale = userId.length > 0 && userId.charCodeAt(0) % WHALE_HASH_MOD === 0;
	if (isWhale) {
		userEvents.forEach(e => {
			if (e.event === "swap") {
				e.trade_amount_usd = Math.round((e.trade_amount_usd || 200) * WHALE_AMOUNT_MULT);
			}
		});
	}

	// H3: Token launch surge — after d50, 25% of swaps flip token_pair to MOON
	const moonLaunchDay = datasetStart.add(MOON_LAUNCH_DAY, "days");
	userEvents.forEach(e => {
		if (e.event === "swap" && dayjs.utc(e.time).isAfter(moonLaunchDay) && chance.bool({ likelihood: MOON_FLIP_LIKELIHOOD })) {
			e.token_pair = chance.pickone(["MOON/USDC", "MOON/ETH", "ETH/MOON"]);
		}
	});

	// H3 (cont): Clone 4 extra MOON-pair swaps per existing MOON swap with unique offset
	const moonSwaps = userEvents.filter(e =>
		e.event === "swap" &&
		typeof e.token_pair === "string" &&
		e.token_pair.includes("MOON")
	);
	if (moonSwaps.length > 0) {
		const clonedMoonEvents = [];
		moonSwaps.forEach(moonEvt => {
			const moonTime = dayjs.utc(moonEvt.time);
			for (let i = 0; i < MOON_CLONE_COUNT; i++) {
				clonedMoonEvents.push({
					...moonEvt,
					time: moonTime.add(chance.integer({ min: 1, max: 72 }), "hours").toISOString(),
					user_id: moonEvt.user_id,
					trade_amount_usd: Math.round((moonEvt.trade_amount_usd || 200) * chance.floating({ min: 0.5, max: 2.0 })),
				});
			}
		});
		userEvents.push(...clonedMoonEvents);
	}

	// H4: Airdrop hunter churn — 4% of users (charCodeAt(1) % 25 === 0) who claim
	// an airdrop lose 95% of subsequent events after first claim
	const isAirdropBot = userId.length > 1 && userId.charCodeAt(1) % AIRDROP_BOT_HASH_MOD === 0;
	const hasAirdropClaim = userEvents.some(e => e.event === "claim airdrop");
	if (isAirdropBot && hasAirdropClaim) {
		const firstClaim = userEvents.find(e => e.event === "claim airdrop");
		if (firstClaim) {
			const claimTime = dayjs.utc(firstClaim.time);
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (dayjs.utc(evt.time).isAfter(claimTime) && evt.event !== "claim airdrop") {
					if (chance.bool({ likelihood: AIRDROP_DROP_LIKELIHOOD })) {
						userEvents.splice(i, 1);
					}
				}
			}
		}
	}

	// H5: KYC funnel completion — post-KYC deposits 4x boost + 7 extra cloned swaps
	const kycCompleted = userEvents.find(e => e.event === "kyc completed");
	if (kycCompleted) {
		const kycTime = dayjs.utc(kycCompleted.time);
		userEvents.forEach(e => {
			if (dayjs.utc(e.time).isAfter(kycTime) && e.event === "deposit") {
				e.deposit_amount_usd = Math.round((e.deposit_amount_usd || 500) * KYC_DEPOSIT_MULT);
			}
		});

		const postKycSwaps = userEvents.filter(e =>
			e.event === "swap" && dayjs.utc(e.time).isAfter(kycTime)
		);
		const clonedKycSwaps = [];
		postKycSwaps.forEach(swapEvt => {
			const swapTime = dayjs.utc(swapEvt.time);
			for (let i = 0; i < KYC_SWAP_CLONE_COUNT; i++) {
				clonedKycSwaps.push({
					...swapEvt,
					time: swapTime.add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
					user_id: swapEvt.user_id,
					trade_amount_usd: Math.round((swapEvt.trade_amount_usd || 200) * chance.floating({ min: 0.8, max: 1.5 })),
				});
			}
		});
		userEvents.push(...clonedKycSwaps);
	}

	// H6: Stake-to-retain — early stakers get post-D60 events injected; non-stakers lose 85%
	const earlyStakeDay = datasetStart.add(STAKE_EARLY_WINDOW_DAYS, "days");
	const stakeRetentionCutoff = datasetStart.add(STAKE_RETENTION_CUTOFF_DAYS, "days");
	const stakedEarly = userEvents.some(e =>
		e.event === "stake" && dayjs.utc(e.time).isBefore(earlyStakeDay)
	);
	if (stakedEarly) {
		const postCutoffEvents = userEvents.filter(e => dayjs.utc(e.time).isAfter(stakeRetentionCutoff));
		if (postCutoffEvents.length < 5) {
			const swapTemplate = userEvents.find(e => e.event === "swap");
			const portfolioTemplate = userEvents.find(e => e.event === "portfolio viewed");
			if (swapTemplate) {
				for (let i = 0; i < STAKE_INJECT_SWAP_COUNT; i++) {
					userEvents.push({
						...swapTemplate,
						time: stakeRetentionCutoff.add(chance.integer({ min: 1, max: 55 }), "days").toISOString(),
						user_id: swapTemplate.user_id,
						trade_amount_usd: Math.round((swapTemplate.trade_amount_usd || 200) * chance.floating({ min: 0.5, max: 2.0 })),
					});
				}
			}
			if (portfolioTemplate) {
				for (let i = 0; i < STAKE_INJECT_PORTFOLIO_COUNT; i++) {
					userEvents.push({
						...portfolioTemplate,
						time: stakeRetentionCutoff.add(chance.integer({ min: 1, max: 55 }), "days").toISOString(),
						user_id: portfolioTemplate.user_id,
					});
				}
			}
		}
	} else {
		// Non-stakers: drop 85% of post-D60 events to simulate ~15% retention.
		// First-24h grace window: churn erases return visits, never the signup
		// itself. Without it, growth-macro users born after D60 (the majority)
		// lose their entire onboarding history — wallet connected (auth event),
		// kyc started, deposit — collapsing the H9 onboarding funnel population
		// and breaking identity stitching for late-born users.
		const nonStakerFirstT = userEvents.length > 0 ? dayjs.utc(userEvents[0].time) : null;
		const onboardingGraceEnd = nonStakerFirstT ? nonStakerFirstT.add(24, "hours") : null;
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (dayjs.utc(evt.time).isAfter(stakeRetentionCutoff)) {
				if (onboardingGraceEnd && !dayjs.utc(evt.time).isAfter(onboardingGraceEnd)) continue;
				if (chance.bool({ likelihood: STAKE_NON_STAKER_DROP_LIKELIHOOD })) {
					userEvents.splice(i, 1);
				}
			}
		}
	}

	// H7: Pro tier maker fees — Pro=0.05, Standard=0.30; Pro gets 5 extra cloned swaps
	if (profile.trading_tier === "Pro") {
		userEvents.forEach(e => {
			if (e.event === "swap") e.maker_fee_pct = PRO_MAKER_FEE;
		});
		const proSwaps = userEvents.filter(e => e.event === "swap");
		const clonedProSwaps = [];
		proSwaps.forEach(swapEvt => {
			const swapTime = dayjs.utc(swapEvt.time);
			for (let i = 0; i < PRO_SWAP_CLONE_COUNT; i++) {
				clonedProSwaps.push({
					...swapEvt,
					time: swapTime.add(chance.integer({ min: 1, max: 96 }), "hours").toISOString(),
					user_id: swapEvt.user_id,
					trade_amount_usd: Math.round((swapEvt.trade_amount_usd || 200) * chance.floating({ min: 0.5, max: 3.0 })),
					maker_fee_pct: PRO_MAKER_FEE,
				});
			}
		});
		userEvents.push(...clonedProSwaps);
	} else {
		userEvents.forEach(e => {
			if (e.event === "swap") e.maker_fee_pct = STANDARD_MAKER_FEE;
		});
	}

	// H8: Rug-pull aftermath — ~2% of pre-day-70 swaps flipped to SCAM; victims lose 80% post-D70
	const scamCutoff = datasetStart.add(SCAM_WINDOW_END_DAY, "days");
	let hadScam = false;
	userEvents.forEach(e => {
		if (e.event === "swap") {
			const swapDay = dayjs.utc(e.time).diff(datasetStart, "day");
			if (swapDay >= SCAM_WINDOW_START_DAY && swapDay < SCAM_WINDOW_END_DAY && chance.bool({ likelihood: SCAM_FLIP_LIKELIHOOD })) {
				e.token_pair = chance.pickone(["SCAM/USDC", "SCAM/ETH", "ETH/SCAM"]);
				hadScam = true;
			}
		}
	});
	if (hadScam) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (dayjs.utc(evt.time).isAfter(scamCutoff) && chance.bool({ likelihood: SCAM_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// H10: Swap-count magic number — sweet 8-20 boosts stake; over 21+ drops portfolio views
	const swapCount = userEvents.filter(e => e.event === "swap").length;
	if (swapCount >= SWAP_SWEET_MIN && swapCount <= SWAP_SWEET_MAX) {
		const stakeTemplate = userEvents.find(e => e.event === "stake");
		if (stakeTemplate) {
			const stakes = userEvents.filter(e => e.event === "stake");
			stakes.forEach(s => {
				if (typeof s.amount_usd === "number") s.amount_usd = Math.round(s.amount_usd * SWAP_STAKE_BOOST);
				const extras = chance.integer({ min: 1, max: 2 });
				for (let k = 0; k < extras; k++) {
					userEvents.push({
						...s,
						time: dayjs.utc(s.time).add(chance.integer({ min: 5, max: 360 }), "minutes").toISOString(),
						user_id: s.user_id,
					});
				}
			});
		}
	} else if (swapCount >= SWAP_OVER_THRESHOLD) {
		// Over-active traders ignore portfolio review: drop 75%, halve total_value_usd on survivors
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "portfolio viewed") {
				if (chance.bool({ likelihood: SWAP_OVER_PORTFOLIO_DROP_LIKELIHOOD })) {
					userEvents.splice(i, 1);
				} else {
					userEvents[i].total_value_usd = Math.round((userEvents[i].total_value_usd || 5000) * SWAP_OVER_PORTFOLIO_VALUE_FACTOR);
				}
			}
		}
	}

	// H11: Early staker retention — born-in users with <2 early stakes lose 60% post-D40
	if (meta.userIsBornInDataset) {
		const firstT = userEvents[0]?.time;
		if (firstT) {
			const window10 = dayjs.utc(firstT).add(EARLY_STAKE_WINDOW_DAYS, "days").toISOString();
			const earlyStakes = userEvents.filter(e => e.event === "stake" && e.time <= window10).length;
			if (earlyStakes < EARLY_STAKE_MIN) {
				const cutoff = dayjs.utc(firstT).add(EARLY_STAKE_CUTOFF_DAYS, "days");
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (dayjs.utc(userEvents[i].time).isAfter(cutoff) && chance.bool({ likelihood: EARLY_STAKE_DROP_LIKELIHOOD })) {
						userEvents.splice(i, 1);
					}
				}
			}
		}
	}

	// H2: Gas price spike — days 35-37 swap+transfer gas_fee_usd 10x; 40% of swaps fail.
	// Runs AFTER all cloning to catch events that land in the spike window from clone offsets.
	const gasSpikeStart = datasetStart.add(GAS_SPIKE_START_DAY, "days");
	const gasSpikeEnd = datasetStart.add(GAS_SPIKE_END_DAY, "days");
	userEvents.forEach(e => {
		if (e.event !== "swap" && e.event !== "transfer") return;
		const t = dayjs.utc(e.time);
		if (t.isAfter(gasSpikeStart) && t.isBefore(gasSpikeEnd)) {
			e.gas_fee_usd = Math.round((e.gas_fee_usd || 5) * GAS_SPIKE_MULT);
			if (e.event === "swap" && chance.bool({ likelihood: GAS_SPIKE_FAIL_LIKELIHOOD })) {
				e.swap_status = "failed";
			}
		}
	});

	userEvents.sort((a, b) => new Date(a.time) - new Date(b.time));
	return record;
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
		hasIOSDevices: true,
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

	soup: "growth",

	scdProps: {
		trading_tier: {
			values: ["Standard", "Pro"],
			frequency: "month",
			timing: "fuzzy",
			max: 4
		}
	},

	funnels: [
		{
			sequence: ["wallet connected", "kyc started", "deposit"],
			isFirstFunnel: true,
			conversionRate: 60,
			timeToConvert: 1,
		},
		{
			sequence: ["deposit", "swap", "withdrawal"],
			conversionRate: 70,
			timeToConvert: 2,
			weight: 5,
		},
		{
			sequence: ["swap", "stake", "claim airdrop"],
			conversionRate: 35,
			timeToConvert: 7,
			weight: 3,
		},
	],

	events: [
		{
			event: "wallet connected",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				wallet_type: ["MetaMask", "Phantom", "Coinbase Wallet", "Rainbow", "WalletConnect"],
				chain: ["Ethereum", "Solana", "Base", "Arbitrum", "Polygon"],
			}
		},
		{
			event: "kyc started",
			weight: 2,
			properties: {
				document_type: ["passport", "drivers_license", "national_id"],
				verification_method: ["selfie", "video", "document_scan"],
			}
		},
		{
			event: "kyc completed",
			weight: 1,
			properties: {
				document_type: ["passport", "drivers_license", "national_id"],
				verification_method: ["selfie", "video", "document_scan"],
			}
		},
		{
			event: "deposit",
			weight: 5,
			isStrictEvent: false,
			properties: {
				token: ["ETH", "USDC", "USDT", "SOL", "BTC"],
				deposit_amount_usd: u.weighNumRange(10, 5000, 0.3, 500),
				chain: ["Ethereum", "Solana", "Base", "Arbitrum", "Polygon"],
				deposit_method: ["wallet_transfer", "bridge", "on_ramp", "exchange_transfer"],
			}
		},
		{
			event: "withdrawal",
			weight: 3,
			isStrictEvent: false,
			properties: {
				token: ["ETH", "USDC", "USDT", "SOL", "BTC"],
				amount_usd: u.weighNumRange(10, 5000, 0.3, 400),
				chain: ["Ethereum", "Solana", "Base", "Arbitrum", "Polygon"],
				withdrawal_method: ["wallet_transfer", "bridge", "off_ramp", "exchange_transfer"],
			}
		},
		{
			event: "swap",
			weight: 10,
			isStrictEvent: false,
			properties: {
				token_pair: TOKEN_PAIRS,
				trade_amount_usd: u.weighNumRange(10, 10000, 0.3, 200),
				gas_fee_usd: u.weighNumRange(0.5, 30, 0.3, 5),
				swap_status: ["completed", "completed", "completed", "completed", "pending", "failed"],
				slippage_pct: u.weighNumRange(0.01, 5, 0.3, 0.5),
				maker_fee_pct: [0.30],
			}
		},
		{
			event: "stake",
			weight: 4,
			isStrictEvent: false,
			properties: {
				token: ["ETH", "SOL", "MATIC", "AVAX", "ATOM", "DOT"],
				amount_usd: u.weighNumRange(50, 10000, 0.3, 500),
				apy_pct: u.weighNumRange(2, 25, 0.5, 8),
				lock_period_days: [7, 14, 30, 60, 90, 180],
			}
		},
		{
			event: "unstake",
			weight: 2,
			properties: {
				token: ["ETH", "SOL", "MATIC", "AVAX", "ATOM", "DOT"],
				amount_usd: u.weighNumRange(50, 10000, 0.3, 500),
				apy_pct: u.weighNumRange(2, 25, 0.5, 8),
				lock_period_days: [7, 14, 30, 60, 90, 180],
			}
		},
		{
			event: "claim airdrop",
			weight: 2,
			isStrictEvent: false,
			properties: {
				airdrop_name: AIRDROP_NAMES,
				token_amount: u.weighNumRange(10, 10000, 0.3, 500),
				airdrop_value_usd: u.weighNumRange(5, 2000, 0.3, 100),
			}
		},
		{
			event: "nft mint",
			weight: 2,
			properties: {
				collection: NFT_COLLECTIONS,
				mint_price_usd: u.weighNumRange(10, 2000, 0.3, 150),
				chain: ["Ethereum", "Solana", "Base", "Polygon"],
			}
		},
		{
			event: "portfolio viewed",
			weight: 8,
			properties: {
				total_value_usd: u.weighNumRange(100, 100000, 0.3, 5000),
			}
		},
		{
			event: "price alert set",
			weight: 3,
			properties: {
				token: ["ETH", "BTC", "SOL", "MATIC", "AVAX", "LINK", "UNI", "AAVE"],
				alert_type: ["above", "below", "percent_change"],
			}
		},
		{
			event: "referral sent",
			weight: 2,
			properties: {
				referral_method: ["link", "email", "twitter", "discord", "telegram"],
			}
		},
		{
			event: "limit order placed",
			weight: 3,
			properties: {
				token_pair: TOKEN_PAIRS,
				order_type: ["limit_buy", "limit_sell", "stop_loss", "take_profit"],
				price_usd: u.weighNumRange(10, 50000, 0.3, 1000),
			}
		},
		{
			event: "transfer",
			weight: 3,
			properties: {
				token: ["ETH", "USDC", "USDT", "SOL", "BTC"],
				amount_usd: u.weighNumRange(10, 5000, 0.3, 300),
				gas_fee_usd: u.weighNumRange(0.5, 30, 0.3, 5),
				destination_type: ["wallet", "exchange", "contract", "ens_name"],
			}
		},
	],

	superProps: {
		trading_tier: ["Standard", "Standard", "Standard", "Pro"],
		preferred_chain: ["Ethereum", "Solana", "Base", "Arbitrum", "Polygon"],
		wallet_type: ["MetaMask", "Phantom", "Coinbase Wallet", "Rainbow", "WalletConnect"],
	},

	userProps: {
		trading_tier: ["Standard", "Standard", "Standard", "Pro"],
		preferred_chain: ["Ethereum", "Solana", "Base", "Arbitrum", "Polygon"],
		wallet_type: ["MetaMask", "Phantom", "Coinbase Wallet", "Rainbow", "WalletConnect"],
		total_trade_volume: u.weighNumRange(0, 500000, 0.3, 5000),
		portfolio_value: u.weighNumRange(0, 200000, 0.3, 3000),
		kyc_status: ["pending"],
	},

	groupKeys: [],
	groupProps: {},
	lookupTables: [],

	hook(record, type, meta) {
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

export default config;

// ── STORIES ──
/*
 * Derivation notes (2K reduced run iter-crypto-1 vs organic counterfactual
 * iter-crypto-0, hook overridden to identity; full fidelity = 10K users,
 * expected populations ≈ 5x the 2K numbers; scale guards at ~50% of that):
 *
 *  - h1: whale/non avg trade amount 48.4x (organic 0.99); top-5% volume
 *    share 0.747 (organic 0.104). Whale cohort = hex uuid charCodeAt(0)
 *    % 50 === 0 → chars '2','d' → ~13.2% of users.
 *  - h2: in-window (d35-38 UTC) avg gas 138.3 vs 13.7 out → 10.1x
 *    (organic 1.01); in-window swap fail share 0.516 vs 0.175 baseline
 *    (organic in-window 0.158).
 *  - h3: post-d50 MOON share 0.577; pre-d50 exactly 0 both runs (flips
 *    are post-launch only, clones offset forward — structural zero).
 *  - h4: bot claimers post/pre 1.54 vs non-bot 25.01 → contrast 0.062
 *    (organic contrast 1.02).
 *  - h5: kyc/non avg deposit 8429/2503 = 3.37x (organic 1.02); swaps/user
 *    224.7/29.5 = 7.63x (organic activity confound 2.02x).
 *  - h6: early-staker/non post-d60 events/user 152.8/29.0 = 5.27x
 *    (organic 1.10x). Binary D60 presence barely moves (0.96 vs 1.0) —
 *    volume is the read, not retention curves.
 *  - h7: fees exact 0.05/0.30 (organic 0.30 both — fee split fully
 *    hook-made); Pro/Std swaps/user 469/90 = 5.21x. Organic tier cells
 *    are meaningless (engine stamps superProps per-event at random;
 *    hook pins to profile).
 *  - h9: emulator timeToConvert @6h window Pro/Std median ratio 0.745
 *    (organic 1.01), stable across 1h-24h windows; converters 156/260
 *    born-in at 2K.
 *  - h10: sweet(8-20 swaps)/low stake amount 1.320 (organic 0.95 —
 *    slightly inverse); over/sweet avg portfolio total_value_usd 0.501
 *    (organic 0.999) — the 0.5 halving knob reads exactly.
 *  - h11: born-in early(≥2 stakes in 10d)/non post-d40 ratio 1.314
 *    (organic 0.521 — INVERSE organically; hook must flip the sign).
 *    Cohort defined on post-H6 data (H6 eats late-born early stakes).
 *  - identity: uid_share 1.0, device_share 0.9992, devices/user 2.064
 *    (avgDevicePerUser: 2).
 */

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;

const bandVerdict = (x, nailed, strong, detail, inverse = () => false) => {
	if (x == null || Number.isNaN(Number(x))) return { verdict: "NONE", detail: `${detail} — metric missing` };
	const v = Number(x);
	if (inverse(v)) return { verdict: "INVERSE", detail };
	if (v >= nailed[0] && v <= nailed[1]) return { verdict: "NAILED", detail };
	if (v >= strong[0] && v <= strong[1]) return { verdict: "STRONG", detail };
	return { verdict: "WEAK", detail };
};

const guarded = (ok, detail, inner) => ok ? inner() : { verdict: "WEAK", detail: `${detail} — cohort below scale guard (expected at reduced scale)` };

const worstOf = (...verdicts) => {
	const order = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"];
	const worst = order.find(o => verdicts.some(v => v.verdict === o)) || "NONE";
	return { verdict: worst, detail: verdicts.map(v => v.detail).join("; ") };
};

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map(r => [r[key], r]));

export const stories = [
	{
		id: "crypto-h1-whale-wallets",
		hook: "H1",
		archetype: "cohort-count-scale",
		narrative: "~13% of wallets (deterministic uuid hash) trade at 50x amounts: whale/non avg trade ratio ~48x and the top 5% of traders carry ~75% of total volume (organic: ratio 1.0, share 0.10).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    (ascii(substr(user_id::VARCHAR, 1, 1)) % 50 = 0) AS whale,
    AVG(trade_amount_usd) AS avg_amt
  FROM ${EV} WHERE event = 'swap' AND user_id IS NOT NULL GROUP BY 1, 2
)
SELECT CASE WHEN whale THEN 'whale' ELSE 'non' END AS cohort, COUNT(*) AS users, AVG(avg_amt) AS amt
FROM pu GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "cohort");
					if (!c.whale || !c.non) return { verdict: "NONE", detail: "whale/non cohorts missing" };
					const ratio = Number(c.whale.amt) / Number(c.non.amt);
					return guarded(Number(c.whale.users) >= 650 && Number(c.non.users) >= 4200,
						`whale ${c.whale.users}u / non ${c.non.users}u`,
						() => bandVerdict(ratio, [40, 57], [30, 70],
							`whale/non avg trade amount ${ratio.toFixed(1)}x (expect ~48x, organic 1.0x)`,
							v => v <= 5));
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid, SUM(trade_amount_usd) AS vol
  FROM ${EV} WHERE event = 'swap' AND user_id IS NOT NULL GROUP BY 1
), ranked AS (
  SELECT vol, ROW_NUMBER() OVER (ORDER BY vol DESC) AS rn, COUNT(*) OVER () AS n, SUM(vol) OVER () AS tot FROM pu
)
SELECT SUM(vol)::DOUBLE / MAX(tot) AS top5_share, MAX(n)::BIGINT AS traders FROM ranked WHERE rn <= CEIL(n * 0.05)`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r) return { verdict: "NONE", detail: "top5 query returned no rows" };
					return guarded(Number(r.traders) >= 5000, `${r.traders} traders`,
						() => bandVerdict(Number(r.top5_share), [0.68, 0.80], [0.60, 0.85],
							`top-5% volume share ${Number(r.top5_share).toFixed(3)} (expect ~0.75, organic 0.10)`,
							v => v <= 0.20));
				},
			},
		],
	},
	{
		id: "crypto-h2-gas-spike",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: "Days 35-37 network congestion: swap+transfer gas fees ~10x baseline and in-window swap failure share jumps to ~0.52 from ~0.17 (organic: 1.0x, 0.16).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  CASE WHEN time::TIMESTAMP > TIMESTAMP '2026-02-05 00:00:00' AND time::TIMESTAMP < TIMESTAMP '2026-02-08 00:00:00' THEN 'in' ELSE 'out' END AS win,
  COUNT(*) FILTER (WHERE event = 'swap') AS swaps,
  AVG(gas_fee_usd) AS gas,
  AVG((swap_status = 'failed')::INT) FILTER (WHERE event = 'swap') AS fail_share
FROM ${EV} WHERE event IN ('swap', 'transfer') GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "win");
					if (!c.in || !c.out) return { verdict: "NONE", detail: "in/out window cells missing" };
					return guarded(Number(c.in.swaps) >= 29000, `${c.in.swaps} in-window swaps`, () => {
						const gasRatio = Number(c.in.gas) / Number(c.out.gas);
						const legGas = bandVerdict(gasRatio, [8.5, 11.5], [7, 13],
							`in/out gas ratio ${gasRatio.toFixed(2)} (expect ~10.1, organic 1.0)`, v => v <= 1.5);
						const legFail = bandVerdict(Number(c.in.fail_share), [0.45, 0.57], [0.40, 0.63],
							`in-window fail share ${Number(c.in.fail_share).toFixed(3)} (expect ~0.52, organic 0.16)`, v => v <= 0.22);
						return worstOf(legGas, legFail);
					});
				},
			},
		],
	},
	{
		id: "crypto-h3-token-launch",
		hook: "H3",
		archetype: "temporal-inflection",
		narrative: "MOON token launches day 50: zero MOON swaps before (structural — flips are post-launch, clones offset forward), ~58% of swap volume after (25% flip compounded by 4x cloning).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN time::TIMESTAMP > TIMESTAMP '2026-02-20 00:00:00' THEN 'post' ELSE 'pre' END AS win,
  COUNT(*) AS swaps, AVG((token_pair LIKE '%MOON%')::INT) AS moon_share
FROM ${EV} WHERE event = 'swap' GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "win");
					if (!c.post || !c.pre) return { verdict: "NONE", detail: "pre/post windows missing" };
					return guarded(Number(c.post.swaps) >= 550000 && Number(c.pre.swaps) >= 340000,
						`pre ${c.pre.swaps} / post ${c.post.swaps} swaps`, () => {
							const legPost = bandVerdict(Number(c.post.moon_share), [0.50, 0.65], [0.42, 0.70],
								`post-d50 MOON share ${Number(c.post.moon_share).toFixed(3)} (expect ~0.58)`, v => v <= 0.05);
							const preShare = Number(c.pre.moon_share);
							const legPre = preShare <= 0.001
								? { verdict: "NAILED", detail: `pre-d50 MOON share ${preShare} (structural zero)` }
								: preShare > 0.05
									? { verdict: "INVERSE", detail: `pre-d50 MOON share ${preShare} — MOON exists before launch` }
									: { verdict: "WEAK", detail: `pre-d50 MOON share ${preShare} — nonzero` };
							return worstOf(legPost, legPre);
						});
				},
			},
		],
	},
	{
		id: "crypto-h4-airdrop-bots",
		hook: "H4",
		archetype: "retention-divergence",
		narrative: "~14% of users are airdrop-farming bots (uuid hash): after first claim they lose 95% of activity. Bot claimers' post/pre-claim ratio ~1.5 vs ~25 for non-bot claimers — contrast ~0.06 (organic 1.0).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH claims AS (
  SELECT user_id::VARCHAR AS uid, MIN(time::TIMESTAMP) AS t0
  FROM ${EV} WHERE event = 'claim airdrop' AND user_id IS NOT NULL GROUP BY 1
), pu AS (
  SELECT e.user_id::VARCHAR AS uid,
    (ascii(substr(e.user_id::VARCHAR, 2, 1)) % 25 = 0) AS bot,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP <= c.t0) AS pre_ev,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > c.t0) AS post_ev
  FROM ${EV} e JOIN claims c ON e.user_id::VARCHAR = c.uid GROUP BY 1, 2
)
SELECT CASE WHEN bot THEN 'bot' ELSE 'non' END AS cohort, COUNT(*) AS users,
  AVG(post_ev::DOUBLE / GREATEST(pre_ev, 1)) AS post_pre
FROM pu GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "cohort");
					if (!c.bot || !c.non) return { verdict: "NONE", detail: "bot/non claimer cohorts missing" };
					const contrast = Number(c.bot.post_pre) / Number(c.non.post_pre);
					return guarded(Number(c.bot.users) >= 500 && Number(c.non.users) >= 3200,
						`bot ${c.bot.users}u / non ${c.non.users}u`,
						() => bandVerdict(contrast, [0.03, 0.10], [0.02, 0.15],
							`bot/non post-pre contrast ${contrast.toFixed(3)} (expect ~0.06, organic 1.0)`,
							v => v >= 0.6));
				},
			},
		],
	},
	{
		id: "crypto-h5-kyc-completion",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative: "KYC completers deposit ~3.4x more per deposit (4x knob diluted by whale inflation of the non-KYC mean) and swap ~7.6x more per user (7x cloning over a 2.0x organic activity confound).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH kyc AS (
  SELECT user_id::VARCHAR AS uid, MIN(time::TIMESTAMP) AS kt
  FROM ${EV} WHERE event = 'kyc completed' AND user_id IS NOT NULL GROUP BY 1
), pu AS (
  SELECT e.user_id::VARCHAR AS uid, (k.uid IS NOT NULL) AS has_kyc,
    AVG(e.deposit_amount_usd) FILTER (WHERE e.event = 'deposit' AND (k.uid IS NULL OR e.time::TIMESTAMP > k.kt)) AS dep,
    COUNT(*) FILTER (WHERE e.event = 'swap') AS swaps
  FROM ${EV} e LEFT JOIN kyc k ON e.user_id::VARCHAR = k.uid
  WHERE e.user_id IS NOT NULL GROUP BY 1, 2
)
SELECT CASE WHEN has_kyc THEN 'kyc' ELSE 'non' END AS cohort, COUNT(*) AS users,
  AVG(dep) AS avg_deposit, AVG(swaps) AS swaps_per_user
FROM pu GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "cohort");
					if (!c.kyc || !c.non) return { verdict: "NONE", detail: "kyc/non cohorts missing" };
					return guarded(Number(c.kyc.users) >= 3800 && Number(c.non.users) >= 1100,
						`kyc ${c.kyc.users}u / non ${c.non.users}u`, () => {
							const depRatio = Number(c.kyc.avg_deposit) / Number(c.non.avg_deposit);
							const swapRatio = Number(c.kyc.swaps_per_user) / Number(c.non.swaps_per_user);
							const legDep = bandVerdict(depRatio, [2.9, 3.9], [2.4, 4.5],
								`kyc/non avg deposit ${depRatio.toFixed(2)}x (expect ~3.4x, organic 1.0x)`, v => v <= 1.3);
							const legSwap = bandVerdict(swapRatio, [6.3, 9.0], [5.0, 10.5],
								`kyc/non swaps/user ${swapRatio.toFixed(2)}x (expect ~7.6x, organic 2.0x)`, v => v <= 2.5);
							return worstOf(legDep, legSwap);
						});
				},
			},
		],
	},
	{
		id: "crypto-h6-stake-to-retain",
		hook: "H6",
		archetype: "retention-divergence",
		narrative: "Users who stake in the first 14 calendar days keep ~5.3x the post-d60 event volume of non-stakers (organic 1.1x). Non-stakers lose 85% of post-d60 events, first-24h onboarding grace excepted.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'stake' AND time::TIMESTAMP < TIMESTAMP '2026-01-15 00:00:00') AS early_staker,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-03-02 00:00:00') AS post60
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN early_staker THEN 'staker' ELSE 'non' END AS cohort, COUNT(*) AS users, AVG(post60) AS post60_per_user
FROM pu GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "cohort");
					if (!c.staker || !c.non) return { verdict: "NONE", detail: "staker/non cohorts missing" };
					const ratio = Number(c.staker.post60_per_user) / Number(c.non.post60_per_user);
					return guarded(Number(c.staker.users) >= 2100 && Number(c.non.users) >= 2800,
						`staker ${c.staker.users}u / non ${c.non.users}u`,
						() => bandVerdict(ratio, [4.5, 6.2], [3.8, 7.0],
							`staker/non post-d60 events/user ${ratio.toFixed(2)}x (expect ~5.3x, organic 1.1x)`,
							v => v <= 1.4));
				},
			},
		],
	},
	{
		id: "crypto-h7-pro-tier-fees",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: "Pro tier pays 0.05 maker fee vs Standard 0.30 (exact — every swap pinned; organic is 0.30 for both) and swaps ~5.2x more per user from 5x cloning.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT trading_tier AS tier, COUNT(DISTINCT user_id::VARCHAR) AS users,
  AVG(maker_fee_pct) AS fee,
  COUNT(*)::DOUBLE / COUNT(DISTINCT user_id::VARCHAR) AS swaps_per_user
FROM ${EV} WHERE event = 'swap' AND user_id IS NOT NULL GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "tier");
					if (!c.Pro || !c.Standard) return { verdict: "NONE", detail: "Pro/Standard tiers missing" };
					return guarded(Number(c.Pro.users) >= 1200 && Number(c.Standard.users) >= 3600,
						`Pro ${c.Pro.users}u / Standard ${c.Standard.users}u`, () => {
							const proFee = Number(c.Pro.fee), stdFee = Number(c.Standard.fee);
							const legFee = proFee >= stdFee
								? { verdict: "INVERSE", detail: `Pro fee ${proFee.toFixed(3)} >= Standard ${stdFee.toFixed(3)}` }
								: Math.abs(proFee - 0.05) <= 0.005 && Math.abs(stdFee - 0.30) <= 0.005
									? { verdict: "NAILED", detail: `fees exact: Pro ${proFee.toFixed(3)} / Standard ${stdFee.toFixed(3)}` }
									: proFee <= 0.10 && stdFee >= 0.25
										? { verdict: "STRONG", detail: `fees near-exact: Pro ${proFee.toFixed(3)} / Standard ${stdFee.toFixed(3)}` }
										: { verdict: "WEAK", detail: `fees off: Pro ${proFee.toFixed(3)} / Standard ${stdFee.toFixed(3)}` };
							const swapRatio = Number(c.Pro.swaps_per_user) / Number(c.Standard.swaps_per_user);
							const legSwaps = bandVerdict(swapRatio, [4.4, 6.1], [3.7, 7.0],
								`Pro/Std swaps/user ${swapRatio.toFixed(2)}x (expect ~5.2x)`, v => v <= 1.2);
							return worstOf(legFee, legSwaps);
						});
				},
			},
		],
	},
	{
		id: "crypto-h8-rugpull-aftermath",
		hook: "H8",
		archetype: "retention-divergence",
		narrative: "SCAM token holders (majority cohort — 2%/swap flip catches ~59% of eventful users) collapse after day 70: post/pre-d70 per-user ratio ~0.21 vs ~1.25 for non-holders, contrast ~0.17 (no SCAM pairs exist organically).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'swap' AND token_pair LIKE '%SCAM%') AS scam,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= TIMESTAMP '2026-03-12 00:00:00') AS pre_ev,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-03-12 00:00:00') AS post_ev
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN scam THEN 'scam' ELSE 'non' END AS cohort, COUNT(*) AS users,
  AVG(post_ev::DOUBLE / pre_ev) AS post_pre
FROM pu WHERE pre_ev >= 5 GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "cohort");
					if (!c.scam || !c.non) return { verdict: "NONE", detail: "scam/non cohorts missing" };
					const contrast = Number(c.scam.post_pre) / Number(c.non.post_pre);
					return guarded(Number(c.scam.users) >= 2900 && Number(c.non.users) >= 1500,
						`scam ${c.scam.users}u / non ${c.non.users}u`,
						() => bandVerdict(contrast, [0.12, 0.23], [0.08, 0.30],
							`scam/non post-pre-d70 contrast ${contrast.toFixed(3)} (expect ~0.17, organic n/a)`,
							v => v >= 0.75));
				},
			},
		],
	},
	{
		id: "crypto-h9-onboarding-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: "Pro tier completes onboarding (wallet connected → kyc started → deposit) faster: median TTC ratio Pro/Standard ~0.74 at a 6h conversion window (0.7/1.3 gap knobs attenuated through median position; organic 1.0). Scoped to onboarding — its isFirstEvent first step anchors greedy evaluation to the exact instance the hook touched.",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["wallet connected", "kyc started", "deposit"],
					breakdownByUserProperty: "trading_tier",
					conversionWindowMs: 6 * 3600 * 1000,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "segment_value");
					if (!c.Pro || !c.Standard) return { verdict: "NONE", detail: "Pro/Standard TTC segments missing" };
					const ratio = Number(c.Pro.median_ttc_ms) / Number(c.Standard.median_ttc_ms);
					return guarded(Number(c.Pro.user_count) >= 70 && Number(c.Standard.user_count) >= 320,
						`Pro ${c.Pro.user_count} / Standard ${c.Standard.user_count} converters`,
						() => bandVerdict(ratio, [0.66, 0.82], [0.60, 0.90],
							`Pro/Std median TTC ratio ${ratio.toFixed(3)} @6h (expect ~0.74, organic 1.0)`,
							v => v >= 0.97));
				},
			},
		],
	},
	{
		id: "crypto-h10-swap-magic-number",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative: "8-20 swaps is the stake sweet spot: sweet/low avg stake amount ~1.32x (organic 0.95 — slightly inverse). Over-active traders (21+) show halved portfolio values: over/sweet avg total_value_usd ~0.50 (organic 1.00). Views-per-user is NOT the read — activity confound nets the 75% drop to parity.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'swap') AS swaps,
    AVG(amount_usd) FILTER (WHERE event = 'stake') AS stake_amt,
    AVG(total_value_usd) FILTER (WHERE event = 'portfolio viewed') AS pv_val
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN swaps >= 21 THEN 'over' WHEN swaps >= 8 THEN 'sweet' ELSE 'low' END AS bucket,
  COUNT(*) AS users, AVG(stake_amt) AS stake_amt, AVG(pv_val) AS pv_value
FROM pu GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "bucket");
					if (!c.sweet || !c.low || !c.over) return { verdict: "NONE", detail: "swap-count buckets missing" };
					return guarded(Number(c.sweet.users) >= 480 && Number(c.low.users) >= 500 && Number(c.over.users) >= 4000,
						`low ${c.low.users}u / sweet ${c.sweet.users}u / over ${c.over.users}u`, () => {
							const stakeRatio = Number(c.sweet.stake_amt) / Number(c.low.stake_amt);
							const pvRatio = Number(c.over.pv_value) / Number(c.sweet.pv_value);
							const legStake = bandVerdict(stakeRatio, [1.20, 1.45], [1.10, 1.60],
								`sweet/low stake amount ${stakeRatio.toFixed(3)}x (expect ~1.32x, organic 0.95x)`, v => v <= 1.00);
							const legPv = bandVerdict(pvRatio, [0.44, 0.56], [0.38, 0.65],
								`over/sweet portfolio value ${pvRatio.toFixed(3)} (expect ~0.50, organic 1.00)`, v => v >= 0.90);
							return worstOf(legStake, legPv);
						});
				},
			},
		],
	},
	{
		id: "crypto-h11-early-staker-retention",
		hook: "H11",
		archetype: "retention-divergence",
		narrative: "Born-in users with 2+ stakes in their first 10 days out-retain the rest: post-d40 events/user ratio ~1.31 vs an INVERSE organic baseline of 0.52 (most born-in users lack 40d runway) — the hook flips the sign. Last assertion checks identity-model invariants.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH born AS (
  SELECT DISTINCT user_id::VARCHAR AS uid FROM ${EV} WHERE event = 'wallet connected' AND user_id IS NOT NULL
), firsts AS (
  SELECT user_id::VARCHAR AS uid, MIN(time::TIMESTAMP) AS t0 FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
), pu AS (
  SELECT e.user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE e.event = 'stake' AND e.time::TIMESTAMP <= f.t0 + INTERVAL 10 DAY) AS early_stakes,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > f.t0 + INTERVAL 40 DAY) AS post40
  FROM ${EV} e
  JOIN firsts f ON e.user_id::VARCHAR = f.uid
  JOIN born b ON e.user_id::VARCHAR = b.uid
  GROUP BY 1
)
SELECT CASE WHEN early_stakes >= 2 THEN 'early' ELSE 'non' END AS cohort, COUNT(*) AS users, AVG(post40) AS post40_per_user
FROM pu GROUP BY 1`,
				},
				assert: (rows) => {
					const c = cellsOf(rows, "cohort");
					if (!c.early || !c.non) return { verdict: "NONE", detail: "early/non born-in cohorts missing" };
					const ratio = Number(c.early.post40_per_user) / Number(c.non.post40_per_user);
					return guarded(Number(c.early.users) >= 90 && Number(c.non.users) >= 550,
						`early ${c.early.users}u / non ${c.non.users}u`,
						() => bandVerdict(ratio, [1.15, 1.55], [1.02, 1.80],
							`born-in early/non post-d40 ratio ${ratio.toFixed(3)} (expect ~1.31, organic 0.52 INVERSE)`,
							v => v <= 0.85));
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
					const r = rows?.[0];
					if (!r) return { verdict: "NONE", detail: "identity query returned no rows" };
					const uid = Number(r.uid_share), dev = Number(r.device_share), dpu = Number(r.devices_per_user);
					const detail = `uid_share ${uid.toFixed(4)}, device_share ${dev.toFixed(4)}, devices/user ${dpu.toFixed(2)} over ${r.n} events`;
					if (uid < 0.9) return { verdict: "INVERSE", detail };
					if (uid === 1 && dev >= 0.99 && dpu >= 1.6 && dpu <= 2.4) return { verdict: "NAILED", detail };
					if (uid >= 0.999 && dev >= 0.98) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
];

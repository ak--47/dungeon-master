// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       CoinNest
 * APP:        DeFi cryptocurrency exchange platform. Users connect wallets,
 *             swap tokens, stake for yield, mint NFTs, claim airdrops, and
 *             trade. Features KYC verification, pro trading tiers, and
 *             portfolio tracking.
 * SCALE:      10,000 users, ~600K events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  wallet connected → KYC → deposit → swap → stake/unstake → portfolio viewed → withdrawal
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
 * PATTERN: 2% of wallets (deterministic via id hash) get swap
 * trade_amount_usd boosted 50x. No flag — analyst sees long-tail
 * trade-amount distribution.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Trade Amount Distribution
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Distribution of "trade_amount_usd"
 *   - Expected: heavy long tail; top 2% of users dominate volume
 *
 *   Report 2: Volume Share by Top Traders Cohort
 *   - Cohort A: top 5% by total swap volume per user
 *   - Event: "swap"
 *   - Measure: Total of "trade_amount_usd"
 *   - Expected: cohort A drives ~ 60%+ of total volume
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
 *   - Expected: spike days 35-37 (~10x baseline)
 *
 *   Report 2: Swap Failure Rate Over Time
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Total
 *   - Filter: swap_status = "failed"
 *   - Line chart by day
 *   - Expected: failure rate spikes during gas window
 *
 * REAL-WORLD ANALOGUE: Network congestion breaks transactions.
 *
 * ---------------------------------------------------------------
 * 3. TOKEN LAUNCH SURGE (event + everything)
 *
 * PATTERN: Day 50+, 25% of swaps get token_pair flipped to a MOON
 * pair. Each MOON swap clones 4 extra swap events with unique offset.
 * No flag — discover via token_pair breakdown over time.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Swap Volume by Token Pair Over Time
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Total
 *   - Filter: token_pair contains "MOON"
 *   - Line chart by day
 *   - Expected: appears at day 50, surges thereafter
 *
 * REAL-WORLD ANALOGUE: Meme/altcoin listings drive frenzied volume.
 *
 * ---------------------------------------------------------------
 * 4. AIRDROP HUNTER CHURN (everything)
 *
 * PATTERN: 4% of users (deterministic via charCodeAt(1) % 25 === 0)
 * are airdrop-farming bots. After their first "claim airdrop" event,
 * 95% of subsequent events are removed.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Airdrop Claim
 *   - Report type: Retention
 *   - Event A: "claim airdrop"
 *   - Event B: any event
 *   - Expected: claimers retain dramatically worse than overall users
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
 *   - Expected: A ~ 4x B
 *
 * REAL-WORLD ANALOGUE: KYC unlocks higher limits.
 *
 * ---------------------------------------------------------------
 * 6. STAKE-TO-RETAIN (everything)
 *
 * PATTERN: Users who stake any token within first 14 days get extra
 * cloned swap + portfolio events past day 60. Non-stakers lose 85% of
 * post-day-60 events. No flag — discover via retention cohort.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Stake Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 1 "stake" in first 14 days
 *   - Cohort B: rest
 *   - Expected: A ~ 70% D60 vs B ~ 15%
 *
 * REAL-WORLD ANALOGUE: Staking creates skin in the game.
 *
 * ---------------------------------------------------------------
 * 7. PRO TIER MAKER FEES (everything)
 *
 * PATTERN: Pro-tier users (profile.trading_tier) get maker_fee_pct
 * pinned to 0.05 (vs Standard 0.30) on swap events plus 5 extra
 * cloned swaps per existing. Mutates raw prop. Discover via
 * trading_tier breakdown on maker_fee_pct.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Maker Fee by Tier
 *   - Report type: Insights
 *   - Event: "swap"
 *   - Measure: Average of "maker_fee_pct"
 *   - Breakdown: "trading_tier"
 *   - Expected: Pro ~ 0.05, Standard ~ 0.30
 *
 * REAL-WORLD ANALOGUE: Tiered fees retain volume traders.
 *
 * ---------------------------------------------------------------
 * 8. RUG-PULL AFTERMATH (everything)
 *
 * PATTERN: ~2% of pre-day-70 swaps get token_pair flipped to a SCAM
 * pair. Users who held SCAM lose 80% of post-day-70 events. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by SCAM Holder Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 1 swap where token_pair contains "SCAM"
 *   - Cohort B: rest
 *   - Expected: A retention drops sharply at day 70
 *
 * REAL-WORLD ANALOGUE: Rug-pulls collapse trust.
 *
 * ---------------------------------------------------------------
 * 9. TRADING FUNNEL TIME-TO-CONVERT (funnel-post)
 *
 * PATTERN: Pro tier users complete deposit→swap→withdrawal funnel
 * 1.4x faster than baseline (factor 0.7); Standard 1.3x slower
 * (factor 1.3). Mutates funnel event timestamps.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Trading Funnel Median Time-to-Convert by Tier
 *   - Report type: Funnels
 *   - Steps: "deposit" -> "swap" -> "withdrawal"
 *   - Measure: Median time to convert
 *   - Breakdown: "trading_tier"
 *   - Expected: Pro ~ 0.7x; Standard ~ 1.3x
 *
 *   NOTE (funnel-post measurement): visible only via Mixpanel funnel
 *   median TTC. Cross-event MIN→MIN SQL queries on raw events do NOT
 *   show this — funnel-post adjusts gaps within funnel instances, not
 *   across the user's full event history.
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
 *   - Expected: A ~ 1.3x B
 *
 *   Report 2: Portfolio Views per User on Heavy Swappers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 21 "swap"
 *   - Cohort A: users with 8-20
 *   - Event: "portfolio viewed"
 *   - Measure: Total per user
 *   - Expected: C ~ 40% fewer portfolio views per user
 *
 * REAL-WORLD ANALOGUE: Engaged swappers grow stake; over-active
 * day-traders ignore long-term portfolio review.
 *
 * ---------------------------------------------------------------
 * 11. EARLY STAKER RETENTION (everything — retention magic number)
 *
 * PATTERN: Born-in-dataset users with 2+ "stake" events in their
 * first 10 days retain normally. Those with fewer than 2 early
 * stakes lose 60% of post-day-40 events. No flag — discover via
 * behavioral cohort on early stake count.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Stakers
 *   - Report type: Retention
 *   - Cohort A: users with >= 2 "stake" in first 10 days
 *   - Cohort B: users with 0-1 "stake" in first 10 days
 *   - Expected: A retains strongly; B drops ~60% after day 40
 *
 *   Report 2: Post-Day-40 Event Volume by Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A vs B (as above)
 *   - Event: any event
 *   - Measure: Total per user
 *   - Filter: date > day 40
 *   - Expected: A ~ 2.5x B in post-d40 volume
 *
 * REAL-WORLD ANALOGUE: Users who stake early have skin in the game
 * and stick around; the "magic number" for retention is 2 stakes
 * in the first 10 days.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                  | Metric                | Baseline | Effect  | Ratio
 * ----------------------|-----------------------|----------|---------|------
 * Whale Wallets         | Top 5% trade share    | 5%       | ~ 60%   | n/a
 * Gas Price Spike       | gas_fee_usd days 35-7 | 1x       | 10x     | 10x
 * Token Launch Surge    | MOON pair share post-D50 | 0%    | ~ 25%+  | new
 * Airdrop Hunter Churn  | post-airdrop events   | 1x       | 0.05x   | -95%
 * KYC Completion        | deposit_amount_usd    | 1x       | 4x      | 4x
 * Stake-to-Retain       | D60 retention         | 15%      | 70%     | ~ 5x
 * Pro Tier Fees         | maker_fee_pct         | 0.30     | 0.05    | -83%
 * Rug-Pull Aftermath    | victim post-D70       | 1x       | 0.2x    | -80%
 * Trading T2C           | median min by tier    | 1x       | 0.7x/1.3x | 1.86x range
 * Swap Magic Number     | sweet stake amount    | 1x       | 1.3x    | 1.3x
 * Swap Magic Number     | over portfolio/user   | 1x       | 0.25x   | -75%
 * Early Staker Retain   | post-d40 events (non) | 1x       | 0.4x    | -60%
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
	// H9: Trading funnel TTC scaled by tier (Pro faster, Standard slower)
	const segment = meta?.profile?.trading_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "Pro" ? FUNNEL_TTC_PRO :
			segment === "Standard" ? FUNNEL_TTC_STANDARD :
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

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
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
		if (e.event === "swap" && dayjs(e.time).isAfter(moonLaunchDay) && chance.bool({ likelihood: MOON_FLIP_LIKELIHOOD })) {
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
			const moonTime = dayjs(moonEvt.time);
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
			const claimTime = dayjs(firstClaim.time);
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (dayjs(evt.time).isAfter(claimTime) && evt.event !== "claim airdrop") {
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
		const kycTime = dayjs(kycCompleted.time);
		userEvents.forEach(e => {
			if (dayjs(e.time).isAfter(kycTime) && e.event === "deposit") {
				e.deposit_amount_usd = Math.round((e.deposit_amount_usd || 500) * KYC_DEPOSIT_MULT);
			}
		});

		const postKycSwaps = userEvents.filter(e =>
			e.event === "swap" && dayjs(e.time).isAfter(kycTime)
		);
		const clonedKycSwaps = [];
		postKycSwaps.forEach(swapEvt => {
			const swapTime = dayjs(swapEvt.time);
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
		e.event === "stake" && dayjs(e.time).isBefore(earlyStakeDay)
	);
	if (stakedEarly) {
		const postCutoffEvents = userEvents.filter(e => dayjs(e.time).isAfter(stakeRetentionCutoff));
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
		// Non-stakers: drop 85% of post-D60 events to simulate ~15% retention
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (dayjs(evt.time).isAfter(stakeRetentionCutoff)) {
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
			const swapTime = dayjs(swapEvt.time);
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
			const swapDay = dayjs(e.time).diff(datasetStart, "day");
			if (swapDay >= SCAM_WINDOW_START_DAY && swapDay < SCAM_WINDOW_END_DAY && chance.bool({ likelihood: SCAM_FLIP_LIKELIHOOD })) {
				e.token_pair = chance.pickone(["SCAM/USDC", "SCAM/ETH", "ETH/SCAM"]);
				hadScam = true;
			}
		}
	});
	if (hadScam) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (dayjs(evt.time).isAfter(scamCutoff) && chance.bool({ likelihood: SCAM_DROP_LIKELIHOOD })) {
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
						time: dayjs(s.time).add(chance.integer({ min: 5, max: 360 }), "minutes").toISOString(),
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
			const window10 = dayjs(firstT).add(EARLY_STAKE_WINDOW_DAYS, "days").toISOString();
			const earlyStakes = userEvents.filter(e => e.event === "stake" && e.time <= window10).length;
			if (earlyStakes < EARLY_STAKE_MIN) {
				const cutoff = dayjs(firstT).add(EARLY_STAKE_CUTOFF_DAYS, "days");
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (dayjs(userEvents[i].time).isAfter(cutoff) && chance.bool({ likelihood: EARLY_STAKE_DROP_LIKELIHOOD })) {
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
		const t = dayjs(e.time);
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
	token,
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	hasAnonIds: true,
	avgDevicePerUser: 2,
	hasSessionIds: true,
	format: "json",
	gzip: true,
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

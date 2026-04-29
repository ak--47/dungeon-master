// ── TWEAK THESE ──
const SEED = "coinnest";
const num_days = 120;
const num_users = 6_000;
const avg_events_per_user_per_day = 0.83;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";

dayjs.extend(utc);
const chance = u.initChance(SEED);

/** @typedef  {import("../../types").Dungeon} Config */

/**
 * ===================================================================
 * DATASET OVERVIEW
 * ===================================================================
 *
 * CoinNest — a DeFi cryptocurrency exchange platform. Users connect
 * wallets, swap tokens, stake for yield, mint NFTs, claim airdrops,
 * and trade. Features KYC verification, pro trading tiers, and
 * portfolio tracking.
 *
 * Scale: 6,000 users · 600K events · 120 days · 16 event types
 *
 * Core loop: wallet connected → KYC → deposit → swap → stake/unstake
 *   → portfolio viewed → withdrawal
 *
 * Funnels:
 *   - Onboarding: wallet connected → kyc started → deposit (60%)
 *   - Trading: deposit → swap → withdrawal (70%)
 *   - DeFi: swap → stake → claim airdrop (35%)
 *
 * Tiers: Standard (75%) / Pro (25%)
 * Chains: Ethereum, Solana, Base, Arbitrum, Polygon
 * Wallets: MetaMask, Phantom, Coinbase Wallet, Rainbow, WalletConnect
 */

/**
 * ===================================================================
 * ANALYTICS HOOKS (10 hooks)
 * ===================================================================
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * via behavioral cohorts (count event per user, observe trade_amount
 * distribution) or raw-prop breakdowns (token_pair, day, trading_tier).
 *
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
 * PATTERN: ~8% of pre-day-70 swaps get token_pair flipped to a SCAM
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
 * REAL-WORLD ANALOGUE: Pro traders execute faster end-to-end.
 *
 * ---------------------------------------------------------------
 * 10. SWAP-COUNT MAGIC NUMBER (everything)
 *
 * PATTERN: Users with 8-20 swaps in dataset get +30% on stake
 * amount_usd plus 1-2 extra cloned stake events per existing.
 * Users with 21+ swaps drop 40% of portfolio-viewed events
 * (over-active traders ignore portfolio review). No flag.
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
 * Swap Magic Number     | over portfolio/user   | 1x       | 0.6x    | -40%
 */

// Token pairs used in swap events
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

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-04-28T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: false,
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

	hook: function (record, type, meta) {
		// HOOK 2 (event): GAS PRICE SPIKE — days 35-37, gas fees 10x.
		// HOOK 3 (event): TOKEN LAUNCH SURGE — after day 50, 25% of swaps
		// flip token_pair to MOON. All raw mutations, no flags.
		if (type === "event") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const EVENT_TIME = dayjs(record.time);
			const dayInDataset = EVENT_TIME.diff(datasetStart, "day");

			if (dayInDataset >= 35 && dayInDataset <= 37) {
				if (record.event === "swap" || record.event === "transfer") {
					record.gas_fee_usd = Math.round((record.gas_fee_usd || 5) * 10);
				}
			}

			if (record.event === "swap" && dayInDataset >= 50 && chance.bool({ likelihood: 25 })) {
				record.token_pair = chance.pickone(["MOON/USDC", "MOON/ETH", "ETH/MOON"]);
			}
		}

		// HOOK 9 (T2C): TRADING FUNNEL TIME-TO-CONVERT (funnel-post)
		// Pro tier users complete deposit→swap→withdrawal funnel 1.4x faster
		// (factor 0.7 on inter-event gaps); Standard 1.3x slower (factor 1.3).
		if (type === "funnel-post") {
			const segment = meta?.profile?.trading_tier;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "Pro" ? 0.7 :
					segment === "Standard" ? 1.3 :
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
		}

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const userEvents = record;
			const profile = meta.profile;

			// Stamp superProps from profile for consistency
			userEvents.forEach(e => {
				e.trading_tier = profile.trading_tier;
				e.preferred_chain = profile.preferred_chain;
				e.wallet_type = profile.wallet_type;
			});

			const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;

			// HOOK 1: WHALE WALLETS — 2% of users (charCodeAt(0) % 50 === 0)
			// get swap trade_amount_usd boosted 50x. No flag.
			const userId = userEvents.length > 0 ? (userEvents[0].user_id || userEvents[0].distinct_id || "") : "";
			const isWhale = userId.length > 0 && userId.charCodeAt(0) % 50 === 0;

			if (isWhale) {
				userEvents.forEach(e => {
					if (e.event === "swap") {
						e.trade_amount_usd = Math.round((e.trade_amount_usd || 200) * 50);
					}
				});
			}

			// HOOK 2 (cont): GAS PRICE SPIKE — during days 35-37, 40% of
			// swaps get swap_status flipped to failed. Discover via HOD/day chart.
			const day35 = datasetStart.add(35, "days");
			const day38 = datasetStart.add(38, "days");
			userEvents.forEach(e => {
				if (e.event === "swap") {
					const t = dayjs(e.time);
					if (t.isAfter(day35) && t.isBefore(day38) && chance.bool({ likelihood: 40 })) {
						e.swap_status = "failed";
					}
				}
			});

			// HOOK 3 (cont): TOKEN LAUNCH SURGE — clone 4 extra MOON-pair
			// swap events per existing MOON swap. Cloned with unique offset.
			const moonSwaps = userEvents.filter(e =>
				e.event === "swap" &&
				typeof e.token_pair === "string" &&
				e.token_pair.includes("MOON")
			);
			if (moonSwaps.length > 0) {
				const clonedMoonEvents = [];
				moonSwaps.forEach(moonEvt => {
					const moonTime = dayjs(moonEvt.time);
					for (let i = 0; i < 4; i++) {
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

			// -----------------------------------------------------------
			// Hook #4: AIRDROP HUNTER CHURN
			// 4% of users are deterministically tagged as airdrop-farming bots
			// via charCodeAt(1) % 25 === 0. Bots that have ever claimed an airdrop
			// lose 95% of events after their first claim. (Original cohort
			// "claimed-but-never-swapped" was empty because every claimer also
			// has organic swap events at this scale.)
			// -----------------------------------------------------------
			const isAirdropBot = userId.length > 1 && userId.charCodeAt(1) % 25 === 0;
			const hasAirdropClaim = userEvents.some(e => e.event === "claim airdrop");

			if (isAirdropBot && hasAirdropClaim) {
				const firstClaim = userEvents.find(e => e.event === "claim airdrop");
				if (firstClaim) {
					const claimTime = dayjs(firstClaim.time);
					for (let i = userEvents.length - 1; i >= 0; i--) {
						const evt = userEvents[i];
						if (dayjs(evt.time).isAfter(claimTime) && evt.event !== "claim airdrop") {
							if (chance.bool({ likelihood: 95 })) {
								userEvents.splice(i, 1);
							}
						}
					}
				}
			}

			// HOOK 5: KYC FUNNEL COMPLETION — users with kyc-completed
			// get post-KYC deposit_amount_usd boosted 4x and 7 extra cloned
			// swaps per existing post-KYC swap. No flag.
			const kycCompleted = userEvents.find(e => e.event === "kyc completed");
			if (kycCompleted) {
				const kycTime = dayjs(kycCompleted.time);

				userEvents.forEach(e => {
					if (dayjs(e.time).isAfter(kycTime) && e.event === "deposit") {
						e.deposit_amount_usd = Math.round((e.deposit_amount_usd || 500) * 4);
					}
				});

				const postKycSwaps = userEvents.filter(e =>
					e.event === "swap" && dayjs(e.time).isAfter(kycTime)
				);
				const clonedKycSwaps = [];
				postKycSwaps.forEach(swapEvt => {
					const swapTime = dayjs(swapEvt.time);
					for (let i = 0; i < 7; i++) {
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

			// -----------------------------------------------------------
			// Hook #6: STAKE-TO-RETAIN
			// Users who stake any token within the first 14 days of the
			// dataset have 70% D60 retention (events injected beyond D60).
			// Non-stakers lose events after day 60 to simulate 15% retention.
			// -----------------------------------------------------------
			const day14 = datasetStart.add(14, "days");
			const day60 = datasetStart.add(60, "days");

			const stakedEarly = userEvents.some(e =>
				e.event === "stake" && dayjs(e.time).isBefore(day14)
			);

			if (stakedEarly) {
				// 70% retention: inject late-stage events for stakers (no flag)
				const postD60Events = userEvents.filter(e => dayjs(e.time).isAfter(day60));
				if (postD60Events.length < 5) {
					const swapTemplate = userEvents.find(e => e.event === "swap");
					const portfolioTemplate = userEvents.find(e => e.event === "portfolio viewed");
					if (swapTemplate) {
						for (let i = 0; i < 8; i++) {
							userEvents.push({
								...swapTemplate,
								time: day60.add(chance.integer({ min: 1, max: 55 }), "days").toISOString(),
								user_id: swapTemplate.user_id,
								trade_amount_usd: Math.round((swapTemplate.trade_amount_usd || 200) * chance.floating({ min: 0.5, max: 2.0 })),
							});
						}
					}
					if (portfolioTemplate) {
						for (let i = 0; i < 4; i++) {
							userEvents.push({
								...portfolioTemplate,
								time: day60.add(chance.integer({ min: 1, max: 55 }), "days").toISOString(),
								user_id: portfolioTemplate.user_id,
							});
						}
					}
				}
			} else {
				// Non-stakers: 15% retention past D60 — remove 85% of post-D60 events
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (dayjs(evt.time).isAfter(day60)) {
						if (chance.bool({ likelihood: 85 })) {
							userEvents.splice(i, 1);
						}
					}
				}
			}

			// HOOK 7: PRO TIER MAKER FEES — Pro users pay maker_fee_pct=0.05
			// (vs Standard 0.30) and get 5 extra cloned swaps. Mutates raw
			// maker_fee_pct prop. Reads trading_tier from profile.
			if (profile.trading_tier === "Pro") {
				userEvents.forEach(e => {
					if (e.event === "swap") e.maker_fee_pct = 0.05;
				});

				const proSwaps = userEvents.filter(e => e.event === "swap");
				const clonedProSwaps = [];
				proSwaps.forEach(swapEvt => {
					const swapTime = dayjs(swapEvt.time);
					for (let i = 0; i < 5; i++) {
						clonedProSwaps.push({
							...swapEvt,
							time: swapTime.add(chance.integer({ min: 1, max: 96 }), "hours").toISOString(),
							user_id: swapEvt.user_id,
							trade_amount_usd: Math.round((swapEvt.trade_amount_usd || 200) * chance.floating({ min: 0.5, max: 3.0 })),
							maker_fee_pct: 0.05,
						});
					}
				});
				userEvents.push(...clonedProSwaps);
			} else {
				userEvents.forEach(e => {
					if (e.event === "swap") e.maker_fee_pct = 0.30;
				});
			}

			// -----------------------------------------------------------
			// Hook #8: RUG-PULL AFTERMATH
			// Day 70, "SCAM" token rugs. Users who swapped SCAM token
			// before day 70 lose 80% of events after day 70.
			// rug_pull_victim=true on remaining events.
			// -----------------------------------------------------------
			const day70 = datasetStart.add(70, "days");

			// Check if user traded SCAM before day 70
			// ~10% of pre-day-70 swaps naturally get SCAM token pair
			// (injected here since SCAM isn't in the default TOKEN_PAIRS list)
			let hadScam = false;
			userEvents.forEach(e => {
				if (e.event === "swap") {
					const swapDay = dayjs(e.time).diff(datasetStart, "day");
					// Before day 70, ~8% of swaps randomly become SCAM trades
					if (swapDay >= 10 && swapDay < 70 && chance.bool({ likelihood: 8 })) {
						e.token_pair = chance.pickone(["SCAM/USDC", "SCAM/ETH", "ETH/SCAM"]);
						hadScam = true;
					}
				}
			});

			if (hadScam) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (dayjs(evt.time).isAfter(day70) && chance.bool({ likelihood: 80 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// HOOK 10: SWAP-COUNT MAGIC NUMBER (no flags)
			// Sweet 8-20 swaps → +30% on stake amount_usd; clone 1-2 extra
			// stake events per existing. Over 21+ → drop 40% of portfolio
			// viewed events (over-active traders ignore their portfolio).
			const swapCount = userEvents.filter(e => e.event === "swap").length;
			if (swapCount >= 8 && swapCount <= 20) {
				const stakeTemplate = userEvents.find(e => e.event === "stake");
				if (stakeTemplate) {
					const stakes = userEvents.filter(e => e.event === "stake");
					stakes.forEach(s => {
						if (typeof s.amount_usd === "number") s.amount_usd = Math.round(s.amount_usd * 1.3);
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
			} else if (swapCount >= 21) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "portfolio viewed" && chance.bool({ likelihood: 40 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			userEvents.sort((a, b) => new Date(a.time) - new Date(b.time));
		}

		return record;
	}
};

export default config;

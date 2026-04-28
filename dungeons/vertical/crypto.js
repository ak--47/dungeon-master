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
 * ANALYTICS HOOKS (8 architected patterns)
 * ===================================================================
 *
 * 1. WHALE WALLETS (everything hook — purchase value)
 *    2% of wallets do 60% of trade volume. Deterministic via
 *    charCodeAt(0) % 50 === 0. Whale swaps are 50x bigger with
 *    is_whale=true.
 *    → Insights: "swap" total trade_amount_usd, breakdown is_whale
 *    → Insights: "swap" count of unique users, filter is_whale = true
 *      (expect ~2% of users, ~60% of total volume)
 *
 * 2. GAS PRICE SPIKE (event + everything hook — time-based)
 *    Days 35-37, network congestion. Gas fees 10x on swap/transfer,
 *    gas_spike=true. 40% of swaps in this window fail.
 *    → Insights: "swap" avg gas_fee_usd by day
 *      (expect massive spike at days 35-37)
 *    → Insights: "swap" count, breakdown swap_status, filter gas_spike=true
 *      (expect ~40% failed during spike)
 *
 * 3. TOKEN LAUNCH SURGE (event + everything hook — timed release)
 *    Day 50, "MOON" token lists. After day 50, 25% of swaps become
 *    MOON trades. MOON traders get 5x event volume via cloned swaps.
 *    → Insights: "swap" total by day, breakdown moon_trade
 *      (expect large surge after day 50)
 *    → Insights: "swap" total trade_amount_usd, filter moon_trade=true
 *
 * 4. AIRDROP HUNTER CHURN (everything hook — churn)
 *    Users who claim airdrops but never swap are bots. 95% of their
 *    events after the airdrop claim are removed.
 *    → Retention: any event, segment by users who did "claim airdrop"
 *      (expect abysmal retention for airdrop-only users)
 *    → Insights: "claim airdrop" unique users vs "swap" unique users
 *
 * 5. KYC FUNNEL COMPLETION (everything hook — conversion)
 *    KYC-verified users deposit 4x more and swap 8x more (cloned
 *    events). kyc_verified=true flagged on post-KYC events.
 *    → Insights: "deposit" avg deposit_amount_usd, breakdown kyc_verified
 *      (expect ~4x for verified users)
 *    → Insights: "swap" count per user, breakdown kyc_verified
 *
 * 6. STAKE-TO-RETAIN (everything hook — retention)
 *    Users who stake within first 14 days get 70% D60 retention
 *    (events injected). Non-stakers lose events after day 60 to
 *    simulate 15% retention.
 *    → Retention: any event, segment staked_early=true vs false
 *      (expect dramatic retention gap at D60)
 *    → Insights: event count by day, breakdown staked_early
 *
 * 7. PRO TIER MAKER FEES (everything hook — subscription tier)
 *    Pro users pay 0.05% maker fees (vs 0.30%). Pro users trade 6x
 *    volume. pro_advantage=true on Pro swap events.
 *    → Insights: "swap" avg maker_fee_pct, breakdown trading_tier
 *      (expect Pro ~0.05, Standard ~0.30)
 *    → Insights: "swap" total trade_amount_usd, breakdown pro_advantage
 *
 * 8. RUG-PULL AFTERMATH (everything hook — time-based churn)
 *    Day 70, "SCAM" token rugs. Users who held SCAM (swapped it
 *    before day 70) lose 80% of events after day 70. Flagged
 *    rug_pull_victim=true.
 *    → Retention: any event, segment rug_pull_victim=true vs others
 *      (expect massive drop-off at day 70 for victims)
 *    → Insights: any event total by day, filter rug_pull_victim=true
 *
 * ===================================================================
 * ADVANCED ANALYSIS IDEAS
 * ===================================================================
 *
 * Cross-hook patterns:
 *   - Whale + MOON: Do whales drive the MOON token surge?
 *   - Gas Spike + Rug Pull: Do SCAM holders panic-sell during gas spikes?
 *   - KYC + Pro Tier: Do verified users upgrade to Pro faster?
 *   - Stakers + Whales: Do whales stake more, or just trade?
 *   - Airdrop Hunters + Rug Pull: Overlap between bots and victims?
 *
 * Cohort analysis:
 *   - By preferred_chain: Ethereum vs Solana engagement
 *   - By wallet_type: MetaMask vs Phantom retention
 *   - By trading_tier: Standard→Pro upgrade path
 *   - By kyc_status: verified vs pending conversion rates
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                  | Metric                | Baseline | Effect  | Ratio
 * ----------------------|-----------------------|----------|---------|------
 * Whale Wallets         | Avg trade_amount_usd  | $200     | $10,000 | 50x
 * Gas Price Spike       | Avg gas_fee_usd       | $5       | $50     | 10x
 * Token Launch Surge    | Swap count post-D50   | 1x       | 5x      | 5x
 * Airdrop Hunter Churn  | Post-airdrop events   | 100%     | 5%      | 0.05x
 * KYC Completion        | Avg deposit_amount_usd| $500     | $2,000  | 4x
 * Stake-to-Retain       | D60 retention         | 15%      | 70%     | ~5x
 * Pro Tier Fees         | Avg maker_fee_pct     | 0.30     | 0.05    | 6x
 * Rug-Pull Aftermath    | Post-D70 events       | 100%     | 20%     | 0.2x
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
	numDays: num_days,
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
				kyc_verified: [false],
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
				is_whale: [false],
				kyc_verified: [false],
				gas_spike: [false],
				pro_advantage: [false],
				rug_pull_victim: [false],
				moon_trade: [false],
				staked_early: [false],
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
				gas_spike: [false],
			}
		},
	],

	superProps: {
		trading_tier: ["Standard", "Standard", "Standard", "Pro"],
		preferred_chain: ["Ethereum", "Solana", "Base", "Arbitrum", "Polygon"],
		wallet_type: ["MetaMask", "Phantom", "Coinbase Wallet", "Rainbow", "WalletConnect"],
		staked_early: [false],
	},

	userProps: {
		trading_tier: ["Standard", "Standard", "Standard", "Pro"],
		preferred_chain: ["Ethereum", "Solana", "Base", "Arbitrum", "Polygon"],
		wallet_type: ["MetaMask", "Phantom", "Coinbase Wallet", "Rainbow", "WalletConnect"],
		total_trade_volume: u.weighNumRange(0, 500000, 0.3, 5000),
		portfolio_value: u.weighNumRange(0, 200000, 0.3, 3000),
		kyc_status: ["pending"],
		has_staked: [false],
		staked_early: [false],
	},

	groupKeys: [],
	groupProps: {},
	lookupTables: [],

	/**
	 * ARCHITECTED ANALYTICS HOOKS
	 *
	 * This hook function creates 8 deliberate patterns in the data:
	 *
	 * 1. WHALE WALLETS: 2% of users (deterministic) trade 50x volume, is_whale=true
	 * 2. GAS PRICE SPIKE: Days 35-37 gas fees 10x, 40% swaps fail, gas_spike=true
	 * 3. TOKEN LAUNCH SURGE: Day 50+ MOON token, 25% swaps become MOON, 5x volume for MOON traders
	 * 4. AIRDROP HUNTER CHURN: Airdrop claimers with no swaps lose 95% of events post-claim
	 * 5. KYC COMPLETION: Verified users deposit 4x more, swap 8x more, kyc_verified=true
	 * 6. STAKE-TO-RETAIN: Early stakers (first 14 days) get 70% D60 retention vs 15%
	 * 7. PRO TIER FEES: Pro users pay 0.05% fees (vs 0.30%), trade 6x volume, pro_advantage=true
	 * 8. RUG-PULL AFTERMATH: Day 70 SCAM token rugs, holders lose 80% of post-D70 events
	 */
	hook: function (record, type, meta) {
		const NOW = dayjs();
		const DATASET_START = NOW.subtract(num_days, "days");

		// ===============================================================
		// Hook #2 (partial): GAS PRICE SPIKE (event)
		// Days 35-37, network congestion. Gas fees 10x on swap/transfer
		// events and gas_spike=true.
		// ===============================================================
		if (type === "event") {
			const EVENT_TIME = dayjs(record.time);
			const dayInDataset = EVENT_TIME.diff(DATASET_START, "day");

			// Gas price spike: days 35-37
			if (dayInDataset >= 35 && dayInDataset <= 37) {
				if (record.event === "swap") {
					record.gas_fee_usd = Math.round((record.gas_fee_usd || 5) * 10);
					record.gas_spike = true;
				}
				if (record.event === "transfer") {
					record.gas_fee_usd = Math.round((record.gas_fee_usd || 5) * 10);
					record.gas_spike = true;
				}
			}

			// ===============================================================
			// Hook #3 (partial): TOKEN LAUNCH SURGE (event)
			// After day 50, 25% of swap events get token_pair changed to
			// include "MOON". Tagged moon_trade=true.
			// ===============================================================
			if (record.event === "swap" && dayInDataset >= 50) {
				if (chance.bool({ likelihood: 25 })) {
					record.token_pair = chance.pickone(["MOON/USDC", "MOON/ETH", "ETH/MOON"]);
					record.moon_trade = true;
				}
			}
		}

		// ===============================================================
		// EVERYTHING HOOK — all complex behavioral patterns
		// ===============================================================
		if (type === "everything") {
			const userEvents = record;
			const profile = meta.profile;

			// Stamp superProps from profile for consistency
			userEvents.forEach(e => {
				e.trading_tier = profile.trading_tier;
				e.preferred_chain = profile.preferred_chain;
				e.wallet_type = profile.wallet_type;
				e.staked_early = profile.staked_early;
			});

			const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;

			// -----------------------------------------------------------
			// Hook #1: WHALE WALLETS
			// 2% of wallets do massive volume. Deterministic selection via
			// charCodeAt(0) % 50 === 0. Whales get 50x trade_amount_usd
			// on all swap events with is_whale=true.
			// -----------------------------------------------------------
			const userId = userEvents.length > 0 ? (userEvents[0].user_id || userEvents[0].distinct_id || "") : "";
			const isWhale = userId.length > 0 && userId.charCodeAt(0) % 50 === 0;

			if (isWhale) {
				userEvents.forEach(e => {
					if (e.event === "swap") {
						e.trade_amount_usd = Math.round((e.trade_amount_usd || 200) * 50);
						e.is_whale = true;
					}
				});
			}

			// -----------------------------------------------------------
			// Hook #2 (continued): GAS PRICE SPIKE — failed swaps
			// During days 35-37, 40% of swaps get swap_status changed to
			// "failed".
			// -----------------------------------------------------------
			userEvents.forEach(e => {
				if (e.event === "swap" && e.gas_spike === true) {
					if (chance.bool({ likelihood: 40 })) {
						e.swap_status = "failed";
					}
				}
			});

			// -----------------------------------------------------------
			// Hook #3 (continued): TOKEN LAUNCH SURGE — volume boost
			// Users who traded MOON get 5x swap event volume via cloned
			// events spread over days after day 50.
			// -----------------------------------------------------------
			const moonSwaps = userEvents.filter(e => e.event === "swap" && e.moon_trade === true);
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
			// Users who have "claim airdrop" events but zero "swap"
			// events are bots/hunters. Remove 95% of events after the
			// first airdrop claim.
			// -----------------------------------------------------------
			const hasAirdropClaim = userEvents.some(e => e.event === "claim airdrop");
			const hasSwap = userEvents.some(e => e.event === "swap");

			if (hasAirdropClaim && !hasSwap) {
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

			// -----------------------------------------------------------
			// Hook #5: KYC FUNNEL COMPLETION
			// Users with "kyc completed" events get 4x deposit_amount_usd
			// and 8x more swap events (cloned). Flag kyc_verified=true on
			// post-KYC events.
			// -----------------------------------------------------------
			const kycCompleted = userEvents.find(e => e.event === "kyc completed");
			if (kycCompleted) {
				const kycTime = dayjs(kycCompleted.time);

				// Boost deposits and flag post-KYC events
				userEvents.forEach(e => {
					if (dayjs(e.time).isAfter(kycTime)) {
						if (e.event === "deposit") {
							e.deposit_amount_usd = Math.round((e.deposit_amount_usd || 500) * 4);
							e.kyc_verified = true;
						}
						if (e.event === "swap") {
							e.kyc_verified = true;
						}
					}
				});

				// Clone swap events for 8x volume
				const postKycSwaps = userEvents.filter(e => e.event === "swap" && e.kyc_verified === true);
				const clonedKycSwaps = [];
				postKycSwaps.forEach(swapEvt => {
					const swapTime = dayjs(swapEvt.time);
					for (let i = 0; i < 7; i++) {
						clonedKycSwaps.push({
							...swapEvt,
							time: swapTime.add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
							user_id: swapEvt.user_id,
							trade_amount_usd: Math.round((swapEvt.trade_amount_usd || 200) * chance.floating({ min: 0.8, max: 1.5 })),
							kyc_verified: true,
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
			const day14 = DATASET_START.add(14, "days");
			const day60 = DATASET_START.add(60, "days");

			const stakedEarly = userEvents.some(e =>
				e.event === "stake" && dayjs(e.time).isBefore(day14)
			);

			if (stakedEarly) {
				// Mark all events for this user
				userEvents.forEach(e => { e.staked_early = true; });

				// 70% retention: inject late-stage events for stakers
				// (only inject if they don't already have many post-D60 events)
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
								staked_early: true,
							});
						}
					}
					if (portfolioTemplate) {
						for (let i = 0; i < 4; i++) {
							userEvents.push({
								...portfolioTemplate,
								time: day60.add(chance.integer({ min: 1, max: 55 }), "days").toISOString(),
								user_id: portfolioTemplate.user_id,
								staked_early: true,
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

			// -----------------------------------------------------------
			// Hook #7: PRO TIER MAKER FEES
			// Pro users (from profile.trading_tier) pay maker_fee_pct=0.05
			// vs standard 0.30. Pro users also trade 6x volume.
			// pro_advantage=true on Pro swap events.
			// -----------------------------------------------------------
			if (profile.trading_tier === "Pro") {
				userEvents.forEach(e => {
					if (e.event === "swap") {
						e.maker_fee_pct = 0.05;
						e.pro_advantage = true;
					}
				});

				// Clone swap events for 6x volume
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
							pro_advantage: true,
						});
					}
				});
				userEvents.push(...clonedProSwaps);
			} else {
				// Ensure standard fee on non-Pro swap events
				userEvents.forEach(e => {
					if (e.event === "swap") {
						e.maker_fee_pct = 0.30;
					}
				});
			}

			// -----------------------------------------------------------
			// Hook #8: RUG-PULL AFTERMATH
			// Day 70, "SCAM" token rugs. Users who swapped SCAM token
			// before day 70 lose 80% of events after day 70.
			// rug_pull_victim=true on remaining events.
			// -----------------------------------------------------------
			const day70 = DATASET_START.add(70, "days");

			// Check if user traded SCAM before day 70
			// ~10% of pre-day-70 swaps naturally get SCAM token pair
			// (injected here since SCAM isn't in the default TOKEN_PAIRS list)
			let hadScam = false;
			userEvents.forEach(e => {
				if (e.event === "swap") {
					const swapDay = dayjs(e.time).diff(DATASET_START, "day");
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
					if (dayjs(evt.time).isAfter(day70)) {
						if (chance.bool({ likelihood: 80 })) {
							userEvents.splice(i, 1);
						} else {
							evt.rug_pull_victim = true;
						}
					}
				}
			}

			// Sort by time after all mutations
			userEvents.sort((a, b) => new Date(a.time) - new Date(b.time));
		}

		return record;
	}
};

export default config;

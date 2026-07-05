-- ============================================================
-- gaming.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in gaming.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/gaming/gaming.js --data-prefix verify-gaming
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/gaming/gaming.js verify-gaming
-- Run this file:
--   duckdb -c ".read dungeons/vertical/gaming/gaming.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 — resolve device_id → canonical distinct_id via the
-- USERS shards so uniques are identity-correct even for device-only rows
-- (pre-auth steps of the first funnel carry device_id only).
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-gaming-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
-- (buildIdentityMap in lib/verify/identity.js reads the same field)
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;


-- ── H1-compass-heavy-rewards ────────────────────────────────
-- heavy compass users (2+ "use item" w/ Ancient Compass, ~48%) earn ~1.5x
-- reward_gold and reward_xp on quest turned in (measured 1.56x / 1.58x —
-- bonus-quest clones are built at the boosted rate)
WITH cnt AS (
  SELECT u.distinct_id AS uid,
    count(e.uid) FILTER (WHERE e.event = 'use item' AND e.item_type = 'Ancient Compass') AS n
  FROM users u LEFT JOIN ev e ON e.uid = u.distinct_id GROUP BY 1
)
SELECT CASE WHEN c.n >= 2 THEN 'heavy' ELSE 'light' END AS cohort,
  count(DISTINCT c.uid) AS users,
  round(avg(e.reward_gold), 1) AS avg_gold,
  round(avg(e.reward_xp), 1) AS avg_xp
FROM ev e JOIN cnt c ON e.uid = c.uid
WHERE e.event = 'quest turned in'
GROUP BY 1 ORDER BY 1;


-- ── H2-cursed-week ──────────────────────────────────────────
-- injected Curse deaths cluster in days 40-47 of each user's own timeline.
-- Measured on 48d+ lifetime users: per-day density in/out ≈ 36x; raw in/out
-- count ≈ 2.7 (out-of-window span is ~10x longer)
WITH firsts AS (SELECT uid, min(t) AS t0, max(t) AS tN FROM ev GROUP BY 1),
longlife AS (SELECT uid, t0, tN FROM firsts WHERE tN >= t0 + INTERVAL 48 DAY),
curse AS (
  SELECT e.uid, epoch(e.t - l.t0) / 86400.0 AS dol
  FROM ev e JOIN longlife l ON e.uid = l.uid
  WHERE e.event = 'player death' AND e.cause_of_death = 'Curse'
)
SELECT
  count(*) FILTER (WHERE dol BETWEEN 40 AND 47) AS in_window,
  count(*) FILTER (WHERE dol < 40 OR dol > 47) AS out_window,
  (SELECT count(*) FROM longlife) AS longlife_users,
  round((count(*) FILTER (WHERE dol BETWEEN 40 AND 47) / 8.0)
        / nullif(count(*) FILTER (WHERE dol < 40 OR dol > 47)
                 / ((SELECT avg(epoch(tN - t0)) / 86400.0 FROM longlife) - 8), 0), 1) AS density_ratio
FROM curse;


-- ── H3-guild-rescue ─────────────────────────────────────────
-- among users with 3+ week-1 deaths: early guild joiners (first 3 days) are
-- exempt from the spiral → ~2.5x post-week-1 volume vs spiraled peers
-- (knob ceiling 1/0.3 ≈ 3.3x; both cohorts select front-loaded players)
WITH firsts AS (SELECT uid, min(t) AS t0 FROM ev GROUP BY 1),
flags AS (
  SELECT f.uid,
    count(e.uid) FILTER (WHERE e.event = 'player death' AND e.t < f.t0 + INTERVAL 7 DAY) AS early_deaths,
    count(e.uid) FILTER (WHERE e.event = 'guild joined' AND e.t < f.t0 + INTERVAL 3 DAY) AS early_guild,
    count(e.uid) FILTER (WHERE e.t >= f.t0 + INTERVAL 7 DAY) AS post_events
  FROM firsts f JOIN ev e ON e.uid = f.uid GROUP BY 1
)
SELECT CASE WHEN early_guild > 0 THEN 'guild_saved' ELSE 'spiral' END AS cohort,
  count(*) AS users, round(avg(post_events), 1) AS avg_post
FROM flags WHERE early_deaths >= 3 GROUP BY 1 ORDER BY 1;


-- ── H4-death-spiral ─────────────────────────────────────────
-- 3+ week-1 deaths and no early guild → 70% of post-week-1 events dropped.
-- spiral post/pre event ratio ~0.11 vs healthy; spiral cohort ~11% of the
-- guild-free population
WITH firsts AS (SELECT uid, min(t) AS t0 FROM ev GROUP BY 1),
flags AS (
  SELECT f.uid,
    count(e.uid) FILTER (WHERE e.event = 'player death' AND e.t < f.t0 + INTERVAL 7 DAY) AS early_deaths,
    count(e.uid) FILTER (WHERE e.event = 'guild joined' AND e.t < f.t0 + INTERVAL 3 DAY) AS early_guild,
    count(e.uid) FILTER (WHERE e.t >= f.t0 + INTERVAL 7 DAY) AS post_events,
    count(e.uid) FILTER (WHERE e.t < f.t0 + INTERVAL 7 DAY) AS pre_events
  FROM firsts f JOIN ev e ON e.uid = f.uid GROUP BY 1
)
SELECT CASE WHEN early_guild = 0 AND early_deaths >= 3 THEN 'spiral'
            WHEN early_guild > 0 THEN 'guild' ELSE 'other' END AS cohort,
  count(*) AS users,
  round(avg(post_events)::DOUBLE / nullif(avg(pre_events), 0), 3) AS post_pre
FROM flags GROUP BY 1 ORDER BY 1;


-- ── H5-lucky-charm ──────────────────────────────────────────
-- Lucky Charm Pack buyers (~9% of spenders) pay 2.5x on the pack itself and
-- get 35% bonus-purchase clones → avg spend ~3.4x non-buyers. Scoped to
-- NON-whales so H10's 1.8x multiplier doesn't contaminate the ratio.
WITH lucky AS (SELECT DISTINCT uid FROM ev WHERE event = 'real money purchase' AND product = 'Lucky Charm Pack')
SELECT
  round(avg(price_usd) FILTER (WHERE uid IN (SELECT uid FROM lucky)), 2) AS lucky_avg,
  round(avg(price_usd) FILTER (WHERE uid NOT IN (SELECT uid FROM lucky)), 2) AS nonlucky_avg,
  count(DISTINCT uid) FILTER (WHERE uid IN (SELECT uid FROM lucky)) AS lucky_users
FROM ev WHERE event = 'real money purchase' AND price_usd IS NOT NULL
  AND substr(uid, 1, 1) NOT IN ('0','3','6','9','c','f');


-- ── H6-strategic-explorers ──────────────────────────────────
-- strategic explorers (6+ inspect AND 6+ search for clues, ~42% of users):
-- 85% dungeon completion vs ~54% baseline, 2x treasure (measured 1.7x blend)
WITH cnt AS (
  SELECT u.distinct_id AS uid,
    count(e.uid) FILTER (WHERE e.event = 'inspect') AS ins,
    count(e.uid) FILTER (WHERE e.event = 'search for clues') AS sea
  FROM users u LEFT JOIN ev e ON e.uid = u.distinct_id GROUP BY 1
),
coh AS (SELECT uid, (ins >= 6 AND sea >= 6) AS strategic FROM cnt)
SELECT c.strategic, count(DISTINCT c.uid) AS users,
  round(avg(e.treasure_value) FILTER (WHERE e.event = 'find treasure'), 1) AS avg_treasure,
  round((count(*) FILTER (WHERE e.event = 'exit dungeon' AND e.completion_status = 'completed'))::DOUBLE
        / nullif(count(*) FILTER (WHERE e.event = 'exit dungeon'), 0), 3) AS completion
FROM coh c JOIN ev e ON e.uid = c.uid GROUP BY 1 ORDER BY 1;


-- ── H7-shadowmourne ─────────────────────────────────────────
-- Shadowmourne Legendary drops only after dataset day 45 (2% roll on find
-- treasure); zero pre-release sightings; owners win ~96% of combats vs ~55%
WITH owners AS (SELECT DISTINCT uid FROM ev WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'),
combat AS (
  SELECT uid, count(*) FILTER (WHERE outcome = 'Victory')::DOUBLE / count(*) AS win_rate
  FROM ev WHERE event = 'combat completed' GROUP BY 1
)
SELECT
  (SELECT count(*) FROM ev WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'
     AND t < (SELECT min(t) FROM ev) + INTERVAL 45 DAY) AS pre_release_drops,
  (SELECT count(*) FROM owners) AS owners,
  (SELECT round(avg(win_rate), 3) FROM combat WHERE uid IN (SELECT uid FROM owners)) AS owner_win,
  (SELECT round(avg(win_rate), 3) FROM combat WHERE uid NOT IN (SELECT uid FROM owners)) AS rest_win;


-- ── H8-subscriber-tiers ─────────────────────────────────────
-- Elite: 1.8x quest gold, completion flip → ~0.90; Premium: 1.4x gold,
-- completion → ~0.82; Free baseline ~0.68 (completion = f + (1-f)·flip)
SELECT subscription_tier, count(DISTINCT uid) AS users,
  round(avg(reward_gold) FILTER (WHERE event = 'quest turned in'), 1) AS avg_gold,
  round((count(*) FILTER (WHERE event = 'exit dungeon' AND completion_status = 'completed'))::DOUBLE
        / nullif(count(*) FILTER (WHERE event = 'exit dungeon'), 0), 3) AS completion
FROM ev GROUP BY 1 ORDER BY 1;


-- ── H9-level-gold-scaling ───────────────────────────────────
-- reward_gold scales with profile level: mult = 1 + 0.15·(level-1).
-- formula check: hi/lo gold ratio should equal
-- (1 + 0.15·(mean_hi - 1)) / (1 + 0.15·(mean_lo - 1)) — measured 1.95 vs 1.94
WITH bucketed AS (
  SELECT CASE WHEN u.level <= 5 THEN 'lo_1_5' WHEN u.level >= 16 THEN 'hi_16_20' ELSE 'mid' END AS bucket,
    u.level, e.reward_gold
  FROM users u JOIN ev e ON e.uid = u.distinct_id AND e.event = 'quest turned in'
)
SELECT bucket, count(*) AS quests, round(avg(level), 2) AS mean_level,
  round(avg(reward_gold), 1) AS avg_gold,
  round((1 + 0.15 * (avg(level) - 1)), 3) AS predicted_mult
FROM bucketed GROUP BY 1 ORDER BY 1;


-- ── H10-whale-purchases ─────────────────────────────────────
-- whales = distinct_id first hex char in ('0','3','6','9','c','f') → 37.5%
-- of ids nominally, ~63% of spend rows; 1.8x price_usd. Scoped to NON-lucky
-- buyers so H5's multiplier doesn't contaminate the ratio.
WITH lucky AS (SELECT DISTINCT uid FROM ev WHERE event = 'real money purchase' AND product = 'Lucky Charm Pack')
SELECT
  round(avg(price_usd) FILTER (WHERE substr(uid, 1, 1) IN ('0','3','6','9','c','f')), 2) AS whale_avg,
  round(avg(price_usd) FILTER (WHERE substr(uid, 1, 1) NOT IN ('0','3','6','9','c','f')), 2) AS rest_avg,
  count(DISTINCT uid) FILTER (WHERE substr(uid, 1, 1) IN ('0','3','6','9','c','f')) AS whale_users,
  count(DISTINCT uid) FILTER (WHERE substr(uid, 1, 1) NOT IN ('0','3','6','9','c','f')) AS rest_users
FROM ev WHERE event = 'real money purchase' AND price_usd IS NOT NULL
  AND uid NOT IN (SELECT uid FROM lucky);


-- ── H11-alignment-archetype ─────────────────────────────────
-- deterministic profile mapping: Good alignments → hero, Evil → villain,
-- rest → neutral. Counts must match EXACTLY; shares ≈ 26/25/49
SELECT
  count(*) FILTER (WHERE alignment IN ('Lawful Good', 'Neutral Good')) AS good_aligns,
  count(*) FILTER (WHERE archetype = 'hero') AS heroes,
  count(*) FILTER (WHERE alignment IN ('Chaotic Evil', 'Neutral Evil')) AS evil_aligns,
  count(*) FILTER (WHERE archetype = 'villain') AS villains,
  count(*) FILTER (WHERE archetype = 'neutral') AS neutrals,
  count(*) AS total
FROM users;


-- ── H12-combat-ttc-by-tier ──────────────────────────────────
-- funnel-post compresses combat initiated → combat completed → use item by
-- tier (Elite 0.30x, Premium 0.70x, Free 1.40x). The story uses the funnel
-- emulator (median TTC, 6h window); this cross-event MIN→MIN approximation
-- shows the same ordering for eyeball purposes.
WITH ci AS (SELECT uid, min(t) AS t0 FROM ev WHERE event = 'combat initiated' GROUP BY 1),
ui AS (
  SELECT e.uid, min(e.t) AS t1
  FROM ev e JOIN ci ON e.uid = ci.uid AND e.t >= ci.t0
  WHERE e.event = 'use item' GROUP BY 1
)
SELECT u.subscription_tier, count(*) AS converters,
  round(median(epoch(t1 - t0)) / 60, 1) AS median_ttc_min
FROM ci JOIN ui USING (uid) JOIN users u ON u.distinct_id = ci.uid
GROUP BY 1 ORDER BY median_ttc_min;


-- ── H13-prep-magic-number ───────────────────────────────────
-- prep actions (inspect + search for clues) between first quest accepted and
-- first fight boss: sweet band 3-6 → 1.3x treasure (measured 1.24x scoped to
-- non-strategic users); over-prepared 7+ → boss win flipped to ~0.73x sweet
WITH anchors AS (
  SELECT uid,
    min(t) FILTER (WHERE event = 'quest accepted') AS qa,
    min(t) FILTER (WHERE event = 'fight boss') AS fb
  FROM ev GROUP BY 1
),
prep AS (
  SELECT a.uid, count(e.uid) AS n
  FROM anchors a LEFT JOIN ev e ON e.uid = a.uid
    AND e.event IN ('inspect', 'search for clues') AND e.t > a.qa AND e.t < a.fb
  WHERE a.qa IS NOT NULL AND a.fb IS NOT NULL AND a.fb > a.qa
  GROUP BY 1
),
bands AS (SELECT uid, CASE WHEN n BETWEEN 3 AND 6 THEN 'sweet' WHEN n < 3 THEN 'low' ELSE 'over' END AS band FROM prep)
SELECT b.band, count(DISTINCT b.uid) AS users,
  round(avg(e.treasure_value) FILTER (WHERE e.event = 'find treasure'), 1) AS avg_treasure,
  round((count(*) FILTER (WHERE e.event = 'fight boss' AND e.victory = true))::DOUBLE
        / nullif(count(*) FILTER (WHERE e.event = 'fight boss'), 0), 3) AS boss_win
FROM bands b JOIN ev e ON e.uid = b.uid
GROUP BY 1 ORDER BY 1;

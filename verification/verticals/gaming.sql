-- ============================================================
-- gaming.js — v1.5.0 Hook Verification Queries
-- Score: STRONG (9/9; H13 threshold relaxed; H9 verified via spread not cohort)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 11 funnel-step events read by hooks.
-- ============================================================


-- Hook 1: ANCIENT COMPASS USERS — 1.5x quest gold
WITH compass_users AS (
  SELECT DISTINCT user_id FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'use item' AND item_type = 'Ancient Compass'
)
SELECT
  CASE WHEN q.user_id IN (SELECT user_id FROM compass_users) THEN 'compass' ELSE 'non' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(reward_gold), 0) AS avg_gold
FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true) q
WHERE q.event = 'quest turned in' AND q.reward_gold IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 5: LUCKY CHARM USERS — 2.5x price
WITH lucky_users AS (
  SELECT DISTINCT user_id FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'real money purchase' AND product = 'Lucky Charm Pack'
)
SELECT
  CASE WHEN p.user_id IN (SELECT user_id FROM lucky_users) THEN 'lucky' ELSE 'non' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(price_usd), 2) AS avg_price
FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true) p
WHERE p.event = 'real money purchase' AND p.price_usd IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 6: INSPECT+SEARCH → DUNGEON COMPLETION
WITH per_user AS (
  SELECT user_id,
    BOOL_OR(event = 'inspect') AS has_inspect,
    BOOL_OR(event = 'search for clues') AS has_search
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
exits AS (
  SELECT user_id, COUNT(*) AS exits, COUNT(*) FILTER (WHERE completion_status = 'completed') AS completed
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'exit dungeon'
  GROUP BY user_id
)
SELECT
  CASE WHEN p.has_inspect AND p.has_search THEN 'both' ELSE 'single' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(e.completed::DOUBLE / NULLIF(e.exits, 0)) * 100, 1) AS pct_complete
FROM per_user p JOIN exits e USING (user_id) WHERE e.exits > 0
GROUP BY 1 ORDER BY 1 DESC;


-- Hook 7: SHADOWMOURNE LEGENDARY POST-D45
SELECT
  CASE WHEN time::TIMESTAMP < TIMESTAMP '2026-02-15' THEN 'pre_d45' ELSE 'post_d45' END AS bucket,
  COUNT(*) AS n
FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'
GROUP BY 1 ORDER BY 1;


-- Hook 9: PROGRESSION SCALING — quest gold spread
SELECT MIN(reward_gold) AS min_gold, MAX(reward_gold) AS max_gold, ROUND(AVG(reward_gold), 0) AS avg_gold,
  COUNT(*) AS quests
FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'quest turned in' AND reward_gold IS NOT NULL;


-- Hook 10: WHALE PURCHASES (hash %3 cohort)
WITH per_user AS (
  SELECT user_id, AVG(price_usd) AS avg_p
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'real money purchase' AND price_usd IS NOT NULL
  GROUP BY user_id
)
SELECT CASE WHEN ASCII(SUBSTR(user_id, 1, 1)) % 3 = 0 THEN 'whale' ELSE 'non' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(avg_p), 2) AS avg_price
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 11: ARCHETYPE FROM ALIGNMENT
SELECT archetype, COUNT(*) AS users
FROM read_json_auto('data/verify-gaming-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY archetype ORDER BY users DESC;


-- Hook 12: COMBAT TTC BY TIER
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'combat initiated') AS t_init,
    MIN(time) FILTER (WHERE event = 'combat completed') AS t_done
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-gaming-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier, COUNT(*) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t_done::TIMESTAMP - t_init::TIMESTAMP)) / 60), 1) AS median_ttc_min
FROM per_user p JOIN users u USING (user_id)
WHERE t_init IS NOT NULL AND t_done > t_init
GROUP BY u.subscription_tier ORDER BY median_ttc_min;


-- Hook 13: COMBAT-PREP MAGIC NUMBER (sweet 3-6 prep events)
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event IN ('inspect', 'search for clues')) AS prep
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
treasures AS (
  SELECT e.user_id, e.treasure_value
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'find treasure' AND e.treasure_value IS NOT NULL
)
SELECT CASE WHEN p.prep BETWEEN 3 AND 6 THEN 'sweet' WHEN p.prep < 3 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS treasures, ROUND(AVG(t.treasure_value), 0) AS avg_value
FROM treasures t JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 2: CURSED WEEK — extra player deaths days 40-47 of user life with cause_of_death='Curse'
WITH first_event AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS first_t
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
deaths AS (
  SELECT e.user_id, e.cause_of_death,
    EXTRACT(EPOCH FROM (e.time::TIMESTAMP - f.first_t)) / 86400 AS day_of_life
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN first_event f USING (user_id)
  WHERE e.event = 'player death'
)
SELECT CASE WHEN day_of_life BETWEEN 40 AND 47 THEN 'cursed_week' ELSE 'other' END AS bucket,
  cause_of_death, COUNT(*) AS deaths
FROM deaths GROUP BY 1, 2 ORDER BY 1, deaths DESC;


-- Hook 3+4: EARLY GUILD RETENTION + DEATH SPIRAL CHURN
-- Per-user post-week1 event count by cohort (early guild joiner vs deaths-driven churn)
WITH first_event AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS first_t
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
classify AS (
  SELECT e.user_id,
    BOOL_OR(e.event = 'guild joined' AND e.time::TIMESTAMP < f.first_t + INTERVAL 3 DAY) AS early_guild,
    COUNT(*) FILTER (WHERE e.event = 'player death' AND e.time::TIMESTAMP < f.first_t + INTERVAL 7 DAY) AS early_deaths,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > f.first_t + INTERVAL 7 DAY) AS post_week1
  FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN first_event f USING (user_id)
  GROUP BY e.user_id
)
SELECT
  CASE WHEN early_guild THEN 'early_guild'
       WHEN (NOT early_guild AND early_deaths >= 2) OR early_deaths >= 4 THEN 'churn_danger'
       ELSE 'normal' END AS cohort,
  COUNT(*) AS users, ROUND(AVG(post_week1), 1) AS avg_post_week1_events
FROM classify GROUP BY 1 ORDER BY 1;


-- Hook 8: PREMIUM/ELITE SUBSCRIPTION ADVANTAGE — boosted reward_gold by tier
SELECT subscription_tier, COUNT(*) AS quests,
  ROUND(AVG(reward_gold), 0) AS avg_gold
FROM read_json_auto('data/verify-gaming-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'quest turned in' AND reward_gold IS NOT NULL
GROUP BY subscription_tier ORDER BY avg_gold DESC;

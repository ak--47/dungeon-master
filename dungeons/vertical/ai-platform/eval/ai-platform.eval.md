# Cortexa (ai-platform) — 20-question eval

- **Data:** `data/verify-ai-platform` (full fidelity: 10,000 accounts, 9,991 with events, 4,981 new accounts, 819,187 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/ai-platform/ai-platform.sql` on that data.
- **Stories:** ids refer to the `stories` export in `ai-platform.js` (H1-H10).
- **Sampling:** one `api request` event stands for 1,000 API requests. Shares and averages need no scaling; request counts are × 1,000.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does prompt caching make the API faster, and is it used?
- **Prompt:** "We shipped prompt caching in July. Are customers using it, and does it actually make requests faster?"
- **Type:** trend
- **Answer:** Yes, it is used, and it makes responses start faster, but it barely changes total request time. On successful requests since 2026-07-08, cache hits reach the first token in **438 ms on average vs 832 ms for misses (0.53x; median 349 vs 593 ms)**; on plain requests without tools, where prompt sizes match (about 4,610-4,630 input tokens in both groups), **387 vs 687 ms (0.56x)**. Total latency moves much less (5,389 vs 5,716 ms, about −6%), because most of a request's time is generating the answer, and caching does not speed that up. Adoption ramped for about three weeks and then leveled off: weekly cache-hit share of requests was 2.7% (week of Jul 6), 13.5% (Jul 13), 26.8% (Jul 20), 35.9% (Jul 27), then 34.9%-37.4% every week through September. Since Jul 29, **35.7% of requests** are cache hits, and 3,542 of the 7,148 accounts that sent requests (49.6%) had at least one hit. Accept a time-to-first-token ratio of 0.45-0.62, a small total-latency gain, and a plateau of 32%-38% after a ramp.
- **Evidence:** H1-prompt-caching-launch; Insights, `api request`, average `time_to_first_token_ms` and `latency_ms`, breakdown `cache_hit`, filter `status_code = 200` (and `tool_use = false` for matched prompts), after Jul 8; weekly share of `cache_hit = true`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date), 03-event-dictionary.md (`cache_hit`, `time_to_first_token_ms`, `latency_ms`), 04-metrics-and-tables.md (latency definition).
- **Grading:** must compare hits with misses on successful requests, separate time to first token from total latency, and describe the ramp and plateau. Wrong: "caching halves request latency" (only the time to first token falls that much); comparing latency before vs after July 8 for all traffic (atlas-3 and the swift-2 shift move it too); including failed requests (they return early); "adoption keeps growing".

### Q2 — What do caching discounts cost in billed usage?
- **Prompt:** "Cached tokens are billed at a discount. How much usage value did caching discounts take off the bill since launch?"
- **Type:** external-join
- **Answer:** From `model_billing_daily` (cached input billed at 10% of the input price, so the discount is 90% of cached input at list): **about $1.20M since 2026-07-08** ($225k in July, $505k in August, $452k in September, $18k on Oct 1). In August and September the discount is **14.4% and 14.3% of what usage would have been worth without caching** (6.4% in July, the ramp month). Cached input was 251.3B tokens in August and 247.6B in September. Accept ±3% on the dollar figures and 12%-16% for the share.
- **Evidence:** H1-prompt-caching-launch; warehouse `model_billing_daily` (`cached_input_tokens_billed` × `list_price_input_per_mtok` × 0.9); `-- EVAL Q2`.
- **Context needed:** 01-business.md (cached input price), 04-metrics-and-tables.md (billing table).
- **Grading:** must use the warehouse and the 10% rule. Wrong: using Mixpanel token counts without the × 1,000 sampling factor; treating the full list value of cached tokens as the discount (it is 90%).

### Q3 — How fast are customers adopting atlas-3?
- **Prompt:** "How quickly are customers moving to atlas-3 since launch? Is it still growing?"
- **Type:** trend
- **Answer:** Paid accounts adopted it over about three weeks and then plateaued. atlas-3 share of paid-plan flagship requests (atlas-2 + atlas-3): 4.7% in the launch week (Jul 27), 17.2%, 29.7%, 39.3% (week of Aug 17), then 38.3%-39.5% every week through September; **39.0% since Aug 18**. Free accounts got access on Sep 8: 5.2% that week, then 17.6%, 21.7%, 22.7% (**21.7% since Sep 18**). In September atlas-3 served 23.1% of all requests and was used by 2,636 accounts. It is not still growing on paid plans. Accept a paid plateau of 36%-43% and a Free share of 19%-26%.
- **Evidence:** H2-atlas-3-launch; Insights, `api request`, total, breakdown `model`, filter `model` in (atlas-2, atlas-3) and `plan_tier`, weekly, % of total; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch dates, Free access on Sep 8), 03-event-dictionary.md (`plan_tier` at event time).
- **Grading:** must measure share over time, separate paid from Free, and note the plateau. Wrong: share of all requests including swift-2 reported as the adoption rate without saying so; "Free users adopted in August" (they had no access); "still climbing".

### Q4 — Is atlas-3 slower than atlas-2?
- **Prompt:** "Customers say atlas-3 feels slower. Is it, and why?"
- **Type:** segmentation
- **Answer:** Yes, requests take about **1.26x as long** (successful paid requests since launch), but not because the model generates slower: atlas-3 answers are **1.30x longer** (890 vs 687 output tokens on cache misses). Per output token it generates at the same speed (8.3 ms per output token for both, after the time to first token), and its time to first token is the same (833 vs 833 ms on misses). Within the same cache state: misses 8,247 vs 6,555 ms, hits 7,893 vs 6,203 ms. Overall paid latency moved little over the summer: weekly median latency of successful paid requests was about 4.1-4.2 s in June and about 3.9-4.0 s in September; caching and the Build move to swift-2 slightly outweigh atlas-3's longer answers. Accept a latency ratio of 1.2-1.35 and output length as the cause.
- **Evidence:** H2-atlas-3-launch (output-length effect); Insights, `api request`, average `latency_ms`, `time_to_first_token_ms`, and `output_tokens`, breakdown `model` and `cache_hit`, filter paid plans and `status_code = 200`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`latency_ms` includes generating the whole answer; `time_to_first_token_ms`), 02-timeline.md.
- **Grading:** must compare like with like (same cache state or controlling for it) and connect latency to output length. Wrong: "atlas-3 is a slower model per token"; comparing atlas-3 after launch with atlas-2 before launch (caching started in between); "latency got much worse overall".

### Q5 — Should we ship the Interactive Quickstart?
- **Prompt:** "What did the Interactive Quickstart test show? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-01, **65.8% of Interactive Quickstart signups made their first API request within 7 days vs 47.6% for Control** (1,892 vs 1,976 signups; **1.38x**, z ≈ 11.6), and the median time from signup to first request was **2.0 h vs 4.0 h (0.50x)**. Before the test, 49.2% of signups made a first request (1,113 signups). The split is even (48.9% of exposed accounts in the variant). Accept 1.15x-1.45x for conversion and 0.40-0.60 for time.
- **Evidence:** H3-interactive-quickstart-experiment; Funnels, `account created` → `api key created` → `api request`, 7-day window, breakdown user property `Experiment: Interactive Quickstart`; `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (test start, arms), 04-metrics-and-tables.md (activation definition).
- **Grading:** must report conversion and speed by arm with a window. Wrong: comparing signups before vs after July 1 for everyone; counting any later `api request` beyond 7 days.

### Q6 — Do Java and Go developers struggle with onboarding? (null)
- **Prompt:** "Our Java and Go SDKs are newer. Do developers on those SDKs get to a first API request less often than Python and TypeScript developers?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day first-request rate is **54.6% for Java + Go** (778 signups) vs **54.9% for Python, TypeScript, and REST** (4,203); z ≈ −0.1. By SDK: Go 55.1%, Java 54.2%, Python 55.1%, REST 56.2%, TypeScript 54.2%. The gap stays small inside each test arm (Control 45.3% vs 48.0%, z ≈ −0.9; Interactive Quickstart 65.6% vs 65.8%, z ≈ 0.0; not enrolled 52.4% vs 48.5%, z ≈ 1.0). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q6`; Funnels onboarding steps, 7-day window, breakdown user property `sdk_language`.
- **Context needed:** 03-event-dictionary.md (`sdk_language`), 04-metrics-and-tables.md.
- **Grading:** must check the data and call the gap noise. Wrong: "yes, Java + Go onboard worse" from the Control-arm gap (45.3% vs 48.0% on 296 Java + Go signups, z ≈ −0.9; the other arms show nothing or point the other way).

### Q7 — How long do batch jobs take?
- **Prompt:** "How long do Batch API jobs take to finish, and does it vary by plan?"
- **Type:** funnel
- **Answer:** Median submit → complete per job: **Scale 1.65 h, Enterprise 1.55 h, Build 3.91 h, Free 6.41 h**. Scale + Enterprise together (1.62 h) run at about **0.41x** the Build time and Free at about **1.64x**. 90th percentiles: Scale 3.5 h, Enterprise 3.6 h, Build 8.2 h, Free 12.6 h. Very few jobs expire (Free 0.7%, none on the other plans). Accept Scale/Enterprise 0.35x-0.45x and Free 1.4x-1.8x of Build.
- **Evidence:** H4-batch-turnaround-by-plan; Funnels, `batch job submitted` → `batch job completed`, hold `batch_id` constant, median time to convert, breakdown `plan_tier`; `-- EVAL Q7`.
- **Context needed:** 03-event-dictionary.md (`batch_id`, `batch_status`), 01-business.md (plans).
- **Grading:** must pair each job's two events (same `batch_id`) and break down by plan. Wrong: a unique-user funnel that pairs a submission with an unrelated later completion; using the current profile plan instead of the plan on the event (close but not exact).

### Q8 — What early behavior predicts new-account retention?
- **Prompt:** "Is there something new accounts do in their first couple of weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Running evaluations in the first 14 days, with 2+ runs as the practical bar.** Among new accounts that made an API request (signups through Aug 25), day-30 retention (active in days 30-36, excluding the platform-sent completion events) is **69.0% with 2+ early eval runs vs 32.6% with 0-1 (2.1x)**; by count: 0 runs 28.1% (1,191 accounts), 1 run 47.9% (351), 2 runs 66.5% (176), 3+ 72.6% (124). Retention climbs from 0 to 1 to 2 runs; the step from exactly 2 to 3+ (6.1 points, z ≈ 1.1) is not significant. Only 16.3% of new API accounts reach 2+ early eval runs. Separately, accounts that never made a request retain at 5.6% at day 30 (1,575 accounts) vs 38.6% for those that did (1,842). Accept 2+ vs 0 of 1.9x-2.7x, a rise from 0 to 1 to 2 runs, and mention of first-request activation as a second factor.
- **Evidence:** H5-early-evals-retention; Funnels `account created` → `eval run started` → `eval run started` (14-day window) saved as cohorts; Retention `account created` → a custom event of every event except `batch job completed` and `eval run completed` (plain "any event" gives the same numbers on this data), custom bracket day 30-36, filter "did api request"; `-- EVAL Q8`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (active account, retention definition).
- **Grading:** must define the behavior from the first 14 days only and measure retention after that window. Wrong: eval runs over the whole window (leaks the outcome); a day-7 retention read with the same 14-day eval window (eval runs in days 7-13 count as both predictor and activity); counting `eval run completed` or `batch job completed` as activity; "a hard cliff at exactly 2"; a "sweet spot at exactly 2 runs" (3+ retains at least as well); "every extra run keeps adding retention" as a firm finding (the step past 2 is within noise on 124 and 176 accounts). Note for graders: a small part of the gap is engagement (accounts that never evaluate also send fewer events later), so "evals predict retention" is correct and "evals alone cause the whole gap" overstates it.

### Q9 — What happened on August 26-27?
- **Prompt:** "We saw a burst of API errors in late August. What happened, and how many requests failed?"
- **Type:** external-join
- **Answer:** The **2026-08-26 to 2026-08-27 GPU capacity incident in us-east**. `inference_fleet_daily` shows `region_status = major_outage` for us-east only, `error_rate_5xx` of 0.377 and 0.323 (0.350 on average, vs about 0.013 normally), GPUs online 1,535 and 1,440 vs about 2,367 (35%-39% fewer), utilization 0.97-0.98, and p95 latency of 30,155 and 31,452 ms vs about 14,800 ms on normal days (range 12,666-16,958 ms). In Mixpanel, us-east request success fell to **63.7%** on those days from 97.6% on the surrounding days (Aug 19-25 and Aug 28-Sep 3), while the other regions stayed at 97.6% (97.5% around); relative to the other regions us-east ran at **0.65x** its normal success rate. Failures were 529 `overloaded_error` (1,712 sampled events). About **1,670 sampled requests above normal failed, about 1.7 million real requests**. Requests that did succeed in us-east were about twice as slow (11,205 vs 5,686 ms on average the week before; the event-side p95 of successful requests agrees with the fleet table, about 31,100 ms in the incident vs 14,800 ms otherwise). Accept a relative success rate of 0.58-0.75 and 1.3-1.9 million failed requests.
- **Evidence:** H6-us-east-capacity-incident; Insights `api request`, share `status_code = 200`, daily, breakdown `inference_region`; warehouse join on date and `inference_region`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`inference_fleet_daily`), 00-manifest.md (sampling).
- **Grading:** must name the region, dates, error type, and a size, and scale sampled counts by 1,000. Wrong: "all regions failed"; reporting 1,712 failed requests (forgets sampling); blaming rate limits (429s are a separate event and did not change).

### Q10 — Did the outage cost us paying customers? (null)
- **Prompt:** "After the August outage, did paying us-east customers (Build, Scale, Enterprise) leave or cut back their usage? Take paying accounts that sent API traffic in the three weeks before it (Aug 5-25) and check the three weeks after (Aug 28-Sep 17)."
- **Type:** null-hypothesis
- **Answer:** **No.** Of paying accounts (plan at their last request before the incident) with API traffic in Aug 5-25, **92.1% of us-east accounts were still sending traffic in Aug 28-Sep 17 vs 91.8% in the other regions** (1,472 vs 1,994 accounts; z ≈ 0.2). The same comparison a month earlier (traffic Jul 8-28, still sending Jul 31-Aug 20) was 92.7% vs 92.1%, so the change in the gap is **−0.3 points (z ≈ −0.2, p ≈ 0.8)**. Request volume after / before was 1.02 for us-east and 0.95 elsewhere. No plan shows a significant change. Raw after-incident gaps: Build −0.3 points (z ≈ −0.3), Scale +2.8 (z ≈ 1.9, us-east higher), Enterprise −0.9 (z ≈ −0.4, 195 accounts). Changes in the gap vs a month earlier: Build +1.0 (z ≈ 0.6), Scale −1.5 (z ≈ −0.7), Enterprise −4.8 (z ≈ −1.5). The incident cost two days of failed requests, not customers. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q10` (rows with window_days = 21; rows with 14 show the two-week version); Insights `api request`, unique accounts and totals by `inference_region`, filter `plan_tier` in (build, scale, enterprise), Aug 5-25 vs Aug 28-Sep 17, with the same comparison a month earlier (or Retention from a cohort of paying accounts active before the incident).
- **Context needed:** 02-timeline.md (incident dates), 00-manifest.md (`api request` is sampled, so low-volume accounts can go a week or two without an event).
- **Grading:** must compare with a control group (other regions) over the windows in the prompt. Wrong: "us-east lost paying accounts" from raw before/after counts without a control (every region loses some accounts over three weeks); "the outage made us-east customers more loyal" (the Scale gap in favor of us-east was there a month earlier too: 96.4% vs 92.1%). Also accept "worth watching for Enterprise" or "a possible small Enterprise effect, not significant at three weeks" (change in gap −4.8 points, z ≈ −1.5, on 195 us-east accounts); do not accept "us-east Enterprise accounts left". An analyst who uses two-week windows (Aug 12-25 vs Aug 28-Sep 10) still gets an overall null (87.2% vs 86.7%, z ≈ 0.4; change in gap −2.2 points, z ≈ −1.3); the Scale raw gap there reaches z ≈ 2.0 in favor of us-east, but it was already 90.3% vs 85.1% a month earlier, so it is a standing regional difference, not an outage effect.

### Q11 — Who reacted to the swift-2 price cut?
- **Prompt:** "We halved the swift-2 price on August 18. Did customers move traffic to swift-2?"
- **Type:** trend
- **Answer:** **Build accounts did; no one else did.** swift-2 share of requests on the Build plan rose from **30.0% (Jun 4-Aug 17) to 48.2% in September (1.61x)**; weekly: 30.4% (week of Aug 3), 30.4%, 34.0% (week of Aug 17), 46.4%, 47.9%, then 47.5%-49.2%. Free (30.0% → 29.8%), Scale (30.4% → 30.7%), and Enterprise (29.9% → 29.4%) did not change. Build accounts pay list price; Free accounts pay nothing and Scale and Enterprise buy on contract. Accept 1.45x-1.80x for Build and "no change" for the other plans.
- **Evidence:** H7-swift-price-cut; Insights, `api request`, breakdown `model`, filter `plan_tier`, weekly, % of total; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (price cut), 01-business.md (how each plan is billed).
- **Grading:** must break down by plan at request time and show the Build-only shift. Wrong: a blended all-plan swift share (1.26x, hides who moved); comparing September with July only for Build without a control.

### Q12 — Why did revenue per day fall after July?
- **Prompt:** "Revenue per day is down since July even though traffic looks flat. What happened?"
- **Type:** external-join
- **Answer:** Revenue per day (`model_billing_daily`) was $104.6k in June, **$100.6k in July, $91.8k in August, $85.0k in September (−15.6% July to September)**, while billed requests per day rose from 5.12M to 5.32M (+4.0%). It is price and discount, not volume:
  1. **Prompt caching discounts** grew from $7.3k per day in July (ramp month) to $15.1k per day in September (14.3% of undiscounted usage).
  2. **The swift-2 price cut**: swift-2 revenue per day fell from $10.3k to $6.2k even though swift-2 requests per day rose 31% (1.54M → 2.01M); at the old price September swift-2 would have billed $12.4k per day.
  3. **Build traffic moved from the flagship models to swift-2** after the cut: flagship (atlas-2 + atlas-3) requests per day fell 7.5% (3.58M → 3.31M) and flagship revenue per day fell from $90.4k to $78.8k (which also carries most of the caching discount).
  atlas-3 works slightly the other way (longer answers at the same price). A minor factor: free credit rose from 4.8% of usage value in July to 6.0% in September as the Free base grew. Accept a −12% to −18% decline and naming caching discounts and the swift-2 cut (with the Build move to swift-2) as the drivers.
- **Evidence:** H1 + H7 (+ H2); warehouse `model_billing_daily` by month and model; Mixpanel model mix by plan; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (caching launch, price cut), 01-business.md (prices, caching price), 04-metrics-and-tables.md (revenue definition, partial June).
- **Grading:** must use per-day values (June has 27 days, October 1 day) and decompose into at least two drivers with numbers. Wrong: "traffic fell" (it rose); blaming the August incident (two days); blaming free usage; comparing monthly totals without adjusting for days.

### Q13 — Which customers send the biggest prompts, and why?
- **Prompt:** "Which customers consume the most input tokens per request, and what's driving it?"
- **Type:** segmentation
- **Answer:** **Tool use.** Requests with tools average **11,448 input tokens vs 4,606 without (2.49x)**, because tool definitions and tool results ride in the prompt. Agent builders use tools on 59.8% of requests (coding 29.9%, other use cases 3.8%-6.0%), so agents accounts average 8,684 input tokens per request and coding 6,642, vs about 4,850-5,020 for the rest. Agents accounts send 17.7% of successful requests but 25.7% of input tokens. Inside the tool and no-tool groups, agents and other accounts look the same (11,417 vs 11,482 and 4,616 vs 4,605), so the driver is tool use itself, not the account type. Accept a tool/no-tool ratio of 2.3-2.7.
- **Evidence:** H8-agent-tool-use; Insights, `api request`, average `input_tokens`, breakdown `tool_use` and user property `use_case`; `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`tool_use`, `input_tokens`), 01-business.md (use cases).
- **Grading:** must identify tool use as the mechanism, not only "agents". Wrong: "enterprise customers send bigger prompts" (company size is not the driver); totals instead of per-request averages.

### Q14 — What does a signup cost by paid channel?
- **Prompt:** "What are we paying per new account on each paid developer-marketing channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **hackathons $139.46** (742 signups, $103,483), **search ads $85.96** (955, $82,090), **newsletter sponsorships $55.36** (776, $42,961). Hackathons cost about **1.62x** search ads per signup and take 45.3% of the $228,534 paid budget. Spend runs every day on paced budgets (hackathons $568-$1,077 per day). Platforms claim 2,949 signups vs 2,473 recorded in Mixpanel (+19%), which would understate CAC. Accept hackathons/search of 1.5-1.8 and dollar values within ±3%.
- **Evidence:** H9-developer-marketing-economics; warehouse `developer_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, marketing table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting a single day's ratio.

### Q15 — Are hackathons worth it?
- **Prompt:** "Developer marketing wants more hackathon sponsorships. Are they worth it compared with search ads and newsletters?"
- **Type:** attribution
- **Answer:** **No, they are the most expensive way to get a paying account.** With the Mixpanel default 30-day conversion window, for signups Jun 4-Aug 31: **8.5% of hackathon signups upgraded to a paid plan vs 22.0% for search ads** (46 of 543 vs 153 of 697; 0.39x, z ≈ −6.8); newsletters 16.4%, referral 18.6%, github 18.4%, organic 15.3%. Combined with the higher cost per signup, **spend per paying account is $1,655 for hackathons vs $394 for search ads and $341 for newsletters** (Jun 4-Aug 31 spend divided by that period's paying signups): about 4x search and 5x newsletters. Accept a conversion ratio of 0.25-0.50 and a cost per paying account of 3x-7x search (the hackathon buyer count is small).
- **Evidence:** H9-developer-marketing-economics; Funnels `account created` → `plan upgraded`, 30-day window (Mixpanel default), date range Jun 4-Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q15`.
- **Context needed:** 01-business.md (channels, goal 5), 04-metrics-and-tables.md (paid conversion, cost per paying account).
- **Grading:** must combine conversion and cost with a stated window. Wrong: judging on signups or CAC alone; including September signups without their full 30 days.

### Q16 — Did raising Build rate limits work?
- **Prompt:** "We raised Build-tier rate limits on September 1. Did Build customers get throttled less?"
- **Type:** trend
- **Answer:** Yes. Build rate-limit episodes per 1,000 sampled requests (= per million requests) were **27.6 in June, 26.6 in July, 27.1 in August, and 10.6 in September (27.1 over Jun 4-Aug 31, so −61%)**. Free accounts, whose limits did not change, stayed flat (245.0, 243.7, 250.0, then 252.4 in September; 246.5 before), so the drop is not a general trend: relative to Free, Build ran at **0.38x** its earlier rate. Scale (3.6-4.2) was already low and did not change. Enterprise counts are small and noisy (1.3-1.7 per 1,000, 46-69 episodes a month; 1.5 before vs 1.4 in September). Free accounts remain by far the most throttled. Accept a Build drop of 55%-67% with Free flat (Free moves within ±3% month to month).
- **Evidence:** H10-build-rate-limit-raise; Insights, `rate limit hit` and `api request`, monthly, formula A/B, breakdown `plan_tier`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (limit change), 04-metrics-and-tables.md (rate-limit rate), 00-manifest.md (sampling).
- **Grading:** must normalize by request volume and use the plan at event time. The graded core is Build vs Free. For Enterprise, accept either "no change" or "small counts, too noisy to call"; do not penalize a reported month-to-month wobble. Wrong: raw episode counts without a denominator; using the current profile plan (accounts that upgraded mid-window move between groups).

### Q17 — Monthly usage, free credits, and revenue
- **Prompt:** "Give me metered usage, free credits, and revenue by month for the summer."
- **Type:** context
- **Answer:** From `model_billing_daily` (list price): **June (27 days) usage value $2.95M, free credit $130k, revenue $2.82M ($104.6k per day); July $3.28M / $158k / $3.12M ($100.6k per day); August $3.00M / $158k / $2.85M ($91.8k per day); September $2.71M / $163k / $2.55M ($85.0k per day)**; October 1 $101k revenue. Billed requests: 134.1M, 158.8M, 162.6M, 159.7M. Over the whole window revenue was $11.44M: atlas-2 $8.52M (74.5%), atlas-3 $1.88M (16.4%), swift-2 $1.04M (9.1%). Accept within ±1%.
- **Evidence:** warehouse `model_billing_daily`; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (revenue = usage value − free credit; list price; Batch API excluded), 01-business.md.
- **Grading:** must use the warehouse and note the partial June and the one-day October. Wrong: estimating revenue from Mixpanel token counts without the × 1,000 sampling factor; counting free credit as revenue; expecting `requests_billed` to equal 1,000 × Mixpanel requests exactly (billing posts some usage the next day and excludes failed requests).

### Q18 — Free to Build upgrades
- **Prompt:** "How many Free accounts upgrade to Build, and how quickly after signup?"
- **Type:** funnel
- **Answer:** **897 upgrades** in the window, 797 of them by accounts created in the window. Weekly upgrades ran at about 38-70 in full weeks (27 in the partial first week, 23 in the partial last week). New accounts upgrade fast: **median 2.6 days after signup, 85% within 7 days**. With a 30-day window, 16.6% of all signups from Jun 4-Aug 31 upgraded, and 30.5% of those that made their first API request within 7 days. Accept ±5% on counts and rates.
- **Evidence:** Funnels `account created` → `plan upgraded`, 30-day window; Insights `plan upgraded` weekly; `-- EVAL Q18`.
- **Context needed:** 01-business.md (how upgrades work), 04-metrics-and-tables.md (paid conversion).
- **Grading:** must report the time to upgrade and a conversion rate with its window. Wrong: counting `billing page viewed` as an upgrade; including Scale and Enterprise (they do not upgrade self-serve).

### Q19 — Is atlas-3 traffic worth more per request?
- **Prompt:** "atlas-3 has the same list price as atlas-2. Does moving customers to atlas-3 change what we bill per request?"
- **Type:** external-join
- **Answer:** Yes, it raises it. In September, atlas-3 billed **$27.23 of usage per 1,000 requests vs $24.21 for atlas-2 (+12%)**, because its answers are longer: 899 vs 689 output tokens per request (1.30x) with the same input size (5,999 vs 6,027 tokens), and output tokens cost 5x input. swift-2 bills $3.23 per 1,000 requests. Accept +8% to +18%.
- **Evidence:** H2-atlas-3-launch; warehouse `model_billing_daily` (`usage_value_usd` / `requests_billed` by model), Mixpanel average `output_tokens` by `model`; `-- EVAL Q19`.
- **Context needed:** 01-business.md (prices), 04-metrics-and-tables.md (billing table).
- **Grading:** must connect billed value to output length. Wrong: "same price, so same revenue per request"; comparing revenue totals without normalizing by requests.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Revenue per day is falling while traffic grows**: $100.6k per day in July vs $85.0k in September (−15.6%) with requests +4.0%. Caching discounts (about $15k per day) and the swift-2 cut with Build traffic moving to swift-2 explain it. Plan pricing and forecasts around discounts and model mix.
  2. **Activation**: only 54.8% of signups make a first API request within 7 days. The Interactive Quickstart lifts that to 65.8% (vs 47.6%) and halves time to first request. Ship it.
  3. **New-account retention**: just 16.3% of new API accounts run 2+ evaluations in their first 14 days, and they retain at 69% vs 33% at day 30; accounts that never make a request retain at 6%. Push evaluations into onboarding.
  4. **Hackathon spend**: hackathons take 45% of the paid budget but cost $1,655 per paying account vs $394 for search ads and $341 for newsletters.
  5. **Reliability**: the us-east incident failed about 1.7M requests (success 64% for two days); paying customers did not leave, but a repeat in the largest region would hurt.
  6. **Free-tier throttling**: Free accounts hit about 252 rate-limit episodes per million requests in September, 24x Build after the September raise; it may cap Free-to-paid conversion.
  7. **atlas-3 adoption has plateaued** at about 39% of paid flagship traffic and 22% on Free.
  Positive signals: caching cuts time to first token about in half on hits and is used by half of active accounts (total latency gains are small); the Build limit raise cut throttling 61%; atlas-3 bills 12% more per request than atlas-2.
- **Evidence:** H1-H10; `-- EVAL Q20` (headline numbers) plus Q1-Q19.
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.

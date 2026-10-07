# Cortexa (ai-platform) — 20-question eval

- **Data:** `data/verify-ai-platform` (full fidelity: 10,000 accounts, 9,995 with events, 4,978 new accounts, 862,429 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/ai-platform/ai-platform.sql` on that data.
- **Stories:** ids refer to the `stories` export in `ai-platform.js` (H1-H10).
- **Sampling:** one `api request` event stands for 1,000 API requests. Shares and averages need no scaling; request counts are × 1,000.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does prompt caching make the API faster, and is it used?
- **Prompt:** "We shipped prompt caching in July. Are customers using it, and does it actually make requests faster?"
- **Type:** trend
- **Answer:** Yes, it is used, and it makes responses start faster, but it barely changes total request time. On successful requests since 2026-07-08, cache hits reach the first token in **439 ms on average vs 827 ms for misses (0.53x; median 349 vs 591 ms)**; on plain requests without tools, where prompt sizes match (about 4,570-4,600 input tokens in both groups), **384 vs 686 ms (0.56x)**. Total latency moves much less (5,374 vs 5,742 ms, about −6%), because most of a request's time is generating the answer, and caching does not speed that up. Adoption ramped for about three weeks and then leveled off: weekly cache-hit share of requests was 3.0% (week of Jul 6), 13.8% (Jul 13), 25.1% (Jul 20), 34.6% (Jul 27), then 33.6%-35.7% every week through September. Since Jul 29, **34.7% of requests** are cache hits, and 3,589 of the 7,199 accounts that sent requests (49.9%) had at least one hit. Accept a time-to-first-token ratio of 0.45-0.62, a small total-latency gain, and a plateau of 32%-38% after a ramp.
- **Evidence:** H1-prompt-caching-launch; Insights, `api request`, average `time_to_first_token_ms` and `latency_ms`, breakdown `cache_hit`, filter `status_code = 200` (and `tool_use = false` for matched prompts), after Jul 8; weekly share of `cache_hit = true`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date), 03-event-dictionary.md (`cache_hit`, `time_to_first_token_ms`, `latency_ms`), 04-metrics-and-tables.md (latency definition).
- **Grading:** must compare hits with misses on successful requests, separate time to first token from total latency, and describe the ramp and plateau. Wrong: "caching halves request latency" (only the time to first token falls that much); comparing latency before vs after July 8 for all traffic (atlas-3 and the swift-2 shift move it too); including failed requests (they return early); "adoption keeps growing".

### Q2 — What do caching discounts cost in billed usage?
- **Prompt:** "Cached tokens are billed at a discount. How much usage value did caching discounts take off the bill since launch?"
- **Type:** external-join
- **Answer:** From `model_billing_daily` (cached input billed at 10% of the input price, so the discount is 90% of cached input at list): **about $1.20M since 2026-07-08** ($231k in July, $494k in August, $458k in September, $17k on Oct 1). In August and September the discount is **13.8% and 13.9% of what usage would have been worth without caching** (6.3% in July, the ramp month). Cached input was 245.6B tokens in August and 251.6B in September. Accept ±3% on the dollar figures and 12%-15% for the share.
- **Evidence:** H1-prompt-caching-launch; warehouse `model_billing_daily` (`cached_input_tokens_billed` × `list_price_input_per_mtok` × 0.9); `-- EVAL Q2`.
- **Context needed:** 01-business.md (cached input price), 04-metrics-and-tables.md (billing table).
- **Grading:** must use the warehouse and the 10% rule. Wrong: using Mixpanel token counts without the × 1,000 sampling factor; treating the full list value of cached tokens as the discount (it is 90%).

### Q3 — How fast are customers adopting atlas-3?
- **Prompt:** "How quickly are customers moving to atlas-3 since launch? Is it still growing?"
- **Type:** trend
- **Answer:** Paid accounts adopted it over about three weeks and then plateaued. atlas-3 share of paid-plan flagship requests (atlas-2 + atlas-3): 4.9% in the launch week (Jul 27), 17.0%, 31.1%, 39.8% (week of Aug 17), then 39.7%-41.0% every week through September; **40.2% since Aug 18**. Free accounts got access on Sep 8: 5.5% that week, then 21.8%, 24.4%, 22.2% (**24.0% since Sep 18**). In September atlas-3 served 23.2% of all requests and was used by 2,870 accounts. It is not still growing on paid plans. Accept a paid plateau of 36%-43% and a Free share of 20%-26%.
- **Evidence:** H2-atlas-3-launch; Insights, `api request`, total, breakdown `model`, filter `model` in (atlas-2, atlas-3) and `plan_tier`, weekly, % of total; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch dates, Free access on Sep 8), 03-event-dictionary.md (`plan_tier` at event time).
- **Grading:** must measure share over time, separate paid from Free, and note the plateau. Wrong: share of all requests including swift-2 reported as the adoption rate without saying so; "Free users adopted in August" (they had no access); "still climbing".

### Q4 — Is atlas-3 slower than atlas-2?
- **Prompt:** "Customers say atlas-3 feels slower. Is it, and why?"
- **Type:** segmentation
- **Answer:** Yes, requests take about **1.28x as long** (successful paid requests since launch), but not because the model generates slower: atlas-3 answers are **1.30x longer** (894 vs 688 output tokens on cache misses). Per output token it generates at the same speed (8.3-8.4 ms per output token for both, after the time to first token), and its time to first token is the same (834 vs 823 ms on misses). Within the same cache state: misses 8,302 vs 6,544 ms, hits 7,963 vs 6,163 ms. Overall paid latency moved little over the summer: weekly median latency of successful paid requests was about 4.1-4.2 s in June and about 4.0 s in September; caching and the Build move to swift-2 slightly outweigh atlas-3's longer answers. Accept a latency ratio of 1.2-1.35 and output length as the cause.
- **Evidence:** H2-atlas-3-launch (output-length effect); Insights, `api request`, average `latency_ms`, `time_to_first_token_ms`, and `output_tokens`, breakdown `model` and `cache_hit`, filter paid plans and `status_code = 200`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`latency_ms` includes generating the whole answer; `time_to_first_token_ms`), 02-timeline.md.
- **Grading:** must compare like with like (same cache state or controlling for it) and connect latency to output length. Wrong: "atlas-3 is a slower model per token"; comparing atlas-3 after launch with atlas-2 before launch (caching started in between); "latency got much worse overall".

### Q5 — Should we ship the Interactive Quickstart?
- **Prompt:** "What did the Interactive Quickstart test show? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-01, **64.9% of Interactive Quickstart signups made their first API request within 7 days vs 48.3% for Control** (1,907 vs 1,941 signups; **1.34x**, z ≈ 10.6), and the median time from signup to first request was **2.0 h vs 4.0 h (0.50x)**. Before the test, 49.7% of signups made a first request (1,130 signups). The split is even (49.6% of exposed accounts in the variant). Accept 1.15x-1.45x for conversion and 0.40-0.60 for time.
- **Evidence:** H3-interactive-quickstart-experiment; Funnels, `account created` → `api key created` → `api request`, 7-day window, breakdown user property `Experiment: Interactive Quickstart`; `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (test start, arms), 04-metrics-and-tables.md (activation definition).
- **Grading:** must report conversion and speed by arm with a window. Wrong: comparing signups before vs after July 1 for everyone; counting any later `api request` beyond 7 days.

### Q6 — Do Java and Go developers struggle with onboarding? (null)
- **Prompt:** "Our Java and Go SDKs are newer. Do developers on those SDKs get to a first API request less often than Python and TypeScript developers?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day first-request rate is **54.4% for Java + Go** (747 signups) vs **55.1% for Python, TypeScript, and REST** (4,231); z ≈ −0.4. By SDK: Go 52.7%, Java 55.8%, Python 54.9%, REST 53.3%, TypeScript 55.7%. The gap stays small inside each test arm (Control 47.6% vs 48.4%, z ≈ −0.2; Interactive Quickstart 64.1% vs 65.1%, z ≈ −0.3; not enrolled 49.4% vs 49.7%, z ≈ −0.1). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q6`; Funnels onboarding steps, 7-day window, breakdown user property `sdk_language`.
- **Context needed:** 03-event-dictionary.md (`sdk_language`), 04-metrics-and-tables.md.
- **Grading:** must check the data and call the gap noise. Wrong: "yes, Go is lower" from the 52.7% vs 55% gap without a significance check (Go has 347 signups; the gap is within noise).

### Q7 — How long do batch jobs take?
- **Prompt:** "How long do Batch API jobs take to finish, and does it vary by plan?"
- **Type:** funnel
- **Answer:** Median submit → complete per job: **Scale 1.56 h, Enterprise 1.57 h, Build 3.92 h, Free 6.27 h**. Scale + Enterprise together (1.56 h) run at about **0.40x** the Build time and Free at about **1.60x**. 90th percentiles: Scale 3.3 h, Enterprise 3.2 h, Build 8.0 h, Free 12.4 h. Very few jobs expire (Free 0.8%, none on the other plans). Accept Scale/Enterprise 0.35x-0.45x and Free 1.4x-1.8x of Build.
- **Evidence:** H4-batch-turnaround-by-plan; Funnels, `batch job submitted` → `batch job completed`, hold `batch_id` constant, median time to convert, breakdown `plan_tier`; `-- EVAL Q7`.
- **Context needed:** 03-event-dictionary.md (`batch_id`, `batch_status`), 01-business.md (plans).
- **Grading:** must pair each job's two events (same `batch_id`) and break down by plan. Wrong: a unique-user funnel that pairs a submission with an unrelated later completion; using the current profile plan instead of the plan on the event (close but not exact).

### Q8 — What early behavior predicts new-account retention?
- **Prompt:** "Is there something new accounts do in their first couple of weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Running evaluations in the first 14 days, with 2+ runs as the practical bar.** Among new accounts that made an API request (signups through Aug 25), day-30 retention (active in days 30-36, excluding the platform-sent completion events) is **68.1% with 2+ early eval runs vs 33.5% with 0-1 (2.0x)**; by count: 0 runs 28.8% (1,203 accounts), 1 run 49.2% (364), 2 runs 67.0% (185), 3+ 69.7% (119). Retention climbs from 0 to 1 to 2 runs and then levels off: 3+ and exactly 2 differ by 2.7 points (z ≈ 0.5). Only 16.3% of new API accounts reach 2+ early eval runs. Separately, accounts that never made a request retain at 8.8% at day 30 (1,578 accounts) vs 39.1% for those that did (1,871). Accept 2+ vs 0 of 1.9x-2.7x, a rise from 0 to 1 to 2 runs with a plateau after 2, and mention of first-request activation as a second factor.
- **Evidence:** H5-early-evals-retention; Funnels `account created` → `eval run started` → `eval run started` (14-day window) saved as cohorts; Retention `account created` → a custom event of every event except `batch job completed` and `eval run completed` (plain "any event" gives the same numbers on this data), custom bracket day 30-36, filter "did api request"; `-- EVAL Q8`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (active account, retention definition).
- **Grading:** must define the behavior from the first 14 days only and measure retention after that window. Wrong: eval runs over the whole window (leaks the outcome); a day-7 retention read with the same 14-day eval window (eval runs in days 7-13 count as both predictor and activity); counting `eval run completed` or `batch job completed` as activity; "a hard cliff at exactly 2"; a "sweet spot at exactly 2 runs" (3+ retains at 69.7% vs 67.0% for exactly 2); "every extra run keeps adding retention" (the 2-point step past 2 is noise). Note for graders: a small part of the gap is engagement (accounts that never evaluate also send fewer events later), so "evals predict retention" is correct and "evals alone cause the whole gap" overstates it.

### Q9 — What happened on August 26-27?
- **Prompt:** "We saw a burst of API errors in late August. What happened, and how many requests failed?"
- **Type:** external-join
- **Answer:** The **2026-08-26 to 2026-08-27 GPU capacity incident in us-east**. `inference_fleet_daily` shows `region_status = major_outage` for us-east only, `error_rate_5xx` of 0.357 on both days (vs about 0.013 normally), GPUs online 1,535 and 1,440 vs about 2,367 (35%-39% fewer), utilization 0.97-0.98, and p95 latency about 14,000 ms vs about 7,000 ms. In Mixpanel, us-east request success fell to **62.9%** on those days from 97.4% on the surrounding days (Aug 19-25 and Aug 28-Sep 3), while the other regions stayed at 97.7% (97.5% around); relative to the other regions us-east ran at **0.64x** its normal success rate. Failures were 529 `overloaded_error` (1,724 sampled events). About **1,664 sampled requests above normal failed, about 1.7 million real requests**. Requests that did succeed in us-east were about twice as slow (11,193 vs 5,680 ms the week before). Accept a relative success rate of 0.58-0.75 and 1.3-1.9 million failed requests.
- **Evidence:** H6-us-east-capacity-incident; Insights `api request`, share `status_code = 200`, daily, breakdown `inference_region`; warehouse join on date and `inference_region`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`inference_fleet_daily`), 00-manifest.md (sampling).
- **Grading:** must name the region, dates, error type, and a size, and scale sampled counts by 1,000. Wrong: "all regions failed"; reporting 1,724 failed requests (forgets sampling); blaming rate limits (429s are a separate event and did not change).

### Q10 — Did the outage cost us customers? (null)
- **Prompt:** "After the August outage, did us-east customers leave or cut back their usage? Take accounts that sent API traffic in the three weeks before it (Aug 5-25) and check the three weeks after (Aug 28-Sep 17)."
- **Type:** null-hypothesis
- **Answer:** **No.** Of accounts with API traffic in the three weeks before the incident (Aug 5-25), **87.4% of us-east accounts were still sending traffic in the three weeks after (Aug 28-Sep 17) vs 87.3% in the other regions** (2,503 vs 3,292 accounts; z ≈ 0.1). The same comparison a month earlier (traffic Jul 8-28, still sending Jul 31-Aug 20) was 88.8% vs 87.6%, so the change in the gap is **−1.2 points (z ≈ −0.9, p ≈ 0.35)**. No plan shows a significant change (plan at the last request before the incident). Raw after-incident gaps: Free +0.2 points (z ≈ 0.1), Build −1.4 (z ≈ −1.1), Scale +2.1 (z ≈ 1.3), Enterprise +3.1 (z ≈ 1.7, 173 accounts). Changes in the gap vs a month earlier: Free +0.3 (z ≈ 0.1), Build −3.2 (z ≈ −1.9), Scale −2.3 (z ≈ −1.0), Enterprise +4.4 (z ≈ 1.4). Request volume after / before was 1.02 for us-east and 0.99 elsewhere. The incident cost two days of failed requests, not customers. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q10` (rows with window_days = 21; rows with 14 show the two-week version); Insights `api request`, unique accounts and totals by `inference_region`, Aug 5-25 vs Aug 28-Sep 17, with the same comparison a month earlier (or Retention from a cohort of accounts active before the incident).
- **Context needed:** 02-timeline.md (incident dates), 00-manifest.md (`api request` is sampled, so low-volume accounts can go a week or two without an event).
- **Grading:** must compare with a control group (other regions) over the windows in the prompt. Wrong: "us-east lost accounts" from raw before/after counts without a control (every region loses some accounts over three weeks); "the outage made us-east customers more loyal". The Build change in the gap (−3.2 points, z ≈ −1.9, p ≈ 0.06) comes mostly from an unusually high us-east Build rate a month earlier (92.6% vs 90.7%); the raw after-incident Build gap is −1.4 points (z ≈ −1.1). Accept an answer that mentions it as something to watch, not as a finding; do not accept "us-east Build accounts left". An analyst who ignores the prompt's windows and uses two weeks (Aug 12-25 vs Aug 28-Sep 10) still gets an overall null (81.8% vs 82.1%, z ≈ −0.3; change in gap −2.0 points, z ≈ −1.3), but the sparse sampled traffic of small accounts scatters the plan splits (Build change in gap −6.0 points, z ≈ −2.8; Enterprise raw gap z ≈ 2.1); those reads do not survive the three-week windows the prompt asks for.

### Q11 — Who reacted to the swift-2 price cut?
- **Prompt:** "We halved the swift-2 price on August 18. Did customers move traffic to swift-2?"
- **Type:** trend
- **Answer:** **Build accounts did; no one else did.** swift-2 share of requests on the Build plan rose from **30.0% (Jun 4-Aug 17) to 48.1% in September (1.61x)**; weekly: 30.3% (week of Aug 3), 29.7%, 35.1% (week of Aug 17), 45.3%, 48.1%, then 47.4%-48.6%. Free (29.7% → 29.0%), Scale (29.3% → 29.2%), and Enterprise (29.8% → 30.4%) did not change. Build accounts pay list price; Free accounts pay nothing and Scale and Enterprise buy on contract. Accept 1.45x-1.80x for Build and "no change" for the other plans.
- **Evidence:** H7-swift-price-cut; Insights, `api request`, breakdown `model`, filter `plan_tier`, weekly, % of total; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (price cut), 01-business.md (how each plan is billed).
- **Grading:** must break down by plan at request time and show the Build-only shift. Wrong: a blended all-plan swift share (1.25x, hides who moved); comparing September with July only for Build without a control.

### Q12 — Why did revenue per day fall after July?
- **Prompt:** "Revenue per day is down since July even though traffic looks flat. What happened?"
- **Type:** external-join
- **Answer:** Revenue per day (`model_billing_daily`) was $102.7k in June, **$98.4k in July, $87.9k in August, $82.5k in September (−16.2% July to September)**, while billed requests per day rose from 5.34M to 5.50M (+3.1%). It is price and discount, not volume:
  1. **Prompt caching discounts** grew from $7.4k per day in July (ramp month) to $15.3k per day in September (13.9% of undiscounted usage).
  2. **The swift-2 price cut**: swift-2 revenue per day fell from $9.8k to $5.9k even though swift-2 requests per day rose 29% (1.58M → 2.04M); at the old price September swift-2 would have billed $11.9k per day.
  3. **Build traffic moved from the flagship models to swift-2** after the cut: flagship (atlas-2 + atlas-3) requests per day fell 7.8% (3.76M → 3.47M) and flagship revenue per day fell from $88.6k to $76.5k (which also carries most of the caching discount).
  atlas-3 works slightly the other way (longer answers at the same price). A minor factor: free credit rose from 11.2% of usage value in July to 12.8% in September as the Free base grew. Accept a −12% to −18% decline and naming caching discounts and the swift-2 cut (with the Build move to swift-2) as the drivers.
- **Evidence:** H1 + H7 (+ H2); warehouse `model_billing_daily` by month and model; Mixpanel model mix by plan; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (caching launch, price cut), 01-business.md (prices, caching price), 04-metrics-and-tables.md (revenue definition, partial June).
- **Grading:** must use per-day values (June has 27 days, October 1 day) and decompose into at least two drivers with numbers. Wrong: "traffic fell" (it rose); blaming the August incident (two days); blaming free usage; comparing monthly totals without adjusting for days.

### Q13 — Which customers send the biggest prompts, and why?
- **Prompt:** "Which customers consume the most input tokens per request, and what's driving it?"
- **Type:** segmentation
- **Answer:** **Tool use.** Requests with tools average **11,459 input tokens vs 4,584 without (2.50x)**, because tool definitions and tool results ride in the prompt. Agent builders use tools on 60.3% of requests (coding 30.1%, other use cases 4.0%-6.0%), so agents accounts average 8,746 input tokens per request and coding 6,660, vs about 4,860-4,990 for the rest. Agents accounts send 17.2% of successful requests but 25.3% of input tokens. Inside the tool and no-tool groups, agents and other accounts look the same (11,485 vs 11,431 and 4,588 vs 4,584), so the driver is tool use itself, not the account type. Accept a tool/no-tool ratio of 2.3-2.7.
- **Evidence:** H8-agent-tool-use; Insights, `api request`, average `input_tokens`, breakdown `tool_use` and user property `use_case`; `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`tool_use`, `input_tokens`), 01-business.md (use cases).
- **Grading:** must identify tool use as the mechanism, not only "agents". Wrong: "enterprise customers send bigger prompts" (company size is not the driver); totals instead of per-request averages.

### Q14 — What does a signup cost by paid channel?
- **Prompt:** "What are we paying per new account on each paid developer-marketing channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **hackathons $139.07** (702 signups, $97,625), **search ads $83.86** (1,025, $85,958), **newsletter sponsorships $58.82** (753, $44,290). Hackathons cost about **1.66x** search ads per signup and take 42.8% of the $227,873 paid budget. Spend runs every day on paced budgets (hackathons $536-$1,016 per day). Platforms claim 2,980 signups vs 2,480 recorded in Mixpanel (+20%), which would understate CAC. Accept hackathons/search of 1.5-1.8 and dollar values within ±3%.
- **Evidence:** H9-developer-marketing-economics; warehouse `developer_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, marketing table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting a single day's ratio.

### Q15 — Are hackathons worth it?
- **Prompt:** "Developer marketing wants more hackathon sponsorships. Are they worth it compared with search ads and newsletters?"
- **Type:** attribution
- **Answer:** **No, they are the most expensive way to get a paying account.** With the Mixpanel default 30-day conversion window, for signups Jun 4-Aug 31: **7.8% of hackathon signups upgraded to a paid plan vs 19.8% for search ads** (41 of 526 vs 150 of 756; 0.39x, z ≈ −6.5); newsletters 20.7%, referral 19.1%, github 15.0%, organic 14.2%. Combined with the higher cost per signup, **spend per paying account is $1,752 for hackathons vs $421 for search ads and $281 for newsletters** (Jun 4-Aug 31 spend divided by that period's paying signups): about 4x search and 6x newsletters. Accept a conversion ratio of 0.25-0.50 and a cost per paying account of 3x-7x search (the hackathon buyer count is small).
- **Evidence:** H9-developer-marketing-economics; Funnels `account created` → `plan upgraded`, 30-day window (Mixpanel default), date range Jun 4-Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q15`.
- **Context needed:** 01-business.md (channels, goal 5), 04-metrics-and-tables.md (paid conversion, cost per paying account).
- **Grading:** must combine conversion and cost with a stated window. Wrong: judging on signups or CAC alone; including September signups without their full 30 days.

### Q16 — Did raising Build rate limits work?
- **Prompt:** "We raised Build-tier rate limits on September 1. Did Build customers get throttled less?"
- **Type:** trend
- **Answer:** Yes. Build rate-limit episodes per 1,000 sampled requests (= per million requests) were **26.5 in June, 26.7 in July, 26.8 in August, and 10.3 in September (26.7 over Jun 4-Aug 31, so −61%)**. Free accounts, whose limits did not change, stayed flat (251.7, 252.2, 252.3, then 244.8 in September; 252.1 before), so the drop is not a general trend: relative to Free, Build ran at **0.40x** its earlier rate. Scale (3.4-4.1) and Enterprise (1.0-1.8) were already low and did not change (their episode counts are small, 38-174 a month). Free accounts remain by far the most throttled. Accept a Build drop of 55%-67% with Free flat (Free moves within ±3% month to month).
- **Evidence:** H10-build-rate-limit-raise; Insights, `rate limit hit` and `api request`, monthly, formula A/B, breakdown `plan_tier`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (limit change), 04-metrics-and-tables.md (rate-limit rate), 00-manifest.md (sampling).
- **Grading:** must normalize by request volume and use the plan at event time. Wrong: raw episode counts without a denominator; using the current profile plan (accounts that upgraded mid-window move between groups).

### Q17 — Monthly usage, free credits, and revenue
- **Prompt:** "Give me metered usage, free credits, and revenue by month for the summer."
- **Type:** context
- **Answer:** From `model_billing_daily` (list price): **June (27 days) usage value $3.09M, free credit $319k, revenue $2.77M ($102.7k per day); July $3.43M / $383k / $3.05M ($98.4k per day); August $3.09M / $363k / $2.72M ($87.9k per day); September $2.84M / $363k / $2.47M ($82.5k per day)**; October 1 $98k revenue. Billed requests: 140.4M, 165.6M, 165.7M, 165.1M. Over the whole window revenue was $11.12M: atlas-2 $8.23M (74.0%), atlas-3 $1.89M (17.0%), swift-2 $1.00M (9.0%). Accept within ±1%.
- **Evidence:** warehouse `model_billing_daily`; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (revenue = usage value − free credit; list price; Batch API excluded), 01-business.md.
- **Grading:** must use the warehouse and note the partial June and the one-day October. Wrong: estimating revenue from Mixpanel token counts without the × 1,000 sampling factor; counting free credit as revenue; expecting `requests_billed` to equal 1,000 × Mixpanel requests exactly (billing posts some usage the next day and excludes failed requests).

### Q18 — Free to Build upgrades
- **Prompt:** "How many Free accounts upgrade to Build, and how quickly after signup?"
- **Type:** funnel
- **Answer:** **891 upgrades** in the window, 793 of them by accounts created in the window. Weekly upgrades ran at about 37-63 in full weeks (22 in the partial first week, 37 in the partial last week). New accounts upgrade fast: **median 2.8 days after signup, 82% within 7 days**. With a 30-day window, 16.1% of all signups from Jun 4-Aug 31 upgraded, and 29.7% of those that made their first API request within 7 days. Accept ±5% on counts and rates.
- **Evidence:** Funnels `account created` → `plan upgraded`, 30-day window; Insights `plan upgraded` weekly; `-- EVAL Q18`.
- **Context needed:** 01-business.md (how upgrades work), 04-metrics-and-tables.md (paid conversion).
- **Grading:** must report the time to upgrade and a conversion rate with its window. Wrong: counting `billing page viewed` as an upgrade; including Scale and Enterprise (they do not upgrade self-serve).

### Q19 — Is atlas-3 traffic worth more per request?
- **Prompt:** "atlas-3 has the same list price as atlas-2. Does moving customers to atlas-3 change what we bill per request?"
- **Type:** external-join
- **Answer:** Yes, it raises it. In September, atlas-3 billed **$27.45 of usage per 1,000 requests vs $24.16 for atlas-2 (+14%)**, because its answers are longer: 895 vs 690 output tokens per request (1.30x) with the same input size (6,011 vs 5,976 tokens), and output tokens cost 5x input. swift-2 bills $3.22 per 1,000 requests. Accept +8% to +18%.
- **Evidence:** H2-atlas-3-launch; warehouse `model_billing_daily` (`usage_value_usd` / `requests_billed` by model), Mixpanel average `output_tokens` by `model`; `-- EVAL Q19`.
- **Context needed:** 01-business.md (prices), 04-metrics-and-tables.md (billing table).
- **Grading:** must connect billed value to output length. Wrong: "same price, so same revenue per request"; comparing revenue totals without normalizing by requests.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Revenue per day is falling while traffic grows**: $98.4k per day in July vs $82.5k in September (−16.2%) with requests +3.1%. Caching discounts (about $15k per day) and the swift-2 cut with Build traffic moving to swift-2 explain it. Plan pricing and forecasts around discounts and model mix.
  2. **Activation**: only 55.0% of signups make a first API request within 7 days. The Interactive Quickstart lifts that to 64.9% (vs 48.3%) and halves time to first request. Ship it.
  3. **New-account retention**: just 16.3% of new API accounts run 2+ evaluations in their first 14 days, and they retain at 68% vs 34% at day 30; accounts that never make a request retain at 9%. Push evaluations into onboarding.
  4. **Hackathon spend**: hackathons take 43% of the paid budget but cost $1,752 per paying account vs $421 for search ads and $281 for newsletters.
  5. **Reliability**: the us-east incident failed about 1.7M requests (success 63% for two days); customers did not leave, but a repeat in the largest region would hurt.
  6. **Free-tier throttling**: Free accounts hit about 245 rate-limit episodes per million requests in September, 24x Build after the September raise; it may cap Free-to-paid conversion.
  7. **atlas-3 adoption has plateaued** at about 40% of paid flagship traffic and 24% on Free.
  Positive signals: caching cuts time to first token about in half on hits and is used by half of active accounts (total latency gains are small); the Build limit raise cut throttling 61%; atlas-3 bills 14% more per request than atlas-2.
- **Evidence:** H1-H10; `-- EVAL Q20` (headline numbers) plus Q1-Q19.
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.

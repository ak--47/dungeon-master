# Cortexa (ai-platform) — 20-question eval

- **Data:** `data/verify-ai-platform` (full fidelity: 10,000 accounts, 9,989 with events, 4,971 new accounts, 842,163 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/ai-platform/ai-platform.sql` on that data.
- **Stories:** ids refer to the `stories` export in `ai-platform.js` (H1-H10).
- **Sampling:** one `api request` event stands for 1,000 API requests. Shares and averages need no scaling; request counts are × 1,000.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does prompt caching make the API faster, and is it used?
- **Prompt:** "We shipped prompt caching in July. Are customers using it, and does it actually make requests faster?"
- **Type:** trend
- **Answer:** Yes on both. On successful atlas-2 requests since 2026-07-08, cache hits take **3,111 ms on average vs 6,212 ms for misses (0.50x; median 2,341 vs 4,674 ms)**. Adoption ramped for about three weeks and then leveled off: weekly cache-hit share of requests was 2.8% (week of Jul 6), 13.3% (Jul 13), 24.1% (Jul 20), 34.0% (Jul 27), then 33.3%-36.0% every week through September. Since Jul 29, **34.6% of requests** are cache hits, and 3,602 of the 7,251 accounts that sent requests (49.7%) had at least one hit. Accept a latency ratio of 0.45-0.55 and a plateau of 33%-37% after a ramp.
- **Evidence:** H1-prompt-caching-launch; Insights, `api request`, average `latency_ms`, breakdown `cache_hit`, filter `model = atlas-2` and `status_code = 200`, after Jul 8; weekly share of `cache_hit = true`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date), 03-event-dictionary.md (`cache_hit`, `latency_ms`), 04-metrics-and-tables.md (latency definition).
- **Grading:** must compare hits with misses on comparable requests (same model, successful) and describe the ramp and plateau. Wrong: comparing latency before vs after July 8 for all traffic (atlas-3 and the swift-2 shift move it too); including failed requests (they return early); "adoption keeps growing".

### Q2 — What do caching discounts cost in billed usage?
- **Prompt:** "Cached tokens are billed at a discount. How much usage value did caching discounts take off the bill since launch?"
- **Type:** external-join
- **Answer:** From `model_billing_daily` (cached input billed at 10% of the input price, so the discount is 90% of cached input at list): **about $1.11M since 2026-07-08** ($211k in July, $452k in August, $429k in September, $19k on Oct 1). In August and September the discount is **13.9% of what usage would have been worth without caching** (6.2% in July, the ramp month). Cached input was 224.6B tokens in August and 234.0B in September. Accept ±3% on the dollar figures and 12%-16% for the share.
- **Evidence:** H1-prompt-caching-launch; warehouse `model_billing_daily` (`cached_input_tokens_billed` × `list_price_input_per_mtok` × 0.9); `-- EVAL Q2`.
- **Context needed:** 01-business.md (cached input price), 04-metrics-and-tables.md (billing table).
- **Grading:** must use the warehouse and the 10% rule. Wrong: using Mixpanel token counts without the × 1,000 sampling factor; treating the full list value of cached tokens as the discount (it is 90%).

### Q3 — How fast are customers adopting atlas-3?
- **Prompt:** "How quickly are customers moving to atlas-3 since launch? Is it still growing?"
- **Type:** trend
- **Answer:** Paid accounts adopted it over about three weeks and then plateaued. atlas-3 share of paid-plan flagship requests (atlas-2 + atlas-3): 4.3% in the launch week (Jul 27), 18.5%, 28.5%, 38.7% (week of Aug 17), then 37.0%-38.5% every week through September; **37.8% since Aug 18**. Free accounts got access on Sep 8: 4.2% that week, then 20.4%, 21.8%, 20.8% (**21.9% since Sep 18**). In September atlas-3 served 21.3% of all requests and was used by 2,847 accounts. It is not still growing on paid plans. Accept a paid plateau of 35%-41% and a Free share of 19%-25%.
- **Evidence:** H2-atlas-3-launch; Insights, `api request`, total, breakdown `model`, filter `model` in (atlas-2, atlas-3) and `plan_tier`, weekly, % of total; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch dates, Free access on Sep 8), 03-event-dictionary.md (`plan_tier` at event time).
- **Grading:** must measure share over time, separate paid from Free, and note the plateau. Wrong: share of all requests including swift-2 reported as the adoption rate without saying so; "Free users adopted in August" (they had no access); "still climbing".

### Q4 — Is atlas-3 slower than atlas-2?
- **Prompt:** "Customers say atlas-3 feels slower. Is it, and why?"
- **Type:** segmentation
- **Answer:** Yes, requests take about **1.29x as long** (successful paid requests since launch), but not because the model generates slower: atlas-3 answers are **1.30x longer** (894 vs 689 output tokens on cache misses). Per output token it runs at the same speed (8.9 vs 9.1 ms per output token on misses). Within the same cache state: misses 7,963 vs 6,245 ms, hits 4,039 vs 3,109 ms. Overall paid latency still improved over the summer: weekly median latency of successful paid requests fell from about 3.8 s in June to 2.9-3.0 s in September, because caching and the Build move to swift-2 outweigh atlas-3's longer answers. Accept a latency ratio of 1.2-1.4 and output length as the cause.
- **Evidence:** H2-atlas-3-launch (output-length effect); Insights, `api request`, average `latency_ms` and `output_tokens`, breakdown `model` and `cache_hit`, filter paid plans and `status_code = 200`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`latency_ms` includes generating the whole answer), 02-timeline.md.
- **Grading:** must compare like with like (same cache state or controlling for it) and connect latency to output length. Wrong: "atlas-3 is a slower model per token"; comparing atlas-3 after launch with atlas-2 before launch (caching started in between); "latency got worse overall".

### Q5 — Should we ship the Interactive Quickstart?
- **Prompt:** "What did the Interactive Quickstart test show? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-01, **63.7% of Interactive Quickstart signups made their first API request within 7 days vs 50.7% for Control** (1,881 vs 1,975 signups; **1.26x**, z ≈ 8.2), and the median time from signup to first request was **2.0 h vs 4.0 h (0.50x)**. Before the test, 51.5% of signups made a first request (1,115 signups). The split is even (48.8% of exposed accounts in the variant). Accept 1.15x-1.40x for conversion and 0.40-0.60 for time.
- **Evidence:** H3-interactive-quickstart-experiment; Funnels, `account created` → `api key created` → `api request`, 7-day window, breakdown user property `Experiment: Interactive Quickstart`; `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (test start, arms), 04-metrics-and-tables.md (activation definition).
- **Grading:** must report conversion and speed by arm with a window. Wrong: comparing signups before vs after July 1 for everyone; counting any later `api request` beyond 7 days.

### Q6 — Do Java and Go developers struggle with onboarding? (null)
- **Prompt:** "Our Java and Go SDKs are newer. Do developers on those SDKs get to a first API request less often than Python and TypeScript developers?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day first-request rate is **54.9% for Java + Go** (739 signups) vs **55.9% for Python, TypeScript, and REST** (4,232); z ≈ −0.5. By SDK: Go 55.9%, Java 54.0%, Python 56.4%, REST 53.9%, TypeScript 55.6%. The gap stays small inside each test arm (Control 48.5% vs 51.1%, z ≈ −0.8; Interactive Quickstart 62.8% vs 63.9%, z ≈ −0.3; not enrolled 52.1% vs 51.4%). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q6`; Funnels onboarding steps, 7-day window, breakdown user property `sdk_language`.
- **Context needed:** 03-event-dictionary.md (`sdk_language`), 04-metrics-and-tables.md.
- **Grading:** must check the data and call the gap noise. Wrong: "yes, Java is lower" from the 54.0% vs 56.4% gap without a significance check.

### Q7 — How long do batch jobs take?
- **Prompt:** "How long do Batch API jobs take to finish, and does it vary by plan?"
- **Type:** funnel
- **Answer:** Median submit → complete per job: **Scale 1.58 h, Enterprise 1.55 h, Build 3.95 h, Free 6.26 h**. Scale + Enterprise together (1.57 h) run at about **0.40x** the Build time and Free at about **1.58x**. 90th percentiles: Scale 3.2 h, Enterprise 3.1 h, Build 8.0 h, Free 13.3 h. Very few jobs expire (Free 0.8%, Build 0.07%, none on Scale or Enterprise). Accept Scale/Enterprise 0.35x-0.45x and Free 1.4x-1.8x of Build.
- **Evidence:** H4-batch-turnaround-by-plan; Funnels, `batch job submitted` → `batch job completed`, hold `batch_id` constant, median time to convert, breakdown `plan_tier`; `-- EVAL Q7`.
- **Context needed:** 03-event-dictionary.md (`batch_id`, `batch_status`), 01-business.md (plans).
- **Grading:** must pair each job's two events (same `batch_id`) and break down by plan. Wrong: a unique-user funnel that pairs a submission with an unrelated later completion; using the current profile plan instead of the plan on the event (close but not exact).

### Q8 — What early behavior predicts new-account retention?
- **Prompt:** "Is there something new accounts do in their first couple of weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Running evaluations in the first 14 days, with 2+ runs as the practical bar.** Among new accounts that made an API request (signups through Aug 25), day-30 retention (active in days 30-36, excluding the platform-sent completion events) is **69.7% with 2+ early eval runs vs 30.0% with 0-1 (2.3x)**; by count: 0 runs 25.7% (1,249 accounts), 1 run 45.4% (355), 2 runs 68.0% (175), 3+ 71.7% (152). Day-7 shows the same gradient (65.7%, 84.5%, 89.7%, 96.1%). Only 16.9% of new API accounts reach 2+ early eval runs. Separately, accounts that never made a request retain at 10.9% at day 30 (1,540 accounts) vs 36.8% for those that did (1,931). Accept 2+ vs 0 of 2.3x-3.2x, a rising gradient, and mention of first-request activation as a second factor.
- **Evidence:** H5-early-evals-retention; Funnels `account created` → `eval run started` → `eval run started` (14-day window) saved as cohorts; Retention `account created` → a custom event of every event except `batch job completed` and `eval run completed` (plain "any event" gives the same numbers on this data), custom bracket day 30-36, filter "did api request"; `-- EVAL Q8`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (active account, retention definition).
- **Grading:** must define the behavior from the first 14 days only and show the gradient. Wrong: eval runs over the whole window (leaks the outcome); counting `eval run completed` or `batch job completed` as activity; "a hard cliff at exactly 2". Note for graders: part of the gap is engagement (busier teams both evaluate more and are likelier to be active at day 30), so "evals predict retention" is correct and "evals alone cause the whole gap" overstates it.

### Q9 — What happened on August 26-27?
- **Prompt:** "We saw a burst of API errors in late August. What happened, and how many requests failed?"
- **Type:** external-join
- **Answer:** The **2026-08-26 to 2026-08-27 GPU capacity incident in us-east**. `inference_fleet_daily` shows `region_status = major_outage` for us-east only, `error_rate_5xx` of 0.365 and 0.341 (vs about 0.013 normally), GPUs online 1,535 and 1,440 vs about 2,367 (35%-39% fewer), utilization 0.97-0.98, and p95 latency about 14,000 ms vs about 7,000 ms. In Mixpanel, us-east request success fell to **63.2%** on those days from 97.4% on the surrounding days (Aug 19-25 and Aug 28-Sep 3), while the other regions stayed at 97.7% (97.5% around); relative to the other regions us-east ran at **0.65x** its normal success rate. Failures were 529 `overloaded_error` (1,822 sampled events). About **1,764 sampled requests above normal failed, about 1.8 million real requests**. Requests that did succeed in us-east were about twice as slow (8,944 vs 4,536 ms the week before). Accept a relative success rate of 0.58-0.72 and 1.5-2.1 million failed requests.
- **Evidence:** H6-us-east-capacity-incident; Insights `api request`, share `status_code = 200`, daily, breakdown `inference_region`; warehouse join on date and `inference_region`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`inference_fleet_daily`), 00-manifest.md (sampling).
- **Grading:** must name the region, dates, error type, and a size, and scale sampled counts by 1,000. Wrong: "all regions failed"; reporting 1,822 failed requests (forgets sampling); blaming rate limits (429s are a separate event and did not change).

### Q10 — Did the outage cost us customers? (null)
- **Prompt:** "After the August outage, did us-east customers leave or cut back their usage?"
- **Type:** null-hypothesis
- **Answer:** **No.** Of accounts with API traffic in the two weeks before the incident (Aug 12-25), **83.3% of us-east accounts were still sending traffic in the two weeks after (Aug 28-Sep 10) vs 83.6% in the other regions** (2,270 vs 3,033 accounts; z ≈ −0.3). Request volume after / before was 1.044 for us-east and 1.038 elsewhere. No plan shows a gap (|z| ≤ 0.7 for Free, Build, Scale, and Enterprise). The incident cost two days of failed requests, not customers. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q10`; Insights `api request`, unique accounts and totals by `inference_region`, Aug 12-25 vs Aug 28-Sep 10 (or Retention from a cohort of accounts active before the incident).
- **Context needed:** 02-timeline.md (incident dates).
- **Grading:** must compare with a control group (other regions) and matching windows. Wrong: "us-east lost accounts" from raw before/after counts without a control (every region loses some accounts over two weeks).

### Q11 — Who reacted to the swift-2 price cut?
- **Prompt:** "We halved the swift-2 price on August 18. Did customers move traffic to swift-2?"
- **Type:** trend
- **Answer:** **Build accounts did; no one else did.** swift-2 share of requests on the Build plan rose from **29.7% (Jun 4-Aug 17) to 48.6% in September (1.63x)**; weekly: 30.3%, 30.2%, 33.4% (week of Aug 17), 46.3%, 49.3%, then 48%-49%. Free (29.9% → 29.8%), Scale (30.0% → 29.9%), and Enterprise (29.8% → 29.9%) did not change. Build accounts pay list price; Free accounts pay nothing and Scale and Enterprise buy on contract. Accept 1.45x-1.80x for Build and "no change" for the other plans.
- **Evidence:** H7-swift-price-cut; Insights, `api request`, breakdown `model`, filter `plan_tier`, weekly, % of total; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (price cut), 01-business.md (how each plan is billed).
- **Grading:** must break down by plan at request time and show the Build-only shift. Wrong: a blended all-plan swift share (1.26x, hides who moved); comparing September with July only for Build without a control.

### Q12 — Why did revenue per day fall after July?
- **Prompt:** "Revenue per day is down since July even though traffic looks flat. What happened?"
- **Type:** external-join
- **Answer:** Revenue per day (`model_billing_daily`) was $93.9k in June, **$91.4k in July, $79.2k in August, $76.5k in September (−16% July to September)**, while billed requests per day rose from 5.00M to 5.19M (+4%). It is price and discount, not volume:
  1. **Prompt caching discounts** grew from $6.8k per day in July (ramp month) to $14.3k per day in September (13.9% of undiscounted usage).
  2. **The swift-2 price cut**: swift-2 revenue per day fell from $9.3k to $5.7k even though swift-2 requests per day rose 31% (1.48M → 1.95M); at the old price September swift-2 would have billed $11.4k per day.
  3. **Build traffic moved from the flagship models to swift-2** after the cut: flagship (atlas-2 + atlas-3) requests per day fell 8% (3.51M → 3.24M) and flagship revenue per day fell from $82.1k to $70.8k (which also carries most of the caching discount).
  atlas-3 works slightly the other way (longer answers at the same price). A minor factor: free credit rose from 11.7% of usage value in July to 13.4% in September as the Free base grew. Accept a −14% to −18% decline and naming caching discounts and the swift-2 cut (with the Build move to swift-2) as the drivers.
- **Evidence:** H1 + H7 (+ H2); warehouse `model_billing_daily` by month and model; Mixpanel model mix by plan; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (caching launch, price cut), 01-business.md (prices, caching price), 04-metrics-and-tables.md (revenue definition, partial June).
- **Grading:** must use per-day values (June has 27 days, October 1 day) and decompose into at least two drivers with numbers. Wrong: "traffic fell" (it rose); blaming the August incident (two days); blaming free usage; comparing monthly totals without adjusting for days.

### Q13 — Which customers send the biggest prompts, and why?
- **Prompt:** "Which customers consume the most input tokens per request, and what's driving it?"
- **Type:** segmentation
- **Answer:** **Tool use.** Requests with tools average **11,469 input tokens vs 4,592 without (2.50x)**, because tool definitions and tool results ride in the prompt. Agent builders use tools on 59.7% of requests (coding 30.1%, other use cases 3.9%-5.9%), so agents accounts average 8,698 input tokens per request and coding 6,674, vs about 4,900 for the rest. Agents accounts send 17.9% of successful requests but 26.1% of input tokens. Inside the tool and no-tool groups, agents and other accounts look the same (11,457 vs 11,481 and 4,608 vs 4,590), so the driver is tool use itself, not the account type. Accept a tool/no-tool ratio of 2.3-2.7.
- **Evidence:** H8-agent-tool-use; Insights, `api request`, average `input_tokens`, breakdown `tool_use` and user property `use_case`; `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`tool_use`, `input_tokens`), 01-business.md (use cases).
- **Grading:** must identify tool use as the mechanism, not only "agents". Wrong: "enterprise customers send bigger prompts" (company size is not the driver); totals instead of per-request averages.

### Q14 — What does a signup cost by paid channel?
- **Prompt:** "What are we paying per new account on each paid developer-marketing channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **hackathons $144.42** (676 signups, $97,625), **search ads $88.98** (966, $85,958), **newsletter sponsorships $54.88** (807, $44,290). Hackathons cost about **1.62x** search ads per signup and take 42.8% of the $227,873 paid budget. Spend runs every day on paced budgets (hackathons $536-$1,016 per day). Platforms claim 2,980 signups vs 2,449 recorded in Mixpanel (+22%), which would understate CAC. Accept hackathons/search of 1.5-1.8 and dollar values within ±3%.
- **Evidence:** H9-developer-marketing-economics; warehouse `developer_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, marketing table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting a single day's ratio.

### Q15 — Are hackathons worth it?
- **Prompt:** "Developer marketing wants more hackathon sponsorships. Are they worth it compared with search ads and newsletters?"
- **Type:** attribution
- **Answer:** **No, they are the most expensive way to get a paying account.** With the Mixpanel default 30-day conversion window, for signups Jun 4-Aug 31: **8.2% of hackathon signups upgraded to a paid plan vs 20.1% for search ads** (41 of 501 vs 144 of 715; 0.41x, z ≈ −6.2); newsletters 18.1%, referral 25.2%, github 17.8%, organic 16.1%. Combined with the higher cost per signup, **spend per paying account is $1,752 for hackathons vs $438 for search ads and $294 for newsletters** (Jun 4-Aug 31 spend divided by that period's paying signups): 4x search and 6x newsletters. Accept a conversion ratio of 0.30-0.55 and a cost per paying account of 3x-5x search.
- **Evidence:** H9-developer-marketing-economics; Funnels `account created` → `plan upgraded`, 30-day window (Mixpanel default), date range Jun 4-Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q15`.
- **Context needed:** 01-business.md (channels, goal 5), 04-metrics-and-tables.md (paid conversion, cost per paying account).
- **Grading:** must combine conversion and cost with a stated window. Wrong: judging on signups or CAC alone; including September signups without their full 30 days.

### Q16 — Did raising Build rate limits work?
- **Prompt:** "We raised Build-tier rate limits on September 1. Did Build customers get throttled less?"
- **Type:** trend
- **Answer:** Yes. Build rate-limit episodes per 1,000 sampled requests (= per million requests) were **30.3 in July, 31.0 in August, and 12.2 in September (−61% vs August)**. Free accounts, whose limits did not change, stayed flat (263.1, 280.4, 278.2), so the drop is not a general trend: relative to Free, Build ran at **0.40x** its August rate. Scale (4.2, 4.6, 5.2) and Enterprise (1.3, 1.7, 1.5) were already low. Free accounts remain by far the most throttled. Accept a Build drop of 55%-65% with Free flat.
- **Evidence:** H10-build-rate-limit-raise; Insights, `rate limit hit` and `api request`, monthly, formula A/B, breakdown `plan_tier`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (limit change), 04-metrics-and-tables.md (rate-limit rate), 00-manifest.md (sampling).
- **Grading:** must normalize by request volume and use the plan at event time. Wrong: raw episode counts without a denominator; using the current profile plan (accounts that upgraded mid-window move between groups).

### Q17 — Monthly usage, free credits, and revenue
- **Prompt:** "Give me metered usage, free credits, and revenue by month for the summer."
- **Type:** context
- **Answer:** From `model_billing_daily` (list price): **June (27 days) usage value $2.84M, free credit $301k, revenue $2.53M ($93.9k per day); July $3.21M / $375k / $2.83M ($91.4k per day); August $2.80M / $342k / $2.46M ($79.2k per day); September $2.65M / $354k / $2.29M ($76.5k per day)**; October 1 $95k revenue. Billed requests: 127.9M, 154.9M, 150.4M, 155.7M. Over the whole window revenue was $10.21M: atlas-2 $7.64M (74.9%), atlas-3 $1.64M (16.1%), swift-2 $0.93M (9.1%). Accept within ±1%.
- **Evidence:** warehouse `model_billing_daily`; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (revenue = usage value − free credit; list price; Batch API excluded), 01-business.md.
- **Grading:** must use the warehouse and note the partial June and the one-day October. Wrong: estimating revenue from Mixpanel token counts without the × 1,000 sampling factor; counting free credit as revenue; expecting `requests_billed` to equal 1,000 × Mixpanel requests exactly (billing posts some usage the next day and excludes failed requests).

### Q18 — Free to Build upgrades
- **Prompt:** "How many Free accounts upgrade to Build, and how quickly after signup?"
- **Type:** funnel
- **Answer:** **920 upgrades** in the window, 827 of them by accounts created in the window. Weekly upgrades were steady at about 45-75 (35 in the partial first week, 25 in the partial last week). New accounts upgrade fast: **median 2.6 days after signup, 85% within 7 days**. With a 30-day window, 17.6% of all signups from Jun 4-Aug 31 upgraded, and 31.4% of those that made their first API request within 7 days. Accept ±5% on counts and rates.
- **Evidence:** Funnels `account created` → `plan upgraded`, 30-day window; Insights `plan upgraded` weekly; `-- EVAL Q18`.
- **Context needed:** 01-business.md (how upgrades work), 04-metrics-and-tables.md (paid conversion).
- **Grading:** must report the time to upgrade and a conversion rate with its window. Wrong: counting `billing page viewed` as an upgrade; including Scale and Enterprise (they do not upgrade self-serve).

### Q19 — Is atlas-3 traffic worth more per request?
- **Prompt:** "atlas-3 has the same list price as atlas-2. Does moving customers to atlas-3 change what we bill per request?"
- **Type:** external-join
- **Answer:** Yes, it raises it. In September, atlas-3 billed **$27.42 of usage per 1,000 requests vs $24.18 for atlas-2 (+13%)**, because its answers are longer: 901 vs 689 output tokens per request (1.31x) with the same input size (5,972 vs 5,991 tokens), and output tokens cost 5x input. swift-2 bills $3.25 per 1,000 requests. Accept +10% to +16%.
- **Evidence:** H2-atlas-3-launch; warehouse `model_billing_daily` (`usage_value_usd` / `requests_billed` by model), Mixpanel average `output_tokens` by `model`; `-- EVAL Q19`.
- **Context needed:** 01-business.md (prices), 04-metrics-and-tables.md (billing table).
- **Grading:** must connect billed value to output length. Wrong: "same price, so same revenue per request"; comparing revenue totals without normalizing by requests.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Revenue per day is falling while traffic grows**: $91.4k per day in July vs $76.5k in September (−16%) with requests +4%. Caching discounts (about $14k per day) and the swift-2 cut with Build traffic moving to swift-2 explain it. Plan pricing and forecasts around discounts and model mix.
  2. **Activation**: only 55.8% of signups make a first API request within 7 days. The Interactive Quickstart lifts that to 63.7% (vs 50.7%) and halves time to first request. Ship it.
  3. **New-account retention**: just 16.9% of new API accounts run 2+ evaluations in their first 14 days, and they retain at 70% vs 30% at day 30; accounts that never make a request retain at 11%. Push evaluations into onboarding.
  4. **Hackathon spend**: hackathons take 43% of the paid budget but cost $1,752 per paying account vs $438 for search ads and $294 for newsletters.
  5. **Reliability**: the us-east incident failed about 1.8M requests (success 63% for two days); customers did not leave, but a repeat in the largest region would hurt.
  6. **Free-tier throttling**: Free accounts hit about 280 rate-limit episodes per million requests, 20x+ Build after the September raise; it may cap Free-to-paid conversion.
  7. **atlas-3 adoption has plateaued** at about 38% of paid flagship traffic and 22% on Free.
  Positive signals: caching halves latency on hits and is used by half of active accounts; the Build limit raise cut throttling 61%; atlas-3 bills 13% more per request than atlas-2.
- **Evidence:** H1-H10; `-- EVAL Q20` (headline numbers) plus Q1-Q19.
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.

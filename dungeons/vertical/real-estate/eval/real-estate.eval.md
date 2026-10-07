# Keystead Homes (real-estate) — 20-question eval

- **Data:** `data/verify-real-estate` (full fidelity: 10,000 shopper profiles, 9,748 with events, 4,480 new signups, 1,145,171 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/real-estate/real-estate.sql` on that data.
- **Stories:** ids refer to the `stories` export in `real-estate.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the August rate spike hurt offers?
- **Prompt:** "Mortgage rates jumped in August. Did that hurt our buyers' willingness to make offers, and by how much?"
- **Type:** external-join
- **Answer:** Yes. Touring did not change, but fewer completed tours turned into offers. On days when the 30-year conventional rate on the rate sheet was at its high (≥ 6.95%, Aug 16-Sep 14), **8.9% of completed tours got an offer within 14 days vs 12.7%** on baseline days before the climb (Jun 4-Aug 9, about 6.30%): **0.70x raw**. Holding the buyer mix fixed gives the same answer: among shoppers who have applied for Keystead financing (profile `preapproval_status` other than `none`), tours by pre-approved buyers went 33.4% → 23.7% (0.71x) and their other tours 13.4% → 9.1% (0.68x), **0.70x** standardized to the baseline pre-approved mix (0.66x on all shoppers with the same standardization). Weekly offer rates per tour ran about 11-16% through the week of Aug 3, 9.5% in the week of the climb (Aug 10), and 6.8-9.5% in the weeks of Aug 17 to Sep 7. Listing-page tour requests per saved home were flat across the spike (0.227 on high-rate days vs 0.225 on post-launch baseline days), so the effect is at the offer decision, not at touring. Offers fell from about 101 a week (Jul 20-Aug 16) to about 75 a week (Aug 17-Sep 13) and recovered to about 89 a week (Sep 14-27) as rates eased. Accept 0.60x-0.80x.
- **Evidence:** H1-rate-spike-cools-offers; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id` constant, 14-day window, breakdown `buyer_preapproved` (optionally filtered to `preapproval_status` ≠ `none`), daily, joined to `mortgage_rate_sheet_daily.note_rate_pct` (conventional) by date; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (rate move dates), 04-metrics-and-tables.md (offer rate per tour, rate sheet table).
- **Grading:** must use a per-tour rate (not raw offer counts) and tie the drop to the rate days from the warehouse table. Accept the raw all-tour ratio or a mix-adjusted one. Wrong: "offers fell because tours fell" (tours per save did not move, and Tour It Now raised tour volume); comparing raw weekly offer counts without noting that Tour It Now lifted tours in late July.

### Q2 — Did Tour It Now work?
- **Prompt:** "We launched Tour It Now in July. Did it actually get more people into homes?"
- **Type:** trend
- **Answer:** Yes. Listing-page tour requests per saved home rose from **0.153 (Jun 4-Jul 14) to 0.229 (from Jul 22), 1.49x**. Tour It Now became **55% of listing-page requests** after the first week (4,080 Tour It Now bookings from Jul 22; none before Jul 15). Per saved home, scheduled listing-page requests fell from 0.153 to 0.102 while Tour It Now added 0.126, so about 40% of Tour It Now bookings replaced a scheduled tour and about 60% were new touring. Weekly, scheduled requests (all sources) went from about 700-755 before the launch to 605-700 after, while Tour It Now added 370-430. Completed tours rose from about 550-620 a week in June and early July to 810-890 a week from late July. Tour It Now tours also complete more often (87.3% vs 79.7% for scheduled since Jul 22). Accept 1.35x-1.65x.
- **Evidence:** H2-tour-it-now-launch; Insights, `tour requested` (request_source = listing_page) / `listing saved`, weekly, breakdown `booking_type`; `-- STORY H2`, `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch date, rollout week).
- **Grading:** must normalize by saves (or compare per week against the trend) and separate cannibalization from new tours. Wrong: counting every `tour_it_now` booking as lift (about two in five replaced a scheduled tour, so that overstates it); including agent-chat tours, which the launch did not touch.

### Q3 — How much does a pre-approval matter?
- **Prompt:** "How much more likely is a pre-approved buyer to make an offer after a tour?"
- **Type:** funnel
- **Answer:** About **2.4-2.5x for the same kind of buyer**; the raw gap is larger. Across all tours through Sep 17, **29.1% of tours by buyers with a Keystead pre-approval got an offer within 14 days vs 6.2%** for all other tours (4.7x). Much of that raw gap is who gets pre-approved: shoppers who never apply rarely bid. Among shoppers who have applied for Keystead financing at some point (profile `preapproval_status` other than `none`, 2,871 shoppers), tours while pre-approved convert at 29.1% vs 12.2% for their tours without a valid letter (**2.39x**); before the rate climb (tours Jun 4-Aug 9) 33.4% vs 13.4% (2.49x); compared inside rate bands 2.43x. About 22% of completed tours are by pre-approved buyers. Accept 2.1x-2.9x for a like-for-like comparison; accept the raw 4-5x only if the answer says it overstates the effect of the letter itself.
- **Evidence:** H3-preapproved-buyers-offer; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, breakdown `buyer_preapproved`, filtered to `preapproval_status` ≠ `none` (and unfiltered for the raw gap); `-- STORY H3`, `-- EVAL Q3`.
- **Context needed:** 03-event-dictionary.md (`buyer_preapproved` is the status at tour time; `preapproval_status`), 01-business.md (pre-approval, outside lenders).
- **Grading:** must compare per tour and use the tour-time flag. Credit for noticing that shoppers who never apply differ from those who do. Wrong: comparing shoppers by current profile `preapproval_status` alone as the pre-approved flag (letters expire and many approvals came after the tours); unique-shopper funnels; presenting 4.7x as the causal effect of a letter.

### Q4 — Do saved searches keep new shoppers?
- **Prompt:** "The growth team thinks saved searches are the key habit for new shoppers. Is that true?"
- **Type:** retention
- **Answer:** Yes, strongly. Of 2,370 new shoppers who signed up Jun 4-Aug 6, **43.5% saved a search within 7 days**. **57.3% of them viewed a listing on day 28-55 after signup vs 26.6%** of new shoppers who did not (0.46x, or savers retain 2.2x as well). Accept a ratio of 0.40-0.55 (or 1.8x-2.5x the other way) with a complete bracket.
- **Evidence:** H4-saved-search-retention; Retention, birth `account created` (Jun 4-Aug 6), return `listing viewed`, custom bracket day 28-55, breakdown user property `saved_search_count` > 0 (for these new shoppers it picks exactly the week-one savers; checked in `-- STORY H4`), or a cohort saved from the converters of the Funnel `account created` → `saved search created` with a 7-day window; `-- STORY H4`, `-- EVAL Q4`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (active shopper definition, retention).
- **Grading:** must exclude passive events (`listing alert sent` keeps firing for up to 30 days after a shopper's last visit) and use complete brackets. Wrong: counting alerts as activity (makes savers who left look retained); including September signups.

### Q5 — Does agent response speed matter?
- **Prompt:** "Does it matter how fast our agents reply to a shopper's message?"
- **Type:** funnel
- **Answer:** Yes, a lot. For replies through Sep 24 (24,704), the share followed by a tour request on that home within 7 days falls with response time: **28.6% when the agent replied within 10 minutes, 18.8% at 10-60 minutes, 11.8% after an hour** (slow / fast = 0.41x). The median reply takes 20 minutes; 31% are within 10 minutes and 20% take over an hour, so the slow tail is a real opportunity. Accept a steady decline with slow/fast of 0.33-0.47.
- **Evidence:** H5-speed-to-lead; Funnels, `agent responded` → `tour requested`, Totals, hold `listing_id`, 7-day window, breakdown `response_minutes` (custom buckets); `-- STORY H5`, `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md (`response_minutes`), 01-business.md (goal 5).
- **Grading:** must analyze per reply and per home. Wrong: correlating each agent's average speed with their tour count (agents differ in volume); calling 10 minutes a hard cliff (the decline is smooth).

### Q6 — Which paid channel has the best CAC?
- **Prompt:** "Paid social gives us the cheapest new accounts. Is it really our most efficient channel?"
- **Type:** external-join
- **Answer:** No. It is the cheapest per account and the most expensive per buyer. Over the window, spend per Mixpanel signup was **$14.88 paid social, $23.71 YouTube, $38.65 paid search** (warehouse spend ÷ `account created` by channel). But paid social signups rarely become buyers. Among signups Jun 4-Sep 1: **5.3% of paid social signups started a pre-approval within 30 days vs 21.1% for all other channels** (18.5% paid search, 23.1% YouTube; 0.25x), and they submitted **0.029 offers per signup by Oct 1 vs 0.095** for the other channels (0.108 paid search, 0.083 YouTube; 0.31x). Spend per pre-approval start is **$282 paid social vs $209 paid search and $103 YouTube**; spend per offer is **$507 vs $359 and $287**. YouTube is the most efficient paid channel on every buyer measure. Accept per-signup CAC within 10% of these, a start-rate ratio of 0.15-0.40, and any buyer-stage measure (starts, offers, accepted offers) that shows paid social at or above paid search per buyer.
- **Evidence:** H6-paid-social-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `account created` → `pre-approval started`, 30-day window, breakdown `acquisition_channel`; Insights `offer submitted` (total) for those signups by `acquisition_channel`; `-- STORY H6`, `-- EVAL Q6`.
- **Context needed:** 04-metrics-and-tables.md (CAC and cost per pre-approval start and per offer, `marketing_spend_daily`), 01-business.md (channels).
- **Grading:** must join warehouse spend to Mixpanel signups and look past the signup. Wrong: using `leads_reported` as the denominator (platforms over-claim: $12.57 per claimed lead for social); "move budget to paid social" based on CAC alone. Note the small counts (54 paid social starts, 30 paid social offers; accepted offers per channel are 12-23, too few to rank on).

### Q7 — What happened in Austin in late August?
- **Prompt:** "Austin listing views fell off a cliff for a week in late August. Did Austin buyers lose interest?"
- **Type:** context
- **Answer:** No, it was the MLS feed. From Aug 24 to Aug 30 the Austin MLS import was stale (`feed_status = stale` in `market_inventory_daily`, zero new Austin listings, and no Austin listing alerts). Austin listing views fell to about **0.45x their normal share**: Austin views were 7.7% of other-market views on those days vs 17.0% in the 14 days either side (314-467 Austin views a day vs 651-1,224 in the two weeks before and after). Views were back to normal on Aug 31, when the fix loaded the backlog. Other markets were not affected. Accept 0.40x-0.52x and attribution to the feed.
- **Evidence:** H7-austin-feed-outage; Insights `listing viewed` by `market`, daily, joined to `market_inventory_daily.feed_status`; `-- STORY H7`, `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (outage dates), 04-metrics-and-tables.md (`feed_status`).
- **Grading:** must name the feed outage and size it against the other markets. Wrong: "Austin demand fell"; comparing Austin to itself without a control across the late-August rate period.

### Q8 — Should we ship Payment Estimate?
- **Prompt:** "Is the Payment Estimate test getting more people pre-approved? Should we roll it out?"
- **Type:** funnel
- **Answer:** Yes. Of shoppers exposed Jul 29-Sep 17 (3,326 Control, 3,398 Payment Estimate), **13.9% in the variant started a pre-approval within 14 days vs 9.8% in Control (1.43x, z ≈ 5.3)**. 393 of the 872 variant applications since the start (45%) came from the estimate's link (`entry_point = payment_estimate`); Control has none. The split is balanced (50.5% variant). Recommend shipping. Accept a lift of 1.25x-1.65x.
- **Evidence:** H8-payment-estimate-experiment; Funnels `$experiment_started` → `pre-approval started`, 14-day window, breakdown `Experiment: Payment Estimate` (or the Experiments report); `-- STORY H8`, `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (start date, eligibility), 03-event-dictionary.md (`entry_point`).
- **Grading:** must compare arms on exposed shoppers after the start. Wrong: counting only `entry_point = payment_estimate` starts as the lift (some would have applied anyway); using the site-wide before/after change in weekly starts (136 a week before Jul 29 vs 162 after) as the effect size, because only eligible shoppers are in the test and half of them see the variant.

### Q9 — How long from tour to offer?
- **Prompt:** "How long do buyers take to make an offer after a tour? Does it differ by type of buyer?"
- **Type:** funnel
- **Answer:** Median **54 hours** overall. By buyer type: **investors 22.7 h, move-up buyers 49.5 h, first-time buyers 83.2 h**, so first-time buyers take about **1.7x** as long as move-up buyers and investors about **0.46x**. Accept medians within 10% and the ordering investor < move_up < first_time.
- **Evidence:** H9-time-to-offer-by-buyer-type; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, median time to convert, breakdown `buyer_type`; `-- STORY H9`, `-- EVAL Q9`.
- **Context needed:** 01-business.md (buyer types).
- **Grading:** must measure tour to offer per home. Wrong: time from signup to first offer (mixes search length with decision speed).

### Q10 — Do price cuts drive saves?
- **Prompt:** "Do listings with a price cut get saved more?"
- **Type:** segmentation
- **Answer:** Yes. A view of a price-cut listing turns into a save **12.4% of the time vs 7.0%** at the original price (**1.76x**). Price-cut listings are 15.3% of views but 24.1% of saves. Accept 1.6x-2.0x.
- **Evidence:** H10-price-cuts-get-saved; Insights `listing saved` / `listing viewed`, breakdown `price_reduced`; `-- STORY H10`, `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`price_reduced` is as of the event).
- **Grading:** must use a per-view rate. Wrong: counting saves only (cut listings are fewer); using days on market as a stand-in.

### Q11 — How high did rates go?
- **Prompt:** "Walk me through what mortgage rates did this summer on our rate sheet."
- **Type:** external-join
- **Answer:** The 30-year conventional note rate averaged **6.30%** before Aug 10, climbed during the week of Aug 10, sat at **7.00%** (max 7.03%) from Aug 16 to Sep 14 (30 days at or above 6.95%), and eased to about **6.62%** from Sep 28. Other loan types moved with it at a near-constant spread (a few hundredths of a point of day-to-day variation): FHA 6.01% → 6.70%, VA 5.90% → 6.60%, jumbo 6.45% → 7.15% (Aug 17-Sep 13 averages). Shoppers' quoted rates on approvals followed: median 6.25% before Aug 10 vs 7.00% Aug 17-Sep 13. Accept values within 0.05 points.
- **Evidence:** `-- EVAL Q11`, `-- EVAL Q15` (quoted rates); warehouse `mortgage_rate_sheet_daily`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (rate sheet).
- **Grading:** must use the warehouse table (rates are not on events except `rate_quoted_pct`). Wrong: reading `rate_quoted_pct` alone as the market rate (it includes borrower adjustments).

### Q12 — Are Tour It Now tours worse leads?
- **Prompt:** "Sales says Tour It Now brings tire-kickers — people who tour on a whim and never make an offer. Is that true?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. For tours completed Jul 22-Sep 17, **10.7% of Tour It Now tours got an offer within 14 days vs 10.0% of scheduled tours** (2,816 vs 4,278 tours, z ≈ 0.9, p ≈ 0.36). Within pre-approved buyers: 27.2% vs 26.9% (z ≈ 0.1); others: 5.9% vs 5.4% (z ≈ 0.8). By buyer type the largest gap is investors (11.8% vs 9.1%, z ≈ 1.8, p ≈ 0.08); by market every |z| ≤ 1.4. Tour It Now tours are as likely to lead to offers as scheduled tours. Accept "no difference" with a gap under about 2 points overall.
- **Evidence:** `-- EVAL Q12` (overall, by `buyer_preapproved`, and the market and buyer_type sub-splits); Funnels `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, breakdown `booking_type`, date range Jul 22-Sep 17.
- **Context needed:** 02-timeline.md (launch), 04-metrics-and-tables.md (offer rate per tour).
- **Grading:** must test and report no difference. Wrong: inventing a quality gap (in either direction); comparing all June-September tours (before the launch only scheduled tours existed, and rates changed mid-period).

### Q13 — Does the contact channel matter?
- **Prompt:** "Should we push shoppers toward call requests instead of chat? Do call requests convert to tours better?"
- **Type:** null-hypothesis
- **Answer:** No. Per agent contact (through Sep 23), the share followed by a tour request on that home within 7 days (the lead-response funnel window) is **20.3% for chat, 21.4% for call requests, and 20.6% for email** (chi-square 2.6 on 2 df, p ≈ 0.27). No market shows a significant difference either (largest chi-square 4.6 in Nashville, p ≈ 0.10). What matters is how fast the agent replies (Q5), not the channel. Accept "no difference".
- **Evidence:** `-- EVAL Q13`; Funnels `agent contacted` → `tour requested`, Totals, hold `listing_id`, 7-day window, breakdown `contact_method`.
- **Context needed:** 03-event-dictionary.md (`contact_method`).
- **Grading:** must report no meaningful difference. Wrong: recommending a channel push based on a gap of about one point.

### Q14 — Why did Austin new listings spike on Aug 31?
- **Prompt:** "Our inventory table shows 364 new Austin listings on August 31. Was that a real listing surge?"
- **Type:** context
- **Answer:** No. Austin normally adds about **45 listings a day** (Aug 3-23 average). New listings were **0 from Aug 24 to Aug 30** while the MLS feed was stale, active listings drifted down from 2,114 to 1,835 as homes sold or expired with nothing replacing them, and on **Aug 31 the fixed import loaded the week's backlog (364)**; active listings were back to 2,118 that day and new listings returned to about 45-65 a day. It is a catch-up, not a surge. Accept the backlog explanation with the zero-week.
- **Evidence:** H7 (trace); `-- EVAL Q14`; warehouse `market_inventory_daily`.
- **Context needed:** 02-timeline.md (outage and fix date), 04-metrics-and-tables.md (`new_listings`, `feed_status`).
- **Grading:** must connect the spike to the outage. Wrong: "Austin sellers rushed to list".

### Q15 — How are pre-approvals trending?
- **Prompt:** "How many shoppers are getting pre-approved with Keystead Home Loans, and is it growing?"
- **Type:** trend
- **Answer:** **2,574 applications started and 1,836 approved (71%)** in the window. Starts ran about **136 a week before Jul 29 and 162 a week from Jul 29** (+19%), and the step lines up with the Payment Estimate test, which lifts starts among exposed shoppers in its variant (Q8). Loan mix: conventional 61%, FHA 22%, VA 10%, jumbo 8%. At the end of the window 1,441 profiles hold a valid approval, 1,025 have an expired one, and 405 applied without approval. Accept about 2,550 starts, a 69-74% approval rate, and a modest rise after Jul 29.
- **Evidence:** `-- EVAL Q15`; Insights `pre-approval started` and `pre-approval completed`, weekly, breakdown `loan_type`; profile `preapproval_status`.
- **Context needed:** 01-business.md (90-day letters, renewals), 02-timeline.md (test start), 03-event-dictionary.md.
- **Grading:** must give counts and the trend. Wrong: "the experiment doubled pre-approvals"; counting profile status as approvals in the window.

### Q16 — Are we growing?
- **Prompt:** "Is our active shopper base growing this summer?"
- **Type:** trend
- **Answer:** Yes, steadily. Weekly active shoppers (listing viewed or home search) rose from **3,898 (week of Jun 8) to 5,029 (week of Sep 21)**, about 29%. Monthly: **6,024 for Jun 4-30 (27 days, the window starts June 4), 6,669 in July, 7,176 in August, 7,574 in September**. Part of the June-to-July step is the shorter June. New accounts were steady at about 37 a day (978 for Jun 4-30, then 1,173, 1,176, and 1,131; about 260 a week); growth comes from new shoppers adding to a stable established base. Accept weekly and monthly figures within 3%.
- **Evidence:** `-- EVAL Q16`; Insights, unique `listing viewed` or `home search`, monthly and weekly; `account created` monthly.
- **Context needed:** 04-metrics-and-tables.md (active shopper definition), 00-manifest.md (identity, UTC).
- **Grading:** must exclude passive events and count unique shoppers, and treat June as a partial month (Jun 4-30) or use full weeks. Wrong: counting `listing alert sent` recipients as active; reading the June-to-July monthly step as pure growth; reporting October 1 as a month.

### Q17 — What should we worry about?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **Rates and offer demand**: offers per completed tour fell to about 0.70x on high-rate days (8.9% vs 12.7%); offers dropped from about 101 to 75 a week and recovered only to about 89 as rates eased (Q1, Q11). Another rate move would hit the same step.
  - **Paid social efficiency**: cheapest per account ($14.88) but 0.25x as likely to start a pre-approval and 0.31x the offers per signup; per pre-approval start ($282 vs $209) and per offer ($507 vs $359) it costs more than paid search, and YouTube is cheapest on both ($103, $287) (Q6, Q20).
  - **Agent response times**: 20% of replies take over an hour, and those convert to tours at 11.8% vs 28.6% within 10 minutes (Q5).
  - **New-shopper retention**: shoppers without a saved search in week one retain at under half the rate (26.6% vs 57.3%); 57% of new shoppers do not set one up in their first week (Q4).
  - **Feed reliability**: one stale MLS feed cost Austin more than half its views for a week (Q7, Q14).
  - Positives to keep: Tour It Now lifted listing-page tours per save 1.49x without worse tours (Q2, Q12); Payment Estimate lifts pre-approval starts 1.43x and should ship (Q8). Context: weekly active shoppers grew from 3,898 (week of Jun 8) to 5,029 (week of Sep 21); 420 offers accepted in the window.
- **Evidence:** H1, H4, H5, H6, H7, H2, H8; `-- EVAL Q17` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data. Penalize generic advice without numbers or claims the data do not support (for example "Tour It Now tours are low quality" or "chat converts worse than calls").

### Q18 — How many homes went under contract?
- **Prompt:** "How many of our buyers got an accepted offer this period, and what's our acceptance rate?"
- **Type:** segmentation
- **Answer:** **420 offers accepted** (414 buyers; a few had a backup offer also accepted) and 1,440 offers submitted in the window. Of the 1,413 offers submitted in the window that have an outcome, **29.4% were accepted** (a few acceptances are for offers submitted just before June 4). By market, acceptance ranges from 26.2% (Austin) to 34.3% (Charlotte). Median accepted price **$349,500**; the median offer is 1.5% under list (offer-to-list 0.985). The most common rejection reason is being outbid (476 of 1,009 rejections, 47%). Accept counts within 2% and a rate of 28-31%.
- **Evidence:** `-- EVAL Q18`; Insights `offer accepted`, `offer rejected`, `offer submitted`, breakdown `market`, `rejection_reason`.
- **Context needed:** 01-business.md (under contract, closing later), 04-metrics-and-tables.md (acceptance rate, homes under contract).
- **Grading:** must define the rate on offers with an outcome. Wrong: calling accepted offers closings or revenue in the window (closings come 30-45 days later).

### Q19 — How much do people browse before signing up?
- **Prompt:** "How many listings do people look at before they create an account?"
- **Type:** segmentation
- **Answer:** On average **3.1 listings** (median 3) before `account created`. 17.2% sign up after one listing or none, and 35% look at four or more first. These views are anonymous (device only) until signup; Mixpanel links them to the account through the signup event, which carries both ids (all 18,465 anonymous events link to an account). Accept an average of about 3 and the identity explanation.
- **Evidence:** `-- EVAL Q19`; Funnels `listing viewed` → `account created` or Insights on `listing viewed` before signup for new shoppers (identity merge on).
- **Context needed:** 00-manifest.md (identity notes).
- **Grading:** must count anonymous views linked to the account. Wrong: "zero" (counting only events with `user_id`); counting all views in the signup session after signup.

### Q20 — Where should next quarter's paid budget go?
- **Prompt:** "If we can move paid budget between search, social, and YouTube next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge channels on buyers, not accounts. Window spend was about $36.3k paid search, $20.4k paid social, and $13.0k YouTube. Per Mixpanel signup: $38.65 / $14.88 / $23.71. For signups Jun 4-Sep 1: per pre-approval start $209 / $282 / $103; offers per signup by Oct 1 0.108 / 0.029 / 0.083, so spend per offer $359 / $507 / $287. Paid social signups do tour (22.1% within 30 days vs 27.5% search and 26.3% YouTube; spend per touring signup $67 vs $141 and $90) but rarely bid (1.1% made an offer within 30 days vs 5.2% and 3.9%). A reasonable plan: grow YouTube (cheapest per pre-approval start and per offer), hold search (expensive per account, but its signups finance and bid), and cut or cap paid social to top-of-funnel reach, because its cheap accounts and cheap tours do not turn into buyers. Answers should flag small counts (54-132 pre-approval starts and 30-77 offers per channel; 12-23 accepted offers, too few to rank on) and that a 30-day window and in-window offers do not capture full buyer value.
- **Evidence:** H6-paid-social-economics; `-- STORY H6` (per offer), `-- EVAL Q6`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (CAC, cost per pre-approval start and per offer, `marketing_spend_daily`), 01-business.md (channels, revenue model).
- **Grading:** credit for joining warehouse spend to Mixpanel outcomes past signup and for caveats. Wrong: "move everything to paid social because it is cheapest" (per account or per tour); using `leads_reported` for CAC; ranking channels on accepted offers alone.

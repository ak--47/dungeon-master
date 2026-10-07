# Keystead Homes (real-estate) — 20-question eval

- **Data:** `data/verify-real-estate` (full fidelity: 10,000 shopper profiles, 9,747 with events, 4,443 new signups, 1,128,340 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/real-estate/real-estate.sql` on that data.
- **Stories:** ids refer to the `stories` export in `real-estate.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the August rate spike hurt offers?
- **Prompt:** "Mortgage rates jumped in August. Did that hurt our buyers' willingness to make offers, and by how much?"
- **Type:** external-join
- **Answer:** Yes. Touring did not change, but fewer completed tours turned into offers. On days when the 30-year conventional rate on the rate sheet was at its high (≥ 6.95%, Aug 16-Sep 14), **12.9% of completed tours got an offer within 14 days vs 19.0%** on baseline days before the climb (Jun 4-Aug 9, about 6.30%): **0.68x raw**, and **0.66x** after holding the pre-approved mix constant. It shows inside both groups: tours by pre-approved buyers 35.8% → 25.0% (0.70x), others 14.2% → 8.9% (0.63x). Weekly offer rates per tour ran 16-21% through the week of Aug 3 and 12-15% in the weeks of Aug 10 to Sep 7. Listing-page tour requests per saved home were flat across the spike (0.255 on high-rate days vs 0.259 on post-launch baseline days), so the effect is at the offer decision, not at touring. Offers fell from about 192 a week (Jul 20-Aug 16) to about 126 a week (Aug 17-Sep 13) and recovered to about 148 a week (Sep 14-27) as rates eased. Accept 0.58x-0.78x.
- **Evidence:** H1-rate-spike-cools-offers; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id` constant, 14-day window, breakdown `buyer_preapproved`, daily, joined to `mortgage_rate_sheet_daily.note_rate_pct` (conventional) by date; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (rate move dates), 04-metrics-and-tables.md (offer rate per tour, rate sheet table).
- **Grading:** must use a per-tour rate (not raw offer counts) and tie the drop to the rate days from the warehouse table. Wrong: "offers fell because tours fell" (tours per save did not move, and Tour It Now raised tour volume); comparing raw weekly offer counts without noting that Tour It Now lifted tours in late July.

### Q2 — Did Tour It Now work?
- **Prompt:** "We launched Tour It Now in July. Did it actually get more people into homes?"
- **Type:** trend
- **Answer:** Yes. Listing-page tour requests per saved home rose from **0.173 (Jun 4-Jul 14) to 0.258 (from Jul 22), 1.49x**. Tour It Now became **55% of listing-page requests** after the first week (4,669 Tour It Now bookings from Jul 22; none before Jul 15). Per saved home, scheduled listing-page requests fell from 0.173 to 0.116 while Tour It Now added 0.142, so about 40% of Tour It Now bookings replaced a scheduled tour and about 60% were new touring. Weekly, scheduled requests (all sources) went from about 790-880 before the launch to 660-780 after, while Tour It Now added 400-475. Completed tours rose from about 630-730 a week in June and early July to 910-1,020 a week from late July. Tour It Now tours also complete more often (87.5% vs 80.1% for scheduled since Jul 22). Accept 1.35x-1.65x.
- **Evidence:** H2-tour-it-now-launch; Insights, `tour requested` (request_source = listing_page) / `listing saved`, weekly, breakdown `booking_type`; `-- STORY H2`, `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch date, rollout week).
- **Grading:** must normalize by saves (or compare per week against the trend) and separate cannibalization from new tours. Wrong: counting every `tour_it_now` booking as lift (about 40% of them replaced a scheduled tour, so that overstates it); including agent-chat tours, which the launch did not touch.

### Q3 — How much does a pre-approval matter?
- **Prompt:** "How much more likely is a pre-approved buyer to make an offer after a tour?"
- **Type:** funnel
- **Answer:** About **2.5-2.6x**. Across all tours through Sep 17, **31.5% of tours by buyers with a Keystead pre-approval got an offer within 14 days vs 12.2%** for other buyers (2.58x). Before the rate climb (tours Jun 4-Aug 9) it was 35.8% vs 14.2% (2.52x); compared inside rate bands it is 2.61x. Just under a quarter of completed tours (23%) are by pre-approved buyers. Accept 2.2x-2.9x.
- **Evidence:** H3-preapproved-buyers-offer; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, breakdown `buyer_preapproved`; `-- STORY H3`, `-- EVAL Q3`.
- **Context needed:** 03-event-dictionary.md (`buyer_preapproved` is the status at tour time), 01-business.md (pre-approval, outside lenders).
- **Grading:** must compare per tour and use the tour-time flag. Wrong: comparing shoppers by current profile `preapproval_status` (letters expire and many approvals came after the tours); unique-shopper funnels.

### Q4 — Do saved searches keep new shoppers?
- **Prompt:** "The growth team thinks saved searches are the key habit for new shoppers. Is that true?"
- **Type:** retention
- **Answer:** Yes, strongly. Of 2,357 new shoppers who signed up Jun 4-Aug 6, **43.7% saved a search within 7 days**. **57.1% of them viewed a listing on day 28-55 after signup vs 27.0%** of new shoppers who did not (0.47x, or savers retain 2.1x as well). Accept a ratio of 0.42-0.55 (or 1.8x-2.4x the other way) with a complete bracket.
- **Evidence:** H4-saved-search-retention; Retention, birth `account created` (Jun 4-Aug 6), return `listing viewed`, custom bracket day 28-55, breakdown cohort "did `saved search created` within 7 days of signup"; `-- STORY H4`, `-- EVAL Q4`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (active shopper definition, retention).
- **Grading:** must exclude passive events (`listing alert sent` keeps firing for shoppers who left) and use complete brackets. Wrong: counting alerts as activity (makes savers look retained forever); including September signups.

### Q5 — Does agent response speed matter?
- **Prompt:** "Does it matter how fast our agents reply to a shopper's message?"
- **Type:** funnel
- **Answer:** Yes, a lot. For replies through Sep 24 (25,706), the share followed by a tour request on that home within 7 days falls with response time: **31.0% when the agent replied within 10 minutes, 20.2% at 10-60 minutes, 12.7% after an hour** (slow / fast = 0.41x). The median reply takes 20 minutes; 31% are within 10 minutes and 20% take over an hour, so the slow tail is a real opportunity. Accept a steady decline with slow/fast of 0.35-0.47.
- **Evidence:** H5-speed-to-lead; Funnels, `agent responded` → `tour requested`, Totals, hold `listing_id`, 7-day window, breakdown `response_minutes` (custom buckets); `-- STORY H5`, `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md (`response_minutes`), 01-business.md (goal 5).
- **Grading:** must analyze per reply and per home. Wrong: correlating each agent's average speed with their tour count (agents differ in volume); calling 10 minutes a hard cliff (the decline is smooth).

### Q6 — Which paid channel has the best CAC?
- **Prompt:** "Paid social gives us the cheapest new accounts. Is it really our most efficient channel?"
- **Type:** external-join
- **Answer:** Cheapest per account, not per buyer. Over the window, spend per Mixpanel signup was **$15.17 paid social, $24.72 YouTube, $36.79 paid search** (warehouse spend ÷ `account created` by channel). But paid social signups rarely move toward financing: among signups through Sep 1, **7.6% of paid social signups started a pre-approval within 30 days vs 19.7% for all other channels** (20.3% paid search, 21.3% YouTube; 0.39x). Spend per pre-approval start is **$197 paid social vs $183 paid search** (1.08x) and **$116 YouTube**. So paid social costs about the same as search per financing-ready buyer (slightly more), and YouTube is the cheapest on that measure. Accept per-signup CAC within 10% of these and a start-rate ratio of 0.30-0.55.
- **Evidence:** H6-paid-social-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `account created` → `pre-approval started`, 30-day window, breakdown `acquisition_channel`; `-- STORY H6`, `-- EVAL Q6`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, `marketing_spend_daily`), 01-business.md (channels).
- **Grading:** must join warehouse spend to Mixpanel signups and look past the signup. Wrong: using `leads_reported` as the denominator (platforms over-claim: $12.56 per claimed lead for social); "move budget to paid social" based on CAC alone. Note the small counts (76 paid social starts).

### Q7 — What happened in Austin in late August?
- **Prompt:** "Austin listing views fell off a cliff for a week in late August. Did Austin buyers lose interest?"
- **Type:** context
- **Answer:** No, it was the MLS feed. From Aug 24 to Aug 30 the Austin MLS import was stale (`feed_status = stale` in `market_inventory_daily`, zero new Austin listings, and no Austin listing alerts). Austin listing views fell to about **0.44x their normal share**: Austin views were 7.0% of other-market views on those days vs 16.0% in the 14 days either side (250-423 Austin views a day vs 591-980 around it). Views were back to normal on Aug 31, when the fix loaded the backlog. Other markets were not affected. Accept 0.40x-0.50x and attribution to the feed.
- **Evidence:** H7-austin-feed-outage; Insights `listing viewed` by `market`, daily, joined to `market_inventory_daily.feed_status`; `-- STORY H7`, `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (outage dates), 04-metrics-and-tables.md (`feed_status`).
- **Grading:** must name the feed outage and size it against the other markets. Wrong: "Austin demand fell"; comparing Austin to itself without a control across the late-August rate period.

### Q8 — Should we ship Payment Estimate?
- **Prompt:** "Is the Payment Estimate test getting more people pre-approved? Should we roll it out?"
- **Type:** funnel
- **Answer:** Yes. Of shoppers exposed Jul 29-Sep 17 (3,266 Control, 3,249 Payment Estimate), **11.3% in the variant started a pre-approval within 14 days vs 8.8% in Control (1.29x, z ≈ 3.4)**. 335 of the 720 variant applications since the start (47%) came from the estimate's link (`entry_point = payment_estimate`); Control has none. The split is balanced (50.0% variant). Recommend shipping. Accept a lift of 1.15x-1.5x.
- **Evidence:** H8-payment-estimate-experiment; Funnels `$experiment_started` → `pre-approval started`, 14-day window, breakdown `Experiment: Payment Estimate` (or the Experiments report); `-- STORY H8`, `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (start date, eligibility), 03-event-dictionary.md (`entry_point`).
- **Grading:** must compare arms on exposed shoppers after the start. Wrong: counting only `entry_point = payment_estimate` starts as the lift (some would have applied anyway); comparing weekly starts before and after Jul 29 for the whole site (about 145 a week both before and after, because only eligible shoppers are in the test and half of them see the variant).

### Q9 — How long from tour to offer?
- **Prompt:** "How long do buyers take to make an offer after a tour? Does it differ by type of buyer?"
- **Type:** funnel
- **Answer:** Median **50 hours** overall. By buyer type: **investors 24.5 h, move-up buyers 46.9 h, first-time buyers 85.7 h**, so first-time buyers take about **1.8x** as long as move-up buyers and investors about **0.5x**. Accept medians within 10% and the ordering investor < move_up < first_time.
- **Evidence:** H9-time-to-offer-by-buyer-type; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, median time to convert, breakdown `buyer_type`; `-- STORY H9`, `-- EVAL Q9`.
- **Context needed:** 01-business.md (buyer types).
- **Grading:** must measure tour to offer per home. Wrong: time from signup to first offer (mixes search length with decision speed).

### Q10 — Do price cuts drive saves?
- **Prompt:** "Do listings with a price cut get saved more?"
- **Type:** segmentation
- **Answer:** Yes. A view of a price-cut listing turns into a save **13.5% of the time vs 7.6%** at the original price (**1.77x**). Price-cut listings are 15.2% of views but 24.1% of saves. Accept 1.6x-2.0x.
- **Evidence:** H10-price-cuts-get-saved; Insights `listing saved` / `listing viewed`, breakdown `price_reduced`; `-- STORY H10`, `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`price_reduced` is as of the event).
- **Grading:** must use a per-view rate. Wrong: counting saves only (cut listings are fewer); using days on market as a stand-in.

### Q11 — How high did rates go?
- **Prompt:** "Walk me through what mortgage rates did this summer on our rate sheet."
- **Type:** external-join
- **Answer:** The 30-year conventional note rate averaged **6.30%** before Aug 10, climbed during the week of Aug 10, sat at **7.00%** (max 7.03%) from Aug 16 to Sep 14 (30 days at or above 6.95%), and eased to about **6.62%** from Sep 28. Other loan types moved in parallel: FHA 6.00% → 6.70%, VA 5.90% → 6.60%, jumbo 6.45% → 7.15%. Shoppers' quoted rates on approvals followed: median 6.25% before Aug 10 vs 7.00% Aug 17-Sep 13. Accept values within 0.05 points.
- **Evidence:** `-- EVAL Q11`, `-- EVAL Q15` (quoted rates); warehouse `mortgage_rate_sheet_daily`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (rate sheet).
- **Grading:** must use the warehouse table (rates are not on events except `rate_quoted_pct`). Wrong: reading `rate_quoted_pct` alone as the market rate (it includes borrower adjustments).

### Q12 — Are Tour It Now tours worse leads?
- **Prompt:** "Sales says Tour It Now brings tire-kickers — people who tour on a whim and never make an offer. Is that true?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. For tours completed Jul 22-Sep 17, **15.4% of Tour It Now tours got an offer within 14 days vs 16.0% of scheduled tours** (3,331 vs 4,984 tours, z ≈ -0.7). Within pre-approved buyers: 30.4% vs 30.0% (z ≈ 0.2); others: 10.8% vs 11.3% (z ≈ -0.7). Tour It Now tours are as likely to lead to offers as scheduled tours. Accept "no difference" with a gap under about 2 points overall.
- **Evidence:** `-- EVAL Q12`; Funnels `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, breakdown `booking_type`, date range Jul 22-Sep 17.
- **Context needed:** 02-timeline.md (launch), 04-metrics-and-tables.md (offer rate per tour).
- **Grading:** must test and report no difference. Wrong: inventing a quality gap; comparing all June-September tours (before the launch only scheduled tours existed, and rates changed mid-period).

### Q13 — Does the contact channel matter?
- **Prompt:** "Should we push shoppers toward call requests instead of chat? Do call requests convert to tours better?"
- **Type:** null-hypothesis
- **Answer:** No. Per agent contact (through Sep 23), the share followed by a tour request on that home within 7 days (the lead-response funnel window) is **22.1% for chat, 22.1% for call requests, and 22.4% for email** (chi-square 0.14 on 2 df, p ≈ 0.93). No market shows a significant difference either (largest chi-square 2.6 in Charlotte, p ≈ 0.27). What matters is how fast the agent replies (Q5), not the channel. Accept "no difference".
- **Evidence:** `-- EVAL Q13`; Funnels `agent contacted` → `tour requested`, Totals, hold `listing_id`, 7-day window, breakdown `contact_method`.
- **Context needed:** 03-event-dictionary.md (`contact_method`).
- **Grading:** must report no meaningful difference. Wrong: recommending a channel push based on a fraction-of-a-point gap.

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
- **Answer:** **2,489 applications started and 1,771 approved (71%)** in the window, about **145 starts a week**, steady before and after Jul 29 (144 vs 146 a week). Loan mix: conventional 63%, FHA 22%, VA 8%, jumbo 6%. At the end of the window 1,357 profiles hold a valid approval, 1,123 have an expired one, and 435 applied without approval. Volume is flat overall, although the Payment Estimate test lifts starts among exposed shoppers (Q8). Accept about 2,500 starts, a 69-74% approval rate, and a flat weekly trend.
- **Evidence:** `-- EVAL Q15`; Insights `pre-approval started` and `pre-approval completed`, weekly; profile `preapproval_status`.
- **Context needed:** 01-business.md (90-day letters, renewals), 03-event-dictionary.md.
- **Grading:** must give counts and the trend. Wrong: "the experiment doubled pre-approvals"; counting profile status as approvals in the window.

### Q16 — Are we growing?
- **Prompt:** "Is our active shopper base growing this summer?"
- **Type:** trend
- **Answer:** Yes, steadily. Weekly active shoppers (listing viewed or home search) rose from **3,949 (week of Jun 8) to 4,916 (week of Sep 21)**, about 24%. Monthly: **6,112 for Jun 4-30 (27 days, the window starts June 4), 6,673 in July, 7,168 in August, 7,592 in September**. Part of the June-to-July step is the shorter June. New accounts were steady at about 37 a day (1,017 for Jun 4-30, then 1,137, 1,169, and 1,093; about 260 a week); growth comes from new shoppers adding to a stable established base. Accept weekly and monthly figures within 3%.
- **Evidence:** `-- EVAL Q16`; Insights, unique `listing viewed` or `home search`, monthly and weekly; `account created` monthly.
- **Context needed:** 04-metrics-and-tables.md (active shopper definition), 00-manifest.md (identity, UTC).
- **Grading:** must exclude passive events and count unique shoppers, and treat June as a partial month (Jun 4-30) or use full weeks. Wrong: counting `listing alert sent` recipients as active; reading the June-to-July monthly step as pure growth; reporting October 1 as a month.

### Q17 — What should we worry about?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **Rates and offer demand**: offers per completed tour fell to about 0.66x on high-rate days (12.9% vs 19.0%); offers dropped from about 192 to 126 a week and only partly recovered (148) as rates eased (Q1, Q11). Another rate move would hit the same step.
  - **Paid social efficiency**: cheapest per account ($15.17) but 0.39x as likely to start a pre-approval; per start it costs about the same as search, slightly more (Q6).
  - **Agent response times**: 20% of replies take over an hour, and those convert to tours at 12.7% vs 31.0% within 10 minutes (Q5).
  - **New-shopper retention**: shoppers without a saved search in week one retain at about half the rate (27.0% vs 57.1%); 56% of new shoppers do not set one up in their first week (Q4).
  - **Feed reliability**: one stale MLS feed cost Austin more than half its views for a week (Q7, Q14).
  - Positives to keep: Tour It Now lifted listing-page tours per save 1.49x without worse tours (Q2, Q12); Payment Estimate lifts pre-approval starts 1.29x and should ship (Q8). Context: weekly active shoppers grew from 3,949 (week of Jun 8) to 4,916 (week of Sep 21); 738 offers accepted in the window.
- **Evidence:** H1, H4, H5, H6, H7, H2, H8; `-- EVAL Q17` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data. Penalize generic advice without numbers or claims the data do not support (for example "Tour It Now tours are low quality" or "chat converts worse than calls").

### Q18 — How many homes went under contract?
- **Prompt:** "How many of our buyers got an accepted offer this period, and what's our acceptance rate?"
- **Type:** segmentation
- **Answer:** **738 offers accepted** (730 buyers; a few had a backup offer also accepted) and 2,478 offers submitted in the window. Of the 2,435 offers submitted in the window that have an outcome, **29.9% were accepted** (a few acceptances are for offers submitted just before June 4). By market, acceptance ranges from 27.1% (Denver) to 35.4% (Nashville). Median accepted price **$349,500**; the median offer is 1.4% under list (offer-to-list 0.986). The most common rejection reason is being outbid (776 of 1,728 rejections, 45%). Accept counts within 2% and a rate of 29-31%.
- **Evidence:** `-- EVAL Q18`; Insights `offer accepted`, `offer rejected`, `offer submitted`, breakdown `market`, `rejection_reason`.
- **Context needed:** 01-business.md (under contract, closing later), 04-metrics-and-tables.md (acceptance rate, homes under contract).
- **Grading:** must define the rate on offers with an outcome. Wrong: calling accepted offers closings or revenue in the window (closings come 30-45 days later).

### Q19 — How much do people browse before signing up?
- **Prompt:** "How many listings do people look at before they create an account?"
- **Type:** segmentation
- **Answer:** On average **3.1 listings** (median 3) before `account created`. 18.1% sign up after one listing or none, and 36% look at four or more first. These views are anonymous (device only) until signup; Mixpanel links them to the account through the signup event, which carries both ids (18,357 of 18,359 anonymous events link; the other 2 come from a visitor who had not signed up by the end of the window). Accept an average of about 3 and the identity explanation.
- **Evidence:** `-- EVAL Q19`; Funnels `listing viewed` → `account created` or Insights on `listing viewed` before signup for new shoppers (identity merge on).
- **Context needed:** 00-manifest.md (identity notes).
- **Grading:** must count anonymous views linked to the account. Wrong: "zero" (counting only events with `user_id`); counting all views in the signup session after signup.

### Q20 — Where should next quarter's paid budget go?
- **Prompt:** "If we can move paid budget between search, social, and YouTube next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge channels on buyers, not accounts. Window spend was about $38.0k paid search, $20.0k paid social, and $12.5k YouTube. Per Mixpanel signup: $36.79 / $15.17 / $24.72. Per pre-approval start (signups through Sep 1): $183 / $197 / $116. Signups who completed a tour within 30 days: search 35.9%, social 27.2%, YouTube 32.9% (spend per touring signup $103 / $55 / $75); offers within 30 days 6.2% / 4.9% / 7.4%. A reasonable plan: grow YouTube (cheapest per pre-approval start with search-like engagement), hold search (expensive per account, but its signups are financing-ready), and keep paid social for top-of-funnel reach without growing it on CAC alone. Answers should flag small counts (76-157 pre-approval starts and about 28-49 offers per channel) and that a 30-day window and in-window offers do not capture full buyer value.
- **Evidence:** H6-paid-social-economics; `-- EVAL Q6`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (CAC, `marketing_spend_daily`), 01-business.md (channels, revenue model).
- **Grading:** credit for joining warehouse spend to Mixpanel outcomes past signup and for caveats. Wrong: "move everything to paid social because it is cheapest"; using `leads_reported` for CAC.

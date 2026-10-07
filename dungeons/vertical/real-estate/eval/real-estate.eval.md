# Keystead Homes (real-estate) — 20-question eval

- **Data:** `data/verify-real-estate` (full fidelity: 10,000 shopper profiles, 9,753 with events, 4,604 new signups, 1,054,029 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/real-estate/real-estate.sql` on that data.
- **Stories:** ids refer to the `stories` export in `real-estate.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the August rate spike hurt offers?
- **Prompt:** "Mortgage rates jumped in August. Did that hurt our buyers' willingness to make offers, and by how much?"
- **Type:** external-join
- **Answer:** Yes. Touring did not change, but fewer completed tours turned into offers. On days when the 30-year conventional rate on the rate sheet was at its high (≥ 6.95%, Aug 16-Sep 14), **14.1% of completed tours got an offer within 14 days vs 19.4%** on baseline days before the climb (Jun 4-Aug 9, about 6.30%): **0.73x raw**, and **0.71x** after holding the pre-approved mix constant. It shows inside both groups: tours by pre-approved buyers 35.5% → 24.6% (0.69x), others 14.2% → 10.4% (0.73x). Weekly offer rates per tour ran 18-22% through early August and 12-16% from the week of Aug 10. Listing-page tour requests per saved home were flat across the spike (0.262 vs 0.262), so the effect is at the offer decision, not at touring. Offers fell from about 178 a week (Jul 20-Aug 16) to about 130 a week (Aug 17-Sep 13) and recovered to about 145 a week as rates eased. Accept 0.62x-0.80x.
- **Evidence:** H1-rate-spike-cools-offers; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id` constant, 14-day window, breakdown `buyer_preapproved`, daily, joined to `mortgage_rate_sheet_daily.note_rate_pct` (conventional) by date; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (rate move dates), 04-metrics-and-tables.md (offer rate per tour, rate sheet table).
- **Grading:** must use a per-tour rate (not raw offer counts) and tie the drop to the rate days from the warehouse table. Wrong: "offers fell because tours fell" (tours per save did not move, and Tour It Now raised tour volume); comparing raw weekly offer counts without noting that Tour It Now lifted tours in late July.

### Q2 — Did Tour It Now work?
- **Prompt:** "We launched Tour It Now in July. Did it actually get more people into homes?"
- **Type:** trend
- **Answer:** Yes. Listing-page tour requests per saved home rose from **0.172 (Jun 4-Jul 14) to 0.260 (from Jul 22), 1.51x**. Tour It Now became **54% of listing-page requests** after the first week (4,309 bookings; none before Jul 15). Scheduled requests fell only modestly (about 800 a week before, 670-720 after) while Tour It Now added 400-460 a week, so most of it was new touring, not relabeled tours. Completed tours rose from about 640-720 a week in June and early July to 890-1,000 a week from late July. Tour It Now tours also complete more often (88.1% vs 80.6% for scheduled since Jul 22). Accept 1.35x-1.65x.
- **Evidence:** H2-tour-it-now-launch; Insights, `tour requested` (request_source = listing_page) / `listing saved`, weekly, breakdown `booking_type`; `-- STORY H2`, `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch date, rollout week).
- **Grading:** must normalize by saves (or compare per week against the trend) and separate cannibalization from new tours. Wrong: counting only `tour_it_now` bookings as the lift (most would be cannibalized); including agent-chat tours, which the launch did not touch.

### Q3 — How much does a pre-approval matter?
- **Prompt:** "How much more likely is a pre-approved buyer to make an offer after a tour?"
- **Type:** funnel
- **Answer:** About **2.4-2.5x**. Across all tours through Sep 17, **30.8% of tours by buyers with a Keystead pre-approval got an offer within 14 days vs 12.7%** for other buyers (2.42x). Before the rate climb (tours Jun 4-Aug 9) it was 35.5% vs 14.2% (2.51x); compared inside rate bands it is 2.44x. About a quarter of completed tours are by pre-approved buyers. Accept 2.2x-2.8x.
- **Evidence:** H3-preapproved-buyers-offer; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, breakdown `buyer_preapproved`; `-- STORY H3`, `-- EVAL Q3`.
- **Context needed:** 03-event-dictionary.md (`buyer_preapproved` is the status at tour time), 01-business.md (pre-approval, outside lenders).
- **Grading:** must compare per tour and use the tour-time flag. Wrong: comparing shoppers by current profile `preapproval_status` (letters expire and many approvals came after the tours); unique-shopper funnels.

### Q4 — Do saved searches keep new shoppers?
- **Prompt:** "The growth team thinks saved searches are the key habit for new shoppers. Is that true?"
- **Type:** retention
- **Answer:** Yes, strongly. Of 2,435 new shoppers who signed up Jun 4-Aug 6, **43.5% saved a search within 7 days**. **56.8% of them viewed a listing on day 28-55 after signup vs 29.5%** of new shoppers who did not (0.52x, or savers retain 1.9x as well). Accept a ratio of 0.45-0.58 (or 1.7x-2.2x the other way) with a complete bracket.
- **Evidence:** H4-saved-search-retention; Retention, birth `account created` (Jun 4-Aug 6), return `listing viewed`, custom bracket day 28-55, breakdown cohort "did `saved search created` within 7 days of signup"; `-- STORY H4`, `-- EVAL Q4`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (active shopper definition, retention).
- **Grading:** must exclude passive events (`listing alert sent` keeps firing for shoppers who left) and use complete brackets. Wrong: counting alerts as activity (makes savers look retained forever); including September signups.

### Q5 — Does agent response speed matter?
- **Prompt:** "Does it matter how fast our agents reply to a shopper's message?"
- **Type:** funnel
- **Answer:** Yes, a lot. For replies through Sep 24 (23,012), the share followed by a tour request on that home within 7 days falls with response time: **34.3% when the agent replied within 10 minutes, 22.0% at 10-60 minutes, 14.1% after an hour** (slow / fast = 0.41x). The median reply takes 20 minutes; 31% are within 10 minutes and 19% take over an hour, so the slow tail is a real opportunity. Accept a steady decline with slow/fast of 0.35-0.47.
- **Evidence:** H5-speed-to-lead; Funnels, `agent responded` → `tour requested`, Totals, hold `listing_id`, 7-day window, breakdown `response_minutes` (custom buckets); `-- STORY H5`, `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md (`response_minutes`), 01-business.md (goal 5).
- **Grading:** must analyze per reply and per home. Wrong: correlating each agent's average speed with their tour count (agents differ in volume); calling 10 minutes a hard cliff (the decline is smooth).

### Q6 — Which paid channel has the best CAC?
- **Prompt:** "Paid social gives us the cheapest new accounts. Is it really our most efficient channel?"
- **Type:** external-join
- **Answer:** Cheapest per account, not per buyer. Over the window, spend per Mixpanel signup was **$14.92 paid social, $23.60 YouTube, $37.45 paid search** (warehouse spend ÷ `account created` by channel). But paid social signups rarely move toward financing: among signups through Sep 1, **8.1% of paid social signups started a pre-approval within 30 days vs 17.3% for all other channels** (18.3% paid search, 16.3% YouTube; 0.47x). Spend per pre-approval start is **$186 paid social vs $205 paid search** (0.91x) and **$147 YouTube**. So paid social is about as expensive as search per financing-ready buyer, and YouTube is the cheapest on that measure. Accept per-signup CAC within 10% of these and a start-rate ratio of 0.35-0.55.
- **Evidence:** H6-paid-social-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `account created` → `pre-approval started`, 30-day window, breakdown `acquisition_channel`; `-- STORY H6`, `-- EVAL Q6`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, `marketing_spend_daily`), 01-business.md (channels).
- **Grading:** must join warehouse spend to Mixpanel signups and look past the signup. Wrong: using `leads_reported` as the denominator (platforms over-claim: $12.66 per claimed lead for social); "move budget to paid social" based on CAC alone. Note the small counts (81 paid social starts).

### Q7 — What happened in Austin in late August?
- **Prompt:** "Austin listing views fell off a cliff for a week in late August. Did Austin buyers lose interest?"
- **Type:** context
- **Answer:** No, it was the MLS feed. From Aug 24 to Aug 30 the Austin MLS import was stale (`feed_status = stale` in `market_inventory_daily`, zero new Austin listings, and no Austin listing alerts). Austin listing views fell to about **0.44x their normal share**: Austin views were 7.3% of other-market views on those days vs 16.6% in the 14 days either side (242-432 Austin views a day vs 444-1,085 around it). Views were back to normal on Aug 31, when the fix loaded the backlog. Other markets were not affected. Accept 0.40x-0.50x and attribution to the feed.
- **Evidence:** H7-austin-feed-outage; Insights `listing viewed` by `market`, daily, joined to `market_inventory_daily.feed_status`; `-- STORY H7`, `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (outage dates), 04-metrics-and-tables.md (`feed_status`).
- **Grading:** must name the feed outage and size it against the other markets. Wrong: "Austin demand fell"; comparing Austin to itself without a control across the late-August rate period.

### Q8 — Should we ship Payment Estimate?
- **Prompt:** "Is the Payment Estimate test getting more people pre-approved? Should we roll it out?"
- **Type:** funnel
- **Answer:** Yes. Of shoppers exposed Jul 29-Sep 17 (3,238 Control, 3,257 Payment Estimate), **11.6% in the variant started a pre-approval within 14 days vs 8.6% in Control (1.35x, z ≈ 4)**. 337 of the 739 variant applications since the start (46%) came from the estimate's link (`entry_point = payment_estimate`); Control has none. The split is balanced (50.3% variant). Recommend shipping. Accept a lift of 1.2x-1.5x.
- **Evidence:** H8-payment-estimate-experiment; Funnels `$experiment_started` → `pre-approval started`, 14-day window, breakdown `Experiment: Payment Estimate` (or the Experiments report); `-- STORY H8`, `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (start date, eligibility), 03-event-dictionary.md (`entry_point`).
- **Grading:** must compare arms on exposed shoppers after the start. Wrong: counting only `entry_point = payment_estimate` starts as the lift (some would have applied anyway); comparing weekly starts before and after Jul 29 for the whole site (about 140 a week both before and after, because only eligible shoppers are in the test and half of them see the variant).

### Q9 — How long from tour to offer?
- **Prompt:** "How long do buyers take to make an offer after a tour? Does it differ by type of buyer?"
- **Type:** funnel
- **Answer:** Median **52 hours** overall. By buyer type: **investors 23.7 h, move-up buyers 47.1 h, first-time buyers 86.2 h**, so first-time buyers take about **1.8x** as long as move-up buyers and investors about **0.5x**. Accept medians within 10% and the ordering investor < move_up < first_time.
- **Evidence:** H9-time-to-offer-by-buyer-type; Funnels, `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, median time to convert, breakdown `buyer_type`; `-- STORY H9`, `-- EVAL Q9`.
- **Context needed:** 01-business.md (buyer types).
- **Grading:** must measure tour to offer per home. Wrong: time from signup to first offer (mixes search length with decision speed).

### Q10 — Do price cuts drive saves?
- **Prompt:** "Do listings with a price cut get saved more?"
- **Type:** segmentation
- **Answer:** Yes. A view of a price-cut listing turns into a save **13.6% of the time vs 7.6%** at the original price (**1.78x**). Price-cut listings are 15.2% of views but 24.2% of saves. Accept 1.6x-2.0x.
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
- **Answer:** No meaningful difference. For tours completed Jul 22-Sep 17, **16.4% of Tour It Now tours got an offer within 14 days vs 15.9% of scheduled tours** (z ≈ 0.6). Within pre-approved buyers: 29.8% vs 27.2% (z ≈ 1.2); others: 12.4% vs 11.6% (z ≈ 0.9). Tour It Now tours are as likely to lead to offers as scheduled tours. Accept "no difference" with a gap under about 2 points overall.
- **Evidence:** `-- EVAL Q12`; Funnels `tour completed` → `offer submitted`, Totals, hold `listing_id`, 14-day window, breakdown `booking_type`, date range Jul 22-Sep 17.
- **Context needed:** 02-timeline.md (launch), 04-metrics-and-tables.md (offer rate per tour).
- **Grading:** must test and report no difference. Wrong: inventing a quality gap; comparing all June-September tours (before the launch only scheduled tours existed, and rates changed mid-period).

### Q13 — Does the contact channel matter?
- **Prompt:** "Should we push shoppers toward call requests instead of chat? Do call requests convert to tours better?"
- **Type:** null-hypothesis
- **Answer:** No. Per agent contact (through Sep 23), the share followed by a tour request on that home within 8 days is **24.2% for chat, 24.3% for call requests, and 24.9% for email** (chi-square 0.6 on 2 df, p ≈ 0.74). No market shows a significant difference either (largest chi-square 5.2 in Nashville, p ≈ 0.07). What matters is how fast the agent replies (Q5), not the channel. Accept "no difference".
- **Evidence:** `-- EVAL Q13`; Funnels `agent contacted` → `tour requested`, hold `listing_id`, breakdown `contact_method`.
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
- **Answer:** **2,415 applications started and 1,737 approved (72%)** in the window, about **140 starts a week**, steady before and after Jul 29 (140 vs 142 a week). Loan mix: conventional 61%, FHA 23%, VA 10%, jumbo 6%. At the end of the window 1,328 profiles hold a valid approval, 1,095 have an expired one, and 439 applied without approval. Volume is flat overall, although the Payment Estimate test lifts starts among exposed shoppers (Q8). Accept about 2,400 starts, a 70-75% approval rate, and a flat weekly trend.
- **Evidence:** `-- EVAL Q15`; Insights `pre-approval started` and `pre-approval completed`, weekly; profile `preapproval_status`.
- **Context needed:** 01-business.md (90-day letters, renewals), 03-event-dictionary.md.
- **Grading:** must give counts and the trend. Wrong: "the experiment doubled pre-approvals"; counting profile status as approvals in the window.

### Q16 — Are we growing?
- **Prompt:** "Is our active shopper base growing this summer?"
- **Type:** trend
- **Answer:** Yes, steadily. Monthly active shoppers (listing viewed or home search): **5,991 in June, 6,593 in July, 7,057 in August, 7,565 in September**. Weekly active shoppers rose from 3,766 (week of Jun 8) to 4,721 (week of Sep 21). New accounts were steady at 1,057-1,191 a month (about 265 a week); growth comes from new shoppers adding to a stable established base. Accept monthly figures within 3%.
- **Evidence:** `-- EVAL Q16`; Insights, unique `listing viewed` or `home search`, monthly and weekly; `account created` monthly.
- **Context needed:** 04-metrics-and-tables.md (active shopper definition), 00-manifest.md (identity, UTC).
- **Grading:** must exclude passive events and count unique shoppers. Wrong: counting `listing alert sent` recipients as active; reporting October 1 as a month.

### Q17 — What should we worry about?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **Rates and offer demand**: offers per completed tour fell to about 0.71x on high-rate days (14.1% vs 19.4%); offers dropped from about 178 to 130 a week and only partly recovered (145) as rates eased (Q1, Q11). Another rate move would hit the same step.
  - **Paid social efficiency**: cheapest per account ($14.92) but 0.47x as likely to start a pre-approval; per start it costs about the same as search (Q6).
  - **Agent response times**: 19% of replies take over an hour, and those convert to tours at 14% vs 34% within 10 minutes (Q5).
  - **New-shopper retention**: shoppers without a saved search in week one retain at about half the rate (29.5% vs 56.8%); 56% of new shoppers do not set one up in their first week (Q4).
  - **Feed reliability**: one stale MLS feed cost Austin more than half its views for a week (Q7, Q14).
  - Positives to keep: Tour It Now lifted listing-page tours per save 1.51x without worse tours (Q2, Q12); Payment Estimate lifts pre-approval starts 1.35x and should ship (Q8). Context: active shoppers grew from 5,991 (June) to 7,565 (September); 717 offers accepted in the window.
- **Evidence:** H1, H4, H5, H6, H7, H2, H8; `-- EVAL Q17` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data. Penalize generic advice without numbers or claims the data do not support (for example "Tour It Now tours are low quality" or "chat converts worse than calls").

### Q18 — How many homes went under contract?
- **Prompt:** "How many of our buyers got an accepted offer this period, and what's our acceptance rate?"
- **Type:** segmentation
- **Answer:** **717 offers accepted** (709 buyers; a few had a backup offer also accepted) out of 2,421 offers submitted. Of the 2,388 offers with an outcome in the window, **29.8% were accepted**. By market, acceptance ranges from 25.9% (Nashville) to 34.1% (Phoenix). Median accepted price **$343,000**; the median offer is 1.4% under list (offer-to-list 0.986). The most common rejection reason is being outbid (783 of 1,697 rejections, 46%). Accept counts within 2% and a rate of 29-31%.
- **Evidence:** `-- EVAL Q18`; Insights `offer accepted`, `offer rejected`, `offer submitted`, breakdown `market`, `rejection_reason`.
- **Context needed:** 01-business.md (under contract, closing later), 04-metrics-and-tables.md (acceptance rate, homes under contract).
- **Grading:** must define the rate on offers with an outcome. Wrong: calling accepted offers closings or revenue in the window (closings come 30-45 days later).

### Q19 — How much do people browse before signing up?
- **Prompt:** "How many listings do people look at before they create an account?"
- **Type:** segmentation
- **Answer:** On average **3.0 listings** (median 3) before `account created`. 18.5% sign up after one listing or none, and 33% look at four or more first. These views are anonymous (device only) until signup; Mixpanel links them to the account through the signup event, which carries both ids (18,646 of 18,656 anonymous events link; about 10 never do). Accept an average of about 3 and the identity explanation.
- **Evidence:** `-- EVAL Q19`; Funnels `listing viewed` → `account created` or Insights on `listing viewed` before signup for new shoppers (identity merge on).
- **Context needed:** 00-manifest.md (identity notes).
- **Grading:** must count anonymous views linked to the account. Wrong: "zero" (counting only events with `user_id`); counting all views in the signup session after signup.

### Q20 — Where should next quarter's paid budget go?
- **Prompt:** "If we can move paid budget between search, social, and YouTube next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge channels on buyers, not accounts. Window spend was about $37.4k paid search, $20.3k paid social, and $13.0k YouTube. Per Mixpanel signup: $37.45 / $14.92 / $23.60. Per pre-approval start (signups through Sep 1): $205 / $186 / $147. Signups who completed a tour within 30 days: search 33.6%, social 25.4%, YouTube 32.7% (spend per touring signup $112 / $59 / $73); offers within 30 days 5.8% / 4.1% / 4.7%. A reasonable plan: grow YouTube (cheapest per pre-approval start with search-like engagement), hold search (expensive per account, but its signups are financing-ready), and keep paid social for top-of-funnel reach without growing it on CAC alone. Answers should flag small counts (tens of starts and offers per channel) and that a 30-day window and in-window offers do not capture full buyer value.
- **Evidence:** H6-paid-social-economics; `-- EVAL Q6`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (CAC, `marketing_spend_daily`), 01-business.md (channels, revenue model).
- **Grading:** credit for joining warehouse spend to Mixpanel outcomes past signup and for caveats. Wrong: "move everything to paid social because it is cheapest"; using `leads_reported` for CAC.

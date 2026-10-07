# Kindred (dating) — 20-question eval

- **Data:** `data/verify-dating` (full fidelity: 10,000 members, 9,970 with events, 4,467 new signups, 957,663 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/dating/dating.sql` on that data.
- **Stories:** ids refer to the `stories` export in `dating.js` (H1-H10).
- **Periods:** "June" means June 4-30 (the window starts June 4); every other month is the full calendar month. October 1 is reported separately.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Is Verified Profiles cutting fake accounts?
- **Prompt:** "Trust & Safety launched Verified Profiles in July. Are we seeing fewer fake profiles and scammers since then?"
- **Type:** trend
- **Answer:** Yes. Reports with reason `fake_profile` or `scam` fell from **3.85 per 1,000 profile decisions** (likes + passes) before the 2026-07-14 launch to **1.74 per 1,000 from August 4 on**, about **0.45x** (−55%). The drop phases in over the weeks after launch (Monday weeks): 3.44-4.15 per 1,000 before launch, 3.51 in the launch week (Jul 13-19), 2.66 the week of Jul 20, 1.74 the week of Jul 27, then 1.47-2.13 every week from Aug 3 to the end of the window. Other report reasons did not move (4.88 → 4.71 per 1,000, 0.97x), so it is not a change in reporting overall. In raw counts fake/scam reports went from 585 (Jun 4-Jul 13) to 440 (Aug 4-Oct 1) even though the second period is longer and browsing grew. All reports run at about 8.7 per 1,000 decisions before launch. Accept 0.35x-0.55x and a decline over late July. Weekly rates swing by about ±15% from noise (40-70 reports a week).
- **Evidence:** H1-verified-profiles-launch; Insights, `profile reported` filtered `report_reason` in (fake_profile, scam), formula per 1,000 (`like sent` + `profile passed`), weekly; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date), 04-metrics-and-tables.md (report rate definition).
- **Grading:** must split reports by reason, normalize by browsing (or compare against the other reasons), and give the size. Wrong: raw report counts only; claiming all reports fell; comparing the launch week itself as "after".

### Q2 — How many members verified?
- **Prompt:** "How many members have verified their profile, and how fast did it happen?"
- **Type:** context
- **Answer:** **4,001 members verified**, **46.8%** of the 8,541 members who opened the app since launch (50.4% of members who joined before launch, 38.8% of members who joined after it). Verifications came in a wave over the first month (Monday weeks): 389 in the launch week (Jul 14-19), then 923, 1,014, and 729 in the following weeks, then 268 and 127 as the in-app prompts ran out, and a steady 89-105 a week from late August, mostly new members verifying during setup. Accept 42%-52% and the wave-then-steady shape.
- **Evidence:** H1-verified-profiles-launch (adoption); Insights, `selfie verified` uniques, weekly; profile property `verified`; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, in-app prompt, new-member offer), 04-metrics-and-tables.md (verification rate).
- **Grading:** denominator must be members active after launch. Wrong: share of all 10,000 profiles (40%); counting verifications before July 14 (there are none); "adoption keeps growing".

### Q3 — Is there an ideal number of photos?
- **Prompt:** "Do members with more photos get more matches? What's the ideal number of photos?"
- **Type:** segmentation
- **Answer:** **4-6 photos is the sweet spot**, not "more is better". Matches per like: 1 photo 10.2%, 2 photos 10.4%, 3 photos 16.8%, 4 photos 21.8%, 5 photos 21.8%, 6 photos 22.1%, 7 photos 17.8%, 8 photos 17.8%, 9 photos 16.8%. Grouped: 1-2 photos 10.3% (**0.47x** of 4-6), 3 photos 16.8% (0.77x), 4-6 photos 21.9%, 7-9 photos 17.6% (**0.80x**). Accept a peak at 4-6 photos with 1-2 at 0.40x-0.55x and 7-9 at 0.72x-0.88x of the peak.
- **Evidence:** H2-photo-count-sweet-spot; Insights, `match created` / `like sent`, breakdown user property `photo_count`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 03-event-dictionary.md (`photo_count`), 04-metrics-and-tables.md (match rate).
- **Grading:** must use a rate per like (not matches per member) and name the drop above 6. Wrong: "more photos is always better"; matches per member (driven by how much people like).

### Q4 — Are Sparks worth it?
- **Prompt:** "Do Sparks actually work better than a normal like?"
- **Type:** segmentation
- **Answer:** Yes. A Spark becomes a match **51.4%** of the time vs **17.3%** for a standard like, about **3.0x**. The ratio is about the same on every plan (Free 52.4% vs 17.4%, Kindred+ 50.8% vs 17.4%, Premier 50.5% vs 16.9%); paid members just send more of them (Sparks are 2.9% of Free members' likes, 7.0% on Kindred+, 11.9% on Premier). Accept 2.7x-3.3x.
- **Evidence:** H3-sparks-match-rate; Insights, `match created` where `match_source` = spark ÷ `like sent` where `like_type` = spark, vs the same for standard likes; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`like_type`, `match_source`).
- **Grading:** must compare per-like match rates by like type. Wrong: comparing matches per member for Spark users vs others (confounded by plan and activity).

### Q5 — Should we ship Icebreakers?
- **Prompt:** "Is the Icebreakers test working? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes, it works. For matches from 2026-07-22 to Sep 24 (each with a full 7-day window), **73.8% of Icebreakers matches got an opener within 7 days vs 58.6% in Control (1.26x, z ≈ 25)**, and the median time from match to opener fell from **13.4 to 8.6 hours (0.64x)**. 44.1% of Icebreakers openers used a suggestion; Control has none. The split is balanced (3,214 Control vs 3,239 Icebreakers exposed members). It also carries through to dates (see Q13). Recommend shipping. Accept a lift of 1.15x-1.40x and a time ratio of 0.5-0.75.
- **Evidence:** H4-icebreakers-experiment; Funnels, `match created` → `conversation started`, Totals counting, hold `match_id` constant, 7-day window, date range Jul 22 - Sep 24, breakdown `Experiment: Icebreakers` (or the Experiments report on `$experiment_started`); `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (start date, arms), 03-event-dictionary.md (`hours_since_match`, `opener_type`).
- **Grading:** must compare arms per match after the start and report both conversion and speed. Wrong: unique-member funnels as the headline (92.5% vs 85.9% of members, 1.08x; most members open at least one match either way, which understates the per-match effect); including matches before July 22; using `opener_type = icebreaker` as the treatment group (only some variant openers use a suggestion).

### Q6 — What happens after a good date?
- **Prompt:** "Our best outcome is members meeting someone great. What happens to members after a good date? Are we losing them?"
- **Type:** retention
- **Answer:** Yes: a good date takes many members off the app. Among members whose first date feedback (Jun 4-Sep 3) was **4-5 stars, 48.7%** opened the app in days 14-27 afterwards vs **84.9%** after a **1-3 star** first date (**0.57x**). By rating: 1★ 83.1%, 2★ 84.0%, 3★ 85.8%, 4★ 47.1%, 5★ 50.7%. It shows up in billing too: `met_someone` is the top cancellation reason (621 of 1,421 cancellations, 44%), on both paid plans (433 Kindred+, 188 Premier). This is "success churn": the product works, and the member leaves. Accept 0.47x-0.65x.
- **Evidence:** H5-success-churn; Retention, birth `date feedback submitted` (first time), breakdown `rating`, return `app opened`, custom bracket day 14-27; `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (north star is dates), 03-event-dictionary.md (`rating`, `cancel_reason`), 04-metrics-and-tables.md (active member excludes matches).
- **Grading:** must split by rating and frame it as success, not failure. Wrong: "bad dates drive churn" (the opposite); counting matches or exposures as activity; including feedback from September when the bracket is not complete.

### Q7 — Which paid channel has the best CAC?
- **Prompt:** "Which paid channel gives us the cheapest new members? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is cheapest per signup but not per real member. Window spend per Mixpanel signup (warehouse `paid_acquisition_daily`): **TikTok $6.90, Meta $13.61, Apple Search Ads $23.00** (TikTok ≈ 0.30x Apple). But only **36.6%** of TikTok signups finish their profile vs about 70% elsewhere, so **cost per completed profile is $18.86 TikTok vs $19.87 Meta (≈0.95x)** and $33.61 Apple Search Ads. Per new subscriber (small counts): TikTok $79 (87 subscribers), Meta $92 (153), Apple Search Ads $152 (88). Spend: Meta $14,046, Apple $13,342, TikTok $6,903. Accept TikTok per-signup 0.26x-0.35x of Apple and TikTok ≈ Meta per completed profile (0.85x-1.15x).
- **Evidence:** H6-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_acquisition_daily.spend_usd`; Funnels profile setup by channel; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `installs_reported` as the denominator (networks over-claim, e.g. TikTok 1,168 claimed vs 1,001 signups); stopping at "TikTok is 3x cheaper".

### Q8 — Where do signups drop in setup?
- **Prompt:** "Too many signups never finish their profile. Where do they drop, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall **62.5%** of new members complete their profile within 7 days. The gap is **TikTok**: 68.0% of TikTok signups upload photos and **36.6%** complete the profile, vs 85.4% and **69.9%** for every other channel (**0.52x**). TikTok is about 22% of signups (1,001 of 4,467). The other channels are all close to 68-72% (Apple Search Ads 68.5%, Meta 68.5%, organic 71.1%, referral 71.5%). Members who do not finish browse for a few days, never like or chat (they cannot without a complete profile), and leave. Accept TikTok 0.44x-0.58x of the rest.
- **Evidence:** H6-paid-channel-economics; Funnels `account created` → `photos uploaded` → `profile completed`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q8` and `-- STORY H6`.
- **Context needed:** 03-event-dictionary.md (setup events), 04-metrics-and-tables.md (profile completion).
- **Grading:** must break down by acquisition channel. Wrong: blaming platform (no meaningful gap; see Q15); only reporting the overall rate.

### Q9 — What happened to messaging in late August?
- **Prompt:** "Messages sent dropped for about a week at the end of August. What happened, and how big was it?"
- **Type:** external-join
- **Answer:** The **chat incident, August 24-30** (timeline), and it hit **Android only**: `chat_delivery_daily` shows `service_status = major_outage` for android on those seven days, with `delivery_failure_rate` ≈ 0.60 vs about 0.006 normally, and a platform breakdown of `message sent` shows the same. In Mixpanel, Android `message sent` fell to **0.42x** of its normal level relative to iOS (Android/iOS ratio 0.32 on incident days vs 0.78 in the 14 days either side); iOS was unaffected. That is about **1,560 Android messages missing from Mixpanel** over the seven days; the chat service logged 2,353 failed sends (its counts include automated messages and members who opted out of analytics). Volume was back to normal on August 31. Accept 0.33x-0.50x and naming Android. Daily Android/iOS ratios swing by about ±15% from noise, so read the whole week.
- **Evidence:** H7-android-chat-incident; Insights `message sent`, daily, breakdown `platform`, joined to `chat_delivery_daily`; `-- STORY H7` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`chat_delivery_daily`).
- **Grading:** must find the platform (the timeline does not name it) from a platform breakdown or the warehouse table, give the dates, and use iOS (or the baseline) as the comparison. Wrong: "members lost interest"; reading the dip from total messages without the platform split; blaming the price change (Aug 18).

### Q10 — Did the Kindred+ price increase pay off?
- **Prompt:** "We raised Kindred+ prices on August 18. Did it hurt sales? Did it pay off?"
- **Type:** external-join
- **Answer:** It hurt more than it earned. Kindred+ purchases per paywall view fell from **6.36% to 4.32% (0.68x)**. Paywall traffic is steady (about 233 views a day both before and after the change; 238 in June, 229 in the four weeks before, 233 in the four weeks after, 236 in September), so the drop is conversion, not traffic. Prices rose about 17% (warehouse `list_price_usd`), so Kindred+ list-price bookings per paywall view fell to **0.80x** ($3.48 → $2.78 per view); billing shows Kindred+ bookings at $836 a day before vs $688 after. Premier conversion did not change (see Q14). Verdict: the price rise did not pay for the lost buyers. Accept a conversion ratio of 0.55-0.80 and bookings per view below about 0.9.
- **Evidence:** H8-plus-price-change; Insights `subscription started` (plan = plus) / `paywall viewed`, before vs after Aug 18, joined to `subscription_bookings_daily.list_price_usd`; `-- STORY H8` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (date, prices), 01-business.md (plans), 04-metrics-and-tables.md (`subscription_bookings_daily`).
- **Grading:** must normalize by paywall views (or traffic) and bring in price for the revenue verdict. Wrong: "revenue per subscription went up, so it worked"; raw subscription counts (the after period is 45 days, the before period 75); claiming Premier sales fell; tying cancellations to the price change. Monthly cancellation counts rise through the window (256 in June, 336, 410, 408 in September), but the weekly cancellation rate per paid member stays near 4.5% in every month (4.3%-4.5%): the paid base grows. Existing subscribers keep their old price, so the price change cannot drive their cancellations (`-- EVAL Q19`).

### Q11 — How long from first message to a date?
- **Prompt:** "Once members start chatting, how long does it take to plan a date? Does it depend on what they're looking for?"
- **Type:** funnel
- **Answer:** The median time from opener to date plan is **74.8 hours** (about 3 days; 90.9 hours from match to date plan). It depends on relationship goal: **long_term 106.0 h (about 1.5x)**, long_term_open 70.7 h, figuring_it_out 71.8 h, **short_term_fun 42.5 h (about 0.6x)**. Accept long_term 1.35x-1.65x and short_term_fun 0.54x-0.66x of the other two goals.
- **Evidence:** H9-date-speed-by-goal; Funnels `conversation started` → `date planned`, Totals counting, hold `match_id` constant, 30-day window, openers Jun 4 - Aug 31, median time to convert, breakdown `relationship_goal`; `-- STORY H9` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (relationship goals), 04-metrics-and-tables.md (time to date).
- **Grading:** must hold `match_id` constant and report medians by goal. Wrong: uniques funnels across all of a member's matches (pairs unrelated matches); means dominated by long tails.

### Q12 — Does replying fast matter?
- **Prompt:** "Does it matter how fast someone sends the first message after a match?"
- **Type:** funnel
- **Answer:** Yes. Per conversation, openers sent within 24 hours of the match lead to a planned date **32.0%** of the time vs **16.6%** for openers sent later (**0.52x**). Finer: 0-6 h 33.7%, 6-12 h 33.1%, 12-18 h 30.5%, 18-24 h 25.6%, 24-36 h 20.5%, 36-48 h 15.5%, 48 h+ 14.2%. Speed barely matters in the first half day; the chance then falls steadily through the second day and levels off near 14% after two days. Accept a 0.43x-0.58x gap at 24 h with Totals counting, and a decline concentrated between about 12 and 48 hours.
- **Evidence:** H10-fast-openers; Funnels `conversation started` → `date planned`, Totals counting, hold `match_id` constant, 30-day window, openers Jun 4 - Aug 31, breakdown `hours_since_match` custom buckets; `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 03-event-dictionary.md (`hours_since_match`), 04-metrics-and-tables.md (date rate).
- **Grading:** must compare conversations by opener speed and describe where the drop happens (mostly 12-48 h, little change before 12 h or after 48 h). A Uniques funnel (a member counts once per bucket) reads 57.2% vs 25.3% (0.44x); accept it only if the analyst names the counting mode, since members with many conversations inflate both buckets. Wrong: "faster is always better" with a straight-line story; a hard cliff exactly at 24 h; using openers from September (incomplete windows).

### Q13 — Did Icebreakers lead to more dates?
- **Prompt:** "Icebreakers gets people talking, but does it get them on dates?"
- **Type:** funnel
- **Answer:** Yes. For matches from Jul 22 to Aug 31 (full 30-day window), **21.3%** of Icebreakers matches led to a planned date within 30 days vs **16.0%** in Control (**1.33x**). The lift compounds two effects: more matches get an opener (Q5), and the openers come faster, and faster openers plan more dates (Q12). Accept 1.20x-1.50x.
- **Evidence:** H4-icebreakers-experiment with H10-fast-openers; Funnels `match created` → `date planned`, Totals counting, hold `match_id` constant, 30-day window, matches Jul 22 - Aug 31, breakdown `Experiment: Icebreakers`; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (test), 03-event-dictionary.md.
- **Grading:** must measure dates by arm per match (Totals counting with `match_id` held constant). A Uniques funnel reads 45.7% vs 36.8% of matched members (1.24x); accept it if the analyst says it counts members, not matches. Wrong: "no effect on dates"; counting only matches with an opener; including matches from September (incomplete windows).

### Q14 — Did the price change hurt Premier too? (null)
- **Prompt:** "When Kindred+ got more expensive in August, did Premier sales suffer too, or did people trade up?"
- **Type:** null-hypothesis
- **Answer:** **Neither.** Premier purchases per paywall view were **2.50% before August 18 (437 of 17,489 views) and 2.45% after (257 of 10,484)**, z ≈ −0.25. The same holds on each platform (Android 2.46% → 2.34%, z ≈ −0.4; iOS 2.53% → 2.54%, z ≈ 0.0). Premier daily bookings in the warehouse are about the same ($577 → $549 a day). Accept "no meaningful change" (no trade-up and no spillover).
- **Evidence:** `-- EVAL Q14`; Insights `subscription started` (plan = premier) / `paywall viewed`, before vs after Aug 18, breakdown `platform`; `subscription_bookings_daily` (`-- EVAL Q10`).
- **Context needed:** 02-timeline.md (Premier prices unchanged), 01-business.md (plans).
- **Grading:** must normalize by paywall views and treat the gap as noise. Wrong: "Premier sales fell" from raw counts (the periods have different lengths); "members traded up to Premier".

### Q15 — Is Android onboarding worse? (null)
- **Prompt:** "Is our Android onboarding worse than iOS? Should we prioritize fixing Android setup?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day profile completion is **63.3% on Android vs 61.8% on iOS** (z ≈ 1.0, p ≈ 0.3). It holds within channel groups: non-TikTok 70.7% vs 69.4% (z ≈ 0.8), TikTok 37.5% vs 35.8% (z ≈ 0.5). The setup gap is about acquisition channel (Q8), not platform. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q15`; Funnels profile setup, 7-day window, breakdown `platform`.
- **Context needed:** 03-event-dictionary.md (`platform`), 04-metrics-and-tables.md.
- **Grading:** must check the data and treat the gap as noise. Wrong: "Android is worse" (or better) without a significance check; pointing to the August chat incident (unrelated to setup).

### Q16 — Do men and women match at different rates?
- **Prompt:** "How do match rates differ between men and women on Kindred?"
- **Type:** segmentation
- **Answer:** Women's likes become matches about twice as often: **women 26.7%, men 13.4%, nonbinary members 19.0%** of likes (women 2.0x men). Members like at a similar pace (25.7-28.0 likes per member in the window), so the gap is in how often likes are returned. Accept women about 1.8x-2.2x men.
- **Evidence:** `-- EVAL Q16`; Insights `match created` / `like sent`, breakdown user property `gender`.
- **Context needed:** 01-business.md (gender and seeking), 04-metrics-and-tables.md (match rate).
- **Grading:** must use per-like rates. Wrong: total matches by gender (men are the larger group).

### Q17 — How big is the paying base?
- **Prompt:** "How many paying members do we have, and how much did we book from new subscriptions this period?"
- **Type:** context
- **Answer:** At the end of the window **21.8%** of members are on a paid plan: **1,509 on Kindred+ (15.1%) and 672 on Premier (6.7%)**; 7,819 are on Free. In the window Mixpanel recorded **2,260 new subscriptions** from 2,197 members (some cancelled and subscribed again): Kindred+ 1,566 (926 monthly, 416 three-month, 224 six-month) and Premier 694 (394 monthly, 191 three-month, 109 six-month), and 1,421 cancellations. Billing counts 2,363 new subscriptions (store purchases that never reach Mixpanel, net of same-day refunds) and **$161,621 in gross bookings** at list price (Kindred+ $93,679, Premier $67,943). Accept bookings from the warehouse and current plan shares from profiles.
- **Evidence:** `-- EVAL Q17`; profile `subscription_plan`; Insights `subscription started` by `plan` and `billing_period`; `subscription_bookings_daily`.
- **Context needed:** 01-business.md (plans, billing periods), 04-metrics-and-tables.md (bookings, caveats).
- **Grading:** must take bookings from the warehouse (Mixpanel has no prices) and explain the small Mixpanel vs billing gap. Wrong: multiplying Mixpanel subscriptions by a single price; treating `subscription_plan` on old events as the current plan.

### Q18 — When are members active?
- **Prompt:** "When during the week and day are members most active? When should we send our Sunday push?"
- **Type:** trend
- **Answer:** **Sunday is the busiest day** (1.17x an average day), followed by Monday (1.05x) and Thursday (1.04x); **Friday (0.86x) and Saturday (0.88x)** are the quietest. By hour, activity peaks between **22:00 and 03:00 UTC** (US evenings; 01:00 UTC is the top hour). A Sunday-evening US push lands around 23:00-01:00 UTC. Accept Sunday peak, Friday/Saturday low, and a late-evening US peak expressed in UTC.
- **Evidence:** `-- EVAL Q18`; Insights all events, breakdown day of week and hour (project time zone UTC).
- **Context needed:** 00-manifest.md (UTC, US time zones).
- **Grading:** must convert to US time or say UTC explicitly. Wrong: "Saturday night is busiest"; reading UTC hours as local hours.

### Q19 — What should we worry about this quarter?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **Kindred+ pricing**: purchases per paywall view down to 0.68x since Aug 18 and bookings per view 0.80x; consider reverting or testing a lower price (Q10).
  - **TikTok signups do not finish setup** (36.6% vs 69.9%); cheap installs are not cheap members (Q7, Q8).
  - **Success churn**: members leave after good dates (49% vs 85% D14-27); `met_someone` is the top cancel reason (44%). Plan for it (referrals, win-back when relationships end) rather than "fix" it (Q6).
  - **Android reliability**: the Aug 24-30 incident cut Android messages to 0.42x for a week (Q9).
  - Positives to keep: Icebreakers lifts openers 1.26x and dates 1.33x and should ship (Q5, Q13); Verified Profiles cut fake/scam reports to 0.45x (Q1).
  - Context: monthly active members grew from 6,012 (June) to 7,318 (September); about 1,000-1,180 signups a month; new subscriptions ran 536 in June, 651 in July, 590 in August, and 466 in September, after the price change. The paid base grew from about 1,480 to 2,140 members; cancellations rose with it (256, 336, 410, 408 a month) while the weekly cancellation rate held near 4.5% (4.48%, 4.27%, 4.52%, 4.45%).
- **Evidence:** H4, H5, H6, H7, H8, H1; `-- EVAL Q19` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data. Penalize generic advice without numbers, or claims the data does not support (for example "cancellations are accelerating because of the price change": the rate per paid member is flat, and existing subscribers kept their price).

### Q20 — Where should next quarter's marketing budget go?
- **Prompt:** "If we can move paid budget between Meta, TikTok, and Apple Search Ads next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge on members who complete a profile (or subscribe), not installs. Current daily spend is about $117 Meta, $111 Apple Search Ads, $58 TikTok. Cost per completed profile is about $19-20 for both TikTok and Meta and $34 for Apple Search Ads; cost per new subscriber (small counts) is roughly $79 TikTok, $92 Meta, $152 Apple. Network-reported cost per install looks very different ($5.91 TikTok, $11.61 Meta, $18.63 Apple) because networks over-claim installs. A reasonable plan: trim Apple Search Ads (most expensive per real member), keep Meta, and grow TikTok together with an onboarding fix for TikTok signups (only 8.7% of TikTok signups subscribe vs about 15% from other channels, on just 87 subscribers). Answers should note small subscriber counts and that the window measures 7-day setup and in-window purchases, not lifetime value.
- **Evidence:** H6-paid-channel-economics; `-- EVAL Q7`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, `paid_acquisition_daily`), 01-business.md (channels).
- **Grading:** credit for using Mixpanel signups and completion with warehouse spend, and for caveats. Wrong: "move everything to TikTok because installs are cheapest"; using `installs_reported` for CAC.

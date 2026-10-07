# Kindred (dating) — 20-question eval

- **Data:** `data/verify-dating` (full fidelity: 10,000 members, 9,976 with events, 4,517 new signups, 767,879 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/dating/dating.sql` on that data.
- **Stories:** ids refer to the `stories` export in `dating.js` (H1-H10).
- **Periods:** "June" means June 4-30 (the window starts June 4); every other month is the full calendar month. October 1 is reported separately.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Is Verified Profiles cutting fake accounts?
- **Prompt:** "Trust & Safety launched Verified Profiles in July. Are we seeing fewer fake profiles and scammers since then?"
- **Type:** trend
- **Answer:** Yes. Reports with reason `fake_profile` or `scam` fell from **2.95 per 1,000 profile decisions** (likes + passes) before the 2026-07-14 launch to **1.40 per 1,000 from August 4 on**, about **0.47x** (−53%). The drop phases in over the weeks after launch: weekly rates of 2.45-3.42 per 1,000 before launch, 3.16 in the launch week (Jul 13-19), 2.14 the week of Jul 20, 1.96 the week of Jul 27, then 0.90-1.89 from the week of Aug 3. Other report reasons did not move (3.90 → 4.03 per 1,000, 1.03x), so it is not a change in reporting overall. In raw counts fake/scam reports went from 382 (Jun 4-Jul 13) to 286 (Aug 4-Oct 1) even though the second period is longer and browsing grew. All reports run at about 7 per 1,000 decisions before launch. Accept 0.35x-0.55x and a decline over late July. Weekly rates swing by about ±20% from noise (a few dozen reports a week).
- **Evidence:** H1-verified-profiles-launch; Insights, `profile reported` filtered `report_reason` in (fake_profile, scam), formula per 1,000 (`like sent` + `profile passed`), weekly; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date), 04-metrics-and-tables.md (fake-account report rate definition).
- **Grading:** must normalize by browsing (or compare against the other reasons) and give the size. Wrong: raw report counts only; claiming all reports fell; comparing the launch week itself as "after".

### Q2 — How many members verified?
- **Prompt:** "How many members have verified their profile, and how fast did it happen?"
- **Type:** context
- **Answer:** **3,586 members verified**, **46.5%** of the 7,713 members who opened the app since launch (47.7% of members who joined before launch, 42.2% of members who joined after it). Verifications came in a wave over the first month: 311 in the launch week (Jul 14-19), then 728, 995, and 750 in the following weeks, then 315 and 137 as the in-app prompts ran out, and a steady 50-85 a week from late August, mostly new members verifying during setup. Accept 42%-52% and the wave-then-steady shape.
- **Evidence:** H1-verified-profiles-launch (adoption); Insights, `selfie verified` uniques, weekly; profile property `verified`; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, in-app prompt, new-member offer), 04-metrics-and-tables.md (verification rate).
- **Grading:** denominator must be members active after launch. Wrong: share of all 10,000 profiles (36%); counting verifications before July 14 (there are none); "adoption keeps growing".

### Q3 — Is there an ideal number of photos?
- **Prompt:** "Do members with more photos get more matches? What's the ideal number of photos?"
- **Type:** segmentation
- **Answer:** **4-6 photos is the sweet spot**, not "more is better". Matches per like: 1 photo 9.5%, 2 photos 9.4%, 3 photos 16.0%, 4 photos 21.4%, 5 photos 21.1%, 6 photos 20.8%, 7 photos 16.5%, 8 photos 18.0%, 9 photos 17.3%. Grouped: 1-2 photos 9.4% (**0.45x** of 4-6), 3 photos 16.0% (0.76x), 4-6 photos 21.1%, 7-9 photos 17.2% (**0.81x**). Accept a peak at 4-6 photos with 1-2 at 0.40x-0.55x and 7-9 at 0.72x-0.88x of the peak.
- **Evidence:** H2-photo-count-sweet-spot; Insights, `match created` / `like sent`, breakdown user property `photo_count`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 03-event-dictionary.md (`photo_count`), 04-metrics-and-tables.md (match rate).
- **Grading:** must use a rate per like (not matches per member) and name the drop above 6. Wrong: "more photos is always better"; matches per member (driven by how much people like).

### Q4 — Are Sparks worth it?
- **Prompt:** "Do Sparks actually work better than a normal like?"
- **Type:** segmentation
- **Answer:** Yes. A Spark becomes a match **49.3%** of the time vs **16.4%** for a standard like, about **3.0x**. The ratio is about the same on every plan (Free 48.4% vs 16.3%, Kindred+ 50.2% vs 16.7%, Premier 50.1% vs 16.6%); paid members just send more of them (Sparks are 3.5% of Free members' likes, 7.0% on Kindred+, 12.1% on Premier). Accept 2.7x-3.3x.
- **Evidence:** H3-sparks-match-rate; Insights, `match created` where `match_source` = spark ÷ `like sent` where `like_type` = spark, vs the same for standard likes; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`like_type`, `match_source`).
- **Grading:** must compare per-like match rates by like type. Wrong: comparing matches per member for Spark users vs others (confounded by plan and activity).

### Q5 — Should we ship Icebreakers?
- **Prompt:** "Is the Icebreakers test working? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes, it works. For matches from 2026-07-22 to Sep 24 (each with a full 7-day window), **74.1% of Icebreakers matches got an opener within 7 days vs 58.6% in Control (1.26x, z ≈ 22)**, and the median time from match to opener fell from **13.7 to 8.4 hours (0.61x)**. 45.1% of Icebreakers openers used a suggestion; Control has none. The split is balanced (2,464 Control vs 2,542 Icebreakers exposed members). It also carries through to dates (see Q13). Recommend shipping. Accept a lift of 1.15x-1.40x and a time ratio of 0.5-0.7.
- **Evidence:** H4-icebreakers-experiment; Funnels, `match created` → `conversation started`, Totals counting, hold `match_id` constant, 7-day window, date range Jul 22 - Sep 24, breakdown `Experiment: Icebreakers` (or the Experiments report on `$experiment_started`); `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (start date, arms), 03-event-dictionary.md (`hours_since_match`, `opener_type`).
- **Grading:** must compare arms per match after the start and report both conversion and speed. Wrong: unique-member funnels as the headline (92.0% vs 84.3% of members, 1.09x; most members open at least one match either way, which understates the per-match effect); including matches before July 22; using `opener_type = icebreaker` as the treatment group (only some variant openers use a suggestion).

### Q6 — What happens after a good date?
- **Prompt:** "Our best outcome is members meeting someone great. What happens to members after a good date? Are we losing them?"
- **Type:** retention
- **Answer:** Yes: a good date takes many members off the app. Among members whose first date feedback (Jun 4-Sep 3) was **4-5 stars, 45.2%** opened the app in days 14-27 afterwards vs **80.6%** after a **1-3 star** first date (**0.56x**). By rating: 1★ 85.7%, 2★ 81.2%, 3★ 78.9%, 4★ 45.8%, 5★ 44.5%. It shows up in billing too: `met_someone` is the top cancellation reason (480 of 1,157 cancellations, 41%), on both paid plans (318 Kindred+, 162 Premier). This is "success churn": the product works, and the member leaves. Accept 0.47x-0.65x.
- **Evidence:** H5-success-churn; Retention, birth `date feedback submitted` (first time), breakdown `rating`, return `app opened`, custom bracket day 14-27; `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (north star is dates), 03-event-dictionary.md (`rating`, `cancel_reason`), 04-metrics-and-tables.md (active member excludes matches).
- **Grading:** must split by rating and frame it as success, not failure. Wrong: "bad dates drive churn" (the opposite); counting matches or exposures as activity; including feedback from September when the bracket is not complete.

### Q7 — Which paid channel has the best CAC?
- **Prompt:** "Which paid channel gives us the cheapest new members? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is cheapest per signup but not per real member. Window spend per Mixpanel signup (warehouse `paid_acquisition_daily`): **TikTok $6.77, Meta $13.66, Apple Search Ads $22.95** (TikTok ≈ 0.29x Apple). But only **33.9%** of TikTok signups finish their profile vs about 69% elsewhere, so **cost per completed profile is $19.97 TikTok vs $19.36 Meta (≈1.0x)** and $33.10 Apple Search Ads. Per new subscriber (small counts): TikTok $123 (57), Meta $126 (111), Apple Search Ads $204 (66). Spend: Meta $13,999, Apple $13,470, TikTok $7,008. Accept TikTok per-signup 0.26x-0.35x of Apple and TikTok ≈ Meta per completed profile (0.9x-1.15x).
- **Evidence:** H6-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_acquisition_daily.spend_usd`; Funnels profile setup by channel; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `installs_reported` as the denominator (networks over-claim, e.g. TikTok 1,181 claimed vs 1,035 signups); stopping at "TikTok is 3x cheaper".

### Q8 — Where do signups drop in setup?
- **Prompt:** "Too many signups never finish their profile. Where do they drop, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall **61.2%** of new members complete their profile within 7 days. The gap is **TikTok**: 67.2% of TikTok signups upload photos and **33.9%** complete the profile, vs 84.7% and **69.3%** for every other channel (**0.49x**). TikTok is about 23% of signups (1,035 of 4,517). The other channels are all close to 68-71% (Apple Search Ads 69.3%, Meta 70.5%, organic 67.8%, referral 70.8%). Members who do not finish have no activity after setup (they cannot like or chat without a complete profile). Accept TikTok 0.44x-0.55x of the rest.
- **Evidence:** H6-paid-channel-economics; Funnels `account created` → `photos uploaded` → `profile completed`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q8` and `-- STORY H6`.
- **Context needed:** 03-event-dictionary.md (setup events), 04-metrics-and-tables.md (profile completion).
- **Grading:** must break down by acquisition channel. Wrong: blaming platform (no meaningful gap; see Q15); only reporting the overall rate.

### Q9 — What happened to messaging in late August?
- **Prompt:** "Messages sent dropped for about a week at the end of August. What happened, and how big was it?"
- **Type:** external-join
- **Answer:** The **Android chat incident, August 24-30** (timeline; `chat_delivery_daily` shows `service_status = major_outage` for android on those seven days, with `delivery_failure_rate` ≈ 0.60 vs about 0.006 normally). In Mixpanel, Android `message sent` fell to **0.42x** of its normal level relative to iOS (Android/iOS ratio 0.51 on incident days vs 1.21 in the 14 days either side); iOS was unaffected. That is about **1,290 Android messages missing from Mixpanel** over the seven days; the chat service logged 2,066 failed sends (its counts include automated messages and members who opted out of analytics). Volume was back to normal on August 31. Accept 0.33x-0.50x and naming Android. Daily Android/iOS ratios swing by about ±15% from noise, so read the whole week.
- **Evidence:** H7-android-chat-incident; Insights `message sent`, daily, breakdown `platform`, joined to `chat_delivery_daily`; `-- STORY H7` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`chat_delivery_daily`).
- **Grading:** must name the platform and the dates and use iOS (or the baseline) as the comparison. Wrong: "members lost interest"; reading the dip from total messages without the platform split; blaming the price change (Aug 18).

### Q10 — Did the Kindred+ price increase pay off?
- **Prompt:** "We raised Kindred+ prices on August 18. Did it hurt sales? Did it pay off?"
- **Type:** external-join
- **Answer:** It hurt more than it earned. Kindred+ purchases per paywall view fell from **6.60% to 3.95% (0.60x)**. Paywall traffic drifts down slowly all window as more members subscribe (about 191 views a day in June, 176 in the four weeks before the change, 168 in the four weeks after, 161 in September), with no step at August 18. Prices rose about 17% (warehouse `list_price_usd`), so Kindred+ list-price bookings per paywall view fell to **0.71x** ($3.67 → $2.61 per view); billing shows Kindred+ bookings at $700 a day before vs $466 after. Premier conversion did not change (see Q14). Verdict: the price rise did not pay for the lost buyers. Accept a conversion ratio of 0.55-0.80 and bookings per view below about 0.85.
- **Evidence:** H8-plus-price-change; Insights `subscription started` (plan = plus) / `paywall viewed`, before vs after Aug 18, joined to `subscription_bookings_daily.list_price_usd`; `-- STORY H8` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (date, prices), 01-business.md (plans), 04-metrics-and-tables.md (`subscription_bookings_daily`).
- **Grading:** must normalize by paywall views (or traffic) and bring in price for the revenue verdict. Wrong: "revenue per subscription went up, so it worked"; raw subscription counts (the after period is 45 days, the before period 75); claiming Premier sales fell; tying cancellations to the price change. Monthly cancellation counts rise through the window (220 in June, 273, 338, 321 in September), but the weekly cancellation rate per paid member stays near 4% in every month (3.6%-4.1%): the paid base grows. Existing subscribers keep their old price, so the price change cannot drive their cancellations (`-- EVAL Q19`).

### Q11 — How long from first message to a date?
- **Prompt:** "Once members start chatting, how long does it take to plan a date? Does it depend on what they're looking for?"
- **Type:** funnel
- **Answer:** The median time from opener to date plan is **74.7 hours** (about 3 days; 89.9 hours from match to date plan). It depends on relationship goal: **long_term 108.9 h (about 1.5x)**, long_term_open 71.2 h, figuring_it_out 73.1 h, **short_term_fun 43.8 h (about 0.6x)**. Accept long_term 1.35x-1.65x and short_term_fun 0.54x-0.66x of the other two goals.
- **Evidence:** H9-date-speed-by-goal; Funnels `conversation started` → `date planned`, Totals counting, hold `match_id` constant, 30-day window, openers Jun 4 - Aug 31, median time to convert, breakdown `relationship_goal`; `-- STORY H9` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (relationship goals), 04-metrics-and-tables.md (time to date).
- **Grading:** must hold `match_id` constant and report medians by goal. Wrong: uniques funnels across all of a member's matches (pairs unrelated matches); means dominated by long tails.

### Q12 — Does replying fast matter?
- **Prompt:** "Does it matter how fast someone sends the first message after a match?"
- **Type:** funnel
- **Answer:** Yes. Per conversation, openers sent within 24 hours of the match lead to a planned date **31.2%** of the time vs **16.4%** for openers sent later (**0.53x**). Finer: 0-6 h 32.6%, 6-12 h 31.1%, 12-18 h 30.5%, 18-24 h 27.6%, 24-36 h 20.8%, 36-48 h 13.7%, 48 h+ 14.3%. Speed barely matters in the first half day; the chance then falls steadily through the second day and levels off near 14% after two days. Accept a 0.43x-0.58x gap at 24 h with Totals counting, and a decline concentrated between about 12 and 48 hours.
- **Evidence:** H10-fast-openers; Funnels `conversation started` → `date planned`, Totals counting, hold `match_id` constant, 30-day window, openers Jun 4 - Aug 31, breakdown `hours_since_match` custom buckets; `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 03-event-dictionary.md (`hours_since_match`), 04-metrics-and-tables.md (date rate).
- **Grading:** must compare conversations by opener speed and describe where the drop happens (mostly 12-48 h, little change before 12 h or after 48 h). A Uniques funnel (a member counts once per bucket) reads 54.1% vs 24.4% (0.45x); accept it only if the analyst names the counting mode, since members with many conversations inflate both buckets. Wrong: "faster is always better" with a straight-line story; a hard cliff exactly at 24 h; using openers from September (incomplete windows).

### Q13 — Did Icebreakers lead to more dates?
- **Prompt:** "Icebreakers gets people talking, but does it get them on dates?"
- **Type:** funnel
- **Answer:** Yes. For matches from Jul 22 to Aug 31 (full 30-day window), **21.1%** of Icebreakers matches led to a planned date within 30 days vs **15.8%** in Control (**1.34x**). The lift compounds two effects: more matches get an opener (Q5), and the openers come faster, and faster openers plan more dates (Q12). Accept 1.20x-1.50x.
- **Evidence:** H4-icebreakers-experiment with H10-fast-openers; Funnels `match created` → `date planned`, Totals counting, hold `match_id` constant, 30-day window, matches Jul 22 - Aug 31, breakdown `Experiment: Icebreakers`; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (test), 03-event-dictionary.md.
- **Grading:** must measure dates by arm per match (Totals counting with `match_id` held constant). A Uniques funnel reads 43.4% vs 35.6% of matched members (1.22x); accept it if the analyst says it counts members, not matches. Wrong: "no effect on dates"; counting only matches with an opener; including matches from September (incomplete windows).

### Q14 — Did the price change hurt Premier too? (null)
- **Prompt:** "When Kindred+ got more expensive in August, did Premier sales suffer too, or did people trade up?"
- **Type:** null-hypothesis
- **Answer:** **Neither.** Premier purchases per paywall view were **2.55% before August 18 (352 of 13,787 views) and 2.56% after (188 of 7,338)**, z ≈ 0.04. The same holds on each platform (Android 2.50% → 2.60%, z ≈ 0.3; iOS 2.61% → 2.52%, z ≈ −0.3). Premier daily bookings in the warehouse dip slightly ($454 → $412 a day) only because paywall traffic drifts down through the window; per paywall view nothing changed. Accept "no meaningful change" (no trade-up and no spillover).
- **Evidence:** `-- EVAL Q14`; Insights `subscription started` (plan = premier) / `paywall viewed`, before vs after Aug 18, breakdown `platform`; `subscription_bookings_daily` (`-- EVAL Q10`).
- **Context needed:** 02-timeline.md (Premier prices unchanged), 01-business.md (plans).
- **Grading:** must normalize by paywall views and treat the gap as noise. Wrong: "Premier sales fell" from raw daily counts or bookings (traffic and period lengths differ); "members traded up to Premier".

### Q15 — Is Android onboarding worse? (null)
- **Prompt:** "Is our Android onboarding worse than iOS? Should we prioritize fixing Android setup?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day profile completion is **61.7% on Android vs 60.6% on iOS** (z ≈ 0.7). It holds within channel groups: non-TikTok 69.5% vs 69.2% (z ≈ 0.2), TikTok 35.2% vs 32.3% (z ≈ 1.0). The setup gap is about acquisition channel (Q8), not platform. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q15`; Funnels profile setup, 7-day window, breakdown `platform`.
- **Context needed:** 03-event-dictionary.md (`platform`), 04-metrics-and-tables.md.
- **Grading:** must check the data and treat the gap as noise. Wrong: "Android is worse" (or better) without a significance check; pointing to the August chat incident (unrelated to setup).

### Q16 — Do men and women match at different rates?
- **Prompt:** "How do match rates differ between men and women on Kindred?"
- **Type:** segmentation
- **Answer:** Women's likes become matches about twice as often: **women 25.4%, men 12.5%, nonbinary members 17.7%** of likes (women 2.0x men). Members like about as often per person (22.3-23.7 likes per member in the window), so the gap is in how often likes are returned. Accept women about 1.8x-2.2x men.
- **Evidence:** `-- EVAL Q16`; Insights `match created` / `like sent`, breakdown user property `gender`.
- **Context needed:** 01-business.md (gender and seeking), 04-metrics-and-tables.md (match rate).
- **Grading:** must use per-like rates. Wrong: total matches by gender (men are the larger group).

### Q17 — How big is the paying base?
- **Prompt:** "How many paying members do we have, and how much did we book from new subscriptions this period?"
- **Type:** context
- **Answer:** At the end of the window **18.9%** of members are on a paid plan: **1,313 on Kindred+ (13.1%) and 572 on Premier (5.7%)**; 8,115 are on Free. In the window Mixpanel recorded **1,740 new subscriptions** (Kindred+ 1,200: 699 monthly, 312 three-month, 189 six-month; Premier 540: 334 monthly, 127 three-month, 79 six-month) and 1,157 cancellations. Billing counts 1,848 new subscriptions (store purchases that never reach Mixpanel, net of same-day refunds) and **$126,038 in gross bookings** at list price (Kindred+ $73,463, Premier $52,574). Accept bookings from the warehouse and current plan shares from profiles.
- **Evidence:** `-- EVAL Q17`; profile `subscription_plan`; Insights `subscription started` by `plan` and `billing_period`; `subscription_bookings_daily`.
- **Context needed:** 01-business.md (plans, billing periods), 04-metrics-and-tables.md (bookings, caveats).
- **Grading:** must take bookings from the warehouse (Mixpanel has no prices) and explain the small Mixpanel vs billing gap. Wrong: multiplying Mixpanel subscriptions by a single price; treating `subscription_plan` on old events as the current plan.

### Q18 — When are members active?
- **Prompt:** "When during the week and day are members most active? When should we send our Sunday push?"
- **Type:** trend
- **Answer:** **Sunday is the busiest day** (1.19x an average day), followed by Monday (1.07x) and Thursday (1.04x); **Friday (0.83x) and Saturday (0.87x)** are the quietest. By hour, activity peaks between **22:00 and 03:00 UTC** (US evenings; 01:00 UTC is the top hour). A Sunday-evening US push lands around 23:00-01:00 UTC. Accept Sunday peak, Friday/Saturday low, and a late-evening US peak expressed in UTC.
- **Evidence:** `-- EVAL Q18`; Insights all events, breakdown day of week and hour (project time zone UTC).
- **Context needed:** 00-manifest.md (UTC, US time zones).
- **Grading:** must convert to US time or say UTC explicitly. Wrong: "Saturday night is busiest"; reading UTC hours as local hours.

### Q19 — What should we worry about this quarter?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **Kindred+ pricing**: purchases per paywall view down to 0.60x since Aug 18 and bookings per view 0.71x; consider reverting or testing a lower price (Q10).
  - **TikTok signups do not finish setup** (33.9% vs 69.3%); cheap installs are not cheap members (Q7, Q8).
  - **Success churn**: members leave after good dates (45% vs 81% D14-27); `met_someone` is the top cancel reason (41%). Plan for it (referrals, win-back when relationships end) rather than "fix" it (Q6).
  - **Android reliability**: the Aug 24-30 incident cut Android messages to 0.42x for a week (Q9).
  - Positives to keep: Icebreakers lifts openers 1.26x and dates 1.34x and should ship (Q5, Q13); Verified Profiles cut fake/scam reports to 0.47x (Q1).
  - Context: monthly active members grew from 5,568 (June) to 6,830 (September); about 1,000-1,190 signups a month; new subscriptions ran 487-516 a month in June-July, 420 in August, and 307 in September, after the price change. The paid base grew from about 1,440 to 1,890 members; cancellations rose with it (220, 273, 338, 321 a month) while the weekly cancellation rate held near 4% (3.95%, 3.63%, 4.08%, 3.97%).
- **Evidence:** H4, H5, H6, H7, H8, H1; `-- EVAL Q19` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data. Penalize generic advice without numbers, or claims the data does not support (for example "cancellations are accelerating because of the price change": the rate per paid member is flat, and existing subscribers kept their price).

### Q20 — Where should next quarter's marketing budget go?
- **Prompt:** "If we can move paid budget between Meta, TikTok, and Apple Search Ads next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge on members who complete a profile (or subscribe), not installs. Current daily spend is about $117 Meta, $112 Apple Search Ads, $58 TikTok. Cost per completed profile is about $20 for both TikTok and Meta and $33 for Apple Search Ads; cost per new subscriber (small counts) is roughly $123 TikTok, $126 Meta, $204 Apple. Network-reported cost per install looks very different ($5.93 TikTok, $11.68 Meta, $18.60 Apple) because networks over-claim installs. A reasonable plan: trim Apple Search Ads (most expensive per real member), keep Meta, and grow TikTok together with an onboarding fix for TikTok signups (per subscriber it already matches Meta, but on only about 57 subscribers). Answers should note small subscriber counts and that the window measures 7-day setup and in-window purchases, not lifetime value.
- **Evidence:** H6-paid-channel-economics; `-- EVAL Q7`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, `paid_acquisition_daily`), 01-business.md (channels).
- **Grading:** credit for using Mixpanel signups and completion with warehouse spend, and for caveats. Wrong: "move everything to TikTok because installs are cheapest"; using `installs_reported` for CAC.

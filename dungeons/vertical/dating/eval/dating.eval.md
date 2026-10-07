# Kindred (dating) — 20-question eval

- **Data:** `data/verify-dating` (full fidelity: 10,000 members, 9,989 with events, 4,454 new signups, 652,879 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/dating/dating.sql` on that data.
- **Stories:** ids refer to the `stories` export in `dating.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Is Verified Profiles cutting fake accounts?
- **Prompt:** "Trust & Safety launched Verified Profiles in July. Are we seeing fewer fake profiles and scammers since then?"
- **Type:** trend
- **Answer:** Yes. Reports with reason `fake_profile` or `scam` fell from **10.23 per 1,000 profile decisions** (likes + passes) before the 2026-07-14 launch to **4.04 per 1,000 from August 4 on**, about **0.40x** (−60%). The drop phases in over the three weeks after launch: weekly rates of 9.2-12.0 per 1,000 before launch, 8.4 in the launch week, 7.6 the week of Jul 20, then 3.0-4.4 from the week of Jul 27 (one noisy week at 6.1). Other report reasons did not move (11.79 → 12.01 per 1,000, 1.02x), so it is not a change in reporting overall. In raw counts fake/scam reports went from 668 (Jun 4-Jul 13) to 434 (Aug 4-Oct 1) even though browsing grew. Accept 0.35x-0.45x and a ramp over late July.
- **Evidence:** H1-verified-profiles-launch; Insights, `profile reported` filtered `report_reason` in (fake_profile, scam), formula per 1,000 (`like sent` + `profile passed`), weekly; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, rollout), 04-metrics-and-tables.md (fake-account report rate definition).
- **Grading:** must normalize by browsing (or compare against the other reasons) and give the size. Wrong: raw report counts only (browsing grows over the window); claiming all reports fell; comparing the launch week itself as "after".

### Q2 — How many members verified?
- **Prompt:** "How many members have verified their profile, and how fast did it happen?"
- **Type:** context
- **Answer:** **3,900 members verified**, **49.7%** of the 7,849 members who opened the app since launch (50.4% of members who joined before launch, 47.1% of members who joined after it). Verifications came in a wave in the three weeks after launch: 355 in the launch week (Jul 14-19), 883, 1,074, and 777 in the following weeks, then 309 and 142 as the in-app prompts ended, and a steady 55-80 a week from late August, mostly new members verifying after they finish their profile. Accept 45%-55% and the wave-then-steady shape.
- **Evidence:** H1-verified-profiles-launch (adoption); Insights, `selfie verified` uniques, weekly; profile property `verified`; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (three-week prompt, new-member offer), 04-metrics-and-tables.md (verification rate).
- **Grading:** denominator must be members active after launch. Wrong: share of all 10,000 profiles (39%); counting verifications before July 14 (there are none); "adoption keeps growing".

### Q3 — Is there an ideal number of photos?
- **Prompt:** "Do members with more photos get more matches? What's the ideal number of photos?"
- **Type:** segmentation
- **Answer:** **4-6 photos is the sweet spot**, not "more is better". Matches per like: 1 photo 9.5%, 2 photos 10.1%, 3 photos 16.0%, 4 photos 20.0%, 5 photos 20.5%, 6 photos 21.3%, 7 photos 15.8%, 8 photos 16.3%, 9 photos 17.0%. Grouped: 1-2 photos 9.9% (**0.48x** of 4-6), 3 photos 16.0% (0.78x), 4-6 photos 20.5%, 7-9 photos 16.2% (**0.79x**). Accept a peak at 4-6 photos with 1-2 at 0.40x-0.55x and 7-9 at 0.72x-0.88x of the peak.
- **Evidence:** H2-photo-count-sweet-spot; Insights, `match created` / `like sent`, breakdown user property `photo_count`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 03-event-dictionary.md (`photo_count`), 04-metrics-and-tables.md (match rate).
- **Grading:** must use a rate per like (not matches per member) and name the drop above 6. Wrong: "more photos is always better"; matches per member (driven by how much people like).

### Q4 — Are Sparks worth it?
- **Prompt:** "Do Sparks actually work better than a normal like?"
- **Type:** segmentation
- **Answer:** Yes. A Spark becomes a match **49.5%** of the time vs **16.3%** for a standard like, about **3.0x**. The ratio is the same on every plan (Free 47.9% vs 16.2%, Kindred+ 51.0% vs 16.5%, Premier 50.9% vs 16.4%); paid members just send more of them (Sparks are 3.0% of Free members' likes, 6.9% on Kindred+, 12.0% on Premier). Accept 2.7x-3.3x.
- **Evidence:** H3-sparks-match-rate; Insights, `match created` where `match_source` = spark ÷ `like sent` where `like_type` = spark, vs the same for standard likes; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`like_type`, `match_source`).
- **Grading:** must compare per-like match rates by like type. Wrong: comparing matches per member for Spark users vs others (confounded by plan and activity).

### Q5 — Should we ship Icebreakers?
- **Prompt:** "Is the Icebreakers test working? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes, it works. For matches from 2026-07-22 to Sep 24 (each with a full 7-day window), **74.2% of Icebreakers matches got an opener within 7 days vs 58.6% in Control (1.27x, z ≈ 17)**, and the median time from match to opener fell from **14.1 to 8.3 hours (0.59x)**. 44.8% of Icebreakers openers used a suggestion; Control has none. The split is balanced (2,226 vs 2,162 exposed members). It also carries through to dates (see Q13). Recommend shipping. Accept a lift of 1.15x-1.40x and a time ratio of 0.5-0.7.
- **Evidence:** H4-icebreakers-experiment; Funnels, `match created` → `conversation started`, totals, hold `match_id` constant, 7-day window, breakdown `Experiment: Icebreakers` (or the Experiments report on `$experiment_started`); `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (start date, arms), 03-event-dictionary.md (`hours_since_match`, `opener_type`).
- **Grading:** must compare arms per match after the start and report both conversion and speed. Wrong: unique-member funnels (most members open at least one match either way, which hides the effect); including matches before July 22; using `opener_type = icebreaker` as the treatment group (only some variant openers use a suggestion).

### Q6 — What happens after a good date?
- **Prompt:** "Our best outcome is members meeting someone great. What happens to members after a good date? Are we losing them?"
- **Type:** retention
- **Answer:** Yes: a good date takes many members off the app. Among members whose first date feedback (Jun 4-Sep 3) was **4-5 stars, 48.1%** opened the app in days 14-27 afterwards vs **86.7%** after a **1-3 star** first date (**0.55x**). By rating: 1★ 88.0%, 2★ 85.0%, 3★ 87.0%, 4★ 50.2%, 5★ 45.5%. It shows up in billing too: `met_someone` is the top cancellation reason (237 of 672 cancellations, 35%). This is "success churn": the product works, and the member leaves. Accept 0.50x-0.60x.
- **Evidence:** H5-success-churn; Retention, birth `date feedback submitted` (first time), breakdown `rating`, return `app opened`, custom bracket day 14-27; `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (north star is dates), 03-event-dictionary.md (`rating`, `cancel_reason`), 04-metrics-and-tables.md (active member excludes matches).
- **Grading:** must split by rating and frame it as success, not failure. Wrong: "bad dates drive churn" (the opposite); counting matches or exposures as activity; including feedback from September when the bracket is not complete.

### Q7 — Which paid channel has the best CAC?
- **Prompt:** "Which paid channel gives us the cheapest new members? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is cheapest per signup but not per real member. Window spend per Mixpanel signup (warehouse `paid_acquisition_daily`): **TikTok $6.81, Meta $14.14, Apple Search Ads $22.94** (TikTok ≈ 0.30x Apple). But only **33.9%** of TikTok signups finish their profile vs about 69% elsewhere, so **cost per completed profile is $20.10 TikTok vs $20.34 Meta (≈1.0x)** and $33.10 Apple Search Ads. Per new subscriber (small counts): TikTok $214 (32), Meta $237 (58), Apple Search Ads $366 (38). Spend: Apple $13,903, Meta $13,747, TikTok $6,854. Accept TikTok per-signup 0.27x-0.35x of Apple and TikTok ≈ Meta per completed profile (0.9x-1.1x).
- **Evidence:** H6-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_acquisition_daily.spend_usd`; Funnels profile setup by channel; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `installs_reported` as the denominator (networks over-claim, e.g. TikTok 1,149 claimed vs 1,007 signups); stopping at "TikTok is 3x cheaper".

### Q8 — Where do signups drop in setup?
- **Prompt:** "Too many signups never finish their profile. Where do they drop, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall **61.2%** of new members complete their profile within 7 days. The gap is **TikTok**: 66.2% of TikTok signups upload photos and **33.9%** complete the profile, vs 85.2% and **69.1%** for every other channel (**0.49x**). TikTok is about 23% of signups (1,007 of 4,454). Other channels are all close to 67-70%. Members who do not finish browse for a few days and leave. Accept TikTok 0.45x-0.55x of the rest.
- **Evidence:** H6-paid-channel-economics; Funnels `account created` → `photos uploaded` → `profile completed`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (setup events), 04-metrics-and-tables.md (profile completion).
- **Grading:** must break down by acquisition channel. Wrong: blaming platform or signup method (no meaningful gap; see Q15); only reporting the overall rate.

### Q9 — What happened to messaging in late August?
- **Prompt:** "Messages sent dropped for a few days at the end of August. What happened, and how big was it?"
- **Type:** external-join
- **Answer:** The **Android chat incident, August 24-28** (timeline; `chat_delivery_daily` shows `service_status = major_outage` for android on those five days, with `delivery_failure_rate` ≈ 0.60 vs about 0.006 normally). In Mixpanel, Android `message sent` fell to **0.41x** of its normal level relative to iOS (Android/iOS ratio 0.46 on incident days vs 1.11 in the 14 days either side); iOS was unaffected. That is about **1,300 Android messages missing from Mixpanel** over the five days; the chat service logged 2,377 failed sends (its counts include automated messages and members who opted out of analytics). Volume was back to normal on August 29. Accept 0.35x-0.45x and naming Android.
- **Evidence:** H7-android-chat-incident; Insights `message sent`, daily, breakdown `platform`, joined to `chat_delivery_daily`; `-- STORY H7` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`chat_delivery_daily`).
- **Grading:** must name the platform and the dates and use iOS (or the baseline) as the comparison. Wrong: "members lost interest"; reading the dip from total messages without the platform split; blaming the price change (Aug 18).

### Q10 — Did the Kindred+ price increase pay off?
- **Prompt:** "We raised Kindred+ prices on August 18. Did it hurt sales? Did it pay off?"
- **Type:** external-join
- **Answer:** It hurt more than it earned. Kindred+ purchases per paywall view fell from **6.95% to 4.72% (0.68x)** while paywall traffic held (about 98 views a day before and after). Prices rose about 17% (warehouse `list_price_usd`), so Kindred+ list-price bookings per paywall view fell to **0.74x** ($3.95 → $2.94 per view); billing shows Kindred+ bookings at $406 a day before vs $315 after. Premier was not affected: 2.46% → 2.67% of paywall views (z ≈ 0.7, noise). Verdict: the price rise did not pay for the lost buyers. Accept a conversion ratio of 0.60-0.80 and bookings per view below about 0.85.
- **Evidence:** H8-plus-price-change; Insights `subscription started` (plan = plus) / `paywall viewed`, before vs after Aug 18, joined to `subscription_bookings_daily.list_price_usd`; `-- STORY H8` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (date, prices), 01-business.md (plans), 04-metrics-and-tables.md (`subscription_bookings_daily`).
- **Grading:** must normalize by paywall views (or traffic) and bring in price for the revenue verdict. Wrong: "revenue per subscription went up, so it worked"; raw subscription counts (the after period is 45 days, the before period 75); claiming Premier sales fell.

### Q11 — How long from first message to a date?
- **Prompt:** "Once members start chatting, how long does it take to plan a date? Does it depend on what they're looking for?"
- **Type:** funnel
- **Answer:** The median time from opener to date plan is **72.5 hours** (about 3 days; 89.8 hours from match to date plan). It depends on relationship goal: **long_term 109.6 h (about 1.5x)**, long_term_open 68.9 h, figuring_it_out 72.8 h, **short_term_fun 42.1 h (about 0.6x)**. Accept long_term 1.35x-1.65x and short_term_fun 0.54x-0.66x of the other two goals.
- **Evidence:** H9-date-speed-by-goal; Funnels `conversation started` → `date planned`, hold `match_id` constant, 30-day window, median time to convert, breakdown `relationship_goal`; `-- STORY H9` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (relationship goals), 04-metrics-and-tables.md (time to date).
- **Grading:** must hold `match_id` constant and report medians by goal. Wrong: uniques funnels across all of a member's matches (pairs unrelated matches); means dominated by long tails.

### Q12 — Does replying fast matter?
- **Prompt:** "Does it matter how fast someone sends the first message after a match?"
- **Type:** funnel
- **Answer:** Yes, with a clear threshold at about a day. Openers sent within 24 hours of the match lead to a planned date **32.7%** of the time vs **15.8%** for openers sent later (**0.48x**). Finer: 0-6 h 32.3%, 6-12 h 34.3%, 12-24 h 31.6%, 24-48 h 14.5%, 48 h+ 17.2%. Within the first day speed does not matter; past a day the chance halves. Accept a 0.45x-0.55x gap at 24 h.
- **Evidence:** H10-fast-openers; Funnels `conversation started` → `date planned`, hold `match_id`, 30-day window, breakdown `hours_since_match` buckets (openers through Aug 31); `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 03-event-dictionary.md (`hours_since_match`), 04-metrics-and-tables.md (date rate).
- **Grading:** must find the step at ~24 h rather than a smooth decline. Wrong: "faster is always better" with a linear story; using openers from September (incomplete windows).

### Q13 — Did Icebreakers lead to more dates?
- **Prompt:** "Icebreakers gets people talking, but does it get them on dates?"
- **Type:** funnel
- **Answer:** Yes. For matches from Jul 22 to Aug 31 (full 30-day window), **20.8%** of Icebreakers matches led to a planned date within 30 days vs **16.3%** in Control (**1.28x**). The lift comes from more openers, and from faster openers, which plan more dates (Q12). Accept 1.15x-1.40x.
- **Evidence:** H4-icebreakers-experiment with H10-fast-openers; Funnels `match created` → `date planned`, hold `match_id`, 30-day window, breakdown `Experiment: Icebreakers`; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (test), 03-event-dictionary.md.
- **Grading:** must measure dates per match by arm. Wrong: "no effect on dates" (from a uniques funnel); counting only matches with an opener.

### Q14 — Do verified members get more matches? (null)
- **Prompt:** "Verified members have a badge. Do they get more matches per like than unverified members?"
- **Type:** null-hypothesis
- **Answer:** **No.** Since the verification wave finished (from August 4), verified members' likes became matches **17.17%** of the time vs **17.36%** for unverified members (z ≈ −0.6). The same holds on each platform (Android 17.36% vs 17.20%, iOS 16.97% vs 17.54%). The badge does not change match rates; verification's value shows up in fewer fake-account reports (Q1). Accept "no meaningful difference" (within ±5%).
- **Evidence:** `-- EVAL Q14`; Insights `match created` / `like sent`, breakdown user property `verified`, from Aug 4.
- **Context needed:** 03-event-dictionary.md (`verified`), 04-metrics-and-tables.md (match rate).
- **Grading:** must use a rate per like. Wrong: matches per member (verified members are more active since August 4, 7.7 vs 5.3 likes per member, so they get more matches in total, 1.33 vs 0.92); "verified members match more".

### Q15 — Is Android onboarding worse? (null)
- **Prompt:** "Is our Android onboarding worse than iOS? Should we prioritize fixing Android setup?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day profile completion is **61.6% on Android vs 60.7% on iOS** (z ≈ 0.7). It holds within channel groups: non-TikTok 69.9% vs 68.4% (z ≈ 0.9), TikTok 33.1% vs 34.7% (z ≈ −0.5). The setup gap is about acquisition channel (Q8), not platform. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q15`; Funnels profile setup, 7-day window, breakdown `platform`.
- **Context needed:** 03-event-dictionary.md (`platform`), 04-metrics-and-tables.md.
- **Grading:** must check the data and treat the gap as noise. Wrong: "Android is worse" (or better) without a significance check; pointing to the August chat incident (unrelated to setup).

### Q16 — Do men and women match at different rates?
- **Prompt:** "How do match rates differ between men and women on Kindred?"
- **Type:** segmentation
- **Answer:** Women's likes become matches about twice as often: **women 24.9%, men 12.4%, nonbinary members 18.9%** of likes. Members like about as often per person (13.5-14.2 likes per member in the window), so the gap is in how often likes are returned. Accept women about 1.8x-2.2x men.
- **Evidence:** `-- EVAL Q16`; Insights `match created` / `like sent`, breakdown user property `gender`.
- **Context needed:** 01-business.md (gender and seeking), 04-metrics-and-tables.md (match rate).
- **Grading:** must use per-like rates. Wrong: total matches by gender (men are the larger group).

### Q17 — How big is the paying base?
- **Prompt:** "How many paying members do we have, and how much did we book from new subscriptions this period?"
- **Type:** context
- **Answer:** At the end of the window **19.7%** of members are on a paid plan: **1,428 on Kindred+ (14.3%) and 542 on Premier (5.4%)**; 8,030 are on Free. In the window Mixpanel recorded **1,019 new subscriptions** (Kindred+ 720: 405 monthly, 216 three-month, 99 six-month; Premier 299) and 672 cancellations. Billing counts 1,083 new subscriptions (store purchases that never reach Mixpanel, net of same-day refunds) and **$75,679 in gross bookings** at list price (Kindred+ $44,602, Premier $31,077). Accept bookings from the warehouse and current plan shares from profiles.
- **Evidence:** `-- EVAL Q17`; profile `subscription_plan`; Insights `subscription started` by `plan` and `billing_period`; `subscription_bookings_daily`.
- **Context needed:** 01-business.md (plans, billing periods), 04-metrics-and-tables.md (bookings, caveats).
- **Grading:** must take bookings from the warehouse (Mixpanel has no prices) and explain the small Mixpanel vs billing gap. Wrong: multiplying Mixpanel subscriptions by a single price; treating `subscription_plan` on old events as the current plan.

### Q18 — When are members active?
- **Prompt:** "When during the week and day are members most active? When should we send our Sunday push?"
- **Type:** trend
- **Answer:** **Sunday is the busiest day** (1.35x an average day), followed by Monday (1.14x); **Friday (0.73x) and Saturday (0.76x)** are the quietest. By hour, activity peaks between **22:00 and 03:00 UTC** (US evenings; 00-01 UTC is the top). A Sunday-evening US push lands around 23:00-01:00 UTC. Accept Sunday peak, Friday/Saturday low, and a late-evening US peak expressed in UTC.
- **Evidence:** `-- EVAL Q18`; Insights all events, breakdown day of week and hour (project time zone UTC).
- **Context needed:** 00-manifest.md (UTC, US time zones).
- **Grading:** must convert to US time or say UTC explicitly. Wrong: "Saturday night is busiest"; reading UTC hours as local hours.

### Q19 — What should we worry about this quarter?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **Kindred+ pricing**: purchases per paywall view down to 0.68x since Aug 18 and bookings per view 0.74x; consider reverting or testing a lower price (Q10).
  - **TikTok signups do not finish setup** (33.9% vs 69.1%); cheap installs are not cheap members (Q7, Q8).
  - **Success churn**: members leave after good dates (48% vs 87% D14-27); `met_someone` is the top cancel reason. Plan for it (referrals, win-back when relationships end) rather than "fix" it (Q6).
  - **Android reliability**: the Aug 24-28 incident cut Android messages to 0.41x for five days (Q9).
  - Positives to keep: Icebreakers lifts openers 1.27x and dates 1.28x and should ship (Q5, Q13); Verified Profiles cut fake/scam reports to 0.40x (Q1).
  - Context: monthly active members grew from 5,785 (June) to 7,278 (September); about 1,000-1,170 signups a month; new subscriptions peaked in July (299) and fell to 222 in September.
- **Evidence:** H4, H5, H6, H7, H8, H1; `-- EVAL Q19` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data. Penalize generic advice without numbers, or claims the data does not support (for example "verified members match more").

### Q20 — Where should next quarter's marketing budget go?
- **Prompt:** "If we can move paid budget between Meta, TikTok, and Apple Search Ads next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge on members who complete a profile (or subscribe), not installs. Current daily spend is about $116 Apple Search Ads, $115 Meta, $57 TikTok. Cost per completed profile is about $20 for both TikTok and Meta and $33 for Apple Search Ads; cost per new subscriber (small counts) is roughly $214 TikTok, $237 Meta, $366 Apple. Network-reported cost per install looks very different ($5.97 TikTok, $11.68 Meta, $18.64 Apple) because networks over-claim installs. A reasonable plan: hold or trim Apple Search Ads (most expensive per real member), keep Meta, and grow TikTok only together with an onboarding fix for TikTok signups (which would make it the cheapest channel). Answers should note small subscriber counts and that the window measures 7-day setup and in-window purchases, not lifetime value.
- **Evidence:** H6-paid-channel-economics; `-- EVAL Q7`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, `paid_acquisition_daily`), 01-business.md (channels).
- **Grading:** credit for using Mixpanel signups and completion with warehouse spend, and for caveats. Wrong: "move everything to TikTok because installs are cheapest"; using `installs_reported` for CAC.

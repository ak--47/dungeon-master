# Brightpath Academy (education) — 20-question eval

- **Data:** `data/verify-education` (full fidelity: 10,000 learner profiles, 8,631 with events, 4,009 new signups, 608,889 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/education/education.sql` on that data.
- **Stories:** ids refer to the `stories` export in `education.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Ask Bright improve quiz scores?
- **Prompt:** "We launched the Ask Bright tutor in July. Is it actually helping learners do better on quizzes? By how much?"
- **Type:** trend
- **Answer:** Yes. Learners who use Ask Bright score about **8 points higher after their first tutor question**: their average quiz score went from **70.1 before to 78.3 after** (+8.2), while Plus and Teams learners who never used it stayed flat (**70.0 before launch, 69.8 after**). Difference in differences: **+8.3 points**. Pass rate (70+) for adopters rose from 52.1% to 76.6%; non-adopters stayed at about 51%. Adopters scored the same as everyone else before they started using it, so this is not just stronger learners choosing the tutor. In a weekly Insights chart the two groups track at about 70 until launch; adopters then pull ahead as they start (73.8 in the week of Aug 3, 76.1 by Aug 10, 76.5 by Aug 17, 75.9-78.8 from Aug 24) while eligible non-adopters stay at 69-70. A simple post-launch comparison (adopters 75.8 vs non-adopters 69.8, +6.0) understates the effect because it mixes in adopters' quizzes from before their first question. Accept +5 to +9 points if the answer shows the groups were equal before launch (weekly chart or pre-launch averages); full credit for the before/after-first-question measure (+7 to +9).
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `quiz submitted`, average `score_pct`, weekly, report filter `plan_tier` in (plus, teams), breakdown cohort "did `ai tutor question asked`" (yes / no); the before/after-first-question read uses the raw export; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plans), 01-business.md (who gets Ask Bright).
- **Grading:** must compare users vs non-users with a before/after control, or show that adopters were not better before. Wrong: "no effect" from comparing all learners before vs after launch across every plan; a raw adopter vs non-adopter gap with no check for selection.

### Q2 — Ask Bright adoption
- **Prompt:** "How many learners are using Ask Bright, and is usage still growing?"
- **Type:** segmentation
- **Answer:** **998 learners** have asked at least one question, **34.5% of the 2,893 learners active on a Plus or Teams plan since launch**, with 9,731 questions (9.75 per user). Weekly questions ramped fast for about three weeks: 88 in the launch week (Jul 20-26, 45 askers), 497, 772, then 1,140 in the week of Aug 10. After that, volume leveled off: 1,054 to 1,230 a week from Aug 17 through Sep 21 (weekly askers 358 to 403). New first-time askers peaked in the weeks of Aug 3 and Aug 10 (210 and 206) and fell every week after, to 25 in the week of Sep 21. Adoption has plateaued; the small rise in questions comes from existing users. Accept an adoption share of 30-40% of eligible learners and a description of a fast ramp that has slowed or leveled off with few new adopters.
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `ai tutor question asked`, total and uniques, weekly; denominator: uniques with any event on `plan_tier` plus/teams since 2026-07-21; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator must be eligible (Plus/Teams) learners, and the answer must describe the shape. Wrong: share of all learners (Free learners cannot use it); "still growing steadily" based on total questions without noticing that new adopters have dried up.

### Q3 — Personalized Course Picks result
- **Prompt:** "Did the Personalized Course Picks test work? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes, ship it. Per course page view (hold `course_id` constant, totals, 1-day window), **28.1% of Control views led to an enrollment in that course vs 35.5% for Personalized, a 1.27x lift**; Personalized learners also enrolled faster (median 48 minutes from view to enrollment vs 60, 0.80x). The split is even (3,160 Control vs 3,170 Personalized learners). After exposure, Personalized learners made 2.24 enrollments each vs 1.86 for Control (1.20x). Accept a lift of 1.15x-1.35x and a faster time to enroll.
- **Evidence:** H2-personalized-course-picks-experiment; Funnels, `course page viewed` → `course enrolled`, totals, hold `course_id` constant, 1-day window, breakdown `Experiment: Personalized Course Picks`, from 2026-07-08; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (funnel notes).
- **Grading:** must compare the two arms on enrollment conversion. Wrong: a unique-user funnel that reads near 100% in both arms (most learners enroll in something eventually) and calls it "no difference".

### Q4 — Where do new learners stall?
- **Prompt:** "Too many new signups never start a lesson. Is it everyone, or does some group do better?"
- **Type:** funnel
- **Answer:** Overall, **53.9%** of new learners complete onboarding (account created → learning goals set → course enrolled → lesson started) within 7 days. **Employer-sponsored (Teams) learners complete it at 75.3% (745 signups) vs 49.1% for self-pay learners (3,264)**, about **1.5x**. Self-pay learners fall behind at every step (goals 83.5% vs 91.7%, enrollment 66.7% vs 82.8%). Accept a ratio of 1.35-1.75 and naming account type (Teams vs self-pay).
- **Evidence:** H3-sponsored-onboarding; Funnels, four onboarding steps, 7-day window, breakdown `account_type`; `-- EVAL Q4`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by account type (or acquisition channel `employer`, which is the same group) and give the gap. Wrong: blaming the signup platform or signup method (see Q20); reporting only the overall rate.

### Q5 — Time to first lesson
- **Prompt:** "How long does it take a new learner to get from signup to their first lesson?"
- **Type:** funnel
- **Answer:** Median **25.9 hours** for new learners who complete onboarding. It differs by account type: **13.5 hours for employer-sponsored learners vs 27.1 hours for self-pay learners (0.50x)**. Accept 24-28 hours overall and a sponsored/self-pay ratio of 0.45-0.55.
- **Evidence:** H3-sponsored-onboarding; Funnels, onboarding steps, 7-day window, median time to convert, breakdown `account_type`; `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (time to first lesson).
- **Grading:** must use time to convert on completed onboarding funnels, ideally split by account type. Wrong: average including non-converters; measuring to the first `lesson completed`.

### Q6 — Cohort vs self-paced completion
- **Prompt:** "Should we build more cohort courses? How do they compare with self-paced courses on completion?"
- **Type:** funnel
- **Answer:** Cohort courses are finished far more often. For enrollments from Jun 4-30 (all with time to finish), **56.6% of cohort enrollments earned a certificate (559 of 988) vs 16.3% of self-paced enrollments (530 of 3,250), about 0.29x** for self-paced. Time from enrollment to certificate is similar (median 48 days for cohort courses, which includes the wait for the group's Monday start, vs 41 for self-paced). Self-paced courses are 76% of enrollments, so they drive the low overall completion rate (25.7%). Accept a self-paced/cohort ratio of 0.25-0.35 and a recommendation that leans toward cohorts.
- **Evidence:** H4-cohort-vs-self-paced-completion; Funnels, `course enrolled` → `certificate earned`, totals, hold `course_id` constant, 90-day window, breakdown `course_format`, enrollments in June; `-- EVAL Q6`.
- **Context needed:** 01-business.md (formats), 04-metrics-and-tables.md (course completion, maturity rule).
- **Grading:** must measure per enrollment with mature enrollments. Wrong: using all enrollments through September (late enrollments have not had time to finish, which pulls both rates down); counting certificates per learner without matching the course.

### Q7 — What predicts new-learner retention?
- **Prompt:** "Is there something new learners do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Completing 3 or more lessons in the first 7 days** is the clearest marker. Among new learners who started a lesson (signups through Aug 25), **68.3% of those with 3+ first-week lessons were still active on or after day 30 vs 38.5% of those with fewer (1.77x)**; with a day 30-36 bracket, 63.7% vs 36.4%. Retention is flat at 0-1 lessons and then climbs, and the biggest single step is from 2 to 3: 0 lessons 35.7%, 1 lesson 35.1%, 2 lessons 43.7%, 3 lessons 60.8% (1.39x the 2-lesson rate), 4 lessons 73.2%, 5+ 75.6%. 586 learners reached 3+, 936 did not. Accept a 3+ vs fewer ratio of 1.5-2.0 and a threshold at 3 lessons (or "more first-week lessons, with the largest jump at 3").
- **Evidence:** H5-first-week-lessons; Funnels `account created` → `lesson completed` ×3 (7-day window), save completed and dropped learners as cohorts; Retention, `account created` → any event (not backend events), on or after day 30, filter "did `lesson started`"; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (retention definition, activation still under discussion).
- **Grading:** must name a first-week lesson count (3+) and show the retention gap. Wrong: a threshold at 1 or 2 lessons; using the whole-window lesson count (it includes the retention itself).
### Q8 — Did the August price change pay off?
- **Prompt:** "We raised the Plus monthly price on August 10. Did it hurt sign-ups, and did it pay off?"
- **Type:** external-join
- **Answer:** It paid off: buyers shifted to annual billing and revenue per subscription rose, with at most a small loss of subscriptions. The **annual share of new subscriptions went from 33.7% before to 61.9% after**. Comparing the 53 days either side (Jun 18 - Aug 9 vs Aug 10 - Oct 1), new subscriptions went from **3.79 to 3.42 per day (−10%)**: monthly fell from 2.47 to 1.30 per day while annual rose from 1.32 to 2.11. Volume is low (about 4 a day), so the size of the drop is uncertain by about ±10 points; full weeks before the change ranged from 20 to 31 subscriptions. Joining `subscription_billing_daily` list prices, the **first payment per new subscription rose from $99.80 to $161.23 (+62%)**, and billed bookings rose from **$427 to $617 per day (+45%)**. Net: somewhat fewer subscribers, much more booked revenue; the gain is annual prepayment. Accept an annual share up by 22-35 points, a volume change from flat to a drop of up to 25% (flagged as noisy), first payment up 50-75%, and bookings per day up 35-60%. Credit an answer that flags the small daily counts.
- **Evidence:** H6-plus-price-change; Insights, `subscription started`, breakdown `billing_interval`, weekly, % of total and totals; join `subscription_billing_daily` on date and `billing_interval`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (date, which price changed), 01-business.md (prices), 04-metrics-and-tables.md (bookings).
- **Grading:** must look at the billing mix and use warehouse prices for revenue. Wrong: "no effect" from counting subscriptions only; "revenue fell" because monthly subscriptions fell; computing revenue from Mixpanel without the price table; a large volume drop (over 25%) claimed as certain.

### Q9 — Which paid channel is worth it?
- **Prompt:** "Paid social gives us the cheapest signups. Is it our best paid channel?"
- **Type:** external-join
- **Answer:** No, not once you count paying learners. Joining `paid_marketing_daily` to Mixpanel signups: spend per signup is **$15.20 paid social, $28.78 YouTube, $40.45 paid search** (social is 0.38x search). But the 30-day Plus conversion of signups through Aug 31 is **5.5% for paid social vs 6.9% YouTube and 10.9% paid search** (social 0.50x search; all new self-pay learners 9.2%). Per paying subscriber (spend through Aug 31 over 30-day buyers): **paid social $281, paid search $371, YouTube $409**. Buyer counts are small (49 search, 27 social, 16 YouTube), so treat the per-subscriber figures as about ±25-30%; paid social's 2.7x advantage per signup shrinks to about 1.3x per paying learner, inside the noise. Paid social buys cheap signups that pay half as often. Ad platforms claim 21-34% more signups than Mixpanel records (paid social 816 vs 676, paid search 780 vs 602, YouTube 411 vs 307). Accept "paid social is not the bargain its cost per signup suggests: it converts at about half the search rate, and per paying subscriber it is at most modestly cheaper, within the noise" with the conversion gap.
- **Evidence:** H7-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels `account created` → `subscription started`, 30-day window, signups Jun 4 - Aug 31, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table caveats), 01-business.md (goal 5).
- **Grading:** must combine spend with downstream conversion. Wrong: ranking by cost per signup alone; using `platform_reported_signups` for CAC; claiming one channel is clearly cheaper per paying subscriber without noting the small buyer counts.

### Q10 — The September dip
- **Prompt:** "Lesson completions looked weak for a few days in mid-September. What happened?"
- **Type:** external-join
- **Answer:** A **video playback bug in the Android app**. From **Sep 9 to Sep 12**, only **35-38% of video lessons started on Android were completed (37.2% over the four days) vs about 82% on the days before and after**; web and iOS stayed at about 80-82%, and Android reading and lab lessons were unaffected (81-83%). `app_stability_daily` shows Android `playback_failure_rate` of 0.53-0.57 on exactly those days (vs about 0.01-0.02 otherwise), `app_version` 6.4.0, crash-free sessions down to 0.964, and 6.4.1 from Sep 13, when completion recovered. The Insights formula (`lesson completed` / `lesson started`, totals, `content_type` = video, breakdown `platform`) reads the same: Android **38.1%** on Sep 9-12 vs 81.6% in the 7 days either side, web and iOS 80-82%. Accept identifying Android video and Sep 9-12 with the warehouse confirmation.
- **Evidence:** H8-android-playback-incident; Insights, `lesson completed` / `lesson started` formula, filter `content_type` = video, breakdown `platform`, daily; join `app_stability_daily`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily, Mixpanel does not record player errors).
- **Grading:** must name the platform and the content type and tie it to the warehouse table. Wrong: "a general dip" or blaming the fall term or weekday mix.

### Q11 — The late-August jump
- **Prompt:** "Lesson activity jumped at the end of August. Was that a marketing push? What drove it?"
- **Type:** context
- **Answer:** The **university fall term**, not marketing. Splitting at Aug 24, **university students completed 237.4 lessons per day vs 144.1 before (1.65x)**, while the other segments were flat (career switchers 1.01x, upskillers 1.00x, lifelong learners 0.98x). Term starts are staggered, so the student line ramps over three weeks: 1,032 completions in the week of Aug 10, 1,091 (Aug 17), 1,387 (Aug 24), 1,718 (Aug 31), then 1,672-1,762 a week. On full-rate days (before Aug 17 vs from Sep 8) students rose from 142.9 to 245.5 a day (1.72x) and other segments 0.95-1.00x. Paid budgets were steady. Accept naming university students and the fall term start with a student ratio of 1.6-2.0x; credit noticing the gradual ramp.
- **Evidence:** H9-fall-term-students; Insights, `lesson completed`, breakdown `learner_segment`, weekly; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (fall term on Aug 24 with staggered school start dates, steady budgets), 01-business.md (segments, university partnership).
- **Grading:** must attribute the jump to students. Wrong: crediting Ask Bright or the price change; reading the jump as one overnight step on Aug 24.
### Q12 — Does 2x playback hurt learning?
- **Prompt:** "Lots of learners watch at double speed. Does it hurt how well they do?"
- **Type:** segmentation
- **Answer:** Yes, at 2x. Learners whose preferred playback speed is **2x average 65.0 on quizzes vs 71.7 at 1x (−6.7 points)** and pass 35.9% of quizzes vs 57.0%. 1.25x (71.5) and 1.5x (71.8) are no different from 1x. They do save time: a video lesson at 2x takes 9.0 minutes vs 16.0 at 1x. Accept a 2x gap of 6-8 points and "1.25x and 1.5x are fine".
- **Evidence:** H10-double-speed-quiz-scores; Insights, `quiz submitted`, average `score_pct`, breakdown user property `preferred_playback_speed`; `-- EVAL Q12`.
- **Context needed:** 01-business.md (playback speeds), 03-event-dictionary.md (`preferred_playback_speed`, `playback_speed`).
- **Grading:** must separate 2x from the moderate speeds. Wrong: "faster is worse" as a linear claim; "no effect".

### Q13 — Do Teams learners finish more courses? (null)
- **Prompt:** "Employer-sponsored learners have their company behind them. Do they finish courses more often than self-pay learners?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** Across all enrollments, **15.9% of employer-sponsored enrollments vs 16.7% of self-pay enrollments** earned a certificate (z ≈ −1.1, p ≈ 0.28). Within June enrollments by format: cohort 54.5% vs 57.1% (z ≈ −0.6, p ≈ 0.53), self-paced 16.1% vs 16.4% (z ≈ −0.2); neither is significant. Sponsored learners start faster (Q4), but once enrolled they finish at the same rate. Accept "no significant difference" (within about ±2 points overall).
- **Evidence:** `-- EVAL Q13`; Funnels `course enrolled` → `certificate earned`, totals, hold `course_id`, breakdown `account_type`.
- **Context needed:** 01-business.md (account types).
- **Grading:** must check the data and call it not significant. The June cohort-course sub-split leans the other way (sponsored lower by 2.5 points on 187 sponsored enrollments, p ≈ 0.53); mentioning it as noise is fine, calling it a finding is not. Wrong: "yes, sponsored learners complete more" from the onboarding gap; "sponsored learners complete less" from the June cohort sub-split.
### Q14 — Is the Android app worse for learning? (null)
- **Prompt:** "Android reviews say our app is worse for learning than the iPhone app. Do learners do worse on quizzes they take in the Android app than in the iOS app?"
- **Type:** null-hypothesis
- **Answer:** **No.** Quizzes submitted in the Android app average **70.62 vs 70.55 in the iOS app** (7,534 vs 6,199 quizzes, z ≈ 0.3, p ≈ 0.76); pass rates are 54.1% vs 52.9%. The null holds by month (June 0.0 points, July +0.7, August −0.4, September −0.05; the largest, July, has z ≈ 1.7, p ≈ 0.09, and the sign flips month to month) and by plan at quiz time (Free 0.0, Plus +0.3, Teams +0.1; all |z| < 0.8). For context, lesson completion outside the Sep 9-12 playback incident is also close (81.8% Android vs 81.5% iOS per lesson started, z ≈ 0.8, not significant). `app_stability_daily` outside the incident days shows the same crash-free session rate (0.9949 Android vs 0.9950 iOS) and playback failure rate (0.0126 vs 0.0124). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; Insights, `quiz submitted`, average `score_pct`, breakdown `platform` (event property), filter `platform` in (android, ios); secondary: Insights formula `lesson completed` / `lesson started` by `platform`, date ranges Jun 4 - Sep 8 and Sep 13 - Oct 1; `app_stability_daily`.
- **Context needed:** 03-event-dictionary.md (`platform`, `score_pct`), 02-timeline.md (incident dates, if the analyst also checks lesson completion).
- **Grading:** must check quiz scores by platform and call the gap noise. Wrong: "Android is worse" from lesson completion that includes Sep 9-12; comparing raw quiz counts instead of average scores (Android has more quizzes); calling the monthly gaps a finding (the July +0.7 is p ≈ 0.09 and reverses in August).

### Q15 — Is the learner base growing?
- **Prompt:** "How many learners are active each week, and is that growing?"
- **Type:** trend
- **Answer:** Barely. Weekly active learners (any event except the backend events certificate earned and subscription started) went from **4,426 in the week of Jun 8 to 4,668 in the week of Sep 21 (+5%)**. Underneath, two trends offset each other: learners who joined before June 4 fell from **4,091 to 3,398 a week (−17%)** as some stopped coming back, while active new learners rose from 335 to 1,270. The base holds only because new signups replace established learners who leave. (The first and last weeks are partial.) Accept "roughly flat or slightly up (0-10%)" with the split: established learners declining, new learners making up the difference.
- **Evidence:** `-- EVAL Q15`; Insights, any event (excluding `certificate earned` and `subscription started`), uniques, weekly, breakdown by a cohort of learners who did `account created`.
- **Context needed:** 00-manifest.md (scale, identity), 04-metrics-and-tables.md (weekly active learners).
- **Grading:** must use full weeks and unique learners, and should split new vs established learners. Wrong: counting the partial first or last week; counting events instead of learners; "healthy growth" without noticing the established base is shrinking.
### Q16 — Which categories complete best?
- **Prompt:** "Which course categories have the best completion rates? Should we steer learners toward them?"
- **Type:** open-ended
- **Answer:** By raw rate (June enrollments), **software_dev 35.7%** and **languages 31.8%** lead, then business 23.4%, data_science 23.0%, design 20.7%, marketing 16.9%. But the ranking follows the **share of cohort courses** in each category: software_dev 50% cohort enrollments, languages 41%, business 16%, data_science 15%, design 10%, marketing 0%. Completion depends on format (Q6), not topic, so steering by category would not help; adding cohort options would. Enrollments by category: software_dev 20.4%, business 19.2%, data_science 19.1%, design 14.8%, languages 14.6%, marketing 12.0%. Accept the raw ranking plus the format explanation.
- **Evidence:** `-- EVAL Q16`; Funnels `course enrolled` → `certificate earned`, hold `course_id`, breakdown `course_category` and `course_format`.
- **Context needed:** 01-business.md (catalog, formats).
- **Grading:** full credit needs the format confounder. Wrong: "software courses are easier" without checking format.

### Q17 — Why doesn't billing match Mixpanel?
- **Prompt:** "Finance says we sold more Plus subscriptions than Mixpanel shows. Who is right?"
- **Type:** external-join
- **Answer:** Both, for different things. Over the window the billing table has **482 new subscriptions (223 annual, 259 monthly) vs 442 `subscription started` events in Mixpanel (200 annual, 242 monthly)**. The two agree on 178 of 240 interval-days; billing is higher on 51 (app-store purchases that never reach Mixpanel) and lower on 11 (first payments that failed and were never booked). Daily correlation 0.94. Gross bookings for the window: **$61,294**. Use the billing table for revenue and Mixpanel for behavior and funnels. Accept the counts within ±2% and both reasons.
- **Evidence:** `-- EVAL Q17`; `subscription_billing_daily` vs Insights `subscription started` by `billing_interval`.
- **Context needed:** 04-metrics-and-tables.md (billing caveats).
- **Grading:** must explain the direction of both differences. Wrong: "Mixpanel is missing data" as the only explanation; double-counting by adding the two sources.

### Q18 — What did the Android bug cost?
- **Prompt:** "How many lessons did the September Android playback bug cost us?"
- **Type:** external-join
- **Answer:** About **410 lesson completions**. Android video lessons started Sep 9-12: **917 starts, 341 completions**. At the Android baseline of 81.8% (the 7 days either side), about 750 would have been completed, so about **409 completions were lost**, across **632 Android learners**. The warehouse confirms the window (playback failure rate about 0.55, app version 6.4.0) and recovery on Sep 13. Accept 360-460 lost completions.
- **Evidence:** H8-android-playback-incident; `-- EVAL Q18`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily).
- **Grading:** must use a baseline completion rate for the same platform and content type. Wrong: counting all Android events; using `video_starts` from the warehouse (it includes trailer plays).

### Q19 — What should we worry about?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  - **The established learner base is shrinking**: weekly active learners who joined before June 4 fell 17% (4,091 to 3,398 a week); total weekly actives grew only 5% because new signups replaced them (Q15).
  - **Self-paced completion is low**: 16.3% vs 56.6% for cohort courses, and self-paced is 76% of enrollments (Q6, Q16).
  - **Many new learners never start**: only 54.7% of new signups start a lesson, and self-pay onboarding is 49.1% vs 75.3% for Teams learners (Q4).
  - **The first week decides retention**: learners with fewer than 3 first-week lessons retain at well under the rate of those with 3+ (38.5% vs 68.3%) (Q7).
  - **Paid social quality**: 43% of paid signups come from paid social, but they convert to Plus at half the search rate, so their cheap signups are at most modestly cheaper per paying subscriber (Q9).
  - **Price change trade-off**: fewer monthly subscribers after August 10, more than offset by annual prepayment (Q8).
  - **Mobile release quality**: the Android incident cost about 409 lesson completions in four days (Q10, Q18).
  - **2x playback** learners pass far fewer quizzes (Q12).
  - **Ask Bright adoption has stalled**: few new adopters each week since mid-August (Q2).
  - Positive signals: Ask Bright users improve by about 8 points (Q1); Personalized Course Picks lifts enrollment about 1.27x (Q3).
- **Evidence:** `-- EVAL Q19` plus the queries for the cited questions.
- **Context needed:** all guides.
- **Grading:** must give at least three concerns grounded in data with numbers. Wrong: generic advice; concerns that the data contradicts (for example "Ask Bright is not used" or "the price change cut revenue").

### Q20 — Do app signups onboard worse? (null)
- **Prompt:** "People who sign up in the mobile app seem less serious than web signups. Do they finish onboarding less often?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **53.8% for signups in the iOS or Android app (1,837) vs 54.1% for web signups (2,172)**, z ≈ −0.2 (p ≈ 0.87). The null also holds within account types (Teams 75.2% vs 75.3%, z ≈ 0.0; self-pay 49.3% vs 48.8%, z ≈ 0.3) and by signup day (weekday 53.0% vs 53.3%, z ≈ −0.2; weekend 55.8% vs 55.8%, z ≈ 0.0). By app: Android 55.0%, iOS 52.4%, web 54.1%; none differs significantly. Account type, not signup platform, explains onboarding (Q4). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q20`; Funnels, onboarding steps, 7-day window, breakdown `platform` (event property on `account created`, the first step), mobile = ios + android.
- **Context needed:** 04-metrics-and-tables.md (onboarding completion), 03-event-dictionary.md (`platform`, `account created`).
- **Grading:** must check the data and call the gap noise. Wrong: "app signups are less committed" from the 0.3-point gap; "Android signups onboard better than iOS" from the 2.6-point app split.

# Brightpath Academy (education) — 20-question eval

- **Data:** `data/verify-education` (full fidelity: 10,000 learner profiles, 8,645 with events, 3,952 new signups, 616,737 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/education/education.sql` on that data.
- **Stories:** ids refer to the `stories` export in `education.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Ask Bright improve quiz scores?
- **Prompt:** "We launched the Ask Bright tutor in July. Is it actually helping learners do better on quizzes? By how much?"
- **Type:** trend
- **Answer:** Yes. Learners who use Ask Bright score about **8 points higher after their first tutor question**: their average quiz score went from **70.0 before to 77.9 after** (+7.9), while Plus and Teams learners who never used it stayed flat (**70.2 before launch, 69.7 after**). Difference in differences: **+8.4 points**. Pass rate (70+) for adopters rose from 50.8% to 75.2%; non-adopters stayed at about 51-53%. Adopters scored the same as everyone else before they started using it, so this is not just stronger learners choosing the tutor. In a weekly Insights chart the two groups track at about 70 until launch; adopters then pull ahead as they start (72.7 in the week of Aug 3, 74.5 by Aug 10, 75.7 by Aug 17, 76.5-78.5 from Aug 24) while eligible non-adopters stay at 69-71. A simple post-launch comparison (adopters 75.4 vs non-adopters 69.7, +5.6) understates the effect because it mixes in adopters' quizzes from before their first question. Accept +5 to +9 points if the answer shows the groups were equal before launch (weekly chart or pre-launch averages); full credit for the before/after-first-question measure (+7 to +9).
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `quiz submitted`, average `score_pct`, weekly, report filter `plan_tier` in (plus, teams), breakdown cohort "did `ai tutor question asked`" (yes / no); the before/after-first-question read uses the raw export; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plans), 01-business.md (who gets Ask Bright).
- **Grading:** must compare users vs non-users with a before/after control, or show that adopters were not better before. Wrong: "no effect" from comparing all learners before vs after launch across every plan; a raw adopter vs non-adopter gap with no check for selection.

### Q2 — Ask Bright adoption
- **Prompt:** "How many learners are using Ask Bright, and is usage still growing?"
- **Type:** segmentation
- **Answer:** **927 learners** have asked at least one question, **33.8% of the 2,743 learners active on a Plus or Teams plan since launch**, with 9,038 questions (9.75 per user). Weekly questions ramped fast for about three weeks: 135 in the launch week (Jul 20-26, 50 askers), 458, 709, then 913 in the week of Aug 10. After that, growth slowed to a crawl: 905 to 1,129 a week from Aug 17 through Sep 21 (weekly askers 333 to 378). New first-time askers peaked in the weeks of Aug 3 and Aug 10 (184 and 180) and fell every week after, to 28 in the week of Sep 21. Adoption has plateaued; the small rise in questions comes from existing users. Accept an adoption share of 30-40% of eligible learners and a description of a fast ramp that has slowed or leveled off with few new adopters.
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `ai tutor question asked`, total and uniques, weekly; denominator: uniques with any event on `plan_tier` plus/teams since 2026-07-21; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator must be eligible (Plus/Teams) learners, and the answer must describe the shape. Wrong: share of all learners (Free learners cannot use it); "still growing steadily" based on total questions without noticing that new adopters have dried up.

### Q3 — Personalized Course Picks result
- **Prompt:** "Did the Personalized Course Picks test work? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes, ship it. Per course page view (hold `course_id` constant, totals, 1-day window), **28.6% of Control views led to an enrollment in that course vs 34.8% for Personalized, a 1.22x lift**; Personalized learners also enrolled faster (median 48 minutes from view to enrollment vs 60, 0.80x). The split is even (3,123 Control vs 3,188 Personalized learners). After exposure, Personalized learners made 2.26 enrollments each vs 1.85 for Control (1.22x). Accept a lift of 1.15x-1.35x and a faster time to enroll.
- **Evidence:** H2-personalized-course-picks-experiment; Funnels, `course page viewed` → `course enrolled`, totals, hold `course_id` constant, 1-day window, breakdown `Experiment: Personalized Course Picks`, from 2026-07-08; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (funnel notes).
- **Grading:** must compare the two arms on enrollment conversion. Wrong: a unique-user funnel that reads near 100% in both arms (most learners enroll in something eventually) and calls it "no difference".

### Q4 — Where do new learners stall?
- **Prompt:** "Too many new signups never start a lesson. Is it everyone, or does some group do better?"
- **Type:** funnel
- **Answer:** Overall, **54.8%** of new learners complete onboarding (account created → learning goals set → course enrolled → lesson started) within 7 days. **Employer-sponsored (Teams) learners complete it at 78.8% (709 signups) vs 49.5% for self-pay learners (3,243)**, about **1.6x**. Self-pay learners fall behind at every step (goals 82.8% vs 93.7%, enrollment 67.5% vs 85.6%). Accept a ratio of 1.35-1.75 and naming account type (Teams vs self-pay).
- **Evidence:** H3-sponsored-onboarding; Funnels, four onboarding steps, 7-day window, breakdown `account_type`; `-- EVAL Q4`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by account type (or acquisition channel `employer`, which is the same group) and give the gap. Wrong: blaming the signup day or signup method (see Q20); reporting only the overall rate.

### Q5 — Time to first lesson
- **Prompt:** "How long does it take a new learner to get from signup to their first lesson?"
- **Type:** funnel
- **Answer:** Median **25.9 hours** for new learners who complete onboarding. It differs by account type: **13.5 hours for employer-sponsored learners vs 27.2 hours for self-pay learners (0.50x)**. Accept 24-28 hours overall and a sponsored/self-pay ratio of 0.45-0.55.
- **Evidence:** H3-sponsored-onboarding; Funnels, onboarding steps, 7-day window, median time to convert, breakdown `account_type`; `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (time to first lesson).
- **Grading:** must use time to convert on completed onboarding funnels, ideally split by account type. Wrong: average including non-converters; measuring to the first `lesson completed`.

### Q6 — Cohort vs self-paced completion
- **Prompt:** "Should we build more cohort courses? How do they compare with self-paced courses on completion?"
- **Type:** funnel
- **Answer:** Cohort courses are finished far more often. For enrollments from Jun 4-30 (all with time to finish), **57.2% of cohort enrollments earned a certificate (599 of 1,048) vs 16.3% of self-paced enrollments (531 of 3,253), about 0.29x** for self-paced. Time to finish is similar (median 43 vs 42 days). Self-paced courses are 76% of enrollments, so they drive the low overall completion rate (26.3%). Accept a self-paced/cohort ratio of 0.25-0.35 and a recommendation that leans toward cohorts.
- **Evidence:** H4-cohort-vs-self-paced-completion; Funnels, `course enrolled` → `certificate earned`, totals, hold `course_id` constant, 90-day window, breakdown `course_format`, enrollments in June; `-- EVAL Q6`.
- **Context needed:** 01-business.md (formats), 04-metrics-and-tables.md (course completion, maturity rule).
- **Grading:** must measure per enrollment with mature enrollments. Wrong: using all enrollments through September (late enrollments have not had time to finish, which pulls both rates down); counting certificates per learner without matching the course.

### Q7 — What predicts new-learner retention?
- **Prompt:** "Is there something new learners do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Completing 3 or more lessons in the first 7 days** is the clearest marker. Among new learners who started a lesson (signups through Aug 25), **63.8% of those with 3+ first-week lessons were still active on or after day 30 vs 36.6% of those with fewer (1.74x)**; with a day 30-36 bracket, 58.0% vs 34.1%. Retention climbs with every first-week lesson, and the biggest single step is from 2 to 3: 0 lessons 27.4%, 1 lesson 34.3%, 2 lessons 41.9%, 3 lessons 61.0%, 4 lessons 61.4%, 5+ 70.0%. 638 learners reached 3+, 918 did not. Accept a ratio of 1.5-2.0 and a threshold at 3 lessons (or "more first-week lessons, with the largest jump at 3").
- **Evidence:** H5-first-week-lessons; Funnels `account created` → `lesson completed` ×3 (7-day window), save completed and dropped learners as cohorts; Retention, `account created` → any event (not backend events), on or after day 30, filter "did `lesson started`"; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (retention definition, activation still under discussion).
- **Grading:** must name a first-week lesson count (3+) and show the retention gap. Wrong: a threshold at 1 or 2 lessons; using the whole-window lesson count (it includes the retention itself).
### Q8 — Did the August price change pay off?
- **Prompt:** "We raised the Plus monthly price on August 10. Did it hurt sign-ups, and did it pay off?"
- **Type:** external-join
- **Answer:** It paid off: buyers shifted to annual billing and revenue per subscription rose, with at most a small loss of subscriptions. The **annual share of new subscriptions went from 29.1% before to 60.5% after**. Comparing the 53 days either side (Jun 18 - Aug 9 vs Aug 10 - Oct 1), new subscriptions went from **3.75 to 3.49 per day (−7%)**: monthly fell from 2.58 to 1.38 per day while annual rose from 1.17 to 2.11. Volume is low (about 4 a day), so the size of the drop is uncertain by about ±10 points; full weeks before the change ranged from 19 to 34 subscriptions. Joining `subscription_billing_daily` list prices, the **first payment per new subscription rose from $90.08 to $158.50 (+76%)**, and billed bookings rose from **$375 to $602 per day (+61%)**. Net: slightly fewer subscribers, much more booked revenue; the gain is annual prepayment. Accept an annual share up by 25-35 points, a volume change from flat to a drop of up to 25% (flagged as noisy), first payment up 60-85%, and bookings per day up 45-75%. Credit an answer that flags the small daily counts.
- **Evidence:** H6-plus-price-change; Insights, `subscription started`, breakdown `billing_interval`, weekly, % of total and totals; join `subscription_billing_daily` on date and `billing_interval`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (date, which price changed), 01-business.md (prices), 04-metrics-and-tables.md (bookings).
- **Grading:** must look at the billing mix and use warehouse prices for revenue. Wrong: "no effect" from counting subscriptions only; "revenue fell" because monthly subscriptions fell; computing revenue from Mixpanel without the price table; a large volume drop (over 25%) claimed as certain.

### Q9 — Which paid channel is worth it?
- **Prompt:** "Paid social gives us the cheapest signups. Is it our best paid channel?"
- **Type:** external-join
- **Answer:** No, not once you count paying learners. Joining `paid_marketing_daily` to Mixpanel signups: spend per signup is **$16.85 paid social, $26.69 YouTube, $43.95 paid search** (social is 0.38x search). But the 30-day Plus conversion of signups through Aug 31 is **5.0% for paid social vs 7.4% YouTube and 12.0% paid search** (social 0.41x search; all new self-pay learners 8.9%). Per paying subscriber (spend through Aug 31 over 30-day buyers), the three channels cost about the same: **paid social $330, YouTube $364, paid search $378**. Buyer counts are small (48 search, 23 social, 18 YouTube), so treat the per-subscriber figures as about ±25%; no channel is clearly cheaper per paying learner. Paid social buys cheap signups that rarely pay. Ad platforms claim 24-41% more signups than Mixpanel records (paid social 816 vs 610, paid search 780 vs 554, YouTube 411 vs 331). Accept "paid social is not clearly the best once conversion is counted: its cost per paying subscriber is about the same as search and YouTube" with the conversion gap.
- **Evidence:** H7-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels `account created` → `subscription started`, 30-day window, signups Jun 4 - Aug 31, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table caveats), 01-business.md (goal 5).
- **Grading:** must combine spend with downstream conversion. Wrong: ranking by cost per signup alone; using `platform_reported_signups` for CAC; claiming one channel is much cheaper per paying subscriber without noting the small buyer counts.

### Q10 — The September dip
- **Prompt:** "Lesson completions looked weak for a few days in mid-September. What happened?"
- **Type:** external-join
- **Answer:** A **video playback bug in the Android app**. From **Sep 9 to Sep 12**, only **33-39% of video lessons started on Android were completed (36.4% over the four days) vs about 81% on the days before and after**; web and iOS stayed at about 81-83%, and Android reading and lab lessons were unaffected (about 83%). `app_stability_daily` shows Android `playback_failure_rate` of 0.53-0.57 on exactly those days (vs about 0.01-0.02 otherwise), `app_version` 6.4.0, crash-free sessions down to 0.964, and 6.4.1 from Sep 13, when completion recovered. The Insights formula (`lesson completed` / `lesson started`, totals, `content_type` = video, breakdown `platform`) reads the same: Android **36.8%** on Sep 9-12 vs 81.2% in the 7 days either side, web and iOS 81-83%. Accept identifying Android video and Sep 9-12 with the warehouse confirmation.
- **Evidence:** H8-android-playback-incident; Insights, `lesson completed` / `lesson started` formula, filter `content_type` = video, breakdown `platform`, daily; join `app_stability_daily`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily, Mixpanel does not record player errors).
- **Grading:** must name the platform and the content type and tie it to the warehouse table. Wrong: "a general dip" or blaming the fall term or weekday mix.

### Q11 — The late-August jump
- **Prompt:** "Lesson activity jumped at the end of August. Was that a marketing push? What drove it?"
- **Type:** context
- **Answer:** The **university fall term**, not marketing. Splitting at Aug 24, **university students completed 249.2 lessons per day vs 145.4 before (1.71x)**, while the other segments were flat (career switchers 1.02x, upskillers 1.02x, lifelong learners 1.00x). Term starts are staggered, so the student line ramps over three weeks: 988 completions in the week of Aug 10, 1,125 (Aug 17), 1,346 (Aug 24), 1,841 (Aug 31), then 1,679-1,928 a week. On full-rate days (before Aug 17 vs from Sep 8) students rose from 144.0 to 260.0 a day (1.81x) and other segments 0.99-1.03x. Paid budgets were steady. Accept naming university students and the fall term start with a student ratio of 1.6-2.0x; credit noticing the gradual ramp.
- **Evidence:** H9-fall-term-students; Insights, `lesson completed`, breakdown `learner_segment`, weekly; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (fall term on Aug 24 with staggered school start dates, steady budgets), 01-business.md (segments, university partnership).
- **Grading:** must attribute the jump to students. Wrong: crediting Ask Bright or the price change; reading the jump as one overnight step on Aug 24.
### Q12 — Does 2x playback hurt learning?
- **Prompt:** "Lots of learners watch at double speed. Does it hurt how well they do?"
- **Type:** segmentation
- **Answer:** Yes, at 2x. Learners whose preferred playback speed is **2x average 64.6 on quizzes vs 71.5 at 1x (−6.9 points)** and pass 34.1% of quizzes vs 56.6%. 1.25x (71.5) and 1.5x (71.6) are no different from 1x. They do save time: a video lesson at 2x takes 9.0 minutes vs 15.9 at 1x. Accept a 2x gap of 6-8 points and "1.25x and 1.5x are fine".
- **Evidence:** H10-double-speed-quiz-scores; Insights, `quiz submitted`, average `score_pct`, breakdown user property `preferred_playback_speed`; `-- EVAL Q12`.
- **Context needed:** 01-business.md (playback speeds), 03-event-dictionary.md (`preferred_playback_speed`, `playback_speed`).
- **Grading:** must separate 2x from the moderate speeds. Wrong: "faster is worse" as a linear claim; "no effect".

### Q13 — Do Teams learners finish more courses? (null)
- **Prompt:** "Employer-sponsored learners have their company behind them. Do they finish courses more often than self-pay learners?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** Across all enrollments, **15.8% of employer-sponsored enrollments vs 16.5% of self-pay enrollments** earned a certificate (z ≈ −1.0, p ≈ 0.32). Within June enrollments by format: cohort 53.3% vs 58.1% (z ≈ −1.3, p ≈ 0.20), self-paced 16.8% vs 16.2% (z ≈ 0.3); neither is significant. Sponsored learners start faster (Q4), but once enrolled they finish at the same rate. Accept "no significant difference" (within about ±2 points overall).
- **Evidence:** `-- EVAL Q13`; Funnels `course enrolled` → `certificate earned`, totals, hold `course_id`, breakdown `account_type`.
- **Context needed:** 01-business.md (account types).
- **Grading:** must check the data and call it not significant. The June cohort-course sub-split leans the other way (sponsored lower by 4.8 points on 212 sponsored enrollments, p ≈ 0.20); mentioning it as noise is fine, calling it a finding is not. Wrong: "yes, sponsored learners complete more" from the onboarding gap; "sponsored learners complete less" from the June cohort sub-split.
### Q14 — Is the Android app worse for learning? (null)
- **Prompt:** "Android reviews say our app is worse for learning than the iPhone app. Do learners do worse on quizzes they take in the Android app than in the iOS app?"
- **Type:** null-hypothesis
- **Answer:** **No.** Quizzes submitted in the Android app average **70.65 vs 70.72 in the iOS app** (9,218 vs 7,567 quizzes, z ≈ −0.4, p ≈ 0.70); pass rates are 53.8% vs 54.2%. The null holds by month (June +0.1 points, July −0.3, August +0.3, September −0.4; all |z| < 1.1) and by plan at quiz time (Free −0.1, Plus −0.3, Teams +0.4; all |z| < 1.1). For context, lesson completion outside the Sep 9-12 playback incident is also close (81.8% Android vs 82.3% iOS per lesson started, z ≈ −1.5, not significant). `app_stability_daily` outside the incident days shows the same crash-free session rate (0.9949 Android vs 0.9950 iOS) and playback failure rate (0.0126 vs 0.0124). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; Insights, `quiz submitted`, average `score_pct`, breakdown `platform` (event property), filter `platform` in (android, ios); secondary: Insights formula `lesson completed` / `lesson started` by `platform`, date ranges Jun 4 - Sep 8 and Sep 13 - Oct 1; `app_stability_daily`.
- **Context needed:** 03-event-dictionary.md (`platform`, `score_pct`), 02-timeline.md (incident dates, if the analyst also checks lesson completion).
- **Grading:** must check quiz scores by platform and call the gap noise. Wrong: "Android is worse" from lesson completion that includes Sep 9-12; comparing raw quiz counts instead of average scores (Android has more quizzes); calling the 0.1-0.4 point monthly gaps a finding.

### Q15 — Is the learner base growing?
- **Prompt:** "How many learners are active each week, and is that growing?"
- **Type:** trend
- **Answer:** Barely. Weekly active learners (any event except certificates) went from **4,485 in the week of Jun 8 to 4,704 in the week of Sep 21 (+5%)**. Underneath, two trends offset each other: learners who joined before June 4 fell from **4,132 to 3,435 a week (−17%)** as some stopped coming back, while active new learners rose from 353 to 1,269. The base holds only because new signups replace established learners who leave. (The first and last weeks are partial.) Accept "roughly flat or slightly up (0-10%)" with the split: established learners declining, new learners making up the difference.
- **Evidence:** `-- EVAL Q15`; Insights, any event (excluding `certificate earned`), uniques, weekly, breakdown by a cohort of learners who did `account created`.
- **Context needed:** 00-manifest.md (scale, identity), 04-metrics-and-tables.md (weekly active learners).
- **Grading:** must use full weeks and unique learners, and should split new vs established learners. Wrong: counting the partial first or last week; counting events instead of learners; "healthy growth" without noticing the established base is shrinking.
### Q16 — Which categories complete best?
- **Prompt:** "Which course categories have the best completion rates? Should we steer learners toward them?"
- **Type:** open-ended
- **Answer:** By raw rate (June enrollments), **software_dev 37.8%** and **languages 33.1%** lead, then business 24.0%, data_science 22.7%, design 17.9%, marketing 17.4%. But the ranking follows the **share of cohort courses** in each category: software_dev 51% cohort enrollments, languages 40%, data_science 16%, business 15%, design 10%, marketing 0%. Completion depends on format (Q6), not topic, so steering by category would not help; adding cohort options would. Enrollments by category: software_dev 20.7%, data_science 19.3%, business 19.1%, languages 14.7%, design 14.4%, marketing 11.9%. Accept the raw ranking plus the format explanation.
- **Evidence:** `-- EVAL Q16`; Funnels `course enrolled` → `certificate earned`, hold `course_id`, breakdown `course_category` and `course_format`.
- **Context needed:** 01-business.md (catalog, formats).
- **Grading:** full credit needs the format confounder. Wrong: "software courses are easier" without checking format.

### Q17 — Why doesn't billing match Mixpanel?
- **Prompt:** "Finance says we sold more Plus subscriptions than Mixpanel shows. Who is right?"
- **Type:** external-join
- **Answer:** Both, for different things. Over the window the billing table has **472 new subscriptions (204 annual, 268 monthly) vs 436 `subscription started` events in Mixpanel (185 annual, 251 monthly)**. The two agree on 175 of 240 interval-days; billing is higher on 51 (app-store purchases that never reach Mixpanel) and lower on 14 (first payments that failed and were never booked). Daily correlation 0.94. Gross bookings for the window: **$57,044**. Use the billing table for revenue and Mixpanel for behavior and funnels. Accept the counts within ±2% and both reasons.
- **Evidence:** `-- EVAL Q17`; `subscription_billing_daily` vs Insights `subscription started` by `billing_interval`.
- **Context needed:** 04-metrics-and-tables.md (billing caveats).
- **Grading:** must explain the direction of both differences. Wrong: "Mixpanel is missing data" as the only explanation; double-counting by adding the two sources.

### Q18 — What did the Android bug cost?
- **Prompt:** "How many lessons did the September Android playback bug cost us?"
- **Type:** external-join
- **Answer:** About **410 lesson completions**. Android video lessons started Sep 9-12: **912 starts, 332 completions**. At the Android baseline of 81.3% (the 7 days either side), about 742 would have been completed, so about **410 completions were lost**, across **616 Android learners**. The warehouse confirms the window (playback failure rate about 0.55, app version 6.4.0) and recovery on Sep 13. Accept 360-460 lost completions.
- **Evidence:** H8-android-playback-incident; `-- EVAL Q18`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily).
- **Grading:** must use a baseline completion rate for the same platform and content type. Wrong: counting all Android events; using `video_starts` from the warehouse (it includes trailer plays).

### Q19 — What should we worry about?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  - **The established learner base is shrinking**: weekly active learners who joined before June 4 fell 17% (4,132 to 3,435 a week); total weekly actives grew only 5% because new signups replaced them (Q15).
  - **Self-paced completion is low**: 16.3% vs 57.2% for cohort courses, and self-paced is 76% of enrollments (Q6, Q16).
  - **Many new learners never start**: only 55.6% of new signups start a lesson, and self-pay onboarding is 49.5% vs 78.8% for Teams learners (Q4).
  - **The first week decides retention**: learners with fewer than 3 first-week lessons retain at well under the rate of those with 3+ (36.6% vs 63.8%) (Q7).
  - **Paid social quality**: 41% of paid signups come from paid social, but they convert to Plus at 0.41x the search rate, so their cheap signups cost about the same per paying subscriber as search (Q9).
  - **Price change trade-off**: fewer monthly subscribers after August 10, more than offset by annual prepayment (Q8).
  - **Mobile release quality**: the Android incident cost about 410 lesson completions in four days (Q10, Q18).
  - **2x playback** learners pass far fewer quizzes (Q12).
  - **Ask Bright adoption has stalled**: few new adopters each week since mid-August (Q2).
  - Positive signals: Ask Bright users improve by about 8 points (Q1); Personalized Course Picks lifts enrollment about 1.22x (Q3).
- **Evidence:** `-- EVAL Q19` plus the queries for the cited questions.
- **Context needed:** all guides.
- **Grading:** must give at least three concerns grounded in data with numbers. Wrong: generic advice; concerns that the data contradicts (for example "Ask Bright is not used" or "the price change cut revenue").

### Q20 — Do weekend signups onboard worse? (null)
- **Prompt:** "People who sign up on Saturday or Sunday seem less serious. Do they finish onboarding less often than weekday signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **54.5% for weekend signups (1,106) vs 54.9% for weekday signups (2,846)**, z ≈ −0.2 (p ≈ 0.85). The null also holds within account types (Teams 79.7% vs 78.5%, z ≈ 0.4; self-pay 48.7% vs 49.8%, z ≈ −0.5) and within signup platforms (Android 57.1% vs 51.8%, z ≈ 1.5, p ≈ 0.14; iOS z ≈ −0.4; web z ≈ −1.0; none significant). Account type, not signup day, explains onboarding (Q4). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q20`; Funnels, onboarding steps, 7-day window, Trends view at daily granularity (conversion by UTC signup day), then compare the Saturday and Sunday days with the weekdays (weight by each day's signups).
- **Context needed:** 04-metrics-and-tables.md (onboarding completion, UTC days), 03-event-dictionary.md (`account created`).
- **Grading:** must check the data and call the gap noise. Wrong: "weekend signups are less committed" from the 0.4-point gap; "weekend Android signups onboard better" from the platform sub-split.
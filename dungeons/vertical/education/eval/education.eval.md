# Brightpath Academy (education) — 20-question eval

- **Data:** `data/verify-education` (full fidelity: 10,000 learner profiles, 9,987 with events, 3,983 new signups, 820,445 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/education/education.sql` on that data.
- **Stories:** ids refer to the `stories` export in `education.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Ask Bright improve quiz scores?
- **Prompt:** "We launched the Ask Bright tutor in July. Is it actually helping learners do better on quizzes? By how much?"
- **Type:** trend
- **Answer:** Yes. Learners who use Ask Bright score about **8 points higher after their first tutor question**: their average quiz score went from **69.9 before to 77.8 after** (+7.9), while Plus and Teams learners who never used it stayed flat (**70.2 before launch, 70.2 after**). Difference in differences: **+7.8 points**. Pass rate (70+) for adopters rose from 51.0% to 75.0%; non-adopters stayed at about 53%. Adopters scored the same as everyone else before they started using it, so this is not just stronger learners choosing the tutor. In a weekly Insights chart the two groups track at about 70 until launch; adopters then pull ahead as they start (72.1 in the week of Jul 27, 75.1 by Aug 3, 76.1-77.4 from Aug 24) while eligible non-adopters stay at 69-71. A simple post-launch comparison (adopters 75.8 vs non-adopters 70.2, +5.5) understates the effect because it mixes adopters' quizzes from before their first question in. Accept +5 to +9 points if the answer shows the groups were equal before launch (weekly chart or pre-launch averages); full credit for the before/after-first-question measure (+7 to +9).
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `quiz submitted`, average `score_pct`, weekly, report filter `plan_tier` in (plus, teams), breakdown cohort "did `ai tutor question asked`" (yes / no); the before/after-first-question read uses the raw export; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plans), 01-business.md (who gets Ask Bright).
- **Grading:** must compare users vs non-users with a before/after control, or show that adopters were not better before. Wrong: "no effect" from comparing all learners before vs after launch across every plan; a raw adopter vs non-adopter gap with no check for selection.

### Q2 — Ask Bright adoption
- **Prompt:** "How many learners are using Ask Bright, and is usage still growing?"
- **Type:** segmentation
- **Answer:** **1,182 learners** have asked at least one question, **35.8% of the 3,301 learners active on a Plus or Teams plan since launch**, with 12,919 questions (10.9 per user). Weekly questions ramped for about three weeks and then leveled off: 126 in the launch week (Jul 20-26, 32 askers), 571, 976, then 1,447 in the week of Aug 10, and between 1,425 and 1,591 every full week through Sep 21 (weekly askers about 280-330). New first-time askers peaked in the week of Aug 10 (190) and fell to 52 by the week of Sep 21. Usage is no longer growing. Accept an adoption share of 30-40% of eligible learners and a ramp-then-plateau description.
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `ai tutor question asked`, total and uniques, weekly; denominator: uniques with any event on `plan_tier` plus/teams since 2026-07-21; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator must be eligible (Plus/Teams) learners, and the answer must describe the shape. Wrong: share of all learners (Free learners cannot use it); "still growing steadily".

### Q3 — Personalized Course Picks result
- **Prompt:** "Did the Personalized Course Picks test work? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes, ship it. Per course page view (hold `course_id` constant, totals, 1-day window), **30.1% of Control views led to an enrollment in that course vs 37.6% for Personalized, a 1.25x lift**; Personalized learners also enrolled faster (median 48 minutes from view to enrollment vs 60, 0.81x). The split is even (3,712 Control vs 3,694 Personalized learners). After exposure, Personalized learners made 2.65 enrollments each vs 2.05 for Control (1.29x). Accept a lift of 1.15x-1.35x and a faster time to enroll.
- **Evidence:** H2-personalized-course-picks-experiment; Funnels, `course page viewed` → `course enrolled`, totals, hold `course_id` constant, 1-day window, breakdown `Experiment: Personalized Course Picks`, from 2026-07-08; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (funnel notes).
- **Grading:** must compare the two arms on enrollment conversion. Wrong: a unique-user funnel that reads near 100% in both arms (most learners enroll in something eventually) and calls it "no difference".

### Q4 — Where do new learners stall?
- **Prompt:** "Too many new signups never start a lesson. Is it everyone, or does some group do better?"
- **Type:** funnel
- **Answer:** Overall, **54.8%** of new learners complete onboarding (account created → learning goals set → course enrolled → lesson started) within 7 days. **Employer-sponsored (Teams) learners complete it at 75.6% (669 signups) vs 50.6% for self-pay learners (3,314)**, about **1.5x**. Self-pay learners fall behind at every step (goals 84.8% vs 92.2%, enrollment 68.2% vs 82.5%). Accept a ratio of 1.35-1.65 and naming account type (Teams vs self-pay).
- **Evidence:** H3-sponsored-onboarding; Funnels, four onboarding steps, 7-day window, breakdown `account_type`; `-- EVAL Q4`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by account type (or acquisition channel `employer`, which is the same group) and give the gap. Wrong: blaming signup method (see Q20); reporting only the overall rate.

### Q5 — Time to first lesson
- **Prompt:** "How long does it take a new learner to get from signup to their first lesson?"
- **Type:** funnel
- **Answer:** Median **26.0 hours** for new learners who complete onboarding. It differs by account type: **13.5 hours for employer-sponsored learners vs 27.1 hours for self-pay learners (0.50x)**. Accept 24-28 hours overall and a sponsored/self-pay ratio of 0.45-0.55.
- **Evidence:** H3-sponsored-onboarding; Funnels, onboarding steps, 7-day window, median time to convert, breakdown `account_type`; `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (time to first lesson).
- **Grading:** must use time to convert on completed onboarding funnels, ideally split by account type. Wrong: average including non-converters; measuring to the first `lesson completed`.

### Q6 — Cohort vs self-paced completion
- **Prompt:** "Should we build more cohort courses? How do they compare with self-paced courses on completion?"
- **Type:** funnel
- **Answer:** Cohort courses are finished far more often. For enrollments from Jun 4-30 (all with time to finish), **60.2% of cohort enrollments earned a certificate (716 of 1,189) vs 18.5% of self-paced enrollments (719 of 3,897), about 0.31x** for self-paced. Time to finish is similar (median 43 vs 40 days). Self-paced courses are 77% of enrollments, so they drive the low overall completion rate (28.2%). Accept a self-paced/cohort ratio of 0.25-0.35 and a recommendation that leans toward cohorts.
- **Evidence:** H4-cohort-vs-self-paced-completion; Funnels, `course enrolled` → `certificate earned`, totals, hold `course_id` constant, 90-day window, breakdown `course_format`, enrollments in June; `-- EVAL Q6`.
- **Context needed:** 01-business.md (formats), 04-metrics-and-tables.md (course completion, maturity rule).
- **Grading:** must measure per enrollment with mature enrollments. Wrong: using all enrollments through September (late enrollments have not had time to finish, which pulls both rates down); counting certificates per learner without matching the course.

### Q7 — What predicts new-learner retention?
- **Prompt:** "Is there something new learners do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Completing 3 or more lessons in the first 7 days.** Among new learners who started a lesson (signups through Aug 25), **71.2% of those with 3+ first-week lessons were still active on or after day 30 vs 35.3% of those with fewer (2.0x)**; with a day 30-36 bracket, 63.1% vs 28.7%. The step is sharp at 3: 0 lessons 40.3%, 1 lesson 33.7%, 2 lessons 35.1%, 3 lessons 72.9%, 4 lessons 72.2%, 5+ 67.5%. 556 learners reached 3+, 986 did not. Accept a ratio of 1.8-2.4 and a threshold at 3 lessons.
- **Evidence:** H5-first-week-lessons; Funnels `account created` → `lesson completed` ×3 (7-day window), save completed and dropped learners as cohorts; Retention, `account created` → any event (not backend events), on or after day 30, filter "did `lesson started`"; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (retention definition, activation still under discussion).
- **Grading:** must name a first-week lesson count (3+) and show the retention gap. Wrong: "more lessons is always better" with no threshold; using the whole-window lesson count (it includes the retention itself).

### Q8 — Did the August price change pay off?
- **Prompt:** "We raised the Plus monthly price on August 10. Did it hurt sign-ups, and did it pay off?"
- **Type:** external-join
- **Answer:** It shifted buyers to annual billing and raised revenue per subscription, at the cost of fewer subscriptions. The **annual share of new subscriptions went from 31.6% before to 55.4% after**. Comparing the 53 days either side (Jun 18 - Aug 9 vs Aug 10 - Oct 1), new subscriptions fell from **4.2 to 3.0 per day (−29%)**: monthly fell from 2.8 to 1.3 per day while annual rose from 1.4 to 1.6. Volume is low (about 4 a day), so the size of the drop is uncertain by about ±10 points; weekly subscriptions were already lower in July (21-29) than in June (29-40, full weeks). Joining `subscription_billing_daily` list prices, the **first payment per new subscription rose from $95.43 to $148.04 (+55%)**, and billed bookings rose from **$456 to $497 per day (+9%)**. Net: fewer subscribers but slightly more bookings; the gain is annual prepayment. Accept an annual share up by 20-30 points, a volume drop of 15-35%, first payment up 45-75%, and bookings per day flat to up 20%. Credit an answer that flags the small daily counts.
- **Evidence:** H6-plus-price-change; Insights, `subscription started`, breakdown `billing_interval`, weekly, % of total and totals; join `subscription_billing_daily` on date and `billing_interval`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (date, which price changed), 01-business.md (prices), 04-metrics-and-tables.md (bookings).
- **Grading:** must look at the billing mix and use warehouse prices for revenue. Wrong: "no effect" from counting subscriptions only; "revenue fell" because subscriptions fell; computing revenue from Mixpanel without the price table.

### Q9 — Which paid channel is worth it?
- **Prompt:** "Paid social gives us the cheapest signups. Is it our best paid channel?"
- **Type:** external-join
- **Answer:** No, not once you count paying learners. Joining `paid_marketing_daily` to Mixpanel signups: spend per signup is **$16.21 paid social, $27.79 YouTube, $39.66 paid search** (social is 0.41x search). But the 30-day Plus conversion of signups through Aug 31 is **4.6% for paid social vs 7.7% YouTube and 13.6% paid search** (social 0.33x search; all new self-pay learners 9.3%). Per paying subscriber (spend through Aug 31 over 30-day buyers), **paid search is cheapest at $288, then paid social $361 and YouTube $385**. Buyer counts are small (63 search, 21 social, 17 YouTube), so treat the per-subscriber figures as about ±25%. Paid social buys cheap signups that rarely pay. Ad platforms claim 27-29% more signups than Mixpanel records (paid social 816 vs 634, paid search 780 vs 614, YouTube 411 vs 318). Accept "paid social is not the best once conversion is counted: its cost per paying subscriber is no better than paid search" with the conversion gap. Also accept "about the same cost per paying subscriber" if the answer notes the small buyer counts.
- **Evidence:** H7-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels `account created` → `subscription started`, 30-day window, signups Jun 4 - Aug 31, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table caveats), 01-business.md (goal 5).
- **Grading:** must combine spend with downstream conversion. Wrong: ranking by cost per signup alone; using `platform_reported_signups` for CAC.

### Q10 — The September dip
- **Prompt:** "Lesson completions looked weak for a few days in mid-September. What happened?"
- **Type:** external-join
- **Answer:** A **video playback bug in the Android app**. From **Sep 9 to Sep 12**, only **36-41% of video lessons started on Android were completed (38.2% over the four days) vs about 83% on the days before and after**; web and iOS stayed at about 82%, and Android reading and lab lessons were unaffected (about 81%). `app_stability_daily` shows Android `playback_failure_rate` of 0.53-0.57 on exactly those days (vs about 0.01-0.02 otherwise), `app_version` 6.4.0, crash-free sessions down to 0.964, and 6.4.1 from Sep 13, when completion recovered. The Insights formula (`lesson completed` / `lesson started`, totals, `content_type` = video, breakdown `platform`) reads the same: Android **38.3%** on Sep 9-12 vs 83.3% in the 7 days either side, web and iOS 82-83%. Accept identifying Android video and Sep 9-12 with the warehouse confirmation.
- **Evidence:** H8-android-playback-incident; Insights, `lesson completed` / `lesson started` formula, filter `content_type` = video, breakdown `platform`, daily; join `app_stability_daily`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily, Mixpanel does not record player errors).
- **Grading:** must name the platform and the content type and tie it to the warehouse table. Wrong: "a general dip" or blaming the fall term or weekday mix.

### Q11 — The late-August jump
- **Prompt:** "Lesson activity jumped at the end of August. Was that a marketing push? What drove it?"
- **Type:** context
- **Answer:** The **university fall term**, not marketing. From Aug 24, **university students completed 344.7 lessons per day vs 184.7 before (1.87x)**, while the other segments rose only 5-8% (career switchers 1.07x, upskillers 1.08x, lifelong learners 1.05x; the growing learner base). Weekly student lesson completions went from 1,325 (week of Aug 17) to 2,355 (week of Aug 24). Paid budgets were steady. Accept naming university students and the fall term start with a student ratio of 1.7-2.0x.
- **Evidence:** H9-fall-term-students; Insights, `lesson completed`, breakdown `learner_segment`, weekly; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (fall term on Aug 24, steady budgets), 01-business.md (segments, university partnership).
- **Grading:** must attribute the jump to students. Wrong: crediting Ask Bright or the price change; reading the whole-base growth as a step.

### Q12 — Does 2x playback hurt learning?
- **Prompt:** "Lots of learners watch at double speed. Does it hurt how well they do?"
- **Type:** segmentation
- **Answer:** Yes, at 2x. Learners whose preferred playback speed is **2x average 64.9 on quizzes vs 71.7 at 1x (−6.9 points)** and pass 35.2% of quizzes vs 57.5%. 1.25x (71.6) and 1.5x (71.5) are no different from 1x. They do save time: a video lesson at 2x takes 9.0 minutes vs 16.0 at 1x. Accept a 2x gap of 6-8 points and "1.25x and 1.5x are fine".
- **Evidence:** H10-double-speed-quiz-scores; Insights, `quiz submitted`, average `score_pct`, breakdown user property `preferred_playback_speed`; `-- EVAL Q12`.
- **Context needed:** 01-business.md (playback speeds), 03-event-dictionary.md (`preferred_playback_speed`, `playback_speed`).
- **Grading:** must separate 2x from the moderate speeds. Wrong: "faster is worse" as a linear claim; "no effect".

### Q13 — Do Teams learners finish more courses? (null)
- **Prompt:** "Employer-sponsored learners have their company behind them. Do they finish courses more often than self-pay learners?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** Across all enrollments, **17.9% of employer-sponsored enrollments vs 17.5% of self-pay enrollments** earned a certificate (z ≈ 0.7, p ≈ 0.46). Within June enrollments by format: cohort 62.9% vs 59.6% (z ≈ 0.9), self-paced 20.5% vs 18.0% (z ≈ 1.6, p ≈ 0.12); neither is significant. Sponsored learners start faster (Q4), but once enrolled they finish at the same rate. Accept "no significant difference" (within about ±2 points overall).
- **Evidence:** `-- EVAL Q13`; Funnels `course enrolled` → `certificate earned`, totals, hold `course_id`, breakdown `account_type`.
- **Context needed:** 01-business.md (account types).
- **Grading:** must check the data and call it not significant. Mentioning the small positive lean is fine. Wrong: "yes, sponsored learners complete more" from the onboarding gap.

### Q14 — Did the iOS 6.4.0 release hurt lessons? (null)
- **Prompt:** "iOS 6.4.0 went out on August 18. Did lesson completion on iOS drop after that release?"
- **Type:** null-hypothesis
- **Answer:** **No.** For lessons started on iOS in the 4 weeks before vs after Aug 18, completion was **82.5% vs 82.5%** (8,925 vs 9,869 starts, z ≈ −0.1); video 82.3% vs 82.5%, reading 82.2% vs 81.9%, lab 84.7% vs 83.3% (all |z| < 1). Web and Android (outside the Sep 9-12 Android incident) were also flat. `app_stability_daily` shows iOS on 6.4.0 from Aug 18 with normal playback failure rates. Accept "no change".
- **Evidence:** `-- EVAL Q14`; Insights, `lesson completed` / `lesson started`, filter `platform` = ios, before vs after 2026-08-18; `app_stability_daily.app_version`.
- **Context needed:** 04-metrics-and-tables.md (app_version).
- **Grading:** must test iOS directly and find no change. Wrong: pointing to the September incident (that was Android).

### Q15 — Is the learner base growing?
- **Prompt:** "How many learners are active each week, and is that growing?"
- **Type:** trend
- **Answer:** Yes, slowly. Weekly active learners (any event except certificates) grew from **5,175 in the week of Jun 8 to 6,056 in the week of Sep 21 (+17%)**. The growth is all new learners: learners who joined before June 4 held steady at about 4,750-4,900 a week, while active new learners rose from 327 to 1,187. (The first and last weeks are partial.) Accept +12-20% from June to late September, driven by new learners.
- **Evidence:** `-- EVAL Q15`; Insights, any event (excluding `certificate earned`), uniques, weekly, breakdown by a cohort of learners who did `account created`.
- **Context needed:** 00-manifest.md (scale, identity), 04-metrics-and-tables.md (weekly active learners).
- **Grading:** must use full weeks and unique learners. Wrong: counting the partial first or last week; counting events instead of learners.

### Q16 — Which categories complete best?
- **Prompt:** "Which course categories have the best completion rates? Should we steer learners toward them?"
- **Type:** open-ended
- **Answer:** By raw rate (June enrollments), **software_dev 39.4%** and **languages 33.7%** lead, then business 26.5%, data_science 24.6%, design 20.8%, marketing 18.8%. But the ranking follows the **share of cohort courses** in each category: software_dev 50% cohort enrollments, languages 41%, business 15%, data_science 15%, design 10%, marketing 0%. Completion depends on format (Q6), not topic, so steering by category would not help; adding cohort options would. Enrollments by category: software_dev 20.6%, business 19.1%, data_science 19.1%, design 15.0%, languages 14.7%, marketing 11.6%. Accept the raw ranking plus the format explanation.
- **Evidence:** `-- EVAL Q16`; Funnels `course enrolled` → `certificate earned`, hold `course_id`, breakdown `course_category` and `course_format`.
- **Context needed:** 01-business.md (catalog, formats).
- **Grading:** full credit needs the format confounder. Wrong: "software courses are easier" without checking format.

### Q17 — Why doesn't billing match Mixpanel?
- **Prompt:** "Finance says we sold more Plus subscriptions than Mixpanel shows. Who is right?"
- **Type:** external-join
- **Answer:** Both, for different things. Over the window the billing table has **488 new subscriptions (201 annual, 287 monthly) vs 451 `subscription started` events in Mixpanel (180 annual, 271 monthly)**. The two agree on 174 of 240 interval-days; billing is higher on 52 (app-store purchases that never reach Mixpanel) and lower on 14 (first payments that failed and were never booked). Daily correlation 0.94. Gross bookings for the window: **$56,860**. Use the billing table for revenue and Mixpanel for behavior and funnels. Accept the counts within ±2% and both reasons.
- **Evidence:** `-- EVAL Q17`; `subscription_billing_daily` vs Insights `subscription started` by `billing_interval`.
- **Context needed:** 04-metrics-and-tables.md (billing caveats).
- **Grading:** must explain the direction of both differences. Wrong: "Mixpanel is missing data" as the only explanation; double-counting by adding the two sources.

### Q18 — What did the Android bug cost?
- **Prompt:** "How many lessons did the September Android playback bug cost us?"
- **Type:** external-join
- **Answer:** About **500 lesson completions**. Android video lessons started Sep 9-12: **1,121 starts, 428 completions**. At the Android baseline of 83.3% (the 7 days either side), about 934 would have been completed, so about **506 completions were lost**, across **785 Android learners**. The warehouse confirms the window (playback failure rate about 0.55, app version 6.4.0) and recovery on Sep 13. Accept 450-560 lost completions.
- **Evidence:** H8-android-playback-incident; `-- EVAL Q18`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily).
- **Grading:** must use a baseline completion rate for the same platform and content type. Wrong: counting all Android events; using `video_starts` from the warehouse (it includes trailer plays).

### Q19 — What should we worry about?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  - **Self-paced completion is low**: 18.5% vs 60.2% for cohort courses, and self-paced is 77% of enrollments (Q6, Q16).
  - **Many new learners never start**: only 55.5% of new signups start a lesson, and self-pay onboarding is 50.6% vs 75.6% for Teams learners (Q4).
  - **The first week decides retention**: learners with fewer than 3 first-week lessons retain at half the rate (35.3% vs 71.2%) (Q7).
  - **Paid social quality**: 40% of paid signups come from paid social, but they convert to Plus at 0.33x the search rate and cost more per paying subscriber (Q9).
  - **Price change trade-off**: fewer monthly subscribers after August 10, offset by annual prepayment (Q8).
  - **Mobile release quality**: the Android incident cost about 500 lesson completions in four days (Q10, Q18).
  - **2x playback** learners pass far fewer quizzes (Q12).
  - Positive signals: Ask Bright users improve by about 8 points (Q1); Personalized Course Picks lifts enrollment 1.25x (Q3).
- **Evidence:** `-- EVAL Q19` plus the queries for the cited questions.
- **Context needed:** all guides.
- **Grading:** must give at least three concerns grounded in data with numbers. Wrong: generic advice; concerns that the data contradicts (for example "Ask Bright is not used" or "the price change cut revenue").

### Q20 — Do SSO signups onboard better? (null)
- **Prompt:** "Do learners who sign up with SSO finish onboarding at a different rate than Google, Apple, or email signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **54.5% for SSO (495 signups) vs 54.8% for all other methods (3,488)**, z ≈ −0.1. The other methods: Google 55.6%, email 54.7%, Apple 53.2%. The null also holds within account types: Teams 78.7% vs 75.2% (z ≈ 0.7), self-pay 49.3% vs 50.8% (z ≈ −0.6). Account type, not signup method, explains onboarding (Q4). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q20`; Funnels, onboarding steps, 7-day window, breakdown `signup_method`.
- **Context needed:** 03-event-dictionary.md (`signup_method`).
- **Grading:** must check the data and call the gap noise. Wrong: "SSO is higher because SSO learners are sponsored" (not true in this data).

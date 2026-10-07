# Brightpath Academy (education) — 20-question eval

- **Data:** `data/verify-education` (full fidelity: 10,000 learner profiles, 8,949 with events, 4,049 new signups, 658,412 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/education/education.sql` on that data.
- **Stories:** ids refer to the `stories` export in `education.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Ask Bright improve quiz scores?
- **Prompt:** "We launched the Ask Bright tutor in July. Is it actually helping learners do better on quizzes? By how much?"
- **Type:** trend
- **Answer:** Yes. Learners who use Ask Bright score about **8 points higher after their first tutor question**: their average quiz score went from **70.1 before to 78.0 after** (+7.9), while Plus and Teams learners who never used it stayed flat (**70.0 before launch, 69.7 after**). Difference in differences: **+8.2 points**. Pass rate (70+) for adopters rose from 53.3% to 77.0%; non-adopters stayed at about 51%. Adopters scored the same as everyone else before they started using it, so this is not just stronger learners choosing the tutor. In a weekly Insights chart the two groups track at about 70 until launch; adopters then pull ahead as they start (73.3 in the week of Aug 3, 75.9 by Aug 10, 75.5 by Aug 17, 76.2-78.0 from Aug 24) while eligible non-adopters stay at 69-70. A simple post-launch comparison (adopters 75.4 vs non-adopters 69.7, +5.7) understates the effect because it mixes in adopters' quizzes from before their first question. Accept +5 to +9 points if the answer shows the groups were equal before launch (weekly chart or pre-launch averages); full credit for the before/after-first-question measure (+7 to +9).
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `quiz submitted`, average `score_pct`, weekly, report filter `plan_tier` in (plus, teams), breakdown cohort "did `ai tutor question asked`" (yes / no); the before/after-first-question read uses the raw export; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plans), 01-business.md (who gets Ask Bright).
- **Grading:** must compare users vs non-users with a before/after control, or show that adopters were not better before. Wrong: "no effect" from comparing all learners before vs after launch across every plan; a raw adopter vs non-adopter gap with no check for selection.

### Q2 — Ask Bright adoption
- **Prompt:** "How many learners are using Ask Bright, and is usage still growing?"
- **Type:** segmentation
- **Answer:** **1,010 learners** have asked at least one question, **34.6% of the 2,921 learners active on a Plus or Teams plan since launch**, with 9,370 questions (9.3 per user). Weekly questions ramped fast for about three weeks: 101 in the launch week (Jul 20-26, 40 askers), 432, 877, then 1,045 in the week of Aug 10. After that, volume leveled off: 949 to 1,169 a week from Aug 17 through Sep 21 (weekly askers 351 to 387). New first-time askers peaked in the weeks of Aug 3 and Aug 10 (214 and 190) and fell every week after, to 36 in the week of Sep 21. Adoption has plateaued; the steady question volume comes from existing users. Accept an adoption share of 30-40% of eligible learners and a description of a fast ramp that has leveled off with few new adopters.
- **Evidence:** H1-ask-bright-ai-tutor; Insights, `ai tutor question asked`, total and uniques, weekly; denominator: uniques with any event on `plan_tier` plus/teams since 2026-07-21; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator must be eligible (Plus/Teams) learners, and the answer must describe the shape. Wrong: share of all learners (Free learners cannot use it); "still growing steadily" based on total questions without noticing that new adopters have dried up.

### Q3 — Personalized Course Picks result
- **Prompt:** "Did the Personalized Course Picks test work? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes, ship it. Per course page view (hold `course_id` constant, totals, 1-day window), **30.0% of Control views led to an enrollment in that course vs 38.1% for Personalized, a 1.27x lift**; Personalized learners also enrolled faster (median 48 minutes from view to enrollment vs 60, 0.80x). The split is even (3,338 Control vs 3,303 Personalized learners). After exposure, Personalized learners made 2.49 enrollments each vs 1.96 for Control (1.27x). Accept a per-view lift of 1.15x-1.35x and a faster time to enroll.
- **Evidence:** H2-personalized-course-picks-experiment; Funnels, `course page viewed` → `course enrolled`, totals, hold `course_id` constant, 1-day window, breakdown `Experiment: Personalized Course Picks`, from 2026-07-08; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (funnel notes).
- **Grading:** must compare the two arms on enrollment conversion. A unique-learner funnel from each learner's first in-test page view gives a different, weaker read: any enrollment within the 30-day default window is 65.4% Control vs 73.9% Personalized (1.13x), and an enrollment in the first-viewed course within 1 day is 29.6% vs 39.1% (1.32x). Credit a uniques answer that finds a lift and recommends shipping, but note that the 30-day any-course read understates the per-view effect. Wrong: "no difference" or "too small to matter" from the 30-day uniques read alone.

### Q4 — Where do new learners stall?
- **Prompt:** "Too many new signups never start a lesson. Is it everyone, or does some group do better?"
- **Type:** funnel
- **Answer:** Overall, **54.6%** of new learners complete onboarding (account created → learning goals set → course enrolled → lesson started) within 7 days. **Employer-sponsored (Teams) learners complete it at 74.9% (701 signups) vs 50.4% for self-pay learners (3,348)**, about **1.5x**. Self-pay learners fall behind at every step (goals 84.4% vs 91.7%, enrollment 67.7% vs 81.7%). Accept a ratio of 1.35-1.65 and naming account type (Teams vs self-pay).
- **Evidence:** H3-sponsored-onboarding; Funnels, four onboarding steps, 7-day window, breakdown `account_type`; `-- EVAL Q4`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by account type (or acquisition channel `employer`, which is the same group) and give the gap. Wrong: blaming the signup platform or signup method (see Q20); reporting only the overall rate.

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
- **Answer:** Cohort courses are finished far more often. For enrollments from Jun 4-30 (all with time to finish), **54.3% of cohort enrollments earned a certificate (547 of 1,007) vs 16.1% of self-paced enrollments (564 of 3,503), about 0.30x** for self-paced. Time from enrollment to certificate is similar (median 48 days for cohort courses, which includes the wait for the group's Monday start, vs 41 for self-paced). Self-paced courses are 76% of enrollments, so they drive the low overall completion rate (24.6%). Accept a self-paced/cohort ratio of 0.25-0.35 and a recommendation that leans toward cohorts.
- **Evidence:** H4-cohort-vs-self-paced-completion; Funnels, `course enrolled` → `certificate earned`, totals, hold `course_id` constant, 90-day window, breakdown `course_format`, enrollments in June; `-- EVAL Q6`.
- **Context needed:** 01-business.md (formats), 04-metrics-and-tables.md (course completion, maturity rule).
- **Grading:** must measure per enrollment with mature enrollments. Wrong: using all enrollments through September (late enrollments have not had time to finish, which pulls both rates down); counting certificates per learner without matching the course.

### Q7 — What predicts new-learner retention?
- **Prompt:** "Is there something new learners do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Completing 3 or more lessons in the first 7 days** is the clearest marker. Among new learners who signed up through Aug 25, **67.8% of those with 3+ first-week lessons were still active on or after day 30 vs 31.7% of those with fewer (2.14x)**; with a day 30-36 bracket, 64.0% vs 30.2%. Retention climbs with first-week lessons and the biggest single step is from 2 to 3: 0 lessons 27.6%, 1 lesson 34.5%, 2 lessons 44.6%, 3 lessons 63.4% (1.42x the 2-lesson rate), 4 lessons 74.7%, 5+ 67.8% (a plateau from 4; the 4 vs 5+ gap is noise on about 200 learners each). 705 learners reached 3+, 2,049 did not. Accept a 3+ vs fewer ratio of 1.8-2.5 and a threshold at 3 lessons (or "more first-week lessons, with the largest jump at 3").
- **Evidence:** H5-first-week-lessons; Funnels `account created` → `lesson completed` ×3 (7-day window), save completed and dropped learners as cohorts; Retention, `account created` → any event (not backend events), on or after day 30; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (retention definition, activation still under discussion).
- **Grading:** must name a first-week lesson count (3+) and show the retention gap. Wrong: a threshold at 1 or 2 lessons; using the whole-window lesson count (it includes the retention itself). An answer that keeps only learners who started a lesson gets the same 1+ lesson numbers but a higher 0-lesson rate (those learners survived until a late first lesson); credit it if the threshold is right.

### Q8 — Did the August price change pay off?
- **Prompt:** "We raised the Plus monthly price on August 10. Did it hurt sign-ups, and did it pay off?"
- **Type:** external-join
- **Answer:** It paid off: buyers shifted to annual billing and revenue per subscription rose, with at most a small loss of subscriptions. The **annual share of new subscriptions went from 27.5% before to 62.7% after**. Comparing the 53 days either side (Jun 18 - Aug 9 vs Aug 10 - Oct 1), new subscriptions went from **4.36 to 4.00 per day (−8%)**: monthly fell from 3.11 to 1.49 per day while annual rose from 1.25 to 2.51. Volume is low (about 4 a day), so the size of the drop is uncertain by about ±10 points; full weeks before the change ranged from 25 to 37 subscriptions. Joining `subscription_billing_daily` list prices, the **first payment per new subscription rose from $86.65 to $162.98 (+88%)**, and billed bookings rose from **$425 to $714 per day (+68%)**. Net: slightly fewer subscribers, much more booked revenue; the gain is annual prepayment. Accept an annual share up by 25-45 points, a volume change from flat to a drop of up to 25% (flagged as noisy), first payment up 60-100%, and bookings per day up 45-90%. Credit an answer that flags the small daily counts.
- **Evidence:** H6-plus-price-change; Insights, `subscription started`, breakdown `billing_interval`, weekly, % of total and totals; join `subscription_billing_daily` on date and `billing_interval`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (date, which price changed), 01-business.md (prices), 04-metrics-and-tables.md (bookings).
- **Grading:** must look at the billing mix and use warehouse prices for revenue. Wrong: "no effect" from counting subscriptions only; "revenue fell" because monthly subscriptions fell; computing revenue from Mixpanel without the price table; a large volume drop (over 25%) claimed as certain.

### Q9 — Which paid channel is worth it?
- **Prompt:** "Paid social gives us the cheapest signups. Is it our best paid channel?"
- **Type:** external-join
- **Answer:** No. Paid social buys the cheapest signups but the most expensive paying subscribers. Joining `paid_marketing_daily` to Mixpanel signups: spend per signup is **$15.13 paid social, $30.05 YouTube, $42.20 paid search** (social 0.36x search). But the 30-day Plus conversion of signups through Aug 31 is **2.6% for paid social (13 of 507) vs 12.7% YouTube (26 of 205) and 16.3% paid search (67 of 411)** (social 0.16x search; all new self-pay learners 10.9%). Per paying subscriber (spend through Aug 31 over 30-day buyers): **paid social $583, paid search $271, YouTube $252**, so a paying subscriber from paid social costs about 2.2x one from search or YouTube. Paid social has only 13 buyers, so its figure is uncertain by about ±30%, but even at the favorable end it stays above search and YouTube. Ad platforms claim 20-40% more signups than Mixpanel records (paid social 816 vs 679, paid search 780 vs 577, YouTube 411 vs 294). Accept "paid social is the most expensive paid channel per paying subscriber, roughly 2x search or YouTube, despite the cheapest signups" with the conversion gap.
- **Evidence:** H7-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels `account created` → `subscription started`, 30-day window, signups Jun 4 - Aug 31, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table caveats), 01-business.md (goal 5).
- **Grading:** must combine spend with downstream conversion. Wrong: ranking by cost per signup alone ("paid social is the best channel"); using `platform_reported_signups` for CAC; calling the channels about equal per paying subscriber.

### Q10 — The September dip
- **Prompt:** "Lesson completions looked weak for a few days in mid-September. What happened?"
- **Type:** external-join
- **Answer:** A **video playback bug in the Android app**. From **Sep 9 to Sep 12**, only **30-39% of video lessons started on Android were completed (36.0% over the four days) vs about 83% on the days before and after**; web and iOS stayed at about 80-84%, and Android reading and lab lessons were unaffected (80-85%). `app_stability_daily` shows Android `playback_failure_rate` of 0.53-0.57 on exactly those days (vs about 0.01-0.02 otherwise), `app_version` 6.4.0, crash-free sessions down to 0.964, and 6.4.1 from Sep 13, when completion recovered. The Insights formula (`lesson completed` / `lesson started`, totals, `content_type` = video, breakdown `platform`) reads the same: Android **36.7%** on Sep 9-12 vs 82.6% in the 7 days either side, web and iOS 81-83%. Accept identifying Android video and Sep 9-12 with the warehouse confirmation.
- **Evidence:** H8-android-playback-incident; Insights, `lesson completed` / `lesson started` formula, filter `content_type` = video, breakdown `platform`, daily; join `app_stability_daily`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily, Mixpanel does not record player errors).
- **Grading:** must name the platform and the content type and tie it to the warehouse table. Wrong: "a general dip" or blaming the fall term or weekday mix.

### Q11 — The late-August jump
- **Prompt:** "Lesson activity jumped at the end of August. Was that a marketing push? What drove it?"
- **Type:** context
- **Answer:** The **university fall term**, not marketing. Splitting at Aug 24, **university students completed 272.4 lessons per day vs 148.4 before (1.84x)**, while the other segments rose only 7-10% (career switchers 1.07x, upskillers 1.10x, lifelong learners 1.07x, the general growth in new learners). Term starts vary by school, so the student line ramps over about three weeks: 1,069 completions in the week of Aug 10, 1,147 (Aug 17), 1,449 (Aug 24), 1,879 (Aug 31), then 1,848-2,086 a week. On full-rate days (before Aug 17 vs from Sep 8) students rose from 146.9 to 292.3 a day (1.99x) and other segments 1.07-1.13x, so students gained about 1.8x relative to everyone else. Paid budgets were steady. Accept naming university students and the fall term start with a student ratio of 1.6-2.1x.
- **Evidence:** H9-fall-term-students; Insights, `lesson completed`, breakdown `learner_segment`, weekly; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (fall term the week of Aug 24, dates vary by school; steady budgets), 01-business.md (segments, university partnership).
- **Grading:** must attribute the jump to students. Wrong: crediting Ask Bright or the price change; crediting marketing.

### Q12 — Does 2x playback hurt learning?
- **Prompt:** "Lots of learners watch at double speed. Does it hurt how well they do?"
- **Type:** segmentation
- **Answer:** Yes, at 2x. Learners whose preferred playback speed is **2x average 64.5 on quizzes vs 71.7 at 1x (−7.2 points)** and pass 33.9% of quizzes vs 57.5%. 1.25x (71.6) and 1.5x (71.4) are no different from 1x. They do save time: a video lesson at 2x takes 9.0 minutes vs 16.0 at 1x. Accept a 2x gap of 6-8 points and "1.25x and 1.5x are fine".
- **Evidence:** H10-double-speed-quiz-scores; Insights, `quiz submitted`, average `score_pct`, breakdown user property `preferred_playback_speed`; `-- EVAL Q12`.
- **Context needed:** 01-business.md (playback speeds), 03-event-dictionary.md (`preferred_playback_speed`, `playback_speed`).
- **Grading:** must separate 2x from the moderate speeds. Wrong: "faster is worse" as a linear claim; "no effect".

### Q13 — Do Teams learners finish more courses? (null)
- **Prompt:** "Employer-sponsored learners have their company behind them. Do they finish courses more often than self-pay learners?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** Across all enrollments, **14.9% of employer-sponsored enrollments vs 15.6% of self-pay enrollments** earned a certificate (z ≈ −1.05, p ≈ 0.29). Within June enrollments by format: cohort 50.0% vs 55.3% (z ≈ −1.3, p ≈ 0.18), self-paced 15.6% vs 16.2% (z ≈ −0.4); neither is significant. Sponsored learners start faster (Q4), but once enrolled they finish at the same rate. Accept "no significant difference" (within about ±2 points overall).
- **Evidence:** `-- EVAL Q13`; Funnels `course enrolled` → `certificate earned`, totals, hold `course_id`, breakdown `account_type`.
- **Context needed:** 01-business.md (account types).
- **Grading:** must check the data and call it not significant. The June cohort-course sub-split leans the other way (sponsored lower by 5.3 points on 192 sponsored enrollments, p ≈ 0.18); mentioning it as noise is fine, calling it a finding is not. Wrong: "yes, sponsored learners complete more" from the onboarding gap; "sponsored learners complete less" from the June cohort sub-split.

### Q14 — Is the Android app worse for learning? (null)
- **Prompt:** "Android reviews say our app is worse for learning than the iPhone app. Do learners do worse on quizzes they take in the Android app than in the iOS app?"
- **Type:** null-hypothesis
- **Answer:** **No.** Quizzes submitted in the Android app average **70.67 vs 70.49 in the iOS app** (6,544 vs 8,999 quizzes, z ≈ 0.7 with learner-clustered errors, p ≈ 0.47); pass rates are 53.8% vs 53.8%. By plan at quiz time: Free 0.0 points, Plus +0.7, Teams +0.1 (all |z| < 1.5). By month: June +0.9, July 0.0, August 0.0, September −0.2. June is the only month near significance (z ≈ 1.95, p ≈ 0.05), and it favors Android, the opposite of the reviews' claim; it does not repeat in any later month. For context, lesson completion outside the Sep 9-12 playback incident is the same (81.7% Android vs 81.8% iOS per lesson started, z ≈ −0.4). `app_stability_daily` outside the incident days shows the same crash-free session rate (0.9949 Android vs 0.9950 iOS) and playback failure rate (0.0126 vs 0.0124). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; Insights, `quiz submitted`, average `score_pct`, breakdown `platform` (event property), filter `platform` in (android, ios); secondary: Insights formula `lesson completed` / `lesson started` by `platform`, date ranges Jun 4 - Sep 8 and Sep 13 - Oct 1; `app_stability_daily`.
- **Context needed:** 03-event-dictionary.md (`platform`, `score_pct`), 02-timeline.md (incident dates, if the analyst also checks lesson completion).
- **Grading:** must check quiz scores by platform and call the gap noise. Wrong: "Android is worse" from lesson completion that includes Sep 9-12; comparing raw quiz counts instead of average scores (iOS, which includes iPads, has more quizzes); "Android is better" from the June month alone (one of eight sub-splits, and it does not repeat).

### Q15 — Is the learner base growing?
- **Prompt:** "How many learners are active each week, and is that growing?"
- **Type:** trend
- **Answer:** Modestly. Weekly active learners (any event except the backend events certificate earned and subscription started) went from **4,641 in the week of Jun 8 to 5,082 in the week of Sep 21 (+10%)**. Underneath, two trends offset each other: learners who joined before June 4 fell from **4,308 to 3,541 a week (−18%)** as some stopped coming back, while active new learners rose from 333 to 1,541. The base grows only because new signups more than replace established learners who leave. (The first and last weeks are partial.) Accept "growing slowly (about 5-15%)" with the split: established learners declining, new learners making up the difference.
- **Evidence:** `-- EVAL Q15`; Insights, any event (excluding `certificate earned` and `subscription started`), uniques, weekly, breakdown by a cohort of learners who did `account created`.
- **Context needed:** 00-manifest.md (scale, identity), 04-metrics-and-tables.md (weekly active learners).
- **Grading:** must use full weeks and unique learners, and should split new vs established learners. Wrong: counting the partial first or last week; counting events instead of learners; "healthy growth" without noticing the established base is shrinking.

### Q16 — Which categories complete best?
- **Prompt:** "Which course categories have the best completion rates? Should we steer learners toward them?"
- **Type:** open-ended
- **Answer:** By raw rate (June enrollments), **software_dev 35.1%** and **languages 29.5%** lead, then business 22.4%, data_science 22.1%, design 20.3%, marketing 14.0%. But the ranking follows the **share of cohort courses** in each category: software_dev 49% cohort enrollments, languages 41%, business 17%, data_science 16%, design 10%, marketing 0%. Completion depends on format (Q6), not topic, so steering by category would not help; adding cohort options would. Enrollments by category: software_dev 20.1%, business 19.4%, data_science 19.2%, design 14.7%, languages 14.4%, marketing 12.3%. Accept the raw ranking plus the format explanation.
- **Evidence:** `-- EVAL Q16`; Funnels `course enrolled` → `certificate earned`, hold `course_id`, breakdown `course_category` and `course_format`.
- **Context needed:** 01-business.md (catalog, formats).
- **Grading:** full credit needs the format confounder. Wrong: "software courses are easier" without checking format.

### Q17 — Why doesn't billing match Mixpanel?
- **Prompt:** "Finance says we sold more Plus subscriptions than Mixpanel shows. Who is right?"
- **Type:** external-join
- **Answer:** Both, for different things. Over the window the billing table has **552 new subscriptions (237 annual, 315 monthly) vs 518 `subscription started` events in Mixpanel (217 annual, 301 monthly)**. The two agree on 179 of 240 interval-days; billing is higher on 48 (app-store purchases that never reach Mixpanel) and lower on 13 (first payments that failed and were never booked). Daily correlation 0.95. Gross bookings for the window: **$66,324**. Use the billing table for revenue and Mixpanel for behavior and funnels. Accept the counts within ±2% and both reasons.
- **Evidence:** `-- EVAL Q17`; `subscription_billing_daily` vs Insights `subscription started` by `billing_interval`.
- **Context needed:** 04-metrics-and-tables.md (billing caveats).
- **Grading:** must explain the direction of both differences. Wrong: "Mixpanel is missing data" as the only explanation; double-counting by adding the two sources.

### Q18 — What did the Android bug cost?
- **Prompt:** "How many lessons did the September Android playback bug cost us?"
- **Type:** external-join
- **Answer:** About **370 lesson completions**. Android video lessons started Sep 9-12: **792 starts, 285 completions**. At the Android baseline of 82.8% (the 7 days either side), about 656 would have been completed, so about **371 completions were lost**, across **519 Android learners**. The warehouse confirms the window (playback failure rate about 0.55, app version 6.4.0) and recovery on Sep 13. Accept 320-420 lost completions.
- **Evidence:** H8-android-playback-incident; `-- EVAL Q18`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (app_stability_daily).
- **Grading:** must use a baseline completion rate for the same platform and content type. Wrong: counting all Android events; using `video_starts` from the warehouse (it includes trailer plays).

### Q19 — What should we worry about?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  - **The established learner base is shrinking**: weekly active learners who joined before June 4 fell 18% (4,308 to 3,541 a week); total weekly actives grew only 10% because new signups replaced them (Q15).
  - **Self-paced completion is low**: 16.1% vs 54.3% for cohort courses, and self-paced is 76% of enrollments (Q6, Q16).
  - **Many new learners stall in onboarding**: 54.6% of new signups complete onboarding within 7 days, and self-pay onboarding is 50.4% vs 74.9% for Teams learners; 28% of new signups never start a lesson at all (Q4).
  - **The first week decides retention**: learners with fewer than 3 first-week lessons retain at under half the rate of those with 3+ (31.7% vs 67.8%) (Q7).
  - **Paid social quality**: 44% of paid signups come from paid social, but they convert to Plus at 2.6% vs 16.3% for search, so a paying subscriber from paid social costs about 2.2x one from search ($583 vs $271) (Q9).
  - **Price change trade-off**: fewer monthly subscribers after August 10, more than offset by annual prepayment (Q8).
  - **Mobile release quality**: the Android incident cost about 370 lesson completions in four days (Q10, Q18).
  - **2x playback** learners pass far fewer quizzes (Q12).
  - **Ask Bright adoption has stalled**: few new adopters each week since mid-August (Q2).
  - Positive signals: Ask Bright users improve by about 8 points (Q1); Personalized Course Picks lifts enrollment per page view about 1.27x (Q3).
- **Evidence:** `-- EVAL Q19` plus the queries for the cited questions.
- **Context needed:** all guides.
- **Grading:** must give at least three concerns grounded in data with numbers. Wrong: generic advice; concerns that the data contradicts (for example "Ask Bright is not used" or "the price change cut revenue").

### Q20 — Do app signups onboard worse? (null)
- **Prompt:** "People who sign up in the mobile app seem less serious than web signups. Do they finish onboarding less often?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **54.4% for signups in the iOS or Android app (1,849) vs 54.8% for web signups (2,200)**, z ≈ −0.3 (p ≈ 0.79). The null also holds within account types (Teams 71.9% vs 77.2%, z ≈ −1.6, p ≈ 0.11; self-pay 50.9% vs 49.9%, z ≈ 0.6) and by signup day (weekday 52.8% vs 53.5%, z ≈ −0.4; weekend 58.5% vs 58.1%, z ≈ 0.2). By app: Android 53.2%, iOS 55.3%, web 54.8%; none differs significantly. Account type, not signup platform, explains onboarding (Q4). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q20`; Funnels, onboarding steps, 7-day window, breakdown `platform` (event property on `account created`, the first step), mobile = ios + android.
- **Context needed:** 04-metrics-and-tables.md (onboarding completion), 03-event-dictionary.md (`platform`, `account created`).
- **Grading:** must check the data and call the gap noise. Wrong: "app signups are less committed" from the 0.4-point gap; "Teams app signups onboard worse" from the one sub-split at p ≈ 0.11.

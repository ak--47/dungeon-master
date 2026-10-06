# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 10,000 members, 1,524,884 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-06
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 57.3%** (898 of 1,566) vs **Control 45.4%** (682 of 1,501), a **relative lift of about 1.26x** (+11.9 points). Accept 1.20x-1.32x and rates within ±1.5 points.
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.5 hours vs Control ≈ 17.9 hours**, about **0.70x** the control time (30% faster). Accept 0.65x-0.75x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, Plus workouts done with Stride Coach (`coaching_mode = ai_coach`) average **49.8 minutes vs 41.5 minutes** for self-guided Plus workouts, about **1.20x longer**. Self-guided Plus workouts did not change (41.4 min before launch, 41.5 after). Free workouts are all self-guided. Accept 1.15x-1.25x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus only), 01-business.md.
- **Grading:** must separate AI-coached from self-guided workouts and restrict to Plus. Wrong: comparing all workouts before vs after launch (41.5 → 43.7 minutes, about 1.05x, because it mixes in self-guided and free workouts).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** **About 45%** (45.1%) of Plus members' completed workouts since 2026-08-12 use Stride Coach. Adoption was flat from the first week (46.2% in the launch week, 44-46% every week after); it did not ramp. Accept 43%-47% and "flat".
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is Plus workouts, not all workouts. Wrong: share of all workouts (much lower), or claiming steady growth.

### Q5 — Do AI-coached workouts burn more calories? (null)
- **Prompt:** "Since Stride Coach workouts are longer, do they burn more calories too?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** Average calories per workout: ai_coach 403.7 vs self-guided 406.5 (medians 335 vs 340), a gap under 1%. The longer sessions did not raise recorded calories. Accept any answer that says no meaningful difference (within ±3%).
- **Evidence:** Insights, `workout completed`, average `calories_burned`, breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** none beyond the event dictionary.
- **Grading:** must check the data rather than infer from duration. Wrong: "yes, about 20% more" by assumption.

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days, smartwatch and fitness-band workouts fell from about **840 per day to about 212 per day** while phone-tracked workouts held steady (639 vs 619 per day). Relative to phone workouts, watch and band workouts ran at **about 26%** of normal (0.26 ratio of ratios vs the 7 days on each side). The warehouse table `wearable_sync_daily` shows `sync_error_rate` ≈ 0.75 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.22-0.30.
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type`; warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`), 01-business.md (how devices sync).
- **Grading:** must name the incident, the dates, the device scope, and a size. Wrong: blaming the dip on members working out less (phone workouts and meal logging did not move), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident they ran at 0.25x (smartwatch) and 0.29x (fitness band) of their normal level relative to phone workouts. **Chest straps** (0.96x) and **manual entries** (0.99x) were essentially unaffected. The warehouse agrees: `major_outage` with a 0.75 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.2-0.35 for affected devices and 0.9-1.1 for unaffected.
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md, 01-business.md.
- **Grading:** must separate chest straps from watches and bands. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **2.07 before Sep 1 to 1.45 after**, a ratio of **0.70** (about 30% fewer Monthly purchases than the Annual trend predicts). August vs September: Monthly 354 → 231 while Annual 176 → 159; Monthly share of new subscriptions 66.8% → 59.2%. Accept a ratio of 0.62-0.78.
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: attributing the whole decline in total purchases to the price change (total purchases decline all summer as the long-time free pool shrinks; Annual fell too); claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining purchases to `list_price_usd`, Monthly gross bookings fell from **$4,598 in August to $3,463 in September** while Annual bookings moved from $17,598 to $15,898. Relative to Annual, Monthly bookings after the change are **0.81x** of before: the 15% higher price did not make up for the lost volume. Accept 0.72-0.90 and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; ignoring that Annual also declined.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$18.00 during Summer Shred (Jun 15-Jul 14) vs $9.00 outside it**, **2.0x**. Spend: $7,308 for 406 signups in the campaign vs $4,905 for 545 signups outside. Paid search ($14) and app-store ads ($6) cost the same per signup in and out of the campaign. Accept 1.9x-2.1x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only.

### Q11 — Channel mix during Summer Shred
- **Prompt:** "How did our new-member channel mix change during Summer Shred?"
- **Type:** attribution
- **Answer:** Paid social's share of new members rose from **18.2% outside the campaign to 41.2% during it** (about **2.3x**); organic fell from 34.9% to 21.2%, paid search from 12.5% to 8.5%, app-store ads from 18.0% to 13.1%; referral stayed about 16%. Accept 2.1x-2.5x.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, compare date ranges; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md.
- **Grading:** must report shares, not just counts. Wrong: claiming referral fell (it held steady).

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at about half the rate** of other channels: 12.2% vs about 22% for organic, referral, paid search, and app-store ads. Comparing signups from the same weeks, paid social's purchase rate is **0.49x** the other channels'. Spend per paying member: **paid social ≈ $105**, paid search ≈ $64, app-store ads ≈ $27. Paid social is the most expensive way to get a paying member. Accept 0.40x-0.60x.
- **Evidence:** H5-summer-shred-paid-social; Funnels or Insights `account created` → `subscription purchased` by `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Completing 3 or more workouts in the first 7 days.** Day-28 retention (any activity in days 28-34) is **96.3% for members with 3+ first-week workouts vs 45.8% for members with 0-2** (about **2.1x**). The jump is a cliff at 3: 0, 1, and 2 workouts all retain at 42-49%; 3, 4, 5, and 6+ all retain at 95-99%. 63% of new members fall below the line. Accept 1.9x-2.3x and the threshold of 3.
- **Evidence:** H6-first-week-habit; Retention, `account created` → any event, cohort on first-week `workout completed` count, members who signed up by 2026-08-27; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and name the threshold. Wrong: using total workouts over the whole window (leaks the outcome into the cohort).

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (matched on `challenge_id`), **team challenges complete 59.0%** (22,899 of 38,815) vs **solo 29.7%** (11,563 of 38,905), about **2x**. Accept 55%-63% team and 27%-33% solo.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id), 04-metrics-and-tables.md.
- **Grading:** must count per challenge. Wrong: unique-member funnel rates (members join many challenges, so 90.5% of team joiners and 72.3% of solo joiners complete at least one, which hides most of the gap).

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Members who received **fewer than 20 notifications** in the window open about **75%** of them; members who received **20 or more** open about **30%** (0.40x). The drop is a cliff between 15-19 notifications (74.7%) and 20-24 (30.2%); it does not decline gradually. About 22% of members (2,019) are above the line. Accept a threshold of 20 (±2) and rates within ±3 points.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, broken down by a cohort on notification count; `-- EVAL Q15`.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review).
- **Grading:** must find the threshold, not just a correlation. Wrong: "open rates decline steadily with volume".

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21), completed workouts per app open were **2.26 vs 1.51** in the two weeks before, **1.50x**; app opens themselves did not rise (16,649 vs 17,033). Workout planning shows the same 1.5x lift. Accept 1.4x-1.6x.
- **Evidence:** H9-fall-reset-program; Insights, `workout completed` and `app opened` daily, formula A/B; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must separate workouts from general app traffic. Wrong: crediting Labor Day; saying engagement (app opens) rose.

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **50.0% on Android vs 49.9% on iOS**. Within each test variant the platforms also match (Control 45.2% vs 45.6%; Guided Plan 57.7% vs 57.1%). Accept "no meaningful difference" (gap under 2 points).
- **Evidence:** Funnels onboarding steps, breakdown `Platform`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says there is no platform gap and, ideally, checks within variants.

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did members also stop logging meals or using the app?"
- **Type:** null-hypothesis
- **Answer:** **No.** Meals logged per app open were **0.893 during the incident vs 0.886** in the surrounding week (1.01x), and app opens per day were normal. Only wearable-synced workouts were affected. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data. Wrong: "engagement fell across the board".

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June $34,137 gross / $29,016 net** (833 new subscriptions); **July $28,325 / $24,076** (687); **August $22,197 / $18,867** (530); **September $19,016 / $16,164** (384); October 1 only $345 / $293 (6). Net is gross minus the 15% store fee. Bookings fell every month. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat).
- **Grading:** must use the warehouse table (prices are not in events). Wrong: blaming the whole decline on the September price change (it started in June).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: paid-social members buy Plus at about half the rate (0.49x same-week), and Summer Shred doubled the paid-social cost per signup ($9 → $18); about $105 per paying member vs $27-64 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.70x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.81x; the increase did not pay off so far.
  3. **Activation**: 63% of new members do fewer than 3 workouts in their first week, and they retain at about 46% vs 96% at day 28. Ship Guided Plan (1.26x onboarding completion, faster time to onboard).
  4. **Notification fatigue**: 22% of members get 20+ notifications and open only about 30% of them; set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about 74% of watch and band workouts.
  6. **Declining new-subscription bookings** month over month as the long-time free pool upgrades; growth depends on new-member conversion.
  Positive signals to keep: Stride Coach sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts 1.5x.
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.

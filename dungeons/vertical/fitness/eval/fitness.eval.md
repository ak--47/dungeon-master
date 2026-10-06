# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 9,052 active members, 4,027 new-member signups, 1,208,328 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-06
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 58.9%** (897 of 1,522) vs **Control 44.7%** (671 of 1,501), a **relative lift of about 1.32x** (+14.2 points). Accept 1.22x-1.42x and rates within ±1.5 points.
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.6 hours vs Control ≈ 18.2 hours**, about **0.69x** the control time (about 30% faster). Accept 0.63x-0.77x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, Plus workouts done with Stride Coach (`coaching_mode = ai_coach`) average **49.5 minutes vs 41.5 minutes** for self-guided Plus workouts, about **1.19x longer**. Self-guided Plus workouts did not change (41.4 min before launch, 41.5 after). Free workouts are all self-guided. Accept 1.12x-1.27x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus only), 01-business.md.
- **Grading:** must separate AI-coached from self-guided workouts and restrict to Plus. Wrong: comparing all workouts before vs after launch (41.5 → 43.8 minutes, about 1.06x, because it mixes in self-guided and free workouts).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** **About 44%** (44.5%) of Plus members' completed workouts since 2026-08-12 use Stride Coach. Adoption was flat from the first week (45.3% in the launch week, 43-45% every week after); it did not ramp. Accept 42%-47% and "flat".
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is Plus workouts, not all workouts. Wrong: share of all workouts (much lower), or claiming steady growth.

### Q5 — Do Stride Coach workouts push people harder? (null)
- **Prompt:** "Stride Coach sessions run longer. Are people also working harder in them — higher heart rate or effort?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference in intensity.** Plus workouts after launch: average heart rate **125.8 bpm for both** ai_coach and self-guided; perceived effort 5.99 vs 6.03; calories per minute 6.33 vs 6.33. Stride Coach sessions burn more total calories only because they last longer (313.8 vs 262.7 calories per workout, about the same 1.19x as duration). Accept any answer that says intensity did not change (heart rate and effort within ±2%).
- **Evidence:** Insights, `workout completed`, average `avg_heart_rate` and `perceived_effort` (and calories ÷ minutes), breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check intensity directly, not infer it from total calories. Wrong: "yes, they burn about 20% more calories, so they are harder workouts" (the extra calories come from the extra minutes).

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days, smartwatch and fitness-band workouts fell from about **626 per day to about 167 per day** while phone-tracked workouts held steady (464 vs 451 per day). Relative to phone workouts, watch and band workouts ran at **about 27%** of normal (0.274 ratio of ratios vs the 7 days on each side). The warehouse table `wearable_sync_daily` shows `sync_error_rate` ≈ 0.75 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.22-0.31.
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type`; warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`), 01-business.md (how devices sync).
- **Grading:** must name the incident, the dates, the device scope, and a size. Wrong: blaming the dip on members working out less (phone workouts and meal logging did not move), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident they ran at 0.28x (smartwatch) and 0.27x (fitness band) of their normal level relative to phone workouts. **Chest straps** (1.06x) and **manual entries** (1.13x, a small sample) were not hit. The warehouse agrees: `major_outage` with a 0.75 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.2-0.35 for affected devices and 0.85-1.2 for unaffected.
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md, 01-business.md.
- **Grading:** must separate chest straps from watches and bands. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **1.94 before Sep 1 to 1.28 after**, a ratio of **0.66** (about a third fewer Monthly purchases than the Annual trend predicts). August vs September: Monthly 311 → 146 while Annual 145 → 114; Monthly share of new subscriptions 68.2% → 56.2%. Accept a ratio of 0.56-0.76.
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: attributing the whole decline in total purchases to the price change (total purchases decline all summer as the long-time free pool upgrades and new members lapse; Annual fell too); claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining purchases to `list_price_usd`, Monthly gross bookings fell from **$4,040 in August to $2,189 in September** while Annual bookings moved from $14,499 to $11,399. Relative to Annual, Monthly bookings after the change are **0.76x** of before: the 15% higher price did not make up for the lost volume. Accept 0.65-0.87 and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; ignoring that Annual also declined.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$17.54 during Summer Shred (Jun 15-Jul 14) vs $9.00 outside it**, about **1.95x**. Spend: $8,208 for 468 signups in the campaign vs $4,349 for 483 signups outside. Paid search ($14.12 vs $14.05) and app-store ads ($5.90 vs $6.00) cost the same per signup in and out of the campaign. Daily cost per signup varies by about ±10% around those levels. Accept 1.8x-2.2x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only.

### Q11 — Did Summer Shred add new members?
- **Prompt:** "Did Summer Shred actually bring in extra members, or did paid social just take credit for people who would have joined anyway?"
- **Type:** attribution
- **Answer:** **It added real members.** New-member signups ran at **41.7 per day during the campaign vs 30.9 per day** in the rest of the window (**1.35x**), about **324 extra members** over the 30 days. All of the extra came through paid social: 15.6 vs 5.4 paid-social signups per day (2.9x; share of signups 17.4% → 37.4%). Organic (11.1 vs 10.8), referral (5.4 vs 5.0), paid search (4.4 vs 4.2), and app-store ads (5.1 vs 5.6) each held their normal daily volume (non-paid-social combined 1.02x), so there is no sign of cannibalization. Extra paid-social spend was about $6,758, or **about $21 per extra member** (higher than the $17.54 average because the campaign also paid double for paid-social members who would have come anyway). Accept a lift of 1.2x-1.47x, 250-400 extra members, and $17-$25 per extra member.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, compare date ranges; warehouse spend for the cost; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare absolute daily volume per channel, not only shares. Wrong: "paid social cannibalized organic" (shares fell, but absolute organic volume did not); reporting only the share shift; ignoring that the paid-social members buy Plus at half the rate (see Q12).

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at about half the rate** of other channels: 9.0% vs 16-18% for organic, referral, paid search, and app-store ads. Comparing signups from the same weeks, paid social's purchase rate is **0.48x** the other channels'. Spend per paying member: **paid social ≈ $146**, paid search ≈ $86, app-store ads ≈ $34. Paid social is the most expensive way to get a paying member. Accept 0.40x-0.60x.
- **Evidence:** H5-summer-shred-paid-social; Funnels or Insights `account created` → `subscription purchased` by `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Completing 3 or more workouts in the first 7 days.** Day-28 retention (any activity in days 28-34) is **52.4% for members with 3+ first-week workouts vs 23.2% for members with 0-2** (about **2.3x**). The jump is a cliff at 3: 0, 1, and 2 workouts retain at 20-27%; 3, 4, 5, and 6+ retain at 48-57%. 63% of new members fall below the line. Accept 1.9x-2.6x and the threshold of 3.
- **Evidence:** H6-first-week-habit; Retention, `account created` → any event, cohort on first-week `workout completed` count, members who signed up by 2026-08-27; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and name the threshold. Wrong: using total workouts over the whole window (leaks the outcome into the cohort).

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (matched on `challenge_id`), **team challenges complete 59.0%** (18,823 of 31,902) vs **solo 29.6%** (9,401 of 31,763), about **2x**. Accept 55%-63% team and 27%-33% solo.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id), 04-metrics-and-tables.md.
- **Grading:** must count per challenge. Wrong: unique-member funnel rates (members join many challenges, so 88.9% of team joiners and 70.4% of solo joiners complete at least one, which hides most of the gap).

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Members who received **fewer than 20 notifications** in the window open about **75%** of them; members who received **20 or more** open about **30%** (0.40x). The drop is a cliff between 15-19 notifications (75.2%) and 20-24 (30.0%); it does not decline gradually. About 19% of members with notifications (1,487) are above the line. Accept a threshold of 20 (±2) and rates within ±3 points.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, broken down by a cohort on notification count; `-- EVAL Q15`.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review).
- **Grading:** must find the threshold, not just a correlation. Wrong: "open rates decline steadily with volume".

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21), completed workouts per app open were **2.34 vs 1.56** in the two weeks before, **1.50x**; app opens themselves did not rise (11,198 vs 12,063). Workout planning shows the same 1.5x lift. Accept 1.4x-1.6x.
- **Evidence:** H9-fall-reset-program; Insights, `workout completed` and `app opened` daily, formula A/B; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must separate workouts from general app traffic. Wrong: crediting Labor Day; saying engagement (app opens) rose.

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **51.7% on Android (1,535 signups) vs 49.2% on iOS (2,492)**. The 2.5-point gap is within sampling noise (two-proportion z ≈ 1.5, p ≈ 0.12), and it points the opposite way from the question: Android is not lower. Within each test variant the gap is similar and also not significant (Control 46.2% vs 43.8%; Guided Plan 61.0% vs 57.7%). Accept "no meaningful difference" or "Android is not lower".
- **Evidence:** Funnels onboarding steps, breakdown `Platform`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says Android does not under-perform and treats the small gap as noise. Wrong: "yes, Android is lower"; "Android is clearly better" without a significance check.

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did members also stop logging meals or using the app?"
- **Type:** null-hypothesis
- **Answer:** **No.** Meals logged per app open were **0.917 during the incident vs 0.897** in the surrounding week (1.02x), and app opens per day were normal. Only wearable-synced workouts were affected. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data. Wrong: "engagement fell across the board".

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June $29,200 gross / $24,820 net** (674 new subscriptions); **July $27,906 / $23,720** (648); **August $18,538 / $15,758** (456); **September $13,282 / $11,290** (251); October 1 only $305 / $259 (9). Net is gross minus the 15% store fee. Bookings fell every month, with the steepest drop from July to August. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat).
- **Grading:** must use the warehouse table (prices are not in events). Wrong: blaming the whole decline on the September price change (it started before September).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: Summer Shred did add members (1.35x daily signups, about 324 extra, about $21 each in extra spend), but paid-social members buy Plus at about half the rate (0.48x same-week), the campaign doubled paid-social cost per signup ($9.00 → $17.54), and a paying member costs about $146 via paid social vs $34-86 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.66x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.76x; the increase did not pay off so far.
  3. **Activation**: 63% of new members do fewer than 3 workouts in their first week, and they retain at about 23% vs 52% at day 28. Ship Guided Plan (1.32x onboarding completion, faster time to onboard).
  4. **Notification fatigue**: about 19% of members get 20+ notifications and open only about 30% of them; set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about 73% of watch and band workouts.
  6. **Declining new-subscription bookings** month over month (June $29.2k → September $13.3k gross); growth depends on new-member conversion and retention.
  Positive signals to keep: Stride Coach sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts 1.5x.
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.

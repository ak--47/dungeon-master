# Hearthside (community) — 20-question eval

- **Data:** `data/verify-community` (full fidelity: 10,000 members, 9,993 with events, 4,440 new signups, 48 communities, 825,919 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/community/community.sql` on that data.
- **Stories:** ids refer to the `stories` export in `community.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — August gaming traffic
- **Prompt:** "Gaming wiki traffic jumped in August. What happened, and how big was it?"
- **Type:** trend
- **Answer:** The **Starfall release on 2026-08-06**. Gaming-hub article views averaged **1,216.6 per day from Aug 6 to Aug 19 vs 581.9 per day** in the two weeks before (Jul 23 - Aug 5), about **2.1x**. The surge peaked at launch (**1,557.7 per day on Aug 6-8**, about 2.7x) and faded to **792.0 per day by Aug 17-19** (about 1.4x). Gaming searches doubled too (130.1 → 274.4 per day). Other hubs barely moved (1,660.7 → 1,717.4 article views per day, +3%), so relative to the rest of the site gaming reading ran **2.02x** normal for the fortnight. Accept a launch-fortnight lift of 1.8x-2.3x, the Starfall release as the cause, and a peak-then-fade shape.
- **Evidence:** H1-starfall-launch-surge; Insights, `article viewed` (and `search performed`), total, breakdown `content_hub`, daily; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (Starfall release), 01-business.md (hubs).
- **Grading:** must name Starfall and the date, size the lift against a baseline, and note it was gaming-only. Wrong: a Hearthside campaign (there was none); "the whole site grew"; quoting only the release-day peak as the fortnight's lift.

### Q2 — Which channels bring members who finish onboarding?
- **Prompt:** "Which acquisition channels bring people who actually finish onboarding?"
- **Type:** funnel
- **Answer:** 7-day onboarding completion (account created → interests selected → intro posted): **friend_invite 68.4%** (404 of 591), reddit_ads 52.6%, organic 51.5%, youtube_creators 51.4%, app_store 46.3%, and **tiktok_ads 24.3%** (224 of 921). Overall 47.8% (2,121 of 4,440). Friend invites finish at about **1.33x** organic; TikTok signups at about half the rate of the next-lowest channel (app_store, 46.3%). TikTok signups also drop earlier: 70.7% reach the interests step vs 79-87% for the other channels. Accept rates within ±3 points and naming friend invites as best and TikTok as worst.
- **Evidence:** H2-onboarding-by-channel (and H9); Funnels, three onboarding steps, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (channels).
- **Grading:** must break down by channel and name both ends. Wrong: ranking channels by signup volume; using a window longer than 7 days without saying so.

### Q3 — Do mobile signups onboard worse? (null)
- **Prompt:** "People who sign up on their phones have to type an intro on a small keyboard. Do mobile signups finish onboarding less often than desktop signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **47.2% for mobile signups** (iOS, iPadOS, Android; 1,598) vs **48.1% for desktop** (2,842), z ≈ −0.6. The gap stays small inside paid channels (41.3% vs 39.2%, z ≈ +1.0) and unpaid channels (52.7% vs 55.9%, z ≈ −1.5). By operating system, rates run 41.8%-50.0% for every system with more than 50 signups (chi-square 7.05 on 7 df, p ≈ 0.42). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Funnels onboarding steps, 7-day window, breakdown `os` (device of `account created`).
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the gap as noise. Wrong: "yes, mobile is worse"; reading the 6-signup Linux row as a finding.

### Q4 — Is Reply Nudges working?
- **Prompt:** "Should we ship Reply Nudges to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-08, **31.8% of Nudges On thread views lead to a reply by the same member within a day vs 26.1% for Control** (15,542 of 48,944 vs 12,710 of 48,670 views), about **1.22x**, and the median time from opening the thread to replying is **12.0 vs 15.0 minutes** (0.80x). Members in both arms open about the same number of threads (11.95 vs 11.73 per member), so the gain is per thread view, not more browsing. The split is even (4,097 Nudges On vs 4,150 Control exposed members; first exposure 2026-07-08). Accept 1.10x-1.32x for reply rate and 0.72x-0.88x for time.
- **Evidence:** H3-reply-nudges-experiment; Funnels `discussion viewed` → `comment posted`, totals, hold `thread_id` constant, 1-day window, breakdown `Experiment: Reply Nudges`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`thread_id`).
- **Grading:** must compare per thread view within the test window. Wrong: unique-member funnel conversion (most members reply at least once, which hides the gap); comparing before vs after July 8 for everyone.

### Q5 — Is Hearth Guard speeding up report handling?
- **Prompt:** "Is Hearth Guard actually making report handling faster? For which reports?"
- **Type:** trend
- **Answer:** Yes, for **spam, harassment, and vandalism** reports. Median time from report to resolution, reports filed before the 2026-07-22 rollout vs reports filed Aug 1 - Sep 23 (every community has Guard; each report has a week to resolve; the Aug 19-21 raid left out): **spam 9.4 → 3.4 hours, harassment 16.9 → 5.5, vandalism 13.5 → 4.2** (together **12.2 → 4.0 hours, 0.33x**). **Misinformation, copyright, and other reports did not improve** (together 25.4 → 25.6 hours). All reports together went from 15.4 to 6.5 hours (0.42x). The weekly median fell during the rollout week (Jul 27: 8.6 hours) and settled near 6-7 hours from August. Accept 0.30x-0.40x for the three fast types and "no change" for the others.
- **Evidence:** H4-hearth-guard-triage; Funnels `report submitted` → `report resolved`, hold `report_id` constant, median time to convert, breakdown `report_type`, compare date ranges (or Insights median `resolution_hours`); `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (rollout dates), 04-metrics-and-tables.md (resolution time definition).
- **Grading:** must break down by report type. Wrong: only the blended 0.42x with no type split; "every report type got faster"; including the rollout week in "after" without saying so.

### Q6 — Did Hearth Guard help the hard reports? (null)
- **Prompt:** "Did Hearth Guard also speed up misinformation and copyright reports, or just the easy ones?"
- **Type:** null-hypothesis
- **Answer:** **No change for misinformation, copyright, or other reports.** Before the rollout vs Aug 1 - Sep 23: misinformation median 25.2 → 25.3 hours (log-hours z ≈ +0.5), other 20.2 → 20.2 (z ≈ −0.2), copyright 38.2 → 32.0 (geometric-mean ratio 0.95, z ≈ −0.7 on 224 and 289 reports; the median moves around at that size). Together 25.4 → 25.6 hours (z ≈ +0.1). Accept "no meaningful change"; noting the copyright median wobble as noise is fine.
- **Evidence:** H4-hearth-guard-triage (control); `-- EVAL Q6`.
- **Context needed:** 02-timeline.md, 03-event-dictionary.md (`report_type`, `resolution_hours`).
- **Grading:** must check these types directly. Wrong: "yes, copyright improved 16%" from the median alone without a noise check; citing the all-types drop.

### Q7 — What happened in mid-August, and what did it cost?
- **Prompt:** "Trust and safety says there was a spam raid in August. Which hub was hit, and what did it do to the community?"
- **Type:** external-join
- **Answer:** The **anime hub, 2026-08-19 to 2026-08-21**. `trust_safety_daily` shows `raid_alert_level = raid` for anime only, with **77.0 spam accounts removed per day vs 7.3** on the same weekdays a week before and after, automod removals 223.0 vs 34.0, reports received 43.3 vs 17.0, and volunteer moderator hours 102.8 vs 28.5. In Mixpanel, anime participation (comments, new threads, upvotes, uploads) fell to **115.7 actions per day from 194.7** (0.59x), while the other hubs held steady (0.997x), so anime ran at **about 0.60x** its normal share; roughly **235 member actions** did not happen over the three days. Members filed 36.0 anime reports per day in Mixpanel vs 14.2 normally. Accept 0.50x-0.66x and naming anime and the dates.
- **Evidence:** H5-anime-spam-raid; Insights participation events, breakdown `content_hub`, daily; warehouse join on date and `content_hub`; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (raid dates), 04-metrics-and-tables.md (`trust_safety_daily`), 03-event-dictionary.md.
- **Grading:** must use the warehouse to identify the hub, give the dates, and size the participation loss against matched days. Wrong: "every hub was hit"; comparing raid weekdays with a week that includes a weekend; counting bot spam (it is not in Mixpanel).

### Q8 — What keeps newcomers around?
- **Prompt:** "Is there something that happens to new members in their first day that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Getting a reply to their intro within 24 hours.** Of new members who posted an intro (signups Jun 4 - Aug 31), **65.6% of those who got a reply within 24 hours were still active on or after day 30, vs 32.2%** of those who did not (871 vs 686 members), about **2.0x**; with a day 30-36 bracket it is 47.0% vs 23.5%. Posting an intro alone does not help: members with no intro retain at 32.9%, the same as unanswered intros. 56.3% of intros get a reply within 24 hours (2,113 intros). Accept a ratio of 1.7x-2.3x.
- **Evidence:** H6-first-reply-retention; Funnels `intro posted` → `notification received` (`notification_type = reply`), 24-hour window, save converters as a cohort; Retention, `account created` → a custom event "member action" (every event except `notification received` and `report resolved`), on or after day 30, filter did `intro posted`, breakdown by that cohort; `-- EVAL Q8`.
- **Context needed:** 01-business.md (onboarding, goal 2), 04-metrics-and-tables.md (retention and intro reply definitions), 03-event-dictionary.md (notification types).
- **Grading:** must define the behavior from the first day and exclude server-side events from "active". Wrong: counting notifications as activity (lapsed members keep receiving them); "posting an intro is what matters" (unanswered intros retain no better than no intro).

### Q9 — Do reverted edits drive editors away?
- **Prompt:** "Wiki moderators revert a lot of newcomer edits. Does that hurt? Do those people keep editing?"
- **Type:** retention
- **Answer:** Yes. Of new members whose first wiki edit was before Sep 1, those whose first edit was **reverted (an `edit_reverted` notification within 2 days) edited again within 30 days 25.2% of the time vs 65.6%** for those whose first edit stood (75 of 298 vs 351 of 535), about **0.38x**. 35.1% of new members' first edits are reverted (1,222 new editors). Accept 0.32x-0.48x.
- **Evidence:** H7-reverted-first-edit; Funnels `article edited` → `notification received` (`notification_type = edit_reverted`), 2-day window, save as cohort; Funnels `article edited` → `article edited`, 30-day window, new members, breakdown by that cohort; `-- EVAL Q9`.
- **Context needed:** 01-business.md (goal 2), 03-event-dictionary.md (`edit_reverted`), 04-metrics-and-tables.md (editor return rate).
- **Grading:** must restrict to new members' first edits and give both rates. Wrong: using all members (established editors' first in-window edit is not their first edit); counting edits made before the revert window.

### Q10 — What did the September ad change do to revenue?
- **Prompt:** "We added ad slots on September 2. How much more ad revenue are we making?"
- **Type:** external-join
- **Answer:** Ad revenue rose from **$117.68 per day (Jun 4 - Sep 1) to $174.41 per day (Sep 9 - Oct 1)**, about **+48%**. The driver is impressions per page view: impressions per Mixpanel free-member article view went from **19.30 to 31.05 (1.61x)**, with eCPM flat at about $3.01. Revenue rose less than impressions because free members read less (free article views fell from 2,020 to 1,865 per day). Four-week comparison: $3,137 (Jul 1-28) or $3,792 (Aug 3-30, inflated by Starfall) vs $4,844 (Sep 3-30). Accept +40% to +60% for revenue per day and 1.5x-1.7x for impressions per view.
- **Evidence:** H8-ad-load-change; warehouse `ad_revenue_daily` joined by date to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (`ad_revenue_daily`, caveats), 01-business.md (ads).
- **Grading:** must use the warehouse for revenue and give a before/after with a fair baseline. Wrong: using Mixpanel events as impressions; comparing September with the Starfall weeks only and calling it the full effect; claiming Plus members saw more ads.

### Q11 — Did free members read less after the ad change?
- **Prompt:** "Did the extra ads make free members read less?"
- **Type:** segmentation
- **Answer:** Yes, by about **10%**. Weekly average article views per viewer for free members fell from **10.61 (weeks of Jun 8 - Jul 27) to 9.48 (weeks of Sep 7-21), 0.89x**, while Plus members (no ads) stayed near their level (11.44 → 10.99, 0.96x). Article views per search, which cancels changes in how often people visit, fell **0.90x for free members (4.37 → 3.93) and did not move for Plus (4.44 → 4.43)**. Accept a free-member decline of 7%-14% with Plus flat.
- **Evidence:** H8-ad-load-change; Insights, `article viewed`, average per user, breakdown `membership`, weekly; formula `article viewed` / `search performed` by `membership`, before vs after Sep 2; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (ad change and who it affects), 03-event-dictionary.md (`membership` at event time).
- **Grading:** must compare free with Plus (or otherwise control for the trend). Wrong: using August as the baseline (Starfall inflates it); "no effect" from total views (membership growth hides the drop).

### Q12 — Why did Plus subscriptions jump in September?
- **Prompt:** "Plus subscriptions roughly doubled in September. Was it a promotion? What drove it?"
- **Type:** funnel
- **Answer:** There was no promotion or price change; the timing matches the **Sep 2 ad change**. Plus page visits held steady (**55.3 per day before, 52.3 after**), but **conversion per visit nearly doubled: 4.42% (220 of 4,979 visits, Jun 4 - Sep 1) → 8.40% (101 of 1,203, Sep 9 - Oct 1), about 1.9x**, ramping through the first week (6.47% on Sep 2-8). Subscriptions went from **14.5 to 28.9 per week**. 678 members (6.8%) are on Plus at the end of the window. Accept a conversion lift of 1.6x-2.3x with flat visits.
- **Evidence:** H8-ad-load-change; Funnels `plus page viewed` → `plus subscribed`, totals, 1-day window, before vs after; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change, no price change), 01-business.md (Plus).
- **Grading:** must separate visits from conversion and connect to the ad change. Wrong: "a price cut" or "a promotion" (neither happened); "more people visited the Plus page".

### Q13 — Cost per signup by channel
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **TikTok $5.07** (921 signups, $4,672.81), **Reddit $8.45** (764 signups, $6,453.14), **YouTube creators $12.89** (420 signups, $5,413.42). Monthly figures are stable (TikTok $4.65-$5.44, Reddit $8.13-$8.82, YouTube $12.55-$12.97, Jun-Sep). The platforms claim more signups (1,188 / 1,017 / 553), which would understate CAC. Accept ±5%.
- **Evidence:** H9-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting single days.

### Q14 — Is TikTok worth it?
- **Prompt:** "TikTok signups are our cheapest. Should we move more budget there?"
- **Type:** attribution
- **Answer:** **No, not on this evidence.** TikTok is the cheapest per signup ($5.07 vs $8.45 on Reddit, 0.60x) but only **24.3% of TikTok signups finish onboarding vs 52.6% from Reddit** and 51.4% from YouTube creators, so **spend per onboarded member is $20.86 on TikTok vs $16.05 on Reddit (1.30x)** and $25.06 on YouTube creators. TikTok signups also retain worse at day 30 (34.5% on or after day 30 vs 42.7%-43.5% for the other channels), because so few of them become members. Reddit is the best value per real member. Accept a TikTok/Reddit cost-per-onboarded ratio of 1.15x-1.45x.
- **Evidence:** H9-paid-channel-economics, H2-onboarding-by-channel; warehouse spend joined to the onboarding funnel by `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 01-business.md (goal 3), 04-metrics-and-tables.md (cost per onboarded member).
- **Grading:** must combine spend with a downstream outcome. Wrong: "yes, TikTok is cheapest" from CAC alone.

### Q15 — Did Fandom Fest work?
- **Prompt:** "Did Fandom Fest actually get people participating, or just looking?"
- **Type:** trend
- **Answer:** It lifted participation, not traffic. Thursday-Sunday Sep 17-20 vs the average of the same days a week before and a week after: **comments, new threads, upvotes, and uploads together 8,633 vs 5,356 (1.61x)** — comments 1.60x, new threads 1.65x, uploads 1.59x (fan art the largest media type, 276 uploads), upvotes 1.62x. **Reading did not change** (article views 1.01x, searches 1.04x), and new signups did not rise (145 vs 155.5). Accept a participation lift of 1.45x-1.75x and flat reading.
- **Evidence:** H10-fandom-fest; Insights, the four participation events and `article viewed`, daily, fest vs neighboring Thu-Sun; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (fest dates and format).
- **Grading:** must compare matching weekdays and separate participation from reading. Wrong: comparing the fest weekend with weekdays; "it brought in new members".

### Q16 — Which hub earns the most from ads?
- **Prompt:** "Which hubs make us the most ad money, and which monetize best per page?"
- **Type:** external-join
- **Answer:** Total ad revenue in the window was **$15,741**. **Gaming earns the most ($4,972, 31.6%)**, then movies_tv ($3,929, 25.0%), anime ($2,328), music ($1,728), tabletop ($1,419), books ($1,365). **movies_tv monetizes best**: the highest effective eCPM ($3.91 vs $3.38 for gaming and $2.18 for books) and the most revenue per 1,000 free-member article views ($86.69 vs $73.41 gaming, $48.47 books). Accept ±5% on revenue and the two rankings.
- **Evidence:** warehouse `ad_revenue_daily` by `content_hub`, joined to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`, RPM), 01-business.md (ads sold by hub).
- **Grading:** must distinguish total revenue from revenue per page or per impression. Wrong: ranking by Mixpanel views alone.

### Q17 — Is the community growing?
- **Prompt:** "Is Hearthside growing? How many members are active each week, and how much of that is new people?"
- **Type:** trend
- **Answer:** Yes. Weekly active members (any member action, Monday weeks) rose from **3,885 (week of Jun 8) to 4,798 (week of Sep 21), about +23%**. New members (joined since Jun 4) made up 357 of the Jun 8 week and **1,292 (27%) of the Sep 21 week**. Signups ran steady at about 1,100 per month (1,015 in June, 1,133 July, 1,113 August, 1,141 September). The first and last weeks are partial (Jun 4-7 and Sep 28 - Oct 1). Accept +18% to +28% and steady signups.
- **Evidence:** Insights, custom event "member action" (every event except `notification received` and `report resolved`), uniques, weekly; `account created` monthly; `-- EVAL Q17`.
- **Context needed:** 00-manifest.md (members vs server-side events), 04-metrics-and-tables.md (WAM definition).
- **Grading:** must use member actions and full weeks. Wrong: counting notification recipients as active; comparing a partial first week.

### Q18 — Are we seeing all the reports?
- **Prompt:** "The trust and safety lead says we get about 90 reports a day, but Mixpanel shows fewer. Who is right?"
- **Type:** context
- **Answer:** Both. The warehouse (`trust_safety_daily.reports_received`) counts **11,235 reports (93.6 per day)**; Mixpanel `report submitted` counts **9,069 (75.6 per day)**, so the warehouse is about **1.24x** Mixpanel. The difference is reports sent by email and by logged-out readers, which never reach Mixpanel. The two track each other closely day to day by hub (correlation 0.97). In Mixpanel, 2,333 members filed reports (about 23% of active members, 3.9 each). Accept a ratio of 1.15x-1.35x with the email / logged-out explanation.
- **Evidence:** `-- EVAL Q18`; warehouse `trust_safety_daily` vs Insights `report submitted`, daily, by `content_hub`.
- **Context needed:** 04-metrics-and-tables.md (`reports_received` caveat).
- **Grading:** must reconcile the two sources with the documented reason. Wrong: "Mixpanel is dropping events"; "the warehouse double-counts".

### Q19 — What should we worry about?
- **Prompt:** "What should the leadership team worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Newcomers posting into silence:** 43.7% of intros get no reply within 24 hours, and those members retain at half the rate (32.2% vs 65.6% on or after day 30).
  2. **Reverted first edits:** 35.1% of new members' first edits are reverted, and reverted newcomers mostly stop editing (25.2% edit again within 30 days vs 65.6%).
  3. **TikTok spend:** 20.7% of signups, but only 24.3% finish onboarding; the costliest real members after YouTube creators ($20.86 per onboarded member vs $16.05 on Reddit).
  4. **Ad load trade-off:** revenue per day up about 48% and Plus conversion about 1.9x, but free members read about 10% less; watch reading and retention.
  5. **Raid readiness:** a three-day raid cut anime participation to about 0.6x; Hearth Guard helps on spam reports but not on copyright or misinformation.
- **Evidence:** H2, H5, H6, H7, H8, H9; `-- EVAL Q19` plus Q7, Q8, Q9, Q10-Q12, Q14.
- **Context needed:** all guides.
- **Grading:** full credit for at least three supported risks with numbers. Wrong: generic advice without data; claiming the ad change only helped.

### Q20 — Where should the community team focus?
- **Prompt:** "If the community team could fix one thing to keep more new members, what should it be?"
- **Type:** open-ended
- **Answer:** **Make sure every intro gets a reply within a day.** Day-30 retention (on or after day 30, signups through Aug 31): no intro 32.9% (1,704), intro with no reply in 24 hours 32.2% (686), intro with a reply 65.6% (871). The reply, not the intro, is what separates members who stay, and about 44% of intros are not answered in time. A greeter rota or reply prompts for welcome threads targets that directly. Secondary: soften newcomer edit reverts (Q9) and fix TikTok onboarding (Q2). Accept a reply-focused recommendation backed by the retention gap; a revert-focused answer with numbers earns partial credit.
- **Evidence:** H6-first-reply-retention, H7-reverted-first-edit; `-- EVAL Q20`, Q8, Q9.
- **Context needed:** 01-business.md (goal 2), 04-metrics-and-tables.md (retention definitions).
- **Grading:** must tie the recommendation to measured retention. Wrong: "get more people to post intros" (intros without replies retain no better than no intro).

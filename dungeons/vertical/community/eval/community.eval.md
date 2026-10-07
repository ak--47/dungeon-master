# Hearthside (community) — 20-question eval

- **Data:** `data/verify-community` (full fidelity: 10,000 members, 9,985 with events, 4,484 new signups, 48 communities, 966,434 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/community/community.sql` on that data.
- **Stories:** ids refer to the `stories` export in `community.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — August gaming traffic
- **Prompt:** "Gaming wiki traffic jumped in August. What happened, and how big was it?"
- **Type:** trend
- **Answer:** The **Starfall release on 2026-08-06**. Gaming-hub article views averaged **1,284.6 per day from Aug 6 to Aug 19 vs 621.0 per day** in the two weeks before (Jul 23 - Aug 5), about **2.1x**. The surge peaked at launch (**1,564.0 per day on Aug 6-8**, about 2.5x) and faded to **974.0 per day by Aug 17-19** (about 1.6x). Gaming searches roughly doubled too (153.4 → 312.6 per day), and walkthrough, best builds, and tier list searches rose from 36.4% to 53.7% of gaming searches. Other hubs moved little (1,761.2 → 1,832.4 article views per day, +4.0%), so relative to the rest of the site gaming reading ran **1.99x** normal for the fortnight (1.98x with searches). The surge concentrated in **Starfall Guild**: 185.5 → 711.1 article views per day (3.8x), from 29.9% to 55.4% of gaming article views, while the other seven gaming communities rose only 1.22x-1.40x. Accept a launch-fortnight lift of 1.8x-2.3x, the Starfall release as the cause, a peak-then-fade shape, and Starfall Guild as the community that carried it.
- **Evidence:** H1-starfall-launch-surge; Insights, `article viewed` (and `search performed`), total, breakdown `content_hub`, daily; then breakdown `community_id` (group name) within `content_hub = gaming`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (Starfall release), 01-business.md (hubs), 03-event-dictionary.md (community group names).
- **Grading:** must name Starfall and the date, size the lift against a baseline, and note it was gaming-only. Full credit also finds that most of the extra reading was in one community, Starfall Guild (the guides do not name it; the `community_id` breakdown shows it). Wrong: a Hearthside campaign (there was none); "the whole site grew"; "every gaming community doubled"; quoting only the release-day peak as the fortnight's lift.

### Q2 — Which channels bring members who finish onboarding?
- **Prompt:** "Which acquisition channels bring people who actually finish onboarding?"
- **Type:** funnel
- **Answer:** 7-day onboarding completion (account created → interests selected → intro posted): **friend_invite 73.2%** (434 of 593), reddit_ads 57.6%, organic 50.5%, app_store 49.2%, youtube_creators 47.5%, and **tiktok_ads 23.1%** (217 of 941). Overall 48.6% (2,179 of 4,484). Friend invites finish at about **1.45x** organic; TikTok signups at under half the rate of the next-lowest channel (youtube_creators, 47.5%). TikTok signups also drop earlier: 68.8% reach the interests step vs 80.7-90.1% for the other channels. Accept rates within ±3 points and naming friend invites as best and TikTok as worst.
- **Evidence:** H2-onboarding-by-channel (and H9); Funnels, three onboarding steps, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (channels).
- **Grading:** must break down by channel and name both ends. Wrong: ranking channels by signup volume; using a window longer than 7 days without saying so.

### Q3 — Do weekend signups onboard better? (null)
- **Prompt:** "People who sign up on a weekend have more free time to set up their account. Do weekend signups finish onboarding more often than weekday signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **49.6% for signups on Saturday or Sunday (UTC; 1,470)** vs **48.1% for weekday signups** (3,014), z ≈ 0.9 (p ≈ 0.35). The gap stays small inside paid channels (41.6% vs 40.5%, z ≈ 0.5) and unpaid channels (57.7% vs 55.4%, z ≈ 1.0, p ≈ 0.31), and by device at signup (desktop 49.6% vs 50.0%, z ≈ −0.2; mobile 49.6% vs 46.0%, z ≈ 1.6, p ≈ 0.11). By day of week every day sits between 47.4% (Friday) and 49.7% (Saturday); chi-square 1.74 on 6 df, p ≈ 0.94. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Funnels onboarding steps, 7-day window, breakdown by day of week of `account created` (or two date-filtered funnels, weekends vs weekdays).
- **Context needed:** 03-event-dictionary.md; 00-manifest.md (UTC).
- **Grading:** must check the data and treat the gap as noise. Wrong: "yes, weekend signups onboard better"; reading the small mobile sub-split gap as a finding.

### Q4 — Is Reply Nudges working?
- **Prompt:** "Should we ship Reply Nudges to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-08, **7.81% of Nudges On thread views lead to a reply by the same member within a day vs 6.70% for Control** (6,903 of 88,412 vs 5,802 of 86,552 views), about **1.17x**, and the median time from opening the thread to replying is **11.98 vs 14.93 minutes** (0.80x). Members in both arms open about the same number of threads (20.42 vs 20.37 per member), so the gain is per thread view, not more browsing. The split is even (4,329 Nudges On vs 4,248 Control exposed members; first exposure 2026-07-08). Accept 1.08x-1.32x for reply rate and 0.72x-0.88x for time.
- **Evidence:** H3-reply-nudges-experiment; Funnels `discussion viewed` → `comment posted`, totals, hold `thread_id` constant, 1-day window, breakdown `Experiment: Reply Nudges`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`thread_id`).
- **Grading:** must compare per thread view within the test window. Wrong: unique-member funnel conversion (it counts a member once whether they reply to one thread or many, which blurs the per-view gap); comparing before vs after July 8 for everyone.

### Q5 — Is Hearth Guard speeding up report handling?
- **Prompt:** "Is Hearth Guard actually making report handling faster? For which reports?"
- **Type:** trend
- **Answer:** Yes, for **spam, harassment, and vandalism** reports. Median time from report to resolution (30-day funnel conversion window), reports filed before the 2026-07-22 rollout vs reports filed Aug 1 - Sep 23 (every community has Guard; each report has a week to resolve; the Aug 19-21 raid left out): **spam 9.6 → 3.4 hours, harassment 16.6 → 5.5, vandalism 12.6 → 4.7** (together **11.6 → 4.1 hours, 0.35x**). **Misinformation, copyright, and other reports did not improve** (together 27.2 → 25.6 hours; geometric-mean ratio 0.98, log-hours z ≈ −0.4; misinformation 27.1 → 25.7, other 20.2 → 20.4, copyright 39.2 → 34.6 on only 162 and 213 reports, log-hours z ≈ −1.9, not significant). All reports together went from 15.2 to 6.5 hours (0.43x). The weekly median fell during the rollout week (Jul 27: 8.4 hours) and settled near 6-7 hours from August (4.4 in the raid week, when spam reports flooded the queue). Accept 0.30x-0.40x for the three fast types and "no improvement" for the others.
- **Evidence:** H4-hearth-guard-triage; Funnels `report submitted` → `report resolved`, hold `report_id` constant, 30-day conversion window (a 3-day window drops slow reports), median time to convert, breakdown `report_type`, compare date ranges (or Insights median `resolution_hours`); `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (rollout dates), 04-metrics-and-tables.md (resolution time definition and window).
- **Grading:** must break down by report type. Wrong: only the blended 0.43x with no type split; "every report type got faster"; reading the copyright or "other" medians as a change (both are within noise); a 3-day conversion window (it drops many slow misinformation and copyright reports and moves their medians); including the rollout week in "after" without saying so.

### Q6 — Did Hearth Guard change moderator decisions? (null)
- **Prompt:** "Hearth Guard suggests an action for every report. Are moderators removing more content since it launched, or are they deciding the same way as before?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful change in decisions.** The share of resolved reports that end in `content_removed` is **51.8% for reports filed before 2026-07-22 vs 52.6% for reports filed Aug 1 - Sep 23** (1,984 and 2,723 reports, Aug 19-21 raid left out; z ≈ 0.5, p ≈ 0.60). The sub-splits agree: spam, harassment, and vandalism 52.0% → 53.3% (z ≈ 0.7); misinformation, copyright, and other 51.2% → 51.0% (z ≈ −0.1); every single type within |z| ≤ 1.87 (harassment 49.3% → 55.4%, p ≈ 0.06, is the largest wobble, and vandalism moves the other way, 58.1% → 51.0%). Guard made clear-cut reports faster (Q5), not more likely to end in removal. Accept "no meaningful change".
- **Evidence:** H4-hearth-guard-triage (outcome is not part of the change); Insights `report resolved`, total, breakdown `outcome`, filter by `report_type`, compare reports filed before Jul 22 vs from Aug 1 (or Funnels report submitted → report resolved, hold `report_id`, breakdown `outcome`); `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (Hearth Guard suggests actions; moderators still resolve), 03-event-dictionary.md (`outcome`).
- **Grading:** must check the outcome mix before and after, ideally by report type, and treat the gaps as noise. Wrong: "Guard made moderators remove more content" (or less); reading the harassment or vandalism wobble as a finding; answering with resolution speed instead of decisions.

### Q7 — What happened in mid-August, and what did it cost?
- **Prompt:** "Trust and safety says there was a spam raid in August. Which hub was hit, and what did it do to the community?"
- **Type:** external-join
- **Answer:** The **anime hub, 2026-08-19 to 2026-08-21**. `trust_safety_daily` shows `raid_alert_level = raid` for anime only, with **77.0 spam accounts removed per day vs 7.3** on the same weekdays a week before and after, automod removals 223.0 vs 34.0, reports received 153.7 vs 10.3 (the warehouse count includes the email surge from logged-out readers), and volunteer moderator hours 77.1 vs 21.4. In Mixpanel, anime participation (comments, new threads, upvotes, uploads) fell to **101.3 actions per day from 173.2** (0.58x), while the other hubs held steady (1.04x), so anime ran at **about 0.56x** its normal share; roughly **235 member actions** did not happen over the three days. Anime reading did not drop (anime share of article views 1.03x), so members kept reading but stopped posting. Members filed 90.7 anime reports per day in Mixpanel vs 7.7 normally. Accept 0.40x-0.65x and naming anime and the dates.
- **Evidence:** H5-anime-spam-raid; Insights participation events, breakdown `content_hub`, daily; warehouse join on date and `content_hub`; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (raid dates), 04-metrics-and-tables.md (`trust_safety_daily`), 03-event-dictionary.md.
- **Grading:** must use the warehouse to identify the hub, give the dates, and size the participation loss against matched days. Wrong: "every hub was hit"; comparing raid weekdays with a week that includes a weekend; counting bot spam (it is not in Mixpanel).

### Q8 — What keeps newcomers around?
- **Prompt:** "Is there something that happens to new members in their first day that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Getting a reply to their intro within 24 hours.** Of new members who posted an intro (signups Jun 4 - Aug 31), **46.4% of those who got a reply within 24 hours were still active on or after day 30, vs 24.0%** of those who did not (919 vs 722 members), about **1.9x**; with a day 30-36 bracket it is 42.8% vs 22.9%. The unanswered members fade over their first three weeks rather than on one day: on day 1 after the intro 60.4% of them are active vs 57.0% of the answered, by day 16 24.7% vs 33.0%. Posting an intro alone does not help: members with no intro retain at 22.9%, about the same as unanswered intros. 55.3% of intros get a reply within 24 hours (2,165 intros). Accept a ratio of 1.6x-2.4x.
- **Evidence:** H6-first-reply-retention; Funnels `intro posted` → `notification received` (`notification_type = reply`), 24-hour window, save converters as a cohort; Retention, `account created` → a custom event "member action" (every event except `notification received` and `report resolved`), on or after day 30, filter did `intro posted`, breakdown by that cohort; `-- EVAL Q8`.
- **Context needed:** 01-business.md (onboarding, goal 2), 04-metrics-and-tables.md (retention and intro reply definitions), 03-event-dictionary.md (notification types).
- **Grading:** must define the behavior from the first day and exclude server-side events from "active". Wrong: counting notifications as activity (lapsed members keep receiving them); "posting an intro is what matters" (unanswered intros retain no better than no intro).

### Q9 — Do reverted edits drive editors away?
- **Prompt:** "Wiki moderators revert a lot of newcomer edits. Does that hurt? Do those people keep editing?"
- **Type:** retention
- **Answer:** Yes. Of new members whose first wiki edit was before Sep 1, those whose first edit was **reverted (an `edit_reverted` notification within 2 days) edited again on or after day 2 only 24.0% of the time vs 57.0%** for those whose first edit stood (106 of 441 vs 470 of 825), about **0.42x**. Day 2 starts after every revert notice (they arrive 1-30 hours after the edit), so this read counts only edits made after the member could have seen the revert. The plain 30-day funnel (article edited → article edited) shows the same gap a little smaller, 33.3% vs 62.2% (0.54x), because it also counts edits made in the hours before the notice; with no follow-up limit it is 34.2% vs 64.4% (0.53x). 33.5% of new members' first edits are reverted (1,749 new editors). Accept 0.35x-0.62x.
- **Evidence:** H7-reverted-first-edit; Funnels `article edited` → `notification received` (`notification_type = edit_reverted`), 2-day window, save as cohort; Retention, first time `article edited` → `article edited`, on or after day 2, new members, breakdown by that cohort (or Funnels `article edited` → `article edited`, 30-day window); `-- EVAL Q9`.
- **Context needed:** 01-business.md (goal 2), 03-event-dictionary.md (`edit_reverted`), 04-metrics-and-tables.md (editor return rate).
- **Grading:** must restrict to new members' first edits and give both rates. Any follow-up window from 14 days to "ever" is fine if both groups use the same one and late first edits are left out; full credit notes that edits made before the revert notice blur the gap. Wrong: using all members (established editors' first in-window edit is not their first edit).

### Q10 — What did the September ad change do to revenue?
- **Prompt:** "We added ad slots on September 2. How much more ad revenue are we making?"
- **Type:** external-join
- **Answer:** Ad revenue rose from **$131.50 per day (Jun 4 - Sep 1) to $198.63 per day (Sep 9 - Oct 1)**, about **+51%**. The driver is impressions per page view: impressions per Mixpanel free-member article view went from **19.31 to 31.06 (1.61x)**, with eCPM flat at about $3.02. Revenue rose less than impressions because free members read a little less (free article views 2,253.0 → 2,121.6 per day). Four-week comparison: $3,578 (Jul 1-28) or $4,277 (Aug 3-30, inflated by Starfall) vs $5,538 (Sep 3-30). Accept +40% to +60% for revenue per day and 1.5x-1.7x for impressions per view.
- **Evidence:** H8-ad-load-change; warehouse `ad_revenue_daily` joined by date to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (`ad_revenue_daily`, caveats), 01-business.md (ads).
- **Grading:** must use the warehouse for revenue and give a before/after with a fair baseline. Wrong: using Mixpanel events as impressions; comparing September with the Starfall weeks only and calling it the full effect; claiming Plus members saw more ads.

### Q11 — Did free members read less after the ad change?
- **Prompt:** "Did the extra ads make free members read less? Look at how many articles people read per search, free vs Plus."
- **Type:** segmentation
- **Answer:** Yes, by about **10% per search**. Article views per search fell **0.90x for free members (4.06 → 3.65) and barely moved for Plus (4.12 → 4.04, 0.98x)**, so free members read about 8% fewer articles per search relative to Plus. Weekly average article views per viewer does not separate the groups (free 4.43 → 4.26, Plus 5.51 → 5.30, both 0.96x for the weeks of Jun 8 - Jul 27 vs Sep 7-21), because a lighter reader who opens fewer pages still counts as one viewer. Accept a free-member decline of 5%-14% in views per search with Plus flat or nearly flat.
- **Evidence:** H8-ad-load-change; Insights formula `article viewed` / `search performed`, breakdown `membership`, before vs after Sep 2; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (ad change and who it affects), 03-event-dictionary.md (`membership` at event time).
- **Grading:** must compare free with Plus on reading per search. Wrong: using August as the baseline (Starfall inflates it); "no effect" from total views or views per viewer alone.

### Q12 — Why did Plus subscriptions jump in September?
- **Prompt:** "Plus subscriptions roughly doubled in September. Was it a promotion? What drove it?"
- **Type:** funnel
- **Answer:** There was no promotion or price change; the timing matches the **Sep 2 ad change**. Subscriptions went from **21.2 to 44.4 per week** (Jun 4 - Sep 1 vs Sep 9 - Oct 1). Two things moved. Plus page visits rose about 15% (**94.5 per day before, 108.6 after**; 93.7 in the ramp week Sep 2-8). And **conversion rose: 3.66% of upgrade attempts converted Jun 4 - Sep 1 (266 of 7,268) vs 6.72% Sep 9 - Oct 1 (146 of 2,172), about 1.8x**, 4.39% in the ramp week. (Attempts follow the Mixpanel totals funnel: a second Plus page visit within a day of an open attempt stays in that attempt.) The change came through the **ad-free pitch**: attempts with `upgrade_trigger = ad_free` rose from 40.0% to 53.6% of attempts, and their conversion went from **4.13% to 8.51% (2.1x)**; before the change ad-free converted only a little better than the other pitches. The other triggers (custom flair, profile badges, larger uploads) rose less, 3.35% → 4.66% combined (1.4x on only 47 conversions after the change, z ≈ 2.0, too few to call). 650 members (6.5%) are on Plus at the end of the window. Accept a conversion lift of 1.4x-2.2x per attempt plus a modest rise in visits; full credit names the ad-free trigger as the main driver.
- **Evidence:** H8-ad-load-change; Funnels `plus page viewed` → `plus subscribed`, totals, 1-day window, before vs after, breakdown `upgrade_trigger`; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change, no price change), 01-business.md (Plus).
- **Grading:** must separate visits from conversion and connect to the ad change. Wrong: "a price cut" or "a promotion" (neither happened); "only more people visited the Plus page" (conversion moved more than visits); a confident claim that every upgrade reason converted much better.

### Q13 — Cost per signup by channel
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **TikTok $4.97** (941 signups, $4,672.81), **Reddit $7.88** (819 signups, $6,453.14), **YouTube creators $11.85** (457 signups, $5,413.42). Monthly figures are stable (TikTok $4.81-$5.34, Reddit $7.38-$8.80, YouTube $11.41-$12.53 across Jun-Sep). The platforms claim more signups (1,188 / 1,017 / 553), which would understate CAC. Accept ±5%.
- **Evidence:** H9-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting single days.

### Q14 — Is TikTok worth it?
- **Prompt:** "TikTok signups are our cheapest. Should we move more budget there?"
- **Type:** attribution
- **Answer:** **No, not on this evidence.** TikTok is the cheapest per signup ($4.97 vs $7.88 on Reddit, 0.63x) but only **23.1% of TikTok signups finish onboarding vs 57.6% from Reddit** and 47.5% from YouTube creators, so **spend per onboarded member is $21.53 on TikTok vs $13.67 on Reddit (1.58x)** and $24.95 on YouTube creators. TikTok signups also retain worse: 25.3% are active on or after day 30 vs 33.5% for Reddit and 29.4% for YouTube creators (signups through Aug 31), which follows from more of them abandoning setup. Reddit is the best value per onboarded member. Accept a TikTok/Reddit cost-per-onboarded ratio of 1.3x-1.8x.
- **Evidence:** H9-paid-channel-economics, H2-onboarding-by-channel; warehouse spend joined to the onboarding funnel by `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 01-business.md (goal 3), 04-metrics-and-tables.md (cost per onboarded member).
- **Grading:** must combine spend with a downstream outcome. Wrong: "yes, TikTok is cheapest" from CAC alone.

### Q15 — Did Fandom Fest work?
- **Prompt:** "Did Fandom Fest actually get people participating, or just looking?"
- **Type:** trend
- **Answer:** It lifted participation, not traffic. Thursday-Sunday Sep 17-20 vs the average of the same days a week before and a week after: **comments, new threads, upvotes, and uploads together 7,448 vs 4,466 (1.67x)** — comments 1.55x, new threads 1.60x, uploads 1.75x (fan art the largest media type, 298 uploads), upvotes 1.68x. **Reading barely moved** (article views 1.05x, searches 1.04x). New signups did not rise either: 152 on the fest days vs 150 on the neighboring Thu-Sun; across the window's 17 Thu-Sun blocks signups average 156.9 (sd 10.0, range 141-175), and nothing about the fest targeted signups. Accept a participation lift of 1.45x-1.80x and flat or nearly flat reading.
- **Evidence:** H10-fandom-fest; Insights, the four participation events and `article viewed`, daily, fest vs neighboring Thu-Sun; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (fest dates and format).
- **Grading:** must compare matching weekdays and separate participation from reading. Accept any accurate statement about signups (flat, near the window's average). Wrong: comparing the fest weekend with weekdays; a causal claim that the fest moved signups up or down.

### Q16 — Which hub earns the most from ads?
- **Prompt:** "Which hubs make us the most ad money, and which monetize best per page?"
- **Type:** external-join
- **Answer:** Total ad revenue in the window was **$17,755**. **Gaming earns the most ($5,541, 31.2%)**, then movies_tv ($4,495, 25.3%), anime ($2,680), music ($1,924), tabletop ($1,610), books ($1,505). **movies_tv monetizes best**: the highest effective eCPM ($3.91 vs $3.38 for gaming and $2.18 for books) and the most revenue per 1,000 free-member article views ($87.22 vs $73.45 gaming, $48.60 books). Accept ±5% on revenue and the two rankings.
- **Evidence:** warehouse `ad_revenue_daily` by `content_hub`, joined to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`, RPM), 01-business.md (ads sold by hub).
- **Grading:** must distinguish total revenue from revenue per page or per impression. Wrong: ranking by Mixpanel views alone.

### Q17 — Is the community growing?
- **Prompt:** "Is Hearthside growing? How many members are active each week, and how much of that is new people?"
- **Type:** trend
- **Answer:** Yes. Weekly active members (any member action, Monday weeks) rose from **3,659 (week of Jun 8) to 4,468 (week of Sep 21), about +22%**. New members (joined since Jun 4) made up 386 of the Jun 8 week and **1,260 (28%) of the Sep 21 week**. Signups ran steady at about 1,100-1,200 per month (1,155 July, 1,196 August, 1,077 September; 1,012 in June, which starts on the 4th). The first and last weeks are partial (Jun 4-7 and Sep 28 - Oct 1). Accept +15% to +30% and steady signups.
- **Evidence:** Insights, custom event "member action" (every event except `notification received` and `report resolved`), uniques, weekly; `account created` monthly; `-- EVAL Q17`.
- **Context needed:** 00-manifest.md (members vs server-side events), 04-metrics-and-tables.md (WAM definition).
- **Grading:** must use member actions and full weeks. Wrong: counting notification recipients as active; comparing a partial first week.

### Q18 — Are we seeing all the reports?
- **Prompt:** "The trust and safety lead says we get about 67 reports a day, but Mixpanel shows fewer. Who is right?"
- **Type:** context
- **Answer:** Both. The warehouse (`trust_safety_daily.reports_received`) counts **8,049 reports (67.1 per day)**; Mixpanel `report submitted` counts **6,069 (50.6 per day)**, so the warehouse is about **1.33x** Mixpanel. The difference is reports sent by email and by logged-out readers, which never reach Mixpanel (the gap was widest during the August raid, when logged-out readers emailed in reports). The two track each other closely day to day by hub (correlation 0.976). In Mixpanel, 871 members filed reports (about 9% of active members, 6.97 each). Accept a ratio of 1.2x-1.45x with the email / logged-out explanation.
- **Evidence:** `-- EVAL Q18`; warehouse `trust_safety_daily` vs Insights `report submitted`, daily, by `content_hub`.
- **Context needed:** 04-metrics-and-tables.md (`reports_received` caveat), 02-timeline.md (raid emails).
- **Grading:** must reconcile the two sources with the documented reason. Wrong: "Mixpanel is dropping events"; "the warehouse double-counts".

### Q19 — What should we worry about?
- **Prompt:** "What should the leadership team worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Newcomers posting into silence:** 44.7% of intros get no reply within 24 hours, and those members retain at about half the rate (24.0% vs 46.4% on or after day 30). Only 29.5% of new members are active on or after day 30 overall.
  2. **Reverted first edits:** 33.5% of new members' first edits are reverted, and reverted newcomers mostly stop editing (24.0% edit again after the revert notice vs 57.0%).
  3. **TikTok spend:** 21.0% of signups, but only 23.1% finish onboarding; $21.53 per onboarded member vs $13.67 on Reddit (YouTube creators cost the most per onboarded member, $24.95).
  4. **Ad load trade-off:** revenue per day up about 51% and Plus conversion about 1.8x (through the ad-free pitch), but free members read about 10% fewer articles per search; watch reading and retention.
  5. **Raid readiness:** a three-day raid cut anime participation to about 0.56x its normal share; Hearth Guard helps on spam reports but not on copyright or misinformation.
- **Evidence:** H2, H5, H6, H7, H8, H9; `-- EVAL Q19` plus Q7, Q8, Q9, Q10-Q12, Q14.
- **Context needed:** all guides.
- **Grading:** full credit for at least three supported risks with numbers. Wrong: generic advice without data; claiming the ad change only helped.

### Q20 — Where should the community team focus?
- **Prompt:** "If the community team could fix one thing to keep more new members, what should it be?"
- **Type:** open-ended
- **Answer:** **Make sure every intro gets a reply within a day.** Day-30 retention (on or after day 30, signups through Aug 31): no intro 22.9% (1,722), intro with no reply in 24 hours 24.0% (722), intro with a reply 46.4% (919). The reply, not the intro, is what separates members who stay, and about 45% of intros are not answered in time. A greeter rota or reply prompts for welcome threads targets that directly. Secondary: soften newcomer edit reverts (Q9) and fix TikTok onboarding (Q2). Accept a reply-focused recommendation backed by the retention gap; a revert-focused answer with numbers earns partial credit.
- **Evidence:** H6-first-reply-retention, H7-reverted-first-edit; `-- EVAL Q20`, Q8, Q9.
- **Context needed:** 01-business.md (goal 2), 04-metrics-and-tables.md (retention definitions).
- **Grading:** must tie the recommendation to measured retention. Wrong: "get more people to post intros" (intros without replies retain no better than no intro).

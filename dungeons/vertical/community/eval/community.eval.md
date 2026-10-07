# Hearthside (community) — 20-question eval

- **Data:** `data/verify-community` (full fidelity: 10,000 members, 9,992 with events, 4,447 new signups, 48 communities, 947,195 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/community/community.sql` on that data.
- **Stories:** ids refer to the `stories` export in `community.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — August gaming traffic
- **Prompt:** "Gaming wiki traffic jumped in August. What happened, and how big was it?"
- **Type:** trend
- **Answer:** The **Starfall release on 2026-08-06**. Gaming-hub article views averaged **1,294.9 per day from Aug 6 to Aug 19 vs 653.7 per day** in the two weeks before (Jul 23 - Aug 5), about **2.0x**. The surge peaked at launch (**1,638.3 per day on Aug 6-8**, about 2.5x) and faded to **944.7 per day by Aug 17-19** (about 1.45x). Gaming searches nearly doubled too (166.1 → 322.9 per day), and walkthrough, best builds, and tier list searches rose from 35.8% to 55.8% of gaming searches. Other hubs barely moved (1,741.6 → 1,786.6 article views per day, +2.6%), so relative to the rest of the site gaming reading ran **1.93x** normal for the fortnight (1.92x with searches). The surge concentrated in **Starfall Guild**: 186.9 → 725.6 article views per day (3.9x), from 28.6% to 56.0% of gaming article views, while the other seven gaming communities rose only 1.07x-1.26x. Accept a launch-fortnight lift of 1.8x-2.3x, the Starfall release as the cause, a peak-then-fade shape, and Starfall Guild as the community that carried it.
- **Evidence:** H1-starfall-launch-surge; Insights, `article viewed` (and `search performed`), total, breakdown `content_hub`, daily; then breakdown `community_id` (group name) within `content_hub = gaming`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (Starfall release), 01-business.md (hubs), 03-event-dictionary.md (community group names).
- **Grading:** must name Starfall and the date, size the lift against a baseline, and note it was gaming-only. Full credit also finds that most of the extra reading was in one community, Starfall Guild (the guides do not name it; the `community_id` breakdown shows it). Wrong: a Hearthside campaign (there was none); "the whole site grew"; "every gaming community doubled"; quoting only the release-day peak as the fortnight's lift.

### Q2 — Which channels bring members who finish onboarding?
- **Prompt:** "Which acquisition channels bring people who actually finish onboarding?"
- **Type:** funnel
- **Answer:** 7-day onboarding completion (account created → interests selected → intro posted): **friend_invite 70.4%** (399 of 567), reddit_ads 56.5%, organic 51.7%, youtube_creators 51.3%, app_store 48.2%, and **tiktok_ads 25.2%** (233 of 926). Overall 49.0% (2,181 of 4,447). Friend invites finish at about **1.36x** organic; TikTok signups at about half the rate of the next-lowest channel (app_store, 48.2%). TikTok signups also drop earlier: 67.8% reach the interests step vs 78-86% for the other channels. Accept rates within ±3 points and naming friend invites as best and TikTok as worst.
- **Evidence:** H2-onboarding-by-channel (and H9); Funnels, three onboarding steps, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (channels).
- **Grading:** must break down by channel and name both ends. Wrong: ranking channels by signup volume; using a window longer than 7 days without saying so.

### Q3 — Do mobile signups onboard worse? (null)
- **Prompt:** "People who sign up on their phones have to type an intro on a small keyboard. Do mobile signups finish onboarding less often than desktop signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **48.4% for mobile signups** (iOS, iPadOS, Android; 1,635) vs **49.4% for desktop** (2,812), z ≈ −0.6 (p ≈ 0.54). The gap stays small inside paid channels (41.8% vs 42.2%, z ≈ −0.2) and unpaid channels (54.7% vs 56.2%, z ≈ −0.7). By operating system, rates run 47.4%-50.3% for every system with more than 200 signups, and the two small Linux distributions (90 and 56 signups) sit at 53.3% and 62.5%; chi-square 6.29 on 7 df, p ≈ 0.51. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Funnels onboarding steps, 7-day window, breakdown `os` (device of `account created`).
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the gap as noise. Wrong: "yes, mobile is worse"; reading the 56-signup PureOS row or the 3-signup Linux row as a finding.

### Q4 — Is Reply Nudges working?
- **Prompt:** "Should we ship Reply Nudges to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-08, **31.4% of Nudges On thread views lead to a reply by the same member within a day vs 26.0% for Control** (16,711 of 53,193 vs 14,383 of 55,278 views), about **1.21x**, and the median time from opening the thread to replying is **12.0 vs 15.1 minutes** (0.80x). Members in both arms open about the same number of threads (13.07 vs 13.22 per member), so the gain is per thread view, not more browsing. The split is even (4,070 Nudges On vs 4,180 Control exposed members; first exposure 2026-07-08). Accept 1.08x-1.32x for reply rate and 0.72x-0.88x for time.
- **Evidence:** H3-reply-nudges-experiment; Funnels `discussion viewed` → `comment posted`, totals, hold `thread_id` constant, 1-day window, breakdown `Experiment: Reply Nudges`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`thread_id`).
- **Grading:** must compare per thread view within the test window. Wrong: unique-member funnel conversion (most members reply at least once, which hides the gap); comparing before vs after July 8 for everyone.

### Q5 — Is Hearth Guard speeding up report handling?
- **Prompt:** "Is Hearth Guard actually making report handling faster? For which reports?"
- **Type:** trend
- **Answer:** Yes, for **spam, harassment, and vandalism** reports. Median time from report to resolution, reports filed before the 2026-07-22 rollout vs reports filed Aug 1 - Sep 23 (every community has Guard; each report has a week to resolve; the Aug 19-21 raid left out): **spam 9.3 → 3.5 hours, harassment 16.0 → 5.8, vandalism 12.5 → 4.5** (together **11.6 → 4.3 hours, 0.37x**). **Misinformation, copyright, and other reports did not improve** (together 24.7 → 24.4 hours; geometric-mean ratio 1.00, log-hours z ≈ −0.1; misinformation 25.1 → 24.6, other 17.3 → 19.3, copyright 35.1 → 32.2 on only 287 and 363 reports). All reports together went from 14.7 to 6.6 hours (0.45x). The weekly median fell during the rollout week (Jul 27: 9.1 hours) and settled near 5-7.5 hours from August. Accept 0.30x-0.40x for the three fast types and "no improvement" for the others.
- **Evidence:** H4-hearth-guard-triage; Funnels `report submitted` → `report resolved`, hold `report_id` constant, median time to convert, breakdown `report_type`, compare date ranges (or Insights median `resolution_hours`); `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (rollout dates), 04-metrics-and-tables.md (resolution time definition).
- **Grading:** must break down by report type. Wrong: only the blended 0.45x with no type split; "every report type got faster"; reading the copyright or "other" medians as a change (both are within noise); including the rollout week in "after" without saying so.

### Q6 — Did Hearth Guard change moderator decisions? (null)
- **Prompt:** "Hearth Guard suggests an action for every report. Are moderators removing more content since it launched, or are they deciding the same way as before?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful change in decisions.** The share of resolved reports that end in `content_removed` is **51.6% for reports filed before 2026-07-22 vs 50.2% for reports filed Aug 1 - Sep 23** (3,730 and 4,458 reports, Aug 19-21 raid left out; z ≈ −1.2, p ≈ 0.23). The sub-splits agree: spam, harassment, and vandalism 51.2% → 50.8% (z ≈ −0.3); misinformation, copyright, and other 52.4% → 49.0% (z ≈ −1.7, p ≈ 0.09); every single type within |z| < 1.8 (copyright 53.7% → 46.8% on 287 and 363 reports, z ≈ −1.7, is the largest wobble, and vandalism moves the other way, 49.9% → 53.6%). Guard made clear-cut reports faster (Q5), not more likely to end in removal. Accept "no meaningful change".
- **Evidence:** H4-hearth-guard-triage (outcome is not part of the change); Insights `report resolved`, total, breakdown `outcome`, filter by `report_type`, compare reports filed before Jul 22 vs from Aug 1 (or Funnels report submitted → report resolved, hold `report_id`, breakdown `outcome`); `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (Hearth Guard suggests actions; moderators still resolve), 03-event-dictionary.md (`outcome`).
- **Grading:** must check the outcome mix before and after, ideally by report type, and treat the gaps as noise. Wrong: "Guard made moderators remove more content" (or less); reading the copyright wobble as a finding; answering with resolution speed instead of decisions.

### Q7 — What happened in mid-August, and what did it cost?
- **Prompt:** "Trust and safety says there was a spam raid in August. Which hub was hit, and what did it do to the community?"
- **Type:** external-join
- **Answer:** The **anime hub, 2026-08-19 to 2026-08-21**. `trust_safety_daily` shows `raid_alert_level = raid` for anime only, with **77.0 spam accounts removed per day vs 7.3** on the same weekdays a week before and after, automod removals 223.0 vs 34.0, reports received 73.0 vs 19.8, and volunteer moderator hours 77.1 vs 21.4. In Mixpanel, anime participation (comments, new threads, upvotes, uploads) fell to **127.3 actions per day from 230.3** (0.55x), while the other hubs held steady (1.00x), so anime ran at **about 0.55x** its normal share; roughly **308 member actions** did not happen over the three days. Anime reading did not drop (anime share of article views 1.06x), so members kept reading but stopped posting. Members filed 59.7 anime reports per day in Mixpanel vs 16.5 normally. Accept 0.40x-0.65x and naming anime and the dates.
- **Evidence:** H5-anime-spam-raid; Insights participation events, breakdown `content_hub`, daily; warehouse join on date and `content_hub`; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (raid dates), 04-metrics-and-tables.md (`trust_safety_daily`), 03-event-dictionary.md.
- **Grading:** must use the warehouse to identify the hub, give the dates, and size the participation loss against matched days. Wrong: "every hub was hit"; comparing raid weekdays with a week that includes a weekend; counting bot spam (it is not in Mixpanel).

### Q8 — What keeps newcomers around?
- **Prompt:** "Is there something that happens to new members in their first day that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Getting a reply to their intro within 24 hours.** Of new members who posted an intro (signups Jun 4 - Aug 31), **74.0% of those who got a reply within 24 hours were still active on or after day 30, vs 36.7%** of those who did not (920 vs 720 members), about **2.0x**; with a day 30-36 bracket it is 68.2% vs 33.5%. The unanswered members fade over their first three weeks rather than on one day: on day 1 after the intro 53.5% of them are active vs 52.1% of the answered, by day 16 21.7% vs 40.5%. Posting an intro alone does not help: members with no intro retain at 36.9%, the same as unanswered intros. 55.8% of intros get a reply within 24 hours (2,165 intros). Accept a ratio of 1.7x-2.4x.
- **Evidence:** H6-first-reply-retention; Funnels `intro posted` → `notification received` (`notification_type = reply`), 24-hour window, save converters as a cohort; Retention, `account created` → a custom event "member action" (every event except `notification received` and `report resolved`), on or after day 30, filter did `intro posted`, breakdown by that cohort; `-- EVAL Q8`.
- **Context needed:** 01-business.md (onboarding, goal 2), 04-metrics-and-tables.md (retention and intro reply definitions), 03-event-dictionary.md (notification types).
- **Grading:** must define the behavior from the first day and exclude server-side events from "active". Wrong: counting notifications as activity (lapsed members keep receiving them); "posting an intro is what matters" (unanswered intros retain no better than no intro).

### Q9 — Do reverted edits drive editors away?
- **Prompt:** "Wiki moderators revert a lot of newcomer edits. Does that hurt? Do those people keep editing?"
- **Type:** retention
- **Answer:** Yes. Of new members whose first wiki edit was before Sep 1, those whose first edit was **reverted (an `edit_reverted` notification within 2 days) edited again within 30 days 26.8% of the time vs 58.6%** for those whose first edit stood (102 of 380 vs 415 of 708), about **0.46x**. With no follow-up limit the gap is the same (27.6% vs 62.2%, 0.44x). 34.5% of new members' first edits are reverted (1,518 new editors). Accept 0.35x-0.62x.
- **Evidence:** H7-reverted-first-edit; Funnels `article edited` → `notification received` (`notification_type = edit_reverted`), 2-day window, save as cohort; Funnels `article edited` → `article edited`, 30-day window, new members, breakdown by that cohort; `-- EVAL Q9`.
- **Context needed:** 01-business.md (goal 2), 03-event-dictionary.md (`edit_reverted`), 04-metrics-and-tables.md (editor return rate).
- **Grading:** must restrict to new members' first edits and give both rates. Any follow-up window from 14 days to "ever" is fine if both groups use the same one and late first edits are left out. Wrong: using all members (established editors' first in-window edit is not their first edit); counting edits made before the revert window.

### Q10 — What did the September ad change do to revenue?
- **Prompt:** "We added ad slots on September 2. How much more ad revenue are we making?"
- **Type:** external-join
- **Answer:** Ad revenue rose from **$123.58 per day (Jun 4 - Sep 1) to $176.87 per day (Sep 9 - Oct 1)**, about **+43%**. The driver is impressions per page view: impressions per Mixpanel free-member article view went from **19.30 to 31.09 (1.61x)**, with eCPM flat at about $3.01. Revenue rose less than impressions because free members read less (free article views fell from 2,119.9 to 1,890.9 per day). Four-week comparison: $3,378 (Jul 1-28) or $3,927 (Aug 3-30, inflated by Starfall) vs $4,967 (Sep 3-30). Accept +35% to +55% for revenue per day and 1.5x-1.7x for impressions per view.
- **Evidence:** H8-ad-load-change; warehouse `ad_revenue_daily` joined by date to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (`ad_revenue_daily`, caveats), 01-business.md (ads).
- **Grading:** must use the warehouse for revenue and give a before/after with a fair baseline. Wrong: using Mixpanel events as impressions; comparing September with the Starfall weeks only and calling it the full effect; claiming Plus members saw more ads.

### Q11 — Did free members read less after the ad change?
- **Prompt:** "Did the extra ads make free members read less?"
- **Type:** segmentation
- **Answer:** Yes, by about **8-9%**. Weekly average article views per viewer for free members fell from **3.18 (weeks of Jun 8 - Jul 27) to 2.93 (weeks of Sep 7-21), 0.92x**, while Plus members (no ads) stayed nearly level (4.00 → 3.91, 0.98x). Article views per search, which cancels changes in how often people visit, fell **0.91x for free members (3.99 → 3.65) and did not move for Plus (4.03 → 3.99, 0.99x)**. Accept a free-member decline of 5%-14% with Plus flat.
- **Evidence:** H8-ad-load-change; Insights, `article viewed`, average per user, breakdown `membership`, weekly; formula `article viewed` / `search performed` by `membership`, before vs after Sep 2; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (ad change and who it affects), 03-event-dictionary.md (`membership` at event time).
- **Grading:** must compare free with Plus (or otherwise control for the trend). Wrong: using August as the baseline (Starfall inflates it); "no effect" from total views (membership growth hides the drop).

### Q12 — Why did Plus subscriptions jump in September?
- **Prompt:** "Plus subscriptions jumped about 50% in September. Was it a promotion? What drove it?"
- **Type:** funnel
- **Answer:** There was no promotion or price change; the timing matches the **Sep 2 ad change**. Plus page visits held roughly steady (**85.2 per day before, 79.7 after**), but **conversion per visit rose: 5.88% (451 of 7,664 visits, Jun 4 - Sep 1) → 9.28% (170 of 1,832, Sep 9 - Oct 1), about 1.6x**, ramping through the first week (8.06% on Sep 2-8). Subscriptions went from **31.6 to 49.3 per week**. The change came through the **ad-free pitch**: visits with `upgrade_trigger = ad_free` rose from 40.1% to 54.5% of Plus page visits, and their conversion went from **5.69% to 11.81% (2.1x)**. Before the change ad-free converted about like the other pitches; the other triggers (custom flair, profile badges, larger uploads) stayed flat, 6.02% → 6.24% combined (1.04x, 52 conversions after the change). 1,045 members (10.5%) are on Plus at the end of the window. Accept a conversion lift of 1.35x-1.85x with flat visits; full credit names the ad-free trigger and the flat other triggers.
- **Evidence:** H8-ad-load-change; Funnels `plus page viewed` → `plus subscribed`, totals, 1-day window, before vs after, breakdown `upgrade_trigger`; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change, no price change), 01-business.md (Plus).
- **Grading:** must separate visits from conversion and connect to the ad change. Wrong: "a price cut" or "a promotion" (neither happened); "more people visited the Plus page"; "every upgrade reason converted better".

### Q13 — Cost per signup by channel
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **TikTok $5.05** (926 signups, $4,672.81), **Reddit $8.02** (805 signups, $6,453.14), **YouTube creators $12.68** (427 signups, $5,413.42). Monthly figures are stable (TikTok $4.89-$5.34, Reddit $7.65-$8.80, YouTube $11.56-$14.05 across Jun-Sep; September is the highest month for each channel because it had fewer signups on a steady budget). The platforms claim more signups (1,188 / 1,017 / 553), which would understate CAC. Accept ±5%.
- **Evidence:** H9-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting single days.

### Q14 — Is TikTok worth it?
- **Prompt:** "TikTok signups are our cheapest. Should we move more budget there?"
- **Type:** attribution
- **Answer:** **No, not on this evidence.** TikTok is the cheapest per signup ($5.05 vs $8.02 on Reddit, 0.63x) but only **25.2% of TikTok signups finish onboarding vs 56.5% from Reddit** and 51.3% from YouTube creators, so **spend per onboarded member is $20.05 on TikTok vs $14.18 on Reddit (1.41x)** and $24.72 on YouTube creators. TikTok signups also retain worse at day 30 (38.8% on or after day 30 vs 50.3% for Reddit and 51.8% for YouTube creators), because so few of them become members. Reddit is the best value per real member. Accept a TikTok/Reddit cost-per-onboarded ratio of 1.15x-1.55x.
- **Evidence:** H9-paid-channel-economics, H2-onboarding-by-channel; warehouse spend joined to the onboarding funnel by `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 01-business.md (goal 3), 04-metrics-and-tables.md (cost per onboarded member).
- **Grading:** must combine spend with a downstream outcome. Wrong: "yes, TikTok is cheapest" from CAC alone.

### Q15 — Did Fandom Fest work?
- **Prompt:** "Did Fandom Fest actually get people participating, or just looking?"
- **Type:** trend
- **Answer:** It lifted participation, not traffic. Thursday-Sunday Sep 17-20 vs the average of the same days a week before and a week after: **comments, new threads, upvotes, and uploads together 9,204 vs 5,743 (1.60x)** — comments 1.71x, new threads 1.47x, uploads 1.56x (fan art the largest media type, 271 uploads), upvotes 1.58x. **Reading did not move** (article views 0.98x, searches 0.95x). New signups did not rise either: 134 on the fest days vs 164 on the neighboring Thu-Sun; across the window's 17 Thu-Sun blocks signups average 156.5 (sd 10.8, range 134-171), so the fest block is at the low end of normal day-to-day variation, and nothing about the fest targeted signups. Accept a participation lift of 1.45x-1.80x and flat reading.
- **Evidence:** H10-fandom-fest; Insights, the four participation events and `article viewed`, daily, fest vs neighboring Thu-Sun; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (fest dates and format).
- **Grading:** must compare matching weekdays and separate participation from reading. Wrong: comparing the fest weekend with weekdays; "it brought in new members"; "the fest drove signups down" (a single low block, within normal variation).

### Q16 — Which hub earns the most from ads?
- **Prompt:** "Which hubs make us the most ad money, and which monetize best per page?"
- **Type:** external-join
- **Answer:** Total ad revenue in the window was **$16,443**. **Gaming earns the most ($5,274, 32.1%)**, then movies_tv ($4,056, 24.7%), anime ($2,440), music ($1,764), tabletop ($1,468), books ($1,441). **movies_tv monetizes best**: the highest effective eCPM ($3.91 vs $3.38 for gaming and $2.18 for books) and the most revenue per 1,000 free-member article views ($86.49 vs $73.26 gaming, $48.49 books). Accept ±5% on revenue and the two rankings.
- **Evidence:** warehouse `ad_revenue_daily` by `content_hub`, joined to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`, RPM), 01-business.md (ads sold by hub).
- **Grading:** must distinguish total revenue from revenue per page or per impression. Wrong: ranking by Mixpanel views alone.

### Q17 — Is the community growing?
- **Prompt:** "Is Hearthside growing? How many members are active each week, and how much of that is new people?"
- **Type:** trend
- **Answer:** Yes. Weekly active members (any member action, Monday weeks) rose from **5,364 (week of Jun 8) to 6,589 (week of Sep 21), about +23%**. New members (joined since Jun 4) made up 396 of the Jun 8 week and **1,628 (25%) of the Sep 21 week**. Signups ran steady at about 1,100 per month (1,175 July, 1,122 August, 1,077 September; 1,035 in June, which starts on the 4th). The first and last weeks are partial (Jun 4-7 and Sep 28 - Oct 1). Accept +17% to +28% and steady signups.
- **Evidence:** Insights, custom event "member action" (every event except `notification received` and `report resolved`), uniques, weekly; `account created` monthly; `-- EVAL Q17`.
- **Context needed:** 00-manifest.md (members vs server-side events), 04-metrics-and-tables.md (WAM definition).
- **Grading:** must use member actions and full weeks. Wrong: counting notification recipients as active; comparing a partial first week.

### Q18 — Are we seeing all the reports?
- **Prompt:** "The trust and safety lead says we get about 105 reports a day, but Mixpanel shows fewer. Who is right?"
- **Type:** context
- **Answer:** Both. The warehouse (`trust_safety_daily.reports_received`) counts **12,690 reports (105.8 per day)**; Mixpanel `report submitted` counts **10,308 (85.9 per day)**, so the warehouse is about **1.23x** Mixpanel. The difference is reports sent by email and by logged-out readers, which never reach Mixpanel. The two track each other closely day to day by hub (correlation 0.98). In Mixpanel, 2,411 members filed reports (about 24% of active members, 4.3 each). Accept a ratio of 1.15x-1.35x with the email / logged-out explanation.
- **Evidence:** `-- EVAL Q18`; warehouse `trust_safety_daily` vs Insights `report submitted`, daily, by `content_hub`.
- **Context needed:** 04-metrics-and-tables.md (`reports_received` caveat).
- **Grading:** must reconcile the two sources with the documented reason. Wrong: "Mixpanel is dropping events"; "the warehouse double-counts".

### Q19 — What should we worry about?
- **Prompt:** "What should the leadership team worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Newcomers posting into silence:** 44.2% of intros get no reply within 24 hours, and those members retain at half the rate (36.7% vs 74.0% on or after day 30).
  2. **Reverted first edits:** 34.5% of new members' first edits are reverted, and reverted newcomers mostly stop editing (26.8% edit again within 30 days vs 58.6%).
  3. **TikTok spend:** 20.8% of signups, but only 25.2% finish onboarding; $20.05 per onboarded member vs $14.18 on Reddit (YouTube creators cost the most per onboarded member, $24.72).
  4. **Ad load trade-off:** revenue per day up about 43% and Plus conversion about 1.6x (through the ad-free pitch), but free members read about 8-9% less; watch reading and retention.
  5. **Raid readiness:** a three-day raid cut anime participation to about half; Hearth Guard helps on spam reports but not on copyright or misinformation.
- **Evidence:** H2, H5, H6, H7, H8, H9; `-- EVAL Q19` plus Q7, Q8, Q9, Q10-Q12, Q14.
- **Context needed:** all guides.
- **Grading:** full credit for at least three supported risks with numbers. Wrong: generic advice without data; claiming the ad change only helped.

### Q20 — Where should the community team focus?
- **Prompt:** "If the community team could fix one thing to keep more new members, what should it be?"
- **Type:** open-ended
- **Answer:** **Make sure every intro gets a reply within a day.** Day-30 retention (on or after day 30, signups through Aug 31): no intro 36.9% (1,692), intro with no reply in 24 hours 36.7% (720), intro with a reply 74.0% (920). The reply, not the intro, is what separates members who stay, and about 44% of intros are not answered in time. A greeter rota or reply prompts for welcome threads targets that directly. Secondary: soften newcomer edit reverts (Q9) and fix TikTok onboarding (Q2). Accept a reply-focused recommendation backed by the retention gap; a revert-focused answer with numbers earns partial credit.
- **Evidence:** H6-first-reply-retention, H7-reverted-first-edit; `-- EVAL Q20`, Q8, Q9.
- **Context needed:** 01-business.md (goal 2), 04-metrics-and-tables.md (retention definitions).
- **Grading:** must tie the recommendation to measured retention. Wrong: "get more people to post intros" (intros without replies retain no better than no intro).

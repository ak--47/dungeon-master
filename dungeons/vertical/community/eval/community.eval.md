# Hearthside (community) — 20-question eval

- **Data:** `data/verify-community` (full fidelity: 10,000 members, 9,989 with events, 4,576 new signups, 48 communities, 968,319 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/community/community.sql` on that data.
- **Stories:** ids refer to the `stories` export in `community.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — August gaming traffic
- **Prompt:** "Gaming wiki traffic jumped in August. What happened, and how big was it?"
- **Type:** trend
- **Answer:** The **Starfall release on 2026-08-06**. Gaming-hub article views averaged **1,277.1 per day from Aug 6 to Aug 19 vs 634.8 per day** in the two weeks before (Jul 23 - Aug 5), about **2.0x**. The surge peaked at launch (**1,626.0 per day on Aug 6-8**, about 2.6x) and faded to **922.7 per day by Aug 17-19** (about 1.45x). Gaming searches roughly doubled too (158.3 → 326.8 per day), and walkthrough, best builds, and tier list searches rose from 34.3% to 54.0% of gaming searches. Other hubs did not move (1,810.1 → 1,814.3 article views per day, +0.2%), so relative to the rest of the site gaming reading ran **2.01x** normal for the fortnight (2.02x with searches). The surge concentrated in **Starfall Guild**: 187.7 → 711.1 article views per day (3.8x), from 29.6% to 55.7% of gaming article views, while the other seven gaming communities rose only 1.20x-1.34x. Accept a launch-fortnight lift of 1.8x-2.3x, the Starfall release as the cause, a peak-then-fade shape, and Starfall Guild as the community that carried it.
- **Evidence:** H1-starfall-launch-surge; Insights, `article viewed` (and `search performed`), total, breakdown `content_hub`, daily; then breakdown `community_id` (group name) within `content_hub = gaming`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (Starfall release), 01-business.md (hubs), 03-event-dictionary.md (community group names).
- **Grading:** must name Starfall and the date, size the lift against a baseline, and note it was gaming-only. Full credit also finds that most of the extra reading was in one community, Starfall Guild (the guides do not name it; the `community_id` breakdown shows it). Wrong: a Hearthside campaign (there was none); "the whole site grew"; "every gaming community doubled"; quoting only the release-day peak as the fortnight's lift.

### Q2 — Which channels bring members who finish onboarding?
- **Prompt:** "Which acquisition channels bring people who actually finish onboarding?"
- **Type:** funnel
- **Answer:** 7-day onboarding completion (account created → interests selected → intro posted): **friend_invite 69.9%** (411 of 588), reddit_ads 53.4%, organic 52.0%, app_store 51.0%, youtube_creators 49.0%, and **tiktok_ads 23.2%** (223 of 960). Overall 48.1% (2,203 of 4,576). Friend invites finish at about **1.34x** organic; TikTok signups at under half the rate of the next-lowest channel (youtube_creators, 49.0%). TikTok signups also drop earlier: 67.5% reach the interests step vs 79.6-89.3% for the other channels. Accept rates within ±3 points and naming friend invites as best and TikTok as worst.
- **Evidence:** H2-onboarding-by-channel (and H9); Funnels, three onboarding steps, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (channels).
- **Grading:** must break down by channel and name both ends. Wrong: ranking channels by signup volume; using a window longer than 7 days without saying so.

### Q3 — Do mobile signups onboard worse? (null)
- **Prompt:** "People who sign up on their phones have to type an intro on a small keyboard. Do mobile signups finish onboarding less often than desktop signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **48.0% for mobile signups** (iOS, iPadOS, Android; 2,229) vs **48.3% for desktop** (2,347), z ≈ −0.2 (p ≈ 0.81). The gap stays small inside paid channels (38.6% vs 40.5%, z ≈ −0.9, p ≈ 0.38) and unpaid channels (56.6% vs 56.1%, z ≈ 0.2). By operating system, every system sits between 47.2% and 49.1% (Linux, 71 signups, 47.9%); chi-square 0.66 on 5 df, p ≈ 0.99. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Funnels onboarding steps, 7-day window, breakdown `os` (device of `account created`).
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the gap as noise. Wrong: "yes, mobile is worse"; reading the small paid-channel gap or the 71-signup Linux row as a finding.
### Q4 — Is Reply Nudges working?
- **Prompt:** "Should we ship Reply Nudges to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-08, **31.8% of Nudges On thread views lead to a reply by the same member within a day vs 25.9% for Control** (18,007 of 56,671 vs 14,868 of 57,461 views), about **1.23x**, and the median time from opening the thread to replying is **12.1 vs 15.0 minutes** (0.80x). Members in both arms open about the same number of threads (13.62 vs 13.49 per member), so the gain is per thread view, not more browsing. The split is even (4,161 Nudges On vs 4,258 Control exposed members; first exposure 2026-07-08). Accept 1.08x-1.32x for reply rate and 0.72x-0.88x for time.
- **Evidence:** H3-reply-nudges-experiment; Funnels `discussion viewed` → `comment posted`, totals, hold `thread_id` constant, 1-day window, breakdown `Experiment: Reply Nudges`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`thread_id`).
- **Grading:** must compare per thread view within the test window. Wrong: unique-member funnel conversion (most members reply at least once, which hides the gap); comparing before vs after July 8 for everyone.

### Q5 — Is Hearth Guard speeding up report handling?
- **Prompt:** "Is Hearth Guard actually making report handling faster? For which reports?"
- **Type:** trend
- **Answer:** Yes, for **spam, harassment, and vandalism** reports. Median time from report to resolution, reports filed before the 2026-07-22 rollout vs reports filed Aug 1 - Sep 23 (every community has Guard; each report has a week to resolve; the Aug 19-21 raid left out): **spam 9.2 → 3.4 hours, harassment 17.1 → 5.6, vandalism 11.6 → 4.6** (together **11.3 → 4.2 hours, 0.37x**). **Misinformation, copyright, and other reports did not improve** (together 24.9 → 24.6 hours; geometric-mean ratio 0.98, log-hours z ≈ −0.5; misinformation 24.9 → 26.2, other 20.3 → 19.1, copyright 33.7 → 32.0 on only 156 and 212 reports). All reports together went from 14.5 to 6.6 hours (0.46x). The weekly median fell during the rollout week (Jul 27: 8.2 hours) and settled near 6-7.5 hours from August (4.5 in the raid week, when spam reports flooded the queue). Accept 0.30x-0.40x for the three fast types and "no improvement" for the others.
- **Evidence:** H4-hearth-guard-triage; Funnels `report submitted` → `report resolved`, hold `report_id` constant, median time to convert, breakdown `report_type`, compare date ranges (or Insights median `resolution_hours`); `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (rollout dates), 04-metrics-and-tables.md (resolution time definition).
- **Grading:** must break down by report type. Wrong: only the blended 0.46x with no type split; "every report type got faster"; reading the copyright or "other" medians as a change (both are within noise); including the rollout week in "after" without saying so.

### Q6 — Did Hearth Guard change moderator decisions? (null)
- **Prompt:** "Hearth Guard suggests an action for every report. Are moderators removing more content since it launched, or are they deciding the same way as before?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful change in decisions.** The share of resolved reports that end in `content_removed` is **52.6% for reports filed before 2026-07-22 vs 53.1% for reports filed Aug 1 - Sep 23** (2,072 and 2,657 reports, Aug 19-21 raid left out; z ≈ 0.4, p ≈ 0.69). The sub-splits agree: spam, harassment, and vandalism 53.3% → 53.4% (z ≈ 0.1); misinformation, copyright, and other 50.9% → 52.5% (z ≈ 0.6, p ≈ 0.53); every single type within |z| ≤ 1.01 (harassment 48.6% → 51.9%, p ≈ 0.31, is the largest wobble, and spam moves the other way, 55.1% → 53.7%). Guard made clear-cut reports faster (Q5), not more likely to end in removal. Accept "no meaningful change".
- **Evidence:** H4-hearth-guard-triage (outcome is not part of the change); Insights `report resolved`, total, breakdown `outcome`, filter by `report_type`, compare reports filed before Jul 22 vs from Aug 1 (or Funnels report submitted → report resolved, hold `report_id`, breakdown `outcome`); `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (Hearth Guard suggests actions; moderators still resolve), 03-event-dictionary.md (`outcome`).
- **Grading:** must check the outcome mix before and after, ideally by report type, and treat the gaps as noise. Wrong: "Guard made moderators remove more content" (or less); reading the harassment wobble as a finding; answering with resolution speed instead of decisions.
### Q7 — What happened in mid-August, and what did it cost?
- **Prompt:** "Trust and safety says there was a spam raid in August. Which hub was hit, and what did it do to the community?"
- **Type:** external-join
- **Answer:** The **anime hub, 2026-08-19 to 2026-08-21**. `trust_safety_daily` shows `raid_alert_level = raid` for anime only, with **77.0 spam accounts removed per day vs 7.3** on the same weekdays a week before and after, automod removals 223.0 vs 34.0, reports received 115.7 vs 12.8, and volunteer moderator hours 77.1 vs 21.4. In Mixpanel, anime participation (comments, new threads, upvotes, uploads) fell to **126.0 actions per day from 242.8** (0.52x), while the other hubs held steady (1.03x), so anime ran at **about 0.50x** its normal share; roughly **373 member actions** did not happen over the three days. Anime reading did not drop (anime share of article views 1.12x), so members kept reading but stopped posting. Members filed 103.0 anime reports per day in Mixpanel vs 9.8 normally. Accept 0.40x-0.65x and naming anime and the dates.
- **Evidence:** H5-anime-spam-raid; Insights participation events, breakdown `content_hub`, daily; warehouse join on date and `content_hub`; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (raid dates), 04-metrics-and-tables.md (`trust_safety_daily`), 03-event-dictionary.md.
- **Grading:** must use the warehouse to identify the hub, give the dates, and size the participation loss against matched days. Wrong: "every hub was hit"; comparing raid weekdays with a week that includes a weekend; counting bot spam (it is not in Mixpanel).

### Q8 — What keeps newcomers around?
- **Prompt:** "Is there something that happens to new members in their first day that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Getting a reply to their intro within 24 hours.** Of new members who posted an intro (signups Jun 4 - Aug 31), **60.6% of those who got a reply within 24 hours were still active on or after day 30, vs 31.2%** of those who did not (890 vs 734 members), about **1.9x**; with a day 30-36 bracket it is 57.5% vs 29.3%. The unanswered members fade over their first three weeks rather than on one day: on day 1 after the intro 57.5% of them are active vs 63.7% of the answered, by day 16 24.9% vs 37.9%. Posting an intro alone does not help: members with no intro retain at 30.4%, about the same as unanswered intros. 54.8% of intros get a reply within 24 hours (2,192 intros). Accept a ratio of 1.6x-2.4x.
- **Evidence:** H6-first-reply-retention; Funnels `intro posted` → `notification received` (`notification_type = reply`), 24-hour window, save converters as a cohort; Retention, `account created` → a custom event "member action" (every event except `notification received` and `report resolved`), on or after day 30, filter did `intro posted`, breakdown by that cohort; `-- EVAL Q8`.
- **Context needed:** 01-business.md (onboarding, goal 2), 04-metrics-and-tables.md (retention and intro reply definitions), 03-event-dictionary.md (notification types).
- **Grading:** must define the behavior from the first day and exclude server-side events from "active". Wrong: counting notifications as activity (lapsed members keep receiving them); "posting an intro is what matters" (unanswered intros retain no better than no intro).

### Q9 — Do reverted edits drive editors away?
- **Prompt:** "Wiki moderators revert a lot of newcomer edits. Does that hurt? Do those people keep editing?"
- **Type:** retention
- **Answer:** Yes. Of new members whose first wiki edit was before Sep 1, those whose first edit was **reverted (an `edit_reverted` notification within 2 days) edited again within 30 days 27.5% of the time vs 64.5%** for those whose first edit stood (114 of 414 vs 524 of 812), about **0.43x**. With no follow-up limit the gap is the same (28.0% vs 67.1%, 0.42x). 34.7% of new members' first edits are reverted (1,756 new editors). Accept 0.35x-0.62x.
- **Evidence:** H7-reverted-first-edit; Funnels `article edited` → `notification received` (`notification_type = edit_reverted`), 2-day window, save as cohort; Funnels `article edited` → `article edited`, 30-day window, new members, breakdown by that cohort; `-- EVAL Q9`.
- **Context needed:** 01-business.md (goal 2), 03-event-dictionary.md (`edit_reverted`), 04-metrics-and-tables.md (editor return rate).
- **Grading:** must restrict to new members' first edits and give both rates. Any follow-up window from 14 days to "ever" is fine if both groups use the same one and late first edits are left out. Wrong: using all members (established editors' first in-window edit is not their first edit); counting edits made before the revert window.

### Q10 — What did the September ad change do to revenue?
- **Prompt:** "We added ad slots on September 2. How much more ad revenue are we making?"
- **Type:** external-join
- **Answer:** Ad revenue rose from **$124.05 per day (Jun 4 - Sep 1) to $195.17 per day (Sep 9 - Oct 1)**, about **+57%**. The driver is impressions per page view: impressions per Mixpanel free-member article view went from **19.31 to 31.10 (1.61x)**, with eCPM flat at about $3.02. Revenue rose less than impressions because free members read a little less while the member base grew (free article views 2,125.2 → 2,081.6 per day). Four-week comparison: $3,367 (Jul 1-28) or $3,982 (Aug 3-30, inflated by Starfall) vs $5,447 (Sep 3-30). Accept +45% to +65% for revenue per day and 1.5x-1.7x for impressions per view.
- **Evidence:** H8-ad-load-change; warehouse `ad_revenue_daily` joined by date to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (`ad_revenue_daily`, caveats), 01-business.md (ads).
- **Grading:** must use the warehouse for revenue and give a before/after with a fair baseline. Wrong: using Mixpanel events as impressions; comparing September with the Starfall weeks only and calling it the full effect; claiming Plus members saw more ads.

### Q11 — Did free members read less after the ad change?
- **Prompt:** "Did the extra ads make free members read less?"
- **Type:** segmentation
- **Answer:** Yes, by about **10% per search**. Article views per search, which cancels changes in how often people visit, fell **0.90x for free members (4.00 → 3.60) and did not move for Plus (3.99 → 4.01, 1.00x)**. Weekly average article views per viewer tell the same story more weakly: free members 4.18 (weeks of Jun 8 - Jul 27) → 3.97 (weeks of Sep 7-21), 0.95x, vs Plus 5.49 → 5.34, 0.97x. Accept a free-member decline of 5%-14% in views per search with Plus flat; a per-viewer answer must compare free with Plus.
- **Evidence:** H8-ad-load-change; Insights, `article viewed`, average per user, breakdown `membership`, weekly; formula `article viewed` / `search performed` by `membership`, before vs after Sep 2; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (ad change and who it affects), 03-event-dictionary.md (`membership` at event time).
- **Grading:** must compare free with Plus (or otherwise control for the trend). Wrong: using August as the baseline (Starfall inflates it); "no effect" from total views (membership growth hides the drop).

### Q12 — Why did Plus subscriptions jump in September?
- **Prompt:** "Plus subscriptions jumped about 50% in September. Was it a promotion? What drove it?"
- **Type:** funnel
- **Answer:** There was no promotion or price change; the timing matches the **Sep 2 ad change**. Plus page visits held steady (**85.3 per day before, 86.1 after**), but **conversion rose: 6.29% of upgrade attempts converted Jun 4 - Sep 1 (428 of 6,801) vs 9.65% Sep 9 - Oct 1 (170 of 1,761), about 1.5x**, already 9.74% on Sep 2-8. (Attempts follow the Mixpanel totals funnel: a second Plus page visit within a day of an open attempt stays in that attempt.) Subscriptions went from **33.4 to 52.0 per week**. The change came through the **ad-free pitch**: attempts with `upgrade_trigger = ad_free` rose from 39.6% to 54.3% of attempts, and their conversion went from **6.64% to 12.54% (1.9x)**. Before the change ad-free converted about like the other pitches; the other triggers (custom flair, profile badges, larger uploads) stayed flat, 6.06% → 6.22% combined (1.03x, noise; 50 conversions after the change). 1,057 members (10.6%) are on Plus at the end of the window. Accept a conversion lift of 1.3x-1.8x with flat visits (per visit, the obvious A-to-B count gives a similar lift); full credit names the ad-free trigger and the flat other triggers.
- **Evidence:** H8-ad-load-change; Funnels `plus page viewed` → `plus subscribed`, totals, 1-day window, before vs after, breakdown `upgrade_trigger`; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change, no price change), 01-business.md (Plus).
- **Grading:** must separate visits from conversion and connect to the ad change. Wrong: "a price cut" or "a promotion" (neither happened); "more people visited the Plus page"; "every upgrade reason converted better".

### Q13 — Cost per signup by channel
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **TikTok $4.87** (960 signups, $4,672.81), **Reddit $7.60** (849 signups, $6,453.14), **YouTube creators $12.68** (427 signups, $5,413.42). Monthly figures are stable (TikTok $4.56-$5.27, Reddit $7.25-$7.97, YouTube $10.48-$14.92 across Jun-Sep; YouTube moves most because it has the fewest signups). The platforms claim more signups (1,188 / 1,017 / 553), which would understate CAC. Accept ±5%.
- **Evidence:** H9-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting single days.

### Q14 — Is TikTok worth it?
- **Prompt:** "TikTok signups are our cheapest. Should we move more budget there?"
- **Type:** attribution
- **Answer:** **No, not on this evidence.** TikTok is the cheapest per signup ($4.87 vs $7.60 on Reddit, 0.64x) but only **23.2% of TikTok signups finish onboarding vs 53.4% from Reddit** and 49.0% from YouTube creators, so **spend per onboarded member is $20.95 on TikTok vs $14.25 on Reddit (1.47x)** and $25.90 on YouTube creators. Day-30 retention differs less than onboarding (36.5% on or after day 30 for TikTok vs 38.4% for Reddit and 36.3% for YouTube creators), so the case rests on onboarding cost. Reddit is the best value per onboarded member. Accept a TikTok/Reddit cost-per-onboarded ratio of 1.2x-1.7x.
- **Evidence:** H9-paid-channel-economics, H2-onboarding-by-channel; warehouse spend joined to the onboarding funnel by `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 01-business.md (goal 3), 04-metrics-and-tables.md (cost per onboarded member).
- **Grading:** must combine spend with a downstream outcome. Wrong: "yes, TikTok is cheapest" from CAC alone; claiming a large day-30 retention gap by channel.
### Q15 — Did Fandom Fest work?
- **Prompt:** "Did Fandom Fest actually get people participating, or just looking?"
- **Type:** trend
- **Answer:** It lifted participation, not traffic. Thursday-Sunday Sep 17-20 vs the average of the same days a week before and a week after: **comments, new threads, upvotes, and uploads together 10,043 vs 6,477 (1.55x)** — comments 1.55x, new threads 1.54x, uploads 1.60x (fan art the largest media type, 283 uploads), upvotes 1.54x. **Reading did not move** (article views 1.00x, searches 0.96x). New signups did not rise either: 168 on the fest days vs 167.5 on the neighboring Thu-Sun; across the window's 17 Thu-Sun blocks signups average 164.4 (sd 10.4, range 142-190), and nothing about the fest targeted signups. Accept a participation lift of 1.45x-1.75x and flat reading.
- **Evidence:** H10-fandom-fest; Insights, the four participation events and `article viewed`, daily, fest vs neighboring Thu-Sun; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (fest dates and format).
- **Grading:** must compare matching weekdays and separate participation from reading. Accept any accurate statement about signups (flat, near the window's average). Wrong: comparing the fest weekend with weekdays; a causal claim that the fest moved signups up or down.
### Q16 — Which hub earns the most from ads?
- **Prompt:** "Which hubs make us the most ad money, and which monetize best per page?"
- **Type:** external-join
- **Answer:** Total ad revenue in the window was **$17,004**. **Gaming earns the most ($5,266, 31.0%)**, then movies_tv ($4,375, 25.7%), anime ($2,529), music ($1,844), tabletop ($1,530), books ($1,460). **movies_tv monetizes best**: the highest effective eCPM ($3.91 vs $3.38 for gaming and $2.18 for books) and the most revenue per 1,000 free-member article views ($87.84 vs $73.65 gaming, $49.13 books). Accept ±5% on revenue and the two rankings.
- **Evidence:** warehouse `ad_revenue_daily` by `content_hub`, joined to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`, RPM), 01-business.md (ads sold by hub).
- **Grading:** must distinguish total revenue from revenue per page or per impression. Wrong: ranking by Mixpanel views alone.

### Q17 — Is the community growing?
- **Prompt:** "Is Hearthside growing? How many members are active each week, and how much of that is new people?"
- **Type:** trend
- **Answer:** Yes. Weekly active members (any member action, Monday weeks) rose from **3,834 (week of Jun 8) to 4,947 (week of Sep 21), about +29%**. New members (joined since Jun 4) made up 399 of the Jun 8 week and **1,520 (31%) of the Sep 21 week**. Signups ran steady at about 1,150-1,200 per month (1,173 July, 1,195 August, 1,156 September; 1,014 in June, which starts on the 4th). The first and last weeks are partial (Jun 4-7 and Sep 28 - Oct 1). Accept +20% to +35% and steady signups.
- **Evidence:** Insights, custom event "member action" (every event except `notification received` and `report resolved`), uniques, weekly; `account created` monthly; `-- EVAL Q17`.
- **Context needed:** 00-manifest.md (members vs server-side events), 04-metrics-and-tables.md (WAM definition).
- **Grading:** must use member actions and full weeks. Wrong: counting notification recipients as active; comparing a partial first week.

### Q18 — Are we seeing all the reports?
- **Prompt:** "The trust and safety lead says we get about 67 reports a day, but Mixpanel shows fewer. Who is right?"
- **Type:** context
- **Answer:** Both. The warehouse (`trust_safety_daily.reports_received`) counts **8,057 reports (67.1 per day)**; Mixpanel `report submitted` counts **6,214 (51.8 per day)**, so the warehouse is about **1.30x** Mixpanel. The difference is reports sent by email and by logged-out readers, which never reach Mixpanel. The two track each other closely day to day by hub (correlation 0.985, carried partly by the August raid). In Mixpanel, 920 members filed reports (about 9% of active members, 6.75 each). Accept a ratio of 1.2x-1.4x with the email / logged-out explanation.
- **Evidence:** `-- EVAL Q18`; warehouse `trust_safety_daily` vs Insights `report submitted`, daily, by `content_hub`.
- **Context needed:** 04-metrics-and-tables.md (`reports_received` caveat).
- **Grading:** must reconcile the two sources with the documented reason. Wrong: "Mixpanel is dropping events"; "the warehouse double-counts".

### Q19 — What should we worry about?
- **Prompt:** "What should the leadership team worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Newcomers posting into silence:** 45.2% of intros get no reply within 24 hours, and those members retain at about half the rate (31.2% vs 60.6% on or after day 30).
  2. **Reverted first edits:** 34.7% of new members' first edits are reverted, and reverted newcomers mostly stop editing (27.5% edit again within 30 days vs 64.5%).
  3. **TikTok spend:** 21.0% of signups, but only 23.2% finish onboarding; $20.95 per onboarded member vs $14.25 on Reddit (YouTube creators cost the most per onboarded member, $25.90).
  4. **Ad load trade-off:** revenue per day up about 57% and Plus conversion about 1.5x (through the ad-free pitch), but free members read about 10% fewer articles per search; watch reading and retention.
  5. **Raid readiness:** a three-day raid cut anime participation to about half; Hearth Guard helps on spam reports but not on copyright or misinformation.
- **Evidence:** H2, H5, H6, H7, H8, H9; `-- EVAL Q19` plus Q7, Q8, Q9, Q10-Q12, Q14.
- **Context needed:** all guides.
- **Grading:** full credit for at least three supported risks with numbers. Wrong: generic advice without data; claiming the ad change only helped.

### Q20 — Where should the community team focus?
- **Prompt:** "If the community team could fix one thing to keep more new members, what should it be?"
- **Type:** open-ended
- **Answer:** **Make sure every intro gets a reply within a day.** Day-30 retention (on or after day 30, signups through Aug 31): no intro 30.4% (1,758), intro with no reply in 24 hours 31.2% (734), intro with a reply 60.6% (890). The reply, not the intro, is what separates members who stay, and about 45% of intros are not answered in time. A greeter rota or reply prompts for welcome threads targets that directly. Secondary: soften newcomer edit reverts (Q9) and fix TikTok onboarding (Q2). Accept a reply-focused recommendation backed by the retention gap; a revert-focused answer with numbers earns partial credit.
- **Evidence:** H6-first-reply-retention, H7-reverted-first-edit; `-- EVAL Q20`, Q8, Q9.
- **Context needed:** 01-business.md (goal 2), 04-metrics-and-tables.md (retention definitions).
- **Grading:** must tie the recommendation to measured retention. Wrong: "get more people to post intros" (intros without replies retain no better than no intro).

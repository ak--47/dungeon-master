# Hearthside (community) — 20-question eval

- **Data:** `data/verify-community` (full fidelity: 10,000 members, 9,990 with events, 4,502 new signups, 48 communities, 826,394 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/community/community.sql` on that data.
- **Stories:** ids refer to the `stories` export in `community.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — August gaming traffic
- **Prompt:** "Gaming wiki traffic jumped in August. What happened, and how big was it?"
- **Type:** trend
- **Answer:** The **Starfall release on 2026-08-06**. Gaming-hub article views averaged **1,133.1 per day from Aug 6 to Aug 19 vs 540.8 per day** in the two weeks before (Jul 23 - Aug 5), about **2.1x**. The surge peaked at launch (**1,498.0 per day on Aug 6-8**, about 2.8x) and faded to **884.7 per day by Aug 17-19** (about 1.6x). Gaming searches more than doubled too (119.1 → 263.6 per day), and walkthrough, best builds, and tier list searches rose from 34.4% to 54.3% of gaming searches. Other hubs barely moved (1,588.1 → 1,602.6 article views per day, +1%), so relative to the rest of the site gaming reading ran **2.08x** normal for the fortnight (2.09x with searches). The surge concentrated in **Starfall Guild**: 158.6 → 631.5 article views per day (4.0x), from 29.3% to 55.7% of gaming article views, while the other seven gaming communities rose only 1.25x-1.38x. Accept a launch-fortnight lift of 1.8x-2.3x, the Starfall release as the cause, a peak-then-fade shape, and Starfall Guild as the community that carried it.
- **Evidence:** H1-starfall-launch-surge; Insights, `article viewed` (and `search performed`), total, breakdown `content_hub`, daily; then breakdown `community_id` (group name) within `content_hub = gaming`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (Starfall release, Starfall Guild), 01-business.md (hubs).
- **Grading:** must name Starfall and the date, size the lift against a baseline, and note it was gaming-only. Full credit also notes that most of the extra reading was in Starfall Guild. Wrong: a Hearthside campaign (there was none); "the whole site grew"; "every gaming community doubled"; quoting only the release-day peak as the fortnight's lift.

### Q2 — Which channels bring members who finish onboarding?
- **Prompt:** "Which acquisition channels bring people who actually finish onboarding?"
- **Type:** funnel
- **Answer:** 7-day onboarding completion (account created → interests selected → intro posted): **friend_invite 72.7%** (452 of 622), reddit_ads 55.1%, youtube_creators 51.8%, organic 50.7%, app_store 50.2%, and **tiktok_ads 25.1%** (240 of 956). Overall 49.2% (2,214 of 4,502). Friend invites finish at about **1.43x** organic; TikTok signups at half the rate of the next-lowest channel (app_store, 50.2%). TikTok signups also drop earlier: 67.2% reach the interests step vs 79-90% for the other channels. Accept rates within ±3 points and naming friend invites as best and TikTok as worst.
- **Evidence:** H2-onboarding-by-channel (and H9); Funnels, three onboarding steps, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (channels).
- **Grading:** must break down by channel and name both ends. Wrong: ranking channels by signup volume; using a window longer than 7 days without saying so.

### Q3 — Do mobile signups onboard worse? (null)
- **Prompt:** "People who sign up on their phones have to type an intro on a small keyboard. Do mobile signups finish onboarding less often than desktop signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **49.7% for mobile signups** (iOS, iPadOS, Android; 1,601) vs **48.9% for desktop** (2,901), z ≈ +0.5. The gap stays small inside paid channels (43.1% vs 40.7%, z ≈ +1.1) and unpaid channels (56.0% vs 57.0%, z ≈ −0.5). By operating system, rates run 47.7%-52.3% for every system with more than 50 signups (chi-square 1.96 on 7 df, p ≈ 0.96). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Funnels onboarding steps, 7-day window, breakdown `os` (device of `account created`).
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the gap as noise. Wrong: "yes, mobile is worse"; reading the 6-signup Linux row as a finding.

### Q4 — Is Reply Nudges working?
- **Prompt:** "Should we ship Reply Nudges to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-08, **30.5% of Nudges On thread views lead to a reply by the same member within a day vs 25.8% for Control** (14,890 of 48,882 vs 12,236 of 47,372 views), about **1.18x**, and the median time from opening the thread to replying is **12.0 vs 15.0 minutes** (0.80x). Members in both arms open about the same number of threads (11.61 vs 11.69 per member), so the gain is per thread view, not more browsing. The split is even (4,212 Nudges On vs 4,054 Control exposed members; first exposure 2026-07-08). Accept 1.08x-1.32x for reply rate and 0.72x-0.88x for time.
- **Evidence:** H3-reply-nudges-experiment; Funnels `discussion viewed` → `comment posted`, totals, hold `thread_id` constant, 1-day window, breakdown `Experiment: Reply Nudges`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`thread_id`).
- **Grading:** must compare per thread view within the test window. Wrong: unique-member funnel conversion (most members reply at least once, which hides the gap); comparing before vs after July 8 for everyone.

### Q5 — Is Hearth Guard speeding up report handling?
- **Prompt:** "Is Hearth Guard actually making report handling faster? For which reports?"
- **Type:** trend
- **Answer:** Yes, for **spam, harassment, and vandalism** reports. Median time from report to resolution, reports filed before the 2026-07-22 rollout vs reports filed Aug 1 - Sep 23 (every community has Guard; each report has a week to resolve; the Aug 19-21 raid left out): **spam 10.3 → 3.4 hours, harassment 15.5 → 5.4, vandalism 13.3 → 4.5** (together **12.3 → 4.2 hours, 0.34x**). **Misinformation, copyright, and other reports did not improve** (together 24.6 → 26.2 hours; geometric-mean ratio 1.05, log-hours z ≈ 1.5, not significant; misinformation 24.7 → 25.6, other 20.1 → 20.0, copyright 31.5 → 36.8 on only 205 and 278 reports). All reports together went from 15.2 to 6.5 hours (0.43x). The weekly median fell during the rollout week (Jul 27: 8.9 hours) and settled near 5-7 hours from August. Accept 0.30x-0.40x for the three fast types and "no improvement" for the others.
- **Evidence:** H4-hearth-guard-triage; Funnels `report submitted` → `report resolved`, hold `report_id` constant, median time to convert, breakdown `report_type`, compare date ranges (or Insights median `resolution_hours`); `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (rollout dates), 04-metrics-and-tables.md (resolution time definition).
- **Grading:** must break down by report type. Wrong: only the blended 0.43x with no type split; "every report type got faster"; "Guard made copyright reports slower" from the median alone (the difference is within noise); including the rollout week in "after" without saying so.

### Q6 — Did Hearth Guard change moderator decisions? (null)
- **Prompt:** "Hearth Guard suggests an action for every report. Are moderators removing more content since it launched, or are they deciding the same way as before?"
- **Type:** null-hypothesis
- **Answer:** **No change in decisions.** The share of resolved reports that end in `content_removed` is **51.4% for reports filed before 2026-07-22 vs 50.9% for reports filed Aug 1 - Sep 23** (2,810 and 3,542 reports, Aug 19-21 raid left out; z ≈ −0.4, p ≈ 0.72). It holds in the sub-splits: spam, harassment, and vandalism 51.9% → 50.7% (z ≈ −0.8); misinformation, copyright, and other 50.3% → 51.5% (z ≈ +0.5); every single type within |z| < 1.5 (copyright 47.8% → 54.7% on 205 and 278 reports, z ≈ 1.5, is the largest wobble). Guard made clear-cut reports faster (Q5), not more likely to end in removal. Accept "no meaningful change".
- **Evidence:** H4-hearth-guard-triage (outcome is not part of the change); Insights `report resolved`, total, breakdown `outcome`, filter by `report_type`, compare reports filed before Jul 22 vs from Aug 1 (or Funnels report submitted → report resolved, hold `report_id`, breakdown `outcome`); `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (Hearth Guard suggests actions; moderators still resolve), 03-event-dictionary.md (`outcome`).
- **Grading:** must check the outcome mix before and after, ideally by report type, and treat the gaps as noise. Wrong: "Guard made moderators remove more content"; reading the copyright wobble as a finding; answering with resolution speed instead of decisions.

### Q7 — What happened in mid-August, and what did it cost?
- **Prompt:** "Trust and safety says there was a spam raid in August. Which hub was hit, and what did it do to the community?"
- **Type:** external-join
- **Answer:** The **anime hub, 2026-08-19 to 2026-08-21**. `trust_safety_daily` shows `raid_alert_level = raid` for anime only, with **77.0 spam accounts removed per day vs 7.3** on the same weekdays a week before and after, automod removals 223.0 vs 34.0, reports received 48.3 vs 17.5, and volunteer moderator hours 77.1 vs 21.4. In Mixpanel, anime participation (comments, new threads, upvotes, uploads) fell to **101.0 actions per day from 203.8** (0.50x), while the other hubs held steady (1.05x), so anime ran at **about 0.47x** its normal share; roughly **336 member actions** did not happen over the three days. Anime reading did not drop (article views 1.00x relative to other hubs), so members kept reading but stopped posting. Members filed 39.3 anime reports per day in Mixpanel vs 14.5 normally. Accept 0.40x-0.65x and naming anime and the dates.
- **Evidence:** H5-anime-spam-raid; Insights participation events, breakdown `content_hub`, daily; warehouse join on date and `content_hub`; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (raid dates), 04-metrics-and-tables.md (`trust_safety_daily`), 03-event-dictionary.md.
- **Grading:** must use the warehouse to identify the hub, give the dates, and size the participation loss against matched days. Wrong: "every hub was hit"; comparing raid weekdays with a week that includes a weekend; counting bot spam (it is not in Mixpanel).

### Q8 — What keeps newcomers around?
- **Prompt:** "Is there something that happens to new members in their first day that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Getting a reply to their intro within 24 hours.** Of new members who posted an intro (signups Jun 4 - Aug 31), **66.4% of those who got a reply within 24 hours were still active on or after day 30, vs 32.2%** of those who did not (878 vs 758 members), about **2.1x**; with a day 30-36 bracket it is 46.2% vs 22.8%. The unanswered members fade over their first three weeks rather than on one day: on day 1 after the intro 23.9% of them are active vs 23.6% of the answered, by day 16 8.9% vs 17.2%. Posting an intro alone does not help: members with no intro retain at 32.3%, the same as unanswered intros. 53.8% of intros get a reply within 24 hours (2,191 intros). Accept a ratio of 1.7x-2.4x.
- **Evidence:** H6-first-reply-retention; Funnels `intro posted` → `notification received` (`notification_type = reply`), 24-hour window, save converters as a cohort; Retention, `account created` → a custom event "member action" (every event except `notification received` and `report resolved`), on or after day 30, filter did `intro posted`, breakdown by that cohort; `-- EVAL Q8`.
- **Context needed:** 01-business.md (onboarding, goal 2), 04-metrics-and-tables.md (retention and intro reply definitions), 03-event-dictionary.md (notification types).
- **Grading:** must define the behavior from the first day and exclude server-side events from "active". Wrong: counting notifications as activity (lapsed members keep receiving them); "posting an intro is what matters" (unanswered intros retain no better than no intro).

### Q9 — Do reverted edits drive editors away?
- **Prompt:** "Wiki moderators revert a lot of newcomer edits. Does that hurt? Do those people keep editing?"
- **Type:** retention
- **Answer:** Yes. Of new members whose first wiki edit was before Sep 1, those whose first edit was **reverted (an `edit_reverted` notification within 2 days) edited again within 30 days 31.6% of the time vs 62.0%** for those whose first edit stood (98 of 310 vs 346 of 558), about **0.51x**. 34.9% of new members' first edits are reverted (1,295 new editors). Accept 0.35x-0.62x.
- **Evidence:** H7-reverted-first-edit; Funnels `article edited` → `notification received` (`notification_type = edit_reverted`), 2-day window, save as cohort; Funnels `article edited` → `article edited`, 30-day window, new members, breakdown by that cohort; `-- EVAL Q9`.
- **Context needed:** 01-business.md (goal 2), 03-event-dictionary.md (`edit_reverted`), 04-metrics-and-tables.md (editor return rate).
- **Grading:** must restrict to new members' first edits and give both rates. Wrong: using all members (established editors' first in-window edit is not their first edit); counting edits made before the revert window.

### Q10 — What did the September ad change do to revenue?
- **Prompt:** "We added ad slots on September 2. How much more ad revenue are we making?"
- **Type:** external-join
- **Answer:** Ad revenue rose from **$113.56 per day (Jun 4 - Sep 1) to $169.77 per day (Sep 9 - Oct 1)**, about **+49%**. The driver is impressions per page view: impressions per Mixpanel free-member article view went from **19.31 to 31.11 (1.61x)**, with eCPM flat at about $3.01. Revenue rose less than impressions because free members read less (free article views fell from 1,948 to 1,816 per day). Four-week comparison: $3,027 (Jul 1-28) or $3,688 (Aug 3-30, inflated by Starfall) vs $4,749 (Sep 3-30). Accept +40% to +60% for revenue per day and 1.5x-1.7x for impressions per view.
- **Evidence:** H8-ad-load-change; warehouse `ad_revenue_daily` joined by date to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (`ad_revenue_daily`, caveats), 01-business.md (ads).
- **Grading:** must use the warehouse for revenue and give a before/after with a fair baseline. Wrong: using Mixpanel events as impressions; comparing September with the Starfall weeks only and calling it the full effect; claiming Plus members saw more ads.

### Q11 — Did free members read less after the ad change?
- **Prompt:** "Did the extra ads make free members read less?"
- **Type:** segmentation
- **Answer:** Yes, by about **10%**. Weekly average article views per viewer for free members fell from **10.46 (weeks of Jun 8 - Jul 27) to 9.24 (weeks of Sep 7-21), 0.88x**, while Plus members (no ads) stayed level (10.88 → 11.12, 1.02x). Article views per search, which cancels changes in how often people visit, fell **0.91x for free members (4.38 → 3.98) and did not move for Plus (4.34 → 4.34)**. Accept a free-member decline of 7%-14% with Plus flat.
- **Evidence:** H8-ad-load-change; Insights, `article viewed`, average per user, breakdown `membership`, weekly; formula `article viewed` / `search performed` by `membership`, before vs after Sep 2; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (ad change and who it affects), 03-event-dictionary.md (`membership` at event time).
- **Grading:** must compare free with Plus (or otherwise control for the trend). Wrong: using August as the baseline (Starfall inflates it); "no effect" from total views (membership growth hides the drop).

### Q12 — Why did Plus subscriptions jump in September?
- **Prompt:** "Plus subscriptions roughly doubled in September. Was it a promotion? What drove it?"
- **Type:** funnel
- **Answer:** There was no promotion or price change; the timing matches the **Sep 2 ad change**. Plus page visits held steady (**54.3 per day before, 55.0 after**), but **conversion per visit doubled: 4.29% (210 of 4,891 visits, Jun 4 - Sep 1) → 8.85% (112 of 1,266, Sep 9 - Oct 1), about 2.1x**, ramping through the first week (5.32% on Sep 2-8). Subscriptions went from **15.7 to 32.0 per week**. The change came through the **ad-free pitch**: visits with `upgrade_trigger = ad_free` rose from 39.8% to 55.7% of Plus page visits, and their conversion went from **2.67% to 10.07% (3.8x)**. The other triggers (custom flair, profile badges, larger uploads) rose much less, from 5.37% to 7.31% combined, on only about 40 conversions after the change. 710 members (7.1%) are on Plus at the end of the window. Accept a conversion lift of 1.6x-2.4x with flat visits; full credit names the ad-free trigger.
- **Evidence:** H8-ad-load-change; Funnels `plus page viewed` → `plus subscribed`, totals, 1-day window, before vs after, breakdown `upgrade_trigger`; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change, no price change), 01-business.md (Plus).
- **Grading:** must separate visits from conversion and connect to the ad change. Wrong: "a price cut" or "a promotion" (neither happened); "more people visited the Plus page"; "every upgrade reason converted the same".

### Q13 — Cost per signup by channel
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **TikTok $4.89** (956 signups, $4,672.81), **Reddit $7.89** (818 signups, $6,453.14), **YouTube creators $12.08** (448 signups, $5,413.42). Monthly figures are stable from July (TikTok $4.78-$5.21, Reddit $7.43-$8.51, YouTube $11.39-$14.15 across Jun-Sep; June is the highest month for each channel). The platforms claim more signups (1,188 / 1,017 / 553), which would understate CAC. Accept ±5%.
- **Evidence:** H9-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting single days.

### Q14 — Is TikTok worth it?
- **Prompt:** "TikTok signups are our cheapest. Should we move more budget there?"
- **Type:** attribution
- **Answer:** **No, not on this evidence.** TikTok is the cheapest per signup ($4.89 vs $7.89 on Reddit, 0.62x) but only **25.1% of TikTok signups finish onboarding vs 55.1% from Reddit** and 51.8% from YouTube creators, so **spend per onboarded member is $19.47 on TikTok vs $14.31 on Reddit (1.36x)** and $23.33 on YouTube creators. TikTok signups also retain worse at day 30 (36.9% on or after day 30 vs 44.1% for Reddit and 44.8% for YouTube creators), because so few of them become members. Reddit is the best value per real member. Accept a TikTok/Reddit cost-per-onboarded ratio of 1.15x-1.55x.
- **Evidence:** H9-paid-channel-economics, H2-onboarding-by-channel; warehouse spend joined to the onboarding funnel by `acquisition_channel`; `-- EVAL Q14`.
- **Context needed:** 01-business.md (goal 3), 04-metrics-and-tables.md (cost per onboarded member).
- **Grading:** must combine spend with a downstream outcome. Wrong: "yes, TikTok is cheapest" from CAC alone.

### Q15 — Did Fandom Fest work?
- **Prompt:** "Did Fandom Fest actually get people participating, or just looking?"
- **Type:** trend
- **Answer:** It lifted participation, not traffic. Thursday-Sunday Sep 17-20 vs the average of the same days a week before and a week after: **comments, new threads, upvotes, and uploads together 8,649 vs 5,195 (1.66x)** — comments 1.53x, new threads 1.84x, uploads 1.73x (fan art the largest media type, 290 uploads), upvotes 1.71x. **Reading barely moved** (article views 1.05x, searches 1.03x), and new signups stayed within normal variation (178 vs 160.5, z ≈ 1.1). Accept a participation lift of 1.45x-1.80x and flat reading.
- **Evidence:** H10-fandom-fest; Insights, the four participation events and `article viewed`, daily, fest vs neighboring Thu-Sun; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (fest dates and format).
- **Grading:** must compare matching weekdays and separate participation from reading. Wrong: comparing the fest weekend with weekdays; "it brought in new members".

### Q16 — Which hub earns the most from ads?
- **Prompt:** "Which hubs make us the most ad money, and which monetize best per page?"
- **Type:** external-join
- **Answer:** Total ad revenue in the window was **$15,271**. **Gaming earns the most ($4,713, 30.9%)**, then movies_tv ($3,857, 25.3%), anime ($2,322), music ($1,720), tabletop ($1,404), books ($1,255). **movies_tv monetizes best**: the highest effective eCPM ($3.91 vs $3.38 for gaming and $2.18 for books) and the most revenue per 1,000 free-member article views ($86.90 vs $73.46 gaming, $48.80 books). Accept ±5% on revenue and the two rankings.
- **Evidence:** warehouse `ad_revenue_daily` by `content_hub`, joined to Mixpanel `article viewed` where `membership = free`; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`, RPM), 01-business.md (ads sold by hub).
- **Grading:** must distinguish total revenue from revenue per page or per impression. Wrong: ranking by Mixpanel views alone.

### Q17 — Is the community growing?
- **Prompt:** "Is Hearthside growing? How many members are active each week, and how much of that is new people?"
- **Type:** trend
- **Answer:** Yes. Weekly active members (any member action, Monday weeks) rose from **3,842 (week of Jun 8) to 4,891 (week of Sep 21), about +27%**. New members (joined since Jun 4) made up 338 of the Jun 8 week and **1,297 (27%) of the Sep 21 week**. Signups ran steady at about 1,150-1,200 per month from July (1,192 July, 1,186 August, 1,152 September; 927 in June, which starts on the 4th). The first and last weeks are partial (Jun 4-7 and Sep 28 - Oct 1). Accept +20% to +32% and steady signups.
- **Evidence:** Insights, custom event "member action" (every event except `notification received` and `report resolved`), uniques, weekly; `account created` monthly; `-- EVAL Q17`.
- **Context needed:** 00-manifest.md (members vs server-side events), 04-metrics-and-tables.md (WAM definition).
- **Grading:** must use member actions and full weeks. Wrong: counting notification recipients as active; comparing a partial first week.

### Q18 — Are we seeing all the reports?
- **Prompt:** "The trust and safety lead says we get about 95 reports a day, but Mixpanel shows fewer. Who is right?"
- **Type:** context
- **Answer:** Both. The warehouse (`trust_safety_daily.reports_received`) counts **11,426 reports (95.2 per day)**; Mixpanel `report submitted` counts **9,236 (77.0 per day)**, so the warehouse is about **1.24x** Mixpanel. The difference is reports sent by email and by logged-out readers, which never reach Mixpanel. The two track each other closely day to day by hub (correlation 0.98). In Mixpanel, 2,342 members filed reports (about 23% of active members, 3.9 each). Accept a ratio of 1.15x-1.35x with the email / logged-out explanation.
- **Evidence:** `-- EVAL Q18`; warehouse `trust_safety_daily` vs Insights `report submitted`, daily, by `content_hub`.
- **Context needed:** 04-metrics-and-tables.md (`reports_received` caveat).
- **Grading:** must reconcile the two sources with the documented reason. Wrong: "Mixpanel is dropping events"; "the warehouse double-counts".

### Q19 — What should we worry about?
- **Prompt:** "What should the leadership team worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Newcomers posting into silence:** 46.2% of intros get no reply within 24 hours, and those members retain at half the rate (32.2% vs 66.4% on or after day 30).
  2. **Reverted first edits:** 34.9% of new members' first edits are reverted, and reverted newcomers mostly stop editing (31.6% edit again within 30 days vs 62.0%).
  3. **TikTok spend:** 21.2% of signups, but only 25.1% finish onboarding; the costliest real members after YouTube creators ($19.47 per onboarded member vs $14.31 on Reddit).
  4. **Ad load trade-off:** revenue per day up about 49% and Plus conversion about 2.1x (through the ad-free pitch), but free members read about 10% less; watch reading and retention.
  5. **Raid readiness:** a three-day raid cut anime participation to about half; Hearth Guard helps on spam reports but not on copyright or misinformation.
- **Evidence:** H2, H5, H6, H7, H8, H9; `-- EVAL Q19` plus Q7, Q8, Q9, Q10-Q12, Q14.
- **Context needed:** all guides.
- **Grading:** full credit for at least three supported risks with numbers. Wrong: generic advice without data; claiming the ad change only helped.

### Q20 — Where should the community team focus?
- **Prompt:** "If the community team could fix one thing to keep more new members, what should it be?"
- **Type:** open-ended
- **Answer:** **Make sure every intro gets a reply within a day.** Day-30 retention (on or after day 30, signups through Aug 31): no intro 32.3% (1,669), intro with no reply in 24 hours 32.2% (758), intro with a reply 66.4% (878). The reply, not the intro, is what separates members who stay, and about 46% of intros are not answered in time. A greeter rota or reply prompts for welcome threads targets that directly. Secondary: soften newcomer edit reverts (Q9) and fix TikTok onboarding (Q2). Accept a reply-focused recommendation backed by the retention gap; a revert-focused answer with numbers earns partial credit.
- **Evidence:** H6-first-reply-retention, H7-reverted-first-edit; `-- EVAL Q20`, Q8, Q9.
- **Context needed:** 01-business.md (goal 2), 04-metrics-and-tables.md (retention definitions).
- **Grading:** must tie the recommendation to measured retention. Wrong: "get more people to post intros" (intros without replies retain no better than no intro).

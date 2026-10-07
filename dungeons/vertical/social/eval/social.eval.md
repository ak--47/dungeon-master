# Murmur (social) — 20-question eval

- **Data:** `data/verify-social` (full fidelity: 10,000 members, 9,995 with events, 4,973 new signups, 1,117,887 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/social/social.sql` on that data.
- **Stories:** ids refer to the `stories` export in `social.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — How fast is Clips catching on?
- **Prompt:** "We launched Clips in July. How much of what people watch is Clips now, and how fast did that happen?"
- **Type:** trend
- **Answer:** Clips went from nothing to about **35% of post views** in three weeks and then held there. Weekly clip share of `post viewed`: 0% before July 8, 3.1% in the launch week (Jul 6-12, launch on the 8th), 14.6% (week of Jul 13), 26.2% (Jul 20), 34.4% (Jul 27), then 34.6%-35.1% every week through September. From July 29 on, 34.9% of views are Clips. Clips took share from photos (50.5% → 32.4% of views) and text (38.0% → 24.8%); total views kept growing with the member base. Accept 32%-38% after the ramp and a three-week ramp.
- **Evidence:** H1-clips-launch; Insights, `post viewed`, breakdown `post_type`, weekly, % of total; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, three-week ramp into feeds).
- **Grading:** must give the plateau share and the ramp timing. Wrong: reading raw clip view counts as growth that keeps going (the share is flat from late July); claiming Clips added views on top (the mix shifted).

### Q2 — Are members making Clips, or just watching?
- **Prompt:** "Are people actually posting Clips, or only watching them? Is it just creators?"
- **Type:** segmentation
- **Answer:** Members post them too. From July 29, **19.7% of new posts are Clips** (5,206 Clips), and the share is the same for every account type: creators 19.8%, personal 19.7%, business 19.5%. 2,390 members posted at least one Clip from Jul 29 (1,006 creators, 1,250 personal accounts, 134 businesses). Creation lags viewing (about 20% of posts vs 35% of views). Accept 18%-22% and "no difference by account type".
- **Evidence:** H1-clips-launch; Insights, `post created`, breakdown `post_type` and user property `account_type`, from Jul 29; `-- EVAL Q2`.
- **Context needed:** 01-business.md (account types), 03-event-dictionary.md (`post_type`).
- **Grading:** must compare shares, not counts (creators post most of all posts). Wrong: "Clips is a creator-only format" (creators post more of everything).

### Q3 — Is there a magic number in onboarding?
- **Prompt:** "Is there anything in onboarding that predicts whether a new member sticks around? Is there a magic number?"
- **Type:** retention
- **Answer:** Yes: **how many accounts a new member follows on the suggested-accounts screen.** Day 14-27 retention (any member-initiated event; signups Jun 4-Sep 3) by onboarding follows: 0 → 27.4%, 1 → 28.7%, 2 → 31.2%, 3 → 42.6%, 4 → 54.7%, 5 → 64.7%, 6 → 72.6%, 7 → 78.0%, 8 → 75.7%, 9 → 70.5%, 10+ → 76.0%. Grouped: **0-2 follows 28.5%, 3-6 follows 58.7%, 7+ follows 75.6%** (0-2 is 0.38x of 7+). Retention climbs steeply from 3 to 6 follows and flattens at about 7. 21.2% of new members follow nobody there; the average is 4.3. Overall new-member retention is 52.2%. Accept a threshold around 5-7 follows and 0-2 at 0.33x-0.45x of 7+.
- **Evidence:** H2-onboarding-follows; Retention, birth `account created`, return any event except `push notification sent` / `$experiment_started`, custom bracket day 14-27, cohorts by count of `user followed` where `discovery_source = onboarding_suggestions`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (onboarding flow), 03-event-dictionary.md (`discovery_source`), 04-metrics-and-tables.md (retention definition).
- **Grading:** must use onboarding follows (not lifetime follows, which grow with retention itself) and member-initiated activity. Wrong: counting `push notification sent` as a return (pushes keep arriving after members leave); using all follows over the window as the cohort (leaks the outcome).

### Q4 — Should we ship Smart Digest?
- **Prompt:** "The notifications team wants to ship Smart Digest. What did the test show? Should we roll it out?"
- **Type:** funnel
- **Answer:** Digest members got **0.59x the pushes** (3.40 vs 5.76 per exposed member from Aug 5) and opened each one **1.61x as often** (11.6% vs 7.2% open rate, z ≈ 14). Net, opens per member are about the same, slightly lower (0.396 vs 0.417, 0.95x). App activity did not change: post views per member after the start 25.11 vs 25.14, and the change in active days from before to after the start is similar (+0.65 vs +0.74 days). The split is balanced (4,217 Digest vs 4,302 Control). Recommendation: ship if the goal is fewer interruptions at the same engagement; it will not grow engagement. Accept an open-rate ratio of 1.45-1.75 and sends at 0.55-0.65.
- **Evidence:** H3-smart-digest-experiment; Insights, `push notification opened` / `push notification sent` and sends per member, breakdown `Experiment: Smart Digest`, Aug 5 - Oct 1; `-- STORY H3`, `-- EVAL Q4`, and the arm activity table under `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (`notification_id`, `daily_digest`), 04-metrics-and-tables.md (push open rate, server-side events).
- **Grading:** must report both the open rate and the send volume and conclude on opens or engagement per member. Wrong: "Digest is a huge win" from open rate alone; counting pushes as activity.

### Q5 — Did Creator Fair Share make fans subscribe more? (null)
- **Prompt:** "Since we cut the Circles fee in August, are fans more likely to subscribe when they hit a paywall?"
- **Type:** null-hypothesis
- **Answer:** **No.** Subscriptions per paywall view were 5.18% before August 12 and 5.45% after (z ≈ 1.0, not significant). By entry point: locked post 8.50% → 9.13% (z ≈ 1.1), profile button 3.00% → 3.02% (z ≈ 0.1); by platform Android 5.15% → 5.07%, iOS 5.21% → 5.78% (z ≈ 1.5). The fee change goes to creators; fan prices did not change. More subscriptions per day after the cut (10.9 → 13.4) come from more paywall traffic as the member base grew. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q5`; Insights, `circle subscription started` / `circle paywall viewed`, before vs after Aug 12, breakdown `paywall_trigger`.
- **Context needed:** 02-timeline.md (fee change, fan prices unchanged), 01-business.md (Circles).
- **Grading:** must normalize by paywall views. Wrong: "subscriptions rose 23% after the fee cut" from daily counts.

### Q6 — What happened to the Android feed in late August?
- **Prompt:** "Android scrolling looked off at the end of August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **Android For You incident, August 26-29** (timeline; `for_you_feed_health_daily` shows `service_status = major_outage` for android on those four days, `error_rate` ≈ 0.60 vs about 0.006 normally, p95 latency 7-12 s). In Mixpanel, Android For You views per Following-feed view fell to **0.40x** (0.74 vs 1.85 in the 14 days either side); iOS did not move (1.94 vs 1.88). Android For You views went from about 1,000 a day to 300-450; the Following feed on Android was normal. At the baseline ratio, about **2,300 Android For You views** were lost over the four days (the feed service logged 467 failed page requests; a page holds several posts). Back to normal on August 30. Accept 0.35x-0.45x and naming Android and the For You feed.
- **Evidence:** H4-android-for-you-incident; Insights, `post viewed` filtered `feed` in (for_you, following), breakdown `platform` and `feed`, daily, joined to `for_you_feed_health_daily`; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`for_you_feed_health_daily`).
- **Grading:** must name platform, feed, and dates and use a control (iOS or the Following feed). Wrong: "Android members lost interest"; reading total views without the split; comparing to the ad change (Sep 9).

### Q7 — Which paid channel is worth it?
- **Prompt:** "Which paid channel gives us the cheapest members who actually stick around? Are creator partnerships worth the premium?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup (`marketing_spend_daily`): **creator partnerships $5.06, Meta $3.81, TikTok $2.37** (creator ≈ 1.33x Meta). Day 14-27 retention: creator partnerships 61.8%, Meta 47.7%, TikTok 46.0%. So spend per retained member is **$8.18 creator partnerships vs $7.99 Meta (≈ 1.02x)** and **$5.16 TikTok**. Creator partnerships close their price gap with Meta through retention, but TikTok is still the cheapest per retained member. Spend: creator $5,419, Meta $4,847, TikTok $2,379. Accept creator/Meta per signup 1.2x-1.45x, per retained member 0.95x-1.15x, and TikTok cheapest on both.
- **Evidence:** H5-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Retention by `acquisition_channel`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, cost per retained member), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and bring in retention. Wrong: using `installs_reported` as the denominator (e.g., Meta claims 1,498 installs vs 1,272 signups); "creator partnerships are the best channel per retained member" (TikTok is cheaper).

### Q8 — Where do new members drop in onboarding?
- **Prompt:** "Where do new members drop in onboarding, and is it worse for some group?"
- **Type:** funnel
- **Answer:** TikTok signups drop most. Share who pick interests: TikTok 86.2% vs 94-96% elsewhere; share who follow at least one suggested account: **TikTok 64.2%** vs Meta 78.6%, organic 79.2%, friend invites 86.9%, creator partnerships 89.0%. Referred members also follow more suggestions: average onboarding follows creator partnerships 5.93 and friend invites 5.78 vs Meta 3.73, organic 3.69, TikTok 3.10 (share following 7+: 44.9%, 43.4% vs 18.9%, 18.0%, 16.1%). Accept TikTok as the weakest at both steps and referred channels as the strongest followers.
- **Evidence:** H5-paid-channel-economics (with H2); Funnels `account created` → `interests selected` → `user followed` (`discovery_source = onboarding_suggestions`), 1-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by channel and look at the suggested-accounts step. Wrong: blaming platform or signup method.

### Q9 — Did creators respond to Creator Fair Share?
- **Prompt:** "We cut the Circles fee on August 12. Are creators posting more because of it?"
- **Type:** trend
- **Answer:** Yes, creators who run a Circle did. Among creators who joined before June 4, Circle creators posted **1.39x** as many posts per day from Aug 22 (after a ramp) as before Aug 12, while creators without a Circle posted 1.06x; the difference-in-differences is **1.31x**. Weekly posts per Circle creator went from about 1.6-1.85 before the cut to 2.05-2.65 after; other creators stayed near 1.5-1.8 (both groups jump in the week of the Sound Awards). Accept a relative lift of 1.2x-1.45x with non-Circle creators as the control.
- **Evidence:** H6-creator-fair-share; Insights, `post created`, filter `account_type = creator` and `joined_date` before 2026-06-04, breakdown `circle_enabled`, weekly; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (fee change date), 01-business.md (Circles, `circle_enabled`).
- **Grading:** must use non-Circle creators (or a pre-period) as the control. Wrong: raw before/after posting for all creators (the member base and the Sound Awards lift everyone); including creators who joined during the window.

### Q10 — What did Creator Fair Share cost us?
- **Prompt:** "What did the Circles fee cut cost Murmur, and what did creators gain?"
- **Type:** context
- **Answer:** On new Circle subscriptions (first month at list price: supporter $2.99, insider $5.99, VIP $11.99), Murmur's fee fell from **$10.27 a day** (20% of $3,541 bookings over Jun 4 - Aug 11, 69 days) to **$6.59 a day** (10% of $3,359 over Aug 12 - Oct 1, 51 days), about **−36%**, even though bookings per day rose from $51.33 to $65.87 as subscriptions per day grew (10.9 → 13.4) with paywall traffic. Creators' share rose from $41.06 to $59.28 a day (+44%). Subscriptions per paywall view did not change (Q5). Renewals are not in Mixpanel, so this covers first-month payments only. Accept a fee-revenue drop of 30%-40% per day.
- **Evidence:** H6-creator-fair-share (context); Insights `circle subscription started` by `circle_tier` with tier prices from 01-business.md; `-- EVAL Q10`.
- **Context needed:** 01-business.md (tier prices, fee), 02-timeline.md (fee dates).
- **Grading:** must apply the fee in force on each side of Aug 12 and normalize per day. Wrong: comparing totals over periods of different length; assuming the fee change raised conversion.

### Q11 — What was the spike on September 12?
- **Prompt:** "Posting spiked on September 12. What was that, and did it bring more people in?"
- **Type:** context
- **Answer:** The **Murmur Sound Awards** livestream (timeline). Posts, comments, shares, and Stories per daily active member were **2.33x** the level of the Saturdays around it (1.75 vs about 0.73-0.78 on Aug 22, Sep 5, 19, 26); posts alone were 1,057 vs about 380-420 on the weekdays around it (504 on Sunday, Sep 13). It did not bring more people: DAU was 1,319, in line with nearby days, and post views per active member were normal (0.99x). It was a one-day burst of creation by members who were already active. Accept 2.2x-2.8x and "no DAU lift".
- **Evidence:** H7-sound-awards-livestream; Insights, (`post created` + `comment posted` + `post shared` + `story posted`) / active members, daily; `-- STORY H7` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (the event).
- **Grading:** must separate creation from audience size. Wrong: "the awards grew the audience"; attributing it to the ad change (Sep 9).

### Q12 — Did raising ad load pay off?
- **Prompt:** "Ad sales raised ad load on September 9. Did it pay off?"
- **Type:** external-join
- **Answer:** Yes, but each slot earns less. Feed and Clips ads per post view rose **1.61x** (0.0756 → 0.1215; Aug 12-Sep 8 vs Sep 9-Oct 1). eCPM fell to **0.85x** (feed + Clips $5.41 → $4.62; every placement about −14%, Stories included), so ad revenue per 1,000 post views rose **1.36x** ($0.434 → $0.589). Stories ad load did not change (0.0287 → 0.0284 per post view). Click-through held (1.03% → 1.06%). No sign that it hurt viewing: members who joined before June post views per active day went 3.49 → 3.54. The all-member figure slipped 3.21 → 3.14 because new members (who view less per day) grew from 34.5% to 38.4% of active member-days. Accept ads per view 1.45x-1.75x and revenue per view 1.2x-1.5x.
- **Evidence:** H8-ad-load-increase; Insights `ad viewed` (feed, clips) / `post viewed`, joined to `ad_revenue_daily`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (ad load, eCPM, `ad_revenue_daily`).
- **Grading:** must bring in eCPM from the warehouse and normalize by views. Wrong: "revenue rose 60%" (ignores eCPM); "ad load cut engagement" from the all-member per-DAU slip.

### Q13 — Do US members retain better? (null)
- **Prompt:** "Do our US members stick around better than international members?"
- **Type:** null-hypothesis
- **Answer:** **No.** Day 14-27 new-member retention is 51.7% for US members and 53.0% for international members (z ≈ −0.8). The same holds on each platform (Android 51.7% vs 53.5%, iOS 51.6% vs 52.6%). By country it ranges from 49.9% (GB) to 57.2% (BR) on small samples, with no meaningful pattern. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q13`; Retention, birth `account created`, return any member-initiated event, day 14-27, breakdown user property `country`.
- **Context needed:** 01-business.md (countries), 04-metrics-and-tables.md (retention).
- **Grading:** must report a rate comparison and call it a null. Wrong: ranking countries on samples of 200-400 members as if they differ.

### Q14 — How fast do new members post?
- **Prompt:** "How long does it take a new member to make their first post? Is it different for creators?"
- **Type:** funnel
- **Answer:** Median time from signup to first post (7-day window, signups Jun 4 - Sep 24): **creators 7.0 hours, businesses 12.9 hours, personal accounts 20.0 hours** (creators ≈ 0.35x personal). 98% of creators who post within a week do it within 24 hours, vs 83% of businesses and 64% of personal accounts. Creators and businesses are also more likely to post at all in the first week (84.9% and 85.7% vs 50.9%). Accept a creator/personal median ratio of 0.3-0.4.
- **Evidence:** H9-creator-first-post; Funnels `account created` → `post created`, 7-day window, median time to convert, breakdown `account_type`; `-- STORY H9` and `-- EVAL Q14`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (time to first post).
- **Grading:** must use medians from signup, by account type. Wrong: means dominated by the long tail; including late-September signups.

### Q15 — Which Circle paywall converts better?
- **Prompt:** "Fans can hit a Circle paywall from a locked post or from the creator's profile. Which one converts better?"
- **Type:** funnel
- **Answer:** **Locked posts convert about 2.9x better:** 8.79% of locked-post paywall views end in a subscription (944 of 10,741) vs 3.01% from the profile Join button (490 of 16,283). The tier mix is similar either way (about 58-61% Supporter, 28-32% Insider, 10-11% VIP). The profile button gets more paywall traffic but less than half the subscriptions. Accept 2.6x-3.3x.
- **Evidence:** H10-circle-paywall-trigger; Insights `circle subscription started` / `circle paywall viewed`, breakdown `paywall_trigger`; `-- STORY H10` and `-- EVAL Q15`.
- **Context needed:** 01-business.md (Circle paywall entry points), 03-event-dictionary.md (`paywall_trigger`).
- **Grading:** must compare conversion per paywall view by trigger. Wrong: comparing subscription counts only.

### Q16 — iPhone vs Android retention (null)
- **Prompt:** "Do iPhone users retain better than Android users?"
- **Type:** null-hypothesis
- **Answer:** **No.** Day 14-27 new-member retention is 52.0% on iOS and 52.5% on Android (z ≈ −0.3). It holds within channel groups (referred 59.8% vs 63.4%, others 47.8% vs 46.7%) and within signup months (largest gap August, 47.2% vs 51.8%, z ≈ −1.7, not significant). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q16`; Retention, birth `account created`, return any member-initiated event, day 14-27, breakdown `platform`.
- **Context needed:** 00-manifest.md (one device per member), 04-metrics-and-tables.md (retention).
- **Grading:** must call it a null. Wrong: reporting a single month's gap as a platform effect.

### Q17 — Why did push volume drop in August?
- **Prompt:** "Push notifications sent per day dropped in August even though we have more members. Is something broken?"
- **Type:** context
- **Answer:** Nothing is broken; it is the **Smart Digest test** (started Aug 5). Pushes per day went from 712 (Jul 8 - Aug 4) to 647 (Aug 5 - Sep 1) while active members grew, so pushes per active member-day fell from 0.68 to 0.56 (−17%). The drop is all in the Digest arm, which gets 0.59x the pushes of Control (weekly sends: Control rose from about 2,500 to 3,100; Digest fell from about 2,400 to about 1,700 within a week of the start). About half of Digest pushes are the daily digest summary. Accept naming the experiment and the Digest arm.
- **Evidence:** H3-smart-digest-experiment; Insights `push notification sent`, daily, breakdown `Experiment: Smart Digest`; `-- EVAL Q17` and the weekly table under `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (Smart Digest).
- **Grading:** must tie the drop to the experiment arm. Wrong: "a notification outage"; "members turned off notifications".

### Q18 — Where does ad revenue come from?
- **Prompt:** "Break down September ad revenue by placement. Which placement is worth the most per impression?"
- **Type:** external-join
- **Answer:** September (Sep 1-30) ad revenue from `ad_revenue_daily`: **feed $47.96 (60.3%), Clips $16.20 (20.4%), Stories $15.32 (19.3%)**, about $79 in total. eCPM: feed $5.50, Stories $4.24, Clips $3.41; feed is the most valuable placement per impression. eCPM dropped about 14% on every placement on Sep 9 (feed $6.17 → $5.34, Stories $4.76 → $4.05, Clips $3.85 → $3.32). The ad server counts 4-8% more impressions than Mixpanel `ad viewed` (opted-out members and invalid-traffic filtering). Accept the ranking feed > Stories > Clips on eCPM and feed about 60% of revenue.
- **Evidence:** H8-ad-load-increase (warehouse side); `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`), 01-business.md (placements).
- **Grading:** must use the warehouse for revenue and eCPM. Wrong: estimating revenue from Mixpanel impressions with an assumed price; using all of September 1-October 1.

### Q19 — What should we worry about?
- **Prompt:** "I'm presenting to the board next week. What should we be worried about this quarter?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **New-member retention hinges on onboarding follows.** Only 52% of new members are active on day 14-27. The 36% who follow 0-2 suggested accounts retain at 28.5% vs 75.6% at 7+ (Q3). Improving the suggestions screen is the biggest lever.
  2. **TikTok signups are low-intent.** Only 64% follow any suggestion (Q8), though TikTok is still the cheapest per retained member (Q7). Creator partnerships cost 1.33x Meta per signup but about the same per retained member.
  3. **Android release quality.** A four-day Android For You outage (Aug 26-29) cut Android For You viewing to 0.40x with a 60% error rate (Q6).
  4. **Ad yield.** More ad slots raised revenue per post view 36% but eCPM fell about 14% on every placement (Q12, Q18); ad revenue is small next to marketing spend ($79 in September vs about $3,200 a month of paid acquisition).
  5. **Circles economics.** The fee cut lowered Murmur's Circles take per day by about a third (Q10) without lifting fan conversion (Q5); creators with a Circle did post 1.31x more (Q9).
  6. **Notifications.** Smart Digest lifts open rate 1.61x but opens per member are flat to slightly down (Q4).
- **Evidence:** Q3, Q4, Q5, Q6, Q7, Q8, Q10, Q12, Q18; `-- EVAL Q19` (retention by signup month: June 53.9%, July 52.8%, August 49.4%; weekly active members grew from about 3,700 in June to about 5,275 in late September).
- **Context needed:** all guides.
- **Grading:** must prioritize with evidence and include new-member retention and onboarding. Wrong: generic advice without numbers; claiming engagement is falling (weekly active members grew all quarter).

### Q20 — Why do referred members retain better?
- **Prompt:** "Members from creator partnerships and friend invites retain better than paid social. Is it the channel itself, or something else?"
- **Type:** open-ended
- **Answer:** It is **onboarding follows, not the channel itself.** Referred members follow more suggested accounts (about 5.8-5.9 on average vs 3.0-3.7 for Meta, organic, and TikTok). Within the same follow bucket, channels retain about the same: 0-2 follows 25-30%, 3-6 follows 54-63%, 7+ follows 73-81% across all five channels. Predicting each member's retention from their onboarding follows alone reproduces the channel gaps: creator partnerships 61.0% predicted vs 61.8% observed, friend invites 60.3% vs 60.9%, Meta 48.8% vs 47.7%, organic 49.5% vs 48.2%, TikTok 44.5% vs 46.0%. Accept "mediated by onboarding follows" with the within-bucket comparison.
- **Evidence:** H2-onboarding-follows with H5-paid-channel-economics; `-- EVAL Q20`; Retention by `acquisition_channel` with cohorts by onboarding follows.
- **Context needed:** 01-business.md (onboarding, channels), 04-metrics-and-tables.md (onboarding follows, retention).
- **Grading:** must control for onboarding follows. Wrong: "creator-referred members are inherently more loyal" without the within-bucket check.

# Murmur (social) — 20-question eval

- **Data:** `data/verify-social` (full fidelity: 10,000 members, 9,995 with events, 4,946 new signups, 1,116,196 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/social/social.sql` on that data.
- **Stories:** ids refer to the `stories` export in `social.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — How fast is Clips catching on?
- **Prompt:** "We launched Clips in July. How much of what people watch is Clips now, and how fast did that happen?"
- **Type:** trend
- **Answer:** Clips went from nothing to about **35% of post views** in three weeks and then held there. Weekly clip share of `post viewed`: 0% before July 8, 3.4% in the launch week (Jul 6-12, launch on the 8th), 14.3% (week of Jul 13), 26.2% (Jul 20), 34.0% (Jul 27), then 34.4%-35.6% every week through September. From July 29 on, 35.1% of views are Clips. Clips took share from photos (49.9% → 32.5% of views) and text (38.4% → 24.7%); total views kept growing with the member base. Accept 32%-38% after the ramp and a three-week ramp.
- **Evidence:** H1-clips-launch; Insights, `post viewed`, breakdown `post_type`, weekly, % of total; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date; Clips were ramped into feeds gradually).
- **Grading:** must give the plateau share and the ramp timing. Wrong: reading raw clip view counts as growth that keeps going (the share is flat from late July); claiming Clips added views on top (the mix shifted).

### Q2 — Are members making Clips, or just watching?
- **Prompt:** "Are people actually posting Clips, or only watching them? Is it just creators?"
- **Type:** segmentation
- **Answer:** Members post them too. From July 29, **19.4% of new posts are Clips** (4,981 Clips), and the share is about the same for every account type: creators 19.3%, personal 19.7%, business 20.3%. 2,409 members posted at least one Clip from Jul 29 (1,003 creators, 1,245 personal accounts, 161 businesses). Creation lags viewing (about 20% of posts vs 35% of views). Accept 18%-22% and "no difference by account type".
- **Evidence:** H1-clips-launch; Insights, `post created`, breakdown `post_type` and user property `account_type`, from Jul 29; `-- EVAL Q2`.
- **Context needed:** 01-business.md (account types), 03-event-dictionary.md (`post_type`).
- **Grading:** must compare shares, not counts (creators post most of all posts). Wrong: "Clips is a creator-only format" (creators post more of everything).

### Q3 — Is there a magic number in onboarding?
- **Prompt:** "Is there anything in onboarding that predicts whether a new member sticks around? Is there a magic number?"
- **Type:** retention
- **Answer:** Yes: **how many accounts a new member follows on the suggested-accounts screen.** Day 14-27 retention (any member-initiated event; signups Jun 4-Sep 3) by onboarding follows: 0 → 26.0%, 1 → 28.6%, 2 → 35.5%, 3 → 43.4%, 4 → 58.0%, 5 → 67.7%, 6 → 73.7%, 7 → 80.6%, 8 → 82.3%, 9 → 80.7%, 10+ → 75.7%. Grouped: **0-2 follows 28.8%, 3-6 follows 60.5%, 7+ follows 79.6%** (0-2 is 0.36x of 7+). Retention climbs steeply from 3 to 6 follows and flattens at about 7. 20.7% of new members follow nobody there, 35.8% follow 0-2, and the average is 4.3. Overall new-member retention is 54.2%. Accept a threshold around 5-7 follows and 0-2 at 0.32x-0.42x of 7+.
- **Evidence:** H2-onboarding-follows; Retention, birth `account created`, return any event except `push notification sent` / `$experiment_started`, custom bracket day 14-27, cohorts by count of `user followed` where `discovery_source = onboarding_suggestions`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (onboarding flow), 03-event-dictionary.md (`discovery_source`), 04-metrics-and-tables.md (retention definition).
- **Grading:** must use onboarding follows (not lifetime follows, which grow with retention itself) and member-initiated activity. Wrong: counting `push notification sent` or `$experiment_started` as a return (both are server-side and keep arriving after members leave; excluding only `push notification sent` reads 0-2 39.1%, 3-6 66.0%, 7+ 83.2%, which blurs the gap to 0.47x); using all follows over the window as the cohort (leaks the outcome).

### Q4 — Should we ship Smart Digest?
- **Prompt:** "We want to ship Smart Digest. What did the test show? Should we roll it out?"
- **Type:** funnel
- **Answer:** Digest members got **0.61x the pushes** (3.25 vs 5.31 per exposed member from Aug 5) and opened each one **1.59x as often** (10.8% vs 6.8% open rate, z ≈ 13). Net, opens per member are about the same, slightly lower (0.349 vs 0.359, 0.97x). App activity did not change: post views per member after the start 24.71 vs 24.69, active days 7.78 vs 7.77 (see Q16). The split is balanced (4,515 Digest vs 4,567 Control). Recommendation: ship if the goal is fewer interruptions at the same engagement; it will not grow engagement. Accept an open-rate ratio of 1.45-1.75 and sends at 0.55-0.67. Sends per member use exposed members as the denominator (Uniques of `$experiment_started`, or members with the profile property). 334 Digest members (7.4%) were exposed but had every post-start push held back, so dividing by Uniques of `push notification sent` gives 3.51 vs 5.31 (0.66x); accept that read if the analyst names the denominator.
- **Evidence:** H3-smart-digest-experiment; Insights, `push notification opened` / `push notification sent` and sends per member, breakdown `Experiment: Smart Digest`, Aug 5 - Oct 1; `-- STORY H3`, `-- EVAL Q4`, and the arm activity tables under `-- EVAL Q5` and `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (`notification_id`, `daily_digest`), 04-metrics-and-tables.md (push open rate, server-side events).
- **Grading:** must report both the open rate and the send volume and conclude on opens or engagement per member. Wrong: "Digest is a huge win" from open rate alone; counting pushes as activity.

### Q5 — Did Creator Fair Share make fans subscribe more? (null)
- **Prompt:** "Since we cut the Circles fee in August, are fans more likely to subscribe when they hit a paywall?"
- **Type:** null-hypothesis
- **Answer:** **No.** Subscriptions per paywall view were 5.55% before August 12 and 5.28% after (z ≈ −1.0, not significant). By entry point: locked post 9.22% → 8.78% (z ≈ −0.8), profile button 3.08% → 2.90% (z ≈ −0.6); by platform Android 5.57% → 5.49% (z ≈ −0.2), iOS 5.53% → 5.10% (z ≈ −1.1). The fee change goes to creators; fan prices did not change. More subscriptions per day after the cut (11.2 → 12.6) come from more paywall traffic as the member base grew. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q5`; Insights, `circle subscription started` / `circle paywall viewed`, before vs after Aug 12, breakdown `paywall_trigger`.
- **Context needed:** 02-timeline.md (fee change, fan prices unchanged), 01-business.md (Circles).
- **Grading:** must normalize by paywall views. Wrong: "subscriptions rose 13% after the fee cut" from daily counts.

### Q6 — What happened to the Android feed in late August?
- **Prompt:** "Android scrolling looked off at the end of August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **Android For You incident, August 26-29** (timeline; `for_you_feed_health_daily` shows `service_status = major_outage` for android on those four days, `error_rate` ≈ 0.60 vs about 0.006 normally, p95 latency 7.5-10.5 s). In Mixpanel, Android For You views per Following-feed view fell to **0.40x** (0.76 vs 1.88 in the 14 days either side); iOS did not move (1.89 vs 1.82). Android For You views went from about 775-1,180 a day to 370-456; the Following feed on Android was normal. At the baseline ratio, about **2,440 Android For You views** were lost over the four days (the feed service logged 506 failed page requests; a page holds several posts). Back to normal on August 30. Accept 0.35x-0.45x and naming Android and the For You feed.
- **Evidence:** H4-android-for-you-incident; Insights, `post viewed` filtered `feed` in (for_you, following), breakdown `platform` and `feed`, daily, joined to `for_you_feed_health_daily`; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`for_you_feed_health_daily`).
- **Grading:** must name platform, feed, and dates and use a control (iOS or the Following feed). Wrong: "Android members lost interest"; reading total views without the split; comparing to the ad change (Sep 9).

### Q7 — Which paid channel is worth it?
- **Prompt:** "Which paid channel gives us the cheapest members who actually stick around? Are creator partnerships worth the premium?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup (`marketing_spend_daily`): **creator partnerships $5.10, Meta $3.72, TikTok $2.43** (creator ≈ 1.37x Meta). Day 14-27 retention: creator partnerships 63.2%, Meta 48.2%, TikTok 49.9%. So spend per retained member is **$8.07 creator partnerships vs $7.71 Meta (≈ 1.05x)** and **$4.88 TikTok**. Creator partnerships close most of their price gap with Meta through retention, but TikTok is still the cheapest per retained member. Spend: creator $5,377, Meta $4,978, TikTok $2,320. Accept creator/Meta per signup 1.2x-1.45x, per retained member 0.95x-1.16x, and TikTok cheapest on both.
- **Evidence:** H5-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Retention by `acquisition_channel`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, cost per retained member), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and bring in retention. Wrong: using `installs_reported` as the denominator (e.g., Meta claims 1,541 installs vs 1,340 signups); "creator partnerships are the best channel per retained member" (TikTok is cheaper).

### Q8 — Where do new members drop in onboarding?
- **Prompt:** "Where do new members drop in onboarding, and is it worse for some group?"
- **Type:** funnel
- **Answer:** TikTok signups drop most. Share who pick interests: TikTok 85.2% vs 94-95% elsewhere; share who follow at least one suggested account: **TikTok 66.5%** vs Meta 78.0%, organic 79.0%, friend invites 86.9%, creator partnerships 86.9%. Referred members also follow more suggestions: average onboarding follows friend invites 6.02 and creator partnerships 5.78 vs organic 3.70, Meta 3.64, TikTok 3.12 (share following 7+: 48.3%, 42.7% vs 18.2%, 18.1%, 15.2%). Accept TikTok as the weakest at both steps and referred channels as the strongest followers.
- **Evidence:** H5-paid-channel-economics (with H2); Funnels `account created` → `interests selected` → `user followed` (`discovery_source = onboarding_suggestions`), 1-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by channel and look at the suggested-accounts step. Wrong: blaming platform or signup method.

### Q9 — Did creators respond to Creator Fair Share?
- **Prompt:** "We cut the Circles fee on August 12. Are creators posting more because of it?"
- **Type:** trend
- **Answer:** Yes, creators who run a Circle did. Among creators who joined before June 4, Circle creators posted **1.42x** as many posts per day from Aug 22 (after a ramp) as before Aug 12, while creators without a Circle posted 1.07x; the difference-in-differences is **1.33x**. Weekly posts per Circle creator went from about 1.5-1.8 before the cut to 2.1-2.45 after (2.74 in the week of the Sound Awards); other creators stayed near 1.45-1.7 (2.0 in the awards week). Accept a relative lift of 1.2x-1.45x with non-Circle creators as the control.
- **Evidence:** H6-creator-fair-share; Insights, `post created`, filter `account_type = creator` and `joined_date` before 2026-06-04, breakdown `circle_enabled`, weekly; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (fee change date), 01-business.md (Circles, `circle_enabled`).
- **Grading:** must use non-Circle creators (or a pre-period) as the control. Wrong: raw before/after posting for all creators (the member base and the Sound Awards lift everyone); including creators who joined during the window.

### Q10 — What did Creator Fair Share cost us?
- **Prompt:** "What did the Circles fee cut cost Murmur, and what did creators gain?"
- **Type:** context
- **Answer:** On new Circle subscriptions (first month at list price: supporter $2.99, insider $5.99, VIP $11.99), Murmur's fee fell from **$10.82 a day** (20% of $3,733 bookings over Jun 4 - Aug 11, 69 days) to **$6.12 a day** (10% of $3,120 over Aug 12 - Oct 1, 51 days), about **−43%**, even though bookings per day rose from $54.11 to $61.17 as subscriptions per day grew (11.2 → 12.6) with paywall traffic. Creators' share rose from $43.28 to $55.05 a day (+27%). Subscriptions per paywall view did not change (Q5). Renewals are not in Mixpanel, so this covers first-month payments only. Accept a fee-revenue drop of 35%-50% per day.
- **Evidence:** H6-creator-fair-share (context); Insights `circle subscription started` by `circle_tier` with tier prices from 01-business.md; `-- EVAL Q10`.
- **Context needed:** 01-business.md (tier prices, fee), 02-timeline.md (fee dates).
- **Grading:** must apply the fee in force on each side of Aug 12 and normalize per day. Wrong: comparing totals over periods of different length; assuming the fee change raised conversion.

### Q11 — What was the spike on September 12?
- **Prompt:** "Posting spiked on September 12. What was that, and did it bring more people in?"
- **Type:** context
- **Answer:** The **Murmur Sound Awards** livestream (timeline). Posts, comments, shares, and Stories per daily active member were **2.51x** the level of the Saturdays around it (1.56 vs 0.62-0.63 on Aug 22, Sep 5, 19, 26); posts alone were 1,025 vs about 355-400 on the weekdays around it (475 on Sunday, Sep 13). It did not bring more people: DAU was 1,378, in line with nearby days (1,229-1,451), and post views per active member were normal (1.00x). It was a one-day burst of creation by members who were already active. Accept 2.2x-2.8x and "no DAU lift".
- **Evidence:** H7-sound-awards-livestream; Insights, (`post created` + `comment posted` + `post shared` + `story posted`) / active members, daily; `-- STORY H7` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (the event).
- **Grading:** must separate creation from audience size. Wrong: "the awards grew the audience"; attributing it to the ad change (Sep 9).

### Q12 — Did raising ad load pay off?
- **Prompt:** "We raised ad load on September 9. Did it pay off?"
- **Type:** external-join
- **Answer:** Yes, but each slot earns less. Feed and Clips ads per post view rose **1.61x** (0.0701 → 0.1130; Aug 12-Sep 8 vs Sep 9-Oct 1). eCPM fell to **0.86x** (feed + Clips $5.39 → $4.65; every placement about −14%, Stories included: feed −14%, Clips −14%, Stories −15%), so ad revenue per 1,000 post views rose **1.37x** ($0.402 → $0.551). Stories ad load did not change (0.1298 → 0.1293 Stories ads per `story viewed`). Click-through held within noise (1.25% → 1.13% on 132 and 150 clicks). No sign that it hurt viewing: members who joined before June post views per active day went 3.35 → 3.37. The all-member figure slipped 3.20 → 3.15 because new members (who view less per day) grew from 32.7% to 36.3% of active member-days. Accept ads per view 1.45x-1.75x and revenue per view 1.2x-1.5x.
- **Evidence:** H8-ad-load-increase; Insights `ad viewed` (feed, clips) / `post viewed`, joined to `ad_revenue_daily`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (ad load, eCPM, `ad_revenue_daily`).
- **Grading:** must bring in eCPM from the warehouse and normalize by views. Wrong: "revenue rose 60%" (ignores eCPM); "ad load cut engagement" from the all-member per-DAU slip.

### Q13 — Do younger members retain better? (null)
- **Prompt:** "Our app skews young. Do members under 35 stick around better than older members?"
- **Type:** null-hypothesis
- **Answer:** **No.** Day 14-27 new-member retention is 54.4% for members under 35 and 53.8% for members 35 and over (z ≈ 0.4). The same holds in every obvious sub-split: Android 53.7% vs 50.2% (z ≈ 1.3), iOS 55.0% vs 56.7% (z ≈ −0.7), referred channels 64.9% vs 64.5%, other channels 49.1% vs 48.6%, and each signup period (June 53.4% vs 54.0%, July 55.6% vs 55.7%, Aug 1-Sep 3 54.1% vs 51.8%). By band: 18-24 55.2%, 25-34 53.7%, 35-44 52.6%, 45-54 53.5%, 55+ 59.7% (55+ has only 154 members). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q13`; Retention, birth `account created`, return any event except `push notification sent` and `$experiment_started`, day 14-27, breakdown user property `age_band`.
- **Context needed:** 01-business.md (age bands), 04-metrics-and-tables.md (retention).
- **Grading:** must report a rate comparison and call it a null. Wrong: ranking age bands on small samples as if they differ (for example "55+ retain best").

### Q14 — How fast do new members post?
- **Prompt:** "How long does it take a new member to make their first post? Is it different for creators?"
- **Type:** funnel
- **Answer:** Median time from signup to first post (7-day window, signups Jun 4 - Sep 24): **creators 7.0 hours, businesses 12.7 hours, personal accounts 19.6 hours** (creators ≈ 0.36x personal). 98% of creators who post within a week do it within 24 hours, vs 87% of businesses and 62% of personal accounts. Creators and businesses are also more likely to post at all in the first week (98.4% and 93.1% vs 58.8%). Accept a creator/personal median ratio of 0.3-0.4.
- **Evidence:** H9-creator-first-post; Funnels `account created` → `post created`, 7-day window, median time to convert, breakdown `account_type`; `-- STORY H9` and `-- EVAL Q14`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (time to first post).
- **Grading:** must use medians from signup, by account type. Wrong: means dominated by the long tail; including late-September signups.

### Q15 — Which Circle paywall converts better?
- **Prompt:** "Fans can hit a Circle paywall from a locked post or from the creator's profile. Which one converts better?"
- **Type:** funnel
- **Answer:** **Locked posts convert about 3x better:** 9.02% of locked-post paywall views end in a subscription (950 of 10,536) vs 2.99% from the profile Join button (467 of 15,597), 3.01x. A Funnels report on uniques with the 1-hour window from 03-event-dictionary.md agrees: 9.26% vs 3.10% (2.99x). The tier mix is similar either way (about 60% Supporter, 28-30% Insider, 9-12% VIP). The profile button gets more paywall traffic but half the subscriptions. Accept 2.6x-3.3x.
- **Evidence:** H10-circle-paywall-trigger; Insights `circle subscription started` / `circle paywall viewed`, breakdown `paywall_trigger`; `-- STORY H10` and `-- EVAL Q15`.
- **Context needed:** 01-business.md (Circle paywall entry points), 03-event-dictionary.md (`paywall_trigger`, Circle join funnel window).
- **Grading:** must compare conversion per paywall view by trigger. A Funnels report with Mixpanel's default 30-day window reads 13.7% vs 8.3% on uniques (about 1.65x), because fans who meet many paywalls subscribe at some point within a month; accept that read if the analyst names the window and still ranks locked posts first. Wrong: comparing subscription counts only.

### Q16 — Is Smart Digest making members less active? (null)
- **Prompt:** "Smart Digest sends fewer notifications. Are those members opening the app less now?"
- **Type:** null-hypothesis
- **Answer:** **No.** From Aug 5, exposed Digest members were active on 7.78 days on average vs 7.77 for Control (z ≈ 0.1) and opened the app 6.15 times vs 6.06 (z ≈ 0.7). The null holds in each sub-split: Android 7.59 vs 7.85 active days (z ≈ −1.6), iOS 7.95 vs 7.70 (z ≈ 1.6) (opposite signs, neither significant); members who joined before June 9.87 vs 9.77 (z ≈ 0.7), members who joined in the window 5.44 vs 5.46 (z ≈ −0.2). Opens per push rose (Q4), so members reach the app about as often with fewer pushes. Accept "no meaningful change".
- **Evidence:** H3-smart-digest-experiment (context); `-- EVAL Q16`; Insights, `app opened` (totals per member) and active days, breakdown `Experiment: Smart Digest`, Aug 5 - Oct 1, return events excluding `push notification sent` and `$experiment_started`.
- **Context needed:** 02-timeline.md (Smart Digest), 04-metrics-and-tables.md (active member definition).
- **Grading:** must compare arms on member-initiated activity per exposed member and call it a null. Wrong: counting pushes as activity (Digest members then look less active); reading the platform sub-splits as opposite platform effects.

### Q17 — Why did push volume drop in August?
- **Prompt:** "Push notifications sent per day dropped in August even though we have more members. Is something broken?"
- **Type:** context
- **Answer:** Nothing is broken; it is the **Smart Digest test** (started Aug 5). Pushes per day went from 696 (Jul 8 - Aug 4) to 640 (Aug 5 - Sep 1) while active members grew, so pushes per active member-day fell from 0.63 to 0.53 (−16%). The drop is all in the Digest arm, which gets 0.61x the pushes of Control (weekly sends: Control rose from about 2,400 to 3,100; Digest fell from about 2,400 to about 1,700 within a week of the start). About half of Digest pushes are the daily digest summary. Accept naming the experiment and the Digest arm.
- **Evidence:** H3-smart-digest-experiment; Insights `push notification sent`, daily, breakdown `Experiment: Smart Digest`; `-- EVAL Q17` and the weekly table under `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (Smart Digest).
- **Grading:** must tie the drop to the experiment arm. Wrong: "a notification outage"; "members turned off notifications".

### Q18 — Where does ad revenue come from?
- **Prompt:** "Break down September ad revenue by placement. Which placement is worth the most per impression?"
- **Type:** external-join
- **Answer:** September (Sep 1-30) ad revenue from `ad_revenue_daily`: **feed $48.25 (61.3%), Clips $15.34 (19.5%), Stories $15.09 (19.2%)**, about $79 in total. eCPM: feed $5.49, Stories $4.23, Clips $3.42; feed is the most valuable placement per impression. eCPM dropped about 14% on every placement on Sep 9 (feed $6.17 → $5.33, Stories $4.77 → $4.03, Clips $3.85 → $3.33). The ad server counts 4-8% more impressions than Mixpanel `ad viewed` (opted-out members and invalid-traffic filtering). Accept the ranking feed > Stories > Clips on eCPM and feed about 60% of revenue.
- **Evidence:** H8-ad-load-increase (warehouse side); `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`), 01-business.md (placements).
- **Grading:** must use the warehouse for revenue and eCPM. Wrong: estimating revenue from Mixpanel impressions with an assumed price; using all of September 1-October 1.

### Q19 — What should we worry about?
- **Prompt:** "I'm presenting to the board next week. What should we be worried about this quarter?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **New-member retention hinges on onboarding follows.** Only 54% of new members are active on day 14-27. The 36% who follow 0-2 suggested accounts retain at 28.8% vs 79.6% at 7+ (Q3). Improving the suggestions screen is the biggest lever.
  2. **TikTok signups are low-intent.** Only 67% follow any suggestion (Q8), though TikTok is still the cheapest per retained member (Q7). Creator partnerships cost 1.37x Meta per signup but about the same per retained member.
  3. **Android release quality.** A four-day Android For You outage (Aug 26-29) cut Android For You viewing to 0.40x with a 60% error rate (Q6).
  4. **Ad yield.** More ad slots raised revenue per post view 37% but eCPM fell about 14% on every placement (Q12, Q18); ad revenue is a small network-partner test next to marketing spend ($79 in September vs $3,137 of paid acquisition; 01-business.md).
  5. **Circles economics.** The fee cut lowered Murmur's Circles take per day by about 43% (Q10) without lifting fan conversion (Q5); creators with a Circle did post 1.33x more (Q9).
  6. **Notifications.** Smart Digest lifts open rate 1.59x but opens per member are flat to slightly down (Q4), and app activity is unchanged (Q16).
- **Evidence:** Q3, Q4, Q5, Q6, Q7, Q8, Q10, Q12, Q16, Q18; `-- EVAL Q19` (retention by signup month: June 53.6%, July 55.6%, August 53.3%; weekly active members grew from about 3,800 in early June to about 5,500 in late September; per-active-member rates of unfollows, shares, community joins, profile updates, and reports).
- **Context needed:** all guides.
- **Grading:** must prioritize with evidence and include new-member retention and onboarding. Raw counts of unfollows, shares, reports, community joins, and profile updates rise with the member base; per 1,000 weekly active members they barely move between the first four weeks (Jun 8-Jul 5) and the last four (Aug 31-Sep 27): unfollows 24.0 → 26.7, shares 93 → 101 (the late weeks hold the Sound Awards), community joins 32.6 → 29.1, profile updates 17.0 → 18.9, reports 20.5 → 20.1. Penalize an answer that presents rising unfollows or reports as a behavior change from raw counts without normalizing by active members. Wrong: generic advice without numbers; claiming engagement is falling (weekly active members grew all quarter).

### Q20 — Why do referred members retain better?
- **Prompt:** "Members from creator partnerships and friend invites retain better than paid social. Is it the channel itself, or something else?"
- **Type:** open-ended
- **Answer:** It is **onboarding follows, not the channel itself.** Referred members follow more suggested accounts (about 5.8-6.0 on average vs 3.1-3.8 for Meta, organic, and TikTok). Within the same follow bucket, channels retain about the same: 0-2 follows 26-32%, 3-6 follows 55-66%, 7+ follows 69-83% across all five channels. Predicting each member's retention from their onboarding follows alone reproduces the channel gaps: creator partnerships 63.0% predicted vs 63.2% observed, friend invites 64.8% vs 67.5%, Meta 50.8% vs 48.2%, organic 50.0% vs 49.1%, TikTok 47.1% vs 49.9%. Accept "mediated by onboarding follows" with the within-bucket comparison.
- **Evidence:** H2-onboarding-follows with H5-paid-channel-economics; `-- EVAL Q20`; Retention by `acquisition_channel` with cohorts by onboarding follows.
- **Context needed:** 01-business.md (onboarding, channels), 04-metrics-and-tables.md (retention), 03-event-dictionary.md (onboarding `user followed`).
- **Grading:** must control for onboarding follows. Wrong: "creator-referred members are inherently more loyal" without the within-bucket check.

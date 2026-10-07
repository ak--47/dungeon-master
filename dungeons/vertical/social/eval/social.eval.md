# Murmur (social) — 20-question eval

- **Data:** `data/verify-social` (full fidelity: 10,000 members, 9,997 with events, 5,005 new signups, 1,157,719 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/social/social.sql` on that data.
- **Stories:** ids refer to the `stories` export in `social.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — How fast is Clips catching on?
- **Prompt:** "We launched Clips in July. How much of what people watch is Clips now, and how fast did that happen?"
- **Type:** trend
- **Answer:** Clips went from nothing to about **35% of post views** in three weeks and then held there. Weekly clip share of `post viewed`: 0% before July 8, 3.1% in the launch week (Jul 6-12, launch on the 8th), 14.1% (week of Jul 13), 25.8% (Jul 20), 34.3% (Jul 27), then 34.6%-35.3% every week through September. From July 29 on, 34.9% of views are Clips. Clips took share from photos (50.1% → 32.6% of views) and text (37.8% → 24.7%); total views kept growing with the member base. Accept 32%-38% after the ramp and a three-week ramp.
- **Evidence:** H1-clips-launch; Insights, `post viewed`, breakdown `post_type`, weekly, % of total; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date; Clips were ramped into feeds gradually).
- **Grading:** must give the plateau share and the ramp timing. Wrong: reading raw clip view counts as growth that keeps going (the share is flat from late July); claiming Clips added views on top (the mix shifted).

### Q2 — Are members making Clips, or just watching?
- **Prompt:** "Are people actually posting Clips, or only watching them? Is it just creators?"
- **Type:** segmentation
- **Answer:** Members post them too. From July 29, **20.1% of new posts are Clips** (5,423 Clips), and the share is about the same for every account type: creators 20.0%, personal 20.1%, business 21.1%. 2,553 members posted at least one Clip from Jul 29 (1,054 creators, 1,355 personal accounts, 144 businesses). Creation lags viewing (about 20% of posts vs 35% of views). Accept 18%-22% and "no difference by account type".
- **Evidence:** H1-clips-launch; Insights, `post created`, breakdown `post_type` and user property `account_type`, from Jul 29; `-- EVAL Q2`.
- **Context needed:** 01-business.md (account types), 03-event-dictionary.md (`post_type`).
- **Grading:** must compare shares, not counts (creators post most of all posts). Wrong: "Clips is a creator-only format" (creators post more of everything).

### Q3 — Is there a magic number in onboarding?
- **Prompt:** "Is there anything in onboarding that predicts whether a new member sticks around? Is there a magic number?"
- **Type:** retention
- **Answer:** Yes: **how many accounts a new member follows on the suggested-accounts screen.** Day 14-27 retention (any member-initiated event; signups Jun 4-Sep 3) by onboarding follows: 0 → 29.4%, 1 → 31.7%, 2 → 35.3%, 3 → 45.0%, 4 → 54.9%, 5 → 65.4%, 6 → 70.4%, 7 → 76.3%, 8 → 79.6%, 9 → 80.3%, 10+ → 83.3%. Grouped: **0-2 follows 31.1%, 3-6 follows 58.8%, 7+ follows 80.0%** (0-2 is 0.39x of 7+). Retention climbs steeply from 3 to 6 follows and flattens from about 7. 21.2% of new members follow nobody there, 35.2% follow 0-2, and the average is 4.4. Overall new-member retention is 55.0%. Accept a threshold around 5-7 follows and 0-2 at 0.32x-0.42x of 7+.
- **Evidence:** H2-onboarding-follows; Retention, birth `account created`, return any event except `push notification sent` / `$experiment_started`, custom bracket day 14-27, cohorts by count of `user followed` where `discovery_source = onboarding_suggestions`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (onboarding flow), 03-event-dictionary.md (`discovery_source`), 04-metrics-and-tables.md (retention definition).
- **Grading:** must use onboarding follows (not lifetime follows, which grow with retention itself) and member-initiated activity. Wrong: counting `push notification sent` or `$experiment_started` as a return (both are server-side and keep arriving after members leave; excluding only `push notification sent` reads 0-2 41.6%, 3-6 65.3%, 7+ 82.9%, which blurs the gap to 0.50x); using all follows over the window as the cohort (leaks the outcome).

### Q4 — Should we ship Smart Digest?
- **Prompt:** "We want to ship Smart Digest. What did the test show? Should we roll it out?"
- **Type:** funnel
- **Answer:** Digest members got **0.60x the pushes** (3.41 vs 5.73 per exposed member from Aug 5) and opened each one **1.63x as often** (10.9% vs 6.7% open rate, z ≈ 14). Net, opens per member are about the same, slightly lower (0.373 vs 0.385, 0.97x). App activity did not change: post views per member after the start 25.87 vs 26.32, active days 7.78 vs 7.84 (see Q16). The split is balanced (4,580 Digest vs 4,685 Control). Recommendation: ship if the goal is fewer interruptions at the same engagement; it will not grow engagement. Accept an open-rate ratio of 1.45-1.75 and sends at 0.55-0.67. Sends per member use exposed members as the denominator (Uniques of `$experiment_started`, or members with the profile property). 380 Digest members (8.3%) were exposed but had every post-start push held back, so dividing by Uniques of `push notification sent` gives 3.72 vs 5.73 (0.65x); accept that read if the analyst names the denominator.
- **Evidence:** H3-smart-digest-experiment; Insights, `push notification opened` / `push notification sent` and sends per member, breakdown `Experiment: Smart Digest`, Aug 5 - Oct 1; `-- STORY H3`, `-- EVAL Q4`, and the denominator table under `-- EVAL Q4`, and the arm activity tables under `-- EVAL Q5` and `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (`notification_id`, `daily_digest`), 04-metrics-and-tables.md (push open rate, server-side events).
- **Grading:** must report both the open rate and the send volume and conclude on opens or engagement per member. Wrong: "Digest is a huge win" from open rate alone; counting pushes as activity.

### Q5 — Did Creator Fair Share make fans subscribe more? (null)
- **Prompt:** "Since we cut the Circles fee in August, are fans more likely to subscribe when they hit a paywall?"
- **Type:** null-hypothesis
- **Answer:** **No.** Subscriptions per paywall view were 7.51% before August 12 and 7.30% after (z ≈ −0.6, not significant). By entry point: locked post 11.69% → 11.60% (z ≈ −0.1), profile button 4.40% → 3.96% (z ≈ −1.2); by platform Android 7.04% → 6.95% (z ≈ −0.2), iOS 7.93% → 7.61% (z ≈ −0.6). The fee change goes to creators; fan prices did not change. More subscriptions per day after the cut (11.0 → 13.2) come from more paywall traffic as the member base grew. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q5`; Insights, `circle subscription started` / `circle paywall viewed`, before vs after Aug 12, breakdown `paywall_trigger`.
- **Context needed:** 02-timeline.md (fee change, fan prices unchanged), 01-business.md (Circles).
- **Grading:** must normalize by paywall views. Wrong: "subscriptions rose 21% after the fee cut" from daily counts.

### Q6 — What happened to the Android feed in late August?
- **Prompt:** "Android scrolling looked off at the end of August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **Android For You incident, August 26-29** (timeline; `for_you_feed_health_daily` shows `service_status = major_outage` for android on those four days, `error_rate` ≈ 0.60 vs about 0.006 normally, p95 latency 7.5-10.5 s). In Mixpanel, Android For You views per Following-feed view fell to **0.42x** (0.79 vs 1.85 in the 14 days either side); iOS did not move (1.90 vs 1.90). Android For You views went from about 956-1,339 a day to 437-538; the Following feed on Android was normal. At the baseline ratio, about **2,615 Android For You views** were lost over the four days (the feed service logged 588 failed page requests; a page holds several posts). Back to normal on August 30. Accept 0.35x-0.45x and naming Android and the For You feed.
- **Evidence:** H4-android-for-you-incident; Insights, `post viewed` filtered `feed` in (for_you, following), breakdown `platform` and `feed`, daily, joined to `for_you_feed_health_daily`; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`for_you_feed_health_daily`).
- **Grading:** must name platform, feed, and dates and use a control (iOS or the Following feed). Wrong: "Android members lost interest"; reading total views without the split; comparing to the ad change (Sep 9).

### Q7 — Which paid channel is worth it?
- **Prompt:** "Which paid channel gives us the cheapest members who actually stick around? Are creator partnerships worth the premium?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup (`marketing_spend_daily`): **creator partnerships $4.97, Meta $3.82, TikTok $2.38** (creator ≈ 1.30x Meta). Day 14-27 retention: creator partnerships 63.9%, Meta 53.2%, TikTok 43.5%. So spend per retained member is **$7.77 creator partnerships vs $7.17 Meta (≈ 1.08x)** and **$5.48 TikTok**. Creator partnerships close most of their price gap with Meta through retention, but TikTok is still the cheapest per retained member. Spend: creator $5,531, Meta $4,847, TikTok $2,364. Accept creator/Meta per signup 1.2x-1.45x, per retained member 0.95x-1.16x, and TikTok cheapest on both.
- **Evidence:** H5-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Retention by `acquisition_channel`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, cost per retained member), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and bring in retention. Wrong: using `installs_reported` as the denominator (e.g., Meta claims 1,491 installs vs 1,270 signups); "creator partnerships are the best channel per retained member" (TikTok is cheaper).

### Q8 — Where do new members drop in onboarding?
- **Prompt:** "Where do new members drop in onboarding, and is it worse for some group?"
- **Type:** funnel
- **Answer:** TikTok signups drop most. Share who pick interests: TikTok 85.4% vs 94-95% elsewhere; share who follow at least one suggested account: **TikTok 62.6%** vs organic 77.1%, Meta 80.5%, creator partnerships 88.4%, friend invites 88.6%. Referred members also follow more suggestions: average onboarding follows friend invites 6.26 and creator partnerships 5.96 vs organic 3.81, Meta 3.78, TikTok 2.87 (share following 7+: 49.3%, 44.0% vs 20.5%, 19.4%, 14.3%). Accept TikTok as the weakest at both steps and referred channels as the strongest followers.
- **Evidence:** H5-paid-channel-economics (with H2); Funnels `account created` → `interests selected` → `user followed` (`discovery_source = onboarding_suggestions`), 1-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by channel and look at the suggested-accounts step. Wrong: blaming platform or signup method.

### Q9 — Did creators respond to Creator Fair Share?
- **Prompt:** "We cut the Circles fee on August 12. Are creators posting more because of it?"
- **Type:** trend
- **Answer:** Yes, creators who run a Circle did. Among creators who joined before June 4, Circle creators posted **1.39x** as many posts per day from Aug 22 (after a ramp) as before Aug 12, while creators without a Circle posted 1.04x; the difference-in-differences is **1.34x**. Weekly posts per Circle creator went from about 1.45-1.75 before the cut to 2.1-2.3 after (2.80 in the week of the Sound Awards); other creators stayed near 1.5-1.7 (1.86 in the awards week). Accept a relative lift of 1.2x-1.45x with non-Circle creators as the control.
- **Evidence:** H6-creator-fair-share; Insights, `post created`, filter `account_type = creator` and `joined_date` before 2026-06-04, breakdown `circle_enabled`, weekly; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (fee change date), 01-business.md (Circles, `circle_enabled`).
- **Grading:** must use non-Circle creators (or a pre-period) as the control. Wrong: raw before/after posting for all creators (the member base and the Sound Awards lift everyone); including creators who joined during the window.

### Q10 — What did Creator Fair Share cost us?
- **Prompt:** "What did the Circles fee cut cost Murmur, and what did creators gain?"
- **Type:** context
- **Answer:** On new Circle subscriptions (first month at list price: supporter $2.99, insider $5.99, VIP $11.99), Murmur's fee fell from **$10.75 a day** (20% of $3,709 bookings over Jun 4 - Aug 11, 69 days) to **$6.42 a day** (10% of $3,275 over Aug 12 - Oct 1, 51 days), about **−40%**, even though bookings per day rose from $53.76 to $64.22 as subscriptions per day grew (11.0 → 13.2) with paywall traffic. Creators' share rose from $43.01 to $57.80 a day (+34%). Subscriptions per paywall view did not change (Q5). Renewals are not in Mixpanel, so this covers first-month payments only. Accept a fee-revenue drop of 35%-50% per day.
- **Evidence:** H6-creator-fair-share (context); Insights `circle subscription started` by `circle_tier` with tier prices from 01-business.md; `-- EVAL Q10`.
- **Context needed:** 01-business.md (tier prices, fee), 02-timeline.md (fee dates).
- **Grading:** must apply the fee in force on each side of Aug 12 and normalize per day. Wrong: comparing totals over periods of different length; assuming the fee change raised conversion.

### Q11 — What was the spike on September 12?
- **Prompt:** "Posting spiked on September 12. What was that, and did it bring more people in?"
- **Type:** context
- **Answer:** The **Murmur Sound Awards** livestream (timeline). Posts, comments, shares, and Stories per daily active member were **2.45x** the level of the Saturdays around it (1.59 vs 0.63-0.68 on Aug 22, Sep 5, 19, 26); posts alone were 1,176 vs about 400-460 on the weekdays around it (514 on Sunday, Sep 13). It did not bring more people: DAU was 1,446, in line with nearby days (1,236-1,467), and post views per active member were normal (0.98x). It was a one-day burst of creation by members who were already active. Accept 2.2x-2.8x and "no DAU lift".
- **Evidence:** H7-sound-awards-livestream; Insights, (`post created` + `comment posted` + `post shared` + `story posted`) / active members, daily; `-- STORY H7` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (the event).
- **Grading:** must separate creation from audience size. Wrong: "the awards grew the audience"; attributing it to the ad change (Sep 9).

### Q12 — Did raising ad load pay off?
- **Prompt:** "We raised ad load on September 9. Did it pay off?"
- **Type:** external-join
- **Answer:** Yes, but each slot earns less. Feed and Clips ads per post view rose **1.61x** (0.0707 → 0.1141; Aug 12-Sep 8 vs Sep 9-Oct 1). eCPM fell to **0.86x** (feed + Clips $5.39 → $4.64; every placement about −14%, Stories included: feed −14%, Clips −14%, Stories −15%), so ad revenue per 1,000 post views rose **1.38x** ($0.403 → $0.555). Stories ad load did not change (0.1283 → 0.1272 Stories ads per `story viewed`). Click-through held (1.06% → 1.03% on 119 and 150 clicks). No sign that it hurt viewing: post views per active member-day went 3.35 → 3.40 for all members and 3.46 → 3.46 for members who joined before June; new members (who view a little less per day) grew from 34.8% to 40.0% of active member-days. Accept ads per view 1.45x-1.75x and revenue per view 1.2x-1.5x.
- **Evidence:** H8-ad-load-increase; Insights `ad viewed` (feed, clips) / `post viewed`, joined to `ad_revenue_daily`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (ad load, eCPM, `ad_revenue_daily`).
- **Grading:** must bring in eCPM from the warehouse and normalize by views. Wrong: "revenue rose 60%" (ignores eCPM); "ad load cut engagement" without a views-per-active-member check.

### Q13 — Do members who pick more interests stick around? (null)
- **Prompt:** "New members pick 3 to 8 interests at signup. Do the ones who pick more interests retain better?"
- **Type:** null-hypothesis
- **Answer:** **No.** Among new members who picked interests (signups Jun 4-Sep 3), day 14-27 retention is 56.6% for 5 or more interests and 57.4% for 3-4 (z ≈ −0.5). By count: 3 → 57.8%, 4 → 57.1%, 5 → 57.6%, 6 → 58.0%, 7 → 54.8%, 8 → 54.9% (no trend). The null holds in the obvious sub-splits: Android 56.9% vs 56.6% (z ≈ 0.1), iOS 56.3% vs 58.2% (z ≈ −0.8), referred channels 65.7% vs 66.5%, other channels 51.4% vs 52.6%, June signups 56.4% vs 57.3%, July 56.0% vs 60.4% (z ≈ −1.5), Aug 1-Sep 3 57.2% vs 54.9% (z ≈ 0.9); the Android vs iOS difference in the gap is z ≈ 0.7. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q13`; Retention, birth `account created`, return any event except `push notification sent` and `$experiment_started`, day 14-27, breakdown `interest_count` on `interests selected` (members who did the step).
- **Context needed:** 03-event-dictionary.md (`interest_count`), 04-metrics-and-tables.md (retention).
- **Grading:** must compare members who picked interests by how many they picked and call it a null. Wrong: comparing members who picked interests with members who left before the interests screen (those members never reach the suggested-accounts screen, so they follow nobody and retain worse; that is Q3's effect, not the interest count); ranking single counts (for example "7-8 interests retain worst") as a finding.

### Q14 — How fast do new members post?
- **Prompt:** "How long does it take a new member to make their first post? Is it different for creators?"
- **Type:** funnel
- **Answer:** Median time from signup to first post (7-day window, signups Jun 4 - Sep 24): **creators 6.9 hours, businesses 11.7 hours, personal accounts 19.7 hours** (creators ≈ 0.35x personal). 98% of creators who post within a week do it within 24 hours, vs 89% of businesses and 62% of personal accounts. Creators and businesses are also more likely to post at all in the first week (99.1% and 95.1% vs 62.7%). Accept a creator/personal median ratio of 0.3-0.4.
- **Evidence:** H9-creator-first-post; Funnels `account created` → `post created`, 7-day window, median time to convert, breakdown `account_type`; `-- STORY H9` and `-- EVAL Q14`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (time to first post).
- **Grading:** must use medians from signup, by account type. Wrong: means dominated by the long tail; including late-September signups.

### Q15 — Which Circle paywall converts better?
- **Prompt:** "Fans can hit a Circle paywall from a locked post or from the creator's profile. Which one converts better?"
- **Type:** funnel
- **Answer:** **Locked posts convert close to 3x better:** 11.65% of locked-post paywall views end in a subscription (971 of 8,337) vs 4.19% from the profile Join button (460 of 10,976), 2.78x. A Funnels report on uniques with the 1-hour window from 03-event-dictionary.md agrees: 11.58% vs 4.34% (2.67x). The tier mix is similar either way (57-61% Supporter, 29-30% Insider, 10-13% VIP). The profile button gets more paywall traffic but half the subscriptions. Accept 2.5x-3.3x.
- **Evidence:** H10-circle-paywall-trigger; Insights `circle subscription started` / `circle paywall viewed`, breakdown `paywall_trigger`; `-- STORY H10` and `-- EVAL Q15`.
- **Context needed:** 01-business.md (Circle paywall entry points), 03-event-dictionary.md (`paywall_trigger`, Circle join funnel window).
- **Grading:** must compare conversion per paywall view by trigger. A Funnels report with Mixpanel's default 30-day window reads 16.1% vs 9.5% on uniques (about 1.70x), because fans who meet many paywalls subscribe at some point within a month; accept that read if the analyst names the window and still ranks locked posts first. Wrong: comparing subscription counts only.

### Q16 — Is Smart Digest making members less active? (null)
- **Prompt:** "Smart Digest sends fewer notifications. Are those members opening the app less now?"
- **Type:** null-hypothesis
- **Answer:** **No.** From Aug 5, exposed Digest members were active on 7.78 days on average vs 7.84 for Control (z ≈ −0.5) and opened the app 6.38 times vs 6.40 (z ≈ −0.2). The null holds in each sub-split: Android 7.74 vs 7.91 active days (z ≈ −1.0), iOS 7.82 vs 7.78 (z ≈ 0.2), and the Android vs iOS difference in the gap is z ≈ −0.9; members who joined before June 9.68 vs 9.75 (z ≈ −0.5), members who joined in the window 5.79 vs 5.77 (z ≈ 0.1). Opens per push rose (Q4), so members reach the app about as often with fewer pushes. Accept "no meaningful change".
- **Evidence:** H3-smart-digest-experiment (context); `-- EVAL Q16`; Insights, `app opened` (totals per member) and active days, breakdown `Experiment: Smart Digest`, Aug 5 - Oct 1, return events excluding `push notification sent` and `$experiment_started`.
- **Context needed:** 02-timeline.md (Smart Digest), 04-metrics-and-tables.md (active member definition).
- **Grading:** must compare arms on member-initiated activity per exposed member and call it a null. Wrong: counting pushes as activity (Digest members then look less active); reading the small Android gap as a platform effect.

### Q17 — Why did push volume drop in August?
- **Prompt:** "Push notifications sent per day dropped in August even though we have more members. Is something broken?"
- **Type:** context
- **Answer:** Nothing is broken; it is the **Smart Digest test** (started Aug 5). Pushes per day went from 725 (Jul 8 - Aug 4) to 688 (Aug 5 - Sep 1) while active members grew, so pushes per active member-day fell from 0.66 to 0.56 (−15%). The drop is all in the Digest arm, which gets 0.60x the pushes of Control (weekly sends: Control rose from about 2,500-2,650 in late July to 3,000-3,500; Digest fell from about 2,300-2,500 to about 1,700-2,100 within two weeks of the start). About half of Digest pushes are the daily digest summary. Accept naming the experiment and the Digest arm.
- **Evidence:** H3-smart-digest-experiment; Insights `push notification sent`, daily, breakdown `Experiment: Smart Digest`; `-- EVAL Q17` and the weekly table under `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (Smart Digest).
- **Grading:** must tie the drop to the experiment arm. Wrong: "a notification outage"; "members turned off notifications".

### Q18 — Where does ad revenue come from?
- **Prompt:** "Break down September ad revenue by placement. Which placement is worth the most per impression?"
- **Type:** external-join
- **Answer:** September (Sep 1-30) ad revenue from `ad_revenue_daily`: **feed $52.29 (61.4%), Clips $17.62 (20.7%), Stories $15.30 (18.0%)**, about $85 in total. eCPM: feed $5.48, Stories $4.23, Clips $3.42; feed is the most valuable placement per impression. eCPM dropped about 14% on every placement on Sep 9 (feed $6.17 → $5.33, Stories $4.76 → $4.04, Clips $3.84 → $3.33). The ad server counts 4-8% more impressions than Mixpanel `ad viewed` (opted-out members and invalid-traffic filtering). Accept the ranking feed > Stories > Clips on eCPM and feed about 60% of revenue.
- **Evidence:** H8-ad-load-increase (warehouse side); `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`), 01-business.md (placements).
- **Grading:** must use the warehouse for revenue and eCPM. Wrong: estimating revenue from Mixpanel impressions with an assumed price; using all of September 1-October 1.

### Q19 — What should we worry about?
- **Prompt:** "I'm presenting to the board next week. What should we be worried about this quarter?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **New-member retention hinges on onboarding follows.** Only 55% of new members are active on day 14-27. The 35% who follow 0-2 suggested accounts retain at 31.1% vs 80.0% at 7+ (Q3). Improving the suggestions screen is the biggest lever.
  2. **TikTok signups are low-intent.** Only 63% follow any suggestion and 43.5% retain (Q7, Q8), though TikTok is still the cheapest per retained member. Creator partnerships cost 1.30x Meta per signup but about the same per retained member (1.08x).
  3. **Android release quality.** A four-day Android For You outage (Aug 26-29) cut Android For You viewing to 0.42x with a 60% error rate (Q6).
  4. **Ad yield.** More ad slots raised revenue per post view 38% but eCPM fell about 14% on every placement (Q12, Q18); ad revenue is a small network-partner test next to marketing spend ($85 in September vs $3,159 of paid acquisition; 01-business.md).
  5. **Circles economics.** The fee cut lowered Murmur's Circles take per day by about 40% (Q10) without lifting fan conversion (Q5); creators with a Circle did post 1.34x more (Q9).
  6. **Notifications.** Smart Digest lifts open rate 1.63x but opens per member are flat to slightly down (Q4), and app activity is unchanged (Q16).
- **Evidence:** Q3, Q4, Q5, Q6, Q7, Q8, Q10, Q12, Q16, Q18; `-- EVAL Q19` (retention by signup month: June 54.9%, July 55.9%, August 55.1%; the September row covers only Sep 1-3 signups; weekly active members grew from about 3,760 in early June to about 5,500 in late September; per-active-member rates of unfollows, shares, community joins, profile updates, and reports; September ad revenue vs paid spend).
- **Context needed:** all guides.
- **Grading:** must prioritize with evidence and include new-member retention and onboarding. Raw counts of unfollows, shares, reports, community joins, and profile updates rise with the member base. Per 1,000 weekly active members they barely move between the first four full weeks (Jun 8-Jul 5) and the last four (Aug 31-Sep 27): unfollows 25.2 → 27.9, shares 99 → 109 (the late weeks hold the Sound Awards), community joins 32.0 → 32.9, profile updates 18.9 → 18.1, reports 21.3 → 21.8. Members who joined before June 4 show the same picture: unfollows 25.8 → 28.8 per 1,000 weekly actives, which is 347 → 385 unfollows over equal member-weeks (13,469 vs 13,387), z ≈ 1.4. That is within normal week-to-week noise, not a finding; accept an answer that mentions it as "slightly higher, not significant", and penalize one that presents it as a rise in churn signals. Penalize an answer that presents rising unfollows or reports as a behavior change from raw counts without normalizing by active members. Wrong: generic advice without numbers; claiming engagement is falling (weekly active members grew all quarter).

### Q20 — Why do referred members retain better?
- **Prompt:** "Members from creator partnerships and friend invites retain better than paid social. Is it the channel itself, or something else?"
- **Type:** open-ended
- **Answer:** It is **onboarding follows, not the channel itself.** Referred members follow more suggested accounts (about 6.0-6.4 on average vs 2.8-3.8 for Meta, organic, and TikTok). Within the same follow bucket, channels retain about the same: 0-2 follows 27-35%, 3-6 follows 55-62%, 7+ follows 77-84% across all five channels. Predicting each member's retention from their onboarding follows alone reproduces the channel gaps: creator partnerships 63.9% predicted vs 63.9% observed, friend invites 66.1% vs 64.9%, Meta 51.5% vs 53.2%, organic 51.4% vs 52.5%, TikTok 46.1% vs 43.5%. Accept "mediated by onboarding follows" with the within-bucket comparison.
- **Evidence:** H2-onboarding-follows with H5-paid-channel-economics; `-- EVAL Q20`; Retention by `acquisition_channel` with cohorts by onboarding follows.
- **Context needed:** 01-business.md (onboarding, channels), 04-metrics-and-tables.md (retention), 03-event-dictionary.md (onboarding `user followed`).
- **Grading:** must control for onboarding follows. Wrong: "creator-referred members are inherently more loyal" without the within-bucket check.

# Murmur (social) — 20-question eval

- **Data:** `data/verify-social` (full fidelity: 10,000 members, 9,993 with events, 4,970 new signups, 1,160,268 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/social/social.sql` on that data.
- **Stories:** ids refer to the `stories` export in `social.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — How fast is Clips catching on?
- **Prompt:** "We launched Clips in July. How much of what people watch is Clips now, and how fast did that happen?"
- **Type:** trend
- **Answer:** Clips went from nothing to about **35% of post views** in three weeks and then held there. Weekly clip share of `post viewed`: 0% before July 8, 3.2% in the launch week (Jul 6-12, launch on the 8th), 14.5% (week of Jul 13), 26.2% (Jul 20), 34.4% (Jul 27), then 34.4%-35.4% every week through September. From July 29 on, 35.0% of views are Clips. Clips took share from photos (49.7% → 32.6% of views) and text (38.2% → 24.7%); total views kept growing with the member base. Accept 32%-38% after the ramp and a three-week ramp.
- **Evidence:** H1-clips-launch; Insights, `post viewed`, breakdown `post_type`, weekly, % of total; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date).
- **Grading:** must give the plateau share and the ramp timing. Wrong: reading raw clip view counts as growth that keeps going (the share is flat from late July); claiming Clips added views on top (the mix shifted).

### Q2 — Are members making Clips, or just watching?
- **Prompt:** "Are people actually posting Clips, or only watching them? Is it just creators?"
- **Type:** segmentation
- **Answer:** Members post them too. From July 29, **19.7% of new posts are Clips** (5,331 Clips), and the share is about the same for every account type: creators 19.5%, personal 20.0%, business 19.8%. 2,504 members posted at least one Clip from Jul 29 (1,024 creators, 1,309 personal accounts, 171 businesses). Creation lags viewing (about 20% of posts vs 35% of views). Accept 18%-22% and "no difference by account type".
- **Evidence:** H1-clips-launch; Insights, `post created`, breakdown `post_type` and user property `account_type`, from Jul 29; `-- EVAL Q2`.
- **Context needed:** 01-business.md (account types), 03-event-dictionary.md (`post_type`).
- **Grading:** must compare shares, not counts (creators post most of all posts). Wrong: "Clips is a creator-only format" (creators post more of everything).

### Q3 — Is there a magic number in onboarding?
- **Prompt:** "Is there anything in onboarding that predicts whether a new member sticks around? Is there a magic number?"
- **Type:** retention
- **Answer:** Yes: **how many accounts a new member follows on the suggested-accounts screen.** Day 14-27 retention (any member-initiated event; signups Jun 4-Sep 3) by onboarding follows: 0 → 28.3%, 1 → 29.6%, 2 → 32.0%, 3 → 49.0%, 4 → 52.5%, 5 → 72.0%, 6 → 79.8%, 7 → 77.9%, 8 → 82.2%, 9 → 80.9%, 10+ → 79.9%. Grouped: **0-2 follows 29.3%, 3-6 follows 63.6%, 7+ follows 80.0%** (0-2 is 0.37x of 7+). Retention climbs steeply from 3 to 6 follows and flattens from about 6. 21.2% of new members follow nobody there, 35.1% follow 0-2, and the average is 4.3. Overall new-member retention is 55.8%. Accept a threshold around 5-7 follows and 0-2 at 0.32x-0.42x of 7+.
- **Evidence:** H2-onboarding-follows; Retention, birth `account created`, return event = a custom event that combines every member-initiated event (all events except `push notification sent` and `$experiment_started`), custom bracket day 14-27, cohorts by count of `user followed` where `discovery_source = onboarding_suggestions`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (onboarding flow), 03-event-dictionary.md (`discovery_source`), 04-metrics-and-tables.md (retention definition).
- **Grading:** must use onboarding follows (not lifetime follows, which grow with retention itself) and member-initiated activity. Wrong: counting `push notification sent` or `$experiment_started` as a return (both are server-side and keep arriving after members leave; excluding only `push notification sent` reads 0-2 40.5%, 3-6 69.7%, 7+ 83.0%, which blurs the gap to 0.49x); using all follows over the window as the cohort (leaks the outcome).

### Q4 — Should we ship Smart Digest?
- **Prompt:** "We want to ship Smart Digest. What did the test show? Should we roll it out?"
- **Type:** funnel
- **Answer:** Digest members got **0.59x the pushes** (3.38 vs 5.73 per exposed member from Aug 5) and opened each one **1.63x as often** (11.1% vs 6.8% open rate, z ≈ 15). Net, opens per member are about the same, slightly lower (0.376 vs 0.391, 0.96x). App activity did not change: post views per member after the start 26.15 vs 25.75, active days 7.74 vs 7.75 (see Q16). The split is balanced (4,660 Digest vs 4,646 Control). Recommendation: ship if the goal is fewer interruptions at the same engagement; it will not grow engagement. Accept an open-rate ratio of 1.45-1.75 and sends at 0.54-0.66. Sends per member use exposed members as the denominator (Uniques of `$experiment_started`, or members with the profile property). 356 Digest members (7.6%) were exposed but had every post-start push held back, so dividing by Uniques of `push notification sent` gives 3.66 vs 5.73 (0.64x); accept that read if the analyst names the denominator.
- **Evidence:** H3-smart-digest-experiment; Insights, `push notification opened` / `push notification sent` and sends per member, breakdown `Experiment: Smart Digest`, Aug 5 - Oct 1; `-- STORY H3`, `-- EVAL Q4`, and the denominator table under `-- EVAL Q4`, and the arm activity tables under `-- EVAL Q5` and `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (`notification_id`, `daily_digest`), 04-metrics-and-tables.md (push open rate, server-side events).
- **Grading:** must report both the open rate and the send volume and conclude on opens or engagement per member. Wrong: "Digest is a huge win" from open rate alone; counting pushes as activity.

### Q5 — Did Creator Fair Share make fans subscribe more?
- **Prompt:** "Since we cut the Circles fee in August, are fans more likely to subscribe when they hit a paywall?"
- **Type:** context
- **Answer:** **No.** Subscriptions per paywall view were 4.12% before August 12 and 3.71% after (z ≈ −1.5, within noise). The fee change goes to creators; fan prices did not change, so there is no reason for fans to convert more. The splits move both ways: profile button 2.00% → 2.22% (z ≈ 0.8) and Android 3.96% → 4.14% (z ≈ 0.4) went up; locked post 6.87% → 5.66% (z ≈ −2.3) and iOS 4.26% → 3.34% (z ≈ −2.5) went down. The paywall mix did not change (43.6% vs 43.3% locked-post views), and monthly conversion moves both ways too (June to September: locked post 6.7%, 6.9%, 6.0%, 5.8%; profile button 1.4%, 2.4%, 2.2%, 2.2%). More subscriptions per day after the cut (6.07 → 6.69) come from more paywall traffic as the member base grew. Accept "no increase".
- **Evidence:** `-- EVAL Q5`; Insights, `circle subscription started` / `circle paywall viewed`, before vs after Aug 12, breakdown `paywall_trigger` and `platform`.
- **Context needed:** 02-timeline.md (fee change, fan prices unchanged), 01-business.md (Circles).
- **Grading:** must normalize by paywall views and say conversion did not rise. Accept a mention of the small overall dip if the analyst calls it noise or unrelated to the fee (fan prices did not change; the splits disagree in direction). Wrong: "subscriptions rose 10% after the fee cut" from daily counts; "the fee cut drove fans away".

### Q6 — What happened to the Android feed in late August?
- **Prompt:** "Android scrolling looked off at the end of August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **Android For You incident, August 26-29** (timeline; `for_you_feed_health_daily` shows `service_status = major_outage` for android on those four days, `error_rate` ≈ 0.60 vs about 0.006 normally, p95 latency 7.5-10.5 s). In Mixpanel, Android For You views per Following-feed view fell to **0.39x** (0.72 vs 1.87 in the 14 days either side); iOS did not move (1.88 vs 1.85). Android For You views went from about 822-1,291 a day to 402-486; the Following feed on Android was normal. At the baseline ratio, about **2,799 Android For You views** were lost over the four days (the feed service logged 534 failed page requests; a page holds several posts). Back to normal on August 30. Accept 0.35x-0.45x and naming Android and the For You feed.
- **Evidence:** H4-android-for-you-incident; Insights, `post viewed` filtered `feed` in (for_you, following), breakdown `platform` and `feed`, daily, joined to `for_you_feed_health_daily`; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`for_you_feed_health_daily`).
- **Grading:** must name platform, feed, and dates and use a control (iOS or the Following feed). Wrong: "Android members lost interest"; reading total views without the split; comparing to the ad change (Sep 9).

### Q7 — Which paid channel is worth it?
- **Prompt:** "Which paid channel gives us the cheapest members who actually stick around? Are creator partnerships worth the premium?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup (`marketing_spend_daily`): **creator partnerships $5.06, Meta $3.83, TikTok $2.36** (creator ≈ 1.32x Meta). Day 14-27 retention: creator partnerships 64.3%, Meta 52.5%, TikTok 45.6%. So spend per retained member is **$7.87 creator partnerships vs $7.29 Meta (≈ 1.08x)** and **$5.17 TikTok**. Creator partnerships close most of their price gap with Meta through retention, but TikTok is still the cheapest per retained member. Spend: creator $5,441, Meta $4,836, TikTok $2,397. Accept creator/Meta per signup 1.2x-1.45x, per retained member 0.95x-1.16x, and TikTok cheapest on both.
- **Evidence:** H5-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Retention by `acquisition_channel`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, cost per retained member), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and bring in retention. Wrong: using `installs_reported` as the denominator (e.g., Meta claims 1,494 installs vs 1,262 signups); "creator partnerships are the best channel per retained member" (TikTok is cheaper).

### Q8 — Where do new members drop in onboarding?
- **Prompt:** "Where do new members drop in onboarding, and is it worse for some group?"
- **Type:** funnel
- **Answer:** TikTok signups drop most. Share who pick interests: TikTok 87.2% vs 93-96% elsewhere; share who follow at least one suggested account: **TikTok 63.6%** vs Meta 79.0%, organic 79.9%, friend invites 86.1%, creator partnerships 87.0%. Referred members also follow more suggestions: average onboarding follows creator partnerships 5.87 and friend invites 5.60 vs Meta 3.83, organic 3.80, TikTok 2.92 (share following 7+: 43.1%, 41.1% vs 19.1%, 18.2%, 14.0%). Accept TikTok as the weakest at both steps and referred channels as the strongest followers.
- **Evidence:** H5-paid-channel-economics (with H2); Funnels `account created` → `interests selected` → `user followed` (`discovery_source = onboarding_suggestions`), 1-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by channel and look at the suggested-accounts step. Wrong: blaming platform or signup method.

### Q9 — Did creators respond to Creator Fair Share?
- **Prompt:** "We cut the Circles fee on August 12. Are creators posting more because of it?"
- **Type:** trend
- **Answer:** Yes, creators who run a Circle did. Among creators who joined before June 4, Circle creators posted **1.41x** as many posts per day from Aug 22 (after a ramp) as before Aug 12, while creators without a Circle posted 1.03x; the difference-in-differences is **1.37x**. Weekly posts per Circle creator went from about 1.47-1.77 before the cut to 2.06-2.35 from late August (2.72 in the week of the Sound Awards); other creators stayed near 1.44-1.84 (1.96 in the awards week). Accept a relative lift of 1.2x-1.45x with non-Circle creators as the control.
- **Evidence:** H6-creator-fair-share; Insights, `post created`, filter `account_type = creator` and `joined_date` before 2026-06-04, breakdown `circle_enabled`, weekly; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (fee change date), 01-business.md (Circles, `circle_enabled`).
- **Grading:** must use non-Circle creators (or a pre-period) as the control. Wrong: raw before/after posting for all creators (the member base and the Sound Awards lift everyone); including creators who joined during the window.

### Q10 — What did Creator Fair Share cost us?
- **Prompt:** "What did the Circles fee cut cost Murmur, and what did creators gain?"
- **Type:** context
- **Answer:** On new Circle subscriptions (first month at list price: supporter $2.99, insider $5.99, VIP $11.99), Murmur's fee fell from **$5.69 a day** (20% of $1,964 bookings over Jun 4 - Aug 11, 69 days) to **$3.16 a day** (10% of $1,614 over Aug 12 - Oct 1, 51 days), about **−44%**, even though bookings per day rose from $28.46 to $31.64 as subscriptions per day grew (6.07 → 6.69) with paywall traffic. Creators' share rose from $22.77 to $28.48 a day (+25%). Subscriptions per paywall view did not rise (Q5). Renewals are not in Mixpanel, so this covers first-month payments only. Accept a fee-revenue drop of 38%-50% per day.
- **Evidence:** H6-creator-fair-share (context); Insights `circle subscription started` by `circle_tier` with tier prices from 01-business.md; `-- EVAL Q10`.
- **Context needed:** 01-business.md (tier prices, fee), 02-timeline.md (fee dates).
- **Grading:** must apply the fee in force on each side of Aug 12 and normalize per day. Wrong: comparing totals over periods of different length; assuming the fee change raised conversion.

### Q11 — What was the spike on September 12?
- **Prompt:** "Posting spiked on September 12. What was that, and did it bring more people in?"
- **Type:** context
- **Answer:** The **Murmur Sound Awards** livestream (timeline). Posts, comments, shares, and Stories per daily active member were **2.43x** the level of the Saturdays around it (1.55 vs 0.62-0.66 on Aug 22, Sep 5, 19, 26); posts alone were 1,110 vs about 400-460 on the weekdays around it (578 on Sunday, Sep 13). It did not bring more people: DAU was 1,432, in line with nearby days (1,239-1,516), and post views per active member were normal (1.03x). It was a one-day burst of creation by members who were already active. Accept 2.2x-2.8x and "no DAU lift".
- **Evidence:** H7-sound-awards-livestream; Insights, (`post created` + `comment posted` + `post shared` + `story posted`) / active members, daily; `-- STORY H7` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (the event).
- **Grading:** must separate creation from audience size. Wrong: "the awards grew the audience"; attributing it to the ad change (Sep 9).

### Q12 — Did raising ad load pay off?
- **Prompt:** "We raised ad load on September 9. Did it pay off?"
- **Type:** external-join
- **Answer:** Yes, but each slot earns less. Feed and Clips ads per post view rose **1.60x** (0.0706 → 0.1127; Aug 12-Sep 8 vs Sep 9-Oct 1). eCPM fell to **0.86x** (feed + Clips $5.39 → $4.65; every placement about −14%, Stories included: feed −14%, Clips −13%, Stories −15%), so ad revenue per 1,000 post views rose **1.36x** ($0.403 → $0.550). Stories ad load did not change (0.1300 → 0.1288 Stories ads per `story viewed`). Click-through held (1.23% → 1.13% on 138 and 163 clicks). No sign that it hurt viewing: post views per active member-day went 3.37 → 3.35 for all members and 3.44 → 3.46 for members who joined before June; new members (who view a little less per day) grew from 35.3% to 39.9% of active member-days. Accept ads per view 1.45x-1.75x and revenue per view 1.2x-1.5x.
- **Evidence:** H8-ad-load-increase; Insights `ad viewed` (feed, clips) / `post viewed`, joined to `ad_revenue_daily`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (ad change), 04-metrics-and-tables.md (ad load, eCPM, `ad_revenue_daily`).
- **Grading:** must bring in eCPM from the warehouse and normalize by views. Wrong: "revenue rose 60%" (ignores eCPM); "ad load cut engagement" without a views-per-active-member check.

### Q13 — Do members who pick more interests stick around? (null)
- **Prompt:** "New members pick 3 to 8 interests at signup. Do the ones who pick more interests retain better?"
- **Type:** null-hypothesis
- **Answer:** **No.** Among new members who picked interests (signups Jun 4-Sep 3), day 14-27 retention is 56.9% for 5 or more interests and 58.3% for 3-4 (z ≈ −0.8). By count: 3 → 59.6%, 4 → 56.9%, 5 → 56.8%, 6 → 56.8%, 7 → 53.5%, 8 → 60.6% (no trend). The null holds in the obvious sub-splits: Android 57.5% vs 58.1% (z ≈ −0.3), iOS 56.5% vs 58.4% (z ≈ −0.8), referred channels 65.5% vs 68.6% (z ≈ −1.1), other channels 52.2% vs 53.1% (z ≈ −0.5), June signups 56.2% vs 58.4% (z ≈ −0.7), July 57.2% vs 57.6% (z ≈ −0.1), Aug 1-Sep 3 57.2% vs 58.7% (z ≈ −0.5); the Android vs iOS difference in the gap is z ≈ 0.4. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q13`; Retention, birth `account created`, return event = the member-initiated custom event (all events except `push notification sent` and `$experiment_started`), day 14-27, breakdown `interest_count` on `interests selected` (members who did the step).
- **Context needed:** 03-event-dictionary.md (`interest_count`), 04-metrics-and-tables.md (retention).
- **Grading:** must compare members who picked interests by how many they picked and call it a null. Wrong: comparing members who picked interests with members who left before the interests screen (those members never reach the suggested-accounts screen, so they follow nobody and retain worse; that is Q3's effect, not the interest count); ranking single counts (for example "7 interests retain worst") as a finding.

### Q14 — How fast do new members post?
- **Prompt:** "How long does it take a new member to make their first post? Is it different for creators?"
- **Type:** funnel
- **Answer:** Median time from signup to first post (7-day window, signups Jun 4 - Sep 24): **creators 7.0 hours, businesses 11.6 hours, personal accounts 19.5 hours** (creators ≈ 0.36x personal). 97% of creators who post within a week do it within 24 hours, vs 92% of businesses and 62% of personal accounts. Creators and businesses are also more likely to post at all in the first week (98.9% and 97.5% vs 62.6%). Accept a creator/personal median ratio of 0.3-0.4.
- **Evidence:** H9-creator-first-post; Funnels `account created` → `post created`, 7-day window, median time to convert, breakdown `account_type`; `-- STORY H9` and `-- EVAL Q14`.
- **Context needed:** 01-business.md (account types), 04-metrics-and-tables.md (time to first post).
- **Grading:** must use medians from signup, by account type. Wrong: means dominated by the long tail; including late-September signups.

### Q15 — Which Circle paywall converts better?
- **Prompt:** "Fans can hit a Circle paywall from a locked post or from the creator's profile. Which one converts better?"
- **Type:** funnel
- **Answer:** **Locked posts convert about 3x better:** 6.29% of locked-post paywall views end in a subscription (529 of 8,406) vs 2.11% from the profile Join button (231 of 10,953), 2.98x. A Funnels report on uniques with the 1-hour window from 03-event-dictionary.md agrees: 6.53% vs 1.96% (3.33x). The tier mix is similar either way (60-63% Supporter, 27-31% Insider, 9-10% VIP). The profile button gets more paywall traffic but less than half the subscriptions. Accept 2.6x-3.4x.
- **Evidence:** H10-circle-paywall-trigger; Insights `circle subscription started` / `circle paywall viewed`, breakdown `paywall_trigger`; `-- STORY H10` and `-- EVAL Q15`.
- **Context needed:** 01-business.md (Circle paywall entry points), 03-event-dictionary.md (`paywall_trigger`, Circle join funnel window).
- **Grading:** must compare conversion per paywall view by trigger. A Funnels report with Mixpanel's default 30-day window reads 9.1% vs 4.8% on uniques (about 1.89x), because fans who meet many paywalls subscribe at some point within a month; accept that read if the analyst names the window and still ranks locked posts first. Wrong: comparing subscription counts only.

### Q16 — Is Smart Digest making members less active? (null)
- **Prompt:** "Smart Digest sends fewer notifications. Are those members opening the app less now?"
- **Type:** null-hypothesis
- **Answer:** **No.** From Aug 5, exposed Digest members were active on 7.74 days on average vs 7.75 for Control (z ≈ −0.1) and opened the app 6.42 times vs 6.35 (z ≈ 0.5). The null holds in each sub-split: Android 7.80 vs 7.85 active days (z ≈ −0.3), iOS 7.70 vs 7.67 (z ≈ 0.2), and the Android vs iOS difference in the gap is z ≈ −0.3; members who joined before June 9.59 vs 9.50 (z ≈ 0.7), members who joined in the window 5.78 vs 5.85 (z ≈ −0.5). Opens per push rose (Q4), so members reach the app about as often with fewer pushes. Accept "no meaningful change".
- **Evidence:** H3-smart-digest-experiment (context); `-- EVAL Q16`; Insights, `app opened` (totals per member) and active days, breakdown `Experiment: Smart Digest`, Aug 5 - Oct 1; active days count the member-initiated custom event (all events except `push notification sent` and `$experiment_started`).
- **Context needed:** 02-timeline.md (Smart Digest), 04-metrics-and-tables.md (active member definition).
- **Grading:** must compare arms on member-initiated activity per exposed member and call it a null. Wrong: counting pushes as activity (Digest members then look less active); reading a single platform's small gap as a platform effect.

### Q17 — Why did push volume drop in August?
- **Prompt:** "Push notifications sent per day dropped in August even though we have more members. Is something broken?"
- **Type:** context
- **Answer:** Nothing is broken; it is the **Smart Digest test** (started Aug 5). Pushes per day went from 730 (Jul 8 - Aug 4) to 681 (Aug 5 - Sep 1) while active members grew, so pushes per active member-day fell from 0.67 to 0.56 (−16%). The drop is all in the Digest arm, which gets 0.59x the pushes of Control per exposed member (weekly sends: Control rose from about 2,360-2,640 in the weeks of Jul 13-27 to about 3,000-3,500 from mid-August; Digest fell from about 2,460-2,670 to about 1,770-2,120 from the week of Aug 10). About half of Digest pushes are the daily digest summary. Accept naming the experiment and the Digest arm.
- **Evidence:** H3-smart-digest-experiment; Insights `push notification sent`, daily, breakdown `Experiment: Smart Digest`; `-- EVAL Q17` and the weekly table under `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (Smart Digest).
- **Grading:** must tie the drop to the experiment arm. Wrong: "a notification outage"; "members turned off notifications".

### Q18 — Where does ad revenue come from?
- **Prompt:** "Break down September ad revenue by placement. Which placement is worth the most per impression?"
- **Type:** external-join
- **Answer:** September (Sep 1-30) ad revenue from `ad_revenue_daily`: **feed $51.83 (61.2%), Clips $17.01 (20.1%), Stories $15.83 (18.7%)**, about $85 in total. eCPM: feed $5.49, Stories $4.23, Clips $3.42; feed is the most valuable placement per impression. eCPM dropped about 14% on every placement on Sep 9 (feed $6.17 → $5.34, Stories $4.78 → $4.04, Clips $3.85 → $3.33). The ad server counts 4-8% more impressions than Mixpanel `ad viewed` (opted-out members and invalid-traffic filtering). Accept the ranking feed > Stories > Clips on eCPM and feed about 60% of revenue.
- **Evidence:** H8-ad-load-increase (warehouse side); `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (`ad_revenue_daily`), 01-business.md (placements).
- **Grading:** must use the warehouse for revenue and eCPM. Wrong: estimating revenue from Mixpanel impressions with an assumed price; using all of September 1-October 1.

### Q19 — What should we worry about?
- **Prompt:** "I'm presenting to the board next week. What should we be worried about this quarter?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **New-member retention hinges on onboarding follows.** Only 56% of new members are active on day 14-27. The 35% who follow 0-2 suggested accounts retain at 29.3% vs 80.0% at 7+ (Q3). Improving the suggestions screen is the biggest lever.
  2. **TikTok signups are low-intent.** Only 64% follow any suggestion and 45.6% retain (Q7, Q8), though TikTok is still the cheapest per retained member. Creator partnerships cost 1.32x Meta per signup but about the same per retained member (1.08x).
  3. **Android release quality.** A four-day Android For You outage (Aug 26-29) cut Android For You viewing to 0.39x with a 60% error rate (Q6).
  4. **Ad yield.** More ad slots raised revenue per post view 36% but eCPM fell about 14% on every placement (Q12, Q18); ad revenue is a small network-partner test next to marketing spend ($85 in September vs $3,109 of paid acquisition; 01-business.md).
  5. **Circles economics.** The fee cut lowered Murmur's Circles take per day by about 44% (Q10) without lifting fan conversion (Q5); creators with a Circle did post 1.37x more (Q9).
  6. **Notifications.** Smart Digest lifts open rate 1.63x but opens per member are flat to slightly down (0.96x, Q4), and app activity is unchanged (Q16).
- **Evidence:** Q3, Q4, Q5, Q6, Q7, Q8, Q10, Q12, Q16, Q18; `-- EVAL Q19` (retention by signup month: June 55.5%, July 55.5%, August 56.9%; the September row covers only Sep 1-3 signups; weekly active members grew from about 3,820 in early June to about 5,630 in late September; per-active-member rates of unfollows, shares, community joins, profile updates, and reports; September ad revenue vs paid spend).
- **Context needed:** all guides.
- **Grading:** must prioritize with evidence and include new-member retention and onboarding. Raw counts of unfollows, shares, reports, community joins, and profile updates rise with the member base. Per 1,000 weekly active members they barely move between the first four full weeks (Jun 8-Jul 5) and the last four (Aug 31-Sep 27): unfollows 26.9 → 26.2, shares 100.5 → 102.8 (the late weeks hold the Sound Awards), community joins 31.3 → 32.6, profile updates 18.3 → 18.1, reports 22.3 → 20.5. Members who joined before June 4 show the same picture: unfollows 27.5 → 26.0 per 1,000 weekly actives, which is 370 → 349 unfollows over equal member-weeks (13,437 vs 13,420), z ≈ −0.8, within normal week-to-week noise. Penalize an answer that presents rising unfollows or reports as a behavior change from raw counts without normalizing by active members. Wrong: generic advice without numbers; claiming engagement is falling (weekly active members grew all quarter).

### Q20 — Why do referred members retain better?
- **Prompt:** "Members from creator partnerships and friend invites retain better than paid social. Is it the channel itself, or something else?"
- **Type:** open-ended
- **Answer:** It is **onboarding follows, not the channel itself.** Referred members follow more suggested accounts (about 5.6-5.9 on average vs 2.9-3.8 for Meta, organic, and TikTok). Within the same follow bucket, channels retain about the same: 0-2 follows 25-32%, 3-6 follows 60-67%, 7+ follows 74-84% across all five channels, with no channel consistently on top. Predicting each member's retention from their onboarding follows alone reproduces the channel gaps: creator partnerships 65.1% predicted vs 64.3% observed, friend invites 63.9% vs 66.5%, Meta 53.4% vs 52.5%, organic 53.1% vs 54.6%, TikTok 46.7% vs 45.6%. Accept "mediated by onboarding follows" with the within-bucket comparison.
- **Evidence:** H2-onboarding-follows with H5-paid-channel-economics; `-- EVAL Q20`; Retention by `acquisition_channel` with cohorts by onboarding follows.
- **Context needed:** 01-business.md (onboarding, channels), 04-metrics-and-tables.md (retention), 03-event-dictionary.md (onboarding `user followed`).
- **Grading:** must control for onboarding follows. Wrong: "creator-referred members are inherently more loyal" without the within-bucket check.

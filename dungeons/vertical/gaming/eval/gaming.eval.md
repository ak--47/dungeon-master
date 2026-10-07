# Emberfall (gaming) — 20-question eval

- **Data:** `data/verify-gaming` (full fidelity: 10,000 profiles, 9,825 players with events, 4,493 new accounts, 712,581 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/gaming/gaming.sql` on that data.
- **Stories:** ids refer to the `stories` export in `gaming.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Should we ship the Guided tutorial?
- **Prompt:** "We've been testing the new Guided tutorial since early July. Is it better than the classic one? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes. Of new players in the test (accounts from 2026-07-08), **69.4% of Guided players finished the tutorial within 7 days vs 53.9% in Control (1.29x, z ≈ 9.0)**. The split is balanced (1,609 Guided vs 1,580 Control). The lift holds in every channel: TikTok signups 38.1% → 48.7%, all other channels 58.2% → 75.1%. It carries into retention because players who never finish the tutorial rarely come back (under 10% on day 1, none from day 7 on): 19.9% of Guided players launched the game on day 7-13 after signup vs 15.6% in Control (signups through Sep 17). Recommend shipping. Accept a completion lift of 1.18x-1.38x.
- **Evidence:** H1-first-flame-tutorial-test; Funnels `account created` → `tutorial completed`, 7-day window, Jul 8 - Oct 1, breakdown `Experiment: First Flame Tutorial` (or the Experiments report on `$experiment_started`); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start, arms, assignment at signup), 03-event-dictionary.md (`tutorial_version`), 04-metrics-and-tables.md (tutorial completion).
- **Grading:** must compare arms on new players from July 8 with a completion rate and a size. Wrong: including players who joined before July 8; using `tutorial_version = guided` as the treatment group (Control players never have it, but Guided non-finishers do not have it either); counting all players instead of new players.

### Q2 — Do guilds keep new players around?
- **Prompt:** "The community team says guilds keep new players around. For new players who get through the tutorial, does joining a guild in their first few days make them stay? How much does it matter?"
- **Type:** retention
- **Answer:** Yes, strongly. Among new players who finished the tutorial (signups through Sep 3, so the day 14-27 bracket is complete), **34.7% joined a guild within 72 hours of creating their account. 30.0% of them launched the game on day 14-27 vs 14.8% of those who did not (about 0.50x, half the retention)**. The gap is already visible on day 7-13 (35.6% vs 25.8%). The prompt does not fix the window; other reasonable windows give the same answer: first 24 hours 30.2% vs 17.3%, first 7 days 29.9% vs 14.3% (the headline uses 72 hours). Accept a ratio of 0.40-0.65 or "about half / twice" for any window from 1 to 7 days, with the early-guild group retaining better. If the analyst drops the tutorial filter and compares all new players, the result is **30.0% vs 7.4% (0.25x, "about 4x")**, because half of the no-guild group never finished the tutorial (49.7% did); accept 0.2-0.3x for that recipe when the analyst says it includes non-finishers, and give full credit to the finisher-only read.
- **Evidence:** H2-early-guild-retention; Retention, birth `account created`, return `game launched`, custom bracket day 14-27, cohort of tutorial finishers split by funnel converters `account created` → `guild joined` within 72 hours; `-- STORY H2` and `-- EVAL Q2` (the last Q2 query is the all-new-players recipe).
- **Context needed:** 01-business.md (guilds, the community team's belief), 04-metrics-and-tables.md (retention, early guild rate).
- **Grading:** must define "early guild" relative to signup and compare return rates in a bracket that ends inside the data. Partial credit for noting it is observational. Wrong: using the profile `in_guild` (it includes players who joined late, after they had already stayed); presenting the all-new-players ratio (about 0.25x) as the guild effect without saying the no-guild group includes tutorial non-finishers; counting players whose bracket is not complete.

### Q3 — Did the Ashen Warden rebalance work?
- **Prompt:** "We rebalanced the Ashen Warden in patch 4.0.2 because players called it a wall. Did it work?"
- **Type:** trend
- **Answer:** Yes. The Warden's win rate per attempt rose from **30.4% before July 23 to 50.1% after (1.65x)**: weekly rates of 28.8%-32.1% in June and early July, 39.6% in the week of Jul 20 (the patch landed Thursday Jul 23), then 47.2%-54.2% from the week of Jul 27. The other bosses did not move (Gravemaw 71.4% → 71.0%, Hollow Matron 60.1% → 60.1%, Cinder King 42.3% → 41.8%; none significant), so it is the patch, not a change in players. Accept 1.5x-1.85x and "others unchanged".
- **Evidence:** H3-ashen-warden-rebalance; Insights, `boss fight` where `result = victory` ÷ `boss fight`, breakdown `boss_name`, weekly; `-- STORY H3` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (patch date and notes).
- **Grading:** must use win rate per attempt and compare against the other bosses. Wrong: counting unique winners (grows with player count); claiming every boss got easier.

### Q4 — What happened to EU dungeons in mid-September?
- **Prompt:** "Dungeon runs dropped for a few days in mid-September. What happened, and how big was it?"
- **Type:** external-join
- **Answer:** The **EU instance-server incident, September 12-14** (timeline; `server_health_daily` shows `incident_severity = sev1` for EU on those three days, `instance_launch_success_rate` 0.39-0.40 vs about 0.99 normally, uptime 38.9%-49.8%, and `avg_queue_seconds` 1,278-1,355 vs about 280 normally). In Mixpanel, EU `dungeon started` fell to **0.42x** of its normal level relative to NA + APAC (EU/other 0.225 on incident days vs 0.536 in the 14 days either side). That is about **430 EU dungeon runs that never started** (309 started vs about 735 expected). Of EU matchmade queues on those days, only 37.5% ever started, and the ones that did waited much longer: median `dungeon queued` → `dungeon started` 902 s vs 221 s on other days (NA and APAC unchanged at about 180-220 s). NA and APAC were unaffected, and EU recovered on September 15. Accept 0.35x-0.50x and naming the EU region.
- **Evidence:** H4-eu-instance-outage; Insights `dungeon started`, daily, breakdown `server_region`, joined to `server_health_daily`; Funnels `dungeon queued` → `dungeon started` (hold `run_id`), median time to convert, breakdown `server_region`, Sep 12-14 vs other days; `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`server_health_daily`).
- **Grading:** must name EU and the dates and size the drop against a baseline that accounts for the weekly rhythm (other regions or matching weekdays). Wrong: blaming a holiday or the Double XP weekend; reporting the raw daily drop on Sep 14 (a Monday) without a weekday comparison.

### Q5 — Which paid channel has the best CAC?
- **Prompt:** "Which paid channel brings us the cheapest new players? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is cheapest per signup but much less so per real player. Window spend per Mixpanel signup (warehouse `ua_spend_daily`): **TikTok $2.50, Meta $4.51, Google $5.44, YouTube creators $6.96** (TikTok ≈ 0.46x Google). But only **41.4%** of TikTok signups finish the tutorial vs 63.5%-67.4% elsewhere, so **cost per tutorial finisher is $6.05 TikTok vs $7.09 Meta (0.85x)**, $8.06 Google, and $10.54 creators. Spend: creators $5,114, Google $3,507, Meta $3,199, TikTok $2,422 ($14,242 total). Payer counts per channel are too small to rank (14-20 payers each). Accept TikTok per-signup 0.40x-0.50x of Google and TikTok's advantage shrinking to roughly 0.8x-1.0x of Meta per finisher.
- **Evidence:** H5-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `ua_spend_daily.spend_usd`; Funnels onboarding by channel; `-- STORY H5` and `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `installs_reported` (TikTok claims 1,159 installs vs 967 Mixpanel signups); stopping at "TikTok is cheapest"; ranking channels on 14-20 payers.

### Q6 — Where do new players drop in onboarding?
- **Prompt:** "Too many new players never finish onboarding. Where do they drop, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall, **87.4%** of new players create a character, **73.9%** start the tutorial, and **60.2%** finish it within 7 days. The gap is **TikTok**: 80.7% → 60.7% → **41.4%** vs 89.3% → 77.6% → **65.3%** for every other channel (**0.63x** at the last step). TikTok is 21.5% of new accounts (967 of 4,493). The other channels are all between 63.5% and 67.4%. Players who do not finish the tutorial cannot queue or join the arena; under 10% come back on day 1-2 (some restart the tutorial) and none after that. Accept TikTok at 0.55x-0.70x of the other channels.
- **Evidence:** H5-paid-channel-economics; Funnels `account created` → `character created` → `tutorial started` → `tutorial completed`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (tutorial completion).
- **Grading:** must break down by acquisition channel. Wrong: blaming platform or region; reporting only the overall rate; mixing the Guided test lift into a channel story without noting it applies to every channel.

### Q7 — Who waits longest for dungeon queues?
- **Prompt:** "Players keep complaining about dungeon queue times. Who's waiting, and how long?"
- **Type:** funnel
- **Answer:** Damage dealers. The median wait from `dungeon queued` to `dungeon started` is **299 seconds for players who main dps, 121 seconds for healers (0.40x), and 59 seconds for tanks (0.20x)**; 90th percentiles are 652, 259, and 129 seconds. Damage dealers are 67.5% of players (healers 17.7%, tanks 14.8%) while each party needs three of them plus one tank and one healer. Only matchmade runs queue (55% of runs; premade 30%, solo 15%). Accept dps around 5 minutes with healers about 0.35x-0.45x and tanks about 0.17x-0.23x of dps.
- **Evidence:** H6-queue-time-by-role; Funnels `dungeon queued` → `dungeon started`, Totals, hold `run_id` constant, median time to convert, breakdown `main_role` (or event property `role`); `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (party composition), 03-event-dictionary.md (`run_id`, `role`).
- **Grading:** must measure per-run wait and split by role. Wrong: using `avg_queue_seconds` from the warehouse (an average over all roles, about 280 s); unique-player funnels without holding `run_id`.

### Q8 — Do PC players spend differently from mobile players?
- **Prompt:** "Do PC players buy differently from mobile players?"
- **Type:** segmentation
- **Answer:** Yes: PC purchases are bigger. The average Ember pack is **$16.49 on PC vs $9.45 on iOS and $9.09 on Android** (mobile combined $9.31, **PC ≈ 1.77x**). 31% of PC Ember purchases are small packs ($0.99-$4.99) vs about 65% on mobile; 37% of PC purchases are $19.99 or more vs about 15% on mobile. PC also has most of the purchases (2,123 of 3,043 Ember purchases). Accept 1.6x-2.0x.
- **Evidence:** H7-pc-pack-mix-and-store-fees; Insights `purchase completed` where `product_type = embers`, average `price_usd`, breakdown `platform`; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 01-business.md (pack prices), 03-event-dictionary.md (`platform` is per device).
- **Grading:** must compare average purchase value (or pack mix) by platform. Wrong: comparing total revenue only (PC also has more players); mixing the fixed-price Ember Pass and bundle into a "pack size" comparison without saying so.

### Q9 — Which platform makes us the most money after fees?
- **Prompt:** "Which platform actually makes Cinderlight the most money once Apple, Google, and payment fees are paid?"
- **Type:** external-join
- **Answer:** PC, by a wide margin. In `store_revenue_daily` over the window, net revenue is **PC $45,090 (82.8% of net), iOS $5,711 (10.5%), Android $3,654 (6.7%)**. PC is 78.0% of gross but a larger share of net because fees take about 29% of mobile gross vs about 5% of PC gross (fees: PC $2,373 on $49,013 gross; iOS $2,448 on $8,432; Android $1,566 on $5,404). Per Mixpanel Ember purchase, warehouse net is **$16.82 on PC vs $6.99 on mobile (2.4x)**; across all products, $15.72 on PC vs $7.55 iOS and $7.69 Android. Billing runs a little above Mixpanel (for example PC 3,163 billed transactions vs 2,869 Mixpanel purchases) because some purchases never reach Mixpanel. Accept PC at about 79%-86% of net and a per-purchase net ratio of 2.1x-2.8x.
- **Evidence:** H7-pc-pack-mix-and-store-fees; `store_revenue_daily` gross, fees, net by platform joined to Mixpanel `purchase completed` counts; `-- STORY H7` and `-- EVAL Q9`.
- **Context needed:** 01-business.md (platform billing), 04-metrics-and-tables.md (`store_revenue_daily`, net revenue).
- **Grading:** must use the warehouse for fees and net. Wrong: answering from Mixpanel `price_usd` alone (ignores fees and refunds); assuming identical fees on every platform.

### Q10 — Did Season 4 bring players back?
- **Prompt:** "Did the Season 4 launch bring players back, or just sell passes to people who were already playing?"
- **Type:** trend
- **Answer:** It brought players back. Veteran daily active players averaged **432 in the four weeks before launch (Jul 9 - Aug 5) and 545 in the four weeks after the return wave (Aug 13 - Sep 9), 1.26x**; weekly veteran DAU was flat at 421-438 from June to July, then 470 in the launch week and 525-551 from mid-August on. Total DAU went from 505 to 619. 559 veterans who played on two days or fewer in the four weeks before launch played on five or more days in the four weeks after (vs 285 who went the other way). New accounts stayed at 231-276 a week before and after the launch; the lift is veterans. Frostspire Vault, the new dungeon, took 35.3% of runs after launch. Accept a veteran lift of 1.15x-1.40x.
- **Evidence:** H8-season4-brings-veterans-back; Insights `game launched` uniques, daily, cohort "did not do `account created`" (or `member_since` before June 4); `-- STORY H8` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (Season 4 date, email to lapsed veterans), 04-metrics-and-tables.md (veterans, DAU).
- **Grading:** must separate veterans from new players and compare matched windows. Wrong: crediting the lift to new installs; comparing the launch week itself; using total events (the Double XP weekend inflates runs).

### Q11 — Was the Double XP weekend worth it?
- **Prompt:** "Was the Double XP weekend worth running again? Did it bring more players in?"
- **Type:** trend
- **Answer:** It deepened play but did not bring players in. On Fri-Sun Aug 21-23, players ran **1.76 dungeons per active player vs 1.08 on the same Fri-Sun one week before and after (1.63x)**; total runs were 3,825 vs about 2,270 on a comparison weekend, and dungeon XP earned was about 3.4x (10.03M vs about 2.91M). Daily active players barely moved (724 vs 698 average, +3.8%, within normal weekend variation). Worth repeating as an engagement event, not as a reactivation lever. Accept a per-player lift of 1.45x-1.8x and "DAU roughly flat".
- **Evidence:** H9-double-xp-weekend; Insights `dungeon started` (total) ÷ `game launched` (uniques), daily, Aug 14-16 / Aug 21-23 / Aug 28-30; `-- STORY H9` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (event dates, `xp_multiplier`).
- **Grading:** must normalize by active players and compare matching weekdays. Wrong: comparing the weekend to weekdays; claiming it lifted DAU substantially.

### Q12 — Should solo players worry us?
- **Prompt:** "How much harder are dungeons for solo players than for groups?"
- **Type:** segmentation
- **Answer:** Much harder. The clear rate is **40.6% solo, 49.4% with 2 players, 58.1% with 3, 64.4% with 4, and 70.3% for a full party of 5** (solo ≈ 0.58x of a full party). A full premade party clears as often as a matchmade one (70.5% vs 70.2%), so what matters is party size, not queue type. Solo runs are 15% of runs and end in a wipe 44.3% of the time. Accept solo at 0.5x-0.65x of a full party and a steady climb with party size.
- **Evidence:** H10-party-size-clear-rate; Insights `dungeon finished` where `result = cleared` ÷ `dungeon finished`, breakdown `party_size`; `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 01-business.md (queue types), 03-event-dictionary.md (`result`, `party_size`).
- **Grading:** must use a per-run clear rate by party size. Wrong: unique players who cleared at least once (almost everyone); attributing the difference to queue type.

### Q13 — Do mobile players struggle in dungeons?
- **Prompt:** "Mobile players say dungeons are harder on a phone. Do they clear dungeons less often than PC players?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Clear rate is **62.6% on mobile vs 62.4% on PC (z = 0.41, p ≈ 0.68)**; iOS 62.5% and Android 62.8%. Within every party size the gap is small and not significant (|z| ≤ 1.67, p ≥ 0.09; for example solo 40.0% mobile vs 40.9% PC, full party 70.7% vs 70.1%). Party size drives clear rates (Q12), not platform. Accept "no meaningful difference".
- **Evidence:** Insights `dungeon finished` clear rate by `platform`, then by `party_size` and `platform`; `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`platform` per device).
- **Grading:** must say no meaningful difference and back it with rates (and ideally a party-size check). Wrong: inventing a mobile gap; reporting a 0.2-point difference as a finding.

### Q14 — Did patch 4.0.2 make dungeons easier?
- **Prompt:** "Patch 4.0.2 also touched dungeons. Did dungeons get easier after the patch?"
- **Type:** null-hypothesis
- **Answer:** No. The dungeon clear rate was **62.4% before July 23 and 62.5% after (z = 0.33, p ≈ 0.74)**. Within party sizes no change is significant (|z| ≤ 1.94, p ≥ 0.05) and the moves go both ways: solo 41.5% → 40.1%, 2 players 48.0% → 50.3%, 4 players 62.5% → 65.5%, full party 70.3% → 70.2%. The patch notes list a loot-table update for dungeons, not a difficulty change; the only difficulty change was the Ashen Warden (Q3). Accept "no change".
- **Evidence:** Insights `dungeon finished` clear rate before vs from Jul 23, overall and by `party_size`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (patch notes).
- **Grading:** must say no change with numbers. Wrong: assuming the patch eased dungeons because the Warden got easier; reading one party-size split (for example 4-player parties, p ≈ 0.05, one of five splits, with others moving the other way) as a patch effect.

### Q15 — How did the Season 4 Ember Pass sell?
- **Prompt:** "How many players bought the Season 4 Ember Pass, and when?"
- **Type:** context
- **Answer:** **422 players bought it ($4,216 at $9.99)**, about **60% of the 707 payers** active after August 6. Sales are front-loaded: 211 (50.0%) in the first week (Aug 6-12), 282 in the first two weeks (Aug 6-19); by Monday weeks: 148 (week of Aug 3), 114, 65, then 39 down to 3 a week through September. Before launch, 68 players bought the Season 3 pass late (June to mid-July). Accept 390-460 buyers and "about half in the first week".
- **Evidence:** Insights `purchase completed` where `product = Season 4 Ember Pass`, weekly; `-- EVAL Q15`.
- **Context needed:** 01-business.md (Ember Pass, seasons), 02-timeline.md (Season 4 date).
- **Grading:** must give a count and the front-loaded timing. Wrong: counting Season 3 passes as Season 4; using all purchase events.

### Q16 — What drove the August revenue bump?
- **Prompt:** "Revenue jumped in August. What drove it, and is it lasting?"
- **Type:** context
- **Answer:** Season 4. Mixpanel revenue averaged **$417 a day from June 4 to August 5 and $539 a day from August 6 to October 1 (+29%)**. The launch weeks combine the new Ember Pass ($1,479 and $1,139 of pass revenue in the weeks of Aug 3 and Aug 10) with more players: weekly revenue was $2.6k-3.4k in June and July, $4.5k, $4.3k, and $4.3k in the three weeks from Aug 3, and $3.0k-3.9k a week from late August. Without the pass, revenue still rose from $406 to $465 a day, because returning veterans buy Embers and bundles too. Part of the bump lasts (the returning veterans); the pass part fades by September. Accept "Season 4: the pass plus returning players" with numbers.
- **Evidence:** H8-season4-brings-veterans-back (returning veterans); Insights sum of `price_usd` on `purchase completed`, weekly, breakdown `product_type`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (Season 4), 01-business.md (products; no price changes).
- **Grading:** must split the pass from other products and connect the rest to returning players. Wrong: a price change (there was none); Double XP (no purchase effect).

### Q17 — How healthy were our servers this quarter?
- **Prompt:** "Give me a quick read on server health by region this quarter."
- **Type:** external-join
- **Answer:** Healthy except one EU incident. Average daily peak concurrency was **NA 55.0, EU 41.9, APAC 22.7 players** (highest single day NA 84). Uptime averaged 99.9% in NA and APAC; EU averaged 98.5% because of **three sev1 days, September 12-14** (uptime down to 38.9%, instance launch success about 0.40, average queue over 1,270 s). On normal days the average queue wait was about 280 seconds in every region. NA and APAC had no incidents. Accept the EU incident with dates and the regional ranking.
- **Evidence:** H4-eu-instance-outage; `server_health_daily` by region; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (`server_health_daily`), 02-timeline.md (incident).
- **Grading:** must use the warehouse table and name the EU incident. Wrong: reading concurrency as daily players; missing the incident.

### Q18 — How many players pay, and how much?
- **Prompt:** "What share of our players pay, and how much does a payer spend?"
- **Type:** segmentation
- **Answer:** Of 7,820 players with a `game launched` in the window, **761 (9.7%) bought something; ARPPU was $74.82** over the 120 days ($56,940 Mixpanel revenue, 5.4 purchases per payer). Veterans pay far more often and more: **12.5% of veterans paid (ARPPU $80.44, 5.8 purchases)** vs **3.8% of new players (ARPPU $35.47, 2.3 purchases)**. Finance's gross bookings are higher (Q9) because billing includes purchases Mixpanel never received. Accept 8.5%-11% payer share and ARPPU of $68-$80 with the veteran/new split.
- **Evidence:** Insights uniques on `purchase completed` ÷ uniques on `game launched`; sum of `price_usd` ÷ payers; split by `account created` cohort; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (payer, ARPPU, revenue definitions).
- **Grading:** must define the denominator and split new vs veteran. Wrong: dividing by all 10,000 profiles; using warehouse gross as Mixpanel revenue without saying so.

### Q19 — What should we worry about?
- **Prompt:** "What should we be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **New-player loss:** only 60.2% finish the tutorial, and tutorial finishers who do not join a guild early keep half the day 14-27 retention of those who do (14.8% vs 30.0%); shipping Guided (69.4% vs 53.9%) and pushing guild recruitment in the first 72 hours are the levers. (2) **TikTok quality:** 21.5% of new accounts at 41.4% tutorial completion; cheap per signup ($2.50) but $6.05 per finisher vs $7.09 Meta, so its edge is thin. (3) **EU infrastructure:** the September 12-14 incident cost about 430 EU dungeon runs in three days, with 0.40 launch success and queues four times longer; the EU provider is a single point of failure. (4) **Mobile monetization:** mobile is 17.2% of net revenue; mobile players buy smaller packs and fees take about 29% of mobile gross (10.2% of all gross). (5) **Season dependence:** veteran activity rose 1.26x with Season 4 and pass sales were half done in a week; without the next content drop, returning veterans may lapse again. (6) **Queues:** damage dealers wait about 5 minutes vs 1 minute for tanks. Accept any well-supported subset of three or more.
- **Evidence:** H1, H2, H4, H5, H6, H7, H8; `-- EVAL Q19` plus the STORY queries.
- **Context needed:** all guides.
- **Grading:** reward specific, quantified risks tied to the data. Wrong: generic advice without numbers; claiming platform hurts dungeon play (Q13) or that Double XP brought players back (Q11).

### Q20 — How does new-player retention look?
- **Prompt:** "What do day 1, day 7, and day 30 retention look like for new players?"
- **Type:** retention
- **Answer:** For new players who signed up by August 31 (3,333 players), **day 1 retention is 25.0%, day 7 is 7.3%, and day 30 is 1.3%** (a `game launched` in the 24 hours starting N days after signup). It splits sharply by onboarding: **tutorial finishers 35.0% / 12.2% / 2.1%**; players who did not finish the tutorial show 9.9% on day 1 (a return visit, often to restart the tutorial) and 0% on day 7 and day 30. Accept day 1 of about 23%-27% overall (33%-37% for finishers), day 7 of 6%-9%, day 30 of 1%-2%.
- **Evidence:** Retention, birth `account created`, return `game launched`, "on" mode, days 1 / 7 / 30, signups Jun 4 - Aug 31, optionally split by cohort "did `tutorial completed`"; `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (retention definition).
- **Grading:** must give the three points with a clear definition and complete windows. Wrong: unbounded ("on or after") retention presented as day-N; including signups whose day-30 bucket is past the end of the data.

# Emberfall (gaming) — 20-question eval

- **Data:** `data/verify-gaming` (full fidelity: 10,000 profiles, 9,818 players with events, 4,547 new accounts, 684,082 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/gaming/gaming.sql` on that data.
- **Stories:** ids refer to the `stories` export in `gaming.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Should we ship the Guided tutorial?
- **Prompt:** "We've been testing the new Guided tutorial since early July. Is it better than the classic one? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes. Of new players in the test (accounts from 2026-07-08), **69.8% of Guided players finished the tutorial within 7 days vs 53.6% in Control (1.30x, z ≈ 9.5)**. The split is balanced (1,641 Guided vs 1,639 Control). The lift holds in every channel: TikTok signups 37.9% → 47.6%, all other channels 57.8% → 76.3%. Guided players also finish faster: median `tutorial_minutes` 5.2 vs 7.4 minutes (0.70x; the property matches the real time from `tutorial started` to `tutorial completed`). It carries into retention because players who never finish the tutorial rarely come back (10% on day 1, none from day 7 on): 22.3% of Guided players launched the game on day 7-13 after signup vs 16.6% in Control (signups through Sep 17). Recommend shipping. Accept a completion lift of 1.18x-1.38x.
- **Evidence:** H1-first-flame-tutorial-test; Funnels `account created` → `tutorial completed`, 7-day window, Jul 8 - Oct 1, breakdown `Experiment: First Flame Tutorial` (or the Experiments report on `$experiment_started`); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start, arms, assignment at signup), 03-event-dictionary.md (`tutorial_version`), 04-metrics-and-tables.md (tutorial completion).
- **Grading:** must compare arms on new players from July 8 with a completion rate and a size. Wrong: including players who joined before July 8; using `tutorial_version = guided` as the treatment group (Control players never have it, but Guided non-finishers do not have it either); counting all players instead of new players.

### Q2 — Do guilds keep new players around?
- **Prompt:** "The community team says guilds keep new players around. For new players who get through the tutorial, does joining a guild in their first few days make them stay? How much does it matter?"
- **Type:** retention
- **Answer:** Yes, strongly. Among new players who finished the tutorial (signups through Sep 3, so the day 14-27 bracket is complete), **34.9% joined a guild within 72 hours of creating their account. 26.4% of them launched the game on day 14-27 vs 16.5% of those who did not (0.63x; early joiners retain about 1.6x as well)**. The gap is already visible on day 7-13 (37.4% vs 26.8%). The prompt does not fix the window; other reasonable windows give the same answer: first 24 hours 26.9% vs 18.1%, first 7 days 25.9% vs 16.4% (the headline uses 72 hours). Accept a ratio of 0.50-0.75 (early joiners retaining about 1.3x-2x as well) for any window from 1 to 7 days, with the early-guild group retaining better. If the analyst drops the tutorial filter and compares all new players, the result is **26.4% vs 8.1% (0.31x, "about 3x")**, because half of the no-guild group never finished the tutorial (49.1% did); accept 0.25-0.4x for that recipe when the analyst says it includes non-finishers, and give full credit to the finisher-only read.
- **Evidence:** H2-early-guild-retention; Retention, birth `account created`, return `game launched`, custom bracket day 14-27, cohort of tutorial finishers split by funnel converters `account created` → `guild joined` within 72 hours; `-- STORY H2` and `-- EVAL Q2` (the last Q2 query is the all-new-players recipe).
- **Context needed:** 01-business.md (guilds, the community team's belief), 04-metrics-and-tables.md (retention, early guild rate).
- **Grading:** must define "early guild" relative to signup and compare return rates in a bracket that ends inside the data. Partial credit for noting it is observational. Wrong: using the profile `in_guild` (it includes players who joined late, after they had already stayed); presenting the all-new-players ratio (about 0.3x) as the guild effect without saying the no-guild group includes tutorial non-finishers; counting players whose bracket is not complete.

### Q3 — Did the Ashen Warden rebalance work?
- **Prompt:** "We rebalanced the Ashen Warden in patch 4.0.2 because players called it a wall. Did it work?"
- **Type:** trend
- **Answer:** Yes. The Warden's win rate per attempt rose from **31.0% before July 23 to 50.0% after (1.61x)**: weekly rates of 28.6%-33.5% in June and early July, 40.6% in the week of Jul 20 (the patch landed Thursday Jul 23), then 48.0%-53.0% from the week of Jul 27. The other bosses did not move (Gravemaw 71.9% → 71.3%, Hollow Matron 59.7% → 60.1%, Cinder King 41.1% → 41.1%; none significant), so it is the patch, not a change in players. Accept 1.5x-1.85x and "others unchanged".
- **Evidence:** H3-ashen-warden-rebalance; Insights, `boss fight` where `result = victory` ÷ `boss fight`, breakdown `boss_name`, weekly; `-- STORY H3` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (patch date and notes).
- **Grading:** must use win rate per attempt and compare against the other bosses. Wrong: counting unique winners (grows with player count); claiming every boss got easier.

### Q4 — What happened to EU dungeons in mid-September?
- **Prompt:** "Dungeon runs dropped for a few days in mid-September. What happened, and how big was it?"
- **Type:** external-join
- **Answer:** The **EU instance-server incident, September 12-14** (timeline; `server_health_daily` shows `incident_severity = sev1` for EU on those three days, `instance_launch_success_rate` 0.39-0.40 vs about 0.99 normally, uptime 38.9%-49.8%, and `avg_queue_seconds` 1,278-1,355 vs about 280 normally). In Mixpanel, EU `dungeon started` fell to **0.41x** of its normal level relative to NA + APAC (EU/other 0.238 on incident days vs 0.583 in the 14 days either side). That is about **420 EU dungeon runs that never started** (288 started vs about 705 expected). Of EU matchmade queues on those days, only 38% ever started, and the ones that did waited much longer: median `dungeon queued` → `dungeon started` 919 s vs 223 s on other days (NA and APAC unchanged at about 195-217 s). NA and APAC were unaffected, and EU recovered on September 15. Accept 0.35x-0.50x and naming the EU region.
- **Evidence:** H4-eu-instance-outage; Insights `dungeon started`, daily, breakdown `server_region`, joined to `server_health_daily`; Funnels `dungeon queued` → `dungeon started` (hold `run_id`), median time to convert, breakdown `server_region`, Sep 12-14 vs other days; `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`server_health_daily`).
- **Grading:** must name EU and the dates and size the drop against a baseline that accounts for the weekly rhythm (other regions or matching weekdays). Wrong: blaming a holiday or the Double XP weekend; reporting the raw daily drop on Sep 14 (a Monday) without a weekday comparison.

### Q5 — Which paid channel has the best CAC?
- **Prompt:** "Which paid channel brings us the cheapest new players? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is cheapest per signup but much less so per real player. Window spend per Mixpanel signup (warehouse `ua_spend_daily`): **TikTok $2.48, Meta $4.53, Google $5.50, YouTube creators $6.81** (TikTok ≈ 0.45x Google). But only **42.4%** of TikTok signups finish the tutorial vs 63.3%-66.6% elsewhere, so **cost per tutorial finisher is $5.87 TikTok vs $7.03 Meta (0.83x)**, $8.34 Google, and $10.76 creators. Spend: creators $5,228, Google $3,451, Meta $3,165, TikTok $2,434 ($14,279 total). Payer counts per channel are too small to rank (16-21 payers each). Accept TikTok per-signup 0.40x-0.50x of Google and TikTok's advantage shrinking to roughly 0.8x-1.0x of Meta per finisher.
- **Evidence:** H5-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `ua_spend_daily.spend_usd`; Funnels onboarding by channel; `-- STORY H5` and `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `installs_reported` (TikTok claims 1,171 installs vs 980 Mixpanel signups); stopping at "TikTok is cheapest"; ranking channels on 16-21 payers.

### Q6 — Where do new players drop in onboarding?
- **Prompt:** "Too many new players never finish onboarding. Where do they drop, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall, **86.1%** of new players create a character, **72.8%** start the tutorial, and **60.4%** finish it within 7 days. The gap is **TikTok**: 79.3% → 59.0% → **42.4%** vs 88.0% → 76.6% → **65.4%** for every other channel (**0.65x** at the last step). TikTok is 21.6% of new accounts (980 of 4,547). The other channels are all between 63.3% and 66.6%. Players who do not finish the tutorial cannot queue or join the arena; about 10% come back on day 1-2 (some restart the tutorial) and none after that. Accept TikTok at 0.55x-0.70x of the other channels.
- **Evidence:** H5-paid-channel-economics; Funnels `account created` → `character created` → `tutorial started` → `tutorial completed`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (tutorial completion).
- **Grading:** must break down by acquisition channel. Wrong: blaming platform or region; reporting only the overall rate; mixing the Guided test lift into a channel story without noting it applies to every channel.

### Q7 — Who waits longest for dungeon queues?
- **Prompt:** "Players keep complaining about dungeon queue times. Who's waiting, and how long?"
- **Type:** funnel
- **Answer:** Damage dealers. The median wait from `dungeon queued` to `dungeon started` is **300 seconds for players who main dps, 120 seconds for healers (0.40x), and 59 seconds for tanks (0.20x)**; 90th percentiles are 651, 255, and 128 seconds. Damage dealers are 67.5% of players (healers 18.3%, tanks 14.3%) while each party needs three of them plus one tank and one healer. Only matchmade runs queue (55% of runs; premade 30%, solo 15%). Accept dps around 5 minutes with healers about 0.35x-0.45x and tanks about 0.17x-0.23x of dps.
- **Evidence:** H6-queue-time-by-role; Funnels `dungeon queued` → `dungeon started`, Totals, hold `run_id` constant, median time to convert, breakdown `main_role` (or event property `role`); `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (party composition), 03-event-dictionary.md (`run_id`, `role`).
- **Grading:** must measure per-run wait and split by role. Wrong: using `avg_queue_seconds` from the warehouse (an average over all roles, about 280 s); unique-player funnels without holding `run_id`.

### Q8 — Do PC players spend differently from mobile players?
- **Prompt:** "Do PC players buy differently from mobile players?"
- **Type:** segmentation
- **Answer:** Yes: PC purchases are bigger. The average Ember pack is **$15.65 on PC vs $9.25 on iOS and $8.39 on Android** (mobile combined $8.91, **PC ≈ 1.76x**). 33% of PC Ember purchases are small packs ($0.99-$4.99) vs about 65% on mobile; 35% of PC purchases are $19.99 or more vs about 15% on mobile. PC also has most of the purchases (1,906 of 3,185 Ember purchases). Accept 1.6x-2.05x.
- **Evidence:** H7-pc-pack-mix-and-store-fees; Insights `purchase completed` where `product_type = embers`, average `price_usd`, breakdown `platform`; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 01-business.md (pack prices), 03-event-dictionary.md (`platform` is per device).
- **Grading:** must compare average purchase value (or pack mix) by platform. Wrong: comparing total revenue only (PC also has more players); mixing the fixed-price Ember Pass and bundle into a "pack size" comparison without saying so.

### Q9 — Which platform makes us the most money after fees?
- **Prompt:** "Which platform actually makes Cinderlight the most money once Apple, Google, and payment fees are paid?"
- **Type:** external-join
- **Answer:** PC, by a wide margin. In `store_revenue_daily` over the window, net revenue is **PC $38,675 (76.4% of net), iOS $7,554 (14.9%), Android $4,378 (8.7%)**. PC is 70.3% of gross but a larger share of net because fees take about 29% of mobile gross vs about 5% of PC gross (fees: PC $2,036 on $42,038 gross; iOS $3,238 on $11,194; Android $1,876 on $6,597). Per Mixpanel Ember purchase, warehouse net is **$16.04 on PC vs $6.65 on mobile (2.4x)**; across all products, $15.11 on PC vs $7.42 iOS and $6.90 Android. Billing runs a little above Mixpanel (for example PC 2,819 billed transactions vs 2,559 Mixpanel purchases) because some purchases never reach Mixpanel. Accept PC at about 72%-80% of net and a per-purchase net ratio of 2.1x-2.9x.
- **Evidence:** H7-pc-pack-mix-and-store-fees; `store_revenue_daily` gross, fees, net by platform joined to Mixpanel `purchase completed` counts; `-- STORY H7` and `-- EVAL Q9`.
- **Context needed:** 01-business.md (platform billing), 04-metrics-and-tables.md (`store_revenue_daily`, net revenue).
- **Grading:** must use the warehouse for fees and net. Wrong: answering from Mixpanel `price_usd` alone (ignores fees and refunds); assuming identical fees on every platform.

### Q10 — Did Season 4 bring players back?
- **Prompt:** "Did the Season 4 launch bring players back, or just sell passes to people who were already playing?"
- **Type:** trend
- **Answer:** It brought players back. Veteran daily active players averaged **395 in the four weeks before launch (Jul 9 - Aug 5) and 505 in the four weeks after the return wave (Aug 13 - Sep 9), 1.28x**; weekly veteran DAU was flat at 385-405 from June to July, then 417 in the launch week and 486-509 from mid-August on. Total DAU went from 463 to 579. 472 veterans who played on two days or fewer in the four weeks before launch played on five or more days in the four weeks after (vs 217 who went the other way). New accounts stayed at 236-297 a week before and after the launch; the lift is veterans. Frostspire Vault, the new dungeon, took 34.5% of runs after launch. Accept a veteran lift of 1.15x-1.40x.
- **Evidence:** H8-season4-brings-veterans-back; Insights `game launched` uniques, daily, cohort "did not do `account created`" (or `member_since` before June 4); `-- STORY H8` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (Season 4 date, email about the new season), 04-metrics-and-tables.md (veterans, DAU).
- **Grading:** must separate veterans from new players and compare matched windows. Wrong: crediting the lift to new installs; comparing the launch week itself; using total events (the Double XP weekend inflates runs).

### Q11 — Was the Double XP weekend worth it?
- **Prompt:** "Was the Double XP weekend worth running again? Did it bring more players in?"
- **Type:** trend
- **Answer:** It deepened play but did not bring players in. On Fri-Sun Aug 21-23, players ran **1.74 dungeons per active player vs 1.04 on the same Fri-Sun one week before and after (1.66x)**; total runs were 3,376 vs about 2,060 on a comparison weekend, and dungeon XP earned was about 3.4x (8.73M vs about 2.59M). Daily active players did not rise (648 vs 659 average, -1.7%, within normal weekend variation). Worth repeating as an engagement event, not as a reactivation lever. Accept a per-player lift of 1.45x-1.8x and "DAU roughly flat".
- **Evidence:** H9-double-xp-weekend; Insights `dungeon started` (total) ÷ `game launched` (uniques), daily, Aug 14-16 / Aug 21-23 / Aug 28-30; `-- STORY H9` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (event dates, `xp_multiplier`).
- **Grading:** must normalize by active players and compare matching weekdays. Wrong: comparing the weekend to weekdays; claiming it lifted DAU substantially.

### Q12 — Should solo players worry us?
- **Prompt:** "How much harder are dungeons for solo players than for groups?"
- **Type:** segmentation
- **Answer:** Much harder. The clear rate is **39.9% solo, 50.3% with 2 players, 57.8% with 3, 63.9% with 4, and 69.9% for a full party of 5** (solo ≈ 0.57x of a full party). A full premade party clears about as often as a matchmade one (69.4% vs 70.0%), so what matters is party size, not queue type. Solo runs are 15% of runs and end in a wipe 45.3% of the time. Difficulty matters too, at every party size: normal 67.4%, heroic 60.9%, mythic 48.7% overall (solo 42.8% / 39.3% / 32.0%; full party 75.9% / 68.5% / 54.3%). Accept solo at 0.5x-0.65x of a full party and a steady climb with party size.
- **Evidence:** H10-party-size-clear-rate; Insights `dungeon finished` where `result = cleared` ÷ `dungeon finished`, breakdown `party_size`; `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 01-business.md (queue types), 03-event-dictionary.md (`result`, `party_size`).
- **Grading:** must use a per-run clear rate by party size. Credit for noting that harder difficulties clear less often. Wrong: unique players who cleared at least once (almost everyone); attributing the difference to queue type.

### Q13 — Do mobile players struggle in dungeons?
- **Prompt:** "Mobile players say dungeons are harder on a phone. Do they clear dungeons less often than PC players?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Clear rate is **62.1% on mobile vs 62.2% on PC (z = -0.37, p ≈ 0.71)**; iOS 61.9% and Android 62.3%. Within every party size the gap is small and not significant (|z| ≤ 0.49, p ≥ 0.62; for example solo 39.6% mobile vs 40.0% PC, full party 69.9% vs 70.0%). The same holds within each server region (|z| ≤ 0.45) and each difficulty (|z| ≤ 0.82, p ≥ 0.41). Party size and difficulty drive clear rates (Q12), not platform. Accept "no meaningful difference".
- **Evidence:** Insights `dungeon finished` clear rate by `platform`, then by `party_size` and `platform`; `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`platform` per device).
- **Grading:** must say no meaningful difference and back it with rates (and ideally a party-size, region, or difficulty check). Wrong: inventing a mobile gap; reporting a 0.1-0.6 point difference in any split as a finding.

### Q14 — Did patch 4.0.2 make dungeons easier?
- **Prompt:** "Patch 4.0.2 also touched dungeons. Did dungeons get easier after the patch?"
- **Type:** null-hypothesis
- **Answer:** No. The dungeon clear rate was **62.2% before July 23 and 62.1% after (z = -0.32, p ≈ 0.75)**. Within party sizes no change is significant (|z| ≤ 0.31, p ≥ 0.75) and the moves go both ways: solo 39.9% → 39.8%, 2 players 50.3% → 50.3%, 3 players 57.9% → 57.7%, 4 players 63.6% → 64.1%, full party 70.0% → 69.9%. Region, difficulty, and platform splits show the same (|z| ≤ 0.55). With five party-size splits, a single split needs p < 0.01 (Bonferroni) before it counts as a finding; none comes close. The patch notes list a loot-table update for dungeons, not a difficulty change; the only difficulty change was the Ashen Warden (Q3). Accept "no change".
- **Evidence:** Insights `dungeon finished` clear rate before vs from Jul 23, overall and by `party_size`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (patch notes).
- **Grading:** must say no change with numbers. Wrong: assuming the patch eased dungeons because the Warden got easier; reading one party-size split as a patch effect (five splits are tested, so one would need p < 0.01; the largest is |z| = 0.31).

### Q15 — How did the Season 4 Ember Pass sell?
- **Prompt:** "How many players bought the Season 4 Ember Pass, and when?"
- **Type:** context
- **Answer:** **443 players bought it ($4,426 at $9.99)**, about **61% of the 721 payers** active after August 6. Sales are front-loaded: 197 (44.5%) in the first week (Aug 6-12), 298 in the first two weeks (Aug 6-19); by Monday weeks: 144 (week of Aug 3), 132, 66, 39, then 19 down to 8 a week through September. Before launch, 53 players bought the Season 3 pass late (June to mid-July). Accept 400-490 buyers and "close to half in the first week".
- **Evidence:** Insights `purchase completed` where `product = Season 4 Ember Pass`, weekly; `-- EVAL Q15`.
- **Context needed:** 01-business.md (Ember Pass, seasons), 02-timeline.md (Season 4 date).
- **Grading:** must give a count and the front-loaded timing. Wrong: counting Season 3 passes as Season 4; using all purchase events.

### Q16 — What drove the August revenue bump?
- **Prompt:** "Revenue jumped in August. What drove it, and is it lasting?"
- **Type:** context
- **Answer:** Season 4. Mixpanel revenue averaged **$373 a day from June 4 to August 5 and $537 a day from August 6 to October 1 (+44%)**. The launch weeks combine the new Ember Pass ($1,439 and $1,319 of pass revenue in the weeks of Aug 3 and Aug 10) with more players: weekly revenue was $2.3k-2.9k in June and July, $4.3k in each of the two weeks from Aug 3, then $3.2k-3.6k a week from mid-August. Without the pass, revenue still rose from $365 to $459 a day, because returning veterans buy Embers and bundles too. Part of the bump lasts (the returning veterans); the pass part fades by September. Accept "Season 4: the pass plus returning players" with numbers.
- **Evidence:** H8-season4-brings-veterans-back (returning veterans); Insights sum of `price_usd` on `purchase completed`, weekly, breakdown `product_type`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (Season 4), 01-business.md (products; no price changes).
- **Grading:** must split the pass from other products and connect the rest to returning players. Wrong: a price change (there was none); Double XP (no purchase effect).

### Q17 — How healthy were our servers this quarter?
- **Prompt:** "Give me a quick read on server health by region this quarter."
- **Type:** external-join
- **Answer:** Healthy except one EU incident. Average daily peak concurrency was **NA 49.9, EU 39.4, APAC 21.7 players** (highest single day NA 80). Uptime averaged 99.9% in NA and APAC; EU averaged 98.5% because of **three sev1 days, September 12-14** (uptime down to 38.9%, instance launch success about 0.40, average queue over 1,270 s). On normal days the average queue wait was about 280 seconds in every region. NA and APAC had no incidents. Accept the EU incident with dates and the regional ranking.
- **Evidence:** H4-eu-instance-outage; `server_health_daily` by region; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (`server_health_daily`), 02-timeline.md (incident).
- **Grading:** must use the warehouse table and name the EU incident. Wrong: reading concurrency as daily players; missing the incident.

### Q18 — How many players pay, and how much?
- **Prompt:** "What share of our players pay, and how much does a payer spend?"
- **Type:** segmentation
- **Answer:** Of 7,851 players with a `game launched` in the window, **766 (9.8%) bought something; ARPPU was $70.57** over the 120 days ($54,055 Mixpanel revenue, 5.5 purchases per payer). Veterans pay far more often and more: **12.6% of veterans paid (ARPPU $76.89, 6.0 purchases)** vs **4.0% of new players (ARPPU $29.87, 2.5 purchases)**. Finance's gross bookings are higher (Q9) because billing includes purchases Mixpanel never received. Accept 8.5%-11% payer share and ARPPU of $64-$77 with the veteran/new split.
- **Evidence:** Insights uniques on `purchase completed` ÷ uniques on `game launched`; sum of `price_usd` ÷ payers; split by `account created` cohort; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (payer, ARPPU, revenue definitions).
- **Grading:** must define the denominator and split new vs veteran. Wrong: dividing by all 10,000 profiles; using warehouse gross as Mixpanel revenue without saying so.

### Q19 — What should we worry about?
- **Prompt:** "What should we be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **New-player loss:** only 60.4% finish the tutorial, and tutorial finishers who do not join a guild early keep about 0.6x the day 14-27 retention of those who do (16.5% vs 26.4%); shipping Guided (69.8% vs 53.6%) and pushing guild recruitment in the first 72 hours are the levers. (2) **TikTok quality:** 21.6% of new accounts at 42.4% tutorial completion; cheap per signup ($2.48) but $5.87 per finisher vs $7.03 Meta, so its edge is thin. (3) **EU infrastructure:** the September 12-14 incident cost about 420 EU dungeon runs in three days, with 0.40 launch success and queues four to five times longer; the EU provider is a single point of failure. (4) **Mobile monetization:** mobile is 23.6% of net revenue; mobile players buy smaller packs and fees take about 29% of mobile gross (12.0% of all gross). (5) **Season dependence:** veteran activity rose 1.28x with Season 4 and close to half of pass sales came in the first week; without the next content drop, returning veterans may lapse again. (6) **Queues:** damage dealers wait about 5 minutes vs 1 minute for tanks. Accept any well-supported subset of three or more.
- **Evidence:** H1, H2, H4, H5, H6, H7, H8; `-- EVAL Q19` plus the STORY queries.
- **Context needed:** all guides.
- **Grading:** reward specific, quantified risks tied to the data. Wrong: generic advice without numbers; claiming platform hurts dungeon play (Q13) or that Double XP brought players back (Q11).

### Q20 — How does new-player retention look?
- **Prompt:** "What do day 1, day 7, and day 30 retention look like for new players?"
- **Type:** retention
- **Answer:** For new players who signed up by August 31 (3,370 players), **day 1 retention is 25.1%, day 7 is 7.1%, and day 30 is 1.1%** (a `game launched` in the 24 hours starting N days after signup). It splits sharply by onboarding: **tutorial finishers 35.4% / 11.9% / 1.8%**; players who did not finish the tutorial show 10.0% on day 1 (a return visit, often to restart the tutorial) and 0% on day 7 and day 30. Accept day 1 of about 23%-27% overall (33%-38% for finishers), day 7 of 6%-9%, day 30 of 0.7%-1.8%.
- **Evidence:** Retention, birth `account created`, return `game launched`, "on" mode, days 1 / 7 / 30, signups Jun 4 - Aug 31, optionally split by cohort "did `tutorial completed`"; `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (retention definition).
- **Grading:** must give the three points with a clear definition and complete windows. Wrong: unbounded ("on or after") retention presented as day-N; including signups whose day-30 bucket is past the end of the data.

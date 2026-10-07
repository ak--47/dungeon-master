# Emberfall (gaming) — 20-question eval

- **Data:** `data/verify-gaming` (full fidelity: 10,000 profiles, 9,879 players with events, 4,522 new accounts, 1,018,469 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/gaming/gaming.sql` on that data.
- **Stories:** ids refer to the `stories` export in `gaming.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Should we ship the Guided tutorial?
- **Prompt:** "We've been testing the new Guided tutorial since early July. Is it better than the classic one? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes. Of new players in the test (accounts from 2026-07-08), **70.5% of Guided players finished the tutorial within 7 days vs 54.6% in Control (1.29x, z ≈ 9.3)**. The split is balanced (1,640 Guided vs 1,567 Control). The lift holds in every channel: TikTok signups 34.5% → 51.5%, all other channels 60.7% → 75.8%. Guided players also finish faster: median `tutorial_minutes` 5.5 vs 7.9 minutes (0.70x; the property matches the real time from `tutorial started` to `tutorial completed`). It carries into retention because players who never finish the tutorial rarely come back (10.6% on day 1, none from day 7 on): 30.5% of Guided players launched the game on day 7-13 after signup vs 24.2% in Control (signups through Sep 17). Recommend shipping. Accept a completion lift of 1.18x-1.38x.
- **Evidence:** H1-first-flame-tutorial-test; Funnels `account created` → `tutorial completed`, 7-day window, Jul 8 - Oct 1, breakdown `Experiment: First Flame Tutorial` (or the Experiments report on `$experiment_started`); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start, arms, assignment at signup), 03-event-dictionary.md (`tutorial_version`), 04-metrics-and-tables.md (tutorial completion).
- **Grading:** must compare arms on new players from July 8 with a completion rate and a size. Wrong: including players who joined before July 8; using `tutorial_version = guided` as the treatment group (Control players never have it, but Guided non-finishers do not have it either); counting all players instead of new players.

### Q2 — Do guilds keep new players around?
- **Prompt:** "The community team says guilds keep new players around. For new players who get through the tutorial, does joining a guild in their first few days make them stay? How much does it matter?"
- **Type:** retention
- **Answer:** Yes, strongly. Among new players who finished the tutorial (signups through Sep 3, so the day 14-27 bracket is complete), **33.9% joined a guild within 72 hours of creating their account. 45.0% of them launched the game on day 14-27 vs 24.1% of those who did not (0.54x; early joiners retain about 1.9x as well)**. The gap is already visible on day 7-13 (53.0% vs 37.9%). The prompt does not fix the window; other reasonable windows give the same answer: first 24 hours 43.5% vs 28.3%, first 7 days 42.8% vs 24.2% (the headline uses 72 hours). Accept a ratio of 0.50-0.75 (early joiners retaining about 1.3x-2x as well) for any window from 1 to 7 days, with the early-guild group retaining better. If the analyst drops the tutorial filter and compares all new players, the result is **45.0% vs 12.0% (0.27x, "almost 4x")**, because half of the no-guild group never finished the tutorial (49.7% did); accept 0.2-0.35x for that recipe when the analyst says it includes non-finishers, and give full credit to the finisher-only read.
- **Evidence:** H2-early-guild-retention; Retention, birth `account created`, return `game launched`, custom bracket day 14-27, cohort of tutorial finishers split by funnel converters `account created` → `guild joined` within 72 hours; `-- STORY H2` and `-- EVAL Q2` (the last Q2 query is the all-new-players recipe).
- **Context needed:** 01-business.md (guilds, the community team's belief), 04-metrics-and-tables.md (retention, early guild rate).
- **Grading:** must define "early guild" relative to signup and compare return rates in a bracket that ends inside the data. Partial credit for noting it is observational. Wrong: using the profile `in_guild` (it includes players who joined late, after they had already stayed); presenting the all-new-players ratio (about 0.27x) as the guild effect without saying the no-guild group includes tutorial non-finishers; counting players whose bracket is not complete.

### Q3 — Did the Ashen Warden rebalance work?
- **Prompt:** "We rebalanced the Ashen Warden in patch 4.0.2 because players called it a wall. Did it work?"
- **Type:** trend
- **Answer:** Yes. The Warden's win rate per attempt rose from **30.3% before July 23 to 49.7% after (1.64x)**: weekly rates of 29.3%-30.9% in June and early July, 42.8% in the week of Jul 20 (the patch landed Thursday Jul 23), then 48.1%-51.8% from the week of Jul 27. The other bosses did not move (Gravemaw 71.4% → 71.5%, Hollow Matron 60.1% → 60.3%, Cinder King 43.1% → 42.0%; none significant, |z| ≤ 1.32, p ≥ 0.18), so it is the patch, not a change in players. Accept 1.5x-1.85x and "others unchanged".
- **Evidence:** H3-ashen-warden-rebalance; Insights, `boss fight` where `result = victory` ÷ `boss fight`, breakdown `boss_name`, weekly; `-- STORY H3` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (patch date and notes).
- **Grading:** must use win rate per attempt and compare against the other bosses. Wrong: counting unique winners (grows with player count); claiming every boss got easier.

### Q4 — What happened to EU dungeons in mid-September?
- **Prompt:** "Dungeon runs dropped for a few days in mid-September. What happened, and how big was it?"
- **Type:** external-join
- **Answer:** The **EU instance-server incident, September 12-14** (timeline; `server_health_daily` shows `incident_severity = sev1` for EU on those three days, `instance_launch_success_rate` 0.39-0.40 vs about 0.99 normally, uptime 38.9%-49.8%, and `avg_queue_seconds` 1,278-1,355 vs about 280 normally). In Mixpanel, EU `dungeon started` fell to **0.39x** of its normal level relative to NA + APAC (EU/other 0.214 on incident days vs 0.545 in the 14 days either side). That is about **630 EU dungeon runs that never started** (411 started vs about 1,045 expected). Of EU matchmade queues on those days, only 39% ever started, and the ones that did waited much longer: median `dungeon queued` → `dungeon started` 1,047 s vs 220 s on other days (NA and APAC at about 219-234 s on the same days). NA and APAC were unaffected, and EU recovered on September 15. Accept 0.35x-0.50x and naming the EU region.
- **Evidence:** H4-eu-instance-outage; Insights `dungeon started`, daily, breakdown `server_region`, joined to `server_health_daily`; Funnels `dungeon queued` → `dungeon started` (hold `run_id`), median time to convert, breakdown `server_region`, Sep 12-14 vs other days; `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`server_health_daily`).
- **Grading:** must name EU and the dates and size the drop against a baseline that accounts for the weekly rhythm (other regions or matching weekdays). Wrong: blaming a holiday or the Double XP weekend; reporting the raw daily drop on Sep 14 (a Monday) without a weekday comparison.

### Q5 — Which paid channel has the best CAC?
- **Prompt:** "Which paid channel brings us the cheapest new players? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is cheapest per signup but much less so per real player. Window spend per Mixpanel signup (warehouse `ua_spend_daily`): **TikTok $2.47, Meta $4.42, Google $5.51, YouTube creators $6.84** (TikTok ≈ 0.45x Google). But only **40.6%** of TikTok signups finish the tutorial vs 63.8%-67.5% elsewhere, so **cost per tutorial finisher is $6.08 TikTok vs $6.59 Meta (0.92x)**, $8.63 Google, and $10.14 creators. Spend: creators $5,192, Google $3,436, Meta $3,237, TikTok $2,457 ($14,321 total). Payer counts per channel are too small to rank (12-25 payers each). Accept TikTok per-signup 0.40x-0.50x of Google and TikTok's advantage shrinking to roughly 0.8x-1.0x of Meta per finisher.
- **Evidence:** H5-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `ua_spend_daily.spend_usd`; Funnels onboarding by channel; `-- STORY H5` and `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `installs_reported` (TikTok claims 1,186 installs vs 994 Mixpanel signups); stopping at "TikTok is cheapest"; ranking channels on 12-25 payers.

### Q6 — Where do new players drop in onboarding?
- **Prompt:** "Too many new players never finish onboarding. Where do they drop, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall, **86.2%** of new players create a character, **73.5%** start the tutorial, and **60.7%** finish it within 7 days. The gap is **TikTok**: 78.3% → 58.6% → **40.6%** vs 88.4% → 77.7% → **66.3%** for every other channel (**0.61x** at the last step). TikTok is 22.0% of new accounts (994 of 4,522). The other channels are all between 63.8% and 67.5%. Players who do not finish the tutorial cannot queue or join the arena; about 11% come back on day 1-2 (some restart the tutorial) and none after that. Accept TikTok at 0.55x-0.70x of the other channels.
- **Evidence:** H5-paid-channel-economics; Funnels `account created` → `character created` → `tutorial started` → `tutorial completed`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (tutorial completion).
- **Grading:** must break down by acquisition channel. Wrong: blaming platform or region; reporting only the overall rate; mixing the Guided test lift into a channel story without noting it applies to every channel.

### Q7 — Who waits longest for dungeon queues?
- **Prompt:** "Players keep complaining about dungeon queue times. Who's waiting, and how long?"
- **Type:** funnel
- **Answer:** Damage dealers. The median wait from `dungeon queued` to `dungeon started` is **302 seconds for players who main dps, 120 seconds for healers (0.40x), and 60 seconds for tanks (0.20x)**; 90th percentiles are 653, 267, and 131 seconds. Damage dealers are 66.9% of players (healers 18.3%, tanks 14.8%) while each party needs three of them plus one tank and one healer. Only matchmade runs queue (55% of runs; premade 30%, solo 15%). Accept dps around 5 minutes with healers about 0.35x-0.45x and tanks about 0.17x-0.23x of dps.
- **Evidence:** H6-queue-time-by-role; Funnels `dungeon queued` → `dungeon started`, Totals, hold `run_id` constant, median time to convert, breakdown `main_role` (or event property `role`); `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (party composition), 03-event-dictionary.md (`run_id`, `role`).
- **Grading:** must measure per-run wait and split by role. Wrong: using `avg_queue_seconds` from the warehouse (an average over all roles, about 280 s); unique-player funnels without holding `run_id`.

### Q8 — Do PC players spend differently from mobile players?
- **Prompt:** "Do PC players buy differently from mobile players?"
- **Type:** segmentation
- **Answer:** Yes: PC purchases are bigger. The average Ember pack is **$16.44 on PC vs $8.38 on iOS and $8.88 on Android** (mobile combined $8.57, **PC ≈ 1.9x**). 31.2% of PC Ember purchases are small packs ($0.99-$4.99) vs 64.8% on mobile; 36.0% of PC purchases are $19.99 or more vs 13.4% on mobile. Mobile has more Ember purchases (2,372 of 3,762), PC fewer but larger ones. Accept 1.65x-2.15x.
- **Evidence:** H7-pc-pack-mix-and-store-fees; Insights `purchase completed` where `product_type = embers`, average `price_usd`, breakdown `platform`; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 01-business.md (pack prices), 03-event-dictionary.md (`platform` is per device).
- **Grading:** must compare average purchase value (or pack mix) by platform. Wrong: comparing total revenue or purchase counts only (mobile has more purchases); mixing the fixed-price Ember Pass and bundle into a "pack size" comparison without saying so.

### Q9 — Which platform makes us the most money after fees?
- **Prompt:** "Which platform actually makes Cinderlight the most money once Apple, Google, and payment fees are paid?"
- **Type:** external-join
- **Answer:** PC, as the single biggest platform. In `store_revenue_daily` over the window, net revenue is **PC $29,227 (52.9% of net), iOS $15,738 (28.5%), Android $10,330 (18.7%)**; mobile combined is 47.1%. PC is 50.3% of gross but a larger share of net because fees take about 15% of mobile gross vs about 5% of PC gross (fees: PC $1,538 on $31,934 gross; iOS $2,778 on $19,083; Android $1,823 on $12,535). PC earns more per purchase: per Mixpanel Ember purchase, warehouse net is **$16.55 on PC vs $7.72 on mobile (2.1x)**; across all products, $15.65 on PC vs $8.44 iOS and $8.80 Android. Mobile makes up the gap with volume (3,038 Mixpanel purchases vs 1,868 on PC). Billing runs a little above Mixpanel (for example PC 2,055 billed transactions vs 1,868 Mixpanel purchases) because some purchases never reach Mixpanel; refunds are 3.0%-3.7% of gross on every platform. Accept PC at about 48%-57% of net (largest platform, mobile combined close behind) and a per-purchase net ratio of 2.0x-2.5x.
- **Evidence:** H7-pc-pack-mix-and-store-fees; `store_revenue_daily` gross, fees, net by platform joined to Mixpanel `purchase completed` counts; `-- STORY H7` and `-- EVAL Q9`.
- **Context needed:** 01-business.md (platform billing), 04-metrics-and-tables.md (`store_revenue_daily`, net revenue).
- **Grading:** must use the warehouse for fees and net. Wrong: answering from Mixpanel `price_usd` alone (ignores fees and refunds); assuming identical fees on every platform; assuming the standard 30% app store fee (Cinderlight pays 15%).

### Q10 — Did Season 4 bring players back?
- **Prompt:** "Did the Season 4 launch bring players back, or just sell passes to people who were already playing?"
- **Type:** trend
- **Answer:** It brought players back. Veteran daily active players averaged **520 in the four weeks before launch (Jul 9 - Aug 5) and 670.5 in the four weeks after the return wave (Aug 13 - Sep 9), 1.29x**; weekly veteran DAU was flat at 510-537 from June to July, then 556 in the launch week and 648-675 from mid-August on. Total DAU went from 619 to 796. 694 veterans who played on two days or fewer in the four weeks before launch played on five or more days in the four weeks after (vs 244 who went the other way). New accounts stayed at 235-292 a week before and after the launch; the lift is veterans. Frostspire Vault, the new dungeon, took 34.7% of runs after launch. Accept a veteran lift of 1.15x-1.40x.
- **Evidence:** H8-season4-brings-veterans-back; Insights `game launched` uniques, daily, cohort "did not do `account created`" (or `member_since` before June 4); `-- STORY H8` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (Season 4 date, email about the new season), 04-metrics-and-tables.md (veterans, DAU).
- **Grading:** must separate veterans from new players and compare matched windows. Wrong: crediting the lift to new installs; comparing the launch week itself; using total events (the Double XP weekend inflates runs).

### Q11 — Was the Double XP weekend worth it?
- **Prompt:** "Was the Double XP weekend worth running again? Did it bring more players in?"
- **Type:** trend
- **Answer:** It deepened play but did not bring players in. On Fri-Sun Aug 21-23, players ran **1.96 dungeons per active player vs 1.20 on the same Fri-Sun one week before and after (1.63x)**; total runs were 5,510 vs about 3,265 on a comparison weekend, and dungeon XP earned was about 3.4x (13.8M vs about 4.10M). Daily active players barely moved (937 vs 905 average, +3.6%, within normal weekend variation). Worth repeating as an engagement event, not as a reactivation lever. Accept a per-player lift of 1.45x-1.8x and "DAU roughly flat".
- **Evidence:** H9-double-xp-weekend; Insights `dungeon started` (total) ÷ `game launched` (uniques), daily, Aug 14-16 / Aug 21-23 / Aug 28-30; `-- STORY H9` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (event dates, `xp_multiplier`).
- **Grading:** must normalize by active players and compare matching weekdays. Wrong: comparing the weekend to weekdays; claiming it lifted DAU substantially.

### Q12 — Should solo players worry us?
- **Prompt:** "How much harder are dungeons for solo players than for groups?"
- **Type:** segmentation
- **Answer:** Much harder. The clear rate is **40.1% solo, 50.1% with 2 players, 58.0% with 3, 64.1% with 4, and 69.8% for a full party of 5** (solo ≈ 0.57x of a full party). A full premade party clears about as often as a matchmade one (69.0% vs 69.9%), so what matters is party size, not queue type. Solo runs are 15% of runs and end in a wipe 44.7% of the time. Difficulty matters too, at every party size: normal 67.6%, heroic 60.6%, mythic 48.9% overall (solo 43.4% / 39.4% / 31.2%; full party 75.8% / 68.1% / 54.7%). Accept solo at 0.5x-0.65x of a full party and a steady climb with party size.
- **Evidence:** H10-party-size-clear-rate; Insights `dungeon finished` where `result = cleared` ÷ `dungeon finished`, breakdown `party_size`; `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 01-business.md (queue types), 03-event-dictionary.md (`result`, `party_size`).
- **Grading:** must use a per-run clear rate by party size. Credit for noting that harder difficulties clear less often. Wrong: unique players who cleared at least once (almost everyone); attributing the difference to queue type.

### Q13 — Do mobile players struggle in dungeons?
- **Prompt:** "Mobile players say dungeons are harder on a phone. Do they clear dungeons less often than PC players?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Clear rate is **62.16% on mobile vs 62.27% on PC (z = -0.36, p ≈ 0.72)**; iOS 62.0% and Android 62.4%. Within party sizes no gap is significant: the largest is 3-player runs (57.7% mobile vs 58.5% PC, z = -0.70, p ≈ 0.48), and with five party-size splits a single split would need p < 0.01 (Bonferroni) to count; the others are |z| ≤ 0.24 (for example solo 40.0% vs 40.2%, full party 69.8% vs 69.8%). The same holds within each server region (|z| ≤ 0.66) and each difficulty (|z| ≤ 0.58). Party size and difficulty drive clear rates (Q12), not platform. Accept "no meaningful difference".
- **Evidence:** Insights `dungeon finished` clear rate by `platform`, then by `party_size` and `platform`; `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`platform` per device).
- **Grading:** must say no meaningful difference and back it with rates (and ideally a party-size, region, or difficulty check). Wrong: inventing a mobile gap; reporting the 3-player split (0.7 points, p ≈ 0.48) or any other split as a finding.

### Q14 — Did patch 4.0.2 make dungeons easier?
- **Prompt:** "Patch 4.0.2 also touched dungeons. Did dungeons get easier after the patch?"
- **Type:** null-hypothesis
- **Answer:** No. The dungeon clear rate was **62.15% before July 23 and 62.24% after (z = 0.27, p ≈ 0.79)**. Within party sizes no change is significant (|z| ≤ 1.21, p ≥ 0.23) and the moves go both ways: solo 40.5% → 39.9%, 2 players 49.2% → 50.6%, 3 players 58.0% → 58.1%, 4 players 64.0% → 64.1%, full party 69.7% → 69.8%. Region, difficulty, and platform splits show the same (|z| ≤ 0.55). With five party-size splits, a single split needs p < 0.01 (Bonferroni) before it counts as a finding; none comes close. The patch notes list a loot-table update for dungeons, not a difficulty change; the only difficulty change was the Ashen Warden (Q3). Accept "no change".
- **Evidence:** Insights `dungeon finished` clear rate before vs from Jul 23, overall and by `party_size`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (patch notes).
- **Grading:** must say no change with numbers. Wrong: assuming the patch eased dungeons because the Warden got easier; reading one party-size split as a patch effect (five splits are tested, so one would need p < 0.01; the largest is the 2-player split at |z| = 1.21, p ≈ 0.23).

### Q15 — How did the Season 4 Ember Pass sell?
- **Prompt:** "How many players bought the Season 4 Ember Pass, and when?"
- **Type:** context
- **Answer:** **397 players bought it ($3,966 at $9.99)**, about **57% of the 692 payers** active after August 6. Sales are front-loaded: 200 (50.4%) in the first week (Aug 6-12), 304 in the first two weeks (Aug 6-19); by Monday weeks: 141 (week of Aug 3), 136, 55, 24, 18, then 10 or fewer a week through September. Before launch, 74 players bought the Season 3 pass late (June to mid-July). Accept 360-440 buyers and "about half in the first week".
- **Evidence:** Insights `purchase completed` where `product = Season 4 Ember Pass`, weekly; `-- EVAL Q15`.
- **Context needed:** 01-business.md (Ember Pass, seasons), 02-timeline.md (Season 4 date).
- **Grading:** must give a count and the front-loaded timing. Wrong: counting Season 3 passes as Season 4; using all purchase events.

### Q16 — What drove the August revenue bump?
- **Prompt:** "Revenue jumped in August. What drove it, and is it lasting?"
- **Type:** context
- **Answer:** Season 4. Mixpanel revenue averaged **$395 a day from June 4 to August 5 and $581 a day from August 6 to October 1 (+47%)**. The launch weeks combine the new Ember Pass ($1,409 and $1,359 of pass revenue in the weeks of Aug 3 and Aug 10) with more players: weekly revenue was $2.2k-3.1k in June and July, $4.6k and $4.8k in the two weeks from Aug 3, then $3.5k-4.5k a week from mid-August. Without the pass, revenue still rose from $383 to $511 a day (+34%), because returning veterans buy Embers and bundles too. Part of the bump lasts (the returning veterans); the pass part fades by September. Accept "Season 4: the pass plus returning players" with numbers.
- **Evidence:** H8-season4-brings-veterans-back (returning veterans); Insights sum of `price_usd` on `purchase completed`, weekly, breakdown `product_type`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (Season 4), 01-business.md (products; no price changes).
- **Grading:** must split the pass from other products and connect the rest to returning players. Wrong: a price change (there was none); Double XP (no purchase effect).

### Q17 — How healthy were our servers this quarter?
- **Prompt:** "Give me a quick read on server health by region this quarter."
- **Type:** external-join
- **Answer:** Healthy except one EU incident. Average daily peak concurrency was **NA 67.3, EU 54.2, APAC 30.2 players** (highest single day NA 103). Uptime averaged 99.9% in NA and APAC; EU averaged 98.5% because of **three sev1 days, September 12-14** (uptime down to 38.9%, instance launch success about 0.40, average queue over 1,270 s). On normal days the average queue wait was about 280 seconds in every region. NA and APAC had no incidents. Accept the EU incident with dates and the regional ranking.
- **Evidence:** H4-eu-instance-outage; `server_health_daily` by region; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (`server_health_daily`), 02-timeline.md (incident).
- **Grading:** must use the warehouse table and name the EU incident. Wrong: reading concurrency as daily players; missing the incident.

### Q18 — How many players pay, and how much?
- **Prompt:** "What share of our players pay, and how much does a payer spend?"
- **Type:** segmentation
- **Answer:** Of 8,130 players with a `game launched` in the window, **728 (9.0%) bought something; ARPPU was $79.63** over the 120 days ($57,970 Mixpanel revenue, 6.7 purchases per payer). Veterans pay far more often and more: **11.5% of veterans paid (ARPPU $87.54, 7.3 purchases)** vs **4.0% of new players (ARPPU $36.12, 3.4 purchases)**. Finance's gross bookings are higher (Q9) because billing includes purchases Mixpanel never received. Accept 8%-10% payer share and ARPPU of $70-$86 with the veteran/new split.
- **Evidence:** Insights uniques on `purchase completed` ÷ uniques on `game launched`; sum of `price_usd` ÷ payers; split by `account created` cohort; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (payer, ARPPU, revenue definitions).
- **Grading:** must define the denominator and split new vs veteran. Wrong: dividing by all 10,000 profiles; using warehouse gross as Mixpanel revenue without saying so.

### Q19 — What should we worry about?
- **Prompt:** "What should we be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **New-player loss:** only 60.7% finish the tutorial, and tutorial finishers who do not join a guild early keep about 0.54x the day 14-27 retention of those who do (24.1% vs 45.0%); shipping Guided (70.5% vs 54.6%) and pushing guild recruitment in the first 72 hours are the levers. (2) **TikTok quality:** 22.0% of new accounts at 40.6% tutorial completion; cheap per signup ($2.47) but $6.08 per finisher vs $6.59 Meta, so its edge is thin. (3) **EU infrastructure:** the September 12-14 incident cost about 630 EU dungeon runs in three days, with 0.40 launch success and queues about five times longer; the EU provider is a single point of failure. (4) **Mobile monetization:** mobile is 47.1% of net revenue from 62% of Mixpanel purchases; mobile players buy smaller packs (net per Ember purchase $7.72 vs $16.55 on PC), and the 15% store fee depends on staying in the small-business programs (9.7% of all gross goes to fees). (5) **Season dependence:** veteran activity rose 1.29x with Season 4 and half of pass sales came in the first week; without the next content drop, returning veterans may lapse again. (6) **Queues:** damage dealers wait about 5 minutes vs 1 minute for tanks. Accept any well-supported subset of three or more.
- **Evidence:** H1, H2, H4, H5, H6, H7, H8; `-- EVAL Q19` plus the STORY queries.
- **Context needed:** all guides.
- **Grading:** reward specific, quantified risks tied to the data. Wrong: generic advice without numbers; claiming platform hurts dungeon play (Q13) or that Double XP brought players back (Q11).

### Q20 — How does new-player retention look?
- **Prompt:** "What do day 1, day 7, and day 30 retention look like for new players?"
- **Type:** retention
- **Answer:** For new players who signed up by August 31 (3,364 players), **day 1 retention is 30.1%, day 7 is 11.2%, and day 30 is 3.4%** (a `game launched` in the 24 hours starting N days after signup). It splits sharply by onboarding: **tutorial finishers 43.2% / 18.7% / 5.6%**; players who did not finish the tutorial show 10.6% on day 1 (a return visit, often to restart the tutorial) and 0% on day 7 and day 30. Accept day 1 of about 27%-33% overall (40%-46% for finishers), day 7 of 9.5%-13%, day 30 of 2.5%-4.5%.
- **Evidence:** Retention, birth `account created`, return `game launched`, "on" mode, days 1 / 7 / 30, signups Jun 4 - Aug 31, optionally split by cohort "did `tutorial completed`"; `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (retention definition).
- **Grading:** must give the three points with a clear definition and complete windows. Wrong: unbounded ("on or after") retention presented as day-N; including signups whose day-30 bucket is past the end of the data.

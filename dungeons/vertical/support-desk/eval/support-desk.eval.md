# Ticketloop (support-desk) — 20-question eval

- **Data:** `data/verify-support-desk` (full fidelity: 10,000 users, 9,995 with events, 4,568 trial signups, 872,191 events, 100,548 tickets assigned, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/support-desk/support-desk.sql` on that data.
- **Stories:** ids refer to the `stories` export in `support-desk.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Is Reply Assist making agents faster?
- **Prompt:** "We launched Reply Assist in July. Is it actually making our agents reply faster? By how much?"
- **Type:** trend
- **Answer:** Yes. On Growth and Enterprise tickets assigned from 2026-07-21 to Sep 24, a first reply written from an AI draft came a median **53.1 minutes** after assignment vs **106.4 minutes** for typed or macro first replies: about **0.50x** the time (10,470 vs 20,437 tickets). A plain before/after on Growth and Enterprise (123.4 min before launch → 80.4 min from Aug 11) overstates Reply Assist alone: Starter, which never had it, also fell (124.2 → 105.8 min) because the Skills Routing test started on Jul 8 and cut first-reply time on every plan. Against Starter, the plan-level drop attributable to Reply Assist is about 0.76x, consistent with about 40% of eligible first replies using drafts at half the time. Accept a per-ticket ratio of 0.42-0.58.
- **Evidence:** H1-reply-assist-launch; Funnels, `ticket assigned` → `reply sent`, Totals, hold `ticket_id` constant, 7-day window, filter step-1 `plan_tier` in (growth, enterprise), Jul 21 - Sep 24, breakdown `reply_method`, median time to convert; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, eligible plans, Skills Routing start), 03-event-dictionary.md (`reply_method`), 04-metrics-and-tables.md (FRT definition).
- **Grading:** must compare AI-drafted vs other first replies per ticket (or control for the Skills Routing test) and give the size. Wrong: crediting the whole before/after drop to Reply Assist; including Starter, Free, or trial tickets in the eligible group; unique-user funnels.

### Q2 — How many agents use Reply Assist?
- **Prompt:** "How widely has Reply Assist been adopted? Is usage still growing?"
- **Type:** context
- **Answer:** About **40%** of first replies on Growth and Enterprise tickets are AI drafts once the rollout settled (40.1% of eligible tickets assigned from Aug 11). Weekly share: 0% (week of Jul 13), 4.3% (launch week of Jul 20), 17.2%, 30.0%, 39.0% (week of Aug 10), then flat at 39.5%-40.9% through September. **1,841 of 3,721 agents** (49.5%) who replied on Growth or Enterprise tickets since Aug 11 used it at least once. Adoption ramped for three weeks and then plateaued; it is not still growing. Accept 36%-44% of eligible first replies and about half of eligible agents.
- **Evidence:** H1-reply-assist-launch (adoption); Insights, `reply sent` filtered `is_first_reply = true` and `plan_tier` in (growth, enterprise), share with `reply_method = ai_draft`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (three-week in-app prompts, eligible plans), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator must be eligible plans after launch. Wrong: share of all replies on every plan (Starter, Free, and trial cannot use it); "adoption keeps growing".

### Q3 — How long do tickets take to resolve by priority?
- **Prompt:** "How long does it take us to resolve tickets, and does priority actually make a difference?"
- **Type:** funnel
- **Answer:** Median time from assignment to resolution (14-day window, tickets through Sep 17): **urgent 6.1 h, high 12.0 h, normal 20.3 h, low 30.0 h** — about 0.30x, 0.59x, 1.0x, and 1.48x of normal. First replies follow the same order (median 34, 72, 119, and 177 minutes). Priority scales the whole ticket, not only the first reply. Accept urgent 0.27-0.33x and low 1.35-1.65x of normal.
- **Evidence:** H2-resolution-time-by-priority; Funnels, `ticket assigned` → `ticket resolved`, Totals, hold `ticket_id` constant, 14-day window, breakdown `priority`, median time to convert (or Insights median `resolution_mins` by `priority`); `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 03-event-dictionary.md (`priority`, `resolution_mins`), 04-metrics-and-tables.md (resolution time).
- **Grading:** must use per-ticket medians by priority. Wrong: averages dominated by a few slow tickets; unique-user funnels; including tickets assigned in the last two weeks.

### Q4 — Where do trials stall in setup?
- **Prompt:** "Why do so many trials never finish setup? Where do they drop, and is it worse for some customers?"
- **Type:** funnel
- **Answer:** Overall **57.7%** of trial signups finish setup (inbox connected and widget installed) within 7 days; **72.3%** connect their inbox. The gap is **Microsoft 365**: only **48.9%** of Microsoft 365 companies connect their inbox vs **85.5%** (Google Workspace) and **86.9%** (other hosts), so full setup is **38.2% vs 68.9% / 69.5%** (about **0.55x**). The widget step does not differ by provider (about 80% of inbox connectors install it). Microsoft 365 is about 37% of signups (1,581 of 4,313 with a full window). Trials that never connect an inbox leave within a few days. Accept 0.49-0.61x for Microsoft 365 vs the rest, with the loss at the inbox step.
- **Evidence:** H3-microsoft-365-onboarding; Funnels, `account created` → `inbox connected` → `widget installed`, 7-day window, breakdown `email_provider`; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 01-business.md (setup steps), 03-event-dictionary.md (`email_provider`), 04-metrics-and-tables.md (setup completion).
- **Grading:** must name Microsoft 365 and the inbox step. Wrong: "widget installs are the problem"; blaming acquisition channel; counting signups from the last week (incomplete window).

### Q5 — Which paid channel is worth its cost?
- **Prompt:** "Which paid channel gives us the cheapest new customers? Is Capterra as cheap as it looks?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel trial signup (warehouse `paid_marketing_daily` over the window): **Capterra $40.06, Google Ads $80.54, LinkedIn Ads $243.80**. Paid within 30 days: **Capterra 16.3%, Google 24.3%, LinkedIn 43.3%** (Capterra 0.38x LinkedIn). So the gap narrows a lot per paying workspace: about **$246 Capterra, $331 Google, $563 LinkedIn** (spend ÷ signups × 30-day paid rate), or $276 / $361 / $638 using workspaces that bought in the window. Capterra is still the cheapest per paying workspace, and LinkedIn falls from 6.1x Capterra per signup to about 2.3x per paying workspace. Window spend: LinkedIn $128,972, Google $79,012, Capterra $32,569. Accept Capterra/Google per-signup cost 0.45-0.55 and Capterra/LinkedIn paid rate 0.33-0.45.
- **Evidence:** H4-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels `account created` → `subscription started`, 30-day window, signups Jun 4 - Sep 1, breakdown `acquisition_channel`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup to paying workspaces. Wrong: using `signups_reported` as the denominator (platforms over-claim: 928 / 1,147 / 610 vs 813 / 981 / 529 in Mixpanel); stopping at "Capterra is half the price of Google".

### Q6 — Should we ship Skills Routing?
- **Prompt:** "Is the Skills Routing test working? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. For tickets assigned from 2026-07-08, Skills Routing users' median first reply was **80.4 minutes vs 114.9** in Control (**0.70x**), and their **reopen rate was 7.3% vs 12.0%** (**0.60x**). Positive CSAT is a little higher (82.2% vs 79.4%), consistent with faster replies. Escalations did not change (7.39% vs 7.47%) and the share resolved within 14 days is the same (92.8% in both). The split is balanced (4,059 vs 4,106 exposed users); before the test both groups reopened about 12% of tickets. Recommend shipping. Accept a first-reply ratio of 0.63-0.77 and a reopen ratio of 0.53-0.66.
- **Evidence:** H5-skills-routing-experiment; Funnels, `ticket assigned` → `reply sent`, Totals, hold `ticket_id` constant, 7-day window, from Jul 8, breakdown `Experiment: Skills Routing`, median time to convert; Insights `ticket reopened` / `ticket resolved` by the same breakdown; `-- STORY H5`, `-- EVAL Q6`, and `-- EVAL Q18`.
- **Context needed:** 02-timeline.md (start date, arms), 03-event-dictionary.md (`$experiment_started`, ticket events).
- **Grading:** must compare arms per ticket after the start and report both speed and reopens. Wrong: including tickets before Jul 8; comparing exposed vs unexposed users; claiming escalations fell.

### Q7 — What happened to email tickets in late August?
- **Prompt:** "Our email ticket counts looked strange at the end of August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The email ingestion incident (2026-08-26 and 08-27; warehouse `inbound_channel_daily` shows `ingestion_status = degraded` for email on exactly those two days). Email tickets assigned fell to **164 and 159** a day while other channels were normal: the email-to-other ratio was **0.242 vs 0.824** in the surrounding weeks (**0.29x**, about **70%** of email held back), roughly **780 email tickets** missing across the two days (395 and 382). They arrived on **Aug 28** when the fix went live: **1,261 email tickets** that day, about 771 above normal. The warehouse shows **412 and 346** messages delayed over an hour and p95 ingest latency of **7.3 h and 14.3 h** (normally under a minute). Chat, web form, and API were unaffected. Accept 0.25-0.35 for the email ratio (60%-75% held back) and the Aug 28 backlog.
- **Evidence:** H6-email-ingestion-incident; Insights `ticket assigned`, daily, breakdown `channel`, joined to `inbound_channel_daily.ingestion_status`; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (incident dates, fix time), 04-metrics-and-tables.md (`inbound_channel_daily` columns, counting by processing day).
- **Grading:** must quantify the share of email delayed and mention the Aug 28 backlog. Wrong: "email tickets were lost" (they arrived late); counting Aug 28 in the baseline; blaming all channels.

### Q8 — Does response speed affect CSAT?
- **Prompt:** "Does how fast we reply actually change customer satisfaction?"
- **Type:** segmentation
- **Answer:** Yes, strongly. Positive CSAT (4-5 stars) by first-response time: **≤ 1 h 91.9%**, 1-4 h 81.3%, 4-8 h 65.3%, **> 8 h 60.4%** (finer: 61-120 min 86.9%, 121-240 min 75.8%, 241-480 min 65.3%). It falls steadily with time rather than at one cutoff and levels off after about 8 hours; > 8 h is about **0.66x** of ≤ 1 h. Overall positive share is 80.1% (average score 4.12, 27,764 answers). Accept a ratio of 0.59-0.72 between > 8 h and ≤ 1 h.
- **Evidence:** H7-fast-replies-csat; Insights `csat received`, filter `first_response_mins`, share with `score` ≥ 4; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (`first_response_mins` on `csat received`), 04-metrics-and-tables.md (CSAT).
- **Grading:** must bucket by first-response time and give positive share or average score per bucket. Wrong: "no relationship"; using resolution time instead of first response; a single cliff at one hour.

### Q9 — Why did ticket volume jump in late August?
- **Prompt:** "Ticket volume jumped in late August and then came back down. What was that?"
- **Type:** context
- **Answer:** Back-to-school. Tickets from **education** customers rose from about 610-685 a week (Jul 13 - Aug 10) to **915, 1,388, 1,477, and 986** in the weeks of Aug 17 to Sep 7, then fell back to about 700-725. Among workspaces that existed before June 4, education averaged **905 tickets a week in the season vs 496 in the 8 weeks before (1.83x)** while every other industry stayed within 0.95-1.04x; relative to other industries, education ran about **1.83x** its usual volume. The surge built up and wound down over the four weeks of the US back-to-school period (Aug 17 - Sep 13). Accept 1.6x-2.0x for education relative to other industries.
- **Evidence:** H8-back-to-school-surge; Insights `ticket assigned`, weekly, breakdown user property `industry` (filter `customer_since` before 2026-06-04); `-- STORY H8` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (back-to-school period), 01-business.md (education customers).
- **Grading:** must name the education segment and the back-to-school period. Wrong: crediting the email incident or new trial growth for the bump; "all industries grew".

### Q10 — What early behavior predicts trials sticking around?
- **Prompt:** "What do new workspaces do in their first couple of weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** Saving **3 or more macros in the first 14 days**. Among trial owners who connected an inbox and signed up by Aug 20, **76.0%** of those with 3+ macros opened a queue on day 28-41 vs **35.3%** with fewer than 3 (**0.46x**; 866 vs 1,294 workspaces). It is a step at three: 0 macros 31.8%, 1 40.9%, 2 41.7%, 3 76.1%, 4 75.7%, 5 75.0%, 6+ 77.2%. The groups look similar on day 7-13 (60.5% vs 57.0%); the gap opens after the third week. Other setup actions show much smaller gaps (integration connected 61.2% vs 48.5%, automation rule 61.7% vs 47.7%, knowledge base article 61.5% vs 49.1%, widget installed 51.3% vs 53.0%). Accept a ratio of 0.40-0.55 for fewer than 3 vs 3+ macros. (A correlation; the data cannot prove macros cause retention.)
- **Evidence:** H9-macros-first-two-weeks; Funnels `account created` → `macro created` ×3, 14-day window, saved as cohorts; Retention `account created` → `queue viewed`, custom bracket day 28-41, filter did `inbox connected`; `-- STORY H9` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`queue viewed` as activity), 04-metrics-and-tables.md (retention definition, active user excludes server events).
- **Grading:** must find the macro threshold and use a mature retention bracket. Wrong: counting `ticket assigned` or `csat received` as activity; including signups from September (immature bracket); "integrations are the key".

### Q11 — Did the Growth price change hurt sales?
- **Prompt:** "We raised the Growth price in August. Did it hurt new subscriptions?"
- **Type:** trend
- **Answer:** Volume did not drop, but the plan mix did. New subscriptions ran **10.2 a day** from Jun 4 to Aug 17 and **10.9 a day** from Aug 18 to Sep 14 (later September has fewer because recent trials have not decided yet). **Growth's share of new subscriptions fell from 65.0% to 39.0%** (497 of 765 → 191 of 490 through Oct 1; **0.60x**): buyers moved to Starter. In full weeks, Growth purchases dropped from 39-58 a week (Jun 8 - Aug 16) to 21-42 (Aug 17 - Sep 27) while Starter rose from 12-34 to 41-49. Accept "no meaningful drop in purchases" and a Growth share ratio of 0.54-0.66 (or 0.48-0.80 with a different but reasonable split of days).
- **Evidence:** H10-growth-price-change; Insights `subscription started`, breakdown `plan`, before vs after Aug 18; `-- STORY H10` and `-- EVAL Q11`.
- **Context needed:** 01-business.md and 02-timeline.md (prices, date, existing subscribers keep their price).
- **Grading:** must separate volume from mix. Wrong: "sales fell" (comparing raw weekly totals without the late-September decision lag); missing the Starter shift.

### Q12 — Did the price change raise new revenue per subscription?
- **Prompt:** "Did the Growth price increase at least bring in more new MRR per new customer?"
- **Type:** external-join
- **Answer:** No. In `subscription_billing_daily`, new MRR per new subscription was **$53.24 before Aug 18 and $51.34 after** (about **-4%**), even though the Growth list price per seat went from $39 to $49. Seats per subscription did not change (about 1.67), and the shift from Growth to Starter offset the higher Growth price. The same calculation from Mixpanel seats × warehouse list price gives $53.00 → $50.91. Accept "flat or slightly lower" (within about ±8%).
- **Evidence:** H10-growth-price-change (warehouse); `subscription_billing_daily` `new_mrr_usd` ÷ `new_subscriptions`, before vs after; Mixpanel `subscription started` seats joined to `list_price_per_seat_usd`; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md (`subscription_billing_daily`, new MRR definition), 02-timeline.md (price change date).
- **Grading:** must use warehouse prices (Mixpanel has none) and per-subscription MRR. Wrong: assuming the 26% price increase raised new MRR by 26%; using Mixpanel counts × a guessed price.

### Q13 — Does Skills Routing change escalations?
- **Prompt:** "Since Skills Routing sends tickets to specialists, are fewer tickets being escalated in the test group?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Escalation rate since Jul 8: **Skills Routing 7.39% vs Control 7.47%** (2,805 of 37,962 vs 2,871 of 38,436 tickets; z = -0.42, p ≈ 0.67). By priority: urgent 18.6% vs 18.7% (z = -0.07), high 13.9% vs 13.6% (z = 0.51), normal 4.8% vs 5.2% (z = -1.57, p ≈ 0.12, not significant), low 2.1% vs 2.1% (z = 0.09). The test's effects are on reply speed and reopens (see Q6), not escalations.
- **Evidence:** H5-skills-routing-experiment (honest null); `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (test arms).
- **Grading:** must say no meaningful difference, with rates and a test. Wrong: claiming a reduction; reading the normal-priority split as a finding.

### Q14 — Do Microsoft 365 trials convert worse once set up?
- **Prompt:** "Microsoft 365 trials struggle with setup. Once they do connect their inbox, do they buy any less?"
- **Type:** null-hypothesis
- **Answer:** No. Among trial owners who connected an inbox (signups through Sep 1), **37.4%** of Microsoft 365 workspaces bought within 30 days vs **38.7%** for Google Workspace and other hosts (231 of 617 vs 723 of 1,869; z = -0.55, p ≈ 0.58). The same holds within paid channels (33.6% vs 35.5%, z = -0.60) and within organic, referral, and app store signups (41.6% vs 42.1%, z = -0.13), and Microsoft 365 buyers pick Growth about as often (55.8% vs 57.4%). The Microsoft 365 problem is the setup step itself (Q4), not what happens after.
- **Evidence:** H3-microsoft-365-onboarding (honest null after setup); `-- EVAL Q14`.
- **Context needed:** 01-business.md (setup and trials), 04-metrics-and-tables.md (trial-to-paid definition).
- **Grading:** must condition on connecting an inbox and say no meaningful difference. Wrong: comparing all signups (that mixes in the setup gap); claiming Microsoft 365 converts worse.

### Q15 — Where do trials come from?
- **Prompt:** "Where are our new trials coming from, and has the channel mix changed?"
- **Type:** attribution
- **Answer:** Of 4,568 trial signups: **organic 1,418 (31.0%)**, Google Ads 981 (21.5%), Capterra 813 (17.8%), LinkedIn Ads 529 (11.6%), partner referral 500 (10.9%), Shopify App Store 327 (7.2%). The mix was steady across months (for example organic 288 / 381 / 342 / 392 and Google 218 / 260 / 237 / 255 in Jun / Jul / Aug / Sep; June covers 27 days). Accept shares within ±2 points.
- **Evidence:** Insights `account created`, breakdown `acquisition_channel`, monthly; `-- EVAL Q15`.
- **Context needed:** 01-business.md (channels).
- **Grading:** must give shares by channel and say the mix is stable. Wrong: using the user profile channel for all users (established customers include outbound sales and are not new trials).

### Q16 — How has ticket volume trended?
- **Prompt:** "How has our overall ticket volume trended since June, and what's driving it?"
- **Type:** open-ended
- **Answer:** Tickets grew from about **709 a day in June to 946 a day in September (+33%)**, about 4,900 a week in early June to about 6,400 a week in September. Nearly all of the growth comes from **new trial workspaces** (their tickets rose from about 190 a week in the week of Jun 8 to about 1,700 a week in September); tickets at established workspaces were flat at about 4,300-4,900 a week except for the **back-to-school bump** (5,233 and 5,174 in the weeks of Aug 24 and Aug 31; see Q9). Visible one-day dips: the US holidays (Americas companies had 175 tickets on Jul 3 vs 484 and 518 on the Fridays before and after, and 267 on Sep 7 vs 687 and 680 on the Mondays around it), and the email incident moved email tickets from Aug 26-27 to Aug 28 (Q7). Accept the growth size within ±5 points and the new-workspace explanation.
- **Evidence:** Insights `ticket assigned`, weekly, breakdown by `customer_since` before/after Jun 4 and by `region`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (holidays, back-to-school, incident), 04-metrics-and-tables.md (new workspaces keep arriving).
- **Grading:** must separate new-workspace growth from established volume and name at least one of the dated events. Wrong: "existing customers are sending more tickets"; ignoring the trial inflow.

### Q17 — Do weekend tickets wait longer?
- **Prompt:** "Are customers who write in on the weekend waiting longer for a first reply?"
- **Type:** segmentation
- **Answer:** Yes. Tickets assigned on Saturday or Sunday wait a median **169.8 minutes** for a first reply vs **95.1 minutes** on weekdays (about **1.8x**; 14,395 vs 79,625 tickets). By channel, chat is fastest (33.2 min) and web form, email, and API are 135-157 min. Accept 1.6x-2.0x.
- **Evidence:** Funnels `ticket assigned` → `reply sent`, Totals, hold `ticket_id` constant, 7-day window, shown as a daily trend of median time to convert (by the day of the first step); compare Saturdays and Sundays with weekdays. The raw export gives the same split directly; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (FRT definition, weekly rhythm).
- **Grading:** must compare per-ticket medians by arrival day. Wrong: comparing ticket counts instead of response times.

### Q18 — What is our reopen rate, and does it differ by channel?
- **Prompt:** "What's our ticket reopen rate? Is any channel worse?"
- **Type:** segmentation
- **Answer:** **10.4%** of resolved tickets are reopened (75,327 resolved tickets assigned through Sep 10), and channels barely differ (API 10.9%, chat 10.4%, email 10.2%, web form 10.3%). The real driver is the Skills Routing test: during the test Control reopens 12.0% and Skills Routing 7.3%; before Jul 8 both groups were at about 12%. Accept 10%-11% overall and "no channel difference; the test arm matters".
- **Evidence:** H5-skills-routing-experiment; Insights `ticket reopened` / `ticket resolved`, breakdown `channel` and `Experiment: Skills Routing`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (reopen rate), 02-timeline.md (test start).
- **Grading:** must give the overall rate, the flat channel split, and point to the test. Wrong: naming a channel as worse.

### Q19 — What should support leadership worry about this quarter?
- **Prompt:** "I'm preparing the Q3 review. What's going well, and what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** Going well: median first reply fell from **131.0 min in June to 92.2 min in September**, reopens fell from **12.0% to 9.4%**, and positive CSAT rose from **78.6% to 81.2%**, driven by Skills Routing (ship it; Q6) and Reply Assist (about 40% of eligible first replies, half the time; Q1-Q2). Worries: (1) **Microsoft 365 setup**: only 38% of those trials finish setup vs 69% for others (Q4), and setup completion overall drifted from 58.0% to 56.2%; (2) **new-workspace retention** depends on early macro use (76% vs 35% day 28-41; Q10), so onboarding should push macros; (3) **Growth pricing** shifted buyers to Starter with no gain in new MRR per subscription (Q11-Q12); (4) **Capterra** brings the cheapest signups but the lowest trial conversion (Q5); (5) **intake reliability**: the email incident held back about 70% of email for two days (Q7); (6) **seasonality**: education volume nearly doubles at back-to-school (Q9); (7) **Reply Assist adoption** plateaued at about half of eligible agents (Q2). Grade on coverage: a strong answer names at least four of these with numbers.
- **Evidence:** H1-H10; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must combine product, funnel, revenue, and incident findings with numbers. Wrong: generic advice without data; claiming CSAT or reopens got worse.

### Q20 — How many tickets never reach an agent?
- **Prompt:** "Our intake pipeline says it processes far more tickets than Mixpanel shows assigned. Where's the gap?"
- **Type:** external-join
- **Answer:** The gap is auto-closed and merged tickets, which never reach an agent. Over the window: email **69,902 ingested** vs **45,333 assigned** in Mixpanel (64.9%; 21,197 auto-closed, 3,283 merged), chat 27,355 vs 22,088 (80.7%), web form 30,728 vs 23,008 (74.9%), API 16,933 vs 10,119 (59.8%; 6,098 auto-closed). After removing auto-closed and merged tickets, intake and Mixpanel agree within a few percent each day (daily correlation of ingested vs assigned 0.86-0.98 by channel); the small remaining gap is hand-logged tickets and deletions before routing. Accept per-channel assigned shares within ±3 points.
- **Evidence:** `inbound_channel_daily` joined to Mixpanel `ticket assigned` by date and `channel`; `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (`inbound_channel_daily` columns and caveats), 03-event-dictionary.md (`ticket assigned`).
- **Grading:** must use the auto-closed and merged columns to explain the gap. Wrong: "Mixpanel is losing events"; comparing without the channel dimension.

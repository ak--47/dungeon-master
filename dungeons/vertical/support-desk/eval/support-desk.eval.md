# Ticketloop (support-desk) — 20-question eval

- **Data:** `data/verify-support-desk` (full fidelity: 10,000 users, 9,995 with events, 4,568 trial signups, 857,032 events, 98,795 tickets assigned, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/support-desk/support-desk.sql` on that data.
- **Stories:** ids refer to the `stories` export in `support-desk.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Is Reply Assist making agents faster?
- **Prompt:** "We launched Reply Assist in July. Is it actually making our agents reply faster? By how much?"
- **Type:** trend
- **Answer:** Yes. On Growth and Enterprise tickets assigned from 2026-07-21 to Sep 24, a first reply written from an AI draft came a median **54.1 minutes** after assignment vs **109.2 minutes** for typed or macro first replies: about **0.50x** the time (10,542 vs 19,905 tickets). A plain before/after on Growth and Enterprise (123.7 min before launch → 81.4 min from Aug 11) overstates Reply Assist alone: Starter, which never had it, also fell (121.5 → 110.3 min) because the Skills Routing test started on Jul 8 and cut first-reply time for the accounts in its test arm on every plan. Against Starter, the plan-level drop attributable to Reply Assist is about 0.72x, consistent with about 40% of eligible first replies using drafts at half the time. Accept a per-ticket ratio of 0.42-0.58.
- **Evidence:** H1-reply-assist-launch; Funnels, `ticket assigned` → `reply sent`, Totals, hold `ticket_id` constant, 7-day window, filter step-1 `plan_tier` in (growth, enterprise), Jul 21 - Sep 24, breakdown `reply_method`, median time to convert; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, eligible plans, Skills Routing start), 03-event-dictionary.md (`reply_method`), 04-metrics-and-tables.md (FRT definition).
- **Grading:** must compare AI-drafted vs other first replies per ticket (or control for the Skills Routing test) and give the size. Wrong: crediting the whole before/after drop to Reply Assist; including Starter, Free, or trial tickets in the eligible group; unique-user funnels.

### Q2 — How many agents use Reply Assist?
- **Prompt:** "How widely has Reply Assist been adopted? Is usage still growing?"
- **Type:** context
- **Answer:** About **41%** of first replies on Growth and Enterprise tickets are AI drafts once the rollout settled (41.0% of eligible tickets assigned from Aug 11). Weekly share: 0% (week of Jul 13), 4.3% (launch week of Jul 20), 17.4%, 31.3%, 39.3% (week of Aug 10), then flat at 38.6%-42.3% through September. **1,848 of 3,727 agents** (49.6%) who replied on Growth or Enterprise tickets since Aug 11 used it at least once. Adoption ramped for three weeks and then plateaued; it is not still growing. Accept 36%-44% of eligible first replies and about half of eligible agents.
- **Evidence:** H1-reply-assist-launch (adoption); Insights, `reply sent` filtered `is_first_reply = true` and `plan_tier` in (growth, enterprise), share with `reply_method = ai_draft`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch date, in-app prompts, eligible plans), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator must be eligible plans after launch. Wrong: share of all replies on every plan (Starter, Free, and trial cannot use it); "adoption keeps growing".

### Q3 — How long do tickets take to resolve by priority?
- **Prompt:** "How long does it take us to resolve tickets, and does priority actually make a difference?"
- **Type:** funnel
- **Answer:** Median time from assignment to resolution (14-day window, tickets through Sep 17): **urgent 6.0 h, high 12.1 h, normal 20.0 h, low 30.3 h** — about 0.30x, 0.61x, 1.0x, and 1.51x of normal. First replies follow the same order (median 36, 76, 123, and 183 minutes). Priority scales the whole ticket, not only the first reply. Accept urgent 0.27-0.33x and low 1.35-1.65x of normal.
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
- **Answer:** Yes. For tickets assigned from 2026-07-08, agents in Skills Routing accounts had a median first reply of **76.9 minutes vs 110.7** in Control (**0.69x**), and their **reopen rate was 7.2% vs 12.2%** per resolved ticket (**0.59x**; the quick Insights ratio of total `ticket reopened` ÷ total `ticket resolved` from Jul 8 gives 6.8% vs 10.9%, 0.63x). Positive CSAT is higher (83.1% vs 79.3%), consistent with faster replies. Escalations did not change (7.55% vs 7.50%) and the share resolved within 14 days is the same (92.8% in both). The test randomized whole accounts (187 vs 187 accounts with 2+ agents, 2,250 vs 2,264 exposed agents); single-agent workspaces are not in it. Before the test both groups reopened about 12% of tickets (12.4% vs 12.5%). Recommend shipping to multi-agent accounts. Accept a first-reply ratio of 0.60-0.77 and a reopen ratio of 0.50-0.66 (per ticket or event totals).
- **Evidence:** H5-skills-routing-experiment; Funnels, `ticket assigned` → `reply sent`, Totals, hold `ticket_id` constant, 7-day window, from Jul 8, breakdown `Experiment: Skills Routing`, median time to convert; reopens per ticket (Funnels `ticket resolved` → `ticket reopened`, hold `ticket_id` constant) or Insights `ticket reopened` / `ticket resolved` by the same breakdown; `-- STORY H5`, `-- EVAL Q6`, and `-- EVAL Q18`.
- **Context needed:** 02-timeline.md (start date, account-level arms, who is in the test), 03-event-dictionary.md (`$experiment_started`, ticket events).
- **Grading:** must compare arms per ticket after the start and report both speed and reopens. Wrong: including tickets before Jul 8; comparing exposed vs unexposed users (unexposed users are single-agent workspaces, a different population); claiming escalations fell.

### Q7 — What happened to email tickets in late August?
- **Prompt:** "Our email ticket counts looked strange at the end of August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The email ingestion incident (2026-08-26 and 08-27; warehouse `inbound_channel_daily` shows `ingestion_status = degraded` for email on exactly those two days). Email tickets assigned fell to **161 and 161** a day while other channels were normal: the email-to-other ratio was **0.249 vs 0.822** in the surrounding weeks (**0.30x**, about **70%** of email held back), roughly **740 email tickets** missing across the two days (387 and 354). They arrived on **Aug 28** when the fix went live: **1,238 email tickets** that day, about 764 above normal. The warehouse shows **538 and 400** messages delayed over an hour, p95 ingest latency of **7.3 h and 14.3 h** (normally under a minute), and auto-closed email (spam, auto-replies) of 47 and 24 on the incident days and 336 on Aug 28 (usually about 175 a day). Chat, web form, and API were unaffected. Accept 0.22-0.35 for the email ratio (65%-78% held back) and the Aug 28 backlog.
- **Evidence:** H6-email-ingestion-incident; Insights `ticket assigned`, daily, breakdown `channel`, joined to `inbound_channel_daily.ingestion_status`; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (incident dates, fix time), 04-metrics-and-tables.md (`inbound_channel_daily` columns, counting by processing day).
- **Grading:** must quantify the share of email delayed and mention the Aug 28 backlog. Wrong: "email tickets were lost" (they arrived late); counting Aug 28 in the baseline; blaming all channels.

### Q8 — Does response speed affect CSAT?
- **Prompt:** "Does how fast we reply actually change customer satisfaction?"
- **Type:** segmentation
- **Answer:** Yes, strongly. Positive CSAT (4-5 stars) by first-response time: **≤ 1 h 92.4%**, 1-4 h 81.1%, 4-8 h 65.6%, **> 8 h 60.6%** (finer: 61-120 min 86.1%, 121-240 min 75.9%, 241-480 min 65.6%). It falls steadily with time rather than at one cutoff and levels off after about 8 hours; > 8 h is about **0.66x** of ≤ 1 h. Overall positive share is 80.1% (average score 4.12, 27,249 answers). Accept a ratio of 0.59-0.72 between > 8 h and ≤ 1 h.
- **Evidence:** H7-fast-replies-csat; Insights `csat received`, filter `first_response_mins`, share with `score` ≥ 4; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (`first_response_mins` on `csat received`), 04-metrics-and-tables.md (CSAT).
- **Grading:** must bucket by first-response time and give positive share or average score per bucket. Wrong: "no relationship"; using resolution time instead of first response; a single cliff at one hour.

### Q9 — Why did ticket volume jump in late August?
- **Prompt:** "Ticket volume jumped in late August and then came back down. What was that?"
- **Type:** context
- **Answer:** Back-to-school. Tickets from **education** customers rose from about 610-710 a week (Jul 13 - Aug 10) to **952, 1,342, 1,392, and 1,006** in the weeks of Aug 17 to Sep 7, then fell back to about 680-720. Among workspaces that existed before June 4, education averaged **889 tickets a week in the season vs 504 in the 8 weeks before (1.76x)** while every other industry stayed within 0.98-1.03x; relative to other industries, education ran about **1.76x** its usual volume. The surge built up and wound down over the four weeks of the US back-to-school period (Aug 17 - Sep 13). Accept 1.6x-2.0x for education relative to other industries.
- **Evidence:** H8-back-to-school-surge; Insights `ticket assigned`, weekly, breakdown user property `industry` (filter `customer_since` before 2026-06-04); `-- STORY H8` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (back-to-school period), 01-business.md (education customers).
- **Grading:** must name the education segment and the back-to-school period. Wrong: crediting the email incident or new trial growth for the bump; "all industries grew".

### Q10 — What early behavior predicts trials sticking around?
- **Prompt:** "What do new workspaces do in their first couple of weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Saving macros in the first 14 days**, with about **3** as the practical target. Among trial owners who connected an inbox and signed up by Aug 20, day 28-41 retention (a queue opened) rises steadily with macros saved: 0 macros 22.0%, 1 24.7%, 2 36.6%, 3 51.6%, 4 61.7%, 5 71.0%, 6 68.0%, 7+ about 72%-78%. The biggest single step is from 2 to 3. Split at three, **63.1%** of those with 3+ macros stayed vs **27.5%** with fewer than 3 (**0.44x**; 881 vs 1,279 workspaces). The groups look the same on day 7-13 (57.2% vs 58.9%); the gap opens after the third week. Other setup actions show much smaller gaps (integration connected 48.1% vs 40.0%, automation rule 46.7% vs 40.3%, knowledge base article 47.0% vs 40.9%, widget installed 42.7% vs 39.5%). Accept a ratio of 0.39-0.48 for fewer than 3 vs 3+ macros, or an equivalent description of the rising curve. (A correlation; the data cannot prove macros cause retention.)
- **Evidence:** H9-macros-first-two-weeks; Funnels `account created` → `macro created` ×3, 14-day window, saved as cohorts (or Insights `macro created` per user in the first 14 days, bucketed); Retention `account created` → `queue viewed`, custom bracket day 28-41, filter did `inbox connected`; `-- STORY H9` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`queue viewed` as activity), 04-metrics-and-tables.md (retention definition, active user excludes server events).
- **Grading:** must find the macro relationship (a rising curve, steepest around 2-3) and use a mature retention bracket. Wrong: counting `ticket assigned` or `csat received` as activity; including signups from September (immature bracket); "integrations are the key"; claiming a hard cliff with no difference above or below it.

### Q11 — Did the Growth price change hurt sales?
- **Prompt:** "We raised the Growth price in August. Did it hurt new subscriptions?"
- **Type:** trend
- **Answer:** Volume did not drop, but the plan mix did. New subscriptions ran **10.2 a day** from Jun 4 to Aug 17 and **10.9 a day** from Aug 18 to Sep 14 (later September has fewer because recent trials have not decided yet). **Growth's share of new subscriptions fell from 63.5% to 43.9%** (486 of 765 → 215 of 490 through Oct 1; **0.69x**): buyers moved to Starter. In full weeks, Growth purchases dropped from 36-55 a week (Jun 8 - Aug 16) to 29-47 (Aug 17 - Sep 27) while Starter rose from 20-38 to 36-46. Accept "no meaningful drop in purchases" and a Growth share ratio of 0.55-0.80.
- **Evidence:** H10-growth-price-change; Insights `subscription started`, breakdown `plan`, before vs after Aug 18; `-- STORY H10` and `-- EVAL Q11`.
- **Context needed:** 01-business.md and 02-timeline.md (prices, date, existing subscribers keep their price).
- **Grading:** must separate volume from mix. Wrong: "sales fell" (comparing raw weekly totals without the late-September decision lag); missing the Starter shift.

### Q12 — Did the price change raise new revenue per subscription?
- **Prompt:** "Did the Growth price increase at least bring in more new MRR per new customer?"
- **Type:** external-join
- **Answer:** No. In `subscription_billing_daily`, new MRR per new subscription was **$53.01 before Aug 18 and $52.92 after** (flat, -0.2%), even though the Growth list price per seat went from $39 to $49. Seats per subscription did not change (about 1.67), and the shift from Growth to Starter offset the higher Growth price. The same calculation from Mixpanel seats × warehouse list price gives $52.76 → $52.62. Accept "flat" (within about ±8%).
- **Evidence:** H10-growth-price-change (warehouse); `subscription_billing_daily` `new_mrr_usd` ÷ `new_subscriptions`, before vs after; Mixpanel `subscription started` seats joined to `list_price_per_seat_usd`; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md (`subscription_billing_daily`, new MRR definition), 02-timeline.md (price change date).
- **Grading:** must use warehouse prices (Mixpanel has none) and per-subscription MRR. Wrong: assuming the 26% price increase raised new MRR by 26%; using Mixpanel counts × a guessed price.

### Q13 — Does Skills Routing change escalations?
- **Prompt:** "Since Skills Routing sends tickets to specialists, are fewer tickets being escalated in the test group?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Escalation rate since Jul 8: **Skills Routing 7.55% vs Control 7.50%** (1,846 of 24,438 vs 1,871 of 24,932 tickets; z = 0.21, p ≈ 0.83). The null holds in every obvious split (ticket-level z, 23 splits, all |z| ≤ 1.0): by priority urgent 18.4% vs 18.7%, high 13.6% vs 13.3%, normal 5.2% vs 5.3%, low 2.3% vs 2.2%; by channel chat 7.8% vs 7.3% (z = 1.00, the largest), email 7.4% vs 7.5%, web form 7.5% vs 7.8%, API 7.9% vs 7.4%; by plan, company size, category, and region every gap is under 0.9 points. Tickets cluster by account, so the account-level comparison is the stricter test: mean escalation rate per account 7.32% vs 7.37% (187 vs 187 accounts, Welch t = -0.13). The test's effects are on reply speed and reopens (see Q6), not escalations.
- **Evidence:** H5-skills-routing-experiment (honest null); Insights `ticket escalated` ÷ `ticket assigned` from Jul 8, breakdown `Experiment: Skills Routing` (then add `channel`, `priority`, or `plan_tier`); `-- EVAL Q13` (overall, 23 sub-splits, account level).
- **Context needed:** 02-timeline.md (test arms).
- **Grading:** must say no meaningful difference, with rates and a test. A split-level check is a plus; any split an analyst reports should show |z| ≤ about 1. Wrong: claiming a reduction (or an increase, overall or in one channel).

### Q14 — Do Microsoft 365 trials convert worse once set up?
- **Prompt:** "Microsoft 365 trials struggle with setup. Once they do connect their inbox, do they buy any less?"
- **Type:** null-hypothesis
- **Answer:** No. Among trial owners who connected an inbox (signups through Sep 1), **37.4%** of Microsoft 365 workspaces bought within 30 days vs **38.7%** for Google Workspace and other hosts (231 of 617 vs 723 of 1,869; z = -0.55, p ≈ 0.58). The same holds within paid channels (33.6% vs 35.5%, z = -0.60) and within organic, referral, and app store signups (41.6% vs 42.1%, z = -0.13), and Microsoft 365 buyers pick Growth about as often (55.8% vs 57.4%). The Microsoft 365 problem is the setup step itself (Q4), not what happens after.
- **Evidence:** H3-microsoft-365-onboarding (honest null after setup); `-- EVAL Q14`.
- **Context needed:** 01-business.md (setup and trials), 04-metrics-and-tables.md (trial-to-paid definition).
- **Grading:** must condition on connecting an inbox and say no meaningful difference. Wrong: comparing all signups (that mixes in the setup gap); claiming Microsoft 365 converts worse. Noise note: by acquisition channel every split has |z| ≤ 1.02, but by region APAC reads 28.8% vs 42.5% for Microsoft 365 (80 vs 233 workspaces, z = -2.17) while the Americas (40.5% vs 38.1%) and EMEA (35.7% vs 38.3%) do not differ. With 9 sub-splits, one |z| near 2 has about a 1-in-4 chance under the null, and it is a small cell; do not mark an answer wrong for flagging it, but an answer that calls it a finding without that caveat over-reads it.

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
- **Answer:** Tickets grew from about **709 a day in June to 917 a day in September (+29%)**, about 4,900 a week in early June to about 6,200 a week in September. Nearly all of the growth comes from **new trial workspaces** (their tickets rose from about 190 a week in the week of Jun 8 to about 1,430-1,520 a week in September); tickets at established workspaces were flat at about 4,300-4,900 a week except for the **back-to-school bump** (5,191 and 5,148 in the weeks of Aug 24 and Aug 31; see Q9). Visible one-day dips: the US holidays (Americas companies had 171 tickets on Jul 3 vs 505 and 510 on the Fridays before and after, and 276 on Sep 7 vs 628 and 690 on the Mondays around it), and the email incident moved email tickets from Aug 26-27 to Aug 28 (Q7). Accept the growth size within ±5 points and the new-workspace explanation.
- **Evidence:** Insights `ticket assigned`, weekly, breakdown by `customer_since` before/after Jun 4 and by `region`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (holidays, back-to-school, incident), 04-metrics-and-tables.md (new workspaces keep arriving).
- **Grading:** must separate new-workspace growth from established volume and name at least one of the dated events. Wrong: "existing customers are sending more tickets"; ignoring the trial inflow.

### Q17 — Do weekend tickets wait longer?
- **Prompt:** "Are customers who write in on the weekend waiting longer for a first reply?"
- **Type:** segmentation
- **Answer:** Yes. Tickets assigned on Saturday or Sunday wait a median **177.7 minutes** for a first reply vs **99.5 minutes** on weekdays (about **1.8x**; 14,083 vs 78,363 tickets assigned through Sep 24). By channel, chat is fastest (34.7 min) and web form, email, and API are 139-166 min. The date-range recipe gives the same picture week by week: 168.5 min (Sat-Sun Sep 12-13) vs 88.2 min (Mon-Fri Sep 14-18), and 148.4 vs 87.2 min the next week. Accept 1.6x-2.0x.
- **Evidence:** Funnels `ticket assigned` → `reply sent`, Totals, hold `ticket_id` constant, 7-day conversion window, measure median time to convert. Funnels cannot break down by day of week, so run the same funnel with date ranges: a Saturday-Sunday range vs the Monday-Friday range that follows, for three or four weeks (for example Sep 12-13 vs Sep 14-18, and Sep 19-20 vs Sep 21-25). Every weekend reads well above its weekdays. The raw export gives the full split directly; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (FRT definition, weekly rhythm).
- **Grading:** must compare per-ticket medians by arrival day. Accept a sample of weeks built from date ranges if the ratio is in range. Wrong: comparing ticket counts instead of response times.

### Q18 — What is our reopen rate, and does it differ by channel?
- **Prompt:** "What's our ticket reopen rate? Is any channel worse?"
- **Type:** segmentation
- **Answer:** Per ticket, **11.0%** of resolved tickets are reopened (74,240 resolved tickets assigned through Sep 10). The quick Insights recipe (total `ticket reopened` ÷ total `ticket resolved` over the window) gives **9.8%** (9,906 / 101,271), lower because a reopened ticket's second resolution sits in the denominator. Channels barely differ (per ticket: web form 11.1%, email 11.1%, API 10.8%, chat 10.8%). The real driver is the Skills Routing test: during the test Control accounts reopen 12.2% and Skills Routing accounts 7.2% per ticket (10.9% vs 6.8% as event totals); before Jul 8 both groups were at about 12.4%. Accept 9%-12% overall (per ticket or event totals, if the method is stated) and "no channel difference; the test arm matters".
- **Evidence:** H5-skills-routing-experiment; per ticket: Funnels `ticket resolved` → `ticket reopened`, hold `ticket_id` constant, breakdown `channel` and `Experiment: Skills Routing`; quick read: Insights `ticket reopened` / `ticket resolved` (formula), same breakdowns; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (reopen rate), 02-timeline.md (test start).
- **Grading:** must give the overall rate, the flat channel split, and point to the test. Wrong: naming a channel as worse.

### Q19 — What should support leadership worry about this quarter?
- **Prompt:** "I'm preparing the Q3 review. What's going well, and what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** Going well: median first reply fell from **128.2 min in June to 97.1 min in September**, the per-ticket reopen rate fell from **12.3% in June to 10.8% for tickets assigned Sep 1-10** (only tickets whose reopen window has passed), and positive CSAT rose from **79.0% to 80.6%**, driven by Skills Routing (ship it to multi-agent accounts; Q6) and Reply Assist (about 40% of eligible first replies, half the time; Q1-Q2). Worries: (1) **Microsoft 365 setup**: only 38% of those trials finish setup vs 69% for others (Q4), and setup completion overall drifted from 58.0% to 56.3%; (2) **new-workspace retention** depends on early macro use (63% vs 28% day 28-41 for 3+ vs fewer macros; Q10), so onboarding should push macros; (3) **Growth pricing** shifted buyers to Starter with no gain in new MRR per subscription (Q11-Q12); (4) **Capterra** brings the cheapest signups but the lowest trial conversion (Q5); (5) **intake reliability**: the email incident held back about 70% of email for two days (Q7); (6) **seasonality**: education volume rises about 1.75x at back-to-school (Q9); (7) **Reply Assist adoption** plateaued at about half of eligible agents (Q2). Grade on coverage: a strong answer names at least four of these with numbers.
- **Evidence:** H1-H10; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must combine product, funnel, revenue, and incident findings with numbers. Wrong: generic advice without data; claiming CSAT or reopens got worse; a September reopen rate that includes tickets assigned in the last three weeks (their reopen window is cut off, which overstates the drop).

### Q20 — Which intake channel loses the most before an agent sees it?
- **Prompt:** "Which intake channel loses the biggest share of its tickets before they reach an agent, and how many tickets a day is that?"
- **Type:** external-join
- **Answer:** **API** loses the largest share: only **59.4%** of what it ingests is assigned in Mixpanel (9,948 of 16,747 over the window), because 6,098 API tickets were auto-closed (order-platform notifications and duplicates) and 681 merged, about **57 a day**. **Email** loses the most in absolute terms, about **204 a day** (21,197 auto-closed and 3,221 merged; 64.5% assigned). Chat loses the least (80.5% assigned, about 44 a day) and web form sits between (74.7%, about 64 a day). After removing auto-closed and merged tickets, intake and Mixpanel agree within a few percent each day (daily correlation of ingested vs assigned 0.86-0.97 by channel). Accept per-channel assigned shares within ±3 points and API as the largest share lost.
- **Evidence:** `inbound_channel_daily` (`tickets_ingested`, `tickets_auto_closed`, `tickets_merged`) joined to Mixpanel `ticket assigned` by date and `channel`; `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (`inbound_channel_daily` columns and caveats), 03-event-dictionary.md (`ticket assigned`).
- **Grading:** must compare per channel as a share of ingested and name API; a strong answer separates share lost from volume lost (email). Wrong: "Mixpanel is losing events"; answering only with window totals across channels.

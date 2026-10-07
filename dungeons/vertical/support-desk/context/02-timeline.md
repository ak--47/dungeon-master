# Ticketloop timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) | Holiday | US Independence Day (observed). Many Americas-based customer teams take the day off or run a skeleton crew; their own customers also write in less. |
| 2026-07-08 (Wed) | Experiment | **"Skills Routing" test** starts. Users who handle tickets are assigned 50/50 to **Control** (round-robin assignment, as before) or **Skills Routing** (each ticket goes to the available agent whose skills best match its category and channel). Assignment is sticky per user and recorded with one `$experiment_started` event just before the user's first ticket after the start, and with the profile property `Experiment: Skills Routing`. |
| 2026-07-21 (Tue) | Launch | **Reply Assist** launches for Growth and Enterprise workspaces. When an agent opens a ticket, Reply Assist can write a draft reply from the ticket, the customer's history, and the knowledge base; the agent edits and sends it. A reply sent from a draft has `reply_method = ai_draft`. Agents turn it on for themselves; in-app prompts invited eligible agents over the following three weeks. Trials, Free, and Starter do not have it. |
| 2026-08-17 (Mon) to 2026-09-13 (Sun) | Season | US back-to-school period. |
| 2026-08-18 (Tue) | Pricing | **Growth price change** for new subscriptions: $39 → $49 per agent seat per month. Starter ($19) and Enterprise ($89) do not change. Existing Growth subscribers keep $39 until renewal. |
| 2026-08-26 (Wed) to 2026-08-27 (Thu) | Incident | **Email ingestion incident.** A fault in the mail-processing pipeline left part of the incoming email stuck in a queue. The fix was deployed at 00:00 UTC on August 28, and the stuck email was processed and assigned to agents during the morning of August 28 (UTC). Chat, web form, and API intake were not affected. Daily ingestion health by channel is in `inbound_channel_daily`. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. Many Americas-based customer teams take the day off or run a skeleton crew; their own customers also write in less. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the trial length, the setup steps, or the Free and Starter plans.
- No change to how CSAT surveys are sent or worded.
- Paid channel budgets were steady through the window; no channel was added or paused.
- Ticketloop ran no seasonal promotions.
- Chat, web form, and API intake had no incidents in the window.

## Open questions leadership has asked

- Is Reply Assist making agents faster? How many agents use it?
- Is the Skills Routing test working, and should it ship to everyone?
- Did the Growth price change help or hurt new business?
- Which paid channel deserves more budget?
- Why do some trials never finish setup?
- What happened to email tickets in late August, and how big was it?
- What should we watch to keep new workspaces from leaving?

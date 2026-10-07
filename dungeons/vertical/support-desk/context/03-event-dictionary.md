# Ticketloop tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The user's ID. Present on every event. |
| `device_id` | The user's browser. Present on every event except `inbox connected` and the server-side events `ticket assigned`, `ticket reopened`, `csat received`, and `subscription started`. |
| `insert_id` | Unique event ID used for de-duplication. |
| `company_id` | The user's company (Mixpanel group key). Fixed per user. |
| `plan_tier` | The company's plan **at the moment of the event**: `trial`, `free`, `starter`, `growth`, or `enterprise`. A trial workspace shows `trial` until it buys (then the plan it bought) or until the trial ends (then `free`). |
| `os`, `browser`, `model`, `screen_height`, `screen_width` | Browser and computer details, on events that carry `device_id`. They stay the same for one `device_id`. |

## Signup and setup

A new trial workspace goes through setup once, right after signup.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | A new user creates an account and starts a 14-day trial. First event of every trial signup and the moment their browser is linked to their `user_id`. | `signup_method` (`google`, `email`, `microsoft`); `acquisition_channel`: how the workspace found us (see 01-business.md); `email_provider`: the company's mail host (`google_workspace`, `microsoft_365`, `other`). |
| `inbox connected` | The support inbox is connected, so customer email becomes tickets. Sent by the mail integration service. No tickets reach a workspace before this step. | `email_provider`; `connection_method` (`oauth`, `forwarding`). |
| `widget installed` | The help widget (live chat and web form) is installed on the company website. Once per workspace. | `install_method` (`snippet`, `shopify_app`, `wordpress_plugin`). |

## Tickets

Every ticket has a `ticket_id`. The assignment, every reply, the escalation, the resolution, a reopen, a second resolution, and the CSAT answer for one ticket share the same `ticket_id`. Not every ticket is escalated, reopened, or rated, and a few stay unresolved (waiting on the customer).

| Event | Meaning | Properties |
|---|---|---|
| `ticket assigned` | A new ticket is routed to the agent. Sent by the routing service when the ticket enters the agent's queue. Tickets that are filtered as spam, closed automatically, or merged into another ticket are never assigned. | `ticket_id`; `channel` (`email`, `chat`, `web_form`, `api`); `priority` (`urgent`, `high`, `normal`, `low`); `category` (`billing`, `technical_issue`, `account_access`, `how_to`, `shipping`, `feature_request`). |
| `reply sent` | The agent sends a reply to the customer. | `ticket_id`; `reply_method` (`typed`, `macro` for a saved reply, `ai_draft` for a reply sent from a Reply Assist draft); `is_first_reply` (`true` on the ticket's first reply); `reply_length_chars`. |
| `ticket escalated` | The agent hands the ticket to a specialist team. | `ticket_id`; `escalation_tier` (`tier_2`, `tier_3`). |
| `ticket resolved` | The agent marks the ticket solved. A reopened ticket is resolved again later. | `ticket_id`; `channel`; `priority`; `first_response_mins`: whole minutes from assignment to the first reply; `resolution_mins`: minutes from assignment to this resolution; `replies_count`: agent replies so far. |
| `ticket reopened` | The ticket opens again after a resolution, usually because the customer wrote back. Sent by the routing service. | `ticket_id`; `reopen_source` (`customer_reply`, `agent`). |
| `csat received` | The customer answered the satisfaction survey sent after the ticket was resolved. Sent by the survey service; attributed to the ticket's agent. | `ticket_id`; `score` (1-5 stars; 4-5 counts as positive); `first_response_mins` (as on `ticket resolved`); `comment_left` (`true` if the customer wrote a comment). |
| `$experiment_started` | Mixpanel experiment exposure, sent once per user just before their first ticket after 2026-07-08. | `Experiment name` = `Skills Routing`; `Variant name` = `Control` or `Skills Routing`. |

## Working in Ticketloop

| Event | Meaning | Properties |
|---|---|---|
| `queue viewed` | The user opens a ticket queue. This is how agents start a work session; Ticketloop uses it as the sign of an active user. | `view_name` (`my_open_tickets`, `unassigned`, `urgent`, `all_open`, `sla_at_risk`). |
| `search performed` | The user searches. | `search_scope` (`tickets`, `customers`, `knowledge_base`); `results_count`. |
| `kb article viewed` | The user reads a knowledge base article. | `article_category` (`billing`, `troubleshooting`, `account`, `shipping`, `getting_started`); `view_source` (`search`, `ticket_sidebar`). |
| `internal note added` | The user adds a note on a ticket that the customer does not see. | `mentions_count`: teammates @-mentioned. |
| `customer profile viewed` | The user opens a customer's profile and history. | `customer_tier` (`standard`, `vip`, `at_risk`). |
| `report viewed` | The user opens a report. | `report_type` (`first_response_time`, `csat`, `ticket_volume`, `agent_performance`, `sla_compliance`). |
| `macro created` | The user saves a new macro (a reusable reply). | `macro_category` (`greeting`, `refund`, `shipping_status`, `password_reset`, `troubleshooting`, `closing`). |
| `kb article published` | The user publishes a knowledge base article. Mostly team leads and admins. | `article_category`. |
| `automation rule created` | The user creates an automation rule. Admins and team leads only. | `trigger_type` (`ticket_created`, `sla_breach`, `tag_added`, `customer_replied`). |
| `integration connected` | An admin connects an integration. | `integration` (`slack`, `shopify`, `jira`, `salesforce`, `stripe`). |

## Billing

| Event | Meaning | Properties |
|---|---|---|
| `pricing page viewed` | A trial workspace owner opens the pricing page. | `plan_viewed` (`growth`, `starter`, `enterprise`). |
| `subscription started` | A trial workspace buys a plan. At most one per workspace in the window. Sent by the billing service. Price is **not** tracked here; see `subscription_billing_daily`. | `plan` (`starter` or `growth`); `seats` (seats bought, 1-4); `billing_period` (`monthly`, `annual`). |

Enterprise contracts and changes to existing customers' subscriptions (renewals, added seats) are handled by sales and billing and are not tracked as events.

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The user's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `created` | Signup time for users who joined in the window (the time of their `account created` event); empty for users from before the window. |
| `company_id`, `company_name` | The user's company. |
| `company_size` | `small`, `mid`, `large` (see 01-business.md). |
| `industry` | `ecommerce`, `saas`, `education`, `fintech`, `healthcare`, `travel`, `gaming`. |
| `region` | `americas`, `emea`, `apac`. |
| `role` | `agent`, `team_lead`, `admin`. |
| `plan_tier` | The company's current plan. |
| `email_provider` | `google_workspace`, `microsoft_365`, `other`. |
| `acquisition_channel` | How the company found us (for trial signups, the channel on `account created`). |
| `customer_since` | Date the company became a Ticketloop customer or started its trial (YYYY-MM-DD). Before 2026-06-04 for established users. |
| `agent_seats` | Seats the company pays for (1 for Free and trial workspaces). |
| `Experiment: Skills Routing` | `Control` or `Skills Routing` for users in the test; empty for everyone else. |
| `_persona` | Usage segment from the lifecycle-marketing tool (`frontline_agent`, `occasional_agent`, `team_lead`, `support_admin`), set at signup from expected workload. It is not the same as `role`. |
| `anonymousIds` | Browsers seen for the user (pipeline metadata). |

## Company (group) profile properties

Group key `company_id`. One row per company with users in the window.

| Property | Meaning |
|---|---|
| `company_id` | Company ID. |
| `name` | Company name. |
| `company_size`, `industry`, `region`, `email_provider`, `customer_since`, `acquisition_channel` | As on the user profile. |
| `plan_tier` | The company's current plan. |
| `agent_seats` | Seats the company pays for. |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Workspace setup | `account created` → `inbox connected` → `widget installed` | Trial signups only. Read with a 7-day conversion window. |
| First response | `ticket assigned` → `reply sent` | Per ticket: use Totals counting and hold `ticket_id` constant. Read with a 7-day conversion window. |
| Resolution | `ticket assigned` → `ticket resolved` | Per ticket, hold `ticket_id` constant. Read with a 14-day conversion window. |
| Trial to paid | `account created` → `subscription started` | Trial signups. Read with a 30-day conversion window (the Mixpanel default). |

# Ticketloop: the business

## Who we are

Ticketloop makes help desk software for small and mid-size support teams: online stores, software companies, schools and online-learning companies, fintech and healthcare startups, travel companies, and game studios. It started in 2022 and has about 45 employees across product and engineering, a sales team for larger accounts, customer success, marketing, and our own support team (which runs on Ticketloop).

Revenue comes from per-seat subscriptions. At the start of the window, recurring revenue was about $250,000 a month, almost all of it from customer companies with support teams. One-person workspaces are on the Free plan or in a trial; a trial owner who buys pays for Starter or Growth on their own.

## How Ticketloop works

- **Set up a workspace.** A new user signs up (Google, Microsoft, or email) and starts a 14-day trial. Setup has two steps: **connect the support inbox** (the mailbox customers write to, usually support@ the company's domain), then **install the help widget** on the company website. The widget puts live chat and the web form on the company's own pages; Ticketloop's hosted help page offers both from the moment the inbox is connected. The inbox connection uses the company's email provider (Google Workspace, Microsoft 365, or another host); it works by OAuth sign-in or by forwarding.
- **Tickets arrive.** A customer's message becomes a ticket. Tickets come from four channels: email, chat (the widget's live chat, answered in real time while agents are online), web form, and API (tickets created by the customer's own systems, such as an order platform). Every ticket gets a priority (`urgent`, `high`, `normal`, `low`) and a category from the customer's routing rules.
- **Routing.** Ticketloop assigns each ticket to one agent. Until July the only method was round robin (the next available agent). See 02-timeline.md for the Skills Routing test.
- **Work the ticket.** The agent sends a first reply, may exchange more replies, may add internal notes, and may escalate the ticket to a second- or third-tier team. When the issue is fixed the agent resolves the ticket. If the customer writes back after that, the ticket is reopened, answered again, and resolved again.
- **Satisfaction.** After a ticket is resolved, the customer gets a one-question CSAT survey (1 to 5 stars). About a third of customers answer.
- **Part of the volume.** Most customer companies route only part of their support through Ticketloop. Newer customers start with one brand, one product line, or one queue (for example billing questions or VIP customers) while they move off an older help desk or a shared inbox. Many long-time customers keep it that way by design: Ticketloop runs one queue or brand, and their other volume stays in a tool tied to another part of the business (a phone system, a marketplace's own messaging, a parent company's help desk). Every agent on the team gets a seat, but only the tickets routed through Ticketloop appear in our data, so tickets per agent in Ticketloop are far below an agent's full workload.
- **Agent tools.** Macros are saved replies that an agent can insert with one click. The knowledge base holds help articles: agents read them while answering, and admins and team leads publish them. Automation rules act on tickets automatically (for example, tag tickets that mention a refund). Integrations connect Ticketloop to Slack, Shopify, Jira, Salesforce, and Stripe. Queue views (my open tickets, unassigned, urgent, all open, SLA at risk) are where agents start their work; reports show volume, first response time, CSAT, SLA compliance, and agent performance.
- **Reply Assist.** From July 21, Growth and Enterprise customers can have an AI write a draft reply that the agent edits and sends (see 02-timeline.md). A reply sent from a draft carries `reply_method = ai_draft`.

## Plans and pricing

| Plan | List price per agent seat per month | What you get |
|---|---|---|
| Free (`free`) | $0 | One agent seat, all channels, macros, knowledge base, community support |
| Starter (`starter`) | $19 | Any number of seats, everything in Free, email support |
| Growth (`growth`) | $39 until 2026-08-17; $49 for new subscriptions from 2026-08-18 | Everything in Starter, SLA policies and reports, custom roles, Reply Assist from July 21 |
| Enterprise (`enterprise`) | $89 (sales-led, annual contracts) | Everything in Growth, SSO, audit logs, a customer success manager |

All plans include automation rules and integrations.

- **Trials.** A new workspace starts a 14-day trial with Growth features except Reply Assist (`plan_tier = trial`). The owner can buy Starter or Growth at any time during the trial or after it. A workspace that does not buy moves to Free when the trial ends.
- **Buying.** The owner picks a plan, the number of seats, and monthly or annual billing on the pricing page. Seats are licenses: a small team often buys a seat or two for colleagues who start later. Enterprise is sold by the sales team and is not bought in the app.
- **Existing subscribers** keep their price until their renewal.
- The Mixpanel project records each new subscription's plan, seats, and billing period, but not the price. List prices and new MRR live in the warehouse table `subscription_billing_daily`.

## Customers and users

- **Company size** (`company_size`): `small` (up to 8 agents), `mid` (8-25), `large` (25-60). Every one-person workspace is `small`.
- **Industry** (`industry`): `ecommerce`, `saas`, `education`, `fintech`, `healthcare`, `travel`, `gaming`. E-commerce and SaaS are the largest groups.
- **Region** (`region`): `americas`, `emea`, `apac`, by the company's headquarters. About 57% of users work for Americas companies.
- **Roles** (`role`): `agent` (answers tickets), `team_lead` (runs a queue, publishes articles, reads reports), `admin` (sets up the workspace, integrations, and automation rules). The owner of a one-person workspace is its admin and also answers its tickets.
- **Email provider** (`email_provider`): the company's mail host, `google_workspace`, `microsoft_365`, or `other`.
- **Established vs new.** About 55% of active users were Ticketloop users before June 4: agents at customer companies, Free users, and owners of trials that started in late May. New trial signups arrive steadily, about 260 a week.

## How new workspaces find us

New trial signups come through one of six acquisition channels, recorded on the workspace:

- **organic** — search, our blog, and word of mouth.
- **google_ads** — paid search ads.
- **capterra** — paid listings on the Capterra software-review site.
- **linkedin_ads** — paid LinkedIn campaigns aimed at support leaders.
- **partner_referral** — agencies and consultants who recommend us.
- **shopify_app_store** — installs of the Ticketloop app from the Shopify App Store.

Larger customers also came through **outbound_sales**. The three paid channels bill daily; spend is in the warehouse table `paid_marketing_daily`.

## Goals for the period (Q3 2026)

1. **Faster first replies.** First response time is the headline number on every customer's Ticketloop dashboard. The product team launched Reply Assist and is testing Skills Routing; leadership wants to know what each one did.
2. **Happier end customers.** Raise the share of positive CSAT answers and cut reopened tickets.
3. **More trials that finish setup.** The onboarding team wants to know where trials stall and whether it differs by segment.
4. **Efficient acquisition.** Finance asked which paid channel is worth its cost.
5. **Revenue from the Growth price change.** The pricing team raised Growth in August and wants to know whether it helped.
6. **Keep new workspaces.** Customer success believes some early setup habits predict which trials stay, and wants to know which.
7. **Reliable ticket intake.** After the late-August email incident, engineering wants the size of the impact written down.

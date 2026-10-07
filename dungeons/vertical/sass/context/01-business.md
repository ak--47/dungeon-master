# Tallyboard: the business

## Who we are

Tallyboard is a cloud operations platform for engineering teams. One product covers what many teams stitch together from several tools: monitoring dashboards, alerting and on-call response, hosted CI/CD pipelines, and cloud cost reporting. The company has about 220 employees. Customers range from five-person startups to enterprises with up to about a hundred engineers on the platform.

## What customers do in the product

- **Set up.** A new user creates an account, connects a cloud account (the AWS account, Google Cloud project, or Azure subscription their team runs on; some companies run more than one cloud), installs the Tallyboard agent on their hosts or clusters, and creates a first dashboard.
- **Monitor.** Engineers watch service dashboards (service overview, Kubernetes, cost explorer, SLO tracker, custom) and run queries over metrics, logs, and traces. Many customers also read data through the API.
- **Respond to alerts.** Tallyboard raises an alert when a service breaches a threshold (CPU, memory, latency, error rate, disk, saturation). Each alert has a severity (info, warning, critical). An engineer acknowledges the alert, investigates, and resolves it. Resolution can be manual, by running a saved runbook, or (on Business and Enterprise, from July 22) with Root Cause Assist.
- **Ship.** Teams run their CI/CD pipelines on Tallyboard's hosted runners. Runners live in four regions: us-east, us-west, eu-west, and ap-south. A pipeline run that passes deploys the service.
- **Control cost.** Teams generate cloud cost reports and scale infrastructure up or down.
- **Collaborate and integrate.** Users invite teammates and connect integrations: Slack, Microsoft Teams, PagerDuty, Opsgenie, GitHub, Jira, and Terraform. Teams usually connect their tools in their first weeks on Tallyboard and revisit the settings now and then.
- **Root Cause Assist.** An AI assistant for incident resolution. It reads the alert, recent deploys, and related logs, and proposes a likely cause and fix. It is included in Business and Enterprise plans.

## Plans and pricing

| Plan | List price | What you get |
|---|---|---|
| Free | $0 | Dashboards, alerting, limited hosts and pipeline minutes |
| Team | $20 per seat per month until 2026-08-02; $25 per seat per month for new subscriptions from 2026-08-03 | Higher limits, integrations, hosted pipelines |
| Business | $45 per seat per month (unchanged) | Everything in Team, SAML single sign-on (SSO), longer retention, Root Cause Assist (from Jul 22) |
| Enterprise | Custom contract | Everything in Business, dedicated support, customer success manager |

- **Workspaces.** Each customer company has one Tallyboard workspace, and the plan belongs to the workspace: every user at a company is on the company's plan. The engineer who starts a workspace is its owner. Colleagues who sign up later with the same work email join that workspace instead of starting their own.
- **How people upgrade.** Users at Free companies see an upgrade page when they hit a usage limit, a gated feature, a seat limit, or open billing settings. The workspace owner starts a Team or Business subscription for the whole company and chooses the number of seats, usually for the colleagues they plan to bring on, so a new paid workspace often has a seat or two not yet in use; a company has at most one self-serve subscription start. A paid workspace adds members up to its contracted seats; more seats need a seat change through billing. Long-standing customers change plans and seats through their account manager, outside the self-serve flow.
- **Single sign-on.** On Business and Enterprise, colleagues who join the workspace can sign in through the company's identity provider (SAML SSO). Owners who start a new workspace sign up with Google, GitHub, or email.
- **Enterprise** is sold by the sales team on annual contracts and does not go through the self-serve upgrade page.
- The Mixpanel project tracks the subscription start, the plan, and the number of seats, but not the price. Prices and new MRR live in the warehouse table `subscription_bookings_daily`.

## Customers and users

- **Company size** (`company_size`): `startup` (under 50 employees), `smb` (50-200), `mid_market` (200-1,000), and `enterprise` (1,000+). The group property `employee_count` gives the headcount band. Among long-standing customers, larger companies have more Tallyboard users each. New workspaces of any size usually start with one or two engineers.
- **Roles** (`primary_role`): `sre` (site reliability engineers who carry the pager), `platform_engineer` (own infrastructure and pipelines), `developer` (application engineers), and `engineering_manager`.
- **Industry** (`industry`): software, fintech, healthcare, retail, media, logistics, gaming, manufacturing.
- **Cloud** (`cloud_provider`): the company's primary cloud (`aws`, `gcp`, `azure`, or `multi_cloud`).
- **Customer success:** companies on an Enterprise contract have a dedicated customer success manager (CSM), who rates each account's health. Accounts without a CSM are not rated.
- **Where customers are:** about three in five Tallyboard users are in the United States; the rest are spread across Europe, Asia, Latin America, and the Middle East.

## How customers find us

New users arrive through one of six acquisition channels, recorded at signup:

- **organic** — search, word of mouth, content.
- **referral** — invited by a peer at another company.
- **outbound_sales** — sourced by the sales development team.
- **paid_search** — search ads.
- **linkedin_ads** — sponsored content and account-based campaigns on LinkedIn aimed at engineering leaders.
- **g2_reviews** — paid placements and leads from the G2 software review site.

The three paid channels bill for clicks and leads. Daily spend by paid channel is in the warehouse table `paid_marketing_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Grow self-serve revenue.** Increase new paid subscriptions and new MRR. The pricing team raised the Team price in August; leadership asked whether it hurt Team sales and whether it paid off.
2. **Make acquisition efficient.** Marketing put a large share of the paid budget into LinkedIn to reach engineering leaders. Finance asked which paid channels are worth their cost.
3. **Activate new signups.** The growth team believes the first week decides whether a new workspace sticks. They also see too many signups stall during setup.
4. **Cut incident time.** Reduce time to acknowledge (MTTA) and time to resolve (MTTR) alerts. Root Cause Assist is the main bet. The SRE advisory board has raised alert noise as a concern.
5. **Ship faster, more reliably.** Improve pipeline success rates and pipeline speed (the Smart Test Selection experiment).
6. **Close Q3 strong.** Sales ran a seat-expansion promotion in the last two weeks of the quarter.

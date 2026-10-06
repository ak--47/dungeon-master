# Tallyboard: the business

## Who we are

Tallyboard is a cloud operations platform for engineering teams. One product covers what many teams stitch together from several tools: monitoring dashboards, alerting and on-call response, hosted CI/CD pipelines, and cloud cost reporting. The company has about 220 employees. Customers range from five-person startups to enterprises with hundreds of engineers on the platform.

## What customers do in the product

- **Set up.** A new user creates an account, connects their company's cloud account (AWS, Google Cloud, or Azure; some companies run more than one), installs the Tallyboard agent on their hosts or clusters, and creates a first dashboard.
- **Monitor.** Engineers watch service dashboards (service overview, Kubernetes, cost explorer, SLO tracker, custom) and run queries over metrics, logs, and traces. Many customers also read data through the API.
- **Respond to alerts.** Tallyboard raises an alert when a service breaches a threshold (CPU, memory, latency, error rate, disk, saturation). Each alert has a severity (info, warning, critical). An engineer acknowledges the alert, investigates, and resolves it. Resolution can be manual, by running a saved runbook, or (on Business and Enterprise, from July 22) with Root Cause Assist.
- **Ship.** Teams run their CI/CD pipelines on Tallyboard's hosted runners. Runners live in four regions: us-east, us-west, eu-west, and ap-south. A pipeline run that passes deploys the service.
- **Control cost.** Teams generate cloud cost reports and scale infrastructure up or down.
- **Collaborate and integrate.** Users invite teammates and connect integrations: Slack, Microsoft Teams, PagerDuty, Opsgenie, GitHub, Jira, and Terraform.
- **Root Cause Assist.** An AI assistant for incident resolution. It reads the alert, recent deploys, and related logs, and proposes a likely cause and fix. It is included in Business and Enterprise plans.

## Plans and pricing

| Plan | List price | What you get |
|---|---|---|
| Free | $0 | Dashboards, alerting, limited hosts and pipeline minutes |
| Team | $20 per seat per month until 2026-08-16; $25 per seat per month for new subscriptions from 2026-08-17 | Higher limits, integrations, hosted pipelines |
| Business | $45 per seat per month (unchanged) | Everything in Team, SSO, longer retention, Root Cause Assist (from Jul 22) |
| Enterprise | Custom contract | Everything in Business, dedicated support, customer success manager |

- **How people upgrade.** Free users see an upgrade page when they hit a usage limit, a gated feature, a seat limit, or open billing settings. From there they start a Team or Business subscription and choose the number of seats.
- **Enterprise** is sold by the sales team on annual contracts and does not go through the self-serve upgrade page.
- The Mixpanel project tracks the subscription start, the plan, and the number of seats, but not the price. Prices and new MRR live in the warehouse table `subscription_bookings_daily`.

## Customers and users

- **Company size** (`company_size`): `startup` (under 50 employees), `smb` (50-200), `mid_market` (200-1,000), and `enterprise` (1,000+). Larger companies have more Tallyboard users each.
- **Roles** (`primary_role`): `sre` (site reliability engineers who carry the pager), `platform_engineer` (own infrastructure and pipelines), `developer` (application engineers), and `engineering_manager`.
- **Industry** (`industry`): software, fintech, healthcare, retail, media, logistics, gaming, manufacturing.
- **Cloud** (`cloud_provider`): the company's primary cloud (`aws`, `gcp`, `azure`, or `multi_cloud`).
- **Customer success:** enterprise customers and some mid-market customers have a dedicated customer success manager (CSM), who rates each account's health.

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
2. **Make acquisition efficient.** Marketing considers LinkedIn its strongest channel for reaching engineering leaders. Finance asked whether it is worth its cost compared with search.
3. **Activate new signups.** The growth team believes the first week decides whether a new workspace sticks. They also see too many signups stall during setup.
4. **Cut incident time.** Reduce time to acknowledge (MTTA) and time to resolve (MTTR) alerts. Root Cause Assist is the main bet. The SRE advisory board has raised alert noise as a concern.
5. **Ship faster, more reliably.** Improve pipeline success rates and pipeline speed (the Smart Test Selection experiment).
6. **Close Q3 strong.** Sales ran a seat-expansion promotion in the last two weeks of the quarter.

# Forgebench: the business

## Who we are

Forgebench is a developer platform. One product covers the path from a code change to production: pull requests and code review, CI builds on hosted runners, a preview deployment for every push, and production deploys. The company has about 45 employees and serves about 500 customer organizations, from small startups with a handful of developers to enterprises with up to about 300 developers on the platform. The active base is global: developers in India, Europe, and the Americas together cover most working hours of the UTC day.

## What developers do in the product

- **Set up.** A new developer creates an account (with GitHub, Google, GitLab, or email), imports a repository (from GitHub, GitLab, or Bitbucket, from a starter template, or as an empty repository), configures a CI pipeline (auto-detected from the repository, from a starter template, or as custom YAML), and gets a first preview deployment. Setup ends at that first preview.
- **Push and preview.** Every push to a branch builds a preview deployment with its own URL, so reviewers can click through a change before it merges.
- **Build.** CI builds run on Forgebench's hosted runners (standard, large, or extra-large). A build is triggered by a push, a pull request, a schedule (cron), or by hand. A build passes or fails; a failed build records the stage that failed (configuration, dependency install, compile, test, or timeout). Builds fetch dependencies through Forgebench's package registry mirrors (npm, PyPI, Go modules, RubyGems, Maven, NuGet, Cargo).
- **Review and merge.** A developer opens a pull request, a teammate (or, from July 29 on eligible plans, Forge Assist) reviews it, and the author merges it.
- **Ship.** A merged pull request is deployed to production. A deploy either stays healthy or is rolled back. Many customer teams do not deploy to production on weekends.
- **Work around the code.** Developers browse code, read docs, use the `forge` CLI, read build and runtime logs, file issues, invite teammates, and update environment variables.
- **Forge Assist.** An AI code reviewer. It reads a pull request, comments on likely bugs, missing tests, and style problems, and suggests fixes before a human approves. It is included in Pro, Team, and Enterprise from 2026-07-29. Each developer turns it on for their own pull requests.

## Plans and pricing

| Plan | List price | What you get |
|---|---|---|
| Free | $0 | Public and limited private repositories, preview deployments, a small monthly allowance of build minutes |
| Pro | $12 per developer per month | For individual developers: more build minutes, private repositories, Forge Assist (from Jul 29) |
| Team | $29 per seat per month | Shared organization workspace, pooled build minutes, larger runners, Forge Assist (from Jul 29); runner minutes above the pooled allowance are billed at $0.015 per minute from 2026-09-01 |
| Enterprise | Custom contract | Everything in Team, SSO, audit logs, committed runner capacity, dedicated support |

- **Plans belong to organizations.** A company is on Free, Team, or Enterprise, and its developers use that plan. Free workspaces exist at companies of every size: teams at larger companies often try Forgebench on Free before anyone buys. Pro is a personal plan: a developer at a Free company can pay for their own Pro seat. A developer who joins a company that is already on Team or Enterprise is added to that workspace when they sign up.
- **A company can run more than one workspace.** When a developer at a Free company buys Team, Forgebench opens a Team workspace for that developer's group. Their colleagues stay on the Free workspace until they are invited in, so one company can have Free, Pro, and Team developers at the same time while it grows.
- **How people upgrade.** Free developers see an upgrade page when they hit a build-minute limit, a private-repository limit, a preview limit, or a gated feature, or when they open billing settings. From there they buy Pro (one seat) or Team (several seats).
- **Enterprise** is sold by the sales team on annual contracts and does not go through the self-serve upgrade page.
- The Mixpanel project records each subscription start, its plan, and its seat count, not the price. Overage and runner-minute billing live in the warehouse table `usage_billing_daily`.

## Customers and developers

- **Organization size** (`org_size`): `startup` (under 50 employees), `smb` (50-200), `mid_market` (200-1,000), and `enterprise` (1,000+). Larger organizations have more developers on Forgebench each.
- **Industry** (`industry`): saas, fintech, ecommerce, healthtech, media, gaming, logistics, agency.
- **Roles** (`role`): `developer`, `tech_lead`, `platform_engineer` (owns CI and infrastructure), and `engineering_manager`.
- **Primary stack** (`primary_stack`): the language and framework of the developer's main repository: `node`, `python`, `go`, `ruby`, `java`, `dotnet`, `rust`. Each stack maps to a package ecosystem (`npm`, `pypi`, `go_modules`, `rubygems`, `maven`, `nuget`, `cargo`).
- **Repositories.** A developer works in one to three repositories. Each repository has a test coverage figure that Forgebench reads from its CI reports.

## How developers find us

New developers arrive through one of six acquisition channels, recorded at signup:

- **organic** — search, word of mouth, docs.
- **referral** — invited by a developer at another company.
- **community** — open-source projects, meetups, and our developer advocates' content.
- **paid_search** — search ads.
- **paid_social** — sponsored posts on developer social platforms.
- **newsletter** — sponsored placements in developer newsletters.

The three paid channels bid to a target cost per signup that marketing sets for each channel. Daily spend by paid channel is in the warehouse table `marketing_spend_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Activate new developers.** Raise the share of signups who finish setup and keep using Forgebench after their first month. The developer experience team wants to know why some signups never finish setup.
2. **Make paid acquisition efficient.** Finance asked which paid channels are worth their cost.
3. **Ship Forge Assist.** Launch AI code review to paid plans and measure what it changes in code review.
4. **Faster CI.** Cut build times; the Remote Build Cache experiment is the main bet.
5. **Grow paid seats and revenue.** Convert more free developers to paid seats. The growth team suspects early hands-on use predicts who buys. Team overage billing started in September; product asked whether it changed how Team customers use CI.
6. **Ship safely.** The reliability team tracks change failure rate (the share of production deploys rolled back) and wants to know what drives it.

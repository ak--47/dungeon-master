# Cortexa: the business

## Who we are

Cortexa builds large language models and sells access to them through an API. Developers sign up in the Cortexa console, create an API key, and call the models from their own applications: chat assistants, coding tools, document pipelines, content tools, and autonomous agents. The company has about 180 employees and serves its models from GPU clusters in three regions. Revenue comes from metered usage: customers pay per million tokens they send to and receive from the models.

## Products

- **Messages API.** The core product. An application sends a prompt (input tokens) and receives a response (output tokens). Requests can stream the response, and can include tool definitions so the model can call the customer's tools (function calling).
- **Batch API.** Customers submit a file of many requests as one batch job and collect the results when the job finishes. Batch jobs are for work that does not need an immediate answer. A job that does not finish within 24 hours expires.
- **Prompt caching** (generally available from July 8). Customers mark the stable start of a prompt (for example a long system prompt or a reference document) as cacheable. When a later request starts with the same prefix, Cortexa serves that prefix from its prompt cache, and the cached part is billed at a lower input price.
- **Console.** The web app where developers manage API keys, try prompts in the **playground**, run **evaluations** (test a prompt or model against a set of test cases), watch **usage dashboards** (usage, costs, logs, limits), read the **docs**, invite teammates, and manage **billing**.

## Models and list prices

Prices are per million tokens. Cached input tokens are billed at 10% of the model's input price.

| Model | What it is for | Input price | Output price |
|---|---|---|---|
| atlas-2 | Flagship model: highest quality before atlas-3 | $3.00 | $15.00 |
| atlas-3 | New flagship model (from 2026-07-28) | $3.00 | $15.00 |
| swift-2 | Fast, low-cost model for simple, high-volume tasks | $0.80 until 2026-08-17; $0.40 from 2026-08-18 | $4.00 until 2026-08-17; $2.00 from 2026-08-18 |

The Mixpanel project records which model served each request and how many tokens it used, but not the price. Prices, metered usage, and revenue live in the warehouse table `model_billing_daily`.

## Plans

| Plan | How it is billed | What you get |
|---|---|---|
| Free | $0 | $100 of usage at list price per calendar month, the strictest rate limits, community support. No card needed. |
| Build | Pay as you go at list prices from prepaid credits (top-ups from $10) | Higher rate limits, all generally available models, email support. |
| Scale | A committed monthly spend | Higher rate limits than Build, usage reporting, a named support contact. |
| Enterprise | Annual contract, sold by the sales team | Custom limits, SSO, dedicated support, security review. |

- **How accounts upgrade.** A Free account opens the billing page, adds a payment method, buys prepaid credits, and moves to Build. Scale and Enterprise are arranged with sales and do not go through the self-serve billing page.
- **Rate limits.** Every plan has limits on requests per minute and tokens per minute. When an account exceeds a limit, the API rejects requests for a short time (HTTP 429) and the account sees a rate-limit episode.
- **Free usage** is metered like paid usage but is not revenue; finance tracks its list-price value as free credit. The balance is checked before each request: the request that uses up the month's $100 completes, and after that the API rejects the account's requests until the 1st of the next month. Rejected requests are not metered.

## Customers

- **Company size** (`company_size`): `individual` (a solo developer or hobby project), `startup`, `growth` (a scaling company), `enterprise`.
- **What they build** (`use_case`): `chat_assistant`, `coding`, `document_processing`, `agents`, `content_generation`.
- **SDK** (`sdk_language`): the client library the account uses most: `python`, `typescript`, `java`, `go`, or `rest` (raw HTTP).
- **Role** (`primary_role`): `ml_engineer`, `backend_developer`, `data_scientist`, `founder`.
- **Serving region** (`inference_region`): each account's API traffic is served from the GPU region nearest to it: `us-east`, `us-west`, or `eu-west`.

## How developers find us

New accounts arrive through one of six acquisition channels, recorded at signup:

- **organic** — search, word of mouth, technical blog posts.
- **github** — links from open-source projects, cookbooks, and SDK repositories.
- **referral** — invited by a developer at another company.
- **search_ads** — paid search ads.
- **newsletter_sponsorships** — paid placements in developer newsletters and podcasts.
- **hackathons** — sponsored hackathons and student programs.

The three paid channels have media or sponsorship spend. Daily spend by paid channel is in the warehouse table `developer_marketing_daily`.

## Goals for the period (Q3 2026)

1. **Grow paid usage.** Revenue is metered, so it moves with traffic, model mix, prices, and discounts. Finance wants to understand what drove revenue per day after the summer launches.
2. **Activate new accounts.** A signup is only valuable once it makes its first API request. The growth team ran the Interactive Quickstart test to speed that up, and believes early habits decide whether a team builds on Cortexa.
3. **Move customers to atlas-3.** Product wants to know how quickly customers adopt the new flagship and what it does to usage.
4. **Make the API fast and reliable.** Latency and error rate are the platform team's headline metrics. Prompt caching is the main latency bet. The August capacity incident is under review.
5. **Spend developer-marketing money well.** Hackathon sponsorships grew this year. Finance asked which paid channels are worth their cost.
6. **Fewer throttled customers.** Build customers complained about rate limits; the platform team raised Build limits on September 1.

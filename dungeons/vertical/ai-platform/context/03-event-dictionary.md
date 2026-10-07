# Cortexa tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC. Cortexa sends every event from its servers.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The account's ID. Present on every event. There is no `device_id`. |
| `insert_id` | Unique event ID used for de-duplication. |
| `plan_tier` | The account's plan **at the moment of the event**: `free`, `build`, `scale`, or `enterprise`. It changes from `free` to `build` at the moment a Free account upgrades. |
| `country`, `country_code`, `region`, `city` | The account's location (one location per account). |

## Signup and onboarding

| Event | Meaning | Properties |
|---|---|---|
| `account created` | A developer creates a Cortexa account. First product event of every new account (accounts enrolled in the Interactive Quickstart test get `$experiment_started` one second earlier). | `signup_method` (`github`, `google`, `email`, `sso`); `acquisition_channel`: how the developer found us (`organic`, `github`, `referral`, `search_ads`, `newsletter_sponsorships`, `hackathons`); same value as the profile property. |
| `api key created` | The account creates its first API key during onboarding. | `key_environment` (`development`, `production`). |
| `$experiment_started` | Mixpanel experiment exposure, sent at signup (one second before `account created`) for accounts created while the Interactive Quickstart test is live (from 2026-07-01). | `Experiment name` = `Interactive Quickstart`; `Variant name` = `Control` or `Interactive Quickstart`. |

## API traffic

| Event | Meaning | Properties |
|---|---|---|
| `api request` | One API request to the Messages API. **Sampled: one event per 1,000 requests**, chosen at random, so each event stands for 1,000 requests with the same mix. Requests the API rejects (rate limits, a Free account past its monthly allowance) are not recorded. | `model` (`atlas-2`, `atlas-3`, `swift-2`); `input_tokens` (prompt size, including any cached prefix); `cached_input_tokens` (the part of the prompt read from the prompt cache; 0 when none); `cache_hit` (`true` when part of the prompt was read from cache); `output_tokens` (response size; 0 for failed requests); `tool_use` (`true` when the request included tool definitions); `stream` (response streamed); `latency_ms` (time from receiving the request to sending the last token, in milliseconds); `time_to_first_token_ms` (time from receiving the request to sending the first token, in milliseconds: reading and processing the prompt; for failed requests, the time until the error response); `status_code` (`200` success, `400` invalid request, `500` server error, `529` overloaded); `error_type` (`none`, `invalid_request_error`, `api_error`, `overloaded_error`); `stop_reason` (`end_turn`, `max_tokens`, `stop_sequence`, `tool_use` when the model asked to call a tool, `error`); `inference_region` (`us-east`, `us-west`, `eu-west`: where the request was served); `sdk_language` (the client library). |
| `rate limit hit` | A rate-limit episode: the account exceeded a per-minute limit and the API rejected requests (HTTP 429) for a short time. Recorded in full (not sampled). Rejected requests do not produce `api request` events. | `limit_type` (`requests_per_minute`, `input_tokens_per_minute`, `output_tokens_per_minute`); `retry_after_seconds`; `model`. |
| `batch job submitted` | The account submits a Batch API job. | `batch_id`; `model`; `request_count` (requests in the batch); `inference_region`. |
| `batch job completed` | The batch job finishes. Same `batch_id` as its submission. Sent by the platform, also when the account is no longer active. | `batch_id`; `model`; `request_count`; `batch_status` (`completed`, or `expired` when the job did not finish within 24 hours); `processing_hours` (submission to completion). |

## Console

| Event | Meaning | Properties |
|---|---|---|
| `playground session` | The developer tries prompts in the console playground. | `model`; `turns`; `prompt_saved`. |
| `eval run started` | The developer starts an evaluation run (a prompt or model tested against a set of test cases). | `eval_id`; `eval_type` (`accuracy`, `safety`, `regression`, `latency`, `custom_rubric`); `test_cases`; `model`. |
| `eval run completed` | The evaluation run finishes. Same `eval_id` as its start. Sent by the platform. | `eval_id`; `model`; `pass_rate` (percent of test cases passed); `duration_minutes`. |
| `usage dashboard viewed` | The developer opens a usage dashboard. | `dashboard_view` (`usage`, `costs`, `logs`, `limits`); `date_range` (`24h`, `7d`, `30d`). |
| `docs viewed` | The developer reads a docs page. | `doc_section` (`quickstart`, `messages_api`, `tool_use`, `prompt_caching`, `batch_api`, `models`, `rate_limits`, `errors`, `pricing`); `time_on_page_sec`. |
| `member invited` | The account invites a teammate to its organization. | `invitee_role` (`developer`, `admin`, `billing`, `viewer`). |
| `api key rotated` | The account replaces an API key. | `rotation_reason` (`scheduled`, `team_change`, `suspected_leak`). |

## Billing

| Event | Meaning | Properties |
|---|---|---|
| `billing page viewed` | The account opens the billing page (plans, credits, payment methods). Free accounts open it when they consider upgrading. | `billing_section` (`plans`, `credits`, `payment_methods`). |
| `plan upgraded` | A Free account adds a payment method, buys prepaid credits, and moves to Build. At most one per account. Price is **not** tracked here; see `model_billing_daily`. | `from_plan` (`free`); `to_plan` (`build`); `prepaid_credits_usd` (first credit purchase). |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The account's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details of the developer who owns the account. |
| `plan_tier` | Current plan: `free`, `build`, `scale`, `enterprise`. |
| `company_size` | `individual`, `startup`, `growth`, `enterprise` (see 01-business.md). |
| `use_case` | What the account builds: `chat_assistant`, `coding`, `document_processing`, `agents`, `content_generation`. |
| `sdk_language` | Main client library: `python`, `typescript`, `java`, `go`, `rest`. |
| `primary_role` | `ml_engineer`, `backend_developer`, `data_scientist`, `founder`. |
| `acquisition_channel` | Channel at signup (for established accounts, the channel they originally came from). |
| `inference_region` | The region that serves the account's API traffic. |
| `customer_since` | Date the account was created (YYYY-MM-DD). Before 2026-06-04 for established accounts. |
| `created` | Signup time for accounts created in the window (the time of their `account created` event); empty for established accounts. |
| `Experiment: Interactive Quickstart` | `Control` or `Interactive Quickstart` for accounts in the onboarding test; empty for everyone else. |
| `country`, `country_code`, `region`, `city` | Location. |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account created` → `api key created` → `api request` | New accounts only. Read with a 7-day conversion window. Completing it means the account made its first integration call. |
| Batch | `batch job submitted` → `batch job completed` | Accounts run many jobs; hold `batch_id` constant to measure each job on its own. |
| Evals | `eval run started` → `eval run completed` | Hold `eval_id` constant. |
| Upgrade | `billing page viewed` → `plan upgraded` | Free accounts. |

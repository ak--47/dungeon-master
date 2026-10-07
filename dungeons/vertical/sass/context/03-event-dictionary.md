# Tallyboard tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on events

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The user's ID. Present on every event. |
| `device_id` | The device the event came from. A user has about two devices. Present on every event except `cloud account connected`, `agent installed`, and `dashboard created`, which are sent server-side with `user_id` only. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `company_id` | The user's company (Mixpanel group key). See "Company (group) properties". |
| `plan_tier` | The user's plan **at the moment of the event**: `free`, `team`, `business`, or `enterprise`. It changes from `free` to the purchased plan at the moment a user starts a subscription. |
| `cloud_provider` | The company's primary cloud: `aws`, `gcp`, `azure`, or `multi_cloud`. Fixed per user. |
| `country`, `country_code`, `region`, `city` | User location (one location per user). |
| `browser`, `os`, `model`, `screen_height`, `screen_width` | Device details from the web SDK. |

## Signup and onboarding

New users go through setup once, right after they sign up. These four events happen only during setup.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The user creates an account. First event of every new user and the moment their device is linked to their `user_id`. | `signup_method` (`google`, `github`, `email`, `sso`); `acquisition_channel`: how the user found us (`organic`, `referral`, `outbound_sales`, `paid_search`, `linkedin_ads`, `g2_reviews`); same value as the profile property. |
| `cloud account connected` | The user connects the company's cloud account to Tallyboard. | `regions_connected` (1-4): cloud regions included. |
| `agent installed` | The Tallyboard agent starts reporting from the user's hosts or clusters. | `install_method` (`helm`, `docker`, `package`, `terraform`); `hosts_reporting`. |
| `dashboard created` | The user creates their first dashboard. This ends setup. | `template` (`service_overview`, `kubernetes`, `cost_explorer`, `slo_tracker`, `blank`). |

## Monitoring

| Event | Meaning | Properties |
|---|---|---|
| `dashboard viewed` | The user opens a dashboard. | `dashboard_type` (`service_overview`, `kubernetes`, `cost_explorer`, `slo_tracker`, `custom`); `time_range` (`1h` to `30d`). |
| `query executed` | The user runs a query. | `query_type` (`metrics`, `logs`, `traces`); `time_range_hours`; `result_rows`. |
| `api call` | A call to the Tallyboard API with the user's token. | `endpoint`; `method`; `status_code`; `latency_ms`. |

## Alerts and incidents

Every alert has an `alert_id`. The trigger, the acknowledgement, and the resolution of one alert share the same `alert_id`, `severity`, and `alert_type`. Not every alert is acknowledged, and not every acknowledged alert is resolved in Tallyboard.

| Event | Meaning | Properties |
|---|---|---|
| `alert triggered` | Tallyboard pages the user about a threshold breach. | `alert_id`; `severity` (`info`, `warning`, `critical`); `alert_type` (`cpu`, `memory`, `latency`, `error_rate`, `disk`, `saturation`); `service_id`. |
| `alert acknowledged` | The user acknowledges the alert. | `alert_id`; `severity`; `alert_type`; `response_time_mins`: minutes from the trigger to this acknowledgement. |
| `alert resolved` | The user marks the alert resolved. | `alert_id`; `severity`; `alert_type`; `resolution_time_mins`: minutes from the acknowledgement to this resolution; `resolution_method` (`manual`, `runbook`, or `ai_assist` for Root Cause Assist, a Business and Enterprise feature from 2026-07-22); `root_cause` (`config_change`, `capacity`, `bug`, `dependency`, `network`). |

## Pipelines and deploys

| Event | Meaning | Properties |
|---|---|---|
| `deployment pipeline run` | A CI/CD pipeline run on Tallyboard's hosted runners. | `deploy_id`: the run's ID; `pipeline_status` (`success`, `failed`, `cancelled`); `runner_region` (`us-east`, `us-west`, `eu-west`, `ap-south`): where the job ran; `duration_sec`; `commit_count`; `service_id`. |
| `service deployed` | The service from a successful run is deployed. Same `deploy_id` as its run. | `deploy_id`; `environment` (`production`, `staging`); `service_type`. |
| `$experiment_started` | Mixpanel experiment exposure, sent when a user starts a pipeline run while the Smart Test Selection test is live (from 2026-07-15). | `Experiment name` = `Smart Test Selection`; `Variant name` = `Control` or `Smart Selection`. |

## Billing

| Event | Meaning | Properties |
|---|---|---|
| `upgrade page viewed` | A free user opens the upgrade page. | `upgrade_trigger` (`usage_limit`, `feature_gate`, `billing_settings`, `seat_limit`). |
| `subscription started` | The user starts a paid self-serve subscription. At most one per user. Price is **not** tracked here; see `subscription_bookings_daily`. | `plan` (`team` or `business`); `seats`: seats purchased; `billing_cycle` (`monthly`, `annual`). |

## Team, integrations, and operations

| Event | Meaning | Properties |
|---|---|---|
| `teammate invited` | The user invites a colleague to the workspace. | `invitee_role` (`member`, `admin`, `viewer`); `invite_method` (`email`, `sso`, `slack`). |
| `integration configured` | The user connects or reconfigures an integration. Integrations are set up per team by the engineers who own its alert routing and workflow tools, so many users never configure one; a user configures a given integration once. | `integration_type` (`slack`, `microsoft_teams`, `pagerduty`, `opsgenie`, `github`, `jira`, `terraform`). |
| `documentation viewed` | The user reads a docs page. | `doc_section`; `time_on_page_sec`. |
| `runbook executed` | The user runs a saved runbook. | `runbook_id`; `runbook_trigger` (`manual`, `scheduled`); `succeeded`. |
| `cost report generated` | The user generates a cloud cost report. | `report_period`; `total_cost_usd`; `cost_change_percent` vs the prior period. |
| `infrastructure scaled` | The user scales infrastructure from Tallyboard. | `scale_direction` (`up`, `down`); `previous_capacity`; `auto_scaled`. |
| `security scan` | A security or compliance scan runs. | `scan_type`; `findings_count`; `critical_findings`. |
| `feature flag toggled` | The user flips a feature flag. | `flag_name`; `new_state`; `environment`. |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The user's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `company_id`, `company_name` | The user's company. |
| `company_size` | `startup`, `smb`, `mid_market`, `enterprise` (see 01-business.md). Same as the company's group property. |
| `industry` | The company's industry. |
| `primary_role` | `sre`, `platform_engineer`, `developer`, `engineering_manager`. |
| `_persona` | Legacy copy of `primary_role` from an older CRM sync. |
| `plan_tier` | Current plan: `free`, `team`, `business`, `enterprise`. |
| `customer_since` | Date the user first signed up (YYYY-MM-DD). Before 2026-06-04 for established users. |
| `cloud_provider` | The company's primary cloud. |
| `acquisition_channel` | Channel at signup (for established users, the channel they originally came from). |
| `seat_count`, `annual_contract_value`, `customer_success_manager` | The company's contracted seats, annual contract value (USD), and whether it has a CSM. |
| `Experiment: Smart Test Selection` | `Control` or `Smart Selection` for users enrolled in the pipeline test; empty for everyone else. |
| `created` | Signup time for users who joined in the window (the time of their `account created` event); empty for established users. |
| `country`, `country_code`, `region`, `city` | Location. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the user (pipeline metadata). |

## Company (group) properties — `company_id`

| Property | Meaning |
|---|---|
| `company_id` | Group key, `1` to `300`. |
| `name` | Company name. |
| `company_size`, `industry`, `cloud_provider` | As on user profiles. |
| `employee_count` | Headcount band. |
| `annual_contract_value` | Current annual contract value (USD). |
| `contracted_seats` | Seats under contract. |
| `customer_success_manager` | Whether the company has a dedicated CSM. |

## Account health history (slowly changing dimension)

One row per health rating: `distinct_id`, `account_health` (`healthy`, `neutral`, `at_risk`), and `startTime` (UTC, when that rating took effect). A new account gets its first rating at the moment it signs up. Customer success reviews each account often: consecutive rows are typically about a week apart, sometimes three weeks or more, and sometimes only a day apart. A new row is written at every review, even when the rating stays the same, so about a third of rows repeat the previous rating. The export starts each established account's history at its first review inside the window, so an established account has no row before that review. Use it to read an account's rating as of an event's time.

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account created` → `cloud account connected` → `agent installed` → `dashboard created` | New users only. Read with a 7-day conversion window. |
| Monitoring | `dashboard viewed` → `query executed` | Daily habit loop. |
| Incident response | `alert triggered` → `alert acknowledged` → `alert resolved` | Users get many alerts; hold `alert_id` constant to measure each alert on its own. |
| Deploy | `deployment pipeline run` → `service deployed` | Users run many pipelines; hold `deploy_id` constant to measure each run. A run is `success` exactly when its deploy happened. |
| Upgrade | `upgrade page viewed` → `subscription started` | Free users. |
| Cost review | `cost report generated` → `infrastructure scaled` | |
| Runbooks | `documentation viewed` → `runbook executed` | |

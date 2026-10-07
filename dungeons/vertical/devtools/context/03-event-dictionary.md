# Forgebench tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The developer's ID. Present on every event. |
| `device_id` | The device the event came from. A developer has about two devices. Present on every event except `repository imported`, `pipeline configured`, and the setup flow's first `preview deployed`, which the server records with `user_id` only. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `org_id` | The developer's organization (Mixpanel group key). See "Organization (group) properties". |
| `plan_tier` | The developer's plan **at the moment of the event**: `free`, `pro`, `team`, or `enterprise`. It changes from `free` to the purchased plan at the moment a developer starts a subscription. |
| `primary_stack` | The developer's primary stack (`node`, `python`, `go`, `ruby`, `java`, `dotnet`, `rust`). Fixed per developer; the same value as the profile property. |
| `country`, `country_code`, `region`, `city` | Developer location (one location per developer). |
| `os`, `browser`, `model`, `screen_height`, `screen_width` | Device and browser details reported by the web SDK. |

## Signup and setup

New developers go through setup once, right after they sign up. `account created`, `repository imported`, and `pipeline configured` happen only during setup.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The developer creates an account. First event of every new developer and the moment their device is linked to their `user_id`. | `signup_method` (`github`, `google`, `gitlab`, `email`); `acquisition_channel`: how the developer found us (`organic`, `referral`, `community`, `paid_search`, `paid_social`, `newsletter`); same value as the profile property. |
| `repository imported` | The developer brings a repository into Forgebench. | `repo_source` (`github`, `gitlab`, `bitbucket`, `template`, `empty`); `monorepo` (true/false). |
| `pipeline configured` | The developer saves a CI pipeline for the repository. | `config_mode` (`auto_detected`, `starter_template`, `custom_yaml`). |
| `preview deployed` (setup) | The first preview deployment. This ends setup. It carries `commit_sha = onboarding`. | See `preview deployed` below. |

## Pushes and previews

| Event | Meaning | Properties |
|---|---|---|
| `commit pushed` | The developer pushes commits to a branch. | `commit_sha`; `branch_type` (`feature`, `main`, `fix`, `release`); `commits_in_push`. |
| `preview deployed` | A preview deployment of a push is live at its own URL. After setup, a preview carries the `commit_sha` of the push it built. Not every push produces a preview. | `commit_sha`; `preview_build_sec`: seconds to build the preview; `framework` (the stack's web framework, for example `nextjs`, `django`, `spring`). |

## CI builds

Every build has a `build_id`; its `build started` and `build finished` share it. A started build with no `build finished` was cancelled. A build that started shortly before June 4 can have its `build finished` inside the window without its `build started`.

| Event | Meaning | Properties |
|---|---|---|
| `build started` | A CI build starts on a hosted runner. | `build_id`; `trigger` (`push`, `pull_request`, `schedule`, `manual`); `repo_id`; `ecosystem`: the package ecosystem the build installs from (`npm`, `pypi`, `go_modules`, `rubygems`, `maven`, `nuget`, `cargo`); `runner_size` (`standard`, `large`, `xlarge`). |
| `build finished` | The build ends. | `build_id`; `trigger`; `repo_id`; `ecosystem`; `build_status` (`success`, `failed`); `failure_stage` (`none` for a passed build; otherwise `configuration`, `dependency_install`, `compile`, `test`, `timeout`); `build_duration_sec`: seconds from start to finish; `tests_run`. |
| `$experiment_started` | Mixpanel experiment exposure, sent once per developer at their first build after the Remote Build Cache test started (2026-07-08). | `Experiment name` = `Remote Build Cache`; `Variant name` = `Control` or `Remote Cache`. |

## Pull requests and deploys

Every pull request has a `pr_id`. Its four steps share the `pr_id`, the repository, and the size of the change. Not every pull request is reviewed, merged, or deployed. A pull request opened shortly before June 4 can have its later steps inside the window without its `pull request opened` event.

| Event | Meaning | Properties |
|---|---|---|
| `pull request opened` | The developer opens a pull request. | `pr_id`; `repo_id`; `lines_changed`; `files_changed`; `test_coverage_pct`: the repository's test coverage (percent); `review_mode` (`standard`, or `forge_assist` when Forge Assist reviews the pull request). |
| `review submitted` | The first review of the pull request. | Same as above, plus `review_decision` (`approved`, `changes_requested`, `commented`) and `review_wait_hours`: hours from `pull request opened` to this review. |
| `pull request merged` | The pull request is merged. | Same shared properties, plus `merge_method` (`squash`, `merge_commit`, `rebase`). |
| `production deployed` | The merged change is deployed to production. | Same shared properties, plus `deploy_outcome` (`healthy` or `rolled_back`) and `deploy_region` (`us-east`, `eu-west`, `us-west`, `ap-south`). |

## Billing

| Event | Meaning | Properties |
|---|---|---|
| `upgrade page viewed` | A Free developer opens the upgrade page. | `upgrade_trigger` (`build_minutes_limit`, `private_repo_limit`, `preview_limit`, `feature_gate`, `billing_settings`). |
| `subscription started` | The developer buys a paid plan. A developer starts at most one subscription in the window. | `plan` (`pro` or `team`); `seats` (always 1 for Pro); `billing_cycle` (`monthly`, `annual`). |

## Everyday work

| Event | Meaning | Properties |
|---|---|---|
| `code browsed` | The developer views code in the web app. | `view_type` (`file`, `commits`, `blame`, `branches`, `compare`). |
| `docs viewed` | The developer reads a docs page. | `doc_section` (`getting_started`, `ci_configuration`, `preview_environments`, `cli`, `api`, `billing`, `troubleshooting`); `time_on_page_sec`. |
| `cli command run` | The developer runs a `forge` CLI command. | `command` (`forge logs`, `forge deploy`, `forge env pull`, `forge run`, `forge login`); `cli_version`. |
| `logs viewed` | The developer opens logs. | `log_source` (`build`, `runtime`, `edge`); `time_range`. |
| `issue created` | The developer files an issue. | `issue_type` (`bug`, `feature`, `chore`, `security`); `labels_count`. |
| `teammate invited` | The developer invites someone to the organization. | `invite_role` (`developer`, `admin`, `viewer`). |
| `environment variable updated` | The developer changes an environment variable. | `environment` (`production`, `preview`, `development`). |

There are no server-side notification or system events in this project. Every event is an action by the developer or a step of their build, pull request, or deploy.

## User profile properties

| Property | Meaning |
|---|---|
| `org_id`, `org_name`, `org_size`, `industry` | The developer's organization and its size and industry (see 01-business.md). |
| `role` | `developer`, `tech_lead`, `platform_engineer`, `engineering_manager`. |
| `primary_stack` | As on events. |
| `plan_tier` | The developer's current plan (at the end of the window). It is the organization's plan, except for developers with a personal Pro seat or a Team workspace bought in the window (see 01-business.md). |
| `customer_since` | The date the developer joined Forgebench (signup date for developers who joined in the window). |
| `acquisition_channel` | How the developer found us. |
| `Experiment: Remote Build Cache` | `Control` or `Remote Cache` for developers enrolled in the test; empty for developers never exposed. |
| `name`, `email`, `avatar`, `created`, location fields | Standard profile fields. |

## Organization (group) properties

Group key `org_id` (500 organizations). Properties: `name`, `org_size` (`startup`, `smb`, `mid_market`, `enterprise`), `industry`, `employee_count` (band).

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Setup (onboarding) | `account created` → `repository imported` → `pipeline configured` → `preview deployed` | New developers; 7-day conversion window. |
| Pull request | `pull request opened` → `review submitted` → `pull request merged` → `production deployed` | Hold `pr_id` constant to follow one pull request. |
| CI build | `build started` → `build finished` | Hold `build_id` constant. |
| Push to preview | `commit pushed` → `preview deployed` | Hold `commit_sha` constant. |
| Upgrade | `upgrade page viewed` → `subscription started` | Free developers. |

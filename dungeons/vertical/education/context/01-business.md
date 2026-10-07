# Brightpath Academy: the business

## Who we are

Brightpath Academy is an online school for professional skills. Adults use it to change careers, grow in their current role, earn credit for a university course, or learn for its own sake. The company is small, remote-first, and venture-funded, with about 12 employees. Course instructors and cohort facilitators are contractors paid per course run. Learners study on the web and in the iOS and Android apps.

## The catalog

- **68 courses** in six categories: `data_science`, `software_dev`, `business`, `design`, `marketing`, and `languages`. Each course has a level (`beginner`, `intermediate`, `advanced`) and a nominal length of 4 to 8 weeks, with about four lessons per week.
- **Two formats.**
  - **Self-paced** (most of the catalog): learners start any time and move through the lessons at their own speed.
  - **Cohort** (16 courses): a new group of learners starts every Monday and follows a weekly schedule with live sessions, assignment deadlines, and a facilitator. Learners can enroll on any day; they join the group that starts on the next Monday after they enroll and can open the orientation lessons right away. Each group ends on a fixed date (its start date plus the course length), and the certificates for the group's finishers go out on that date. Each cohort course runs one or two live sections a week at fixed times (UTC); a learner attends their own section.
- **Lessons** are videos, readings, or hands-on labs. Video lessons can play at 1x, 1.25x, 1.5x, or 2x; each learner sets a preferred playback speed in their profile settings.
- **Assessment.** Each course has weekly quizzes (pass mark 70%) and assignments (projects, peer reviews, coding exercises, written responses). Assignments in cohort courses have deadlines; self-paced assignments have none.
- **Certificates.** A learner who finishes all of a course's lessons and assessments earns a certificate for that course. Certificates are available on every plan.
- **Ask Bright** is an AI tutor in the lesson and quiz pages. Learners ask it to explain a concept, check an answer, give a hint, or summarize a lesson. It is included in Plus and Teams from July 21, 2026.

## Plans and pricing

| Plan | Price | What you get |
|---|---|---|
| Free | $0 | Enroll in courses, all lesson types, quizzes and certificates. Free learners see an upgrade prompt (paywall) when they pass the free enrollment allowance, open a certificate upsell, try offline downloads, or (from July 21) try Ask Bright. |
| Plus | Monthly: $29 per month until 2026-08-09, $35 per month for new subscribers from 2026-08-10. Annual: $239 per year (unchanged). | Unlimited enrollments, offline downloads, graded project feedback, and Ask Bright (from July 21). |
| Teams | Contract price per seat, paid by the employer | Everything in Plus. The employer's learning team often assigns a learning path. |

- **How learners upgrade.** A free learner sees a paywall, then starts a Plus subscription and picks monthly or annual billing. Each learner subscribes at most once in the window.
- **Brightpath for Teams** is sold by the business sales team to employers. Teams learners never see a paywall and never buy Plus themselves.
- The Mixpanel project tracks the subscription start and the billing interval, but not the price. List prices and bookings live in the warehouse table `subscription_billing_daily`.

## Learners

- **Account type** (`account_type`): `individual` (self-pay; Free or Plus) or `employer_sponsored` (a Teams seat).
- **Learner segment** (`learner_segment`), from the onboarding questionnaire:
  - `career_switcher` — preparing for a new career, often studying many hours a week.
  - `upskiller` — growing in their current job; the largest group of Teams learners.
  - `university_student` — taking Brightpath courses through or alongside a degree program, many through the university partnership program.
  - `lifelong_learner` — learning for interest, usually a few hours a week.
- **Primary goal** (`primary_goal`) follows the segment: `change_careers`, `advance_in_role`, `earn_course_credit`, `personal_interest`.

## How learners find us

New learners arrive through one of seven channels, recorded at signup:

- **organic_search** — search engines, content, word of mouth.
- **paid_search** — search ads on course topics.
- **paid_social** — ads on social platforms.
- **youtube_ads** — video ads.
- **referral** — invited by a friend.
- **university_partnership** — students at partner universities.
- **employer** — Teams learners invited by their employer.

The three paid channels bill for ad delivery. Daily spend by paid channel is in the warehouse table `paid_marketing_daily`.

## Goals for the period (Q3 2026)

1. **Grow Plus revenue.** The pricing team raised the monthly Plus price in August. Leadership asked whether it paid off.
2. **Make Ask Bright a reason to upgrade.** The product team wants to know who uses it and whether it helps learners.
3. **Convert browsers into learners.** The growth team runs a course page recommendations test. They also see many new signups who never start a course.
4. **Help learners finish.** Course completion is the north-star outcome. The learning team believes the cohort experience keeps learners going; leadership asked whether to build more cohort courses.
5. **Spend paid marketing well.** Marketing has grown paid social alongside search and YouTube. Finance asked which paid channels are worth their cost.
6. **Keep the apps reliable.** Mobile learning is growing, and the mobile team ships an app release every few weeks.

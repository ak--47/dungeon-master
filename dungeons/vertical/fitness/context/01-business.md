# Stridewell: the business

## Who we are

Stridewell is a consumer fitness app for people who want to train consistently without a gym membership or a personal trainer. Members plan workouts, do them with the phone or a connected wearable, see their progress, compete in challenges with friends, book short sessions with human coaches, and log meals. The company is a venture-backed startup with about 60 employees. Most members are in North America and Western Europe.

## What members do in the app

- **Plan and train.** A member picks a workout (strength, running, HIIT, yoga, cycling, or walking) and schedules it. When they finish, the app records the workout. The core habit loop is *plan → train → check progress*.
- **Track.** A workout can be tracked by a connected wearable (smartwatch, fitness band, or chest strap), by the phone's sensors, or entered by hand. A wearable workout reaches Stridewell when the device syncs after the workout.
- **Progress.** Members check weekly minutes, streaks, body weight, personal records, and heart-rate trends.
- **Challenges.** Members join time-boxed challenges (steps, strength, streak, or distance) that run for 7, 14, 21, or 30 days, either **solo** or as part of a **team** with other members. A member completes a challenge when their challenge period ends, if they met its goal. Each challenge has its own ID; everyone on a team shares the team challenge's ID. Team challenges are rolling: a team stays open to new members for a week, and each member's challenge period starts on the day they join, so teammates who join on different days finish on different days. Free members can be in up to 3 running challenges at a time; Plus members have no limit.
- **Social.** Members add friends and view leaderboards (friends, challenge, city, global).
- **Coaching.** Members can book short sessions with certified human coaches (live video, form checks, plan reviews, chat). Coaching is part of Plus: Plus members and members in a trial book sessions as part of their plan. Free members can pay $24 for a single session. Sessions are delivered by a network of about 50 contract coaches, managed by a small in-house coaching team.
- **Nutrition.** Members log meals with calories and protein.
- **Stride Coach.** An AI coaching mode for Plus members (and members in a Plus trial) that guides a workout in real time (pacing, rest, and form cues). It launched in August (see the timeline).

## Plans and pricing

| Plan | Price | What you get |
|---|---|---|
| Free | $0 | Workout planning and tracking, basic progress, up to 3 running challenges at a time, friends; single coach sessions at $24 each |
| Plus Monthly | $12.99/month until 2026-08-31; $14.99/month for new purchases from 2026-09-01 | Full workout library, advanced plans, human coach sessions, Stride Coach (from Aug 12), unlimited challenges |
| Plus Annual | $99.99/year (unchanged) | Same as Plus Monthly |

- **Trials.** A member who joins gets one 7-day free trial of Plus, with every Plus feature. Most members who joined before the window have already used their trial and can only buy directly. Members who joined in the last few weeks before June 4 and had not started their trial yet (or were still in it) keep it, so some trials and trial conversions in early June come from them.
- **How people upgrade.** A paywall appears when a free member opens a Plus feature (workout library, advanced plans, a Stride Coach teaser, the challenge limit, or settings). From there they start a trial or buy. Members in a trial also see the paywall, as the prompt to pick a plan before the trial ends.
- **Billing.** Purchases go through the Apple and Google app stores. The stores keep a 15% fee on subscriptions. Finance reports bookings at list price (gross) and after store fees (net).
- The Mixpanel project tracks the purchase event and the plan, but not the price. Prices and bookings live in the warehouse table `subscription_billing_daily`.

## How members find us

New members arrive through one of five acquisition channels, recorded once at signup:

- **organic** — app store search, word of mouth, press.
- **referral** — invited by a friend.
- **paid_social** — ads on social and short-video platforms.
- **paid_search** — search ads.
- **app_store_ads** — paid placements inside the app stores.

The three paid channels are bought on a cost-per-install basis against a daily media plan that marketing sets ahead of time. Daily spend by paid channel is in the warehouse table `paid_acquisition_daily`.

## Member segments

The business uses five lifestyle segments (profile property `segment`). They come from the onboarding survey and in-app behavior.

- **casual** — exercises a few times a week for general health. The largest group.
- **beginner** — new to regular exercise; lighter usage.
- **social** — motivated by friends, challenges, and leaderboards.
- **athlete** — trains often and seriously; heavy users.
- **trainer** — fitness professionals who use Stridewell for their own training and to stay current; heavy users.

Other member attributes: primary goal (lose weight, build strength, improve endurance, stay active, reduce stress), fitness level (beginner to elite, self-reported and updated over time), wearable owned, platform (iOS or Android), and current plan.

## Goals for the period (Q3 2026)

Leadership set these goals for the summer and Q3:

1. **Grow new members** through the Summer Shred campaign without letting acquisition cost run away.
2. **Improve new-member activation.** The growth team believes the first week decides whether someone becomes a regular, and is testing a guided first-week plan.
3. **Grow Plus revenue.** The pricing team raised the Monthly price in September. Leadership asked whether the price change hurt sign-ups and whether it paid off.
4. **Launch Stride Coach** to make Plus more valuable.
5. **Keep members engaged** through challenges and the Fall Reset program, without overdoing notifications. The lifecycle team is reviewing notification frequency caps.
6. **Reliability.** Wearable sync must be dependable; members notice when a workout goes missing.

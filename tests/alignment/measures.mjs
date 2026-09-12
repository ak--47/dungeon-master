import { evaluateFunnel } from '../../lib/verify/funnel-engine.js';

export function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function wilson(successes, total) {
  if (!total) return [NaN, NaN];
  const z = 1.959963984540054;
  const rate = successes / total;
  const denominator = 1 + z * z / total;
  const center = (rate + z * z / (2 * total)) / denominator;
  const radius = z * Math.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total)) / denominator;
  return [center - radius, center + radius];
}

export function range(values) {
  return [Math.min(...values), Math.max(...values)];
}

export function profileIds(profiles, key, value) {
  return new Set(profiles.filter(profile => profile[key] === value).map(profile => profile.distinct_id));
}

export function measureReport(events, { steps, options, userIds }) {
  const streams = new Map();
  for (const event of events) {
    if (!event.user_id || (userIds && !userIds.has(event.user_id))) continue;
    if (!streams.has(event.user_id)) streams.set(event.user_id, []);
    streams.get(event.user_id).push(event);
  }
  const attempts = [];
  const perUserHours = [];
  let uniqueEntrants = 0;
  for (const stream of streams.values()) {
    stream.sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
    const result = evaluateFunnel(stream, steps, options);
    const userAttempts = Array.isArray(result) ? result : [result];
    attempts.push(...userAttempts);
    if (userAttempts.some(attempt => attempt.reached >= 0)) uniqueEntrants++;
    const completions = userAttempts.filter(attempt => attempt.completed);
    if (completions.length) perUserHours.push(mean(completions.map(attempt => attempt.ttcMs / 3600000)));
  }
  const entered = attempts.filter(attempt => attempt.reached >= 0);
  const completed = entered.filter(attempt => attempt.completed);
  return { entrants: entered.length, converted: completed.length,
    rate: completed.length / entered.length, meanHours: mean(completed.map(attempt => attempt.ttcMs / 3600000)),
    uniqueEntrants, uniqueConverted: perUserHours.length, conversionWilson95: wilson(perUserHours.length, uniqueEntrants),
    perUserMeanHours: mean(perUserHours), perUserMedianHours: median(perUserHours) };
}

export function volumePerUser(events, userIds) {
  return events.filter(event => userIds.has(event.user_id)).length / userIds.size;
}

export function measureRetention(events, { birthEvent, day, datasetEnd, userIds }) {
  const births = new Map();
  for (const event of events) {
    if (event.event !== birthEvent || !event.user_id || (userIds && !userIds.has(event.user_id))) continue;
    const time = Date.parse(event.time);
    births.set(event.user_id, Math.min(births.get(event.user_id) ?? Infinity, time));
  }
  const eligible = new Set([...births].filter(([, time]) => time + (day + 1) * 86400000 <= Date.parse(datasetEnd)).map(([userId]) => userId));
  const returned = new Set(events.filter(event => eligible.has(event.user_id) &&
    Math.floor((Date.parse(event.time) - births.get(event.user_id)) / 86400000) === day).map(event => event.user_id));
  return { entrants: eligible.size, returned: returned.size, rate: returned.size / eligible.size,
    wilson95: wilson(returned.size, eligible.size) };
}

export function measureFunnel(events, options) {
  const { entry, outcome, windowHours, entryFilter = () => true, userIds } = options;
  const streams = new Map();
  for (const event of events) {
    const userId = event.user_id;
    if (!userId || (userIds && !userIds.has(userId))) continue;
    if (!streams.has(userId)) streams.set(userId, []);
    streams.get(userId).push(event);
  }
  const durations = [];
  let entrants = 0;
  let converted = 0;
  let attempts = 0;
  let convertedAttempts = 0;
  for (const stream of streams.values()) {
    stream.sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
    const entries = stream.filter(event => event.event === entry && entryFilter(event));
    if (!entries.length) continue;
    entrants++;
    let userConverted = false;
    for (const [index, start] of entries.entries()) {
      attempts++;
      const startMs = Date.parse(start.time);
      const nextMs = index + 1 < entries.length ? Date.parse(entries[index + 1].time) : Infinity;
      const finish = stream.find(event => event.event === outcome && Date.parse(event.time) >= startMs &&
        Date.parse(event.time) < nextMs && Date.parse(event.time) <= startMs + windowHours * 3600000);
      if (finish) {
        convertedAttempts++;
        if (!userConverted) durations.push((Date.parse(finish.time) - startMs) / 3600000);
        userConverted = true;
      }
    }
    if (userConverted) converted++;
  }
  return { entrants, converted, rate: converted / entrants, attempts, convertedAttempts,
    attemptRate: convertedAttempts / attempts, meanHours: mean(durations) };
}
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const evidence = JSON.parse(readFileSync(new URL('./evidence.json', import.meta.url), 'utf8'));

describe('retained v1.8.2 live evidence', () => {
  it('records complete passing acceptance sets inside the authorized event budget', () => {
    expect(evidence.projectId).toBe(4063241);
    expect(evidence.imported).toBeLessThanOrEqual(evidence.eventLimit);
    expect(evidence.reserved).toBeLessThanOrEqual(evidence.eventLimit);
    expect(evidence.reports).toHaveLength(8);
    for (const report of evidence.reports) {
      expect(report.failed, report.label).toBe(0);
      expect(report.effectsFailed || 0, report.label).toBe(0);
      const checks = report.checks || report.findings;
      expect(checks.length, report.label).toBe(report.passed);
      expect(checks.every(check => check.pass), report.label).toBe(true);
      expect((report.effects || []).every(effect => effect.pass), report.label).toBe(true);
    }
    expect(evidence.comparisons).toBe(evidence.reports.reduce((sum, report) => sum + report.passed, 0));
    expect(evidence.effects).toBe(evidence.reports.reduce((sum, report) => sum + (report.effectsPassed || 0), 0));
  });

  it('retains query provenance, unsampled responses, and historical failed cases', () => {
    expect(evidence.analyticsRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.queries.length).toBeGreaterThan(50);
    for (const query of evidence.queries) {
      expect(query.request.project_id).toBe(evidence.projectId);
      expect(JSON.stringify(query.request)).toContain(query.runId);
      expect(query.responseHash).toMatch(/^[a-f0-9]{64}$/);
      expect(query.metadata?.is_segmentation_limit_hit || false).toBe(false);
      expect(query.metadata?.min_sampling_factor ?? 1).toBe(1);
    }
    expect(evidence.historicalPatternFailures.failed).toBeGreaterThan(0);
  });
});
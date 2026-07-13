import { describe, expect, it } from 'vitest';

function servicePercentage(criteria: { result: string; weight: number }[]) {
  const applicable = criteria.filter((c) => c.result !== 'NOT_REQUIRED');
  const max = applicable.reduce((sum, c) => sum + c.weight, 0);
  const passed = applicable.filter((c) => c.result === 'PASSED').reduce((sum, c) => sum + c.weight, 0);
  return max === 0 ? 100 : (passed / max) * 100;
}

describe('service score calculation', () => {
  it('does not penalize NOT_REQUIRED criteria', () => {
    expect(servicePercentage([{ result: 'PASSED', weight: 1 }, { result: 'NOT_REQUIRED', weight: 5 }])).toBe(100);
  });
});

export const p1GroundingPlan = Object.freeze([
  Object.freeze({ offset: 0, maxCases: 1, maxRetries: 1 }),
  Object.freeze({ offset: 1, maxCases: 19, maxRetries: 2 }),
  Object.freeze({ offset: 20, maxCases: 20, maxRetries: 2 }),
  Object.freeze({ offset: 40, maxCases: 20, maxRetries: 2 }),
  Object.freeze({ offset: 60, maxCases: 10, maxRetries: 1 }),
]);

export const p1GroundingReportCount = p1GroundingPlan.length;

export function groundingReportPath(entry) {
  return `outputs/p1-live/grounding-${String(entry.offset).padStart(2, '0')}.json`;
}


export const p1GroundingMaximumRetryCalls = p1GroundingPlan.reduce(
  (total, entry) => total + entry.maxRetries,
  0,
);

// Merge moderation signals (task #AI-33). Pure.
// Worst verdict wins (Reject > Warning > Pass), severity = max, reasons concatenated in input order
// (AI first, then geo); each reason carries `source` from its result when it has none.
import { VERDICT } from '../entities/moderation-case.js';

const RANK = Object.freeze({ [VERDICT.PASS]: 0, [VERDICT.WARNING]: 1, [VERDICT.REJECT]: 2 });

export function mergeVerdicts(results = []) {
  let verdict = VERDICT.PASS;
  let severity = 0;
  const reasons = [];
  for (const r of results) {
    if (r == null) continue;
    // An unknown verdict is a doubt: it counts as Warning so a human looks at it.
    const v = Object.hasOwn(RANK, r.verdict) ? r.verdict : VERDICT.WARNING;
    if (RANK[v] > RANK[verdict]) verdict = v;
    if (typeof r.severity === 'number' && r.severity > severity) severity = r.severity;
    for (const reason of r.reasons ?? []) {
      reasons.push(reason.source || !r.source ? { ...reason } : { ...reason, source: r.source });
    }
  }
  return { verdict, severity, reasons, warning: verdict === VERDICT.WARNING };
}

/**
 * axe-core for the browser tests: the rules of WCAG 2.0, 2.1 and 2.2 at
 * levels A and AA. A test expects the list to be empty, so a violation
 * fails with the rule and the elements it found.
 */
import axe from 'axe-core';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The violations axe finds in `node` and its shadow roots, one line per rule and element. */
export async function violations(node: Element): Promise<string[]> {
  const result = await axe.run(node, { runOnly: { type: 'tag', values: TAGS } });
  return result.violations.flatMap((rule) =>
    rule.nodes.map(
      (found) => `${rule.id}: ${found.target.join(' ')} ${found.failureSummary ?? ''}`,
    ),
  );
}

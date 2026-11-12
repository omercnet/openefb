// Test-only: reads raw multi-line string fixtures (`static let NAME = ... #"""` ... `"""#`) straight from the Swift
// tests, so reference fixtures stay in place in efb-212Tests/ instead of being copied (port method, plan 5.2).
import { readFileSync } from 'fs';
import { join } from 'path';

export const REPO_ROOT = join(__dirname, '../../..');

export function swiftRawFixture(swiftTestFile: string, name: string): string {
  const lines = readFileSync(join(REPO_ROOT, 'efb-212Tests', swiftTestFile), 'utf8').split('\n');
  const start = lines.findIndex((l) => new RegExp(`\\b${name}\\b.*#"""\\s*$|\\b${name}\\b.*Data\\(#"""\\s*$`).test(l));
  if (start < 0) throw new Error(`fixture ${name} not found in ${swiftTestFile}`);
  const end = lines.findIndex((l, i) => i > start && l.includes('"""#'));
  if (end < 0) throw new Error(`fixture ${name} is not terminated in ${swiftTestFile}`);
  const indent = /^\s*/.exec(lines[end])?.[0].length ?? 0;
  return lines
    .slice(start + 1, end)
    .map((l) => l.slice(Math.min(indent, /^\s*/.exec(l)?.[0].length ?? 0)))
    .join('\n');
}

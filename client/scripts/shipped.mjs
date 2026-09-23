#!/usr/bin/env node
/* What has actually gone out, per platform.
 *
 * The build number used to be one counter shared by both platforms:
 * make-ipa.sh took max(iOS, Android) + 1 and wrote it to BOTH project files.
 * It kept them in step, and it also meant one platform's history could drag
 * the other's. On 23 September 2026 the iOS project had drifted back to 3
 * while Android had shipped 81, so the next TestFlight build jumped to 82 -
 * correct, and impossible to explain to anybody looking at the two numbers.
 *
 * The owner asked the same day to keep track of what shipped, and for the
 * next build to follow what THAT platform's testers already have. So each
 * platform now counts on its own, and this file is the record both the
 * scripts and a person read.
 *
 *   node scripts/shipped.mjs last ios|android       -> the last build shipped
 *   node scripts/shipped.mjs add ios|android <version> <build> [notes]
 *
 * The log is Markdown, newest first, so it reads as a changelog and never
 * needs a tool to open.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, '..', 'SHIPPED.md');
const WHERE = { ios: 'TestFlight', android: 'Firebase App Distribution' };

const rows = () => {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').split('\n')
    .filter((l) => l.startsWith('| 20'))          // a data row starts with its date
    .map((l) => l.split('|').map((c) => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1))
    .map(([when, platform, version, build, to, notes]) => ({
      when, platform, version, build: Number(build), to, notes,
    }));
};

/* The build this platform shipped LAST, not the highest it has ever shipped.
 *
 * It was the highest, and on 23 September 2026 that was wrong in a way that
 * mattered: iOS had jumped to 83 by accident, the owner put it back on its own
 * line at 4, and the next build came out as 84 again - the file was still
 * remembering the accident. The rows are newest first, so the first row for a
 * platform is what it actually shipped last, and the count follows the line the
 * owner put it on.
 *
 * Nothing is reused by accident: make-ipa.sh and ship-apk.sh take the higher of
 * this and the number in the project file, so a build made and never shipped
 * still cannot be minted twice. */
const last = (platform) => {
  const mine = rows().filter((r) => r.platform === platform);
  return mine.length ? mine[0].build : 0;
};

const HEAD = `# What has shipped

Every build that went to a tester, newest first. Each platform counts on its
own: the next iOS build is the last iOS build plus one, and the same for
Android. Nothing shared, so one platform can never drag the other's number.

Written by \`scripts/shipped.mjs\`, which \`ship-apk.sh\` and \`ship-ipa.sh\`
call on a successful upload. Add a row by hand only if you shipped by hand.

| Date | Platform | Version | Build | To | What went in it |
| --- | --- | --- | --- | --- | --- |
`;

function add(platform, version, build, notes) {
  const when = new Date().toISOString().slice(0, 10);
  const row = `| ${when} | ${platform} | ${version} | ${build} | ${WHERE[platform] || '-'} | ${String(notes || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()} |`;
  if (!existsSync(LOG)) { writeFileSync(LOG, `${HEAD + row}\n`); return; }
  /* Straight under the separator, so the newest row is genuinely the first.
     It used to skip a line past it and insert SECOND, which left whatever row
     happened to be at the top pinned there for good - and `last` then read
     that stale row as the most recent ship (23 September 2026). */
  const text = readFileSync(LOG, 'utf8');
  const at = text.indexOf('| --- |');
  const end = text.indexOf('\n', at);
  writeFileSync(LOG, `${text.slice(0, end + 1) + row}\n${text.slice(end + 1)}`);
}

const [cmd, platform, version, build, ...notes] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform)) {
  console.error('usage: shipped.mjs last|add ios|android [version] [build] [notes]');
  process.exit(1);
}
if (cmd === 'last') process.stdout.write(String(last(platform)));
else if (cmd === 'add') add(platform, version, Number(build), notes.join(' '));
else { console.error(`unknown command: ${cmd}`); process.exit(1); }

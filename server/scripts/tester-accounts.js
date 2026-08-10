/**
 * The tester roster — the single source of truth for who has an account and
 * what their password is.
 *
 * Both scripts/seed-testers.js (which creates them) and
 * scripts/mail-credentials.js (which tells people about them) read this file,
 * so the password that was created and the password that was emailed cannot
 * drift apart. Editing the list in one script and not the other would send
 * people credentials that do not work, which is worse than sending nothing.
 *
 * One named login per tester, each with its own password. Every action in the
 * app is recorded against a public id, so a shared login makes the audit trail
 * and the feedback attribution useless — you can see what happened but not who
 * did it, which is the only thing they exist to tell you.
 *
 * `email` is the tester's real address, matching their Firebase App
 * Distribution invite, so the person receiving the build and the account
 * signing in are demonstrably the same human, and a password reset reaches
 * them. Accounts are created pre-verified — no code to enter on first sign-in.
 *
 * ── Why the roster is NOT in this file ──────────────────────────────────────
 * The list pairs real personal email addresses with plaintext passwords. That
 * is people's PII and a set of live credentials for the demo deployment, so it
 * cannot live in version control — a repo that is private today can be made
 * public later, and history is forever. The data now lives in
 * scripts/tester-roster.json, which .gitignore excludes; copy
 * tester-roster.example.json to that name and fill it in.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROSTER_PATH  = path.join(__dirname, 'tester-roster.json');
const EXAMPLE_PATH = path.join(__dirname, 'tester-roster.example.json');

function loadRoster() {
  if (!fs.existsSync(ROSTER_PATH)) {
    throw new Error(
      `Tester roster not found at ${ROSTER_PATH}\n` +
      `It is deliberately gitignored — it holds real email addresses and plaintext\n` +
      `passwords. Create it by copying the example and filling in the real roster:\n` +
      `  cp ${EXAMPLE_PATH} ${ROSTER_PATH}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`${ROSTER_PATH} is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${ROSTER_PATH} must be a non-empty array of account objects`);
  }

  // Fail loudly on a malformed entry rather than seeding a half-built account:
  // seed-testers.js and mail-credentials.js both assume every field is present,
  // and a missing password would otherwise surface as an unusable login that
  // nobody notices until a tester tries to sign in.
  const REQUIRED = ['person', 'username', 'email', 'role', 'password'];
  parsed.forEach((acct, i) => {
    const missing = REQUIRED.filter(k => !acct[k]);
    if (missing.length) {
      throw new Error(`${ROSTER_PATH}: entry ${i} is missing ${missing.join(', ')}`);
    }
  });

  return parsed;
}

const ACCOUNTS = loadRoster();

module.exports = { ACCOUNTS };

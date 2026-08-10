#!/usr/bin/env node
/**
 * Seed the tester organization with accounts, and write the credentials to a
 * file for handing out.
 *
 *   node scripts/seed-testers.js            # dry run
 *   node scripts/seed-testers.js --yes      # create the accounts
 *
 * Run it after scripts/reset-data.js. It reuses the empty organization that
 * the reset created rather than making a second one.
 *
 * Passwords satisfy the app's own policy (>=8 chars, upper, lower, digit,
 * special) and are hashed with the same bcrypt cost the signup path uses, so
 * these accounts are indistinguishable from ones created through the UI.
 *
 * The credentials file it writes is gitignored. Do not commit it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const GO = process.argv.includes('--yes');
const ROOT = path.resolve(__dirname, '..');
const AUTH_DB = path.join(ROOT, 'data', 'auth.db');
const OUT_FILE = path.resolve(ROOT, '..', 'TESTER-CREDENTIALS.md');

const ORG_NAME = process.env.SEED_ORG_NAME || 'THE TESTERS';
const DOMAIN = process.env.SEED_DOMAIN || 'racktrack.test';

// The roster lives in scripts/tester-accounts.js so the script that CREATES
// the accounts and the script that EMAILS them cannot disagree about a password.
const { ACCOUNTS } = require('./tester-accounts.js');

// Kept from the earlier round so role-specific flows can be exercised without
// borrowing a real person's account. Already created; listed so the handout
// stays complete.
const SPARE_USERNAMES = ['testadmin', 'testlead', 'tester01', 'tester02', 'tester03',
                         'tester04', 'tester05', 'tester06', 'tester07'];

const say = (...a) => console.log(...a);

function main() {
  if (!fs.existsSync(AUTH_DB)) { console.error(`✗ no database at ${AUTH_DB}`); process.exit(1); }
  const db = new Database(AUTH_DB);

  const owner = db.prepare("SELECT id, email, username, public_id FROM users WHERE role='owner' ORDER BY id LIMIT 1").get();
  if (!owner) { console.error('✗ no owner account — run scripts/reset-data.js first.'); process.exit(1); }

  // Reuse the organization the reset created; only make one if it is missing.
  let org = db.prepare('SELECT id, slug, name FROM organizations WHERE name = ?').get(ORG_NAME)
         || db.prepare('SELECT id, slug, name FROM organizations ORDER BY id DESC LIMIT 1').get();

  say(`\nSeed tester accounts — ${GO ? 'LIVE' : 'DRY RUN (pass --yes to apply)'}`);
  say(`database: ${AUTH_DB}`);
  say(`owner:    ${owner.username} <${owner.email}>`);

  const existing = ACCOUNTS.filter(a =>
    db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(a.username));
  if (existing.length) {
    say(`\n! already present, will be skipped: ${existing.map(a => a.username).join(', ')}`);
  }

  const run = db.transaction(() => {
    if (!org) {
      const slug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const r = db.prepare(
        "INSERT INTO organizations (slug, name, created_by, created_at, status) VALUES (?,?,?,datetime('now'),'active')"
      ).run(slug, ORG_NAME, owner.id);
      org = { id: r.lastInsertRowid, slug, name: ORG_NAME };
      say(`  created organization ${ORG_NAME} (id=${org.id})`);
    }

    // Every non-admin account needs a site (tenant) to belong to.
    let site = db.prepare('SELECT id, slug, name FROM tenants WHERE organization_id = ? ORDER BY id LIMIT 1').get(org.id);
    if (!site) {
      const r = db.prepare(
        "INSERT INTO tenants (slug, name, created_at, organization_id) VALUES (?,?,datetime('now'),?)"
      ).run(`${org.slug}-site`, `${org.name} Site`, org.id);
      site = { id: r.lastInsertRowid, name: `${org.name} Site` };
      say(`  created site ${site.name} (id=${site.id})`);
    }

    for (const a of ACCOUNTS) {
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(a.username)) continue;
      // Their real address, so the person invited on Firebase and the account
      // signing in are the same human, and password reset reaches them.
      const email = a.email || `${a.username}@${DOMAIN}`;
      if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
        say(`  ! skipped ${a.username} — ${email} is already registered`);
        continue;
      }
      const hash = bcrypt.hashSync(a.password, 10);
      // org_admin belongs to the organization but not to a specific site,
      // matching what POST /api/orgs does when it creates an org's admin.
      const tenantId = a.role === 'org_admin' ? null : site.id;
      const r = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified, role, organization_id, tenant_id, active)
                            VALUES (?,?,?,1,?,?,?,1)`)
        .run(email, a.username, hash, a.role, org.id, tenantId);
      a._id = r.lastInsertRowid;
      a._email = email;
      say(`  created ${a.role.padEnd(13)} ${a.username.padEnd(11)} ${email}`);
    }
    return { org, site };
  });

  if (!GO) {
    say('\nWould create:');
    for (const a of ACCOUNTS) say(`  ${a.role.padEnd(13)} ${a.username.padEnd(11)} ${a.email || `${a.username}@${DOMAIN}`}`);
    say(`\nAnd write ${OUT_FILE}`);
    say('\nDry run only — nothing was changed.');
    db.close();
    return;
  }

  const { org: o, site: s } = run();

  // Read back the assigned public ids so the handout matches what the app shows.
  const rows = db.prepare(
    `SELECT username, email, role, public_id FROM users WHERE organization_id = ? ORDER BY id`
  ).all(o.id);
  db.close();

  const byName = Object.fromEntries(rows.map(r => [r.username.toLowerCase(), r]));
  const stamp = new Date().toISOString().slice(0, 10);

  const md = `# RackTrack — Tester Credentials

Generated ${stamp} · organization **${o.name}** · site **${s.name}**

> These are test accounts on a test organization. Do not commit this file and
> do not reuse these passwords anywhere real. Regenerate with
> \`node server/scripts/seed-testers.js --yes\`.

## Sign in

Leave **Organization** blank on the sign-in screen — the account already knows
which organization it belongs to. Enter the **username** (not the email) and the
password.

| Person | Username | Password | Role | ID | Invited as |
|--------|----------|----------|------|----|------------|
${ACCOUNTS.map(a => {
  const r = byName[a.username.toLowerCase()] || {};
  return `| ${a.person} | \`${a.username}\` | \`${a.password}\` | ${a.role} | ${r.public_id || '—'} | ${a.email} |`;
}).join('\n')}

### Spare role-testing accounts

Kept from the first round so admin and manager flows can be exercised without
borrowing someone's personal account. Shared passwords — do not hand these to a
specific tester as *their* account.

| Username | Password | Role |
|----------|----------|------|
| \`testadmin\` | \`Testers@2026\` | org_admin |
| \`testlead\` | \`Testers@2026\` | site_manager |
| \`tester01\`–\`tester07\` | \`Tester@2026\` | member |

## Owner account

The owner is separate from this organization and manages the whole platform.
It was not changed by the reset — use the password you already have.

| Role | Username | ID |
|------|----------|----|
| owner | \`${owner.username}\` | ${owner.public_id || '—'} |

## Notes

- Emails are \`<username>@${DOMAIN}\` and are pre-verified, so there is no code
  to enter on first sign-in.
- The organization starts with **no scans and no history** — it was created by
  \`scripts/reset-data.js\`.
- \`org_admin\` sees Data Sources and Marketplace; \`owner\` additionally sees the
  Operations Console and Lab. A \`member\` sees Home, Scan and Profile.
`;

  fs.writeFileSync(OUT_FILE, md);
  say(`\n✔ Wrote ${OUT_FILE}`);
  say('  This file is gitignored — do not commit it.\n');
}

main();

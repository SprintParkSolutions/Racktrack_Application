#!/usr/bin/env node
/**
 * Email each tester their own account details.
 *
 *   node scripts/mail-credentials.js                 # dry run — prints, sends nothing
 *   node scripts/mail-credentials.js --to sravan     # dry run for one person
 *   node scripts/mail-credentials.js --send          # actually send
 *   node scripts/mail-credentials.js --send --to sravan
 *
 * Sending is deliberately NOT the default. This mails real people, cannot be
 * undone, and a mistake here means nine strangers get someone else's password.
 * Run it without --send first and read what it is about to do.
 *
 * Credentials come from the same ACCOUNTS list scripts/seed-testers.js uses, so
 * the two can never disagree about what a password is. Each person is sent only
 * their own row.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// Load server/.env the same way app.js does, since this runs standalone.
(() => {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;   // real env wins
  }
})();

const SEND = process.argv.includes('--send');
const only = (() => {
  const i = process.argv.indexOf('--to');
  return i > -1 ? String(process.argv[i + 1] || '').toLowerCase() : null;
})();

const APP_URL = (() => {
  try {
    return fs.readFileSync(path.resolve(__dirname, '..', '..', 'BACKEND_URL'), 'utf8').trim();
  } catch { return 'https://harpist-uncorrupt-chowder.ngrok-free.dev'; }
})();

// Single source of truth — the seeder's list, so a password can never drift
// between what was created and what was emailed.
const { ACCOUNTS } = require('./tester-accounts.js');

function html(a) {
  const row = (k, v, mono) =>
    `<tr>
       <td style="padding:9px 0;color:#6B6B7A;font-size:.86rem;width:120px;">${k}</td>
       <td style="padding:9px 0;color:#1A1A2E;font-size:.95rem;font-weight:600;${
         mono ? "font-family:'SF Mono','Roboto Mono',Menlo,Consolas,monospace;" : ''}">${v}</td>
     </tr>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F0EFF5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 20px;">
    <div style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(75,69,160,0.08);">
      <div style="background:linear-gradient(135deg,#5B54B0 0%,#7B75C0 100%);padding:26px 32px;text-align:center;">
        <div style="font-size:.78rem;letter-spacing:.22em;text-transform:uppercase;color:#FFFFFF;font-weight:700;">RackTrack</div>
      </div>
      <div style="padding:34px 34px 30px;">
        <h1 style="margin:0 0 8px;font-size:1.35rem;font-weight:700;color:#1A1A2E;">Hi ${a.person.split(' ')[0]}, your test account is ready</h1>
        <p style="margin:0 0 24px;color:#4A4A5A;font-size:.92rem;line-height:1.6;">
          You've been added as a tester for RackTrack. Install <b>build 21</b> from the invite
          you received, then sign in with the details below.
        </p>

        <table style="width:100%;border-collapse:collapse;border-top:1px solid #EDECF3;border-bottom:1px solid #EDECF3;margin-bottom:22px;">
          ${row('Username', a.username, true)}
          ${row('Password', a.password, true)}
          ${row('Role', a.role.replace('_', ' '), false)}
        </table>

        <p style="margin:0 0 8px;color:#1A1A2E;font-size:.9rem;font-weight:700;">Signing in</p>
        <p style="margin:0 0 22px;color:#4A4A5A;font-size:.88rem;line-height:1.65;">
          Leave the <b>Organization</b> field <b>empty</b>. Enter the <b>username</b> above — not
          your email address — and the password. There is no verification code to enter.
          <br><br>
          If you do type something in Organization it must be exactly
          <b>THE TESTERS</b>; anything else is rejected as a wrong password even
          when the password is right.
        </p>

        <p style="margin:0 0 8px;color:#1A1A2E;font-size:.9rem;font-weight:700;">If something breaks</p>
        <p style="margin:0 0 24px;color:#4A4A5A;font-size:.88rem;line-height:1.65;">
          Tap <b>More</b> in the bottom bar and choose <b>Help</b> to ask RackTrack Assist.
          If a screen goes wrong it will now show an error you can recover from — please
          send us a screenshot of it, it tells us exactly what failed.
        </p>

        <div style="padding:14px 16px;background:#F8F7FB;border:1px solid rgba(200,196,228,0.55);border-radius:10px;">
          <p style="margin:0;color:#4A4A5A;font-size:.82rem;line-height:1.6;">
            This is a test account on test data. Please don't reuse this password anywhere else,
            and don't share it — everything you do is recorded against your name so we know
            whose feedback is whose.
          </p>
        </div>
      </div>
    </div>
    <p style="text-align:center;color:#8A8A99;font-size:.74rem;margin-top:20px;">Sent automatically by RackTrack — please do not reply.</p>
  </div>
</body></html>`;
}

function text(a) {
  return `Hi ${a.person.split(' ')[0]}, your RackTrack test account is ready.

Install build 21 from the invite you received, then sign in with:

  Username: ${a.username}
  Password: ${a.password}
  Role:     ${a.role.replace('_', ' ')}

Leave the Organization field EMPTY. Enter the USERNAME above, not your email
address. There is no verification code to enter.

If you do type something into Organization it must be exactly "THE TESTERS".
Anything else is rejected as a wrong password even when the password is right.

If something breaks: tap More in the bottom bar and choose Help to ask
RackTrack Assist. If a screen goes wrong it will show an error you can recover
from — please send a screenshot, it tells us exactly what failed.

This is a test account on test data. Please don't reuse this password anywhere
else and don't share it — everything is recorded against your name so we know
whose feedback is whose.

Sent automatically by RackTrack — please do not reply.`;
}

async function main() {
  const targets = ACCOUNTS.filter(a => !only || a.username.toLowerCase() === only);
  if (!targets.length) {
    console.error(`✗ no tester matches --to ${only}`);
    console.error(`  known: ${ACCOUNTS.map(a => a.username).join(', ')}`);
    process.exit(1);
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT, 10) || 465;

  console.log(`\nMail tester credentials — ${SEND ? 'SENDING FOR REAL' : 'DRY RUN (add --send to actually send)'}`);
  console.log(`from:  ${from || '(SMTP not configured)'} via ${host}:${port}`);
  console.log(`app:   ${APP_URL}`);
  console.log(`count: ${targets.length} recipient(s)\n`);

  for (const a of targets) {
    console.log(`  ${a.person.padEnd(24)} ${a.email.padEnd(32)} username=${a.username} role=${a.role}`);
  }

  if (!SEND) {
    console.log('\n--- preview of the plain-text body for the first recipient ---\n');
    console.log(text(targets[0]).split('\n').map(l => '  ' + l).join('\n'));
    console.log('\nDry run only — no mail was sent. Re-run with --send to deliver.\n');
    return;
  }

  if (!user || !pass) {
    console.error('\n✗ SMTP_USER / SMTP_PASS are not set in server/.env — cannot send.');
    process.exit(1);
  }

  const tx = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass: pass.replace(/\s+/g, '') },   // App Passwords carry spaces
  });

  // Fail fast on a bad credential rather than half-sending the batch.
  try {
    await tx.verify();
    console.log('\nSMTP connection verified.');
  } catch (e) {
    console.error(`\n✗ SMTP verify failed: ${e.message}`);
    process.exit(1);
  }

  let ok = 0, failed = 0;
  for (const a of targets) {
    try {
      await tx.sendMail({
        from, to: a.email,
        subject: 'Your RackTrack test account',
        text: text(a), html: html(a),
      });
      console.log(`  ✔ sent to ${a.email}`);
      ok++;
    } catch (e) {
      console.log(`  ✗ ${a.email}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${ok} sent, ${failed} failed.\n`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });

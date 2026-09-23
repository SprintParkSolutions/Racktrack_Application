/**
 * Telling somebody something arrived.
 *
 * Three things happen when a check is decided, a ticket is raised or a drift
 * reaches the person who has to read it: the bell on Home lights, the phone
 * makes a sound, and - if they let us - a notification appears outside the
 * app. The owner asked for all three on 23 September 2026, and for the
 * permission to be asked for rather than assumed.
 *
 * What is here is what the app can do by itself: a sound, and a notification
 * posted by the app while it is installed on the phone (Capacitor's local
 * notifications). A notification delivered while the app is not running at all
 * is a push, which needs Firebase for Android and an APNs key for iOS - that
 * is a separate piece of work and nothing here pretends to do it.
 *
 * Everything degrades quietly: a browser with no Notification API, a build
 * without the plugin, a person who said no - each of them just means one
 * fewer way of telling them, never an error on the screen.
 */
import { getItem, setItem } from './safeStorage.js';

const KEY = 'rt.notify';          // 'on' | 'off' | absent = never asked
const SEEN = 'rt.notify.seen';    // the newest notice this device has announced

/** Whether the person has said yes, no, or nothing at all. */
export const notifyChoice = () => getItem(KEY) || null;
export const wantsNotices = () => notifyChoice() === 'on';
export function setNotifyChoice(on) { setItem(KEY, on ? 'on' : 'off'); }

const native = () => Boolean(typeof window !== 'undefined'
  && window.Capacitor && window.Capacitor.isNativePlatform
  && window.Capacitor.isNativePlatform());

/* The plugin is loaded only where it exists, and only when it is needed: a
   web build must not pull a phone plugin into its bundle at start-up. */
async function plugin() {
  if (!native()) return null;
  try {
    const mod = await import('@capacitor/local-notifications');
    return mod.LocalNotifications || null;
  } catch { return null; }
}

/**
 * Ask for permission, once, on a press.
 *
 * Returns true when notices may be shown. A phone asks through the plugin; a
 * browser through the Notification API; anything else says no, and the sound
 * still works, because a sound needs nobody's permission.
 */
export async function askToNotify() {
  const p = await plugin();
  if (p) {
    try {
      const r = await p.requestPermissions();
      const ok = r && (r.display === 'granted' || r.display === 'prompt-with-rationale');
      setNotifyChoice(Boolean(ok));
      return Boolean(ok);
    } catch { setNotifyChoice(false); return false; }
  }
  if (typeof Notification !== 'undefined' && Notification.requestPermission) {
    try {
      const r = await Notification.requestPermission();
      setNotifyChoice(r === 'granted');
      return r === 'granted';
    } catch { setNotifyChoice(false); return false; }
  }
  // No way to post one, but the sound is still theirs to choose.
  setNotifyChoice(true);
  return true;
}

/**
 * The sound.
 *
 * Two short notes drawn in the browser rather than a file: it costs no
 * request, cannot arrive broken, and is the same on every platform. A phone
 * that is silent, or a browser that has not been touched yet (autoplay), just
 * stays quiet.
 */
export function chime() {
  if (!wantsNotices()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const at = ctx.currentTime;
    for (const [i, hz] of [880, 1174.7].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at + i * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.16, at + i * 0.13 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.13 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + i * 0.13);
      osc.stop(at + i * 0.13 + 0.24);
    }
    setTimeout(() => { try { ctx.close(); } catch { /* already gone */ } }, 900);
  } catch { /* no audio on this device: the notice is still on the screen */ }
}

/** Post one notification. Silent when they have not said yes. */
export async function notify({ title, body, id = Date.now() % 100000 }) {
  if (!wantsNotices()) return;
  const p = await plugin();
  if (p) {
    try {
      await p.schedule({ notifications: [{ id, title, body, smallIcon: 'ic_stat_icon' }] });
      return;
    } catch { /* fall through to the browser's own */ }
  }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // eslint-disable-next-line no-new
      new Notification(title, { body });
    }
  } catch { /* nothing more to try */ }
}

/** The newest notice this device has already announced. */
export const lastAnnounced = () => getItem(SEEN) || '';
export const rememberAnnounced = (id) => setItem(SEEN, String(id ?? ''));

/**
 * Announce what has arrived since last time.
 *
 * Takes the notice rows as the server sends them, newest first. It announces
 * the newest one only: three decisions in one poll is one interruption, not
 * three. Returns the number it found new, which is what a test asserts on.
 */
export async function announce(rows = []) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return 0;
  const newest = list[0];
  const seen = lastAnnounced();
  /* Ids are numbers, and a number compared as text says 9 is newer than 10. */
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const fresh = seen ? list.filter((n) => num(n.id) > num(seen)).length : 0;
  // The first load on a device sets the mark without making a sound: nobody
  // wants a chime for everything that happened while they were away.
  rememberAnnounced(newest.id);
  if (!seen || fresh === 0) return 0;
  chime();
  await notify({
    title: newest.subject || 'RackTrack',
    body: fresh > 1 ? `${fresh} new notices` : String(newest.body || '').split('\n')[0] || '',
    id: Number(newest.id) || undefined,
  });
  return fresh;
}

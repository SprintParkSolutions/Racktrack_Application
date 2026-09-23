import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  announce, setNotifyChoice, wantsNotices, notifyChoice, rememberAnnounced, lastAnnounced,
} from './notify.js';

/* The rule that matters: the first load on a device is silent, and after that
   only what is actually new makes a sound. */
describe('announcing what arrived', () => {
  beforeEach(() => {
    localStorage.clear();
    setNotifyChoice(true);
  });

  test('the first load only remembers where we are', async () => {
    expect(await announce([{ id: 12, subject: 'A check was approved' }])).toBe(0);
    expect(lastAnnounced()).toBe('12');
  });

  test('what came after the mark is announced, counted by number not by text', async () => {
    rememberAnnounced(9);
    expect(await announce([{ id: 10, subject: 'Newer' }, { id: 9, subject: 'Seen' }])).toBe(1);
    expect(lastAnnounced()).toBe('10');
  });

  test('nothing new, nothing said', async () => {
    rememberAnnounced(10);
    expect(await announce([{ id: 10, subject: 'Seen' }])).toBe(0);
  });

  test('an empty list says nothing and moves nothing', async () => {
    rememberAnnounced(4);
    expect(await announce([])).toBe(0);
    expect(lastAnnounced()).toBe('4');
  });

  test('a choice is remembered, and nobody is told until they say yes', () => {
    localStorage.clear();
    expect(notifyChoice()).toBe(null);
    expect(wantsNotices()).toBe(false);
    setNotifyChoice(true);
    expect(wantsNotices()).toBe(true);
  });
});

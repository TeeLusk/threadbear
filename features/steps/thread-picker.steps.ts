// The # thread picker in the message box (thread-picker.feature).
import { Then } from '@cucumber/cucumber';
import type { Dump } from '../support/driver.ts';
import type { ThreadbearWorld } from '../support/world.ts';

type Picker = { query: string; threads: { id: string; title: string; folder: string }[]; picked: string | null; note: string | null };

// GPUI's dump has the picker as `threadPalette` while it's open.
const picker = (d: Dump): Picker | null => (d as Dump & { threadPalette?: Picker | null }).threadPalette ?? null;
const titles = (d: Dump) => picker(d)?.threads.map((t) => t.title) ?? [];

Then('the thread picker lists {string}', async function (this: ThreadbearWorld, title: string) {
  await this.until(`the thread picker listing ${title}`, (d) => titles(d).includes(title));
});

Then('the thread picker doesn\'t list {string}', async function (this: ThreadbearWorld, title: string) {
  await this.until(`the thread picker open without ${title}`, (d) => picker(d) !== null && !titles(d).includes(title));
});

Then('the thread picker lists only {string}', async function (this: ThreadbearWorld, list: string) {
  const want = list.split(', ').sort().join(', ');
  await this.until(`the thread picker listing only ${list}`, (d) => [...titles(d)].sort().join(', ') === want);
});

Then('the thread picker says {string}', async function (this: ThreadbearWorld, note: string) {
  await this.until(`the thread picker saying "${note}"`, (d) => picker(d)?.note === note);
});

Then('the thread picker is closed', async function (this: ThreadbearWorld) {
  await this.until('the thread picker closed', (d) => picker(d) === null);
});

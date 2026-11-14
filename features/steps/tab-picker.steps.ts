// The @ tab picker in the message box (tab-picker.feature), against the
// stand-in BrowserBear in support/browserbear.ts.
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { sleep, type Dump } from '../support/driver.ts';
import type { ThreadbearWorld } from '../support/world.ts';

type PickerTab = { tabId: number; title: string; host: string; hint: string | null; favicon: boolean };
type Picker = { query: string; tabs: PickerTab[]; picked: number | null; note: string | null };
type TabsWorld = ThreadbearWorld & { chromeTabs?: number };

const bear = (world: ThreadbearWorld) => {
  assert.ok(world.bear, 'the scenario has no stand-in BrowserBear (tag it @browserbear)');
  return world.bear;
};

// A small square for a tab's icon, as Chrome gives one.
const ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#3b82f6"/></svg>').toString('base64')}`;

function openTab(world: TabsWorld, title: string, url: string, allowed: boolean): void {
  world.chromeTabs = (world.chromeTabs ?? 0) + 1;
  bear(world).openInChrome({ tabId: world.chromeTabs, title, url, allowed, favIconUrl: ICON });
}

Given('my Chrome has {string} open at {string}', function (this: TabsWorld, title: string, url: string) {
  openTab(this, title, url, true);
});

Given('my Chrome has {string} open at {string} on a site agents aren\'t allowed', function (this: TabsWorld, title: string, url: string) {
  openTab(this, title, url, false);
});

Given('an agent\'s own tab {string} is open at {string}', function (this: TabsWorld, title: string, url: string) {
  bear(this).openInChrome({ tabId: 900, title, url, whose: 'agent', favIconUrl: ICON });
});

// GPUI's dump has the picker as `tabPalette` while it's open.
const picker = (d: Dump): Picker | null => (d as Dump & { tabPalette?: Picker | null }).tabPalette ?? null;

Then('the tab picker lists {string}', async function (this: ThreadbearWorld, list: string) {
  await this.until(`the tab picker listing ${list}`, (d) => picker(d)?.tabs.map((t) => t.title).join(', ') === list);
});

Then('the tab picker shows each tab\'s icon', async function (this: ThreadbearWorld) {
  await this.until('an icon on each of the tab picker\'s rows', (d) => {
    const tabs = picker(d)?.tabs;
    return !!tabs?.length && tabs.every((t) => t.favicon);
  });
});

Then('the tab picker says {string} by {string}', async function (this: ThreadbearWorld, hint: string, title: string) {
  await this.until(`"${hint}" by "${title}"`, (d) => picker(d)?.tabs.some((t) => t.title === title && t.hint === hint));
});

Then('the tab picker says {string}', async function (this: ThreadbearWorld, note: string) {
  await this.until(`the tab picker saying "${note}"`, (d) => picker(d)?.note === note);
});

Then('the tab picker is closed', async function (this: ThreadbearWorld) {
  await this.until('the tab picker closed', (d) => picker(d) === null);
});

async function lent(world: ThreadbearWorld, tab: number, to: () => Promise<string | undefined>): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const thread = await to();
    if (thread && bear(world).heard.some((h) => h.cmd === 'lendTo' && h.args.tab === tab && h.args.to === thread && h.thread === undefined)) return;
    await sleep(100);
  }
  assert.fail(`BrowserBear was never asked to lend tab ${tab}; it heard ${JSON.stringify(bear(world).heard)}`);
}

Then('BrowserBear was asked to lend tab {int} to {string}', async function (this: ThreadbearWorld, tab: number, title: string) {
  await lent(this, tab, async () => this.thread(await this.app.dump(), title)?.id);
});

Then('BrowserBear was asked to lend tab {int} to the new thread', async function (this: ThreadbearWorld, tab: number) {
  await lent(this, tab, async () => (await this.app.dump()).selection?.id);
});

Then('BrowserBear hasn\'t been asked to lend a tab', async function (this: ThreadbearWorld) {
  await sleep(300);
  assert.equal(bear(this).heard.some((h) => h.cmd === 'lendTo'), false, 'a tab was lent before there was a thread');
});

// The dump cuts a long row short, so this looks for the words in it.
Then('my message in the transcript goes on with {string}', async function (this: ThreadbearWorld, words: string) {
  await this.until(`my message going on with "${words}"`, (d) => d.transcript.rows.some((r) => r.kind === 'user' && r.text.includes(words)));
});

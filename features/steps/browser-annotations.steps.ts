// Annotating a page in Chrome (browser-annotations.feature), against the
// stand-in BrowserBear in support/browserbear.ts: Annotate on a row of the
// Browser pane, and Attach's files and threadbear:// link coming back.
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { sleep } from '../support/driver.ts';
import type { ThreadbearWorld } from '../support/world.ts';

const SESSION = '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

const bear = (world: ThreadbearWorld) => {
  assert.ok(world.bear, 'the scenario has no stand-in BrowserBear (tag it @browserbear)');
  return world.bear;
};

const annotation = (comment: string) => ({
  url: 'http://localhost:5173/cart',
  title: 'Cart',
  comment,
  elements: [{ selector: '#save', tagName: 'button', outerHTML: '<button id="save">Save</button>', text: 'Save', styles: {}, rect: { x: 120, y: 340, width: 160, height: 40 } }],
  regions: [],
  strokes: [],
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
});

Given('my Chrome has {string} at {string} open for {string}', async function (this: ThreadbearWorld, title: string, url: string, threadTitle: string) {
  const thread = await this.until(`a thread called "${threadTitle}"`, (d) => this.thread(d, threadTitle));
  bear(this).openInProfile({ tabId: 2000, url, title, thread: thread.id });
});

Then('BrowserBear was asked to annotate {string} for {string}', async function (this: ThreadbearWorld, _title: string, threadTitle: string) {
  const thread = this.thread(await this.app.dump(), threadTitle);
  for (let i = 0; i < 100; i += 1) {
    if (bear(this).heard.some((h) => h.cmd === 'panelAnnotate' && h.args.tab === 2000 && h.args.profile === 'personal' && h.args.title === threadTitle && h.thread === thread?.id)) return;
    await sleep(100);
  }
  assert.fail(`BrowserBear never heard panelAnnotate; it heard ${JSON.stringify(bear(this).heard)}`);
});

When('BrowserBear attaches an annotation saying {string} for {string}', async function (this: ThreadbearWorld, comment: string, threadTitle: string) {
  const t = await this.until(`a thread called "${threadTitle}"`, (d) => this.thread(d, threadTitle));
  bear(this).leaveAnnotation(SESSION, t.id, annotation(comment), true);
  await this.app.do({ cmd: 'open-url', url: `threadbear://thread/${t.id}?annotation=${SESSION}` });
});

When('BrowserBear attaches an annotation for {string} through a link to {string}', async function (this: ThreadbearWorld, forTitle: string, linkTitle: string) {
  const d = await this.app.dump();
  const owner = this.thread(d, forTitle);
  const linked = this.thread(d, linkTitle);
  assert.ok(owner && linked, 'both threads are in the demo');
  bear(this).leaveAnnotation(SESSION, owner.id, annotation('Wrong thread'), true);
  await this.app.do({ cmd: 'open-url', url: `threadbear://thread/${linked.id}?annotation=${SESSION}` });
});

Then('the composer has {string} then the annotation saying {string}', async function (this: ThreadbearWorld, before: string, comment: string) {
  const start = `${before}\n\nBrowser annotation on "Cart" <http://localhost:5173/cart>\n\n${comment}\n\nMarked (shown in the screenshot)`;
  await this.until(`the composer starting "${start}"`, (d) => d.composer.text.startsWith(start) && d.composer.text.includes('- `#save` "Save" at 120,340 160×40'));
});

Then('the composer has {int} picture(s)', async function (this: ThreadbearWorld, pictures: number) {
  await this.until(`${pictures} picture(s) in the composer`, (d) => d.composer.images === pictures);
});

Then("BrowserBear's annotation files are gone", async function (this: ThreadbearWorld) {
  for (let i = 0; i < 50; i += 1) {
    if (!bear(this).hasAnnotation(SESSION)) return;
    await sleep(100);
  }
  assert.fail("the annotation's files are still in BrowserBear's folder");
});

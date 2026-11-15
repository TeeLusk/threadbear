// The long thread card over the message box (the dump's composer.longThread):
// its words, its buttons, and clicking them by their tips.
import { Then, When } from '@cucumber/cucumber';
import type { ThreadbearWorld } from '../support/world.ts';

type Card = { message: string; buttons: string[] } | null | undefined;
const card = (d: { composer?: unknown }): Card => (d.composer as { longThread?: Card } | undefined)?.longThread;

// Each button's tip, which is also its label for a click.
const tips: Record<string, string> = {
  Compact: 'Send /compact: the agent sums up the conversation so far and carries on from the summary',
  'Continue in a new thread': 'Ask the agent for a short handoff, then start a new thread with it in this folder, on the same model and pool',
  'Not now': 'Hide this for this thread until it gets longer still',
  Open: 'Go to the thread this one carried on in',
};

Then('the long thread card says {string}', async function (this: ThreadbearWorld, words: string) {
  await this.until(`the long thread card saying "${words}"`, (d) => card(d)?.message.startsWith(words) === true, 15_000);
});

Then('the long thread card offers {string}, {string} and {string}', async function (this: ThreadbearWorld, a: string, b: string, c: string) {
  await this.until(`the long thread card offering ${a}, ${b} and ${c}`, (d) => JSON.stringify(card(d)?.buttons) === JSON.stringify([a, b, c]));
});

Then('the long thread card is gone', async function (this: ThreadbearWorld) {
  await this.until('no long thread card', (d) => !card(d), 15_000);
});

When("I click the long thread card's {string}", async function (this: ThreadbearWorld, button: string) {
  await this.until(`the long thread card offering ${button}`, (d) => card(d)?.buttons.includes(button) === true, 15_000);
  await this.app.do({ cmd: 'click', title: tips[button] });
});

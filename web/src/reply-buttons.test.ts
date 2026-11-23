import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buttonLook, type MessageButton } from './reply-buttons.ts';
import { idle, step, type CommandState } from './command.ts';

const none: CommandState<undefined> = idle();
const sending = step(none, { kind: 'send', payload: undefined, at: 0 });
const waiting = step(sending, { kind: 'queued', attempt: 1, id: 'c1', at: 0 });
const at = (report: { state: 'pending' | 'taken' | 'done' | 'failed'; note?: string; threadId?: string }) => step(waiting, { kind: 'report', id: 'c1', report, at: 0 });

const start: MessageButton = { id: 'abcd1234', title: 'Fill in the form', kind: 'start', target: 'pebble' };
const send: MessageButton = { id: 'efgh5678', title: 'Ask it', kind: 'send', target: 'Meetup' };

test('a button says where it goes until it is pressed', () => {
  assert.deepEqual(buttonLook(start, none), { kind: 'ready', tip: 'Starts a thread in pebble' });
  assert.deepEqual(buttonLook(send, none), { kind: 'ready', tip: 'Sends a message to "Meetup"' });
});

test('a press shows as pressing until its command is done, then pressed with the thread to open', () => {
  assert.equal(buttonLook(start, sending).kind, 'pressing');
  assert.equal(buttonLook(start, at({ state: 'pending' })).kind, 'pressing');
  assert.equal(buttonLook(start, at({ state: 'taken' })).kind, 'pressing');
  assert.deepEqual(buttonLook(start, at({ state: 'done', threadId: 't2' })), { kind: 'pressed', threadId: 't2', tip: 'Pressed.' });
});

test('the row saying pressed wins, wherever it was pressed', () => {
  assert.equal(buttonLook({ ...start, pressedThreadId: 't3' }, none).kind, 'pressed');
  assert.equal(buttonLook({ ...start, pressedThreadId: 't3' }, at({ state: 'failed', note: 'x' })).kind, 'pressed');
});

test('a failed press shows its error and can be pressed again', () => {
  const look = buttonLook(start, at({ state: 'failed', note: 'Folder not found: /x' }));
  assert.equal(look.kind, 'failed');
  assert.equal(look.kind === 'failed' && look.error, 'Folder not found: /x');
  assert.equal(buttonLook({ ...start, failed: 'gone' }, none).kind, 'failed');
});

test('a press nothing has heard about in a while stops spinning but stays locked', () => {
  assert.equal(buttonLook(start, step(waiting, { kind: 'tick', at: 60_000 })).kind, 'slow');
});

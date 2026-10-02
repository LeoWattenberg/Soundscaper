/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileSizeWarningConfirmation } from '../src/common/editor/controller/shared/file-size-warning-confirmation.ts';

const warning = { label: 'session.scape', byteLength: 20, thresholdBytes: 10 } as const;

test('warning decisions belong to their exact prompt and never replay for later operations', async () => {
	const port = createFileSizeWarningConfirmation();
	const first = port.confirm(warning);
	const prompt = port.getSnapshot();
	assert.ok(prompt);
	assert.equal(port.settle(prompt, true), true);
	assert.equal(await first, true);
	assert.equal(port.getSnapshot(), null);
	const second = port.confirm(warning);
	assert.notEqual(port.getSnapshot(), prompt);
	assert.equal(port.settle(prompt, true), false);
	assert.equal(port.settle(port.getSnapshot(), false), true);
	assert.equal(await second, false);
	port.dispose();
});

test('concurrent requests queue their independent decisions', async () => {
	const port = createFileSizeWarningConfirmation();
	const first = port.confirm(warning);
	const second = port.confirm({ ...warning, label: 'clip.wav' });
	assert.equal(port.getSnapshot()?.label, 'session.scape');
	port.settle(port.getSnapshot(), false);
	assert.equal(await first, false);
	assert.equal(port.getSnapshot()?.label, 'clip.wav');
	port.settle(port.getSnapshot(), true);
	assert.equal(await second, true);
	port.dispose();
});

test('aborting a queued operation cannot dismiss or accept another operation', async () => {
	const port = createFileSizeWarningConfirmation();
	const first = port.confirm(warning);
	const abort = new AbortController();
	const second = port.confirm(warning, { signal: abort.signal });
	const reason = new Error('Queued operation canceled');
	const rejection = assert.rejects(second, (error) => error === reason);
	const prompt = port.getSnapshot();
	abort.abort(reason);
	await rejection;
	assert.equal(port.getSnapshot(), prompt);
	port.settle(prompt, true);
	assert.equal(await first, true);
	assert.equal(port.getSnapshot(), null);
	port.dispose();
});

test('disposal cancels pending requests and rejects requests made after disposal', async () => {
	const port = createFileSizeWarningConfirmation();
	const pending = assert.rejects(port.confirm(warning), { name: 'AbortError' });
	port.dispose();
	port.dispose();
	await pending;
	assert.equal(port.getSnapshot(), null);
	await assert.rejects(port.confirm(warning), { name: 'AbortError' });
});

test('subscribers observe request and decision changes and can unsubscribe', async () => {
	const port = createFileSizeWarningConfirmation();
	let publications = 0;
	const unsubscribe = port.subscribe(() => { publications += 1; });
	const pending = port.confirm(warning);
	port.settle(port.getSnapshot(), true);
	await pending;
	assert.equal(publications, 2);
	unsubscribe();
	const afterUnsubscribe = port.confirm(warning);
	port.settle(port.getSnapshot(), false);
	await afterUnsubscribe;
	assert.equal(publications, 2);
	port.dispose();
});

test('one live operation reuses its decision for the same warning policy only', async () => {
	const confirmation = createFileSizeWarningConfirmation();
	const operation = new AbortController();
	const warning = { label: 'Export', byteLength: 20, thresholdBytes: 10 };
	const pending = confirmation.confirm(warning, { signal: operation.signal });
	assert.equal(confirmation.settle(confirmation.getSnapshot(), true), true);
	assert.equal(await pending, true);
	assert.equal(await confirmation.confirm({ ...warning, byteLength: 30 }, { signal: operation.signal }), true);
	assert.equal(confirmation.getSnapshot(), null);
	const other = confirmation.confirm(warning, { signal: new AbortController().signal });
	assert.ok(confirmation.getSnapshot());
	confirmation.settle(confirmation.getSnapshot(), false);
	assert.equal(await other, false);
	operation.abort();
	await assert.rejects(confirmation.confirm(warning, { signal: operation.signal }), { name: 'AbortError' });
	confirmation.dispose();
});

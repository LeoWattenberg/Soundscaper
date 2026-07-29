/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createScapeCollisionContinuation,
	isExpectedWorkspaceCancellation,
} from '../src/common/editor/ui/workspace/scape-collision-continuation.ts';

test('replacement rejects the prior prompt and only the current opaque prompt can settle', async () => {
	const published: unknown[] = [];
	const owner = createScapeCollisionContinuation({ publish: (value) => { published.push(value); } });
	const firstSignal = new AbortController();
	const secondSignal = new AbortController();
	const first = owner.request({ file: new Blob(['first']), inspected: { exists: true, title: 'First' }, signal: firstSignal.signal });
	const firstPrompt = published.at(-1);
	const firstRejected = assert.rejects(first, { name: 'AbortError' });
	const second = owner.request({ file: new Blob(['second']), inspected: { exists: true, title: 'Second' }, signal: secondSignal.signal });
	const secondPrompt = published.at(-1);

	await firstRejected;
	assert.notEqual(firstPrompt, secondPrompt);
	assert.equal(owner.settle(firstPrompt, 'copy'), false);
	assert.equal(owner.settle(secondPrompt, 'replace'), true);
	assert.equal(owner.settle(secondPrompt, 'copy'), false);
	assert.equal(await second, 'replace');
	assert.equal(published.at(-1), null);
});

test('signal cancellation clears and rejects a prompt with the exact reason', async () => {
	const published: unknown[] = [];
	const signal = new AbortController();
	const owner = createScapeCollisionContinuation({ publish: (value) => { published.push(value); } });
	const pending = owner.request({ file: new Blob(['switch']), inspected: { exists: true }, signal: signal.signal });
	const prompt = published.at(-1);
	const reason = new DOMException('Project switched.', 'AbortError');

	signal.abort(reason);

	await assert.rejects(pending, (error) => error === reason);
	assert.equal(published.at(-1), null);
	assert.equal(owner.settle(prompt, 'copy'), false);
});

test('signal cancellation preserves a null reason and cannot hang when clearing publication throws', async () => {
	const signal = new AbortController();
	const clearError = new Error('The prompt renderer could not clear.');
	const owner = createScapeCollisionContinuation({
		publish: (value) => {
			if (value === null) throw clearError;
		},
	});
	const pending = owner.request({
		file: new Blob(['abort']),
		inspected: { exists: true },
		signal: signal.signal,
	});

	signal.abort(null);

	await assert.rejects(pending, (error) => error === null);
});

test('a failed clear publication rejects a settled choice instead of hanging', async () => {
	let prompt: unknown = null;
	const clearError = new Error('The prompt renderer could not clear.');
	const owner = createScapeCollisionContinuation({
		publish: (value) => {
			if (value === null) throw clearError;
			prompt = value;
		},
	});
	const pending = owner.request({
		file: new Blob(['choice']),
		inspected: { exists: true },
		signal: new AbortController().signal,
	});

	assert.equal(owner.settle(prompt, 'copy'), true);
	await assert.rejects(pending, (error) => error === clearError);
	assert.equal(owner.settle(prompt, 'replace'), false);
});

test('explicit cancel resolves normally without opening and disposal is terminal', async () => {
	const published: unknown[] = [];
	const owner = createScapeCollisionContinuation({ publish: (value) => { published.push(value); } });
	const first = owner.request({ file: new Blob(['cancel']), inspected: { exists: true }, signal: new AbortController().signal });
	assert.equal(owner.settle(published.at(-1), 'cancel'), true);
	assert.equal(await first, 'cancel');

	const pending = owner.request({ file: new Blob(['dispose']), inspected: { exists: true }, signal: new AbortController().signal });
	const prompt = published.at(-1);
	owner.dispose();
	owner.dispose();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(owner.settle(prompt, 'replace'), false);
	await assert.rejects(
		owner.request({ file: new Blob(['late']), inspected: { exists: true }, signal: new AbortController().signal }),
		{ name: 'AbortError' },
	);
});

test('workspace cancellation classification suppresses lifecycle unwind only', () => {
	assert.equal(isExpectedWorkspaceCancellation(new DOMException('Superseded.', 'AbortError')), true);
	assert.equal(isExpectedWorkspaceCancellation(Object.assign(new Error('Changed.'), { code: 'PROJECT_CHANGED' })), true);
	assert.equal(isExpectedWorkspaceCancellation(Object.assign(new Error('Disposed.'), { code: 'DISPOSED' })), true);
	assert.equal(isExpectedWorkspaceCancellation(new Error('Malformed archive.')), false);
	assert.equal(isExpectedWorkspaceCancellation('AbortError'), false);
});

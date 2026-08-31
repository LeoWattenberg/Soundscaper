/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeFramescaperCaptureDurability } from '../src/common/editor/controller/framescaper-capture-durable-finalization.ts';

test('durable finalization retires only after committed settlement', async () => {
	const events: string[] = [];
	await finalizeFramescaperCaptureDurability({
		state: 'sealed',
		publish: async () => { events.push('publish'); return { manifest: { state: 'committed' } }; },
		retireCommitted: async () => { events.push('retire'); },
		refreshRecovery: async () => { events.push('refresh'); },
	});
	assert.deepEqual(events, ['publish', 'retire']);
});

test('indeterminate publication refreshes recovery and never touches capture storage', async () => {
	const events: string[] = [];
	await assert.rejects(finalizeFramescaperCaptureDurability({
		state: 'finalizing',
		publish: async () => { events.push('publish'); throw new Error('commit indeterminate'); },
		retireCommitted: async () => { events.push('retire'); },
		refreshRecovery: async () => { events.push('refresh'); },
	}), /commit indeterminate/u);
	assert.deepEqual(events, ['publish', 'refresh']);
});

test('recovery refresh failure warns without replacing the publication failure', async () => {
	const publicationFailure = new Error('publication failed');
	const refreshFailure = new Error('refresh failed');
	const warnings: unknown[] = [];
	await assert.rejects(finalizeFramescaperCaptureDurability({
		state: 'finalizing',
		publish: async () => { throw publicationFailure; },
		retireCommitted: async () => undefined,
		refreshRecovery: async () => { throw refreshFailure; },
		onCleanupWarning: (error) => { warnings.push(error); },
	}), (error) => error === publicationFailure);
	assert.deepEqual(warnings, [refreshFailure]);
});

test('committed cleanup failure warns without regressing Stop and remains retryable maintenance', async () => {
	const events: string[] = [];
	const warning = new Error('cleanup interrupted');
	await finalizeFramescaperCaptureDurability({
		state: 'sealed',
		publish: async () => { events.push('publish'); return { manifest: { state: 'committed' } }; },
		retireCommitted: async () => { events.push('retire'); throw warning; },
		refreshRecovery: async () => { events.push('refresh'); },
		onCleanupWarning: (error) => { assert.equal(error, warning); events.push('warning'); },
	});
	assert.deepEqual(events, ['publish', 'retire', 'warning']);

	events.length = 0;
	await finalizeFramescaperCaptureDurability({
		state: 'committed',
		publish: async () => { events.push('publish'); return { manifest: { state: 'committed' } }; },
		retireCommitted: async () => { events.push('retire'); },
		refreshRecovery: async () => { events.push('refresh'); },
	});
	assert.deepEqual(events, ['retire']);
});

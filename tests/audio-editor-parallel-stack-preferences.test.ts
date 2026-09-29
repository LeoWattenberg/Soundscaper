/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	PARALLEL_STACK_PREFERENCES_KEY,
	readParallelStackPreferences,
	writeParallelStackPreferences,
	readParallelStackStatus,
	publishParallelStackStatus,
	subscribeParallelStackPreferences,
} from '../src/common/editor/engine/parallel-stack-preferences.ts';

function storage(initial: string | null = null) {
	let value = initial;
	return {
		getItem: (key: string) => key === PARALLEL_STACK_PREFERENCES_KEY ? value : null,
		setItem: (key: string, next: string) => {
			assert.equal(key, PARALLEL_STACK_PREFERENCES_KEY);
			value = next;
		},
	};
}

test('parallel stack preferences default off and reject malformed persisted settings', () => {
	for (const value of [null, 'broken', 'null', '{}', '{"enabled":true}',
		'{"enabled":true,"workerLimit":3,"pipelineFrames":768}',
		'{"enabled":true,"workerLimit":"auto","pipelineFrames":1}']) {
		assert.deepEqual(readParallelStackPreferences(storage(value)), {
			enabled: false, workerLimit: 'auto', pipelineFrames: 1536,
		});
	}
	assert.equal(readParallelStackPreferences({ getItem() { throw new Error('Denied'); } }).enabled, false);
});

test('parallel stack settings persist without changing project state and reject running changes', () => {
	const backing = storage();
	const next = { enabled: true, workerLimit: 4, pipelineFrames: 1536 } as const;
	writeParallelStackPreferences(next, { storage: backing, playing: false, recording: false });
	assert.deepEqual(readParallelStackPreferences(backing), next);
	for (const activity of [{ playing: true }, { recording: true }]) {
		assert.throws(() => writeParallelStackPreferences({ ...next, enabled: false }, {
			storage: backing, ...activity,
		}), /Stop playback and recording/);
		assert.deepEqual(readParallelStackPreferences(backing), next);
	}
});

test('parallel stack status is scoped to its engine and subscriptions clean up', () => {
	const first = {};
	const second = {};
	let notifications = 0;
	const unsubscribe = subscribeParallelStackPreferences(() => { notifications += 1; });
	publishParallelStackStatus(first, { state: 'unsupported', reason: 'Unsupported effect', sampleRate: 48000 });
	assert.equal(readParallelStackStatus(first).reason, 'Unsupported effect');
	assert.equal(readParallelStackStatus(second).state, 'off');
	assert.equal(notifications, 1);
	unsubscribe();
	unsubscribe();
	publishParallelStackStatus(first, { state: 'active', workerCount: 4 });
	assert.equal(notifications, 1);
});

test('a denied preference write does not publish a setting the next playback cannot read', () => {
	let notifications = 0;
	const unsubscribe = subscribeParallelStackPreferences(() => { notifications += 1; });
	try {
		assert.throws(() => writeParallelStackPreferences({ enabled: true, workerLimit: 2, pipelineFrames: 768 }, {
			storage: { setItem() { throw new Error('Quota denied'); } },
		}), /Quota denied/);
		assert.equal(notifications, 0);
	} finally { unsubscribe(); }
});

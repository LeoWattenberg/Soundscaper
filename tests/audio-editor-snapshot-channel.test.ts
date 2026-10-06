/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSnapshotChannel } from '../src/common/editor/controller/composition/internal/snapshot-channel.ts';

test('snapshot channels cache reads and publish one immutable generation to every listener', () => {
	let generation = 0;
	const observed: number[] = [];
	const channel = createSnapshotChannel({ build: () => Object.freeze({ generation: ++generation }) });
	assert.equal(channel.get(), channel.get());
	channel.subscribe(() => observed.push(channel.get().generation));
	assert.equal(channel.publish(), true);
	assert.deepEqual(observed, [2]);
});

test('snapshot channels isolate listener failures and respect terminal publication policy', () => {
	let active = true;
	const errors: unknown[] = [];
	let healthyCalls = 0;
	const channel = createSnapshotChannel({
		build: () => ({ active }),
		canPublish: () => active,
		onListenerError: (error) => errors.push(error),
	});
	channel.subscribe(() => { throw new Error('extension failed'); });
	channel.subscribe(() => { healthyCalls += 1; });
	channel.publish();
	active = false;
	assert.equal(channel.publish(), false);
	assert.equal(channel.publish({ force: true }), true);
	assert.equal(healthyCalls, 2);
	assert.equal(errors.length, 2);
	channel.clear();
	channel.publish({ force: true });
	assert.equal(healthyCalls, 2);
});

test('nested synchronous presentation batches build and notify once after all fields are updated', () => {
	const state = { busy: false, message: '' };
	let builds = 0;
	const channel = createSnapshotChannel({ build: () => { builds++; return Object.freeze({ ...state }); } });
	const observations: unknown[] = [];
	channel.subscribe(() => { observations.push(channel.get()); });
	channel.batch(() => {
		state.busy = true; channel.publish();
		channel.batch(() => { state.message = 'Working'; channel.publish(); });
		assert.equal(observations.length, 0);
	});
	assert.deepEqual(observations, [{ busy: true, message: 'Working' }]);
	assert.equal(builds, 1);
	channel.publish();
	assert.equal(builds, 2, 'publications outside a batch remain immediate');
});

test('a failed synchronous batch still publishes its completed state mutations', () => {
	let state = 0;
	const channel = createSnapshotChannel({ build: () => state });
	assert.throws(() => channel.batch(() => { state++; channel.publish(); throw new Error('Failed'); }), /Failed/u);
	assert.equal(channel.get(), 1);
	channel.batch(() => { state++; channel.publish(); });
	assert.equal(channel.get(), 2);
});

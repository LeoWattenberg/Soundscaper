/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from './helpers/async-test-control.ts';
import { startController } from '../src/common/editor/controller/controller-startup.ts';
import { EditorControllerLifetime, type EditorControllerPhase } from '../src/common/editor/controller/lifecycle.ts';

function fixture() {
	const lifetime = new EditorControllerLifetime();
	const state: { phase: EditorControllerPhase; microphoneMetering: boolean } = {
		phase: 'booting', microphoneMetering: true,
	};
	const events: string[] = [];
	return {
		lifetime, state, events,
		bootstrap: async () => { events.push('bootstrap'); },
		initializeCapture: async () => { events.push('capture'); },
		getSnapshot: () => ({ phase: state.phase }),
		publish: () => { events.push(state.phase); },
		startMicrophoneMeter: async () => { events.push('meter'); },
		handleError: (_error: unknown) => { events.push('error'); },
	};
}

test('startup waits for capture before publishing readiness and restoring metering', async () => {
	const dependencies = fixture();
	const capture = deferred<void>();
	dependencies.initializeCapture = () => capture.promise;
	const ready = startController(dependencies);
	await Promise.resolve();
	assert.equal(dependencies.lifetime.phase, 'booting');
	assert.deepEqual(dependencies.events, ['bootstrap']);
	capture.resolve();
	assert.deepEqual(await ready, { phase: 'ready' });
	assert.deepEqual(dependencies.events, ['bootstrap', 'ready', 'meter']);
});

for (const stage of ['bootstrap', 'initializeCapture'] as const) {
	test(`disposal during ${stage} prevents late readiness and metering`, async () => {
		const dependencies = fixture();
		const pending = deferred<void>();
		dependencies[stage] = () => pending.promise;
		const ready = startController(dependencies);
		await Promise.resolve();
		dependencies.lifetime.beginDisposal();
		dependencies.state.phase = dependencies.lifetime.phase;
		pending.resolve();
		assert.deepEqual(await ready, { phase: 'disposing' });
		assert.ok(!dependencies.events.includes('ready'));
		assert.ok(!dependencies.events.includes('meter'));
		if (stage === 'bootstrap') assert.ok(!dependencies.events.includes('capture'));
	});
}

test('startup failures publish an error snapshot and skip microphone restoration', async () => {
	const dependencies = fixture();
	const failure = new Error('capture unavailable');
	dependencies.initializeCapture = () => Promise.reject(failure);
	const errors: unknown[] = [];
	dependencies.handleError = error => { errors.push(error); };
	assert.deepEqual(await startController(dependencies), { phase: 'error' });
	assert.deepEqual(errors, [failure]);
	assert.deepEqual(dependencies.events, ['bootstrap', 'error']);
});

test('a microphone restoration failure leaves startup ready and is suppressed after disposal', async () => {
	const dependencies = fixture();
	const pending = deferred<void>();
	dependencies.startMicrophoneMeter = () => pending.promise;
	assert.deepEqual(await startController(dependencies), { phase: 'ready' });
	dependencies.lifetime.beginDisposal();
	pending.reject(new Error('microphone released'));
	await Promise.resolve();
	assert.deepEqual(dependencies.events, ['bootstrap', 'capture', 'ready']);
});

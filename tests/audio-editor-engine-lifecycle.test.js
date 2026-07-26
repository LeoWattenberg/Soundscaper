import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AudioEditorEngineDisposedError,
	createAudioEditorEngine,
} from '../src/common/editor/engine.js';

test('engine disposal is terminal and cannot create a later AudioContext', async () => {
	let contextCreations = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: function AudioContext() {
			contextCreations += 1;
			return createContext();
		},
	});

	const firstDispose = engine.dispose();
	assert.strictEqual(engine.dispose(), firstDispose);
	await firstDispose;

	await assert.rejects(() => engine.getAudioContext(), { code: 'ENGINE_DISPOSED' });
	assert.throws(() => engine.loadProject({ tracks: [], clips: [] }), AudioEditorEngineDisposedError);
	assert.equal(contextCreations, 0);
	assert.equal(engine.getState().state, 'disposed');
});

test('an AudioContext still loading during disposal is closed and never installed again', async () => {
	const sinkGate = deferred();
	const contexts = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: function AudioContext() {
			const context = createContext({ setSinkId: () => sinkGate.promise });
			contexts.push(context);
			return context;
		},
	});
	await engine.setOutputDevice('studio-output');
	const loading = engine.getAudioContext({ resume: false });
	await Promise.resolve();

	await engine.dispose();
	sinkGate.resolve();
	await assert.rejects(loading, { code: 'ENGINE_DISPOSED' });
	await assert.rejects(() => engine.getAudioContext(), { code: 'ENGINE_DISPOSED' });

	assert.equal(contexts.length, 1);
	assert.ok(contexts[0].closeCalls >= 1);
});

function createContext(overrides = {}) {
	return {
		state: 'suspended',
		closeCalls: 0,
		async resume() { this.state = 'running'; },
		async close() { this.closeCalls += 1; this.state = 'closed'; },
		...overrides,
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

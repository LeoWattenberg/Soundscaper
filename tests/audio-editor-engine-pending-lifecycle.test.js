/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import {
	MockAudioBuffer,
	MockAudioContext,
	MockNode,
} from './helpers/mock-audio-context.js';
import { createMockAudioWorkletNodeClass } from './helpers/mock-audio-worklet-node.js';

const MockAudioWorkletNode = createMockAudioWorkletNodeClass(MockNode);

for (const request of [
	{
		name: 'ordinary playback',
		start: (engine) => engine.play(),
		rejects: false,
	},
	{
		name: 'scheduled recording playback',
		start: (engine) => engine.playAt(0, 0),
		rejects: true,
	},
	{
		name: 'variable-speed playback',
		start: (engine) => engine.playAtSpeed(2),
		rejects: true,
	},
]) {
	test(`stopping while ${request.name} resumes cannot resurrect its pending start`, async () => {
		const fixture = pendingResumeFixture();
		const pending = request.start(fixture.engine);
		await fixture.resumeRequested;
		fixture.engine.stop();
		fixture.allowResume();
		if (request.rejects) await assert.rejects(pending, { name: 'AbortError' });
		else await pending;

		assert.equal(fixture.engine.getState().state, 'stopped');
		assert.equal(fixture.engine.graph, null);
		assert.equal(fixture.context.bufferSources.length, 0);
		await fixture.engine.dispose();
	});
}

test('an EBU master meter that resolves after engine disposal is retired without publishing', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const moduleRequested = deferred();
	const moduleGate = deferred();
	context.audioWorklet.addModule = async (url) => {
		context.audioWorkletModules.push(String(url));
		if (!String(url).endsWith('/ebu-r128-worklet.js')) return;
		moduleRequested.resolve();
		await moduleGate.promise;
	};
	const engine = loadedEngine(context, { onMeter() {}, meterInterval: 1_000 });
	try {
		const playback = engine.play();
		await moduleRequested.promise;
		await engine.dispose();
		moduleGate.resolve();
		await playback;

		const meter = context.workletNodes.find(({ name }) => name === 'kw-ebu-r128-meter');
		assert.ok(meter);
		assert.equal(meter.disconnected, true);
		assert.equal(engine.masterLoudnessMeter, null);
		meter.port.onmessage?.({
			data: { type: 'meter', meter: { loudness: { integratedLufs: -18 } } },
		});
		assert.equal(engine.latestMasterLoudnessMeter, null);
		assert.equal(engine.getState().state, 'disposed');
		assert.equal(engine.graph, null);
	} finally {
		moduleGate.resolve();
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

function pendingResumeFixture() {
	const context = new MockAudioContext();
	const resumeRequested = deferred();
	const resumeGate = deferred();
	context.resume = () => {
		resumeRequested.resolve();
		return resumeGate.promise;
	};
	return {
		context,
		engine: loadedEngine(context),
		resumeRequested: resumeRequested.promise,
		allowResume: resumeGate.resolve,
	};
}

function loadedEngine(context, options = {}) {
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, ...options });
	engine.loadProject(project(), new Map([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000)],
	]));
	return engine;
}

function project() {
	return {
		id: 'pending-lifecycle', sampleRate: 48_000,
		clips: [{
			id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: 48_000, gain: 1,
			fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		}],
		tracks: [{
			id: 'track-1', clipIds: ['clip-1'], gain: 1, pan: 0,
			mute: false, solo: false, effects: [],
		}],
		master: { gain: 1, effects: [] },
	};
}

function deferred() {
	let resolve;
	const promise = new Promise((accept) => { resolve = accept; });
	return { promise, resolve };
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { ENGINE_ENSURE_MASTER_LOUDNESS_METER } from '../src/common/editor/engine/runtime-symbols.ts';
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

test('concurrent EBU master meter requests share one connected worklet', async () => {
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
	const engine = loadedEngine(context, { onMeter() {} });
	engine.context = context;
	try {
		const first = engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		await moduleRequested.promise;
		const second = engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		moduleGate.resolve();
		const [firstMeter, secondMeter] = await Promise.all([first, second]);

		assert.strictEqual(secondMeter, firstMeter);
		assert.equal(context.workletNodes.filter(({ name }) => name === 'kw-ebu-r128-meter').length, 1);
	} finally {
		moduleGate.resolve();
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('loading a project with a different native master width rebuilds its EBU meter', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	context.destination.maxChannelCount = 8;
	const engine = loadedEngine(context, { onMeter() {} });
	engine.context = context;
	try {
		const stereoMeter = await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		assert.equal(stereoMeter.node.options.channelCount, 2);

		engine.loadProject(project(6), engine.sources);
		assert.equal(stereoMeter.node.disconnected, true);
		assert.equal(engine.masterLoudnessMeter, null);
		const surroundMeter = await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		assert.equal(surroundMeter.node.options.channelCount, 6);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('loading an immersive project preserves a capable destination wider than the EBU meter', async () => {
	const context = new MockAudioContext();
	context.destination.maxChannelCount = 32;
	const engine = loadedEngine(context);
	try {
		await engine.getAudioContext({ resume: false });
		engine.loadProject(project(12), engine.sources);

		assert.equal(context.destination.channelCount, 12);
		assert.equal(engine.masterLoudnessMeter, null);
		assert.equal(engine.masterLoudnessMeterChannelCount, null);
	} finally {
		await engine.dispose();
	}
});

test('an immersive master declines an undersized EBU passthrough without narrowing playback', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	context.destination.maxChannelCount = 32;
	const engine = loadedEngine(context, { onMeter() {} });
	try {
		await engine.getAudioContext({ resume: false });
		engine.loadProject(project(12), engine.sources);
		const unsupportedMeter = await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);

		assert.equal(unsupportedMeter, null);
		assert.equal(context.destination.channelCount, 12);
		assert.equal(context.workletNodes.filter(({ name }) => name === 'kw-ebu-r128-meter').length, 0);
		assert.match(engine.getLoudnessMeasurementState().error?.message, /up to 8 channels/i);

		engine.loadProject(project(6), engine.sources);
		assert.equal(engine.getLoudnessMeasurementState().error, null);
		const supportedMeter = await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		assert.equal(supportedMeter.node.options.channelCount, 6);
		assert.equal(context.destination.channelCount, 6);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('the realtime EBU meter uses canonical authored 7.1 roles without guessing from width', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	context.destination.maxChannelCount = 8;
	const engine = loadedEngine(context, { onMeter() {} });
	engine.context = context;
	try {
		engine.loadProject(authoredEightChannelProject('7.1'), engine.sources);
		const semanticMeter = await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		assert.deepEqual(semanticMeter.node.options.processorOptions.channelWeights, [
			1, 1, 1, 0, Math.SQRT2, Math.SQRT2, 1, 1,
		]);

		engine.loadProject(authoredEightChannelProject('5.1.2'), engine.sources);
		assert.equal(semanticMeter.node.disconnected, true);
		const widthOnlyMeter = await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		assert.equal(widthOnlyMeter.node.options.processorOptions.channelWeights, undefined);
	} finally {
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

function project(masterChannels = 2) {
	return {
		id: 'pending-lifecycle', sampleRate: 48_000, masterChannels,
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

function authoredEightChannelProject(layout) {
	return {
		...project(8),
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Programme', language: '' },
				content: { name: 'Content', language: '' },
				bed: { name: 'Bed', layout, assignments: [] },
			},
		},
	};
}

function deferred() {
	let resolve;
	const promise = new Promise((accept) => { resolve = accept; });
	return { promise, resolve };
}

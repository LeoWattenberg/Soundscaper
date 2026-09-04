import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAudioEditorEngine,
} from '../src/common/editor/engine.js';
import {
	MockAudioBuffer,
	MockAudioContext,
} from './helpers/mock-audio-context.js';
import {
	MockAudioWorkletNode,
	MockGainRenderingOfflineAudioContext,
	createProject,
	createTrackEnvelopeProject,
} from './helpers/audio-editor-runtime-harness.js';

test('engine schedules clip volume automation for live playback', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.clips[0].fadeInFrames = 0;
	project.clips[0].fadeOutFrames = 0;
	project.clips[0].envelope = [{ frame: 12_000, value: 0.5 }, { frame: 36_000, value: 0.25 }];
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));
	await engine.play();
	const fadeIn = context.bufferSources[0].connections[0];
	const fadeOut = fadeIn.connections[0];
	const clipGain = fadeOut.connections[0];
	assert.deepEqual(clipGain.gain.events, [
		['set', 0.8, 0],
		['ramp', 0.4, 0.25],
		['ramp', 0.2, 0.75],
		['ramp', 0.2, 1],
	]);
	engine.stop();
	await engine.dispose();
});

test('engine schedules track automation in project time and composes it with static track gain', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext({ sampleRate: 8 });
	const project = createTrackEnvelopeProject({
		effects: [{ type: 'limiter', params: { lookahead: 0.25 } }],
	});
	const source = new MockAudioBuffer(1, 8, 8);
	source.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	try {
		engine.loadProject(project, new Map([['envelope-source', source]]));
		engine.seek(2);
		await engine.play();

		const fadeIn = context.bufferSources[0].connections[0];
		const fadeOut = fadeIn.connections[0];
		const clipGain = fadeOut.connections[0];
		const trackInput = clipGain.connections[0];
		const limiter = trackInput.connections[0];
		const trackGain = limiter.connections[0];
		assert.equal(limiter.kind, 'audio-worklet');
		assert.deepEqual(trackGain.gain.events, [
			['set', 0.5, 0],
			['set', 0.25, 0.25],
			['ramp', 0, 0.5],
			['ramp', 0.5, 1],
			['ramp', 0.5, 30],
		]);
		engine.stop();
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('offline engine render bakes track automation into PCM across a cropped timeline range', async () => {
	const project = createTrackEnvelopeProject();
	const source = new MockAudioBuffer(1, 8, 8);
	source.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => new MockGainRenderingOfflineAudioContext(options),
	});
	engine.loadProject(project, new Map([['envelope-source', source]]));
	const rendered = await engine.renderMix({
		startFrame: 2,
		endFrame: 6,
		includeMaster: false,
		includeTrackPan: false,
		respectMuteSolo: false,
	});
	assert.deepEqual(Array.from(rendered.getChannelData(0)), [0.25, 0.125, 0, 0.125]);
	assert.deepEqual(rendered.getChannelData(1), rendered.getChannelData(0));
	await engine.dispose();
});

test('engine schedules group, send, and master automation in project time after rack latency', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext({ sampleRate: 8 });
	const project = createTrackEnvelopeProject();
	const envelope = [{ frame: 0, value: 1 }, { frame: 4, value: 0 }, { frame: 8, value: 1 }];
	project.tracks[0].gain = 1;
	project.tracks[0].envelope = [];
	project.mixer = {
		groups: [{
			id: 'group-output', gain: 0.5, pan: 0, mute: false, solo: false,
			envelope, effects: [{ type: 'limiter', params: { lookahead: 0.25 } }],
		}],
		sends: [{
			id: 'send-output', gain: 0.25, pan: 0, mute: false, solo: false,
			envelope, effects: [],
		}],
		routes: { 'envelope-track': { groupId: 'group-output', sends: { 'send-output': 1 } } },
	};
	project.master = {
		gain: 0.75, pan: 0, mute: false, envelope,
		effects: [{ type: 'limiter', params: { lookahead: 0.25 } }],
	};
	const source = new MockAudioBuffer(1, 8, 8);
	source.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	try {
		engine.loadProject(project, new Map([['envelope-source', source]]));
		engine.seek(2);
		await engine.play();

		const groupGain = engine.graph.projectGainParams.groups.get('group-output').param;
		const sendGain = engine.graph.projectGainParams.sends.get('send-output').param;
		const masterGain = engine.graph.projectGainParams.master.param;
		assert.deepEqual(groupGain.events, [
			['set', 0.5, 0],
			['set', 0.25, 0.25],
			['ramp', 0, 0.5],
			['ramp', 0.5, 1],
			['ramp', 0.5, 30],
		]);
		assert.deepEqual(sendGain.events, [
			['set', 0.25, 0],
			['set', 0.125, 0],
			['ramp', 0, 0.25],
			['ramp', 0.25, 0.75],
			['ramp', 0.25, 29.75],
		]);
		assert.deepEqual(masterGain.events, [
			['set', 0.75, 0],
			['set', 0.375, 0.5],
			['ramp', 0, 0.75],
			['ramp', 0.75, 1.25],
			['ramp', 0.75, 30.25],
		]);
		engine.stop();
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('offline engine render composes output envelopes with static gains and bypasses master automation on request', async () => {
	const project = createTrackEnvelopeProject();
	const envelope = [{ frame: 0, value: 0.5 }, { frame: 8, value: 0.5 }];
	project.tracks[0].gain = 1;
	project.tracks[0].envelope = [];
	project.mixer = {
		groups: [{
			id: 'group-output', gain: 0.5, pan: 0, mute: false, solo: false,
			envelope, effects: [],
		}],
		sends: [{
			id: 'send-output', gain: 0.5, pan: 0, mute: false, solo: false,
			envelope, effects: [],
		}],
		routes: { 'envelope-track': { groupId: 'group-output', sends: { 'send-output': 0.5 } } },
	};
	project.master = { gain: 0.5, pan: 0, mute: false, envelope, effects: [] };
	const source = new MockAudioBuffer(1, 8, 8);
	source.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => new MockGainRenderingOfflineAudioContext(options),
	});
	engine.loadProject(project, new Map([['envelope-source', source]]));
	const processed = await engine.renderMix({
		startFrame: 0, endFrame: 8, includeTrackPan: false, respectMuteSolo: false,
	});
	const withoutMaster = await engine.renderMix({
		startFrame: 0, endFrame: 8, includeMaster: false, includeTrackPan: false, respectMuteSolo: false,
	});
	assert.ok(Array.from(processed.getChannelData(0)).every((value) => Math.abs(value - 0.09375) < 1e-7));
	assert.ok(Array.from(withoutMaster.getChannelData(0)).every((value) => Math.abs(value - 0.375) < 1e-7));
	assert.deepEqual(processed.getChannelData(1), processed.getChannelData(0));
	assert.deepEqual(withoutMaster.getChannelData(1), withoutMaster.getChannelData(0));
	await engine.dispose();
});

test('offline engine render evaluates a group envelope against a cropped project-time range', async () => {
	const project = createTrackEnvelopeProject();
	project.tracks[0].gain = 1;
	project.tracks[0].envelope = [];
	project.mixer = {
		groups: [{
			id: 'group-output', gain: 0.5, pan: 0, mute: false, solo: false,
			envelope: [{ frame: 0, value: 1 }, { frame: 4, value: 0 }, { frame: 8, value: 1 }],
			effects: [],
		}],
		sends: [],
		routes: { 'envelope-track': { groupId: 'group-output', sends: {} } },
	};
	project.master = { gain: 1, pan: 0, mute: false, envelope: [], effects: [] };
	const source = new MockAudioBuffer(1, 8, 8);
	source.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => new MockGainRenderingOfflineAudioContext(options),
	});
	engine.loadProject(project, new Map([['envelope-source', source]]));
	const rendered = await engine.renderMix({
		startFrame: 2, endFrame: 6, includeMaster: false, includeTrackPan: false, respectMuteSolo: false,
	});
	assert.deepEqual(Array.from(rendered.getChannelData(0)), [0.25, 0.125, 0, 0.125]);
	assert.deepEqual(rendered.getChannelData(1), rendered.getChannelData(0));
	await engine.dispose();
});

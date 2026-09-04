import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyEffectRack,
	automaticCrossfadeRanges,
	buildProjectGraph,
	createAudioEditorEngine,
	effectRackLatencyFrames,
	projectEffectRacks,
	projectGraphLatencyFrames,
} from '../src/common/editor/engine.js';
import {
	MockAudioBuffer,
	MockAudioContext,
} from './helpers/mock-audio-context.js';
import {
	MockAudioWorkletNode,
	MockRampOfflineAudioContext,
	createProject,
	createRackProject,
	incomingConnections,
} from './helpers/audio-editor-runtime-harness.js';

test('project graph meters pre-mute tracks and applies master processing', () => {
	const context = new MockAudioContext();
	const graph = buildProjectGraph(context, context.destination, createProject(), { metering: true });
	assert.equal(graph.trackInputs.size, 1);
	assert.equal(graph.trackAnalysers.size, 1);
	assert.ok(graph.masterAnalyser);
	assert.ok(context.nodeKinds.includes('stereo-panner'));
	assert.ok(context.nodeKinds.includes('convolver'));

	const dryContext = new MockAudioContext();
	const dryGraph = buildProjectGraph(dryContext, dryContext.destination, createProject(), {
		metering: false,
		includeTrackPan: false,
	});
	assert.equal(dryContext.nodeKinds.includes('stereo-panner'), false);
	assert.equal(dryGraph.trackInputs.size, 1);
});

test('project graph builds metered group and send bus paths', () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.mixer = {
		groups: [{ id: 'group-1', name: 'Group 1', gain: 0.8, pan: 0, mute: false, solo: false, effects: [] }],
		sends: [{ id: 'send-1', name: 'Send 1', gain: 0.5, pan: 0.25, mute: false, solo: false, effects: [] }],
		routes: { 'track-1': { groupId: 'group-1', sends: { 'send-1': 0.3 } } },
	};
	const graph = buildProjectGraph(context, context.destination, project, { metering: true });
	assert.deepEqual([...graph.groupAnalysers.keys()], ['group-1']);
	assert.deepEqual([...graph.sendAnalysers.keys()], ['send-1']);
	assert.equal(graph.trackAnalysers.size, 1);
	assert.ok(context.nodeKinds.filter((kind) => kind === 'analyser').length >= 4);
	assert.ok(context.nodeKinds.includes('stereo-panner'));
});

test('zero-wet native delay and reverb effects bypass graph allocation', () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.tracks[0].effects = [
		{ type: 'delay', params: { time: 1, feedback: 0.9, mix: 0 } },
		{ type: 'reverb', params: { decay: 10, preDelay: 1, mix: 0 } },
	];
	project.master.effects = [];
	buildProjectGraph(context, context.destination, project, { metering: false });
	assert.equal(context.nodeKinds.includes('delay'), false);
	assert.equal(context.nodeKinds.includes('convolver'), false);
});

test('project effect rack iteration includes track, group, send, and master locations', () => {
	const project = createRackProject({
		tracks: [{ id: 'track-1', effects: [{ id: 'track-fx', type: 'highpass', params: {} }] }],
		masterEffects: [{ id: 'master-fx', type: 'compressor', params: {} }],
	});
	project.tracks.push({ id: 'labels', type: 'label', effects: [{ id: 'ignored', type: 'eq', params: {} }] });
	project.mixer = {
		groups: [{ id: 'group-1', effects: [{ id: 'group-fx', type: 'delay', params: {} }] }],
		sends: [{ id: 'send-1', effects: [{ id: 'send-fx', type: 'reverb', params: {} }] }],
		routes: {},
	};
	assert.deepEqual([...projectEffectRacks(project)].map(({ scope, targetId, effects }) => ({
		scope,
		targetId,
		effectIds: effects.map((effect) => effect.id),
	})), [
		{ scope: 'track', targetId: 'track-1', effectIds: ['track-fx'] },
		{ scope: 'group', targetId: 'group-1', effectIds: ['group-fx'] },
		{ scope: 'send', targetId: 'send-1', effectIds: ['send-fx'] },
		{ scope: 'master', targetId: null, effectIds: ['master-fx'] },
	]);
});

test('missing effects and inactive racks add no processor or latency', () => {
	const input = { connect() { throw new Error('A missing effect must not connect a processor.'); } };
	const missing = {
		id: 'missing-plugin',
		type: 'missing',
		enabled: true,
		bypassed: true,
		params: {},
		missing: {
			name: 'SuperVerb',
			nativeId: 'Effect_VST3_Acme_SuperVerb_Path',
			reason: 'plugin-unavailable',
			source: 'aup4',
		},
	};
	assert.equal(applyEffectRack({ sampleRate: 48_000 }, input, [missing]), input);
	assert.equal(effectRackLatencyFrames([missing], 48_000), 0);

	const project = createRackProject({
		tracks: [{
			id: 'track-1',
			effectsActive: false,
			effects: [{ id: 'limiter', type: 'limiter', enabled: true, params: { lookahead: 0.1 } }],
		}],
		masterEffects: [missing],
	});
	project.master.effectsActive = true;
	const racks = [...projectEffectRacks(project)];
	assert.equal(racks[0].effectsActive, false);
	assert.deepEqual(racks[0].effects, []);
	assert.equal(racks.at(-1).effectsActive, true);
	assert.equal(projectGraphLatencyFrames(project), 0);
});

test('Auto Duck receives its selected control track from the dry second input', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createRackProject({
		tracks: [
			{
				id: 'target',
				effects: [{
					type: 'audacity-auto-duck',
					enabled: true,
					params: {},
					context: { controlTrackId: 'control' },
				}],
			},
			{
				id: 'control',
				effects: [{ type: 'audacity-invert', enabled: true, params: {} }],
			},
		],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		const autoDuck = context.workletNodes.find((node) => (
			node.options.processorOptions.effectType === 'audacity-auto-duck'
		));
		assert.ok(autoDuck);
		assert.equal(autoDuck.options.numberOfInputs, 2);
		const dryControl = engine.graph.trackInputs.get('control');
		assert.ok(dryControl.connectionDetails.some(({ node, output, input }) => (
			node === autoDuck && output === 0 && input === 1
		)));
		const processedControl = context.workletNodes.find((node) => (
			node.options.processorOptions.effectType === 'audacity-invert'
		));
		assert.equal(processedControl.connectionDetails.some(({ node }) => node === autoDuck), false);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('Auto Duck sidechains align with compensated bus and master program paths', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createRackProject({
		tracks: [
			{
				id: 'program',
				effects: [{
					type: 'audacity-limiter',
					enabled: true,
					params: { lookaheadMs: 10 },
				}],
			},
			{ id: 'control', effects: [] },
		],
		masterEffects: [{
			type: 'audacity-auto-duck',
			enabled: true,
			params: {},
			context: { controlTrackId: 'control' },
		}],
	});
	project.mixer = {
		groups: [{
			id: 'duck-group',
			gain: 1,
			pan: 0,
			mute: false,
			solo: false,
			effects: [{
				type: 'audacity-auto-duck',
				enabled: true,
				params: {},
				context: { controlTrackId: 'control' },
			}],
		}],
		sends: [],
		routes: {
			program: { groupId: 'duck-group', sends: {} },
			control: { groupId: null, sends: {} },
		},
	};
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		const autoDucks = context.workletNodes.filter((node) => (
			node.options.processorOptions.effectType === 'audacity-auto-duck'
		));
		assert.equal(autoDucks.length, 2);
		const groupLatencyFrames = effectRackLatencyFrames(project.mixer.groups[0].effects, 48_000);
		const sidechainDelayFor = (processor) => context.createdDelays.find((delay) => (
			delay.connectionDetails.some(({ node, input }) => node === processor && input === 1)
		));
		assert.equal(sidechainDelayFor(autoDucks[0]).delayTime.value, 0.01);
		assert.equal(sidechainDelayFor(autoDucks[1]).delayTime.value, (480 + groupLatencyFrames) / 48_000);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('project graph reports rack latency and delays lower-latency tracks to match', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext({ sampleRate: 96_000 });
	const project = createRackProject({
		tracks: [
			{
				id: 'limited',
				effects: [{
					type: 'audacity-limiter',
					enabled: true,
					params: { lookaheadMs: 10 },
				}],
			},
			{ id: 'dry', effects: [] },
		],
		masterEffects: [{
			type: 'audacity-compressor',
			enabled: true,
			params: { lookaheadMs: 5 },
		}],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		assert.equal(projectGraphLatencyFrames(project), 720);
		assert.equal(engine.graph.latencyFrames, 1_440);
		assert.equal(engine.playbackStartTime, 1_440 / 96_000);
		const compensation = context.createdDelays.find((delay) => Math.abs(delay.delayTime.value - 0.01) < 1e-12);
		assert.ok(compensation, 'the dry track receives the limiter lookahead as compensation');
		assert.ok(incomingConnections(engine.graph.nodes, compensation, 0).length > 0);
		assert.ok(compensation.connectionDetails.length > 0);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('offline rendering crops live latency while retaining the requested effect tail', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const offlineContexts = [];
	const project = createRackProject({
		tracks: [{
			id: 'limited',
			effects: [{
				type: 'audacity-limiter',
				enabled: true,
				params: { lookaheadMs: 10 },
			}],
		}],
		masterEffects: [{
			type: 'audacity-echo',
			enabled: true,
			params: { delaySeconds: 0.1, decay: 0.5 },
		}],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => {
			const context = new MockRampOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		const rendered = await engine.renderMix({ startFrame: 0, endFrame: 2_400, includeTail: true });
		const expectedTailFrames = 48_000;
		const expectedLatencyFrames = 480;
		assert.equal(offlineContexts.length, 1);
		assert.equal(offlineContexts[0].length, 2_400 + expectedTailFrames + expectedLatencyFrames);
		assert.equal(rendered.length, 2_400 + expectedTailFrames);
		assert.equal(rendered.getChannelData(0)[0], expectedLatencyFrames);
		assert.equal(rendered.getChannelData(0).at(-1), offlineContexts[0].length - 1);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('automatic offline tail length includes routed bus racks', async () => {
	const offlineContexts = [];
	const project = createRackProject({
		tracks: [{ id: 'routed', effects: [] }],
	});
	project.mixer = {
		groups: [{
			id: 'delay-group',
			gain: 1,
			pan: 0,
			mute: false,
			solo: false,
			effects: [{
				type: 'delay',
				enabled: true,
				params: { time: 0.1, feedback: 0, mix: 1 },
			}],
		}],
		sends: [],
		routes: { routed: { groupId: 'delay-group', sends: {} } },
	};
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => {
			const context = new MockRampOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		const rendered = await engine.renderMix({ startFrame: 0, endFrame: 2_400, includeTail: true });
		assert.equal(offlineContexts[0].length, 2_400 + 4_800);
		assert.equal(rendered.length, 2_400 + 4_800);
	} finally {
		await engine.dispose();
	}
});

test('master EBU metering stays post-master and persists across transport graph rebuilds', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		onMeter() {},
		meterInterval: 1_000,
	});
	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		const meter = context.workletNodes.find(({ name }) => name === 'kw-ebu-r128-meter');
		assert.ok(meter);
		assert.deepEqual([engine.setPlaybackGain(0.5), engine.getPlaybackGain(), meter.connections[0].kind, meter.connections[0].connections[0], meter.connections[0].gain.value, project.master.gain], [0.5, 0.5, 'gain', context.destination, 0.5, 0.9]);
		assert.ok(incomingConnections(engine.graph.nodes, meter, 0).length > 0);
		assert.deepEqual(meter.messages.at(-1), { type: 'running', running: true });

		engine.pauseLoudnessMeasurement();
		assert.deepEqual(meter.messages.at(-1), { type: 'running', running: false });
		engine.continueLoudnessMeasurement();
		assert.deepEqual(meter.messages.at(-1), { type: 'running', running: true });
		engine.resetLoudnessMeasurement();
		assert.deepEqual(meter.messages.slice(-2), [{ type: 'reset' }, { type: 'snapshot' }]);

		engine.seek(12_000);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(context.workletNodes.filter(({ name }) => name === 'kw-ebu-r128-meter').length, 1);
		assert.ok(incomingConnections(engine.graph.nodes, meter, 0).length > 0);
		assert.deepEqual(meter.messages.slice(-2), [
			{ type: 'running', running: false },
			{ type: 'running', running: true },
		]);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('automatic crossfade ranges pair overlapping clips on the same track', () => {
	const ranges = automaticCrossfadeRanges([
		{ id: 'early', timelineStartFrame: 0, durationFrames: 10 },
		{ id: 'late', timelineStartFrame: 5, durationFrames: 10 },
		{ id: 'separate', timelineStartFrame: 20, durationFrames: 5 },
	]);
	assert.deepEqual(ranges.get('early'), {
		crossfadeInRanges: [],
		crossfadeOutRanges: [[5, 10]],
	});
	assert.deepEqual(ranges.get('late'), {
		crossfadeInRanges: [[0, 5]],
		crossfadeOutRanges: [],
	});
	assert.deepEqual(ranges.get('separate'), {
		crossfadeInRanges: [],
		crossfadeOutRanges: [],
	});
});

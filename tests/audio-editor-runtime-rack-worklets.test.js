import test from 'node:test';
import assert from 'node:assert/strict';
import {
	PARAMETRIC_EQ_SPECTRUM_FFT_SIZE,
	createAudioEditorEngine,
} from '../src/common/editor/engine.js';
import {
	MockAudioBuffer,
	MockAudioContext,
} from './helpers/mock-audio-context.js';
import {
	MockAudioWorkletNode,
	MockOfflineAudioContext,
	createRackProject,
	incomingConnections,
} from './helpers/audio-editor-runtime-harness.js';

test('engine loads and inserts Audacity worklets in track and master racks without bypassing them', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createRackProject({
		tracks: [{
			id: 'track-1',
			effects: [{ type: 'audacity-invert', enabled: true, params: {} }],
		}],
		masterEffects: [{
			type: 'audacity-bass-treble',
			enabled: true,
			params: { bassDb: 3, trebleDb: -2, volumeDb: 0 },
		}],
	});
	const source = new MockAudioBuffer(2, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		assert.equal(realtime.audioWorkletModules.filter((url) => url.endsWith('/audacity-effects/live-worklet.js')).length, 1);
		const worklets = realtime.workletNodes.filter((node) => node.name === 'kw-audacity-live-effect' && !node.readinessProbe);
		assert.deepEqual(worklets.map((node) => node.options.processorOptions.effectType), [
			'audacity-invert',
			'audacity-bass-treble',
		]);
		for (const worklet of worklets) {
			assert.ok(incomingConnections(engine.graph.nodes, worklet, 0).length > 0, `${worklet.options.processorOptions.effectType} input`);
			assert.ok(worklet.connectionDetails.length > 0, `${worklet.options.processorOptions.effectType} output`);
		}

		engine.stop();
		await engine.renderMix({ startFrame: 0, endFrame: 2_400 });
		assert.equal(offlineContexts.length, 1);
		assert.equal(offlineContexts[0].audioWorkletModules.filter((url) => url.endsWith('/audacity-effects/live-worklet.js')).length, 1);
		assert.deepEqual(
			offlineContexts[0].workletNodes
				.filter((node) => node.name === 'kw-audacity-live-effect' && !node.readinessProbe)
				.map((node) => node.options.processorOptions.effectType),
			['audacity-invert', 'audacity-bass-treble'],
		);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('engine uses the sample-accurate delay worklet for playback and offline renders', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createRackProject({
		tracks: [{
			id: 'track-1',
			effects: [{
				id: 'delay-1',
				type: 'delay',
				enabled: true,
				params: { time: 0.01, feedback: 0.5, mix: 1 },
			}],
		}],
	});
	const sources = new Map([['source-1', new MockAudioBuffer(2, 4_800, 48_000)]]);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		meterInterval: 1_000,
	});
	try {
		engine.loadProject(project, sources);
		await engine.play();
		assert.equal(realtime.audioWorkletModules.filter((url) => url.endsWith('/delay-worklet.js')).length, 1);
		assert.deepEqual(realtime.workletNodes.map((node) => node.name), ['kw-audio-delay']);
		assert.deepEqual(realtime.workletNodes[0].options.outputChannelCount, [2]);
		assert.deepEqual(realtime.workletNodes[0].options.processorOptions.params, {
			time: 0.01,
			feedback: 0.5,
			mix: 1,
		});
		assert.equal(realtime.createdDelays.length, 0);
		assert.equal(engine.graph.effectNodes.size, 1);
		assert.equal(engine.configureRackEffect('track', 'track-1', 'delay-1', { feedback: 0.25 }), 1);
		assert.deepEqual(realtime.workletNodes[0].messages, [{
			type: 'configure',
			params: { time: 0.01, feedback: 0.25, mix: 1 },
			revision: 1,
			sequence: 1,
		}]);
		assert.equal(engine.project.tracks[0].effects[0].params.feedback, 0.25);
		assert.equal(engine.configureRackEffect('track', 'track-1', 'missing-delay', { feedback: 0.1 }), false);

		engine.stop();
		await engine.renderMix({ startFrame: 0, endFrame: 4_800 });
		assert.equal(offlineContexts.length, 1);
		assert.equal(offlineContexts[0].audioWorkletModules.filter((url) => url.endsWith('/delay-worklet.js')).length, 1);
		assert.deepEqual(offlineContexts[0].workletNodes.map((node) => node.name), ['kw-audio-delay']);
		assert.equal(offlineContexts[0].createdDelays.length, 0);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('engine falls back to a native delay when its optional worklet cannot load', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	context.audioWorklet.addModule = async (url) => {
		context.audioWorkletModules.push(String(url));
		throw new Error('mock delay module load failed');
	};
	const project = createRackProject({
		tracks: [{
			id: 'track-1',
			effects: [{
				id: 'delay-1',
				type: 'delay',
				enabled: true,
				params: { time: 0.01, feedback: 0.5, mix: 1 },
			}],
		}],
	});
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	try {
		engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4_800, 48_000)]]));
		await engine.play();
		assert.equal(context.audioWorkletModules.filter((url) => url.endsWith('/delay-worklet.js')).length, 1);
		assert.equal(context.workletNodes.length, 0);
		assert.equal(context.createdDelays.length, 1);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('parametric EQ worklets load for mixer buses and accept scoped transient updates without a rebuild', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const eqParams = {
		outputGain: 0,
		bands: [{ id: 'band-1', enabled: true, type: 'peaking', frequency: 1_000, gain: 3, q: 1, slope: 12 }],
	};
	const project = createRackProject({ tracks: [{ id: 'track-1', effects: [] }] });
	project.mixer = {
		groups: [{
			id: 'group-1', gain: 1, pan: 0, mute: false, solo: false,
			effects: [{ id: 'group-eq', type: 'eq', enabled: true, params: eqParams }],
		}],
		sends: [{
			id: 'send-1', gain: 1, pan: 0, mute: false, solo: false,
			effects: [{ id: 'send-eq', type: 'parametric-eq', enabled: true, params: eqParams }],
		}],
		routes: { 'track-1': { groupId: 'group-1', sends: { 'send-1': 0.5 } } },
	};
	const source = new MockAudioBuffer(2, 4_800, 48_000);
	const sources = new Map([['source-1', source]]);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, sources);
		await engine.play();
		assert.equal(realtime.audioWorkletModules.filter((url) => url.endsWith('/parametric-eq/worklet.js')).length, 1);
		assert.deepEqual(realtime.workletNodes.map((node) => node.name), ['kw-parametric-eq', 'kw-parametric-eq']);
		assert.equal(engine.graph.effectNodes.size, 2);
		assert.equal(engine.graph.effectAnalysers.size, 2);
		for (const node of realtime.workletNodes) {
			assert.equal(node.options.outputChannelCount, undefined);
			assert.equal(node.options.channelCountMode, 'max');
			assert.ok(node.options.processorOptions.wasmModule instanceof WebAssembly.Module);
			assert.equal(node.options.processorOptions.channelCount, 2);
		}

		const groupNode = realtime.workletNodes[0];
		const configuredParams = structuredClone(eqParams);
		configuredParams.bands[0].gain = 6;
		assert.equal(engine.configureParametricEq('group', 'group-1', 'group-eq', configuredParams, { transitionFrames: 480 }), 1);
		assert.equal(engine.configureParametricEq('group', 'group-1', 'group-eq', eqParams, { revision: 7 }), 7);
		assert.equal(engine.configureParametricEq('group', 'group-1', 'group-eq', configuredParams, { revision: 6 }), false);
		assert.equal(engine.auditionParametricEq('group', 'group-1', 'group-eq', 'band-1'), 8);
		assert.equal(engine.resetParametricEq('group', 'group-1', 'group-eq'), 9);
		assert.deepEqual(groupNode.messages, [
			{ type: 'configure', params: configuredParams, transitionFrames: 480, revision: 1, sequence: 1 },
			{ type: 'configure', params: eqParams, revision: 7, sequence: 7 },
			{ type: 'audition', bandId: 'band-1', revision: 8, sequence: 8 },
			{ type: 'reset', revision: 9, sequence: 9 },
		]);
		assert.notEqual(engine.project.mixer.groups[0].effects[0].params, eqParams);
		assert.deepEqual(engine.project.mixer.groups[0].effects[0].params, eqParams);
		assert.equal(engine.configureParametricEq('track', 'track-1', 'missing-eq', eqParams), false);

		const spectrum = new Float32Array(PARAMETRIC_EQ_SPECTRUM_FFT_SIZE / 2);
		const metadata = engine.readParametricEqSpectrum('group', 'group-1', 'group-eq', 'input', spectrum);
		assert.deepEqual(metadata, {
			sampleRate: 48_000,
			fftSize: PARAMETRIC_EQ_SPECTRUM_FFT_SIZE,
			frequencyBinCount: PARAMETRIC_EQ_SPECTRUM_FFT_SIZE / 2,
			minDecibels: -120,
			maxDecibels: 0,
		});
		assert.equal(spectrum[0], -48);
		assert.throws(
			() => engine.readParametricEqSpectrum('group', 'group-1', 'group-eq', 'output', new Float32Array(8)),
			/2048 bins/,
		);

		const updated = structuredClone(project);
		updated.tracks[0].effects.push({ id: 'track-eq', type: 'eq', enabled: true, params: eqParams });
		updated.master.effects.push({ id: 'master-eq', type: 'parametric_eq', enabled: true, params: eqParams });
		await engine.applyProject(updated, sources);
		assert.equal(realtime.audioWorkletModules.filter((url) => url.endsWith('/parametric-eq/worklet.js')).length, 1);
		assert.equal(engine.graph.effectNodes.size, 4);
		assert.equal(engine.configureParametricEq('track', 'track-1', 'track-eq', eqParams), 1);
		assert.equal(engine.auditionParametricEq('master', null, 'master-eq', null), 1);

		engine.stop();
		const stoppedSpectrum = new Float32Array(PARAMETRIC_EQ_SPECTRUM_FFT_SIZE / 2).fill(0);
		assert.equal(engine.readParametricEqSpectrum('group', 'group-1', 'group-eq', 'input', stoppedSpectrum), null);
		assert.equal(stoppedSpectrum[0], Number.NEGATIVE_INFINITY);

		await engine.renderMix({ startFrame: 0, endFrame: 2_400 });
		assert.equal(offlineContexts.length, 1);
		assert.equal(offlineContexts[0].audioWorkletModules.filter((url) => url.endsWith('/parametric-eq/worklet.js')).length, 1);
		assert.equal(offlineContexts[0].workletNodes.filter((node) => node.name === 'kw-parametric-eq').length, 4);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('parametric EQ worklet load failures reject playback instead of falling back to native biquads', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	context.audioWorklet.addModule = async (url) => {
		if (String(url).endsWith('/parametric-eq/worklet.js')) throw new Error('mock parametric EQ module load failed');
		context.audioWorkletModules.push(String(url));
	};
	const project = createRackProject({
		tracks: [{
			id: 'track-1',
			effects: [{
				id: 'track-eq', type: 'eq', enabled: true,
				params: { outputGain: 0, bands: [] },
			}],
		}],
	});
	const engine = createAudioEditorEngine({ audioContextFactory: () => context });
	try {
		engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 4_800, 48_000)]]));
		await assert.rejects(() => engine.play(), /mock parametric EQ module load failed/);
		assert.equal(engine.graph, null);
		assert.equal(context.workletNodes.length, 0);
		assert.equal(context.bufferSources.length, 0);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('parametric EQ processor errors surface with rack context without bypassing the worklet', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createRackProject({
		tracks: [{
			id: 'track-1',
			effects: [{
				id: 'track-eq', type: 'eq', enabled: true,
				params: { outputGain: 0, bands: [] },
			}],
		}],
	});
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	const errors = [];
	const unsubscribe = engine.subscribeParametricEqErrors((error) => errors.push(error));
	try {
		engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 4_800, 48_000)]]));
		await engine.play();
		const processor = context.workletNodes[0];
		processor.port.onmessage({ data: { type: 'status', status: 'ready' } });
		assert.deepEqual(errors, []);

		processor.port.onmessage({
			data: {
				type: 'error',
				message: 'mock EQ processing failure',
				revision: 4,
				sequence: 4,
				scope: 'spoofed',
				effectId: 'spoofed',
			},
		});
		assert.deepEqual(errors, [{
			type: 'error',
			message: 'mock EQ processing failure',
			revision: 4,
			sequence: 4,
			scope: 'track',
			targetId: 'track-1',
			effectId: 'track-eq',
		}]);
		assert.equal(engine.getState().state, 'playing');
		assert.ok(incomingConnections(engine.graph.nodes, processor, 0).length > 0);
		assert.ok(processor.connectionDetails.length > 0);
		assert.equal(context.nodeKinds.includes('biquad'), false);

		unsubscribe();
		processor.port.onmessage({ data: { type: 'error', message: 'ignored after unsubscribe' } });
		assert.equal(errors.length, 1);
		engine.stop();
		assert.equal(processor.port.onmessage, null);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('Audacity worklet load failures reject playback instead of bypassing the rack', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	context.audioWorklet.addModule = async () => { throw new Error('mock Audacity module load failed'); };
	const project = createRackProject({
		tracks: [{ id: 'track-1', effects: [{ type: 'audacity-invert', enabled: true, params: {} }] }],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context });

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await assert.rejects(() => engine.play(), /mock Audacity module load failed/);
		assert.equal(engine.graph, null);
		assert.equal(context.workletNodes.length, 0);
		assert.equal(context.bufferSources.length, 0);
		assert.equal(engine.getState().state, 'stopped');
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('rebuilding a playing rack disconnects its old worklet graph and reuses the loaded module', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createRackProject({
		tracks: [{ id: 'track-1', effects: [{ type: 'audacity-invert', enabled: true, params: {} }] }],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const sources = new Map([['source-1', source]]);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });

	try {
		engine.loadProject(project, sources);
		await engine.play();
		const oldWorklet = context.workletNodes.find((node) => node.name === 'kw-audacity-live-effect' && !node.readinessProbe);
		assert.ok(oldWorklet);
		const updated = structuredClone(project);
		updated.master.effects.push({
			type: 'audacity-bass-treble',
			enabled: true,
			params: { bassDb: 2, trebleDb: 0, volumeDb: 0 },
		});
		await engine.applyProject(updated, sources);

		assert.equal(oldWorklet.disconnected, true);
		assert.equal(context.audioWorkletModules.filter((url) => url.endsWith('/audacity-effects/live-worklet.js')).length, 1);
		assert.deepEqual(
			context.workletNodes
				.filter((node) => node.name === 'kw-audacity-live-effect' && !node.readinessProbe && !node.disconnected)
				.map((node) => node.options.processorOptions.effectType),
			['audacity-invert', 'audacity-bass-treble'],
		);
		assert.equal(engine.getState().state, 'playing');
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

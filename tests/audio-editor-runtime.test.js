import test from 'node:test';
import assert from 'node:assert/strict';
import {
	PARAMETRIC_EQ_SPECTRUM_FFT_SIZE,
	createAudioEditorEngine,
	getProjectDurationFrames,
	getProjectTimelineDurationFrames,
} from '../src/common/editor/engine.js';
import { createRecordingController } from '../src/common/editor/recording.js';
import {
	MockAudioBuffer,
	MockAudioContext,
	MockNode,
} from './helpers/mock-audio-context.js';
import {
	MockAudioWorkletNode,
	MockOfflineAudioContext,
	createProject,
} from './helpers/audio-editor-runtime-harness.js';

test('recording controller serializes writes and releases microphone resources', async () => {
	const posted = [];
	const node = new MockNode();
	node.port = {
		onmessage: null,
		start() {},
		postMessage(message) { posted.push(message); },
	};
	let moduleUrl = '';
	let trackStopped = false;
	const mediaSource = new MockNode();
	const context = {
		destination: new MockNode(),
		audioWorklet: { async addModule(url) { moduleUrl = url; } },
		createMediaStreamSource() { return mediaSource; },
	};
	const stream = { getTracks: () => [{ stop() { trackStopped = true; } }] };
	const writes = [];
	const controller = await createRecordingController({
		context,
		stream,
		workletUrl: '/recorder.js',
		nodeFactory: () => node,
		onChunk: async (chunk) => writes.push([...chunk.channels[0]]),
	});
	assert.equal(moduleUrl, '/recorder.js');
	controller.start({ startFrame: 10, stopFrame: 20 });
	node.port.onmessage({ data: { type: 'audio-chunk', frameStart: 10, frames: 2, channels: [Float32Array.of(0.5, -0.5)] } });
	assert.equal(controller.pause(), true);
	assert.equal(controller.state, 'paused');
	node.port.onmessage({ data: { type: 'paused', frame: 12 } });
	assert.equal(controller.resume(), true);
	assert.equal(controller.state, 'recording');
	node.port.onmessage({ data: { type: 'resumed', frame: 14 } });
	const stopped = controller.stop();
	node.port.onmessage({ data: { type: 'stopped', frame: 20 } });
	assert.deepEqual(await stopped, { frame: 20 });
	assert.deepEqual(writes, [[0.5, -0.5]]);
	assert.deepEqual(posted.map((message) => message.type), ['start', 'pause', 'resume', 'stop']);
	await controller.dispose();
	assert.equal(trackStopped, true);
	assert.equal(mediaSource.disconnected, true);
});

test('Web Audio engine schedules canonical clips, transport, reverse, loop, and offline mix', async () => {
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createProject();
	const source = new MockAudioBuffer(1, 48000, 48000);
	source.getChannelData(0).set([0.1, 0.2, 0.3]);
	const states = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		onState: (state) => states.push(state),
		meterInterval: 1000,
	});
	engine.loadProject(project, new Map([['source-1', source]]));
	assert.equal(getProjectDurationFrames(project), 48000);
	await engine.play();
	assert.equal(realtime.bufferSources.length, 1);
	assert.deepEqual(realtime.bufferSources[0].started, [0, 0, 1]);
	realtime.currentTime = 0.5;
	assert.equal(engine.getPositionFrames(), 24000);
	engine.pause();
	assert.equal(engine.getState().positionFrame, 24000);
	engine.seek(12000);
	engine.setLoop({ enabled: true, startFrame: 12000, endFrame: 24000 });
	await engine.play();
	assert.equal(engine.getState().state, 'playing');
	engine.stop();

	project.clips[0].reversed = true;
	const rendered = await engine.renderMix({ startFrame: 0, endFrame: 24000, includeTail: true });
	assert.equal(rendered.numberOfChannels, 2);
	assert.ok(rendered.length > 24000);
	assert.equal(offlineContexts.length, 1);
	assert.ok(Math.abs(offlineContexts[0].bufferSources[0].buffer.getChannelData(0)[47999] - 0.1) < 1e-6);
	assert.ok(offlineContexts[0].nodeKinds.includes('biquad'));
	assert.ok(offlineContexts[0].nodeKinds.includes('compressor'));
	assert.ok(offlineContexts[0].nodeKinds.includes('delay'));
	assert.ok(states.includes('playing'));
	await engine.dispose();
	assert.equal(realtime.closed, true);
});

test('loop scheduling releases ended clip graphs', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 50,
	});
	engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 4_800 });

	await engine.play();
	const graph = engine.graph;
	assert.equal(context.bufferSources.length, 3);
	assert.equal(graph.sources.size, 3);
	assert.equal(graph.nodes.transientNodes.size, 3 * 4);

	const endedSource = context.bufferSources[0];
	const endedChain = [...endedSource.connections];
	endedSource.onended();
	assert.equal(graph.sources.size, 2);
	assert.equal(graph.nodes.transientNodes.size, 2 * 4);
	assert.equal(endedSource.disconnected, true);
	assert.equal(endedChain.every(({ disconnected }) => disconnected), true);

	engine.stop();
	assert.equal(graph.nodes.transientNodes.size, 0);
	await engine.dispose();
});

test('Web Audio playback uses the extended editor timeline duration', async () => {
	const project = createProject();
	project.clips[0].durationFrames = 960_000;
	const engine = createAudioEditorEngine();

	engine.loadProject(project);

	assert.equal(getProjectDurationFrames(project), 960_000);
	assert.equal(getProjectTimelineDurationFrames(project), 1_920_000);
	assert.equal(engine.getState().durationFrames, 960_000);
	assert.equal(engine.playbackDurationFrames, 1_920_000);
	assert.equal(engine.seek(1_440_000), 1_440_000);
	assert.equal(engine.getState().positionFrame, 1_440_000);
	await engine.dispose();
});

test('Web Audio engine applies preferred outputs lazily and keeps the active sink when switching fails', async () => {
	class SinkAudioContext extends MockAudioContext {
		constructor() {
			super();
			this.sinkIds = [];
		}
		async setSinkId(deviceId) {
			if (deviceId === 'blocked-speaker') {
				const error = new Error('Speaker access denied.');
				error.name = 'NotAllowedError';
				throw error;
			}
			this.sinkIds.push(deviceId);
		}
	}
	const context = new SinkAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: SinkAudioContext });

	const pending = await engine.setOutputDevice('speaker-a');
	assert.equal(pending.preferredDeviceId, 'speaker-a');
	assert.deepEqual(context.sinkIds, [], 'the test instance is not used until the engine creates its context');

	engine.audioContextFactory = () => context;
	await engine.getAudioContext({ resume: false });
	assert.deepEqual(context.sinkIds, ['speaker-a']);
	assert.equal(engine.getOutputDeviceState().activeDeviceId, 'speaker-a');

	await engine.setOutputDevice('speaker-b');
	assert.equal(engine.getOutputDeviceState().activeDeviceId, 'speaker-b');
	await assert.rejects(engine.setOutputDevice('blocked-speaker'), { name: 'NotAllowedError' });
	assert.deepEqual(engine.getOutputDeviceState(), {
		preferredDeviceId: 'speaker-b',
		activeDeviceId: 'speaker-b',
		supported: true,
		error: engine.getOutputDeviceState().error,
	});
	assert.equal(engine.getOutputDeviceState().error.name, 'NotAllowedError');
	await engine.dispose();
});

test('Web Audio engine reports unsupported non-default outputs without creating a context', async () => {
	const engine = createAudioEditorEngine({ audioContextFactory: MockAudioContext });
	await engine.setOutputDevice('speaker-a');
	const context = await engine.getAudioContext({ resume: false });
	assert.equal(context instanceof MockAudioContext, true);
	assert.equal(engine.getOutputDeviceState().activeDeviceId, '');
	assert.equal(engine.getOutputDeviceState().error?.name, 'NotSupportedError');
	await assert.rejects(engine.setOutputDevice('speaker-b'), { name: 'NotSupportedError' });
	await engine.setOutputDevice('');
	await engine.dispose();
});

test('live playback keeps field-free track clips at native rates against the device-rate context', async () => {
	const context = new MockAudioContext({ sampleRate: 32_000 });
	const constructorArguments = [];
	function DeviceAudioContext(...args) {
		constructorArguments.push(args);
		return context;
	}
	const mono = new MockAudioBuffer(1, 44_100, 44_100);
	const stereo = new MockAudioBuffer(2, 96_000, 96_000);
	const track = {
		type: 'audio',
		id: 'mixed-track',
		clipIds: ['mono-clip', 'stereo-clip'],
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		effects: [],
	};
	const project = {
		id: 'mixed-native-rate-project',
		sampleRate: 48_000,
		clips: [
			{
				id: 'mono-clip', sourceId: 'mono-source', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 44_100, durationFrames: 48_000,
				gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
			},
			{
				id: 'stereo-clip', sourceId: 'stereo-source', timelineStartFrame: 48_000,
				sourceStartFrame: 0, sourceDurationFrames: 96_000, durationFrames: 48_000,
				gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
			},
		],
		tracks: [track],
		master: { gain: 1, effects: [] },
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: DeviceAudioContext,
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([
			['mono-source', mono],
			['stereo-source', stereo],
		]));
		await engine.play();
		assert.deepEqual(constructorArguments, [[]], 'live playback does not request the project sample rate');
		assert.equal(Object.hasOwn(track, 'sampleRate'), false);
		assert.equal(Object.hasOwn(track, 'channelCount'), false);
		assert.deepEqual(context.bufferSources.map((source) => source.buffer.sampleRate), [44_100, 96_000]);
		assert.deepEqual(context.bufferSources.map((source) => source.buffer.numberOfChannels), [1, 2]);
		assert.deepEqual(context.bufferSources.map((source) => source.started), [
			[0, 0, 1],
			[1, 0, 1],
		]);
		assert.deepEqual(context.bufferSources.map((source) => source.playbackRate.value), [1, 1]);
	} finally {
		await engine.dispose();
	}
});

test('parametric EQ selection previews expose transient controls, spectra, and processor failures', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	const errors = [];
	const unsubscribe = engine.subscribeParametricEqErrors((error) => errors.push(error));
	const params = {
		outputGain: 0,
		bands: [{
			id: 'preview-band', enabled: true, type: 'peaking',
			frequency: 1_000, gain: 3, q: 1, slope: 12,
		}],
	};
	try {
		const buffer = new MockAudioBuffer(2, 4_800, 48_000);
		const preview = await engine.createParametricEqPreview(buffer, params);
		assert.equal(context.audioWorkletModules.filter((url) => url.endsWith('/parametric-eq/worklet.js')).length, 1);
		assert.equal(context.workletNodes.length, 1);
		assert.strictEqual(preview.source, context.bufferSources[0]);

		const processor = context.workletNodes[0];
		assert.equal(processor.name, 'kw-parametric-eq');
		assert.equal(processor.options.processorOptions.channelCount, 2);
		assert.deepEqual(processor.options.processorOptions.params, params);
		assert.ok(processor.options.processorOptions.wasmModule instanceof WebAssembly.Module);

		const configured = structuredClone(params);
		configured.bands[0].gain = 9;
		assert.equal(preview.configure(configured), 1);
		assert.equal(preview.audition('preview-band'), 2);
		assert.equal(preview.audition(null), 3);
		assert.deepEqual(processor.messages, [
			{ type: 'configure', params: configured, mode: 'smooth', revision: 1, sequence: 1 },
			{ type: 'audition', bandId: 'preview-band', revision: 2, sequence: 2 },
			{ type: 'audition', bandId: null, revision: 3, sequence: 3 },
		]);
		const spectrum = new Float32Array(PARAMETRIC_EQ_SPECTRUM_FFT_SIZE / 2);
		assert.deepEqual(preview.readSpectrum('input', spectrum), {
			sampleRate: 48_000,
			fftSize: PARAMETRIC_EQ_SPECTRUM_FFT_SIZE,
			frequencyBinCount: PARAMETRIC_EQ_SPECTRUM_FFT_SIZE / 2,
			minDecibels: -120,
			maxDecibels: 0,
		});
		assert.equal(spectrum[0], -48);
		assert.throws(
			() => preview.readSpectrum('output', new Float32Array(8)),
			/2048 bins/,
		);
		let previewError = null;
		preview.onerror = (error) => { previewError = error; };
		assert.equal(typeof preview.onerror, 'function');
		processor.onprocessorerror();
		assert.deepEqual(errors, [{
			type: 'error',
			message: 'The parametric EQ AudioWorklet processor failed.',
			scope: 'master',
			targetId: null,
			effectId: 'selection-preview-eq',
		}]);
		assert.strictEqual(previewError, errors[0]);
		preview.onended = () => {};
		assert.strictEqual(preview.onended, preview.source.onended);
		preview.start(0);
		assert.deepEqual(preview.source.started, [0, undefined, undefined]);
		preview.disconnect();
		assert.equal(preview.configure(params), false);
		assert.equal(preview.audition('preview-band'), false);
		assert.equal(processor.port.onmessage, null);
		assert.equal(processor.onprocessorerror, null);
		assert.equal(preview.source.disconnected, true);
	} finally {
		unsubscribe();
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

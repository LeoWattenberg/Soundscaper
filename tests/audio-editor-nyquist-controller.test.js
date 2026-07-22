import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { ENGLISH_COPY } = await import('../src/common/i18n/catalogs.js');
const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createAudioEditorProjectV2 } = await import('../src/common/editor/project-v2.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

test('Nyquist processors receive selected PCM and persist their returned audio as one destructive edit', async () => {
	const sampleRate = 8_000;
	const input = new Float32Array(800).fill(0.25);
	const { store } = await createFixture('nyquist-process', {
		sampleRate,
		tracks: [{ id: 'process-track', name: 'Process source', input }],
	});
	let evaluatorCall = null;
	const controller = createController(store, new Map([['process-track', input]]), async (request, options) => {
		evaluatorCall = { request, options };
		return {
			type: 'audio',
			channels: request.channels.map((channel) => Float32Array.from(channel, (sample) => sample * 2)),
			sampleRate: request.sampleRate,
			frameCount: request.channels[0].length,
			output: 'processor output',
		};
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('process-track');
		controller.actions.timeline.setSelection(100, 500, {
			trackIds: ['process-track'],
			clipIds: [],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_600 },
		});
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		const result = await controller.actions.nyquist.evaluate({
			source: '(mult *track* 2)',
			role: 'process',
			name: 'Nyquist double',
			controls: { AMOUNT: 2 },
		});

		assert.equal(result.type, 'audio');
		assert.equal(result.output, 'processor output');
		assert.equal(result.channels.length, 1);
		assert.deepEqual(result.channels[0], new Float32Array(400).fill(0.5));
		assert.equal(evaluatorCall.request.source, '(mult *track* 2)');
		assert.equal(evaluatorCall.request.sampleRate, sampleRate);
		assert.deepEqual([...evaluatorCall.request.channels[0]], [...input.subarray(100, 500)]);
		assert.deepEqual(evaluatorCall.request.controls, { AMOUNT: 2 });
		assert.equal(evaluatorCall.request.globals.PREVIEWP, false);
		assert.equal(evaluatorCall.request.maxOutputFrames, sampleRate * 60);
		assert.equal(evaluatorCall.options.transferInput, true);
		assert.equal(evaluatorCall.options.signal.aborted, false);
		assert.deepEqual(evaluatorCall.request.properties.AUDACITY.VERSION, [3, 7, 7]);
		assert.equal(evaluatorCall.request.properties.PROJECT.NAME, 'Nyquist fixture');
		assert.equal(evaluatorCall.request.properties.PROJECT.RATE, sampleRate);
		assert.equal(evaluatorCall.request.properties.PROJECT.TRACKS, 1);
		assert.equal(evaluatorCall.request.properties.PROJECT.TEMPO, 90);
		assert.deepEqual(evaluatorCall.request.properties.SELECTION.TRACKS, [1]);
		assert.equal(evaluatorCall.request.properties.SELECTION.START, 100 / sampleRate);
		assert.equal(evaluatorCall.request.properties.SELECTION.END, 500 / sampleRate);
		assert.equal(evaluatorCall.request.properties.SELECTION.PEAK, 0.25);
		assert.equal(evaluatorCall.request.properties.SELECTION.RMS, 0.25);
		assert.equal(evaluatorCall.request.properties.SELECTION.LOW_HZ, 100);
		assert.equal(evaluatorCall.request.properties.SELECTION.HIGH_HZ, 1_600);
		assert.equal(evaluatorCall.request.properties.SELECTION.CENTER_HZ, 400);
		assert.equal(evaluatorCall.request.properties.SELECTION.BANDWIDTH, 4);
		assert.equal(evaluatorCall.request.properties.TRACK.INDEX, 1);
		assert.equal(evaluatorCall.request.properties.TRACK.NAME, 'Process source');
		assert.deepEqual(evaluatorCall.request.properties.TRACK.CLIPS, [[0, 0.1]]);
		assert.deepEqual(evaluatorCall.request.properties.TRACK.INCLIPS, [[0, 0.1]]);

		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.nyquist.processing, false);
		assert.equal(snapshot.nyquist.result.type, 'audio');
		assert.equal(snapshot.nyquist.result.frameCount, 400);
		assert.equal(Object.hasOwn(snapshot.nyquist.result, 'channels'), false);
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);
		assert.deepEqual(snapshot.history.undoEntries[0], {
			type: 'batch',
			commandCount: 2,
			commands: ['range/replace', 'selection/set'],
		});
		assert.deepEqual(snapshot.project.selection.trackIds, ['process-track']);
		assert.deepEqual(snapshot.project.selection.frequencyRange, {
			minimumFrequency: 100,
			maximumFrequency: 1_600,
		});
		const track = snapshot.project.tracks.find(({ id }) => id === 'process-track');
		const replacement = snapshot.project.clips.find((clip) => (
			track.clipIds.includes(clip.id)
			&& clip.timelineStartFrame === 100
			&& clip.sourceId !== 'process-track-source'
		));
		assert.ok(replacement, 'the selected range should reference a new immutable source');
		assert.deepEqual(await storedChannel(store, replacement.sourceId, 0), new Float32Array(400).fill(0.5));

		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project.clips.map(({ id }) => id), ['process-track-clip']);
	} finally {
		await controller.dispose();
	}
});

test('Nyquist analyzers receive Audacity track properties and offset returned labels into the project timeline', async () => {
	const sampleRate = 8_000;
	const firstInput = new Float32Array(800).fill(0.1);
	const analyzedInput = Float32Array.from({ length: 800 }, (_, frame) => frame % 2 ? -0.5 : 0.5);
	const { store } = await createFixture('nyquist-analyze', {
		sampleRate,
		labelTrack: { id: 'existing-labels', name: 'Existing labels' },
		tracks: [
			{ id: 'first-track', name: 'First source', input: firstInput },
			{ id: 'analyzed-track', name: 'Analyzed source', input: analyzedInput },
		],
	});
	let evaluatorRequest = null;
	const controller = createController(store, new Map([
		['first-track', firstInput],
		['analyzed-track', analyzedInput],
	]), async (request) => {
		evaluatorRequest = request;
		return {
			type: 'labels',
			labels: [{ start: 0.01, end: 0.02, text: 'Beat' }],
			output: '',
		};
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('analyzed-track');
		controller.actions.timeline.setSelection(80, 480, {
			trackIds: ['analyzed-track'],
			clipIds: [],
		});
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		const result = await controller.actions.nyquist.evaluate({
			source: '(list (list 0.01 0.02 "Beat"))',
			role: 'analyze',
			name: 'Beat Finder',
		});

		assert.equal(result.type, 'labels');
		assert.deepEqual(evaluatorRequest.properties.SELECTION.TRACKS, [3]);
		assert.equal(evaluatorRequest.properties.SELECTION.START, 0.01);
		assert.equal(evaluatorRequest.properties.SELECTION.END, 0.06);
		assert.equal(evaluatorRequest.properties.SELECTION.PEAK, 0.5);
		assert.equal(evaluatorRequest.properties.SELECTION.RMS, 0.5);
		assert.equal(evaluatorRequest.properties.TRACK.INDEX, 1);
		assert.equal(evaluatorRequest.properties.TRACK.NAME, 'Analyzed source');
		assert.deepEqual(evaluatorRequest.properties.TRACK.CLIPS, [[0, 0.1]]);
		assert.equal(evaluatorRequest.properties.PROJECT.NAME, 'Nyquist fixture');
		assert.equal(evaluatorRequest.properties.PROJECT.TRACKS, 3);
		assert.equal(evaluatorRequest.properties.PROJECT.WAVETRACKS, 2);
		assert.equal(evaluatorRequest.properties.PROJECT.LABELTRACKS, 1);

		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);
		assert.equal(snapshot.history.undoEntries[0].type, 'batch');
		assert.deepEqual(snapshot.history.undoEntries[0].commands, ['label/add']);
		assert.equal(snapshot.project.tracks.filter(({ type }) => type === 'label').length, 1);
		const labelTrack = snapshot.project.tracks.find(({ id }) => id === 'existing-labels');
		assert.deepEqual(labelTrack.labels.map(({ startFrame, endFrame, title }) => ({
			startFrame,
			endFrame,
			title,
		})), [{ startFrame: 160, endFrame: 240, title: 'Beat' }]);
		assert.equal(snapshot.selectedTrackId, 'existing-labels');
		assert.equal(snapshot.nyquist.result.type, 'labels');
	} finally {
		await controller.dispose();
	}
});

test('Nyquist generators run without input PCM and add their output at the requested timeline frame', async () => {
	const sampleRate = 8_000;
	const input = new Float32Array(800).fill(0.1);
	const generated = new Float32Array(80).fill(0.75);
	const { store } = await createFixture('nyquist-generate', {
		sampleRate,
		tracks: [{ id: 'generator-track', name: 'Generator target', input }],
	});
	let evaluatorRequest = null;
	const controller = createController(store, new Map([['generator-track', input]]), async (request) => {
		evaluatorRequest = request;
		return {
			type: 'audio',
			channels: [generated],
			sampleRate,
			frameCount: generated.length,
			output: '',
		};
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('generator-track');
		const result = await controller.actions.nyquist.evaluate({
			source: '(pluck c4 1)',
			role: 'generate',
			name: 'Nyquist pluck',
			trackId: 'generator-track',
			atFrame: 900,
		});

		assert.equal(result.type, 'audio');
		assert.deepEqual(evaluatorRequest.channels, []);
		assert.equal(evaluatorRequest.sampleRate, sampleRate);
		assert.equal(evaluatorRequest.properties.TRACK.NAME, 'Nyquist pluck');
		assert.equal(evaluatorRequest.properties.PROJECT.TRACKS, 1);
		const snapshot = controller.getSnapshot();
		const track = snapshot.project.tracks.find(({ id }) => id === 'generator-track');
		assert.equal(track.clipIds.length, 2);
		const clip = snapshot.project.clips.find((candidate) => (
			candidate.timelineStartFrame === 900
			&& candidate.sourceId !== 'generator-track-source'
		));
		assert.ok(clip, 'generated PCM should be added to the requested non-overlapping track');
		assert.equal(clip.durationFrames, generated.length);
		assert.deepEqual(await storedChannel(store, clip.sourceId, 0), generated);
		assert.equal(snapshot.selectedTrackId, 'generator-track');
		assert.equal(snapshot.selectedClipId, clip.id);
	} finally {
		await controller.dispose();
	}
});

test('Nyquist preview keeps full selection context, evaluates every selected track, and mixes only six seconds', async () => {
	const sampleRate = 8_000;
	const selectionFrames = sampleRate * 8;
	const firstInput = new Float32Array(selectionFrames).fill(0.1);
	const secondInput = new Float32Array(selectionFrames).fill(0.2);
	const previewFrames = sampleRate * 7;
	const { store } = await createFixture('nyquist-preview', {
		sampleRate,
		tracks: [
			{ id: 'preview-track-a', name: 'Preview A', input: firstInput },
			{ id: 'preview-track-b', name: 'Preview B', input: secondInput },
		],
	});
	const evaluatorRequests = [];
	const renderCalls = [];
	const playback = { buffer: null, pauseCalls: 0, starts: 0, stops: 0 };
	const engine = createPreviewEngine(playback);
	const controller = createController(store, new Map([
		['preview-track-a', firstInput],
		['preview-track-b', secondInput],
	]), async (request) => {
		evaluatorRequests.push(request);
		if (request.properties.TRACK.INDEX === 1) {
			return {
				type: 'audio',
				channels: [new Float32Array(previewFrames).fill(0.25)],
				sampleRate,
				frameCount: previewFrames,
				output: '',
			};
		}
		return {
			type: 'audio',
			channels: [
				new Float32Array(previewFrames).fill(0.5),
				new Float32Array(previewFrames).fill(0.75),
			],
			sampleRate,
			frameCount: previewFrames,
			output: '',
		};
	}, {
		engine,
		onRender: (range) => renderCalls.push({ ...range }),
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('preview-track-a');
		controller.actions.timeline.setSelection(0, selectionFrames, {
			trackIds: ['preview-track-a', 'preview-track-b'],
			clipIds: [],
		});
		const projectBefore = structuredClone(controller.getSnapshot().project);
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		const result = await controller.actions.nyquist.preview({
			source: '(mult *track* 2)',
			role: 'process',
			name: 'Selection-aware preview',
		});

		assert.equal(result.type, 'multiple');
		assert.equal(result.results.length, 2);
		assert.deepEqual(renderCalls.map(({ trackId, startFrame, endFrame }) => ({
			trackId,
			startFrame,
			endFrame,
		})), [
			{ trackId: 'preview-track-a', startFrame: 0, endFrame: selectionFrames },
			{ trackId: 'preview-track-b', startFrame: 0, endFrame: selectionFrames },
		]);
		assert.equal(evaluatorRequests.length, 2);
		assert.deepEqual(evaluatorRequests.map((request) => request.channels[0].length), [selectionFrames, selectionFrames]);
		assert.deepEqual(evaluatorRequests.map((request) => request.properties.TRACK.INDEX), [1, 2]);
		for (const request of evaluatorRequests) {
			assert.equal(request.properties.SELECTION.START, 0);
			assert.equal(request.properties.SELECTION.END, 8);
			assert.deepEqual(request.properties.SELECTION.TRACKS, [1, 2]);
			assert.equal(request.globals.PREVIEWP, true);
			assert.equal(request.maxOutputFrames, sampleRate * 6);
		}
		assert.equal(playback.pauseCalls, 1);
		assert.equal(playback.starts, 1);
		assert.equal(playback.buffer.numberOfChannels, 2);
		assert.equal(playback.buffer.length, sampleRate * 6);
		assert.ok(Math.abs(playback.buffer.getChannelData(0)[0] - 0.75) < 1e-6);
		assert.ok(Math.abs(playback.buffer.getChannelData(1)[0] - 1) < 1e-6);
		assert.ok(Math.abs(playback.buffer.getChannelData(0).at(-1) - 0.75) < 1e-6);

		let snapshot = controller.getSnapshot();
		assert.equal(snapshot.effects.previewing, true);
		assert.equal(snapshot.history.undoEntries.length, historyBefore);
		assert.deepEqual(snapshot.project, projectBefore);
		assert.equal(controller.actions.nyquist.cancel(), true);
		snapshot = controller.getSnapshot();
		assert.equal(playback.stops, 1);
		assert.equal(snapshot.effects.previewing, false);
		assert.deepEqual(snapshot.project, projectBefore);
	} finally {
		await controller.dispose();
	}
});

test('Nyquist cancellation retains processing ownership until the evaluator unwinds and blocks concurrent work', async () => {
	const sampleRate = 8_000;
	const input = new Float32Array(800).fill(0.25);
	const { store } = await createFixture('nyquist-cancel', {
		sampleRate,
		tracks: [{ id: 'cancel-track', name: 'Cancellation source', input }],
	});
	let evaluatorCalls = 0;
	let releaseAbort = null;
	let observedAbort = false;
	let markStarted;
	const started = new Promise((resolve) => { markStarted = resolve; });
	const controller = createController(store, new Map([['cancel-track', input]]), async (_request, { signal }) => {
		evaluatorCalls += 1;
		markStarted();
		return new Promise((resolve, reject) => {
			signal.addEventListener('abort', () => {
				observedAbort = true;
				releaseAbort = () => {
					const error = new Error('Nyquist evaluation was cancelled.');
					error.name = 'AbortError';
					reject(error);
				};
			}, { once: true });
		});
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('cancel-track');
		controller.actions.timeline.setSelection(0, input.length, {
			trackIds: ['cancel-track'],
			clipIds: [],
		});
		const projectBefore = structuredClone(controller.getSnapshot().project);
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		const firstEvaluation = controller.actions.nyquist.evaluate({
			source: '(mult *track* 2)',
			role: 'process',
			name: 'Deferred Nyquist',
		});
		await started;
		assert.equal(controller.getSnapshot().nyquist.processing, true);

		assert.equal(controller.actions.nyquist.cancel(), true);
		assert.equal(observedAbort, true);
		assert.equal(controller.getSnapshot().nyquist.processing, true);
		const secondResult = await controller.actions.nyquist.evaluate({
			source: '(mult *track* 3)',
			role: 'process',
			name: 'Blocked Nyquist',
		});
		assert.equal(secondResult, null);
		assert.equal(evaluatorCalls, 1);
		assert.equal(controller.getSnapshot().nyquist.processing, true);
		assert.deepEqual(controller.getSnapshot().project, projectBefore);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyBefore);

		releaseAbort();
		assert.equal(await firstEvaluation, null);
		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.nyquist.processing, false);
		assert.equal(snapshot.nyquist.result, null);
		assert.deepEqual(snapshot.project, projectBefore);
		assert.equal(snapshot.history.undoEntries.length, historyBefore);
	} finally {
		await controller.dispose();
	}
});

test('Nyquist multi-track output is rejected when its aggregate PCM budget is exceeded', async () => {
	const sampleRate = 8_000;
	const input = new Float32Array(800).fill(0.25);
	const { store } = await createFixture('nyquist-memory-cap', {
		sampleRate,
		tracks: [
			{ id: 'memory-track-a', name: 'Memory A', input },
			{ id: 'memory-track-b', name: 'Memory B', input },
		],
	});
	const controller = createController(store, new Map([
		['memory-track-a', input],
		['memory-track-b', input],
	]), async () => ({
		type: 'audio',
		// The controller trusts the worker's validated result contract. A small
		// stand-in with the same byteLength lets this regression test the
		// aggregate bound without allocating hundreds of MiB.
		channels: [{ byteLength: 70 * 1024 * 1024 }],
		sampleRate,
		frameCount: 1,
		output: '',
	}));

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('memory-track-a');
		controller.actions.timeline.setSelection(0, input.length, {
			trackIds: ['memory-track-a', 'memory-track-b'],
			clipIds: [],
		});
		const projectBefore = structuredClone(controller.getSnapshot().project);
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		await assert.rejects(controller.actions.nyquist.evaluate({
			source: '(mult *track* 2)',
			role: 'process',
			name: 'Oversized Nyquist',
		}), new RegExp(ENGLISH_COPY.effectMemoryTooLarge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.nyquist.processing, false);
		assert.equal(snapshot.nyquist.result, null);
		assert.deepEqual(snapshot.project, projectBefore);
		assert.equal(snapshot.history.undoEntries.length, historyBefore);
	} finally {
		await controller.dispose();
	}
});

async function createFixture(prefix, options) {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${prefix}-${Date.now()}-${Math.random()}`,
	});
	for (const track of options.tracks) {
		const sourceId = `${track.id}-source`;
		const writer = await store.beginSourceWrite(sourceId, {
			name: `${track.name}.wav`,
			mimeType: 'audio/wav',
			sampleRate: options.sampleRate,
			channelCount: 1,
		});
		await writer.write([track.input]);
		await writer.commit({ sampleRate: options.sampleRate, channelCount: 1 });
	}
	const project = createAudioEditorProjectV2({
		id: `${prefix}-project`,
		title: 'Nyquist fixture',
		now: '2026-07-15T00:00:00.000Z',
		sampleRate: options.sampleRate,
		tempo: { bpm: 90 },
		sources: options.tracks.map((track) => ({
			id: `${track.id}-source`,
			name: `${track.name}.wav`,
			mimeType: 'audio/wav',
			storageKey: `${track.id}-source`,
			frameCount: track.input.length,
			channelCount: 1,
			sampleRate: options.sampleRate,
			originalSampleRate: options.sampleRate,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		})),
		tracks: [
			...(options.labelTrack ? [{
				type: 'label',
				id: options.labelTrack.id,
				name: options.labelTrack.name,
				labels: [],
			}] : []),
			...options.tracks.map((track) => ({
				type: 'audio',
				id: track.id,
				name: track.name,
				clipIds: [`${track.id}-clip`],
			})),
		],
		clips: options.tracks.map((track) => ({
			id: `${track.id}-clip`,
			sourceId: `${track.id}-source`,
			title: track.name,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: track.input.length,
			durationFrames: track.input.length,
		})),
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	return { store, project };
}

function createController(store, inputs, nyquistEvaluator, options = {}) {
	return createAudioEditorController(null, {
		headless: true,
		copy: ENGLISH_COPY,
		locale: 'en',
		store,
		engine: options.engine || createMemoryEngine(),
		ffmpeg: { dispose() {} },
		nyquistEvaluator,
		renderSnapshot: async (_snapshot, range) => {
			options.onRender?.(range);
			const input = inputs.get(range.trackId);
			return audioBuffer([input.slice(range.startFrame, range.endFrame)], 8_000);
		},
	});
}

function audioBuffer(channels, sampleRate) {
	return {
		numberOfChannels: channels.length,
		length: channels[0].length,
		sampleRate,
		getChannelData(channel) { return channels[channel]; },
	};
}

function createMemoryEngine() {
	return {
		positionFrame: 0,
		state: 'stopped',
		loadProject() {},
		async applyProject() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		stop() { this.state = 'stopped'; },
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); return this.positionFrame; },
		setLoop() {},
		setSourceResolver() {},
		async getAudioContext() {
			return {
				createBuffer: (channelCount, frameCount, sampleRate) => (
					new MockAudioBuffer(channelCount, frameCount, sampleRate)
				),
			};
		},
		async dispose() {},
	};
}

function createPreviewEngine(playback) {
	const engine = createMemoryEngine();
	engine.pause = () => { playback.pauseCalls += 1; };
	engine.getAudioContext = async () => ({
		destination: {},
		async resume() {},
		createBuffer: (channelCount, frameCount, sampleRate) => (
			new MockAudioBuffer(channelCount, frameCount, sampleRate)
		),
		createBufferSource: () => ({
			buffer: null,
			onended: null,
			connect() {},
			disconnect() {},
			start() {
				playback.buffer = this.buffer;
				playback.starts += 1;
			},
			stop() { playback.stops += 1; },
		}),
	});
	return engine;
}

class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel) { return this.channels[channel]; }
	copyToChannel(values, channel, offset = 0) { this.channels[channel].set(values, offset); }
}

async function storedChannel(store, sourceId, channel) {
	const metadata = await store.getSourceMetadata(sourceId);
	const output = new Float32Array(metadata.frameCount);
	let offset = 0;
	for await (const chunk of store.readSourceChunks(sourceId)) {
		output.set(chunk.channels[channel], offset);
		offset += chunk.frames;
	}
	return output;
}

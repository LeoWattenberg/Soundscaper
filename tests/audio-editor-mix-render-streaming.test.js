import test from 'node:test';
import assert from 'node:assert/strict';
import {
	WAVEFORM_PEAKS_VERSION,
	clip,
	createAudioEditorController,
	createCurrentAudioEditorProject,
	createMemoryEngine,
	createTestStore,
	observeMixedSourceWrites,
	source,
	storedSample,
	writeSource,
} from './helpers/audio-editor-mix-render-harness.js';

test('oversized Mix and Render normalizes streamed stereo packets into exact mono storage', async () => {
	const store = createTestStore('streamed-success');
	await writeSource(store, 'stream-input', [new Float32Array(8).fill(0.25)]);
	const project = createCurrentAudioEditorProject({
		id: 'streamed-mix-project',
		title: 'Streamed mix project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('stream-input', 8)],
		tracks: [{
			type: 'audio', id: 'stream-track', name: 'Long take', clipIds: ['stream-clip'], pan: 0,
		}],
		clips: [clip('stream-clip', 'stream-input', 5, 8)],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const left = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], (sample) => sample * Math.SQRT1_2);
	const right = left.slice();
	const renderCalls = [];
	let renderEngineDisposals = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		mixRenderMemoryLimitBytes: 0,
		sourceBufferCacheMaxBytes: 0,
		renderSnapshot: async () => { throw new Error('The offline renderer must not be used.'); },
		engineFactory: () => ({
			setSourceResolver() {},
			setChunkSources(providers) { this.providers = providers; },
			loadProject(snapshot, buffers) {
				this.snapshot = snapshot;
				this.buffers = buffers;
			},
			async renderMixToSink({ sink, ...renderOptions }) {
				renderCalls.push({
					renderOptions: structuredClone(renderOptions),
					snapshot: structuredClone(this.snapshot),
					hasInputProvider: this.providers.has('stream-input'),
					residentBuffers: this.buffers.size,
				});
				await sink.write([left.subarray(0, 3), right.subarray(0, 3)]);
				await sink.write([left.subarray(3), right.subarray(3)]);
				return { sampleRate: 48_000, channelCount: 2, frameCount: 8, chunkCount: 2 };
			},
			async dispose() { renderEngineDisposals += 1; },
		}),
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('stream-track');
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		const result = await controller.actions.track.mixAndRender();

		assert.equal(renderCalls.length, 1);
		assert.deepEqual(renderCalls[0].renderOptions, {
			startFrame: 5,
			endFrame: 13,
			includeTail: false,
			includeMaster: false,
			includeTrackPan: true,
			respectMuteSolo: false,
			preRollFrames: 5,
			outputFrames: 8,
			sampleRate: 48_000,
		});
		assert.equal(renderCalls[0].hasInputProvider, true);
		assert.equal(renderCalls[0].residentBuffers, 0);
		assert.equal(renderEngineDisposals, 1);

		let snapshot = controller.getSnapshot();
		const mixedSource = snapshot.project.sources.find((candidate) => candidate.id === result.sourceId);
		assert.equal(mixedSource.channelCount, 1);
		assert.equal(mixedSource.frameCount, 8);
		assert.equal(mixedSource.chunkFrames, 65_536);
		assert.ok(Math.abs(await storedSample(store, result.sourceId, 0, 6) - 0.7) < 1e-6);
		assert.ok(Math.abs(await storedSample(store, result.sourceId, 0, 4) - 0.5) < 1e-6);
		const metadata = await store.getSourceMetadata(result.sourceId);
		assert.deepEqual({
			frameCount: metadata.frameCount,
			channelCount: metadata.channelCount,
			chunkFrames: metadata.chunkFrames,
			chunkCount: metadata.chunkCount,
		}, { frameCount: 8, channelCount: 1, chunkFrames: 65_536, chunkCount: 1 });
		assert.deepEqual(controller.sourceBufferCacheStats, { byteLength: 0, maxBytes: 0, entryCount: 0 });
		const peaks = await store.loadAnalysis(`audio-editor-peaks-v2:${result.sourceId}`);
		assert.equal(peaks.version, WAVEFORM_PEAKS_VERSION);
		assert.equal(peaks.channelCount, 1);
		assert.ok(Math.abs(peaks.levels[0].channels[0].maximums[0] - 0.8) < 1e-6);
		assert.ok(Math.abs(peaks.levels[0].channels[0].minimums[0] - 0.1) < 1e-6);
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.ok(snapshot.project.sources.some((candidate) => candidate.id === 'stream-input'));
		assert.equal(snapshot.project.sources.some((candidate) => candidate.id === result.sourceId), false);
		controller.actions.edit.redo();
		snapshot = controller.getSnapshot();
		assert.ok(snapshot.project.sources.some((candidate) => candidate.id === result.sourceId));
		assert.ok(Math.abs(await storedSample(store, result.sourceId, 0, 7) - 0.8) < 1e-6);
	} finally {
		await controller.dispose();
	}
});

test('a failed streamed Mix-down aborts pending chunks without publishing history', async () => {
	const store = createTestStore('streamed-render-failure');
	await writeSource(store, 'failure-input', [new Float32Array(4).fill(0.2)]);
	const attemptedSourceIds = observeMixedSourceWrites(store);
	const project = createCurrentAudioEditorProject({
		id: 'streamed-failure-project',
		title: 'Stream failure project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('failure-input', 4)],
		tracks: [{ type: 'audio', id: 'failure-track', name: 'Failure', clipIds: ['failure-clip'] }],
		clips: [clip('failure-clip', 'failure-input', 0, 4)],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	let disposals = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		mixRenderMemoryLimitBytes: 0,
		engineFactory: () => ({
			setSourceResolver() {},
			setChunkSources() {},
			loadProject() {},
			async renderMixToSink({ sink }) {
				await sink.write([Float32Array.of(0.1, 0.2), Float32Array.of(-0.1, -0.2)]);
				throw new Error('Realtime graph failed.');
			},
			async dispose() { disposals += 1; },
		}),
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('failure-track');
		const before = controller.getSnapshot();
		await assert.rejects(controller.actions.track.mixAndRender(), /Realtime graph failed/);
		const after = controller.getSnapshot();
		assert.equal(disposals, 1);
		assert.equal(after.processingEffect, false);
		assert.deepEqual(after.project, before.project);
		assert.equal(after.history.undoEntries.length, before.history.undoEntries.length);
		assert.equal(attemptedSourceIds.length, 1);
		assert.equal(await store.getSourceMetadata(attemptedSourceIds[0]), null);
	} finally {
		await controller.dispose();
	}
});

test('a streamed Mix-down rejects mismatched sink geometry before committing', async () => {
	const store = createTestStore('streamed-geometry-failure');
	await writeSource(store, 'geometry-input', [new Float32Array(4).fill(0.2)]);
	const attemptedSourceIds = observeMixedSourceWrites(store);
	const project = createCurrentAudioEditorProject({
		id: 'streamed-geometry-project',
		title: 'Stream geometry project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('geometry-input', 4)],
		tracks: [{ type: 'audio', id: 'geometry-track', name: 'Geometry', clipIds: ['geometry-clip'] }],
		clips: [clip('geometry-clip', 'geometry-input', 0, 4)],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	let geometry = 'frames';
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		mixRenderMemoryLimitBytes: 0,
		engineFactory: () => ({
			setSourceResolver() {},
			setChunkSources() {},
			loadProject() {},
			async renderMixToSink({ sink }) {
				if (geometry === 'frames') {
					await sink.write([Float32Array.of(0.1, 0.2, 0.3), Float32Array.of(-0.1, -0.2, -0.3)]);
				} else {
					await sink.write([Float32Array.of(0.1, 0.2, 0.3, 0.4)]);
				}
				return { sampleRate: 48_000, channelCount: 2, frameCount: 4, chunkCount: 1 };
			},
			async dispose() {},
		}),
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('geometry-track');
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		await assert.rejects(controller.actions.track.mixAndRender(), /did not produce valid audio/);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyBefore);
		assert.equal(attemptedSourceIds.length, 1);
		assert.equal(await store.getSourceMetadata(attemptedSourceIds[0]), null);

		geometry = 'channels';
		await assert.rejects(controller.actions.track.mixAndRender(), /did not produce valid audio/);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyBefore);
		assert.equal(attemptedSourceIds.length, 2);
		assert.equal(await store.getSourceMetadata(attemptedSourceIds[1]), null);
	} finally {
		await controller.dispose();
	}
});

test('a streamed Mix-down removes committed PCM when analysis activation fails', async () => {
	const store = createTestStore('streamed-activation-failure');
	await writeSource(store, 'activation-input', [new Float32Array(4).fill(0.2)]);
	const attemptedSourceIds = observeMixedSourceWrites(store);
	const project = createCurrentAudioEditorProject({
		id: 'streamed-activation-project',
		title: 'Stream activation project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('activation-input', 4)],
		tracks: [{ type: 'audio', id: 'activation-track', name: 'Activation', clipIds: ['activation-clip'] }],
		clips: [clip('activation-clip', 'activation-input', 0, 4)],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		mixRenderMemoryLimitBytes: 0,
		engineFactory: () => ({
			setSourceResolver() {},
			setChunkSources() {},
			loadProject() {},
			async renderMixToSink({ sink }) {
				await sink.write([
					Float32Array.of(0.1, 0.2, 0.3, 0.4),
					Float32Array.of(-0.1, -0.2, -0.3, -0.4),
				]);
				return { sampleRate: 48_000, channelCount: 2, frameCount: 4, chunkCount: 1 };
			},
			async dispose() {},
		}),
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('activation-track');
		const saveAnalysis = store.saveAnalysis.bind(store);
		store.saveAnalysis = async (key, value) => {
			if (key.includes(attemptedSourceIds[0] || 'mixed-source')) throw new Error('Analysis storage failed.');
			return saveAnalysis(key, value);
		};
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		await assert.rejects(controller.actions.track.mixAndRender(), /Analysis storage failed/);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyBefore);
		assert.equal(attemptedSourceIds.length, 1);
		assert.equal(await store.getSourceMetadata(attemptedSourceIds[0]), null);
		assert.equal(await store.loadAnalysis(`audio-editor-peaks-v2:${attemptedSourceIds[0]}`), null);
	} finally {
		await controller.dispose();
	}
});

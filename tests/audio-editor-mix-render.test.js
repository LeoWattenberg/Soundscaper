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

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createAudioEditorProjectV2 } = await import('../src/common/editor/project-v2.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

test('Mix-down to renders whole selected tracks, replaces them atomically, and round-trips undo', async () => {
	const store = createTestStore('multi');
	await writeSource(store, 'mix-source-a', [new Float32Array(8).fill(0.1)]);
	await writeSource(store, 'mix-source-keep', [new Float32Array(4).fill(0.2)]);
	await writeSource(store, 'mix-source-c', [new Float32Array(10).fill(0.3)]);
	const project = createAudioEditorProjectV2({
		id: 'mix-project',
		title: 'Mix project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [
			source('mix-source-a', 8),
			source('mix-source-keep', 4),
			source('mix-source-c', 10),
		],
		tracks: [{
			type: 'audio', id: 'mix-track-a', name: 'Voice', clipIds: ['mix-clip-a'],
			gain: 0.5, pan: -0.25, mute: true, color: '#123456',
			effects: [{ id: 'mix-highpass', type: 'highpass', params: { frequency: 100, q: 0.707 } }],
		}, {
			type: 'audio', id: 'mix-track-keep', name: 'Keep', clipIds: ['mix-clip-keep'],
		}, {
			type: 'label', id: 'mix-labels', name: 'Labels', labels: [],
		}, {
			type: 'audio', id: 'mix-track-c', name: 'Music', clipIds: ['mix-clip-c'],
			gain: 0.75, pan: 0.5, solo: true, displayMode: 'spectrogram',
			effects: [{ id: 'mix-lowpass', type: 'lowpass', params: { frequency: 12_000, q: 0.707 } }],
		}],
		clips: [
			clip('mix-clip-a', 'mix-source-a', 4, 8),
			clip('mix-clip-keep', 'mix-source-keep', 0, 4),
			clip('mix-clip-c', 'mix-source-c', 10, 10),
		],
		master: {
			gain: 0.8,
			effects: [{ id: 'mix-master-effect', type: 'highpass', params: { frequency: 40, q: 0.707 } }],
		},
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);

	const renderCalls = [];
	let failRender = false;
	const left = Float32Array.from({ length: 16 }, (_, index) => index / 100);
	const right = Float32Array.from({ length: 16 }, (_, index) => -index / 100);
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot: async (snapshot, range) => {
			renderCalls.push({ snapshot: structuredClone(snapshot), range: structuredClone(range) });
			if (failRender) throw new Error('Mix render failed.');
			return audioBuffer([left, right], snapshot.sampleRate);
		},
	});

	try {
		await controller.ready;
		controller.actions.timeline.setSelection(6, 12, {
			trackIds: ['mix-track-a', 'mix-track-c'],
			clipIds: [],
			frequencyRange: null,
		});
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		const result = await controller.actions.track.mixAndRender();

		assert.equal(renderCalls.length, 1);
		assert.deepEqual(renderCalls[0].range, {
			startFrame: 4,
			endFrame: 20,
			includeTail: false,
			includeMaster: false,
			includeTrackPan: true,
			respectMuteSolo: false,
			preRollFrames: 4,
		});
		assert.deepEqual(renderCalls[0].snapshot.tracks.map(({ id, mute, solo }) => ({ id, mute, solo })), [
			{ id: 'mix-track-a', mute: false, solo: false },
			{ id: 'mix-track-c', mute: false, solo: false },
		]);
		assert.equal(renderCalls[0].snapshot.master.effects[0].id, 'mix-master-effect');

		let snapshot = controller.getSnapshot();
		assert.deepEqual(snapshot.project.tracks.map((track) => track.id), [
			'mix-track-keep', 'mix-labels', result.trackId,
		]);
		const mixedTrack = snapshot.project.tracks.find((track) => track.id === result.trackId);
		const mixedSource = snapshot.project.sources.find((candidate) => candidate.id === result.sourceId);
		assert.equal(mixedTrack.name, 'Mix');
		assert.equal(mixedSource.channelCount, 2);
		assert.equal(mixedTrack.displayMode, 'spectrogram');
		assert.deepEqual({ gain: mixedTrack.gain, pan: mixedTrack.pan, mute: mixedTrack.mute, solo: mixedTrack.solo }, {
			gain: 1, pan: 0, mute: false, solo: false,
		});
		assert.deepEqual(mixedTrack.effects, []);
		assert.deepEqual(snapshot.project.selection, {
			startFrame: 6,
			endFrame: 12,
			trackIds: [result.trackId],
			clipIds: [],
			frequencyRange: null,
		});
		assert.equal(await storedSample(store, result.sourceId, 0, 5), left[5]);
		assert.equal(await storedSample(store, result.sourceId, 1, 5), right[5]);
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);
		assert.deepEqual(snapshot.history.undoEntries[0], {
			type: 'batch',
			commandCount: 6,
			commands: ['source/add', 'track/remove', 'track/remove', 'track/add', 'clip/add', 'selection/set'],
		});

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.deepEqual(snapshot.project.tracks.map((track) => track.id), [
			'mix-track-a', 'mix-track-keep', 'mix-labels', 'mix-track-c',
		]);
		assert.deepEqual(snapshot.project.selection.trackIds, ['mix-track-a', 'mix-track-c']);
		assert.equal(snapshot.project.tracks.find((track) => track.id === 'mix-track-a').mute, true);
		assert.equal(snapshot.project.tracks.find((track) => track.id === 'mix-track-c').solo, true);

		failRender = true;
		const historyBeforeFailure = snapshot.history.undoEntries.length;
		await assert.rejects(controller.actions.track.mixAndRender(), /Mix render failed/);
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.processingEffect, false);
		assert.equal(snapshot.history.undoEntries.length, historyBeforeFailure);
		assert.ok(snapshot.project.tracks.some((track) => track.id === 'mix-track-a'));
		assert.ok(snapshot.project.tracks.some((track) => track.id === 'mix-track-c'));
	} finally {
		await controller.dispose();
	}
});

test('single-track Mix-down to keeps the track and routing while baking its controls and rack', async () => {
	const store = createTestStore('single');
	await writeSource(store, 'single-source', [new Float32Array(12).fill(0.4)]);
	const project = createAudioEditorProjectV2({
		id: 'single-mix-project',
		title: 'Single mix project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('single-source', 12)],
		tracks: [{
			type: 'audio', id: 'single-track', name: 'Narration', clipIds: ['single-clip'],
			gain: 0.6, pan: -0.4, mute: true, armed: true, displayMode: 'multiview',
			color: '#abcdef', collapsed: true, height: 220,
			envelope: [{ frame: 0, value: 0.5 }, { frame: 12, value: 1 }],
			effects: [{ id: 'single-effect', type: 'highpass', params: { frequency: 120, q: 0.707 } }],
		}],
		clips: [clip('single-clip', 'single-source', 3, 12)],
		mixer: {
			groups: [{ id: 'single-group', name: 'Dialogue', gain: 1, pan: 0, effects: [] }],
			routes: { 'single-track': { groupId: 'single-group', sends: {} } },
		},
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	let renderCall;
	const outputLeft = new Float32Array(12).fill(0.625);
	const outputRight = new Float32Array(12).fill(0.375);
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot: async (snapshot, range) => {
			renderCall = { snapshot: structuredClone(snapshot), range: structuredClone(range) };
			return audioBuffer([outputLeft, outputRight], snapshot.sampleRate);
		},
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('single-track');
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		const result = await controller.actions.track.mixAndRender();
		assert.equal(result.trackId, 'single-track');
		assert.deepEqual(renderCall.snapshot.mixer, { groups: [], sends: [], routes: {} });
		assert.deepEqual(renderCall.snapshot.tracks.map(({ id, gain, pan, mute, effects }) => ({
			id, gain, pan, mute, effects: effects.map((effect) => effect.id),
		})), [{ id: 'single-track', gain: 0.6, pan: -0.4, mute: false, effects: ['single-effect'] }]);

		let snapshot = controller.getSnapshot();
		const track = snapshot.project.tracks.find((candidate) => candidate.id === 'single-track');
		const mixedSource = snapshot.project.sources.find((candidate) => candidate.id === result.sourceId);
		assert.equal(mixedSource.channelCount, 2);
		assert.deepEqual({
			name: track.name,
			displayMode: track.displayMode,
			color: track.color,
			collapsed: track.collapsed,
			height: track.height,
		}, {
			name: 'Narration',
			displayMode: 'multiview',
			color: '#abcdef',
			collapsed: true,
			height: 220,
		});
		assert.deepEqual({ gain: track.gain, pan: track.pan, mute: track.mute, solo: track.solo, armed: track.armed }, {
			gain: 1, pan: 0, mute: false, solo: false, armed: false,
		});
		assert.deepEqual(track.envelope, []);
		assert.deepEqual(track.effects, []);
		assert.equal(snapshot.project.mixer.routes['single-track'].groupId, 'single-group');
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		const restored = snapshot.project.tracks.find((candidate) => candidate.id === 'single-track');
		assert.equal(restored.gain, 0.6);
		assert.equal(restored.pan, -0.4);
		assert.equal(restored.mute, true);
		assert.equal(restored.armed, true);
		assert.deepEqual(restored.effects.map((effect) => effect.id), ['single-effect']);
		assert.deepEqual(restored.clipIds, ['single-clip']);
	} finally {
		await controller.dispose();
	}
});

test('center-panned mono tracks persist a mono equal-power Mix-down without a 3 dB gain error', async () => {
	const store = createTestStore('centered-mono');
	await writeSource(store, 'centered-source-a', [new Float32Array(8).fill(0.2)]);
	await writeSource(store, 'centered-source-b', [new Float32Array(8).fill(0.3)]);
	const project = createAudioEditorProjectV2({
		id: 'centered-mono-project',
		title: 'Centered mono project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('centered-source-a', 8), source('centered-source-b', 8)],
		tracks: [{
			type: 'audio', id: 'centered-track-a', name: 'A', clipIds: ['centered-clip-a'], pan: 0,
		}, {
			type: 'audio', id: 'centered-track-b', name: 'B', clipIds: ['centered-clip-b'], pan: 0,
		}],
		clips: [
			clip('centered-clip-a', 'centered-source-a', 0, 8),
			clip('centered-clip-b', 'centered-source-b', 0, 8),
		],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const mixed = Float32Array.from([0.5, -0.25, 0.125, -0.75, 0.4, 0, -0.1, 0.9]);
	const pannedSide = Float32Array.from(mixed, (sample) => sample * Math.SQRT1_2);
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot: async (snapshot) => audioBuffer([pannedSide, pannedSide], snapshot.sampleRate),
	});

	try {
		await controller.ready;
		controller.actions.timeline.setSelection(0, 8, {
			trackIds: ['centered-track-a', 'centered-track-b'],
			clipIds: [],
			frequencyRange: null,
		});
		const result = await controller.actions.track.mixAndRender();
		const snapshot = controller.getSnapshot();
		const mixedSource = snapshot.project.sources.find((candidate) => candidate.id === result.sourceId);
		assert.equal(mixedSource.channelCount, 1);
		for (let frame = 0; frame < mixed.length; frame += 1) {
			assert.ok(Math.abs(await storedSample(store, result.sourceId, 0, frame) - mixed[frame]) < 1e-6);
		}
	} finally {
		await controller.dispose();
	}
});

test('centered mono tracks retain stereo generated by a panned mixer group', async () => {
	const store = createTestStore('panned-group');
	await writeSource(store, 'group-source-a', [new Float32Array(8).fill(0.2)]);
	await writeSource(store, 'group-source-b', [new Float32Array(8).fill(0.3)]);
	const project = createAudioEditorProjectV2({
		id: 'panned-group-project',
		title: 'Panned group project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('group-source-a', 8), source('group-source-b', 8)],
		tracks: [{
			type: 'audio', id: 'group-track-a', name: 'A', clipIds: ['group-clip-a'], pan: 0,
		}, {
			type: 'audio', id: 'group-track-b', name: 'B', clipIds: ['group-clip-b'], pan: 0,
		}],
		clips: [
			clip('group-clip-a', 'group-source-a', 0, 8),
			clip('group-clip-b', 'group-source-b', 0, 8),
		],
		mixer: {
			groups: [{
				id: 'panned-group', name: 'Panned', gain: 1, pan: 0.75,
				mute: false, solo: false, effects: [],
			}],
			sends: [],
			routes: {
				'group-track-a': { groupId: 'panned-group', sends: {} },
				'group-track-b': { groupId: 'panned-group', sends: {} },
			},
		},
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const renderedLeft = new Float32Array(8).fill(0.15);
	const renderedRight = new Float32Array(8).fill(0.45);
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot: async (snapshot) => {
			assert.equal(snapshot.mixer.groups[0].pan, 0.75);
			return audioBuffer([renderedLeft, renderedRight], snapshot.sampleRate);
		},
	});

	try {
		await controller.ready;
		controller.actions.timeline.setSelection(0, 8, {
			trackIds: ['group-track-a', 'group-track-b'],
			clipIds: [],
			frequencyRange: null,
		});
		const result = await controller.actions.track.mixAndRender();
		const snapshot = controller.getSnapshot();
		const mixedSource = snapshot.project.sources.find((candidate) => candidate.id === result.sourceId);
		assert.equal(mixedSource.channelCount, 2);
		assert.equal(await storedSample(store, result.sourceId, 0, 3), renderedLeft[3]);
		assert.equal(await storedSample(store, result.sourceId, 1, 3), renderedRight[3]);
	} finally {
		await controller.dispose();
	}
});

test('a centered mono track retains distinct stereo produced by its realtime rack', async () => {
	const store = createTestStore('stereo-rack');
	await writeSource(store, 'rack-source', [new Float32Array(8).fill(0.2)]);
	const project = createAudioEditorProjectV2({
		id: 'stereo-rack-project',
		title: 'Stereo rack project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('rack-source', 8)],
		tracks: [{
			type: 'audio', id: 'rack-track', name: 'Rack', clipIds: ['rack-clip'], pan: 0,
			effects: [{ id: 'rack-reverb', type: 'reverb', params: { mix: 1, duration: 0.05 } }],
		}],
		clips: [clip('rack-clip', 'rack-source', 0, 8)],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot: async (snapshot, range) => {
			const tailFrames = Math.round(Number(range.includeTail || 0) * snapshot.sampleRate);
			const frameCount = range.endFrame - range.startFrame + tailFrames;
			return audioBuffer([
				new Float32Array(frameCount).fill(0.1),
				new Float32Array(frameCount).fill(0.3),
			], snapshot.sampleRate);
		},
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('rack-track');
		const result = await controller.actions.track.mixAndRender();
		const snapshot = controller.getSnapshot();
		const mixedSource = snapshot.project.sources.find((candidate) => candidate.id === result.sourceId);
		assert.equal(mixedSource.channelCount, 2);
		assert.ok(Math.abs(await storedSample(store, result.sourceId, 0, 4) - 0.1) < 1e-6);
		assert.ok(Math.abs(await storedSample(store, result.sourceId, 1, 4) - 0.3) < 1e-6);
	} finally {
		await controller.dispose();
	}
});

test('a centered track with a stereo source persists a stereo Mix-down', async () => {
	const store = createTestStore('stereo-source');
	const inputLeft = new Float32Array(6).fill(0.2);
	const inputRight = new Float32Array(6).fill(-0.3);
	await writeSource(store, 'stereo-source', [inputLeft, inputRight]);
	const project = createAudioEditorProjectV2({
		id: 'stereo-source-project',
		title: 'Stereo source project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [source('stereo-source', 6, 2)],
		tracks: [{
			type: 'audio', id: 'stereo-track', name: 'Stereo', clipIds: ['stereo-clip'], pan: 0,
		}],
		clips: [clip('stereo-clip', 'stereo-source', 0, 6)],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const renderedLeft = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
	const renderedRight = Float32Array.from([-0.6, -0.5, -0.4, -0.3, -0.2, -0.1]);
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot: async (snapshot) => audioBuffer([renderedLeft, renderedRight], snapshot.sampleRate),
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('stereo-track');
		const result = await controller.actions.track.mixAndRender();
		const snapshot = controller.getSnapshot();
		const mixedSource = snapshot.project.sources.find((candidate) => candidate.id === result.sourceId);
		assert.equal(mixedSource.channelCount, 2);
		assert.equal(await storedSample(store, result.sourceId, 0, 4), renderedLeft[4]);
		assert.equal(await storedSample(store, result.sourceId, 1, 4), renderedRight[4]);
	} finally {
		await controller.dispose();
	}
});

test('oversized Mix-down streams stereo packets directly into canonical storage', async () => {
	const store = createTestStore('streamed-success');
	await writeSource(store, 'stream-input', [new Float32Array(8).fill(0.25)]);
	const project = createAudioEditorProjectV2({
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
	const left = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
	const right = Float32Array.from([-0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8]);
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
		assert.equal(mixedSource.channelCount, 2);
		assert.equal(mixedSource.frameCount, 8);
		assert.equal(mixedSource.chunkFrames, 65_536);
		assert.equal(await storedSample(store, result.sourceId, 0, 6), left[6]);
		assert.equal(await storedSample(store, result.sourceId, 1, 4), right[4]);
		const metadata = await store.getSourceMetadata(result.sourceId);
		assert.deepEqual({
			frameCount: metadata.frameCount,
			channelCount: metadata.channelCount,
			chunkFrames: metadata.chunkFrames,
			chunkCount: metadata.chunkCount,
		}, { frameCount: 8, channelCount: 2, chunkFrames: 65_536, chunkCount: 1 });
		assert.deepEqual(controller.sourceBufferCacheStats, { byteLength: 0, maxBytes: 0, entryCount: 0 });
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.ok(snapshot.project.sources.some((candidate) => candidate.id === 'stream-input'));
		assert.equal(snapshot.project.sources.some((candidate) => candidate.id === result.sourceId), false);
		controller.actions.edit.redo();
		snapshot = controller.getSnapshot();
		assert.ok(snapshot.project.sources.some((candidate) => candidate.id === result.sourceId));
		assert.equal(await storedSample(store, result.sourceId, 1, 7), right[7]);
	} finally {
		await controller.dispose();
	}
});

test('a failed streamed Mix-down aborts pending chunks without publishing history', async () => {
	const store = createTestStore('streamed-render-failure');
	await writeSource(store, 'failure-input', [new Float32Array(4).fill(0.2)]);
	const attemptedSourceIds = observeMixedSourceWrites(store);
	const project = createAudioEditorProjectV2({
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
	const project = createAudioEditorProjectV2({
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
	const project = createAudioEditorProjectV2({
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
		assert.equal(await store.loadAnalysis(`audio-editor-peaks-v1:${attemptedSourceIds[0]}`), null);
	} finally {
		await controller.dispose();
	}
});

function createTestStore(suffix) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `audio-editor-mix-render-${suffix}-${Date.now()}-${Math.random()}`,
	});
}

function observeMixedSourceWrites(store) {
	const sourceIds = [];
	const beginSourceWrite = store.beginSourceWrite.bind(store);
	store.beginSourceWrite = async (sourceId, metadata) => {
		if (String(sourceId).startsWith('mixed-source')) sourceIds.push(sourceId);
		return beginSourceWrite(sourceId, metadata);
	};
	return sourceIds;
}

async function writeSource(store, id, channels) {
	const writer = await store.beginSourceWrite(id, {
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: channels.length,
	});
	await writer.write(channels);
	await writer.commit({ sampleRate: 48_000, channelCount: channels.length });
}

function source(id, frameCount, channelCount = 1) {
	return {
		id,
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		storageKey: id,
		frameCount,
		channelCount,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	};
}

function clip(id, sourceId, timelineStartFrame, durationFrames) {
	return {
		id,
		sourceId,
		title: id,
		timelineStartFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: durationFrames,
		durationFrames,
	};
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
				createBuffer(channelCount, length, sampleRate) {
					return audioBuffer(Array.from(
						{ length: channelCount },
						() => new Float32Array(length),
					), sampleRate);
				},
			};
		},
		async dispose() {},
	};
}

async function storedSample(store, sourceId, channel, frame) {
	let offset = 0;
	for await (const chunk of store.readSourceChunks(sourceId)) {
		if (frame < offset + chunk.frames) return chunk.channels[channel][frame - offset];
		offset += chunk.frames;
	}
	throw new RangeError(`Source ${sourceId} does not contain frame ${frame}.`);
}

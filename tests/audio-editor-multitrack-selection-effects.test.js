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

const { ENGLISH_COPY } = await import('../src/i18n/catalogs.js');
const { createAudioEditorController } = await import('../src/lib/tools/audio-editor/app.js');
const { createAudioEditorProjectV2 } = await import('../src/lib/tools/audio-editor/project-v2.js');
const { createProjectStore } = await import('../src/lib/tools/audio-editor/storage.js');

test('selection effects replace every selected audio track in one atomic history entry', async () => {
	const frameCount = 256;
	const inputs = new Map([
		['effect-track-a', new Float32Array(frameCount).fill(0.125)],
		['effect-track-b', new Float32Array(frameCount).fill(-0.25)],
	]);
	const { store } = await createTwoTrackFixture('multitrack-effect', inputs, 48_000);
	const renderTrackIds = [];
	const controller = createController(store, async (_snapshot, range) => {
		renderTrackIds.push(range.trackId);
		const input = inputs.get(range.trackId);
		return audioBuffer([input.slice(range.startFrame, range.endFrame)], 48_000);
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('effect-track-a');
		controller.actions.timeline.setSelection(0, frameCount, {
			trackIds: ['effect-track-a', 'effect-track-b'],
			clipIds: [],
		});
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });

		let snapshot = controller.getSnapshot();
		assert.deepEqual(renderTrackIds, ['effect-track-a', 'effect-track-b']);
		assert.deepEqual(snapshot.project.selection.trackIds, ['effect-track-a', 'effect-track-b']);
		assert.equal(snapshot.project.selection.frequencyRange, null);
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);
		assert.deepEqual(snapshot.history.undoEntries[0], {
			type: 'batch',
			commandCount: 3,
			commands: ['range/replace', 'range/replace', 'selection/set'],
		});
		for (const [trackId, input] of inputs) {
			const track = snapshot.project.tracks.find((candidate) => candidate.id === trackId);
			const replacement = snapshot.project.clips.find((clip) => track.clipIds.includes(clip.id));
			assert.notEqual(replacement.sourceId, `${trackId}-source`);
			assert.equal(await storedSample(store, replacement.sourceId, 0), -input[0]);
		}

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.deepEqual(snapshot.project.clips.map((clip) => clip.id).sort(), [
			'effect-track-a-clip',
			'effect-track-b-clip',
		]);

		renderTrackIds.length = 0;
		const historyBeforeRepeat = snapshot.history.undoEntries.length;
		await controller.actions.effects.applySelection({
			type: 'audacity-repeat',
			params: { count: 1 },
		});
		snapshot = controller.getSnapshot();
		assert.deepEqual(renderTrackIds, ['effect-track-a', 'effect-track-b']);
		assert.equal(snapshot.project.selection.endFrame, frameCount * 2);
		assert.equal(snapshot.history.undoEntries.length, historyBeforeRepeat + 1);
		for (const [trackId, input] of inputs) {
			const track = snapshot.project.tracks.find((candidate) => candidate.id === trackId);
			const replacement = snapshot.project.clips.find((clip) => track.clipIds.includes(clip.id));
			const output = await storedChannel(store, replacement.sourceId, 0);
			assert.equal(output.length, frameCount * 2);
			assert.deepEqual(output.slice(0, frameCount), input);
			assert.deepEqual(output.slice(frameCount), input);
		}
		controller.actions.edit.undo();

		const createdSourceIds = [];
		const beginSourceWrite = store.beginSourceWrite.bind(store);
		store.beginSourceWrite = async (sourceId, metadata) => {
			createdSourceIds.push(sourceId);
			return beginSourceWrite(sourceId, metadata);
		};
		const saveAnalysis = store.saveAnalysis.bind(store);
		let analysisCalls = 0;
		store.saveAnalysis = async (...args) => {
			analysisCalls += 1;
			if (analysisCalls === 2) throw new Error('Peak persistence failed.');
			return saveAnalysis(...args);
		};
		const historyBeforeStorageFailure = controller.getSnapshot().history.undoEntries.length;
		await assert.rejects(controller.actions.effects.applySelection({
			type: 'audacity-invert',
			params: {},
		}), /Peak persistence failed/);
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.history.undoEntries.length, historyBeforeStorageFailure);
		assert.deepEqual(snapshot.project.clips.map((clip) => clip.id).sort(), [
			'effect-track-a-clip',
			'effect-track-b-clip',
		]);
		assert.equal(snapshot.processingEffect, false);
		assert.equal(createdSourceIds.length, 2);
		for (const sourceId of createdSourceIds) {
			assert.equal(await store.getSourceMetadata(sourceId), null);
			assert.equal(await store.loadAnalysis(`audio-editor-peaks-v1:${sourceId}`), null);
		}
	} finally {
		await controller.dispose();
	}
});

test('clip-only effects keep working without an active time selection', async () => {
	const frameCount = 256;
	const inputs = new Map([
		['effect-track-a', new Float32Array(frameCount).fill(0.125)],
		['effect-track-b', new Float32Array(frameCount).fill(-0.25)],
	]);
	const { store } = await createTwoTrackFixture('clip-effect', inputs, 48_000);
	const controller = createController(store, async (_snapshot, range) => {
		const input = inputs.get(range.trackId);
		return audioBuffer([input.slice(range.startFrame, range.endFrame)], 48_000);
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectClip('effect-track-a-clip');
		await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });

		const snapshot = controller.getSnapshot();
		const firstTrack = snapshot.project.tracks.find((track) => track.id === 'effect-track-a');
		const replacement = snapshot.project.clips.find((clip) => firstTrack.clipIds.includes(clip.id));
		assert.notEqual(replacement.sourceId, 'effect-track-a-source');
		assert.equal(await storedSample(store, replacement.sourceId, 0), -0.125);
		assert.deepEqual(
			snapshot.project.tracks.find((track) => track.id === 'effect-track-b').clipIds,
			['effect-track-b-clip'],
		);
	} finally {
		await controller.dispose();
	}
});

test('destructive selection renders exclude track automation and downstream mixer routing', async () => {
	const frameCount = 256;
	const inputs = new Map([
		['effect-track-a', new Float32Array(frameCount).fill(0.125)],
		['effect-track-b', new Float32Array(frameCount).fill(-0.25)],
	]);
	const { store, project } = await createTwoTrackFixture('dry-selection-effect', inputs, 48_000);
	const targetTrack = project.tracks.find((track) => track.id === 'effect-track-a');
	targetTrack.envelope = [{ frame: 0, value: 0.5 }, { frame: frameCount, value: 0.5 }];
	project.mixer = {
		groups: [{
			id: 'effect-group', name: 'Effect group', gain: 0.25, pan: 0.75,
			mute: false, solo: false, effects: [],
		}],
		sends: [],
		routes: { 'effect-track-a': { groupId: 'effect-group', sends: {} } },
	};
	await store.saveProject(project);
	let drySnapshot;
	const controller = createController(store, async (snapshot, range) => {
		drySnapshot = structuredClone(snapshot);
		const input = inputs.get(range.trackId).slice(range.startFrame, range.endFrame);
		const envelopeGain = snapshot.tracks[0]?.envelope?.length ? 0.5 : 1;
		const mixerGain = snapshot.mixer?.groups?.length ? 0.25 : 1;
		return audioBuffer([
			Float32Array.from(input, (sample) => sample * envelopeGain * mixerGain),
		], 48_000);
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('effect-track-a');
		controller.actions.timeline.setSelection(0, frameCount, {
			trackIds: ['effect-track-a'],
			clipIds: [],
		});
		await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });

		assert.deepEqual(drySnapshot.tracks[0].envelope, []);
		assert.deepEqual(drySnapshot.mixer, { groups: [], sends: [], routes: {} });
		const snapshot = controller.getSnapshot();
		const track = snapshot.project.tracks.find((candidate) => candidate.id === 'effect-track-a');
		assert.deepEqual(track.envelope, [{ frame: 0, value: 0.5 }, { frame: frameCount, value: 0.5 }]);
		const replacement = snapshot.project.clips.find((clip) => track.clipIds.includes(clip.id));
		assert.equal(await storedSample(store, replacement.sourceId, 0), -0.125);
	} finally {
		await controller.dispose();
	}
});

test('length-changing effects ripple selected tracks whose selection range is silent', async () => {
	const frameCount = 256;
	const inputs = new Map([
		['effect-track-a', new Float32Array(frameCount).fill(0.125)],
		['effect-track-b', new Float32Array(frameCount).fill(-0.25)],
	]);
	const { store, project } = await createTwoTrackFixture('silent-track-ripple-effect', inputs, 48_000);
	project.clips.find((clip) => clip.id === 'effect-track-b-clip').timelineStartFrame = frameCount * 2;
	await store.saveProject(project);
	const renderedTrackIds = [];
	const controller = createController(store, async (_snapshot, range) => {
		renderedTrackIds.push(range.trackId);
		const input = range.trackId === 'effect-track-a'
			? inputs.get(range.trackId).slice(range.startFrame, range.endFrame)
			: new Float32Array(range.endFrame - range.startFrame);
		return audioBuffer([input], 48_000);
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('effect-track-a');
		controller.actions.timeline.setSelection(0, frameCount, {
			trackIds: ['effect-track-a', 'effect-track-b'],
			clipIds: [],
		});
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.effects.applySelection({
			type: 'audacity-repeat',
			params: { count: 1 },
		});

		let snapshot = controller.getSnapshot();
		assert.deepEqual(renderedTrackIds, ['effect-track-a', 'effect-track-b']);
		const silentTrack = snapshot.project.tracks.find((track) => track.id === 'effect-track-b');
		assert.deepEqual(silentTrack.clipIds, ['effect-track-b-clip']);
		assert.equal(
			snapshot.project.clips.find((clip) => clip.id === 'effect-track-b-clip').timelineStartFrame,
			frameCount * 3,
		);
		assert.equal(
			snapshot.project.clips.find((clip) => clip.id === 'effect-track-b-clip').sourceId,
			'effect-track-b-source',
			'the silent range does not materialize a silent source',
		);
		assert.equal(snapshot.project.selection.endFrame, frameCount * 2);
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);
		assert.deepEqual(snapshot.history.undoEntries[0].commands, ['range/replace', 'clipboard/paste', 'selection/set']);

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.equal(
			snapshot.project.clips.find((clip) => clip.id === 'effect-track-b-clip').timelineStartFrame,
			frameCount * 2,
		);
	} finally {
		await controller.dispose();
	}
});

test('Truncate Silence links silence detection across selected tracks by default', async () => {
	const sampleRate = 10;
	const firstInput = Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	const secondInput = Float32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
	const inputs = new Map([
		['effect-track-a', firstInput],
		['effect-track-b', secondInput],
	]);
	const { store } = await createTwoTrackFixture('linked-truncate-silence', inputs, sampleRate);
	const controller = createController(store, async (_snapshot, range) => (
		audioBuffer([
			inputs.get(range.trackId).slice(range.startFrame, range.endFrame),
		], sampleRate)
	));

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('effect-track-a');
		controller.actions.timeline.setSelection(0, firstInput.length, {
			trackIds: ['effect-track-a', 'effect-track-b'],
			clipIds: [],
		});
		await controller.actions.effects.applySelection({
			type: 'audacity-truncate-silence',
			params: {
				thresholdDb: -20,
				action: 'truncate',
				minimumSilence: 0.5,
				truncateTo: 0.2,
				compressPercent: 50,
			},
		});

		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.project.selection.endFrame, firstInput.length);
		for (const [trackId, input] of inputs) {
			const track = snapshot.project.tracks.find((candidate) => candidate.id === trackId);
			const replacement = snapshot.project.clips.find((clip) => track.clipIds.includes(clip.id));
			assert.deepEqual(await storedChannel(store, replacement.sourceId, 0), input);
		}
	} finally {
		await controller.dispose();
	}
});

test('independent Truncate Silence ripples each selected track and selects the longest output', async () => {
	const sampleRate = 10;
	const firstInput = Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	const secondInput = Float32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
	const inputs = new Map([
		['effect-track-a', firstInput],
		['effect-track-b', secondInput],
	]);
	const { store } = await createTwoTrackFixture('independent-truncate-silence', inputs, sampleRate);
	const controller = createController(store, async (_snapshot, range) => (
		audioBuffer([
			inputs.get(range.trackId).slice(range.startFrame, range.endFrame),
		], sampleRate)
	));

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('effect-track-a');
		controller.actions.timeline.setSelection(0, firstInput.length, {
			trackIds: ['effect-track-a', 'effect-track-b'],
			clipIds: [],
		});
		await controller.actions.effects.applySelection({
			type: 'audacity-truncate-silence',
			params: {
				thresholdDb: -20,
				action: 'truncate',
				minimumSilence: 0.5,
				truncateTo: 0.2,
				compressPercent: 50,
				independent: true,
			},
		});

		const snapshot = controller.getSnapshot();
		const outputLengths = ['effect-track-a', 'effect-track-b'].map((trackId) => {
			const track = snapshot.project.tracks.find((candidate) => candidate.id === trackId);
			const replacement = snapshot.project.clips.find((clip) => track.clipIds.includes(clip.id));
			return snapshot.project.sources.find((source) => source.id === replacement.sourceId).frameCount;
		});
		assert.deepEqual(outputLengths, [4, 7]);
		assert.equal(snapshot.project.selection.endFrame, 7);
		assert.deepEqual(snapshot.history.undoEntries[0].commands, ['range/replace', 'range/replace', 'selection/set']);
	} finally {
		await controller.dispose();
	}
});

test('spectral-box selection effects route through every selected track and preserve the box', async () => {
	const sampleRate = 8_192;
	const frameCount = sampleRate;
	const inputs = new Map([
		['effect-track-a', twoTone(frameCount, sampleRate, 0.1, 0.1)],
		['effect-track-b', twoTone(frameCount, sampleRate, 0.05, 0.15)],
	]);
	const { store } = await createTwoTrackFixture('multitrack-spectral-effect', inputs, sampleRate, true);
	const controller = createController(store, async (_snapshot, range) => {
		const input = inputs.get(range.trackId);
		return audioBuffer([input.slice(range.startFrame, range.endFrame)], sampleRate);
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('effect-track-a');
		controller.actions.timeline.setSelection(0, frameCount, {
			trackIds: ['effect-track-a', 'effect-track-b'],
			clipIds: [],
			frequencyRange: { minimumFrequency: 450, maximumFrequency: 575 },
		});
		await controller.actions.effects.applySelection({
			type: 'audacity-amplify',
			params: { gainDb: 6.020599913, allowClipping: true },
		});

		const snapshot = controller.getSnapshot();
		assert.deepEqual(snapshot.project.selection.trackIds, ['effect-track-a', 'effect-track-b']);
		assert.deepEqual(snapshot.project.selection.frequencyRange, {
			minimumFrequency: 450,
			maximumFrequency: 575,
		});
		for (const [trackId, input] of inputs) {
			const track = snapshot.project.tracks.find((candidate) => candidate.id === trackId);
			const replacement = snapshot.project.clips.find((clip) => track.clipIds.includes(clip.id));
			const output = await storedChannel(store, replacement.sourceId, 0);
			const inputLow = toneAmplitude(input, 512, sampleRate, 2_000, 6_000);
			const inputHigh = toneAmplitude(input, 2_048, sampleRate, 2_000, 6_000);
			assert.ok(Math.abs(toneAmplitude(output, 512, sampleRate, 2_000, 6_000) - inputLow * 2) < 0.02);
			assert.ok(Math.abs(toneAmplitude(output, 2_048, sampleRate, 2_000, 6_000) - inputHigh) < 0.02);
		}
	} finally {
		await controller.dispose();
	}
});

async function createTwoTrackFixture(prefix, inputs, sampleRate, spectrogram = false) {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${prefix}-${Date.now()}-${Math.random()}`,
	});
	for (const [trackId, input] of inputs) {
		const writer = await store.beginSourceWrite(`${trackId}-source`, {
			name: `${trackId}.wav`, mimeType: 'audio/wav', sampleRate, channelCount: 1,
		});
		await writer.write([input]);
		await writer.commit({ sampleRate, channelCount: 1 });
	}
	const project = createAudioEditorProjectV2({
		id: `${prefix}-project`,
		title: 'Multitrack effect project',
		now: '2026-07-15T00:00:00.000Z',
		sampleRate,
		sources: [...inputs].map(([trackId, input]) => ({
			id: `${trackId}-source`,
			name: `${trackId}.wav`,
			mimeType: 'audio/wav',
			storageKey: `${trackId}-source`,
			frameCount: input.length,
			channelCount: 1,
			sampleRate,
			originalSampleRate: sampleRate,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		})),
		tracks: [...inputs].map(([trackId]) => ({
			type: 'audio',
			id: trackId,
			name: trackId,
			clipIds: [`${trackId}-clip`],
			...(spectrogram ? { displayMode: 'spectrogram', spectrogram: { windowSize: 1_024 } } : {}),
		})),
		clips: [...inputs].map(([trackId, input]) => ({
			id: `${trackId}-clip`,
			sourceId: `${trackId}-source`,
			title: trackId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: input.length,
			durationFrames: input.length,
		})),
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	return { store, project };
}

function createController(store, renderSnapshot) {
	return createAudioEditorController(null, {
		headless: true,
		copy: ENGLISH_COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot,
	});
}

function twoTone(frameCount, sampleRate, lowAmplitude, highAmplitude) {
	return Float32Array.from({ length: frameCount }, (_, frame) => (
		lowAmplitude * Math.sin(2 * Math.PI * 512 * frame / sampleRate)
		+ highAmplitude * Math.sin(2 * Math.PI * 2_048 * frame / sampleRate)
	));
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

async function storedSample(store, sourceId, frame) {
	return (await storedChannel(store, sourceId, 0))[frame];
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

function toneAmplitude(samples, frequency, sampleRate, start, end) {
	let sine = 0;
	let cosine = 0;
	for (let frame = start; frame < end; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / sampleRate;
		sine += samples[frame] * Math.sin(angle);
		cosine += samples[frame] * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / (end - start);
}

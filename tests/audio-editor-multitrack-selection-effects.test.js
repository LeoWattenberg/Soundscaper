import test from 'node:test';
import assert from 'node:assert/strict';
import {
	audioBuffer,
	createController,
	createCurrentAudioEditorProject,
	createTwoTrackFixture,
	storedChannel,
	storedSample,
} from './helpers/audio-editor-multitrack-selection-harness.js';

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
			assert.equal(await store.loadAnalysis(`audio-editor-peaks-v2:${sourceId}`), null);
		}
	} finally {
		await controller.dispose();
	}
});

test('canonical EQ selection processing uses pre-roll and commits all selected tracks atomically', async () => {
	const frameCount = 512;
	const startFrame = 64;
	const endFrame = 320;
	const inputs = new Map([
		['effect-track-a', Float32Array.from({ length: frameCount }, (_, frame) => Math.sin(frame / 17) * 0.25)],
		['effect-track-b', Float32Array.from({ length: frameCount }, (_, frame) => Math.cos(frame / 23) * 0.2)],
	]);
	const { store } = await createTwoTrackFixture('multitrack-parametric-eq', inputs, 48_000);
	const renders = [];
	const controller = createController(store, async (_snapshot, range) => {
		renders.push({ trackId: range.trackId, startFrame: range.startFrame, endFrame: range.endFrame });
		return audioBuffer([
			inputs.get(range.trackId).slice(range.startFrame, range.endFrame),
		], 48_000);
	});

	try {
		await controller.ready;
		assert(controller.getSnapshot().effects.selectionTypes.some(({ type }) => type === 'eq'));
		controller.actions.timeline.selectTrack('effect-track-a');
		controller.actions.timeline.setSelection(startFrame, endFrame, {
			trackIds: ['effect-track-a', 'effect-track-b'],
			clipIds: [],
		});
		const historyBefore = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.effects.applySelection({
			type: 'eq',
			params: { outputGain: 0, bands: [] },
		});

		const snapshot = controller.getSnapshot();
		assert.deepEqual(renders, [
			{ trackId: 'effect-track-a', startFrame, endFrame },
			{ trackId: 'effect-track-b', startFrame, endFrame },
			{ trackId: 'effect-track-a', startFrame: 0, endFrame: startFrame },
			{ trackId: 'effect-track-b', startFrame: 0, endFrame: startFrame },
		]);
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);
		assert.deepEqual(snapshot.history.undoEntries[0], {
			type: 'batch',
			commandCount: 3,
			commands: ['range/replace', 'range/replace', 'selection/set'],
		});
		for (const [trackId, input] of inputs) {
			const track = snapshot.project.tracks.find((candidate) => candidate.id === trackId);
			const replacement = snapshot.project.clips.find((clip) => (
				track.clipIds.includes(clip.id) && clip.sourceId !== `${trackId}-source`
			));
			const output = await storedChannel(store, replacement.sourceId, 0);
			assert.deepEqual(output, input.slice(startFrame, endFrame));
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
	await store.saveProject(createCurrentAudioEditorProject(project));
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

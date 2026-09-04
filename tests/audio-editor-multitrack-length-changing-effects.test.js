import test from 'node:test';
import assert from 'node:assert/strict';
import {
	audioBuffer,
	createController,
	createTwoTrackFixture,
	expandFixtureSamples,
	storedChannel,
	toneAmplitude,
	twoTone,
} from './helpers/audio-editor-multitrack-selection-harness.js';

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
	const sampleRate = 8_000;
	const firstInput = expandFixtureSamples([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	const secondInput = expandFixtureSamples([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
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
	const sampleRate = 8_000;
	const firstInput = expandFixtureSamples([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	const secondInput = expandFixtureSamples([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
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
		assert.deepEqual(outputLengths, [3_200, 5_600]);
		assert.equal(snapshot.project.selection.endFrame, 5_600);
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

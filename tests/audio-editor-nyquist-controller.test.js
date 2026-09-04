import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createController,
	createFixture,
	storedChannel,
} from './helpers/audio-editor-nyquist-controller-harness.js';

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

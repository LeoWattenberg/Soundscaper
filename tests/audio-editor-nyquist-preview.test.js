import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ENGLISH_COPY,
	createController,
	createFixture,
	createPreviewEngine,
} from './helpers/audio-editor-nyquist-controller-harness.js';

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

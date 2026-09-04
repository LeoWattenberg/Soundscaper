import test from 'node:test';
import assert from 'node:assert/strict';

import {
	MockAudioBuffer,
	createMemoryFfmpeg,
	deferred,
	storedSample,
} from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	audioBuffer,
	createAudioEditorController,
	createCurrentAudioEditorProject,
	createMemoryEngine,
	createProjectStore,
	installSelectionPreviewFixture,
} from './helpers/audio-editor-controller-harness.js';


test('controller copies and atomically replaces realtime effect stacks across tracks', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	const sourceTrackId = controller.getSnapshot().project.tracks[0].id;
	const destinationTrackId = controller.actions.track.add({ name: 'Destination' });
	const emptyTrackId = controller.actions.track.add({ name: 'Empty' });
	const highpassId = controller.actions.effects.add({
		scope: 'track',
		trackId: sourceTrackId,
		type: 'highpass',
		options: { params: { frequency: 240, q: 1.25 } },
	});
	const delayId = controller.actions.effects.add({
		scope: 'track',
		trackId: sourceTrackId,
		type: 'delay',
		options: { enabled: false, params: { time: 0.375, feedback: 0.45, mix: 0.3 } },
	});
	const replacedId = controller.actions.effects.add({
		scope: 'track',
		trackId: destinationTrackId,
		type: 'compressor',
		options: { params: { threshold: -18, knee: 12, ratio: 3, attack: 0.01, release: 0.2, makeupGain: 2 } },
	});

	const copied = controller.actions.effects.copyStack('track', sourceTrackId);
	assert.equal(controller.getSnapshot().effects.hasStackClipboard, true);
	assert.deepEqual(copied.map(({ id, type }) => ({ id, type })), [
		{ id: highpassId, type: 'highpass' },
		{ id: delayId, type: 'delay' },
	]);
	const historyBeforePaste = controller.getSnapshot().history.undoEntries.length;
	controller.actions.effects.pasteStack('track', destinationTrackId);

	let snapshot = controller.getSnapshot();
	let destinationEffects = snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects;
	assert.deepEqual(destinationEffects.map(({ type, enabled, params }) => ({ type, enabled, params })), [
		{ type: 'highpass', enabled: true, params: { frequency: 240, q: 1.25 } },
		{ type: 'delay', enabled: false, params: { time: 0.375, feedback: 0.45, mix: 0.3 } },
	]);
	assert.ok(destinationEffects.every((effect) => ![highpassId, delayId, replacedId].includes(effect.id)));
	assert.equal(snapshot.history.undoEntries.length, historyBeforePaste + 1);
	assert.deepEqual(snapshot.history.undoEntries[0], {
		type: 'batch',
		commandCount: 3,
		commands: ['effect/remove', 'effect/add', 'effect/add'],
	});

	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	destinationEffects = snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects;
	assert.deepEqual(destinationEffects.map(({ id, type }) => ({ id, type })), [
		{ id: replacedId, type: 'compressor' },
	]);
	controller.actions.edit.redo();
	snapshot = controller.getSnapshot();
	destinationEffects = snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects;
	assert.deepEqual(destinationEffects.map((effect) => effect.type), ['highpass', 'delay']);

	assert.deepEqual(controller.actions.effects.copyStack('track', emptyTrackId), []);
	const historyBeforeClear = controller.getSnapshot().history.undoEntries.length;
	controller.actions.effects.pasteStack('track', destinationTrackId);
	snapshot = controller.getSnapshot();
	assert.deepEqual(snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects, []);
	assert.equal(snapshot.history.undoEntries.length, historyBeforeClear + 1);
	assert.deepEqual(snapshot.history.undoEntries[0], {
		type: 'batch',
		commandCount: 2,
		commands: ['effect/remove', 'effect/remove'],
	});
	controller.actions.edit.undo();
	assert.deepEqual(
		controller.getSnapshot().project.tracks.find((track) => track.id === destinationTrackId).effects.map((effect) => effect.type),
		['highpass', 'delay'],
	);
	await controller.dispose();
});

test('rack effect gestures preview Delay live and commit once without rebuilding playback', async () => {
	const engine = createMemoryEngine();
	engine.rackConfigurations = [];
	engine.configureRackEffect = function configureRackEffect(scope, targetId, effectId, params) {
		this.rackConfigurations.push({ scope, targetId, effectId, params: structuredClone(params) });
		return this.rackConfigurations.length;
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	const effectId = controller.actions.effects.add({
		scope: 'track',
		trackId,
		type: 'delay',
		options: { params: { time: 0.25, feedback: 0.3, mix: 0.2 } },
	});
	await Promise.resolve();
	await Promise.resolve();
	engine.appliedProjects.length = 0;
	engine.play();

	const before = controller.getSnapshot();
	controller.actions.effects.beginRackEffectGesture('track', trackId, effectId);
	controller.actions.effects.previewRackEffect('track', trackId, effectId, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.deepEqual(engine.rackConfigurations.at(-1).params, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.deepEqual(before.project.tracks[0].effects[0].params, {
		time: 0.25,
		feedback: 0.3,
		mix: 0.2,
	});

	controller.actions.effects.commitRackEffectGesture('track', trackId, effectId, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	const committed = controller.getSnapshot();
	assert.deepEqual(committed.project.tracks[0].effects[0].params, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.equal(committed.history.undoEntries.length, before.history.undoEntries.length + 1);
	assert.equal(engine.appliedProjects.length, 0);
	assert.equal(engine.state, 'playing');

	controller.actions.effects.beginRackEffectGesture('track', trackId, effectId);
	controller.actions.effects.previewRackEffect('track', trackId, effectId, { feedback: 0.1 });
	controller.actions.effects.cancelRackEffectGesture('track', trackId, effectId);
	assert.deepEqual(engine.rackConfigurations.at(-1).params, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.equal(controller.getSnapshot().history.undoEntries.length, committed.history.undoEntries.length);
	await controller.dispose();
});

test('parametric EQ gestures preview live and commit one history entry without rebuilding playback', async () => {
	const engine = createMemoryEngine();
	engine.eqConfigurations = [];
	engine.eqAuditions = [];
	engine.configureParametricEq = function configureParametricEq(scope, targetId, effectId, params) {
		this.eqConfigurations.push({ scope, targetId, effectId, params: structuredClone(params) });
		return this.eqConfigurations.length;
	};
	engine.auditionParametricEq = function auditionParametricEq(scope, targetId, effectId, bandId) {
		this.eqAuditions.push({ scope, targetId, effectId, bandId });
		return this.eqAuditions.length;
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	const effectId = controller.actions.effects.add({ scope: 'track', trackId, type: 'eq' });
	await Promise.resolve();
	await Promise.resolve();
	engine.appliedProjects.length = 0;
	const before = controller.getSnapshot();
	const original = before.project.tracks[0].effects.find((effect) => effect.id === effectId).params;
	const preview = structuredClone(original);
	preview.bands[0].gain = 9;
	controller.actions.effects.beginParametricEqGesture('track', trackId, effectId);
	controller.actions.effects.previewParametricEq('track', trackId, effectId, preview);
	assert.equal(engine.eqConfigurations.at(-1).params.bands[0].gain, 9);
	assert.equal(controller.getSnapshot().project.tracks[0].effects[0].params.bands[0].gain, 0);

	const finalParams = structuredClone(preview);
	finalParams.bands[0].gain = 12;
	controller.actions.effects.commitParametricEqGesture('track', trackId, effectId, finalParams);
	const committed = controller.getSnapshot();
	assert.equal(committed.project.tracks[0].effects[0].params.bands[0].gain, 12);
	assert.equal(committed.history.undoEntries.length, before.history.undoEntries.length + 1);
	assert.equal(engine.appliedProjects.length, 0);
	controller.actions.effects.beginParametricEqGesture('track', trackId, effectId);
	const cancelled = structuredClone(finalParams);
	cancelled.bands[0].gain = -18;
	controller.actions.effects.previewParametricEq('track', trackId, effectId, cancelled);
	controller.actions.effects.cancelParametricEqGesture('track', trackId, effectId);
	assert.equal(engine.eqConfigurations.at(-1).params.bands[0].gain, 12);
	assert.equal(controller.getSnapshot().history.undoEntries.length, committed.history.undoEntries.length);
	const invalid = structuredClone(finalParams);
	invalid.bands[0].gain = Number.NaN;
	const configurationCount = engine.eqConfigurations.length;
	controller.actions.effects.beginParametricEqGesture('track', trackId, effectId);
	assert.throws(
		() => controller.actions.effects.previewParametricEq('track', trackId, effectId, invalid),
		/eq\.bands\[0\]\.gain must be between -24 and 24/,
	);
	controller.actions.effects.cancelParametricEqGesture('track', trackId, effectId);
	assert.equal(engine.eqConfigurations.length, configurationCount);
	controller.actions.effects.auditionParametricEq('track', trackId, effectId, finalParams.bands[0].id);
	assert.equal(engine.eqAuditions.at(-1).bandId, finalParams.bands[0].id);
	await controller.dispose();
});

test('controller renders a macro as an ordered isolated rack and persists one destructive history edit', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `controller-effect-macro-${Date.now()}-${Math.random()}`,
	});
	const sourceId = 'controller-macro-source';
	const input = new Float32Array(64).fill(0.1);
	const writer = await store.beginSourceWrite(sourceId, {
		name: 'macro.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write([input]);
	await writer.commit({ sampleRate: 48_000, channelCount: 1 });
	const project = createCurrentAudioEditorProject({
		id: 'controller-macro-project',
		title: 'Macro project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [{
			id: sourceId,
			name: 'macro.wav',
			mimeType: 'audio/wav',
			storageKey: sourceId,
			frameCount: input.length,
			channelCount: 1,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		}],
		tracks: [{ type: 'audio', id: 'controller-macro-track', name: 'Macro source', clipIds: ['controller-macro-clip'] }],
		clips: [{
			id: 'controller-macro-clip',
			sourceId,
			title: 'Macro source',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: input.length,
			durationFrames: input.length,
		}],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const renderCalls = [];
	let failRender = false;
	const output = new Float32Array(input.length).fill(0.75);
	const renderSnapshot = async (snapshot, range) => {
		renderCalls.push({ snapshot: structuredClone(snapshot), range: structuredClone(range) });
		if (failRender) throw new Error('Macro render failed.');
		return audioBuffer([output.slice()], snapshot.sampleRate);
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot,
	});
	try {
		await controller.ready;
		const existingRackEffectId = controller.actions.effects.add({
			scope: 'track',
			trackId: 'controller-macro-track',
			type: 'reverb',
			options: { params: { mix: 0.1, decay: 1.5, preDelay: 0.02 } },
		});
		controller.actions.timeline.selectTrack('controller-macro-track');
		controller.actions.timeline.setSelection(0, input.length);
		const historyBeforeRun = controller.getSnapshot().history.undoEntries.length;

		const request = {
			name: 'Voice polish',
			trackId: 'controller-macro-track',
			effects: [{
				id: 'macro-delay',
				type: 'delay',
				enabled: true,
				params: { time: 0.125, feedback: 0.2, mix: 0.4 },
			}, {
				id: 'macro-invert',
				type: 'audacity-invert',
				enabled: true,
				params: {},
			}],
		};
		const run = controller.actions.macros.run(request);
		const duplicate = controller.actions.macros.run(request);
		assert.equal(await duplicate, null);
		const result = await run;
		assert.equal(result, true);
		assert.equal(renderCalls.length, 1);
		const renderedTrack = renderCalls[0].snapshot.tracks.find((track) => track.id === 'controller-macro-track');
		assert.deepEqual(renderedTrack.effects.map(({ type, enabled, params }) => ({ type, enabled, params })), [{
			type: 'delay',
			enabled: true,
			params: { time: 0.125, feedback: 0.2, mix: 0.4 },
		}, {
			type: 'audacity-invert',
			enabled: true,
			params: {},
		}]);
		assert.ok(renderedTrack.effects.every((effect) => !['macro-delay', 'macro-invert'].includes(effect.id)));
		assert.deepEqual(renderCalls[0].range, {
			startFrame: 0,
			endFrame: input.length,
			trackId: 'controller-macro-track',
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: input.length,
			preRollFrames: 0,
		});
		assert.deepEqual(renderCalls[0].snapshot.master.effects, []);
		assert.equal(renderedTrack.gain, 1);
		assert.equal(renderedTrack.pan, 0);

		let snapshot = controller.getSnapshot();
		const liveTrack = snapshot.project.tracks.find((track) => track.id === 'controller-macro-track');
		assert.deepEqual(liveTrack.effects.map((effect) => effect.id), [existingRackEffectId]);
		const replacementClip = snapshot.project.clips.find((clip) => liveTrack.clipIds.includes(clip.id));
		assert.notEqual(replacementClip.sourceId, sourceId);
		assert.equal(await storedSample(store, replacementClip.sourceId, 0), 0.75);
		assert.equal(snapshot.history.undoEntries.length, historyBeforeRun + 1);
		assert.deepEqual(snapshot.history.undoEntries[0], {
			type: 'batch',
			commandCount: 2,
			commands: ['range/replace', 'selection/set'],
		});

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		const restoredTrack = snapshot.project.tracks.find((track) => track.id === 'controller-macro-track');
		assert.deepEqual(restoredTrack.effects.map((effect) => effect.id), [existingRackEffectId]);
		assert.deepEqual(restoredTrack.clipIds, ['controller-macro-clip']);
		assert.equal(snapshot.project.clips.find((clip) => clip.id === 'controller-macro-clip').sourceId, sourceId);

		failRender = true;
		const historyBeforeFailure = snapshot.history.undoEntries.length;
		await assert.rejects(controller.actions.macros.run(request), /Macro render failed/);
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.processingEffect, false);
		assert.equal(snapshot.status.state, 'error');
		assert.match(snapshot.status.message, /Macro render failed/);
		assert.equal(snapshot.history.undoEntries.length, historyBeforeFailure);
	} finally {
		await controller.dispose();
	}
});

test('controller rejects oversized macro renders before allocating or editing', async () => {
	let renderCalls = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot: async () => {
			renderCalls += 1;
			throw new Error('The oversized macro must not reach the renderer.');
		},
	});
	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;
		const frameCount = 48_000 * 60 * 20;
		controller.actions.edit.commit({
			type: 'batch',
			commands: [{
				type: 'source/add',
				source: {
					id: 'oversized-macro-source',
					name: 'oversized.wav',
					storageKey: 'oversized-macro-source',
					mimeType: 'audio/wav',
					frameCount,
					channelCount: 2,
				},
			}, {
				type: 'clip/add',
				trackId,
				clip: {
					id: 'oversized-macro-clip',
					sourceId: 'oversized-macro-source',
					timelineStartFrame: 0,
					sourceStartFrame: 0,
					durationFrames: frameCount,
				},
			}],
		});
		controller.actions.timeline.selectTrack(trackId);
		controller.actions.timeline.setSelection(0, frameCount);
		const historyBeforeRun = controller.getSnapshot().history.undoEntries.length;
		await assert.rejects(controller.actions.macros.run({
			name: 'Oversized macro',
			trackId,
			effects: [{ type: 'audacity-invert', params: {} }],
		}), /too much memory/i);
		assert.equal(renderCalls, 0);
		assert.equal(controller.getSnapshot().processingEffect, false);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyBeforeRun);
	} finally {
		await controller.dispose();
	}
});

test('controller surfaces parametric EQ processor failures and unsubscribes on disposal', async () => {
	const engine = createMemoryEngine();
	const listeners = new Set();
	let unsubscribeCalls = 0;
	engine.subscribeParametricEqErrors = (listener) => {
		listeners.add(listener);
		return () => {
			unsubscribeCalls += 1;
			listeners.delete(listener);
		};
	};
	engine.emitParametricEqError = (error) => {
		for (const listener of listeners) listener(error);
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	engine.emitParametricEqError({
		type: 'error',
		message: 'mock EQ processor failure',
		scope: 'track',
		targetId: 'track-1',
		effectId: 'track-eq',
	});
	assert.deepEqual(controller.getSnapshot().status, {
		message: 'Error: mock EQ processor failure',
		state: 'error',
	});

	await controller.dispose();
	const disposed = controller.getSnapshot();
	assert.equal(unsubscribeCalls, 1);
	assert.equal(listeners.size, 0);
	engine.emitParametricEqError({ type: 'error', message: 'late EQ processor failure' });
	assert.strictEqual(controller.getSnapshot(), disposed);
});

test('canceling an asynchronous parametric EQ selection preview prevents a late source from starting', async () => {
	const engine = createMemoryEngine();
	const renderStarted = deferred();
	const renderGate = deferred();
	let previewCreations = 0;
	let previewStarts = 0;
	engine.createParametricEqPreview = async () => {
		previewCreations += 1;
		return {
			start() { previewStarts += 1; },
			stop() {},
			disconnect() {},
		};
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot: async () => {
			renderStarted.resolve();
			await renderGate.promise;
			return new MockAudioBuffer(1, 4_800, 48_000);
		},
	});
	try {
		await controller.ready;
		installSelectionPreviewFixture(controller);
		const pending = controller.actions.effects.previewSelection({ type: 'eq' });
		await renderStarted.promise;
		assert.equal(controller.getSnapshot().processingEffect, true);

		assert.equal(controller.actions.effects.cancelPreview(), false);
		renderGate.resolve();
		assert.equal(await pending, false);
		assert.equal(previewCreations, 0);
		assert.equal(previewStarts, 0);
		assert.equal(controller.getSnapshot().effects.previewing, false);
		assert.equal(controller.getSnapshot().processingEffect, false);
	} finally {
		renderGate.resolve();
		await controller.dispose();
	}
});

test('parametric EQ selection preview errors stop the source and cannot be overwritten by a late ending', async () => {
	const engine = createMemoryEngine();
	const listeners = new Set();
	engine.subscribeParametricEqErrors = (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	engine.emitParametricEqError = (error) => {
		for (const listener of listeners) listener(error);
	};
	const preview = {
		onended: null,
		onerror: null,
		startCalls: 0,
		stopCalls: 0,
		disconnectCalls: 0,
		start() { this.startCalls += 1; },
		stop() { this.stopCalls += 1; },
		disconnect() { this.disconnectCalls += 1; },
	};
	engine.createParametricEqPreview = async () => preview;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot: async () => new MockAudioBuffer(1, 4_800, 48_000),
	});
	try {
		await controller.ready;
		installSelectionPreviewFixture(controller);
		assert.equal(await controller.actions.effects.previewSelection({ type: 'eq' }), true);
		assert.equal(preview.startCalls, 1);
		assert.equal(controller.getSnapshot().effects.previewing, true);
		const lateEnded = preview.onended;

		const error = { type: 'error', message: 'mock selection EQ processor failure' };
		engine.emitParametricEqError(error);
		preview.onerror(error);
		assert.equal(preview.stopCalls, 1);
		assert.equal(preview.disconnectCalls, 1);
		assert.equal(preview.onended, null);
		assert.equal(controller.getSnapshot().effects.previewing, false);
		assert.deepEqual(controller.getSnapshot().status, {
			message: 'Error: mock selection EQ processor failure',
			state: 'error',
		});

		lateEnded();
		assert.deepEqual(controller.getSnapshot().status, {
			message: 'Error: mock selection EQ processor failure',
			state: 'error',
		});
		assert.equal(preview.disconnectCalls, 1);
	} finally {
		await controller.dispose();
	}
});

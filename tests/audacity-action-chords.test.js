import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import {
	COPY, createMemoryEngine, createMemoryStore, createMemoryTimePitchCache,
} from './helpers/audacity-action-runtime-fixture.js';

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
const {
	createAudacityActionRuntime,
	createAudioEditorUiActionController,
} = await import('../src/common/editor/audacity-action-runtime.js');

/**
 * What an Audacity keyboard chord actually does to a running editor.
 *
 * `tests/audacity-action-runtime.test.js` proves every manifest action resolves to a
 * handler and that nothing unimplemented becomes executable. These take the resolution as
 * given and drive the handlers against a real controller, because the interesting part of
 * a chord is not that it dispatches but what it reads first — transport state, the
 * selection, which track has focus.
 */

test('4.0.0 play/stop and play-from-cursor toggles read transport state and the selection', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		copy: COPY,
	});
	await controller.ready;
	try {
		const calls = [];
		const state = {
			recording: false, recordingStarting: false, recordingScheduling: false,
			scheduledRecording: null, transportState: 'stopped', selection: { startFrame: 4800, endFrame: 96_000 },
		};
		const probe = {
			...controller,
			getSnapshot: () => ({
				...controller.getSnapshot(),
				recording: state.recording,
				recordingStarting: state.recordingStarting,
				recordingScheduling: state.recordingScheduling,
				scheduledRecording: state.scheduledRecording,
				project: { ...controller.getSnapshot().project, selection: state.selection },
			}),
			getTelemetrySnapshot: () => ({ transportState: state.transportState }),
			actions: {
				...controller.actions,
				transport: {
					...controller.actions.transport,
					playPause: () => calls.push('playPause'),
					stop: () => calls.push('stop'),
					seek: (frame) => calls.push(`seek:${frame}`),
				},
				recording: {
					...controller.actions.recording,
					stop: () => calls.push('recording.stop'),
				},
			},
		};
		const runtime = createAudacityActionRuntime(probe, { uiController: createAudioEditorUiActionController() });

		runtime.actions.transport.playStop();
		assert.deepEqual(calls, ['playPause'], 'a stopped transport starts playing');

		state.transportState = 'playing';
		runtime.actions.transport.playStop();
		assert.deepEqual(calls, ['playPause', 'stop'], 'a playing transport stops rather than pausing');

		state.transportState = 'stopped';
		state.recording = true;
		runtime.actions.transport.playStop();
		assert.deepEqual(calls, ['playPause', 'stop', 'recording.stop'], 'Space stops an active recording');
		state.recording = false;
		for (const field of ['recordingStarting', 'recordingScheduling', 'scheduledRecording']) {
			state[field] = true;
			runtime.actions.transport.playStop();
			state[field] = field === 'scheduledRecording' ? null : false;
		}
		assert.deepEqual(calls.slice(-3), ['recording.stop', 'recording.stop', 'recording.stop'], 'Space cancels every pending recording state');

		calls.length = 0;
		state.transportState = 'playing';
		runtime.actions.transport.playFromCursor();
		assert.deepEqual(calls, ['playPause'], 'a playing transport pauses without seeking');

		calls.length = 0;
		state.transportState = 'stopped';
		runtime.actions.transport.playFromCursor();
		assert.deepEqual(calls, ['seek:4800', 'playPause'], 'playback restarts at the selection start');

		calls.length = 0;
		state.selection = { startFrame: 4800, endFrame: 4800 };
		runtime.actions.transport.playFromCursor();
		assert.deepEqual(calls, ['playPause'], 'an empty selection leaves the playhead alone');
	} finally {
		await controller.dispose();
	}
});

test('shared Audacity selection chords trim a selected clip before adjusting the time selection', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		copy: COPY,
	});
	await controller.ready;
	try {
		const base = controller.getSnapshot();
		const source = { id: 'source-context', frameCount: 100 };
		const clip = {
			id: 'clip-context',
			kind: 'audio',
			sourceId: source.id,
			timelineStartFrame: 10,
			durationFrames: 20,
			sourceStartFrame: 10,
			sourceDurationFrames: 20,
		};
		const track = { ...base.project.tracks[0], type: 'audio', clipIds: [clip.id] };
		const state = {
			selectedClipId: clip.id,
			selection: { startFrame: 5, endFrame: 15, trackIds: [track.id], clipIds: [] },
			transportState: 'stopped',
		};
		const trims = [];
		const selections = [];
		const seeks = [];
		const probe = {
			...controller,
			getTelemetrySnapshot: () => ({ positionFrame: 1_000_000, transportState: state.transportState }),
			getSnapshot: () => ({
				...base,
				selectedClipId: state.selectedClipId,
				selectedTrackId: track.id,
				project: {
					...base.project,
					sources: [source],
					clips: [clip],
					tracks: [track],
					selection: state.selection,
				},
			}),
			actions: {
				...controller.actions,
				clip: {
					...controller.actions.clip,
					trim: (clipId, changes) => trims.push([clipId, changes]),
				},
				timeline: {
					...controller.actions.timeline,
					setSelection: (...args) => selections.push(args),
				},
				transport: {
					...controller.actions.transport,
					seek: (frame) => seeks.push(frame),
				},
			},
		};
		const runtime = createAudacityActionRuntime(probe, { uiController: createAudioEditorUiActionController() });

		await runtime.actions.selection.extendLeft();
		await runtime.actions.selection.extendRight();
		await runtime.actions.selection.contractLeft();
		await runtime.actions.selection.contractRight();
		assert.deepEqual(trims, [
			[clip.id, { timelineStartFrame: 0, durationFrames: 30 }],
			[clip.id, { durationFrames: 90 }],
		]);
		assert.deepEqual(selections, []);

		state.selectedClipId = null;
		await runtime.actions.selection.extendLeft();
		await runtime.actions.selection.extendRight();
		await runtime.actions.selection.contractLeft();
		await runtime.actions.selection.contractRight();
		assert.deepEqual(selections, [
			[0, 15, {}],
			[5, 415, {}],
			[15, 15, {}],
			[5, 5, {}],
		]);

		state.selection = { startFrame: 0, endFrame: 0, trackIds: [track.id], clipIds: [] };
		await runtime.actions.selection.extendLeft();
		await runtime.actions.selection.extendRight();
		assert.deepEqual(selections.slice(-2), [
			[999_600, 1_000_000, {}],
			[1_000_000, 1_000_400, {}],
		], 'an empty stopped selection extends from the live cursor rather than frame zero');

		state.selectedClipId = clip.id;
		state.transportState = 'playing';
		await runtime.actions.selection.extendLeft();
		await runtime.actions.selection.extendRight();
		assert.deepEqual(seeks, [280_000, 1_720_000], 'Shift+arrows seek by Audacity\'s 15-second long period');
		assert.equal(trims.length, 2, 'playback seeking never mutates the selected clip');

		state.selectedClipId = null;
		state.selection = { startFrame: 5, endFrame: 15, trackIds: [track.id], clipIds: [] };
		await runtime.actions.selection.contractLeft();
		await runtime.actions.selection.contractRight();
		assert.deepEqual(seeks, [280_000, 1_720_000], 'selection contraction never seeks to an undefined direction');
		assert.deepEqual(selections.slice(-2), [[15, 15, {}], [5, 5, {}]]);
	} finally {
		await controller.dispose();
	}
});

test('Audacity track-selection actions advance focus and fill a Shift+Enter range', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		copy: COPY,
	});
	await controller.ready;
	try {
		const firstTrackId = controller.getSnapshot().project.tracks[0].id;
		const secondTrackId = controller.actions.track.add({ name: 'Second' });
		const thirdTrackId = controller.actions.track.add({ name: 'Third' });
		controller.actions.timeline.selectTrack(firstTrackId);
		controller.actions.timeline.setSelection(0, 0, { trackIds: [firstTrackId] });
		const runtime = createAudacityActionRuntime(controller, { uiController: createAudioEditorUiActionController() });

		runtime.actions.navigation.extendTrackSelectionDown();
		runtime.actions.navigation.extendTrackSelectionDown();
		assert.equal(controller.getSnapshot().selectedTrackId, thirdTrackId);
		assert.deepEqual(controller.getSnapshot().project.selection.trackIds, [
			firstTrackId, secondTrackId, thirdTrackId,
		]);
		runtime.actions.navigation.extendTrackSelectionUp();
		assert.equal(controller.getSnapshot().selectedTrackId, secondTrackId);
		assert.deepEqual(controller.getSnapshot().project.selection.trackIds, [firstTrackId, secondTrackId]);

		controller.actions.timeline.setSelection(0, 0, { trackIds: [firstTrackId] });
		controller.actions.timeline.selectTrack(thirdTrackId);
		runtime.actions.navigation.rangeSelection();
		assert.deepEqual(controller.getSnapshot().project.selection.trackIds, [
			firstTrackId, secondTrackId, thirdTrackId,
		]);
	} finally {
		await controller.dispose();
	}
});

test('restoring the default layout re-applies the active built-in workspace', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		copy: COPY,
	});
	await controller.ready;
	try {
		const applied = [];
		const state = { activeId: 'audacity' };
		const probe = {
			...controller,
			getSnapshot: () => {
				const snapshot = controller.getSnapshot();
				return {
					...snapshot,
					preferences: { ...snapshot.preferences, workspace: { ...snapshot.preferences.workspace, activeId: state.activeId } },
				};
			},
			actions: {
				...controller.actions,
				preferences: {
					...controller.actions.preferences,
					setWorkspace: (workspaceId) => { applied.push(workspaceId); },
				},
			},
		};
		const runtime = createAudacityActionRuntime(probe, { uiController: createAudioEditorUiActionController() });
		runtime.actions.workspace.restoreDefault();
		assert.deepEqual(applied, ['audacity'], 'the Audacity preset is restored rather than Soundscaper');
		state.activeId = 'classic';
		runtime.actions.workspace.restoreDefault();
		assert.deepEqual(applied, ['audacity', 'classic']);
		state.activeId = '';
		runtime.actions.workspace.restoreDefault();
		assert.deepEqual(applied, ['audacity', 'classic', 'modern'], 'a missing id falls back to the Soundscaper preset');
		runtime.dispose();
	} finally {
		await controller.dispose();
	}
});

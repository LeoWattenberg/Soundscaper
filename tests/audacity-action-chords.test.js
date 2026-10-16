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
const { createCurrentAudioEditorProject } = await import('../src/common/editor/project-current.ts');
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
			engine: { getPositionFrames: () => 12_345 },
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

		await runtime.actions.transport.playStop();
		assert.deepEqual(calls, ['playPause'], 'a stopped transport starts playing');

		state.transportState = 'playing';
		await runtime.actions.transport.playStop();
		assert.deepEqual(calls, ['playPause', 'stop'], 'a playing transport uses the same Stop action as the toolbar');

		state.transportState = 'stopped';
		state.recording = true;
		await runtime.actions.transport.playStop();
		assert.deepEqual(calls, ['playPause', 'stop', 'recording.stop'], 'Space stops an active recording');
		state.recording = false;
		for (const field of ['recordingStarting', 'recordingScheduling', 'scheduledRecording']) {
			state[field] = true;
			await runtime.actions.transport.playStop();
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

test('Audacity selection chords edit time boundaries while preserving selected clips and the playhead', async () => {
	let positionFrame = 20_000;
	let transportState = 'stopped';
	const seeks = [];
	const engine = {
		...createMemoryEngine(),
		getPositionFrames: () => positionFrame,
		getState: () => ({ state: transportState, loop: { enabled: false } }),
		seek: (frame) => { seeks.push(frame); positionFrame = frame; return frame; },
	};
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine,
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		copy: COPY,
	});
	await controller.ready;
	try {
		const project = createCurrentAudioEditorProject({
			id: 'selection-chords', title: 'Selection chords',
			sources: [{
				id: 'source', storageKey: 'source', name: 'source.wav', mimeType: 'audio/wav',
				frameCount: 48_000, channelCount: 1, sampleRate: 48_000,
				originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
			}],
			tracks: [{ id: 'audio', type: 'audio', name: 'Audio', clipIds: ['clip'] }],
			clips: [{
				id: 'clip', sourceId: 'source', title: 'Clip', timelineStartFrame: 4_800,
				durationFrames: 9_600, sourceStartFrame: 4_800, sourceDurationFrames: 9_600,
			}],
		});
		await store.saveProject(project);
		await controller.actions.project.open(project);
		const originalClip = structuredClone(controller.getSnapshot().project.clips[0]);
		const runtime = createAudacityActionRuntime(controller, { uiController: createAudioEditorUiActionController() });
		const selection = () => {
			const range = controller.getSnapshot().project.selection;
			return [range.startFrame, range.endFrame];
		};
		controller.actions.timeline.setZoom(120);
		controller.actions.timeline.selectClip(originalClip.id);
		controller.actions.transport.seek(20_000);
		seeks.length = 0;

		runtime.actions.selection.extendLeft();
		assert.deepEqual(selection(), [4_400, 14_400]);
		runtime.actions.selection.extendRight();
		assert.deepEqual(selection(), [4_400, 14_800]);
		runtime.actions.selection.contractLeft();
		assert.deepEqual(selection(), [4_800, 14_800]);
		runtime.actions.selection.contractRight();
		assert.deepEqual(selection(), [4_800, 14_400]);
		assert.deepEqual(controller.getSnapshot().project.selection.clipIds, []);
		assert.deepEqual(controller.getSnapshot().project.selection.trackIds, ['audio']);
		assert.deepEqual(controller.getSnapshot().project.clips[0], originalClip);
		assert.equal(positionFrame, 20_000);
		assert.deepEqual(seeks, []);

		transportState = 'playing';
		runtime.actions.navigation.extendItemLeft();
		runtime.actions.navigation.extendItemRight();
		assert.deepEqual(selection(), [4_400, 14_800]);
		runtime.actions.navigation.reduceItemRight();
		runtime.actions.navigation.reduceItemLeft();
		assert.deepEqual(selection(), [4_800, 14_400]);
		assert.equal(positionFrame, 20_000);
		assert.equal(transportState, 'playing');
		assert.deepEqual(seeks, [], 'selection chords leave running playback at its current position');
		assert.deepEqual(controller.getSnapshot().project.clips[0], originalClip);

		transportState = 'stopped';
		controller.actions.timeline.clearSelection();
		runtime.actions.selection.extendLeft();
		assert.deepEqual(selection(), [19_600, 20_000]);
		runtime.actions.selection.extendRight();
		assert.deepEqual(selection(), [19_600, 20_400]);
		assert.equal(positionFrame, 20_000);
		assert.deepEqual(seeks, [], 'an absent range seeds from the playhead without moving it');
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

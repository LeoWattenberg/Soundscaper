/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createProjectMutationService } from '../src/common/editor/controller/project-mutation-service.ts';
import {
	createProjectRetentionService,
	type RetentionHistory,
	type RetentionProject,
} from '../src/common/editor/controller/project-retention-service.ts';
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';
import { createTakeCycleAppComposition } from '../src/common/editor/controller/take-cycle-app-composition.ts';
import type { TakeCyclePublicationSession } from '../src/common/editor/controller/take-cycle-current-project-publication-service.ts';
import type { TakeCyclePublicationHistory } from '../src/common/editor/controller/take-cycle-current-project-publication-service.ts';
import { createTakeCycleRecordingAppSession } from '../src/common/editor/controller/take-cycle-recording-app-session.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type {
	RecordingControllerFactoryOptions,
	RecordingRoute,
	RecordingSelection,
} from '../src/common/editor/controller/recording-transaction-types.ts';
import type { TakeCycleRoutedCaptureProject } from '../src/common/editor/controller/take-cycle-routed-capture-types.ts';
import { createEditorHistory, executeEditorCommand } from '../src/common/editor/history.js';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17, type AudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { createProjectStore } from '../src/common/editor/storage.js';

type SettlementProject = AudioEditorProjectV17 & TakeCycleRoutedCaptureProject & {
	readonly clips: readonly Readonly<{ readonly id: string }>[];
	readonly sources: readonly Readonly<{ readonly id: string; readonly kind?: 'audio' | 'video' }>[];
	readonly tracks: readonly Readonly<{ readonly id: string; readonly type: string }>[];
	readonly takeGroups: readonly (AudioEditorProjectV17['takeGroups'][number] & {
		readonly takes: readonly Readonly<{ readonly sourceId: string }>[];
	})[];
};
type SettlementHistory = TakeCyclePublicationHistory & {
	readonly present: SettlementProject;
	readonly undoStack: readonly Readonly<{
		readonly project: SettlementProject;
		readonly command: AudioEditorCommand;
	}>[];
	readonly redoStack: readonly Readonly<{
		readonly project: SettlementProject;
		readonly command: AudioEditorCommand;
	}>[];
};

const NOW = '2026-08-12T12:00:00.000Z';
const PROJECT_ID = 'cycle-current-project-settlement';
const TRACK_ID = 'track-cycle';

test('selection clear settles through the production current-project cycle path and remains cleared on repeat', async () => {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: uniqueName(),
	});
	try {
		const base = createAudioEditorProjectV17({
			id: PROJECT_ID, title: 'Cycle settlement', now: NOW,
			selection: { startFrame: 100, endFrame: 108 },
			loop: { enabled: true, startFrame: 100, endFrame: 108 },
			tracks: [createAudioTrackV10({ id: TRACK_ID, name: 'Vocal', clipIds: [], armed: true })],
			sequences: [{ id: 'main-sequence', trackIds: [TRACK_ID] }],
			primarySequenceId: 'main-sequence',
		}) as SettlementProject;
		await store.projectRepository!.save(base);
		const session = createAudioEditorSessionController();
		session.openProject(base, { history: createEditorHistory(base), dirty: false });
		let project = base;
		let history = session.getProjectHistory(PROJECT_ID) as unknown as SettlementHistory;
		const state = {
			readOnly: false,
			history,
			selectedTrackId: TRACK_ID,
			selectedClipId: null,
			projectBinPreview: null,
			recordingRouting: { routes: {
				[TRACK_ID]: { kind: 'device' as const, deviceId: 'mic', channelStart: 0, channelCount: 1 },
			} as Readonly<Record<string, RecordingRoute>> },
			recordingRouteHealth: {} as Record<string, string>,
			clipboard: null,
			recordingSourceId: null,
			autosaveTimer: 0,
			saveGeneration: 0,
			pendingSaveSnapshots: new Set<SettlementProject>(),
			saveQueue: Promise.resolve() as Promise<unknown>,
			saveState: 'saved',
			monitoring: false,
			recordingInputGain: 1,
		};
		const retention = createProjectRetentionService<RetentionProject, RetentionHistory<RetentionProject>>({
			state: state as unknown as {
				history: RetentionHistory<RetentionProject> | null;
				readonly clipboard: null;
				readonly readOnly: boolean;
				readonly recordingSourceId: null;
			},
			getProject: () => project as unknown as RetentionProject,
			setProject: (value) => { project = value as unknown as SettlementProject; },
			compactHistory: (value) => value,
			sessionTab: (projectId) => session.getSnapshot().tabs.find(
				(tab: { projectId: string }) => tab.projectId === projectId,
			) as unknown as {
				readonly dirty: boolean;
				readonly history: RetentionHistory<RetentionProject>;
			} | null,
			updateProjectHistory: (projectId, value, options) => {
				session.updateProjectHistory(projectId, value, options);
			},
			getSourceReferenceCounts: () => session.getSourceReferenceCounts(),
			getSessionTabs: () => session.getSnapshot().tabs,
			editorHistoryProjects: (value) => [value.present],
			allProjectClips: (value) => (value as unknown as {
				readonly clips: readonly Readonly<{ readonly id: string }>[];
			}).clips,
			clipCache: {}, sourceBuffers: new Map(), sourcePeaks: new Map(),
			evictSourceCaches: () => undefined,
		});
		const saves = createProjectSaveService({
			state,
			getProject: () => project,
			hasHistory: () => Boolean(state.history),
			isReadOnly: () => false,
			cloneProject: (value) => structuredClone(value),
			admitProjectPublication: async () => undefined,
			saveProject: (snapshot, options) => store.saveProject(snapshot, options),
			persistActiveProjectId: async () => undefined,
			isCurrentProject: (projectId) => project.id === projectId,
			hasSessionTab: (projectId) => session.getSnapshot().tabs.some(
				(tab: { projectId: string }) => tab.projectId === projectId,
			),
			markProjectSaved: (projectId) => { session.markProjectSaved(projectId); },
			publish: () => undefined, garbageCollect: async () => undefined,
			refreshStorageUsage: async () => undefined,
			handleError: (error) => { throw error; },
		});
		const mutation = createProjectMutationService<
			SettlementProject, SettlementHistory, typeof state.recordingRouting, number, number
		>({
			lifetime: { capture: () => 1, assertActive: () => undefined },
			state, productName: 'Soundscaper',
			capabilities: {
				audioEffects: true, audioRecording: true, audioSpectralEditing: true,
				audioWarp: true, takeComp: true,
				timelineAnnotations: true, videoEffects: true, trackFolders: true,
			},
			projectReadOnlyMessage: 'Project is read-only.',
			getProject: () => project,
			setProject: (value) => { if (value) project = value; },
			getHistory: () => history,
			setHistory: (value) => { history = value; state.history = value; },
			executeEditorCommand: (value, command) => executeEditorCommand(value, command) as unknown as SettlementHistory,
			applyEditorCommand: (value, command) => applyEditorCommand(value, command) as SettlementProject,
			retention: {
				compactLiveSourceState: (dirty) => retention.compactLiveSourceState(dirty),
				retainLiveClipIds: () => retention.retainLiveClipIds(),
				synchronizeLiveHistory: (value) => retention.synchronizeLiveHistory(
					value as unknown as RetentionHistory<RetentionProject>,
				) as unknown as SettlementHistory,
			},
			publisher: { publishProjectState: () => undefined },
			saves,
			stopProjectBinPreview: () => undefined, clearWaveformPcmWindows: () => undefined,
			normalizeRecordingRouting: (value) => value,
			persistRecordingRouting: async () => undefined,
			findClip: () => null,
			findTrack: (value, trackId) => value.tracks.find((track) => track.id === trackId) as {
				readonly id: string; readonly type: string;
			} | undefined ?? null,
			synchronizeMicrophoneMeterTarget: () => undefined,
			synchronizeAnnotationFocus: () => undefined,
			getPlaybackState: () => 'stopped', projectHasTimePitchClips: () => false,
			beginPlaybackCachePreparation: async () => undefined,
			applyProjectToPlaybackEngine: async () => undefined,
			captureProject: () => 1, assertProject: () => undefined,
			handleError: (error) => { throw error; }, isExpectedCancellation: () => false,
		});

		mutation.updateSelection({
			type: 'selection/set', startFrame: 0, endFrame: 0,
			trackIds: [], clipIds: [], annotationIds: [], frequencyRange: null,
		});
		assert.equal(session.getSnapshot().tabs[0]!.dirty, false);
		assert.equal(session.getProjectHistory(PROJECT_ID).present.selection.endFrame, 0);
		const durableBeforeCycle = await store.projectRepository!.load(PROJECT_ID) as SettlementProject;
		assert.equal((durableBeforeCycle.selection as unknown as RecordingSelection).endFrame, 108,
			'the selection-only edit is not durable until cycle preflight');

		const lifetime = new EditorControllerLifetime();
		lifetime.markReady();
		const projectGeneration = new EditorProjectGeneration();
		projectGeneration.activate(PROJECT_ID);
		const captures: Capture[] = [];
		const ids = new Map<string, number>();
		const stream = {
			getAudioTracks: () => [{ readyState: 'live', getSettings: () => ({ channelCount: 1 }) }],
			getTracks: () => [],
		};
		const cycle = createTakeCycleAppComposition({
			lifetime, store, session: session as unknown as TakeCyclePublicationSession, projectGeneration, state,
			recording: {
				capturePool: { acquireHardware: async () => stream, acquireDisplay: async () => stream },
				engine: {
					getAudioContext: async () => ({ sampleRate: 48_000, currentTime: 1, resume: async () => undefined }),
					setLoop() {}, seek() {}, playAt: async () => 1, pause() {},
				},
				sourceChunkFrames: 4, streamAudioChannelCount: () => 1,
				recordingStreamIsLive: () => true,
				createRecorder: async (options) => captureRecorder(options, captures),
				beginPlaybackCachePreparation: async () => undefined,
				handleError: (error) => { throw error; },
			},
			getProject: () => project, setProject: (value) => { project = value as SettlementProject; },
			activeSelection: (value) => {
				const selection = value.selection as unknown as RecordingSelection;
				return selection.endFrame > selection.startFrame ? selection : null;
			},
			findAudioSource: (value, mediaId) => value.sources.find(({ id }) => id === mediaId) as {
				readonly id: string; readonly kind: 'audio'; readonly storageKey?: string;
			} | undefined ?? null,
			trackName: () => 'Vocal', getRoutes: () => state.recordingRouting.routes,
			soundActivationEnabled: () => false,
			recordingRouteSourceKey: ({ deviceId }) => `device:${deviceId}`,
			createId: (prefix) => nextId(ids, prefix), createRecordingName: () => 'Cycle take',
			preflightRecording: async () => undefined, releaseInputs: () => undefined,
			activateStoredSource: async () => undefined, publishProject: () => undefined,
			synchronizeProject: () => undefined, now: () => NOW,
		});
		const recording = createTakeCycleRecordingAppSession({
			cycle, prepareCurrentProject: () => saves.flushProject(),
			recordingMessage: 'Recording', setTransportState: () => undefined, setStatus: () => undefined,
		});
		await recordPass(recording, captures, 1);
		await assertSettled(1);
		await recordPass(recording, captures, 2);
		await assertSettled(2);

		async function assertSettled(expectedTakes: number): Promise<void> {
			const persisted = await store.projectRepository!.load(PROJECT_ID) as SettlementProject;
			assert.equal(persisted.selection.endFrame, 0);
			assert.equal(persisted.takeGroups[0]?.takes.length, expectedTakes);
			assert.equal(state.history?.undoStack.length, expectedTakes);
			assert.equal(state.history?.undoStack.at(-1)?.project.selection.endFrame, 0);
			assert.equal(serializeScapeProjectDocument(project), serializeScapeProjectDocument(persisted));
			assert.equal(
				serializeScapeProjectDocument(session.getProjectHistory(PROJECT_ID).present),
				serializeScapeProjectDocument(persisted),
			);
			assert.equal(await store.takeCycleRecoveryEnvelopeRepository!.load(PROJECT_ID), null);
			assert.deepEqual(await store.rawPcmSpoolRepository!.list(PROJECT_ID), []);
		}
	} finally {
		await store.close();
	}
});

interface Capture {
	readonly options: RecordingControllerFactoryOptions;
	startFrame: number | null;
}

function captureRecorder(options: RecordingControllerFactoryOptions, captures: Capture[]) {
	const capture: Capture = { options, startFrame: null };
	captures.push(capture);
	return {
		start(value: Readonly<{ readonly startFrame?: number }>) { capture.startFrame = value.startFrame ?? null; },
		pause: () => false, resume: () => false, stop: async () => undefined,
		dispose: async () => undefined, setMonitoring() {}, setInputGain() {},
	};
}

async function recordPass(
	recording: ReturnType<typeof createTakeCycleRecordingAppSession>,
	captures: Capture[],
	generation: number,
): Promise<void> {
	const controller = await recording.begin({ generation, projectId: PROJECT_ID, assertCurrent() {} });
	const capture = captures.at(-1)!;
	assert.notEqual(capture.startFrame, null);
	await capture.options.onChunk({
		frameStart: capture.startFrame!, frames: 8,
		channels: [Float32Array.of(0.125, 0.25, 0.5, 0.75, -0.125, -0.25, -0.5, -0.75)],
	});
	await controller.stop();
}

function nextId(ids: Map<string, number>, prefix: string): string {
	const next = (ids.get(prefix) ?? 0) + 1;
	ids.set(prefix, next);
	return `${prefix}-${String(next)}`;
}

function uniqueName(): string {
	return `cycle-current-project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

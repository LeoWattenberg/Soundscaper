/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectFeatureAffectedObjects } from '../project-feature-affected-objects.ts';
import type { ProjectFeatureRequirementsReport } from '../project-feature-requirements.ts';
import type { EditorStoreStatus } from '../storage/status.ts';
import type { StorageCapacitySnapshot } from './storage-capacity-service.ts';
import { createDocumentTimelineAnnotationSnapshot } from './document-timeline-annotation-snapshot.ts';
import { createDocumentTrackFolderSnapshot } from './document-track-folder-snapshot.ts';
import { createDocumentRecordingInputSnapshot } from './document-recording-input-snapshot.ts';
import type { SoundActivationPolicySnapshot } from './sound-activation-policy-service.ts';

interface SnapshotSelection extends Readonly<Record<string, unknown>> {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface SnapshotProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly selection?: SnapshotSelection | null;
}

interface SnapshotProjectSummary extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

interface SnapshotHistory {
	readonly undoStack: readonly unknown[];
	readonly redoStack: readonly unknown[];
}

interface SnapshotPreferences extends Readonly<Record<string, unknown>> {
	readonly playback?: Readonly<{ playAtSpeedMode?: string }>;
	readonly recording: Readonly<{ retainInputs: boolean }>;
}

interface TimedRecordingSnapshot {
	readonly startTimeMs: number;
	readonly options: Readonly<{ trackId?: string }>;
}

interface ProjectTabSnapshot {
	readonly projectId: string;
	readonly title: string;
	readonly dirty: boolean;
	readonly readOnly: boolean;
}

interface CurrentTabMetadata {
	readonly aup4CompatibilityReport?: unknown;
	readonly aup4CompatibilityReportDismissed?: boolean;
	readonly featureRequirementsReport?: unknown;
	readonly featureRequirementsReadOnly?: boolean;
	readonly featureRequirementsAudioEffectPlaybackBypass?: unknown;
	readonly featureRequirementsAudioRenderedFallback?: unknown;
	readonly featureRequirementsVideoEffectPlaybackBypass?: unknown;
	readonly featureRequirementsVideoRenderedFallback?: unknown;
}

export interface EditorDocumentSnapshotState {
	readonly phase: string;
	readonly projects: readonly SnapshotProjectSummary[];
	readonly recentProjectIds: readonly string[];
	readonly preferences: SnapshotPreferences;
	readonly preferencesReadOnly: boolean;
	readonly selectedTrackId: string | null;
	readonly selectedClipId: string | null;
	readonly selectedAnnotationId: string | null;
	readonly transportState: string;
	readonly projectBinPreview: Readonly<Record<string, unknown>> | null;
	readonly playAtSpeedRate: number;
	readonly playAtSpeedAbort: unknown;
	readonly readOnly: boolean;
	readonly projectLock: Readonly<{ readOnly?: boolean }> | null;
	readonly importing: boolean;
	readonly recordingStarting: boolean;
	readonly timedRecordingPreparing: boolean;
	readonly timedRecording: TimedRecordingSnapshot | null;
	readonly timedRecordingCancelling: boolean;
	readonly recorder: unknown;
	readonly recordingPreview: unknown;
	readonly recordingPreviews: readonly unknown[];
	readonly recordingDevices: readonly unknown[];
	readonly recordingRouting: Readonly<{
		readonly routes: unknown;
		readonly offsets: unknown;
	}>;
	readonly recordingRouteHealth: Readonly<Record<string, unknown>>;
	readonly recordingPoolSources: readonly unknown[];
	readonly audacityEffectProcessing: boolean;
	readonly exportAbort: unknown;
	readonly timelineView: string;
	readonly showRms: boolean;
	readonly showVerticalRulers: boolean;
	readonly updateDisplayWhilePlaying: boolean;
	readonly pinnedPlayhead: boolean;
	readonly playbackOnRulerClick: boolean;
	readonly pixelsPerSecond: number;
	readonly timelineWidth: number;
	readonly autoFitTrackHeight: boolean;
	readonly sampleEditMode: unknown;
	readonly sampleEditProcessing: boolean;
	readonly history: SnapshotHistory | null;
	readonly clipboard: unknown;
	readonly status: Readonly<{ message: string; state: string }>;
	readonly saveState: string;
	readonly storageEstimate: Readonly<StorageCapacitySnapshot>;
	readonly analysisResult: unknown;
	readonly analysisVisuals: unknown;
	readonly analysisReport: unknown;
	readonly analysisProcessing: boolean;
	readonly exportProgress: number;
	readonly exportOutput: unknown;
	readonly effectClipboard: unknown;
	readonly audacityEffectType: string;
	readonly audacityControlTrackId: string | null;
	readonly audacityNoiseProfile: unknown;
	readonly lastAudacityEffect: unknown;
	readonly lastGeneratorRequest?: unknown;
	readonly lastAnalysisRequest?: unknown;
	readonly audacityPreviewSource: unknown;
	readonly effectPresets: unknown;
	readonly nyquistAbort: unknown;
	readonly nyquistResult: unknown;
	readonly monitoring: boolean;
	readonly microphoneMetering: boolean;
	readonly latencyOffsetMs: number;
	readonly recordingPaused: boolean;
	readonly leadInRecording: boolean;
	readonly metronomeEnabled: boolean;
	readonly recordingInputGain: number;
	readonly selectionFollowsLoop: boolean;
	readonly missingSourceIds: ReadonlySet<string>;
	readonly disposed: boolean;
}

export interface EditorDocumentSnapshotRuntime<Project extends SnapshotProject> {
	readonly state: EditorDocumentSnapshotState;
	readonly product: unknown;
	readonly productId: string;
	readonly capabilities: unknown;
	readonly locale: string;
	getCurrentProject(): Project | null;
	projectForPlayback(project: Project): Project;
	getProjectTabs(): readonly ProjectTabSnapshot[];
	getCurrentTabMetadata(projectId: string): CurrentTabMetadata;
	recordingPreviewSnapshot(preview: unknown): unknown;
	getAudioDevicesSnapshot(): unknown;
	getSoundActivationSnapshot(): SoundActivationPolicySnapshot;
	sampleEditingAvailable(): boolean;
	canUndo(history: SnapshotHistory): boolean;
	canRedo(history: SnapshotHistory): boolean;
	historyEntrySummary(entry: unknown): unknown;
	getStorageStatus(): EditorStoreStatus;
	getRackEffectTypes(): readonly unknown[];
	getVideoEffectTypes(): readonly unknown[];
	getVideoNavigationSnapshot?(): unknown;
	getSelectionEffectTypes(): readonly unknown[];
	getSelectionEffectParams(): unknown;
	getSelectionEffectDefinition(): unknown;
	getEffectPresets(): readonly unknown[];
}

/** Assemble the immutable, UI-facing document snapshot from explicit ports. */
export function createEditorDocumentSnapshot<Project extends SnapshotProject>(
	runtime: EditorDocumentSnapshotRuntime<Project>,
) {
	const { state } = runtime;
	const currentProject = runtime.getCurrentProject();
	const currentTabMetadata = currentProject
		? runtime.getCurrentTabMetadata(currentProject.id)
		: {};
	const videoPreviewProject = currentProject && currentTabMetadata.featureRequirementsVideoRenderedFallback
		? runtime.projectForPlayback(currentProject)
		: currentProject;
	const selection = currentProject?.selection
		&& currentProject.selection.endFrame > currentProject.selection.startFrame
		? currentProject.selection
		: null;
	const history = state.history;
	return Object.freeze({
		product: runtime.product,
		productId: runtime.productId,
		capabilities: runtime.capabilities,
		ready: state.phase === 'ready',
		phase: state.phase,
		headless: true,
		locale: runtime.locale,
		project: currentProject,
		videoPreviewProject,
		videoNavigation: runtime.getVideoNavigationSnapshot?.() ?? null,
		projects: state.projects,
		recentProjects: Object.freeze(state.recentProjectIds
			.map((projectId) => state.projects.find((candidate) => candidate.id === projectId))
			.filter((candidate): candidate is SnapshotProjectSummary => Boolean(candidate))),
		projectTabs: Object.freeze(runtime.getProjectTabs().map((tab) => Object.freeze({
			id: tab.projectId,
			title: tab.title,
			dirty: tab.dirty,
			readOnly: tab.readOnly,
		}))),
		preferences: state.preferences,
		preferencesReadOnly: state.preferencesReadOnly,
		selectedTrackId: state.selectedTrackId,
		selectedClipId: state.selectedClipId,
		selectedAnnotationId: state.selectedAnnotationId,
		timelineAnnotations: createDocumentTimelineAnnotationSnapshot(currentProject),
		trackFolders: createDocumentTrackFolderSnapshot(currentProject),
		selection,
		transportState: state.transportState,
		projectBinPreview: state.projectBinPreview
			? Object.freeze({ ...state.projectBinPreview })
			: null,
		playbackOptions: Object.freeze({
			rate: state.playAtSpeedRate,
			mode: state.preferences.playback?.playAtSpeedMode || 'naive',
			preparing: Boolean(state.playAtSpeedAbort),
		}),
		readOnly: state.readOnly,
		lockReadOnly: Boolean(state.projectLock?.readOnly),
		importing: state.importing,
		recordingStarting: state.recordingStarting,
		recordingScheduling: state.timedRecordingPreparing,
		scheduledRecording: state.timedRecording
			? Object.freeze({
				startTimeMs: state.timedRecording.startTimeMs,
				startTime: new Date(state.timedRecording.startTimeMs).toISOString(),
				trackId: state.timedRecording.options.trackId || null,
			})
			: null,
		recording: Boolean(state.recorder && !state.timedRecording && !state.timedRecordingCancelling),
		recordingPreview: runtime.recordingPreviewSnapshot(state.recordingPreview),
		recordingPreviews: Object.freeze(state.recordingPreviews
			.map(runtime.recordingPreviewSnapshot)
			.filter(Boolean)),
		recordingInputs: createDocumentRecordingInputSnapshot(
			state,
			runtime.getSoundActivationSnapshot(),
		),
		audioDevices: runtime.getAudioDevicesSnapshot(),
		processingEffect: state.audacityEffectProcessing,
		exporting: Boolean(state.exportAbort),
		timeline: Object.freeze({
			view: state.timelineView,
			showRms: state.showRms,
			showVerticalRulers: state.showVerticalRulers,
			updateDisplayWhilePlaying: state.updateDisplayWhilePlaying,
			pinnedPlayhead: state.pinnedPlayhead,
			playbackOnRulerClick: state.playbackOnRulerClick,
			pixelsPerSecond: state.pixelsPerSecond,
			width: state.timelineWidth,
			autoFitTrackHeight: state.autoFitTrackHeight,
		}),
		sampleEdit: Object.freeze({
			available: runtime.sampleEditingAvailable(),
			mode: state.sampleEditMode,
			processing: state.sampleEditProcessing,
		}),
		history: Object.freeze({
			canUndo: Boolean(history && runtime.canUndo(history)),
			canRedo: Boolean(history && runtime.canRedo(history)),
			hasClipboard: Boolean(state.clipboard),
			undoEntries: Object.freeze((history?.undoStack || []).slice(-20).reverse()
				.map(runtime.historyEntrySummary)),
			redoEntries: Object.freeze((history?.redoStack || []).slice(-20).reverse()
				.map(runtime.historyEntrySummary)),
		}),
		status: Object.freeze({ ...state.status }),
		save: Object.freeze({ state: state.saveState }),
		aup4Compatibility: currentTabMetadata.aup4CompatibilityReport
			? Object.freeze({
				report: currentTabMetadata.aup4CompatibilityReport,
				dismissed: Boolean(currentTabMetadata.aup4CompatibilityReportDismissed),
			})
			: null,
		featureRequirementsCompatibility: currentTabMetadata.featureRequirementsReport ?? null,
		featureRequirementsReadOnly: Boolean(currentTabMetadata.featureRequirementsReadOnly),
		// Derived from the live project rather than activation-time metadata, so the
		// affected-object list stays correct after edits. Availability is fixed by the
		// runtime; only the set of affected objects changes as the project is edited.
		featureRequirementsAffectedObjects: currentProject
			? projectFeatureAffectedObjects(
				currentProject,
				(currentTabMetadata.featureRequirementsReport ?? null) as
					ProjectFeatureRequirementsReport | null,
			)
			: null,
		audioEffectPlaybackBypass: currentTabMetadata.featureRequirementsAudioEffectPlaybackBypass ?? null,
		audioRenderedFallback: currentTabMetadata.featureRequirementsAudioRenderedFallback ?? null,
		videoEffectPlaybackBypass: currentTabMetadata.featureRequirementsVideoEffectPlaybackBypass ?? null,
		videoRenderedFallback: currentTabMetadata.featureRequirementsVideoRenderedFallback ?? null,
		storage: Object.freeze({ ...state.storageEstimate, ...runtime.getStorageStatus() }),
		analysis: state.analysisResult,
		analysisVisuals: state.analysisVisuals,
		analysisReport: state.analysisReport,
		analysisProcessing: state.analysisProcessing,
		analysisRepeatable: Boolean(state.lastAnalysisRequest),
		export: Object.freeze({ progress: state.exportProgress, output: state.exportOutput }),
		effects: Object.freeze({
			rackTypes: Object.freeze(runtime.getRackEffectTypes()),
			videoTypes: Object.freeze(runtime.getVideoEffectTypes()),
			hasStackClipboard: state.effectClipboard !== null,
			selectionTypes: Object.freeze(runtime.getSelectionEffectTypes()),
			selectionType: state.audacityEffectType,
			selectionParams: runtime.getSelectionEffectParams(),
			selectionDefinition: runtime.getSelectionEffectDefinition(),
			controlTrackId: state.audacityControlTrackId,
			noiseProfileReady: Boolean(state.audacityNoiseProfile),
			canRepeatLast: Boolean(state.lastAudacityEffect),
			previewing: Boolean(state.audacityPreviewSource),
			presets: runtime.getEffectPresets(),
		}),
		generators: Object.freeze({ canRepeatLast: Boolean(state.lastGeneratorRequest) }),
		nyquist: Object.freeze({
			processing: Boolean(state.nyquistAbort),
			result: state.nyquistResult,
		}),
		monitor: Object.freeze({
			enabled: state.monitoring,
			metering: state.microphoneMetering,
			latencyOffsetMs: state.latencyOffsetMs,
		}),
		recordingOptions: Object.freeze({
			paused: state.recordingPaused,
			leadIn: state.leadInRecording,
			metronome: state.metronomeEnabled,
			inputGain: state.recordingInputGain,
		}),
		loopOptions: Object.freeze({ selectionFollows: state.selectionFollowsLoop }),
		missingSourceIds: Object.freeze([...state.missingSourceIds]),
		disposed: state.disposed,
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorControllerPhase } from '../../shared/lifecycle.ts';
import { createControllerDocumentState, type ControllerDocumentState } from '../../document/document-state.ts';
import { exposeOwnedFields } from '../../shared/owned-state.ts';
import { createControllerRecordingState, type ControllerRecordingState } from '../../recording/recording-state.ts';
import { createControllerTransportState, type ControllerTransportState } from '../../transport/transport-state.ts';
import { createControllerEffectsState, type ControllerEffectsState } from '../../effects/effects-state.ts';
import type { ControllerRuntimeHistory, ControllerRuntimeProject } from '../../document/project-runtime.ts';
import { createLocalDiagnosticsErrorJournal } from '../../../local-diagnostics-error-journal.ts';
import { createInitialStorageCapacitySnapshot } from '../../shared/storage-capacity-service.ts';
import { createDeliveryPresetState } from '../../../delivery-preset-store.ts';
import type { ControllerWorkspaceState } from '../workspace-state-types.ts';

export interface EditorControllerStateOptions<Preferences, RecordingRouting, EffectPresets,
	Project = ControllerRuntimeProject, History extends { readonly present: Project } = ControllerRuntimeHistory & { readonly present: Project },
> {
	readonly document?: ControllerDocumentState<Project, History>;
	readonly recording?: ControllerRecordingState<RecordingRouting>;
	readonly transport?: ControllerTransportState;
	readonly effects?: ControllerEffectsState<EffectPresets>;
	readonly preferences: Preferences;
	readonly recordingRouting: RecordingRouting;
	readonly effectPresets: EffectPresets;
	readonly initialEffectType: string;
	readonly phase: EditorControllerPhase;
	readonly readyMessage: string;
	readonly mobile: boolean;
	readonly defaultPixelsPerSecond: number;
	readonly timelineMinimumSeconds: number;
	readonly recordingInputGain: number;
	readonly preferredInputDeviceId: string;
}

/**
 * Creates all mutable controller state in one place. Keeping initialization out
 * of the composition root makes additions visible in review and gives tests a
 * deterministic state model without booting storage, workers, or Web Audio.
 */
export function createEditorControllerState<Preferences, RecordingRouting, EffectPresets,
	Project = ControllerRuntimeProject, History extends { readonly present: Project } = ControllerRuntimeHistory & { readonly present: Project },
>({
	document = createControllerDocumentState<Project, History>(),
	preferences,
	recordingRouting,
	effectPresets,
	initialEffectType,
	phase,
	readyMessage,
	mobile,
	defaultPixelsPerSecond,
	timelineMinimumSeconds,
	recordingInputGain,
	preferredInputDeviceId,
	recording = createControllerRecordingState({ recordingRouting, recordingInputGain, preferredInputDeviceId }),
	transport = createControllerTransportState(),
	effects = createControllerEffectsState({ effectPresets, initialEffectType }),
}: EditorControllerStateOptions<Preferences, RecordingRouting, EffectPresets, Project, History>) {
	const workspace: Omit<
		ControllerWorkspaceState<Preferences, EffectPresets, History>,
		keyof ControllerEffectsState<EffectPresets>
	> = {
		localDiagnostics: createLocalDiagnosticsErrorJournal(),
		get history() { return document.history; },
		set history(value) { document.history = value; },
		preferences,
		preferencesReadOnly: false,
		selectedTrackId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
		clipboard: null,
		pixelsPerSecond: defaultPixelsPerSecond,
		allowBelowProjectFitZoom: false,
		timelineViewportWidth: 0,
		autoFitTrackHeight: true,
		visibleTrackHeights: {},
		mobile,
		timelineWidth: timelineMinimumSeconds * defaultPixelsPerSecond,
		timelineView: 'waveform',
		readOnly: false,
		writeAuthorityGeneration: 0,
		takeCycleRecovery: null,
		takeCycleRecoveryInspecting: false,
		projectLock: null,
		projectLockRetryTimer: 0,
		sourceGcTimer: 0,
		importing: false,
		projectBinPreview: null,
		exportAbort: null,
		exportGeneration: 0,
		outputUrl: null,
		outputCleanup: null,
		projectQueue: Promise.resolve(),
		missingSourceIds: new Set<string>(),
		deliveryPresets: createDeliveryPresetState(),
		videoEffectGestures: new Map(),
		lastGeneratorRequest: null,
		phase,
		projects: [],
		recentProjectIds: [] as string[],
		status: { message: readyMessage, state: 'info' },
		saveState: 'saved',
		storageEstimate: createInitialStorageCapacitySnapshot(),
		analysisResult: null,
		analysisVisuals: null,
		analysisReport: null,
		analysisProcessing: false,
		lastAnalysisRequest: null,
		contrastSelections: { foreground: null, background: null },
		sampleEditMode: null,
		sampleEditAvailable: false,
		sampleEditProcessing: false,
		sampleEditAbort: null,
		taskProgress: null,
		exportProgress: 0,
		exportOutput: null,
		showRms: false,
		showVerticalRulers: true,
		disposed: false,
	};
	return exposeOwnedFields(exposeOwnedFields(exposeOwnedFields(workspace, effects), recording), transport);
}

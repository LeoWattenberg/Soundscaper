/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorControllerPhase } from './lifecycle.ts';
import { createControllerDocumentState, type ControllerDocumentState } from './document-state.ts';
import { exposeOwnedFields } from './owned-state.ts';
import { createControllerRecordingState, type ControllerRecordingState } from './recording-state.ts';
import { createControllerTransportState, type ControllerTransportState } from './transport-state.ts';
import type { ControllerRuntimeHistory, ControllerRuntimeProject } from './project-runtime.ts';
import { createLocalDiagnosticsErrorJournal } from '../local-diagnostics-error-journal.ts';
import { createInitialEffectMacroLibrary } from './effect-macro-library-service.ts';
import { createInitialMacroScriptLibrary } from './macro-script-library-service.ts';
import { createInitialStorageCapacitySnapshot } from './storage-capacity-service.ts';
import type { TakeCyclePendingOpenRecovery } from './take-cycle-capture-orchestrator.ts';

export interface EditorControllerStateOptions<Preferences, RecordingRouting, EffectPresets> {
	readonly document?: ControllerDocumentState<ControllerRuntimeProject, ControllerRuntimeHistory>;
	readonly recording?: ControllerRecordingState<RecordingRouting>;
	readonly transport?: ControllerTransportState;
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
export function createEditorControllerState<Preferences, RecordingRouting, EffectPresets>({
	document = createControllerDocumentState(),
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
}: EditorControllerStateOptions<Preferences, RecordingRouting, EffectPresets>) {
	return exposeOwnedFields(exposeOwnedFields({
		localDiagnostics: createLocalDiagnosticsErrorJournal(),
		get history() { return document.history; },
		set history(value) { document.history = value; },
		preferences,
		preferencesReadOnly: false,
		selectedTrackId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
		clipboard: null,
		effectClipboard: null,
		pixelsPerSecond: defaultPixelsPerSecond,
		timelineViewportWidth: 0,
		autoFitTrackHeight: true,
		visibleTrackHeights: {},
		mobile,
		timelineWidth: timelineMinimumSeconds * defaultPixelsPerSecond,
		timelineView: 'waveform',
		readOnly: false,
		writeAuthorityGeneration: 0,
		takeCycleRecovery: null as TakeCyclePendingOpenRecovery | null,
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
		audacityEffectType: initialEffectType,
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
		effectPresets,
		effectMacros: createInitialEffectMacroLibrary(),
		macroScripts: createInitialMacroScriptLibrary(),
		rackEffectGestures: new Map<string, unknown>(),
		parametricEqGestures: new Map<string, unknown>(),
		videoEffectGestures: new Map<string, unknown>(),
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		audacityPreviewSource: null,
		audacityPreviewAuditionBandId: null,
		audacityPreviewGeneration: 0,
		lastAudacityEffect: null,
		lastGeneratorRequest: null,
		audacityEffectWorker: null,
		nyquistAbort: null,
		nyquistResult: null,
		spectralWorker: null,
		phase,
		projects: [] as unknown[],
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
	}, recording), transport);
}

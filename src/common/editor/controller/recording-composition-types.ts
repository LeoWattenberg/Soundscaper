/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectV17 } from '../project-v17-validation.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from './lifecycle.ts';
import type { MicrophoneMeterService } from './microphone-meter-service.ts';
import type { ControllerProjectRuntime } from './project-runtime.ts';
import type { ProjectFlushOptions } from './project-save-service.ts';
import type { RecordedAudioSource } from './recording-finalization-types.ts';
import type { ControllerRecordingState } from './recording-state.ts';
import type {
	RecordingCapturePool,
	RecordingControllerFactory,
	RecordingEnginePort,
	RecordingProject,
	RecordingSourceMetadata,
} from './recording-transaction-types.ts';
import type { SoundActivationPolicyService } from './sound-activation-policy-service.ts';
import type { WritablePcmSource } from './source-audio.ts';
import type { SourceChunkProviderRegistry } from './source-chunk-provider-registry.ts';
import type { TakeCycleAppCompositionDependencies } from './take-cycle-app-composition.ts';
import type { TakeCyclePendingOpenRecovery } from './take-cycle-capture-orchestrator.ts';
import type { TakeCyclePublicationHistory } from './take-cycle-current-project-publication-service.ts';
import type { createTakeCycleOpenRecoveryAppPort } from './take-cycle-open-recovery-app-port.ts';
import type {
	TakeCycleRoutedCaptureEngine,
	TakeCycleRoutedCaptureProject,
} from './take-cycle-routed-capture-types.ts';
import type { TimedRecordingInputProject } from './timed-recording-input-service.ts';

export type TakeCycleProject = NonNullable<ReturnType<TakeCycleAppCompositionDependencies['getProject']>>;
export type TakeCycleSource = Parameters<TakeCycleAppCompositionDependencies['activateStoredSource']>[0];

/** The document shape every recording service reads; the controller supplies its current project. */
export type RecordingCompositionProject = RecordingProject & TimedRecordingInputProject & TakeCycleProject;

/**
 * The recording owner's fields plus the shared controller fields the recording
 * services read: document admission, disposal, the selected track, the project
 * bin preview that recording stops, take-cycle recovery, and the history the
 * take cycle publishes into.
 */
export type RecordingCompositionState = ControllerRecordingState & {
	readOnly: boolean;
	disposed: boolean;
	selectedTrackId: string | null;
	projectBinPreview: unknown | null;
	takeCycleRecovery: TakeCyclePendingOpenRecovery | null;
	takeCycleRecoveryInspecting: boolean;
	history: TakeCyclePublicationHistory | null;
	saveState: string;
	readonly preferences: Readonly<{ readonly recording: Readonly<{ readonly retainInputs: boolean }> }>;
	readonly projectLock: Readonly<{ readonly readOnly?: boolean }> | null;
};

export type RecordingCompositionStore = TakeCycleAppCompositionDependencies['store'] & Readonly<{
	beginSourceWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
	): Promise<WritablePcmSource<RecordingSourceMetadata, Promise<unknown>>>;
	deleteSource(sourceId: string): Promise<unknown>;
	deleteAnalysis?(key: string): PromiseLike<unknown> | unknown;
}>;

export type RecordingCompositionEngine = RecordingEnginePort & TakeCycleRoutedCaptureEngine & Readonly<{
	play(): PromiseLike<unknown> | unknown;
	stop(): unknown;
	getState(): Readonly<{ readonly state: string }>;
	setChunkSources(providers: SourceChunkProviderRegistry<string, unknown>): unknown;
}>;

export interface RecordingCompositionCopy {
	readonly armTrackForRecording: string;
	readonly recordingPreparedInputClosed: string;
	readonly recording: string;
	readonly recordingLabel: string;
	readonly timedRecordingPast: string;
	readonly recordingAssignInput: string;
	readonly recordingNoInputsAvailable: string;
	readonly timedRecordingAssignedInputsUnavailable: string;
	readonly done: string;
	readonly projectReadOnly: string;
	readonly timedRecordingPreparing: string;
	readonly timedRecordingMissed?: string;
	readonly timedRecordingScheduled: string;
	readonly timedRecordingCancelled: string;
}

export interface RecordingCompositionDependencies {
	readonly state: RecordingCompositionState;
	readonly lifetime: Pick<EditorControllerLifetime, 'capture' | 'assertActive' | 'startTask' | 'cancelTask'>;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly projectRuntime: Pick<ControllerProjectRuntime, 'applyCommand' | 'cloneProject'>;
	readonly session: TakeCycleAppCompositionDependencies['session'];
	readonly store: RecordingCompositionStore;
	readonly engine: RecordingCompositionEngine;
	readonly copy: RecordingCompositionCopy;
	readonly locale: string;
	readonly mediaDevices: unknown;
	readonly capturePool: RecordingCapturePool;
	readonly createRecorder: RecordingControllerFactory;
	readonly microphoneMeter: MicrophoneMeterService;
	readonly soundActivation: SoundActivationPolicyService;
	readonly openRecovery: Pick<ReturnType<typeof createTakeCycleOpenRecoveryAppPort>, 'bind'>;
	readonly retention: Readonly<{ retainLiveClipIds(): void }>;
	readonly sourceBuffers: Readonly<{ delete(sourceId: string): unknown }>;
	readonly sourceChunkProviders: SourceChunkProviderRegistry<string, unknown>;
	readonly sourcePeaks: Pick<Map<string, unknown>, 'delete'>;
	readonly currentTimeMs: () => number;
	readonly scheduleTimer: (callback: () => unknown, delayMs: number) => unknown;
	readonly clearTimer: (handle: unknown) => void;
	readonly productSettingKey: (name: string) => string;
	readonly getProject: () => RecordingCompositionProject | null;
	readonly setProject: (project: TakeCycleProject) => void;
	readonly projectSampleRate: () => number;
	readonly assignPreferredInputToTrack: (trackId: string) => boolean;
	readonly addTrack: (options: Readonly<{ armed: true }>) => string | null;
	readonly commit: (
		command: Readonly<{ readonly type: 'batch'; readonly commands: readonly unknown[] }>,
		selection: Readonly<{ readonly selectTrackId?: string; readonly selectClipId?: string }>,
	) => unknown;
	readonly activateStoredSource: (
		source: RecordedAudioSource | TakeCycleSource,
		metadata: unknown,
		options?: Readonly<{ readonly requireChunkStream?: boolean }>,
	) => Promise<unknown>;
	readonly beginPlaybackCachePreparation: (
		project: RecordingProject | TakeCycleRoutedCaptureProject,
	) => Promise<unknown>;
	readonly applyProjectToPlaybackEngine: (project: AudioEditorProjectV17) => PromiseLike<unknown> | unknown;
	readonly flushProject: (options: ProjectFlushOptions) => PromiseLike<unknown> | unknown;
	readonly stopProjectBinPreview: () => PromiseLike<unknown> | unknown;
	readonly persistSetting: (
		key: string,
		value: unknown,
		options?: Readonly<{ readonly policy?: 'best-effort' | 'required' }>,
	) => Promise<unknown>;
	readonly updatePreferences: (patch: unknown) => unknown;
	readonly preflightStorage: (requiredBytes: number, operation: 'recording') => Promise<void>;
	readonly publishDocumentSnapshot: () => void;
	readonly publishTelemetrySnapshot: () => void;
	readonly publishProjectState: () => void;
	readonly updatePlayhead: () => unknown;
	readonly updateTransportState: (state: string) => void;
	readonly setStatus: (message: string, state?: 'info' | 'success' | 'error') => void;
	readonly handleError: (error: unknown) => void;
}

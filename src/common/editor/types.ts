import type { EditorControllerPhase } from './controller/lifecycle.ts';
import type { StorageCapacitySnapshot } from './controller/storage-capacity-service.ts';
import type { EditorStoreStatus } from './storage/status.ts';
import type { ProjectLinkedOriginalSourceReference } from './storage/project-publication-options.ts';
import type { EditorTaskProgress } from './controller/task-progress.ts';
import type { ProjectBextMetadata } from './project-bext-metadata.ts';
import type { IxmlMetadata } from './ixml.ts';
import type { CartMetadata } from './cart-metadata.ts';
import type { AdmProjectMetadata } from './adm-project-metadata.ts';
import type {
	ProjectFeatureRequirementsManifest,
	ProjectFeatureRequirementsReport,
} from './project-feature-requirements.ts';
import type { SampleFrame } from './timeline-time.ts';
import type { TimelineAnnotationV11 } from './timeline-annotation.ts';
import type { RuntimeTimelineAnnotationProjection } from './runtime-timeline-annotation-projection.ts';
import type { SoundActivationPolicySnapshot } from './controller/sound-activation-policy-service.ts';
import type { TakeCyclePendingOpenRecovery } from './controller/take-cycle-capture-orchestrator.ts';
import type { FramescaperCaptureSessionSnapshot } from './controller/framescaper-capture-session-types.ts';

export type { EditorTaskProgress, EditorTaskProgressKind } from './controller/task-progress.ts';
export type { SoundActivationPolicySnapshot } from './controller/sound-activation-policy-service.ts';
export type { SampleFrame, SourceTicks, VideoFrame } from './timeline-time.ts';

export type EditorId = string;
/** @deprecated Prefer the domain-specific SampleFrame name at new API boundaries. */
export type EditorFrame = SampleFrame;

export interface EditorSelection {
	readonly startFrame: EditorFrame;
	readonly endFrame: EditorFrame;
	readonly trackIds: readonly EditorId[];
	readonly clipIds: readonly EditorId[];
	readonly annotationIds: readonly EditorId[];
	readonly frequencyRange?: Readonly<{ minimum: number; maximum: number }> | null;
}

export interface EditorAudioSource {
	readonly kind: 'audio';
	readonly id: EditorId;
	readonly name: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly [extension: string]: unknown;
}

export interface EditorVideoSource {
	readonly kind: 'video';
	readonly id: EditorId;
	readonly name: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
	readonly [extension: string]: unknown;
}

export type EditorSource = EditorAudioSource | EditorVideoSource;

export interface EditorAudioClip {
	readonly kind: 'audio';
	readonly id: EditorId;
	readonly sourceId: EditorId;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly [extension: string]: unknown;
}

export interface EditorVideoEffect {
	readonly id: EditorId;
	readonly type: 'color-adjust' | 'pixelate' | 'vignette' | 'gaussian-blur' | 'sharpen' | 'rgb-split'
		| 'chroma-key' | 'luma-key' | 'spill-suppression' | 'glow' | 'outline' | 'drop-shadow';
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, number>>;
}

export interface EditorVideoClip {
	readonly kind: 'video';
	readonly id: EditorId;
	readonly sourceId: EditorId;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly videoEffects: readonly EditorVideoEffect[];
	readonly [extension: string]: unknown;
}

export type EditorClip = EditorAudioClip | EditorVideoClip;

interface EditorTrackBase {
	readonly id: EditorId;
	readonly name: string;
	readonly height: number;
	readonly collapsed: boolean;
	readonly locked: boolean;
	readonly [extension: string]: unknown;
}

interface EditorMediaTrackBase extends EditorTrackBase {
	readonly clipIds: readonly EditorId[];
}

export interface EditorAudioTrack extends EditorMediaTrackBase {
	readonly type: 'audio';
}

export interface EditorVideoTrack extends EditorMediaTrackBase {
	readonly type: 'video';
}

export interface EditorLabel {
	readonly id: EditorId;
	readonly title: string;
	readonly startFrame: EditorFrame;
	readonly endFrame: EditorFrame;
	readonly color: string;
	readonly [extension: string]: unknown;
}

export interface EditorLabelTrack extends EditorTrackBase {
	readonly type: 'label';
	readonly labels: readonly EditorLabel[];
}

export type EditorTrack = EditorAudioTrack | EditorVideoTrack | EditorLabelTrack;

/** The exact current shared editor persistence document. */
export interface EditorProject {
	readonly schemaVersion: 17;
	readonly id: EditorId;
	readonly title: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly sources: readonly EditorSource[];
	readonly clips: readonly EditorClip[];
	readonly tracks: readonly EditorTrack[];
	readonly selection: EditorSelection;
	readonly projectBin: Readonly<{ clips: readonly EditorClip[] }>;
	readonly metadata: Readonly<Record<string, unknown>> & Readonly<{
		bext: ProjectBextMetadata | null;
		ixml?: IxmlMetadata | null;
		cart?: CartMetadata | null;
		adm: AdmProjectMetadata | null;
	}>;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly trackIds: readonly string[];
		readonly trackNodes: readonly Readonly<Record<string, unknown>>[];
	})[];
	readonly primarySequenceId: string;
	readonly tempoMap: Readonly<Record<string, unknown>>;
	readonly signatureMap: Readonly<Record<string, unknown>>;
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
	readonly trackFolders: readonly Readonly<Record<string, unknown>>[];
	readonly takeGroups: readonly Readonly<Record<string, unknown>>[];
	readonly [extension: string]: unknown;
}

export type EditorAction = (...args: readonly unknown[]) => unknown;
export interface EditorActionTree {
	readonly [action: string]: EditorAction | EditorActionTree;
}

export interface EditorSoundActivationActions extends EditorActionTree {
	readonly setEnabled: EditorAction;
	readonly setThresholdDb: EditorAction;
	readonly setHysteresisDb: EditorAction;
	readonly setHoldMilliseconds: EditorAction;
}

export interface EditorTakeCycleRecordingActions extends EditorActionTree {
	readonly start: EditorAction;
	readonly recover: EditorAction;
	readonly discard: EditorAction;
}

export interface EditorRecordingActions extends EditorActionTree {
	readonly soundActivation: EditorSoundActivationActions;
	readonly cycle: EditorTakeCycleRecordingActions;
}

export interface EditorActions extends EditorActionTree {
	readonly project: EditorActionTree;
	readonly projectBin: EditorActionTree;
	readonly video: EditorActionTree;
	readonly edit: EditorActionTree;
	readonly transport: EditorActionTree;
	readonly recording: EditorRecordingActions;
	readonly capture: EditorActionTree;
	readonly metering: EditorActionTree;
	readonly audioDevices: EditorActionTree;
	readonly audioWarp: EditorActionTree;
	readonly storage: EditorActionTree;
	readonly timeline: EditorActionTree;
	readonly timelineAnnotations: EditorActionTree;
	readonly sequences: EditorActionTree;
	readonly trackFolders: EditorActionTree;
	readonly takeComp: EditorActionTree;
	readonly sampleEdit: EditorActionTree;
	readonly spectral: EditorActionTree;
	readonly track: EditorActionTree;
	readonly mixer: EditorActionTree;
	readonly generators: EditorActionTree;
	readonly nyquist: EditorActionTree;
	readonly labels: EditorActionTree;
	readonly metadata: EditorActionTree;
	readonly preferences: EditorActionTree;
	readonly clip: EditorActionTree;
	readonly effects: EditorActionTree;
	readonly macros: EditorActionTree;
	readonly analysis: EditorActionTree;
	readonly export: EditorActionTree;
}

export interface EditorRecordingInputSnapshot extends Readonly<Record<string, unknown>> {
	readonly soundActivation: SoundActivationPolicySnapshot;
}

export interface EditorSnapshot {
	readonly phase: EditorControllerPhase;
	readonly ready: boolean;
	readonly disposed: boolean;
	readonly project: EditorProject | null;
	readonly selectedTrackId: EditorId | null;
	readonly selectedClipId: EditorId | null;
	readonly selectedAnnotationId: EditorId | null;
	readonly timelineAnnotations: readonly RuntimeTimelineAnnotationProjection[];
	readonly recordingInputs: EditorRecordingInputSnapshot;
	readonly recordingKind: 'ordinary' | 'take-cycle' | null;
	readonly takeCycleRecovery: TakeCyclePendingOpenRecovery | null;
	readonly capture: Readonly<FramescaperCaptureSessionSnapshot> | null;
	readonly readOnly: boolean;
	readonly featureRequirementsCompatibility: ProjectFeatureRequirementsReport | null;
	readonly storage: EditorStoreStatus & Readonly<StorageCapacitySnapshot>;
	readonly status: Readonly<{ message: string; state: string }>;
	readonly [feature: string]: unknown;
}

export interface EditorTelemetrySnapshot {
	readonly positionFrame: number;
	readonly durationFrames: number;
	readonly transportState: string;
	readonly playbackMode: string;
	readonly playbackRate: number;
	readonly recording: boolean;
	readonly taskProgress: EditorTaskProgress | null;
	readonly exportProgress: number;
	readonly [metric: string]: unknown;
}

export interface EditorControllerOptions {
	readonly productId?: string;
	readonly locale?: string;
	readonly headless?: boolean;
	readonly copy?: Readonly<Record<string, string>>;
	readonly store?: unknown;
	readonly engine?: unknown;
	readonly ffmpeg?: unknown;
	readonly fileService?: unknown;
	readonly [option: string]: unknown;
}

export interface EditorProjectStore {
	getStatus(): EditorStoreStatus;
	loadProject(
		projectId: string,
		options?: Readonly<{ revision?: number; signal?: AbortSignal }>,
	): Promise<EditorProject | null>;
	saveProject(project: EditorProject, options?: Readonly<{
		admitProjectPublication?: (bytes: number) => Promise<unknown>;
		protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
		protectedLinkedVideoSourceIds?: readonly string[];
	}>): Promise<unknown>;
	prepareProjectHandoff?(project: EditorProject, options?: Readonly<{
		signal?: AbortSignal;
	}>): Promise<unknown>;
	loadSetting<Value>(key: string, fallback: Value): Promise<Value>;
	saveSetting<Value>(key: string, value: Value): Promise<unknown>;
	close(): Promise<void> | void;
}

export interface EditorController {
	readonly ready: Promise<EditorSnapshot>;
	readonly project: EditorProject | null;
	readonly headless: boolean;
	readonly actions: EditorActions;
	getSnapshot(): EditorSnapshot;
	subscribe(listener: () => void): () => void;
	getTelemetrySnapshot(): EditorTelemetrySnapshot;
	subscribeTelemetry(listener: () => void): () => void;
	dispose(): Promise<void>;
}

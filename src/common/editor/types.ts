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

export type { EditorTaskProgress, EditorTaskProgressKind } from './controller/task-progress.ts';
export type { SoundActivationPolicySnapshot } from './controller/sound-activation-policy-service.ts';
export type { SampleFrame, SourceTicks, VideoFrame } from './timeline-time.ts';

export type EditorId = string;
/** @deprecated Prefer the domain-specific SampleFrame name at new API boundaries. */
export type EditorFrame = SampleFrame;

export interface EditorSelection {
	readonly startFrame: EditorFrame;
	readonly endFrame: EditorFrame;
	readonly trackIds?: readonly EditorId[];
	readonly clipIds?: readonly EditorId[];
	readonly frequencyRange?: Readonly<{ minimum: number; maximum: number }> | null;
}

export interface EditorSelectionV11 extends EditorSelection {
	readonly annotationIds: readonly EditorId[];
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

export interface EditorProjectV5 {
	readonly schemaVersion: 5;
	readonly id: EditorId;
	readonly title: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly sources: readonly EditorSource[];
	readonly clips: readonly EditorClip[];
	readonly tracks: readonly EditorTrack[];
	readonly selection: EditorSelection | null;
	readonly projectBin: Readonly<{ clips: readonly EditorClip[] }>;
	readonly [extension: string]: unknown;
}

export type EditorProjectV6 = Omit<EditorProjectV5, 'schemaVersion'> & Readonly<{
	schemaVersion: 6;
	metadata: Readonly<Record<string, unknown>> & Readonly<{
		bext: ProjectBextMetadata | null;
		ixml?: IxmlMetadata | null;
		cart?: CartMetadata | null;
	}>;
}>;

export type EditorProjectV7 = Omit<EditorProjectV6, 'schemaVersion' | 'metadata'> & Readonly<{
	schemaVersion: 7;
	metadata: EditorProjectV6['metadata'] & Readonly<{
		adm: AdmProjectMetadata | null;
	}>;
}>;

export type EditorProjectV8 = Omit<EditorProjectV7, 'schemaVersion'> & Readonly<{
	schemaVersion: 8;
}>;

export type EditorProjectV9 = Omit<EditorProjectV8, 'schemaVersion'> & Readonly<{
	schemaVersion: 9;
	featureRequirements: ProjectFeatureRequirementsManifest;
}>;

export type EditorProjectV10 = Omit<EditorProjectV9, 'schemaVersion'> & Readonly<{
	schemaVersion: 10;
	sequences: readonly Readonly<Record<string, unknown>>[];
	primarySequenceId: string;
	tempoMap: Readonly<Record<string, unknown>>;
	signatureMap: Readonly<Record<string, unknown>>;
}>;

export type EditorProjectV11 = Omit<EditorProjectV10, 'schemaVersion' | 'selection'> & Readonly<{
	schemaVersion: 11;
	selection: EditorSelectionV11;
	timelineAnnotations: readonly TimelineAnnotationV11[];
}>;

export type EditorProjectV12 = Omit<EditorProjectV11, 'schemaVersion' | 'sequences'> & Readonly<{
	schemaVersion: 12;
	trackFolders: readonly Readonly<Record<string, unknown>>[];
	sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly trackIds: readonly string[];
		readonly trackNodes: readonly Readonly<Record<string, unknown>>[];
	})[];
}>;

export interface EditorLegacyProject<Version extends 2 | 3 | 4> {
	readonly schemaVersion: Version;
	readonly id: EditorId;
	readonly title: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly selection: EditorSelection | null;
	readonly [extension: string]: unknown;
}

export type EditorProjectV2 = EditorLegacyProject<2>;
export type EditorProjectV3 = EditorLegacyProject<3>;
export type EditorProjectV4 = EditorLegacyProject<4>;
export type EditorProjectV13 = Omit<EditorProjectV11, 'schemaVersion' | 'sequences'> & Readonly<{
	schemaVersion: 13;
	trackFolders: readonly Readonly<Record<string, unknown>>[];
	sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly trackIds: readonly string[];
		readonly trackNodes: readonly Readonly<Record<string, unknown>>[];
	})[];
}>;

export type EditorProjectV14 = Omit<EditorProjectV13, 'schemaVersion'> & Readonly<{
	schemaVersion: 14;
}>;

export type EditorTrackV15 = EditorTrack & Readonly<{ locked: boolean }>;

export type EditorProjectV15 = Omit<EditorProjectV14, 'schemaVersion' | 'tracks'> & Readonly<{
	schemaVersion: 15;
	tracks: readonly EditorTrackV15[];
}>;

export type EditorProjectV16 = Omit<EditorProjectV15, 'schemaVersion'> & Readonly<{
	schemaVersion: 16;
}>;

export type EditorProjectV17 = Omit<EditorProjectV16, 'schemaVersion'> & Readonly<{
	schemaVersion: 17;
	takeGroups: readonly Readonly<Record<string, unknown>>[];
}>;

export type EditorProject = EditorProjectV2 | EditorProjectV3 | EditorProjectV4 | EditorProjectV5 | EditorProjectV6 | EditorProjectV7 | EditorProjectV8 | EditorProjectV9 | EditorProjectV10 | EditorProjectV11 | EditorProjectV12 | EditorProjectV13 | EditorProjectV14 | EditorProjectV15 | EditorProjectV16 | EditorProjectV17;

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

export interface EditorRecordingActions extends EditorActionTree {
	readonly soundActivation: EditorSoundActivationActions;
}

export interface EditorActions extends EditorActionTree {
	readonly project: EditorActionTree;
	readonly projectBin: EditorActionTree;
	readonly video: EditorActionTree;
	readonly edit: EditorActionTree;
	readonly transport: EditorActionTree;
	readonly recording: EditorRecordingActions;
	readonly metering: EditorActionTree;
	readonly audioDevices: EditorActionTree;
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

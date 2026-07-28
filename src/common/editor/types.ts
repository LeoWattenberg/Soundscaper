import type { EditorControllerPhase } from './controller/lifecycle.ts';
import type { EditorStoreStatus } from './storage/status.ts';
import type { EditorTaskProgress } from './controller/task-progress.ts';
import type { ProjectBextMetadata } from './project-bext-metadata.ts';
import type { IxmlMetadata } from './ixml.ts';
import type { CartMetadata } from './cart-metadata.ts';
import type { AdmProjectMetadata } from './adm-project-metadata.ts';

export type { EditorTaskProgress, EditorTaskProgressKind } from './controller/task-progress.ts';

export type EditorId = string;
export type EditorFrame = number;

export interface EditorSelection {
	readonly startFrame: EditorFrame;
	readonly endFrame: EditorFrame;
	readonly trackIds?: readonly EditorId[];
	readonly clipIds?: readonly EditorId[];
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
export type EditorProject = EditorProjectV2 | EditorProjectV3 | EditorProjectV4 | EditorProjectV5 | EditorProjectV6 | EditorProjectV7 | EditorProjectV8;

export type EditorAction = (...args: readonly unknown[]) => unknown;
export interface EditorActionTree {
	readonly [action: string]: EditorAction | EditorActionTree;
}

export interface EditorActions extends EditorActionTree {
	readonly project: EditorActionTree;
	readonly projectBin: EditorActionTree;
	readonly video: EditorActionTree;
	readonly edit: EditorActionTree;
	readonly transport: EditorActionTree;
	readonly recording: EditorActionTree;
	readonly metering: EditorActionTree;
	readonly audioDevices: EditorActionTree;
	readonly timeline: EditorActionTree;
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

export interface EditorSnapshot {
	readonly phase: EditorControllerPhase;
	readonly ready: boolean;
	readonly disposed: boolean;
	readonly project: EditorProject | null;
	readonly selectedTrackId: EditorId | null;
	readonly selectedClipId: EditorId | null;
	readonly readOnly: boolean;
	readonly storage: EditorStoreStatus & Readonly<{ usage: number | null; quota: number | null }>;
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
	loadProject(projectId: string): Promise<EditorProject | null>;
	saveProject(project: EditorProject): Promise<unknown>;
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

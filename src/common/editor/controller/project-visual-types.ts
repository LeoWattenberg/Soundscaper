/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoTimingIndex } from '../video-timing-asset.ts';

/**
 * What the project visual service reads, and what it hands back.
 *
 * A visual is a live object URL over decoded media, so these declarations are as much
 * about ownership as shape: a caller receives a handle it must release, and the service
 * needs to know which project the handle was minted from to decide whether releasing it
 * is still the right thing to do.
 */

export interface ProjectVisualSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: string;
	readonly storageKey?: string;
	readonly contentSha256?: string;
	readonly timingAsset?: unknown;
}

export interface ProjectVisualClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: string;
	readonly sourceId: string;
	readonly timelineStartFrame?: number;
	readonly durationFrames?: number;
	readonly binItemId?: string | null;
}

export interface ProjectVisualTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly clipIds: readonly string[];
}

export interface ProjectVisualProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly sources: readonly ProjectVisualSource[];
	readonly clips: readonly ProjectVisualClip[];
	readonly tracks: readonly ProjectVisualTrack[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly ProjectVisualClip[] }>;
}

export interface VideoDerivative extends Readonly<Record<string, unknown>> {
	readonly type: string;
	readonly timestamp?: number;
	readonly width?: number;
	readonly height?: number;
}

export interface ProjectVisualStore {
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Blob | null>;
	leaseLinkedVideoOriginalPlayback?(
		projectId: string,
		source: ProjectVisualSource,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<LinkedVideoPlaybackLease | null>;
	resolveLinkedVideoOriginal?(
		projectId: string,
		source: ProjectVisualSource,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<{ readonly blob: Blob; readonly binding: unknown }> | null>;
	listVideoDerivatives(sourceId: string): Promise<readonly VideoDerivative[]>;
	loadVideoDerivative(sourceId: string, derivative: VideoDerivative): Promise<Blob | null>;
	listLinkedVideoDerivatives?(
		projectId: string, source: ProjectVisualSource, binding: unknown,
	): Promise<readonly VideoDerivative[]>;
	loadLinkedVideoDerivative?(
		projectId: string, source: ProjectVisualSource, binding: unknown, derivative: VideoDerivative,
	): Promise<Blob | null>;
}

export interface ObjectUrlPort {
	createObjectURL(blob: Blob): string | null;
	revokeObjectURL(url: string): void;
}

export interface LinkedVideoPlaybackLease {
	readonly binding: unknown;
	readonly mediaUrl: string;
	release(): PromiseLike<void> | void;
}

export interface VideoThumbnail {
	readonly sourceTimeSeconds: number;
	readonly timestampSeconds: number;
	readonly url: string;
	readonly width?: number;
	readonly height?: number;
}

export interface VideoVisual {
	readonly mediaUrl: string | null;
	readonly posterUrl: string | null;
	readonly thumbnails: readonly VideoThumbnail[];
	readonly mediaKind?: 'proxy';
}

export interface ProjectVideoPreviewMedia {
	readonly body: Blob; readonly mediaKind: 'proxy';
}
export interface ProjectVideoPreviewMediaRequest {
	readonly project: ProjectVisualProject; readonly source: ProjectVisualSource;
	readonly sourceTimingIndex: VideoTimingIndex | null; readonly signal?: AbortSignal;
}

export interface VideoVisualRecord {
	readonly visual: Readonly<VideoVisual>;
	readonly objectUrls: readonly string[];
	readonly linkedPlaybackLease: LinkedVideoPlaybackLease | null;
}

export interface ClipVisualData {
	readonly clip: ProjectVisualClip;
	readonly track: ProjectVisualTrack | null;
	readonly source: ProjectVisualSource | null;
	readonly buffer: unknown;
	readonly peaks: unknown;
	readonly available: boolean;
	readonly mediaUrl?: string | null;
	readonly posterUrl?: string | null;
	readonly thumbnails?: readonly VideoThumbnail[];
	readonly mediaKind?: 'proxy';
	readonly pcmWindow?: unknown;
	readonly itemClips?: readonly ProjectVisualClip[];
	readonly videoClip?: ProjectVisualClip;
}

export interface VideoSourceVisualData {
	readonly source: ProjectVisualSource;
	readonly available: boolean;
	readonly mediaUrl: string | null;
	readonly posterUrl: string | null;
	readonly thumbnails: readonly VideoThumbnail[];
	readonly mediaKind?: 'proxy';
}

export interface ProjectVisualServiceDependencies {
	getProject(): ProjectVisualProject | null;
	captureProject(projectId: string): unknown;
	assertProject(token: unknown): void;
	readonly missingSourceIds: ReadonlySet<string>;
	readonly sourceBuffers: ReadonlyMap<string, unknown>;
	readonly sourcePeaks: ReadonlyMap<string, unknown>;
	readonly waveformPcmWindows: ReadonlyMap<string, unknown>;
	readonly store: ProjectVisualStore;
	resolveProductVideoPreviewMedia?(request: Readonly<ProjectVideoPreviewMediaRequest>):
		Promise<Readonly<ProjectVideoPreviewMedia> | null>;
	projectDurationFrames(project: ProjectVisualProject): number;
	readonly url: ObjectUrlPort;
}

export interface ProjectVisualService {
	getClipVisualData(clipId: string): Readonly<ClipVisualData> | null;
	getProjectBinClipVisualData(clipId: string): Readonly<ClipVisualData> | null;
	getVideoSourceVisualData(sourceId: string): Readonly<VideoSourceVisualData> | null;
	activateVideoSource(
		source: ProjectVisualSource,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<VideoVisual> | null>;
	revokeVideoVisual(sourceId: string, expectedMediaUrl?: string | null): Promise<boolean>;
	revokeVideoVisuals(): Promise<void>;
	projectBinClips(project?: ProjectVisualProject | null): readonly ProjectVisualClip[];
	allProjectClips(project?: ProjectVisualProject | null): readonly ProjectVisualClip[];
	hasMissingTimelineSources(
		project?: ProjectVisualProject | null,
		options?: Readonly<{ audioOnly?: boolean; excludedSourceIds?: ReadonlySet<string> }>,
	): boolean;
	getVisibleClips(options?: Readonly<{
		startFrame?: number;
		endFrame?: number;
		overscanFrames?: number;
	}>): readonly (Readonly<ClipVisualData> | null)[];
	dispose(): Promise<void>;
}

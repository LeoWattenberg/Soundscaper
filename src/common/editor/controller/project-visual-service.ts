/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProjectVisualSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: string;
	readonly storageKey?: string;
}

export interface ProjectVisualClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: string;
	readonly sourceId: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
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

interface VideoDerivative extends Readonly<Record<string, unknown>> {
	readonly type: string;
	readonly timestamp?: number;
	readonly width?: number;
	readonly height?: number;
}

interface ProjectVisualStore {
	loadMediaAsset(sourceId: string): Promise<Blob | null>;
	listVideoDerivatives(sourceId: string): Promise<readonly VideoDerivative[]>;
	loadVideoDerivative(sourceId: string, derivative: VideoDerivative): Promise<Blob | null>;
}

interface ObjectUrlPort {
	createObjectURL(blob: Blob): string | null;
	revokeObjectURL(url: string): void;
}

export interface VideoThumbnail {
	readonly sourceTimeSeconds: number;
	readonly timestampSeconds: number;
	readonly url: string;
	readonly width?: number;
	readonly height?: number;
}

interface VideoVisual {
	readonly mediaUrl: string | null;
	readonly posterUrl: string | null;
	readonly thumbnails: readonly VideoThumbnail[];
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
	readonly pcmWindow?: unknown;
	readonly itemClips?: readonly ProjectVisualClip[];
	readonly videoClip?: ProjectVisualClip;
}

export interface ProjectVisualServiceDependencies {
	getProject(): ProjectVisualProject | null;
	readonly missingSourceIds: ReadonlySet<string>;
	readonly sourceBuffers: ReadonlyMap<string, unknown>;
	readonly sourcePeaks: ReadonlyMap<string, unknown>;
	readonly waveformPcmWindows: ReadonlyMap<string, unknown>;
	readonly store: ProjectVisualStore;
	projectDurationFrames(project: ProjectVisualProject): number;
	readonly url: ObjectUrlPort;
}

export interface ProjectVisualService {
	getClipVisualData(clipId: string): Readonly<ClipVisualData> | null;
	getProjectBinClipVisualData(clipId: string): Readonly<ClipVisualData> | null;
	activateVideoSource(source: ProjectVisualSource): Promise<Readonly<VideoVisual> | null>;
	revokeVideoVisual(sourceId: string): boolean;
	revokeVideoVisuals(): void;
	projectBinClips(project?: ProjectVisualProject | null): readonly ProjectVisualClip[];
	allProjectClips(project?: ProjectVisualProject | null): readonly ProjectVisualClip[];
	hasMissingTimelineSources(
		project?: ProjectVisualProject | null,
		options?: Readonly<{ audioOnly?: boolean }>,
	): boolean;
	getVisibleClips(options?: Readonly<{
		startFrame?: number;
		endFrame?: number;
		overscanFrames?: number;
	}>): readonly (Readonly<ClipVisualData> | null)[];
	dispose(): void;
}

export function createProjectVisualService(
	dependencies: ProjectVisualServiceDependencies,
): Readonly<ProjectVisualService> {
	const videoVisuals = new Map<string, Readonly<VideoVisual>>();
	const generations = new Map<string, number>();
	let disposed = false;

	return Object.freeze({
		getClipVisualData,
		getProjectBinClipVisualData,
		activateVideoSource,
		revokeVideoVisual,
		revokeVideoVisuals,
		projectBinClips,
		allProjectClips,
		hasMissingTimelineSources,
		getVisibleClips,
		dispose,
	});

	function getClipVisualData(clipId: string): Readonly<ClipVisualData> | null {
		const project = dependencies.getProject();
		const clip = project?.clips.find((candidate) => candidate.id === clipId) ?? null;
		if (!project || !clip) return null;
		const source = findSource(project, clip.sourceId);
		const video = clip.kind === 'video' ? videoVisuals.get(clip.sourceId) : null;
		const pcmWindow = dependencies.waveformPcmWindows.get(String(clip.id));
		return Object.freeze({
			clip,
			track: findClipTrack(project, clip.id),
			source,
			buffer: dependencies.sourceBuffers.get(clip.sourceId) ?? null,
			peaks: dependencies.sourcePeaks.get(clip.sourceId) ?? null,
			available: Boolean(source && !dependencies.missingSourceIds.has(source.id)),
			mediaUrl: video?.mediaUrl ?? null,
			posterUrl: video?.posterUrl ?? null,
			thumbnails: video?.thumbnails ?? Object.freeze([]),
			...(pcmWindow === undefined ? {} : { pcmWindow }),
		});
	}

	function getProjectBinClipVisualData(clipId: string): Readonly<ClipVisualData> | null {
		const project = dependencies.getProject();
		const clip = projectBinClips(project).find((candidate) => candidate.id === clipId) ?? null;
		if (!project || !clip) return null;
		const source = findSource(project, clip.sourceId);
		const itemClips = project.schemaVersion >= 4
			? projectBinClips(project).filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const videoClip = itemClips.find((candidate) => candidate.kind === 'video') ?? null;
		const video = videoClip ? videoVisuals.get(videoClip.sourceId) : null;
		return Object.freeze({
			clip,
			track: null,
			source,
			buffer: dependencies.sourceBuffers.get(clip.sourceId) ?? null,
			peaks: dependencies.sourcePeaks.get(clip.sourceId) ?? null,
			available: Boolean(source && !dependencies.missingSourceIds.has(source.id)),
			...(videoClip ? {
				itemClips: Object.freeze(itemClips),
				videoClip,
				mediaUrl: video?.mediaUrl ?? null,
				posterUrl: video?.posterUrl ?? null,
				thumbnails: video?.thumbnails ?? Object.freeze([]),
			} : {}),
		});
	}

	async function activateVideoSource(
		source: ProjectVisualSource,
	): Promise<Readonly<VideoVisual> | null> {
		if (disposed) return null;
		const operation = nextGeneration(source.id);
		const sourceId = source.storageKey || source.id;
		const ownedUrls: string[] = [];
		const mediaBlob = await dependencies.store.loadMediaAsset(sourceId);
		if (!isCurrent(source.id, operation)) return null;
		if (!mediaBlob) throw new Error('The original video file is missing.');
		const mediaUrl = dependencies.url.createObjectURL(mediaBlob);
		if (mediaUrl) ownedUrls.push(mediaUrl);
		let posterUrl: string | null = null;
		const thumbnails: VideoThumbnail[] = [];
		const derivatives = await dependencies.store.listVideoDerivatives(sourceId);
		if (!isCurrent(source.id, operation)) return cleanupLate(ownedUrls);
		for (const derivative of derivatives) {
			const blob = await dependencies.store.loadVideoDerivative(sourceId, derivative);
			if (!isCurrent(source.id, operation)) return cleanupLate(ownedUrls);
			if (!blob) continue;
			const url = dependencies.url.createObjectURL(blob);
			if (!url) continue;
			ownedUrls.push(url);
			if (derivative.type === 'poster') posterUrl = url;
			else if (derivative.type === 'thumbnail') {
				const timestamp = Number(derivative.timestamp) || 0;
				thumbnails.push(Object.freeze({
					sourceTimeSeconds: timestamp,
					timestampSeconds: timestamp,
					url,
					width: derivative.width,
					height: derivative.height,
				}));
			} else revokeUrls([url]);
		}
		if (!isCurrent(source.id, operation)) return cleanupLate(ownedUrls);
		dropVisual(source.id);
		const visual = Object.freeze({
			mediaUrl,
			posterUrl: posterUrl || thumbnails[0]?.url || null,
			thumbnails: Object.freeze(thumbnails),
		});
		videoVisuals.set(source.id, visual);
		return visual;
	}

	function revokeVideoVisual(sourceId: string): boolean {
		nextGeneration(sourceId);
		return dropVisual(sourceId);
	}

	function revokeVideoVisuals(): void {
		for (const sourceId of new Set([...generations.keys(), ...videoVisuals.keys()])) {
			revokeVideoVisual(sourceId);
		}
	}

	function projectBinClips(
		project: ProjectVisualProject | null = dependencies.getProject(),
	): readonly ProjectVisualClip[] {
		return Array.isArray(project?.projectBin?.clips) ? project.projectBin.clips : Object.freeze([]);
	}

	function allProjectClips(
		project: ProjectVisualProject | null = dependencies.getProject(),
	): readonly ProjectVisualClip[] {
		return Object.freeze([...(project?.clips || []), ...projectBinClips(project)]);
	}

	function hasMissingTimelineSources(
		project: ProjectVisualProject | null = dependencies.getProject(),
		options: Readonly<{ audioOnly?: boolean }> = {},
	): boolean {
		if (!dependencies.missingSourceIds.size) return false;
		const sourceById = options.audioOnly
			? new Map((project?.sources || []).map((source) => [source.id, source]))
			: null;
		return (project?.clips || []).some((clip) => (
			(!options.audioOnly || (clip.kind !== 'video' && sourceById?.get(clip.sourceId)?.kind !== 'video'))
			&& dependencies.missingSourceIds.has(clip.sourceId)
		));
	}

	function getVisibleClips(options: Readonly<{
		startFrame?: number;
		endFrame?: number;
		overscanFrames?: number;
	}> = {}): readonly (Readonly<ClipVisualData> | null)[] {
		const project = dependencies.getProject();
		if (!project) return Object.freeze([]);
		const startFrame = Math.max(0, Number.isSafeInteger(options.startFrame) ? options.startFrame || 0 : 0);
		const defaultEndFrame = Math.max(startFrame, dependencies.projectDurationFrames(project));
		const endFrame = Math.max(
			startFrame,
			Number.isSafeInteger(options.endFrame) ? options.endFrame || 0 : defaultEndFrame,
		);
		const overscanFrames = Math.max(
			0,
			Number.isSafeInteger(options.overscanFrames)
				? options.overscanFrames || 0
				: endFrame - startFrame,
		);
		const visibleStart = Math.max(0, startFrame - overscanFrames);
		const visibleEnd = endFrame + overscanFrames;
		return Object.freeze(project.clips
			.filter((clip) => clip.timelineStartFrame < visibleEnd
				&& clip.timelineStartFrame + clip.durationFrames > visibleStart)
			.map((clip) => getClipVisualData(clip.id)));
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		revokeVideoVisuals();
	}

	function nextGeneration(sourceId: string): number {
		const next = (generations.get(sourceId) || 0) + 1;
		generations.set(sourceId, next);
		return next;
	}

	function isCurrent(sourceId: string, generation: number): boolean {
		return !disposed && generations.get(sourceId) === generation;
	}

	function dropVisual(sourceId: string): boolean {
		const visual = videoVisuals.get(sourceId);
		if (!visual) return false;
		revokeUrls([
			visual.mediaUrl,
			visual.posterUrl,
			...visual.thumbnails.map((thumbnail) => thumbnail.url),
		]);
		videoVisuals.delete(sourceId);
		return true;
	}

	function cleanupLate(urls: readonly string[]): null {
		revokeUrls(urls);
		return null;
	}

	function revokeUrls(urls: readonly (string | null | undefined)[]): void {
		for (const url of new Set(urls.filter((value): value is string => Boolean(value)))) {
			dependencies.url.revokeObjectURL(url);
		}
	}
}

function findSource(project: ProjectVisualProject, sourceId: string): ProjectVisualSource | null {
	return project.sources.find((source) => source.id === sourceId) ?? null;
}

function findClipTrack(project: ProjectVisualProject, clipId: string): ProjectVisualTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) ?? null;
}

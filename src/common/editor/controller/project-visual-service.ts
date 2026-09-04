/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasProjectBinMediaAuthority } from '../project-schema-version.ts';

import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../runtime-clip-projection.ts';
import { loadVideoTimingAsset } from '../video-timing-storage.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../video-source-time.ts';
export type * from './project-visual-types.ts';
import type {
	ClipVisualData,
	LinkedVideoPlaybackLease,
	ProjectVisualClip,
	ProjectVisualProject,
	ProjectVisualService,
	ProjectVisualServiceDependencies,
	ProjectVisualSource,
	ProjectVisualTrack,
	VideoSourceVisualData,
	VideoThumbnail,
	VideoVisual,
	VideoVisualRecord,
} from './project-visual-types.ts';

export function createProjectVisualService(
	dependencies: ProjectVisualServiceDependencies,
): Readonly<ProjectVisualService> {
	const videoVisuals = new Map<string, Readonly<VideoVisualRecord>>();
	const generations = new Map<string, number>();
	let disposed = false;
	let disposePromise: Promise<void> | null = null;

	return Object.freeze({
		getClipVisualData,
		getProjectBinClipVisualData,
		getVideoSourceVisualData,
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
		const video = clip.kind === 'video' ? videoVisuals.get(clip.sourceId)?.visual : null;
		const pcmWindow = dependencies.waveformPcmWindows.get(String(clip.id));
		return Object.freeze({
			clip,
			track: findClipTrack(project, clip.id),
			source,
			buffer: dependencies.sourceBuffers.get(clip.sourceId) ?? null,
			peaks: dependencies.sourcePeaks.get(clip.sourceId) ?? null,
			available: Boolean(source && (!dependencies.missingSourceIds.has(source.id)
				|| video?.mediaKind === 'proxy')),
			mediaUrl: video?.mediaUrl ?? null,
			posterUrl: video?.posterUrl ?? null,
			thumbnails: video?.thumbnails ?? Object.freeze([]),
			...(video?.mediaKind ? { mediaKind: video.mediaKind } : {}),
			...(pcmWindow === undefined ? {} : { pcmWindow }),
		});
	}

	function getProjectBinClipVisualData(clipId: string): Readonly<ClipVisualData> | null {
		const project = dependencies.getProject();
		const clip = projectBinClips(project).find((candidate) => candidate.id === clipId) ?? null;
		if (!project || !clip) return null;
		const source = findSource(project, clip.sourceId);
		const itemClips = hasProjectBinMediaAuthority(project)
			? projectBinClips(project).filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const videoClip = itemClips.find((candidate) => candidate.kind === 'video') ?? null;
		const video = videoClip ? videoVisuals.get(videoClip.sourceId)?.visual : null;
		return Object.freeze({
			clip,
			track: null,
			source,
			buffer: dependencies.sourceBuffers.get(clip.sourceId) ?? null,
			peaks: dependencies.sourcePeaks.get(clip.sourceId) ?? null,
			available: Boolean(source && (!dependencies.missingSourceIds.has(source.id)
				|| video?.mediaKind === 'proxy')),
			...(videoClip ? {
				itemClips: Object.freeze(itemClips),
				videoClip,
				mediaUrl: video?.mediaUrl ?? null,
				posterUrl: video?.posterUrl ?? null,
				thumbnails: video?.thumbnails ?? Object.freeze([]),
				...(video?.mediaKind ? { mediaKind: video.mediaKind } : {}),
			} : {}),
		});
	}

	function getVideoSourceVisualData(sourceId: string): Readonly<VideoSourceVisualData> | null {
		const project = dependencies.getProject();
		const source = project ? findSource(project, sourceId) : null;
		if (!source || source.kind !== 'video') return null;
		const visual = videoVisuals.get(source.id)?.visual;
		return Object.freeze({
			source,
			available: !dependencies.missingSourceIds.has(source.id) || visual?.mediaKind === 'proxy',
			mediaUrl: visual?.mediaUrl ?? null,
			posterUrl: visual?.posterUrl ?? null,
			thumbnails: visual?.thumbnails ?? Object.freeze([]),
			...(visual?.mediaKind ? { mediaKind: visual.mediaKind } : {}),
		});
	}

	async function activateVideoSource(
		source: ProjectVisualSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Readonly<VideoVisual> | null> {
		if (disposed) return null;
		const operation = nextGeneration(source.id);
		const project = dependencies.getProject();
		const projectId = project?.id ?? null;
		const projectToken = projectId ? dependencies.captureProject(projectId) : null;
		const sourceId = source.storageKey || source.id;
		const ownedUrls: string[] = [];
		let linkedPlaybackLease: LinkedVideoPlaybackLease | null = null;
		try {
			throwIfAborted(options.signal);
			const timing = source.timingAsset == null
				? null
				: await loadVideoTimingAsset(dependencies.store, source.timingAsset, {
					signal: options.signal,
					sourceSha256: source.contentSha256,
				});
			if (timing && (timing.status !== 'available' || !timing.index)) {
				throw new Error(`The video timing asset is ${timing.status}.`);
			}
			const productMedia = project && dependencies.resolveProductVideoPreviewMedia
				? await dependencies.resolveProductVideoPreviewMedia({
					project,
					source,
					sourceTimingIndex: timing?.index ?? null,
					...(options.signal ? { signal: options.signal } : {}),
				})
				: null;
			throwIfAborted(options.signal);
			if (productMedia && (productMedia.mediaKind !== 'proxy'
				|| !(productMedia.body instanceof Blob))) {
				throw new TypeError('A product video-preview media resolver returned an invalid result.');
			}
			let mediaBlob = productMedia?.body
				?? await dependencies.store.loadMediaAsset(sourceId, options);
			throwIfAborted(options.signal);
			if (!isActivationCurrent(source.id, operation, project, projectToken)) {
				return cleanupLate(ownedUrls, linkedPlaybackLease);
			}
			let linkedBinding: unknown = null;
			if (!productMedia && !mediaBlob && projectId
				&& dependencies.store.leaseLinkedVideoOriginalPlayback) {
				linkedPlaybackLease = await dependencies.store.leaseLinkedVideoOriginalPlayback.call(
					dependencies.store, projectId, source, options,
				);
				throwIfAborted(options.signal);
				if (!isActivationCurrent(source.id, operation, project, projectToken)) {
					return cleanupLate(ownedUrls, linkedPlaybackLease);
				}
				linkedBinding = linkedPlaybackLease?.binding ?? null;
			}
			if (!productMedia && !mediaBlob && !linkedPlaybackLease && projectId
				&& dependencies.store.resolveLinkedVideoOriginal) {
				const linkedOriginal = await dependencies.store.resolveLinkedVideoOriginal.call(
					dependencies.store, projectId, source, options,
				);
				throwIfAborted(options.signal);
				if (!isActivationCurrent(source.id, operation, project, projectToken)) {
					return cleanupLate(ownedUrls, linkedPlaybackLease);
				}
				linkedBinding = linkedOriginal?.binding ?? null;
				mediaBlob = linkedOriginal?.blob ?? null;
			}
			if (!mediaBlob && !linkedPlaybackLease) {
				throw new Error('The original video file is missing.');
			}
			const mediaUrl = linkedPlaybackLease?.mediaUrl
				?? (mediaBlob ? dependencies.url.createObjectURL(mediaBlob) : null);
			if (mediaBlob && mediaUrl) ownedUrls.push(mediaUrl);
			let posterUrl: string | null = null;
			const thumbnails: VideoThumbnail[] = [];
			const listLinkedDerivatives = dependencies.store.listLinkedVideoDerivatives;
			const loadLinkedDerivative = dependencies.store.loadLinkedVideoDerivative;
			const linkedDerivativeAccess = linkedBinding !== null && projectId
				&& listLinkedDerivatives && loadLinkedDerivative
				? { binding: linkedBinding, projectId,
					list: listLinkedDerivatives, load: loadLinkedDerivative }
				: null;
			const derivatives = linkedDerivativeAccess
				? await linkedDerivativeAccess.list.call(
					dependencies.store, linkedDerivativeAccess.projectId, source, linkedDerivativeAccess.binding,
				)
				: await dependencies.store.listVideoDerivatives(sourceId);
			throwIfAborted(options.signal);
			if (!isActivationCurrent(source.id, operation, project, projectToken)) {
				return cleanupLate(ownedUrls, linkedPlaybackLease);
			}
			for (const derivative of derivatives) {
				const blob = linkedDerivativeAccess
					? await linkedDerivativeAccess.load.call(
						dependencies.store, linkedDerivativeAccess.projectId,
						source, linkedDerivativeAccess.binding, derivative,
					)
					: await dependencies.store.loadVideoDerivative(sourceId, derivative);
				throwIfAborted(options.signal);
				if (!isActivationCurrent(source.id, operation, project, projectToken)) {
					return cleanupLate(ownedUrls, linkedPlaybackLease);
				}
				if (!blob) continue;
				const url = dependencies.url.createObjectURL(blob);
				if (!url) continue;
				if (derivative.type === 'poster') {
					ownedUrls.push(url);
					posterUrl = url;
				}
				else if (derivative.type === 'thumbnail') {
					ownedUrls.push(url);
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
			throwIfAborted(options.signal);
			if (!isActivationCurrent(source.id, operation, project, projectToken)) {
				return cleanupLate(ownedUrls, linkedPlaybackLease);
			}
			await dropVisual(source.id);
			throwIfAborted(options.signal);
			if (!isActivationCurrent(source.id, operation, project, projectToken)) {
				return cleanupLate(ownedUrls, linkedPlaybackLease);
			}
			const visual = Object.freeze({
				mediaUrl,
				posterUrl: posterUrl || thumbnails[0]?.url || null,
				thumbnails: Object.freeze(thumbnails),
				...(productMedia ? { mediaKind: productMedia.mediaKind } : {}),
			});
			if (timing?.index) registerVideoTimingIndex(source, timing.index);
			else unregisterVideoTimingIndex(source.id);
			videoVisuals.set(source.id, Object.freeze({
				visual,
				objectUrls: Object.freeze([...ownedUrls]),
				linkedPlaybackLease,
			}));
			return visual;
		} catch (error) {
			let primary = error;
			try { throwIfAborted(options.signal); } catch (abortError) { primary = abortError; }
			return failActivation(primary, ownedUrls, linkedPlaybackLease);
		}
	}

	async function revokeVideoVisual(
		sourceId: string,
		expectedMediaUrl?: string | null,
	): Promise<boolean> {
		const current = videoVisuals.get(sourceId);
		if (expectedMediaUrl !== undefined && current?.visual.mediaUrl !== expectedMediaUrl) return false;
		nextGeneration(sourceId);
		return dropVisual(sourceId);
	}

	async function revokeVideoVisuals(): Promise<void> {
		const sourceIds = new Set([...generations.keys(), ...videoVisuals.keys()]);
		for (const sourceId of sourceIds) nextGeneration(sourceId);
		const records = [...videoVisuals.values()];
		for (const sourceId of videoVisuals.keys()) unregisterVideoTimingIndex(sourceId);
		videoVisuals.clear();
		await cleanupRecords(records);
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
		options: Readonly<{ audioOnly?: boolean; excludedSourceIds?: ReadonlySet<string> }> = {},
	): boolean {
		if (!dependencies.missingSourceIds.size) return false;
		const sourceById = options.audioOnly
			? new Map((project?.sources || []).map((source) => [source.id, source]))
			: null;
		return (project?.clips || []).some((clip) => (
			(!options.audioOnly || (clip.kind !== 'video' && sourceById?.get(clip.sourceId)?.kind !== 'video'))
			&& !options.excludedSourceIds?.has(clip.sourceId)
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
		const runtimeProject = resolveRuntimeProjectProjection(project as RuntimeClipProject);
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
		return Object.freeze(runtimeProject.clips
			.filter((clip) => clip.timelineStartFrame < visibleEnd
				&& clip.timelineStartFrame + clip.durationFrames > visibleStart)
			.map((clip) => getClipVisualData(String(clip.id))));
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposed = true;
		disposePromise = revokeVideoVisuals();
		void disposePromise.catch(() => undefined);
		return disposePromise;
	}

	function nextGeneration(sourceId: string): number {
		const next = (generations.get(sourceId) || 0) + 1;
		generations.set(sourceId, next);
		return next;
	}

	function isCurrent(sourceId: string, generation: number): boolean {
		return !disposed && generations.get(sourceId) === generation;
	}

	function isActivationCurrent(
		sourceId: string,
		generation: number,
		project: ProjectVisualProject | null,
		projectToken: unknown,
	): boolean {
		if (!isCurrent(sourceId, generation)) return false;
		if (projectToken !== null) dependencies.assertProject(projectToken);
		return dependencies.getProject() === project;
	}

	async function dropVisual(sourceId: string): Promise<boolean> {
		const record = videoVisuals.get(sourceId);
		if (!record) return false;
		videoVisuals.delete(sourceId);
		unregisterVideoTimingIndex(sourceId);
		await cleanupRecord(record);
		return true;
	}

	async function cleanupLate(
		urls: readonly string[],
		lease: LinkedVideoPlaybackLease | null,
	): Promise<null> {
		await cleanupOwnedResources(urls, lease);
		return null;
	}

	async function failActivation(
		error: unknown,
		urls: readonly string[],
		lease: LinkedVideoPlaybackLease | null,
	): Promise<never> {
		try {
			await cleanupOwnedResources(urls, lease);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Video visual activation and cleanup both failed.',
				{ cause: cleanupError },
			);
		}
		throw error;
	}

	async function cleanupRecords(records: readonly Readonly<VideoVisualRecord>[]): Promise<void> {
		const errors: unknown[] = [];
		for (const record of records) {
			try { await cleanupRecord(record); } catch (error) { errors.push(error); }
		}
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'Multiple video visual cleanups failed.');
	}

	function cleanupRecord(record: Readonly<VideoVisualRecord>): Promise<void> {
		return cleanupOwnedResources(record.objectUrls, record.linkedPlaybackLease);
	}

	async function cleanupOwnedResources(
		urls: readonly string[],
		lease: LinkedVideoPlaybackLease | null,
	): Promise<void> {
		const errors: unknown[] = [];
		try { revokeUrls(urls); } catch (error) { errors.push(error); }
		try { await lease?.release(); } catch (error) { errors.push(error); }
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'Video visual resource cleanup failed.');
	}

	function revokeUrls(urls: readonly (string | null | undefined)[]): void {
		for (const url of new Set(urls.filter((value): value is string => Boolean(value)))) {
			dependencies.url.revokeObjectURL(url);
		}
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Video visual activation cancelled.', 'AbortError');
	const error = new Error('Video visual activation cancelled.');
	error.name = 'AbortError';
	throw error;
}
function findSource(project: ProjectVisualProject, sourceId: string): ProjectVisualSource | null {
	return project.sources.find((source) => source.id === sourceId) ?? null;
}
function findClipTrack(project: ProjectVisualProject, clipId: string): ProjectVisualTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) ?? null;
}

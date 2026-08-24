/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VideoSourceUpgradeRefusedError,
	planVideoSourceUpgrade,
	type VideoSourceUpgradePlan,
} from '../video-source-upgrade.ts';
import { createFfmpegVideoTimingProbe, probeVideoTiming, type VideoTimingProbePort } from '../video-timing-probe.ts';
import { digestMediaContent } from '../storage/media-content-digest.ts';
import { publishVideoTimingAsset, type VideoTimingMediaStore } from '../video-timing-storage.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

/**
 * Re-read an already-imported video source.
 *
 * The upgrade probes the bytes the document already names — it never writes
 * media, never conforms, and never repairs by inference. What it may conclude is
 * owned by `video-source-upgrade.ts`; what this service owns is getting the same
 * bytes back, proving they are the same bytes, and landing the conclusion as one
 * command while the project it was planned against is still the live one.
 */

type DataRecord = Readonly<Record<string, unknown>>;

interface FrameExtractorMetadata {
	readonly width: number;
	readonly height: number;
}

interface FrameExtractor {
	readonly metadata: FrameExtractorMetadata;
	dispose(): void;
}

export interface VideoSourceReprobeStore extends VideoTimingMediaStore {
	resolveLinkedVideoOriginal?(
		projectId: string,
		source: DataRecord,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Readonly<{ blob?: Blob | null }> | null>;
}

export interface VideoSourceReprobeDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly store: VideoSourceReprobeStore;
	readonly ffmpeg: DataRecord;
	/** The native helper probe, ordered ahead of the wasm probe when present. */
	readonly helperTimingProbe?: VideoTimingProbePort | null;
	getProject(): DataRecord;
	captureProject(): unknown;
	assertProject(token: unknown): void;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	publishProjectState(): void;
	createAudioEditorVideoFrameExtractor(media: Blob): PromiseLike<FrameExtractor> | FrameExtractor;
	activateVideoSource(source: DataRecord, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown>;
}

export interface VideoSourceReprobeResult {
	readonly sourceId: string;
	/** False when the re-read agreed with the document and nothing was committed. */
	readonly upgraded: boolean;
	readonly changedFields: readonly string[];
	readonly clampedClipIds: readonly string[];
}

export interface VideoSourceReprobeService {
	reprobe(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<VideoSourceReprobeResult>;
}

export function createVideoSourceReprobeService(
	dependencies: VideoSourceReprobeDependencies,
): Readonly<VideoSourceReprobeService> {
	async function reprobe(
		sourceId: string,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<VideoSourceReprobeResult> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		const startingProject = dependencies.getProject();
		const source = requireVideoSource(startingProject, sourceId);
		const projectToken = dependencies.captureProject();
		const media = await loadSourceMedia(dependencies, startingProject, source, options.signal);
		const contentSha256 = await digestMediaContent(media);
		if (contentSha256 !== source.contentSha256) {
			// The bytes are the source's identity. Different bytes behind the same
			// key are a relink question, and this operation does not answer it.
			throw new VideoSourceUpgradeRefusedError(
				'content-changed',
				'The stored media no longer matches the content this source describes.',
			);
		}
		const ffmpegProbe = createFfmpegVideoTimingProbe(dependencies.ffmpeg);
		// The helper probe leads and the wasm probe visibly takes over on its
		// failure, matching import, proxy, and capture; re-probe was the one
		// surface that never attempted the helper it is documented to drive.
		const probe = await probeVideoTiming(media, {
			probes: [dependencies.helperTimingProbe ?? null, ffmpegProbe]
				.filter((candidate): candidate is VideoTimingProbePort => Boolean(candidate)),
			signal: options.signal,
		});
		const presented = await presentedSize(dependencies, media);
		const published = probe.decision === 'timing-asset'
			? await publishVideoTimingAsset(dependencies.store, contentSha256, probe.timing, options)
			: null;
		let plan: VideoSourceUpgradePlan;
		try {
			dependencies.assertProject(projectToken);
			const current = dependencies.getProject();
			plan = planVideoSourceUpgrade({
				source: requireVideoSource(current, sourceId),
				probe,
				timingAsset: published?.reference,
				presented,
				clips: allProjectClips(current),
			});
			if (plan.upgraded) {
				dependencies.commit({
					type: 'source/reprobe',
					sourceId: plan.sourceId,
					changes: plan.changes,
					clips: plan.clips,
				} as AudioEditorCommand);
			}
		} catch (error) {
			// An asset nothing references is reclaimable, and leaving it behind
			// would occupy an immutable key with content no document names.
			await published?.publication?.discardIfCurrent().catch(() => undefined);
			throw error;
		}
		if (plan.upgraded) {
			// The registered timing index came from the old reading, so the preview
			// and export must be re-bound to what the document now says.
			const upgraded = findVideoSource(dependencies.getProject(), sourceId);
			if (upgraded) await dependencies.activateVideoSource(upgraded, options);
			dependencies.publishProjectState();
		}
		return Object.freeze({
			sourceId,
			upgraded: plan.upgraded,
			changedFields: plan.changedFields,
			clampedClipIds: plan.clampedClipIds,
		});
	}

	return Object.freeze({ reprobe });
}

async function loadSourceMedia(
	dependencies: VideoSourceReprobeDependencies,
	project: DataRecord,
	source: DataRecord,
	signal?: AbortSignal,
): Promise<Blob> {
	const storageKey = String(source.storageKey || source.id);
	const stored = await dependencies.store.loadMediaAsset(storageKey, { signal });
	if (stored) return stored;
	const projectId = typeof project.id === 'string' ? project.id : null;
	const resolve = dependencies.store.resolveLinkedVideoOriginal;
	const linked = projectId && resolve
		? await resolve.call(dependencies.store, projectId, source, { signal })
		: null;
	if (linked?.blob) return linked.blob;
	// A linked original leased for playback alone exposes a URL and no bytes; a
	// probe needs bytes, so the upgrade says so instead of guessing from a URL.
	throw new VideoSourceUpgradeRefusedError(
		'media-unavailable',
		'The original video file could not be read back for a re-probe.',
	);
}

/** What this engine's decoder presents, which is what the document records. */
async function presentedSize(
	dependencies: VideoSourceReprobeDependencies,
	media: Blob,
): Promise<Readonly<{ width: number; height: number }> | null> {
	let extractor: FrameExtractor | null = null;
	try {
		extractor = await dependencies.createAudioEditorVideoFrameExtractor(media);
		const { width, height } = extractor.metadata;
		if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return null;
		return Object.freeze({ width, height });
	} catch {
		// A decoder that will not open the file cannot correct the presented size;
		// the probe's reading of the same bytes still stands on its own.
		return null;
	} finally {
		try { extractor?.dispose(); } catch { /* Disposable probe helper. */ }
	}
}

function allProjectClips(project: DataRecord): readonly unknown[] {
	const timeline = Array.isArray(project.clips) ? project.clips : [];
	const bin = isRecord(project.projectBin) && Array.isArray(project.projectBin.clips)
		? project.projectBin.clips
		: [];
	return [...timeline, ...bin];
}

function requireVideoSource(project: DataRecord, sourceId: string): DataRecord {
	const source = findVideoSource(project, sourceId);
	if (!source) throw new ReferenceError(`Unknown video source: ${sourceId}.`);
	return source;
}

function findVideoSource(project: DataRecord, sourceId: string): DataRecord | null {
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	const source = sources.find((candidate) => isRecord(candidate)
		&& candidate.id === sourceId && candidate.kind === 'video');
	return isRecord(source) ? source : null;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

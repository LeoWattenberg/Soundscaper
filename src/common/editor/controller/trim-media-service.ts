/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Binding the trim operation to the project's real storage and FFmpeg.
 *
 * The operation decides the sequencing and owns the refusals; this only says
 * what its ports mean here. Three of those meanings matter.
 *
 * **A trimmed copy is written under a new key.** Consolidating writes a source's
 * own bytes back under its own key, so it may reuse it; trimming produces
 * different bytes, and overwriting the key the document still points at would
 * destroy the only thing an undo could restore. The key is derived from the
 * digest of what was written, so trimming the same source to the same runs
 * twice lands on the same body rather than accumulating copies.
 *
 * **Rebinding is not a storage operation at all.** The document is what points
 * a source at its media, so the rebind here only confirms the source is still
 * the one that was planned against; the actual move is the command batch
 * `createTrimMediaProjectEdit` builds, which is what makes the trim undoable.
 *
 * **Only video is cut here.** The cut is a keyframe-aligned stream copy, which
 * is a video idea; an audio source has no keyframes and its trim would be a
 * different operation with a different proof. Audio sources are reported as
 * refused rather than silently skipped, so a project that expected to reclaim
 * their space is told it did not.
 */

import {
	createTrimMediaPlan,
	type TrimMediaPlan,
} from '../trim-media-plan.ts';
import {
	runTrimMedia,
	type TrimMediaPorts,
	type TrimMediaRunResult,
} from '../trim-media-operation.ts';
import {
	createTrimMediaProjectEdit,
	type TrimMediaProjectEdit,
} from '../trim-media-project-edit.ts';
import { executeTrimMediaCopy, type TrimMediaFfmpegRuntime } from './trim-media-execution.ts';
import { trimMediaContainerForMimeType } from '../trim-media-ffmpeg.ts';

export interface TrimMediaStore {
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<BlobLike | null>;
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Promise<MediaAssetWriterLike>;
}

interface BlobLike {
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

interface MediaAssetWriterLike {
	readonly maximumChunkBytes: number;
	write(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	commit(options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown>;
	abort(): Promise<void>;
}

export interface TrimMediaFfmpegHost {
	runTrimMediaOperation<Output>(
		operation: (lease: TrimMediaFfmpegRuntime) => Promise<Output>,
		settings?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Output>;
}

export interface TrimMediaProjectRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly store: TrimMediaStore;
	readonly ffmpeg: TrimMediaFfmpegHost;
	/** Extra frames kept either side of every reference. */
	readonly handleFrames?: number;
	/** Sources whose bytes are somebody else's file, and are never rewritten. */
	readonly linkedSourceIds?: Iterable<string>;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	readonly onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}

export interface TrimMediaProjectResult {
	readonly plan: TrimMediaPlan;
	readonly run: TrimMediaRunResult;
	readonly edit: TrimMediaProjectEdit;
}

/** What trimming would discard, without writing anything. */
export function planProjectTrim(request: TrimMediaProjectRequest): TrimMediaPlan {
	return createTrimMediaPlan({
		project: request.project,
		...(request.handleFrames === undefined ? {} : { handleFrames: request.handleFrames }),
	});
}

/** Plan, cut, and build the batch that moves the document onto the result. */
export async function trimProjectMedia(
	request: TrimMediaProjectRequest,
): Promise<TrimMediaProjectResult> {
	const plan = planProjectTrim(request);
	const digests = new Map<string, string>();
	const run = await runTrimMedia({
		plan,
		linkedSourceIds: [...(request.linkedSourceIds ?? [])],
		unsupportedSourceIds: nonVideoSourceIds(request.project),
	}, createTrimMediaPorts(request, digests), {
		...(request.signal ? { signal: request.signal } : {}),
		...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
		...(request.onProgress ? { onProgress: request.onProgress } : {}),
	});
	const edit = createTrimMediaProjectEdit({
		project: request.project,
		results: run.sources,
		contentSha256: Object.fromEntries(digests),
	});
	return Object.freeze({ plan, run, edit });
}

export function createTrimMediaPorts(
	request: TrimMediaProjectRequest,
	digests: Map<string, string> = new Map(),
): TrimMediaPorts {
	const sources = new Map(projectSources(request.project).map((source) => [String(source.id ?? ''), source]));
	const ports: TrimMediaPorts = {
		async writeTrimmedCopy(source, _runs, options) {
			const record = sources.get(source.sourceId);
			if (!record) throw new Error(`The project no longer contains source ${source.sourceId}.`);
			const storageKeyIn = String(record.storageKey ?? source.sourceId);
			const blob = await request.store.loadMediaAsset(storageKeyIn, options);
			if (!blob) throw new Error(`The media for ${source.sourceId} could not be read.`);
			const { container, extension } = trimMediaContainerForMimeType(String(record.mimeType ?? ''));
			const bytes = new Uint8Array(await blob.arrayBuffer());
			const cut = await request.ffmpeg.runTrimMediaOperation(
				(lease) => executeTrimMediaCopy(lease, {
					source,
					bytes,
					frameRate: rationalRate(record.frameRate),
					container,
					extension,
					...(options.signal ? { signal: options.signal } : {}),
				}),
				options.signal ? { signal: options.signal } : {},
			);
			const sha256 = await digestHex(cut.bytes);
			digests.set(source.sourceId, sha256);
			// Content-addressed, so trimming the same source to the same runs twice
			// lands on one body rather than accumulating copies — and never on the
			// key the document still points at, which an undo has to restore.
			const storageKey = `${source.sourceId}.trim.${sha256.slice(0, 16)}`;
			await writeManaged(request, storageKey, cut.bytes, sha256, options.signal);
			return Object.freeze({
				storageKey,
				frameCount: cut.frameCount,
				byteLength: cut.bytes.byteLength,
				runs: cut.runs,
			});
		},
		async rebind(rebindRequest) {
			// The document does the rebinding, in the command batch built from this
			// run. All that is confirmed here is that the source planned against is
			// still the one in the project.
			return sources.has(rebindRequest.sourceId);
		},
		async discardTrimmedCopy(storageKey) {
			// Deliberately nothing. A managed body is immutable once committed and
			// an unreferenced one is collected by ordinary media maintenance; a
			// content-addressed key may also already be another trim's body.
			void storageKey;
		},
	};
	return Object.freeze(ports);
}

async function writeManaged(
	request: TrimMediaProjectRequest,
	storageKey: string,
	bytes: Uint8Array,
	sha256: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const writer = await request.store.beginMediaAssetWrite(storageKey, { mimeType: '' }, {
		expectedBytes: bytes.byteLength,
		expectedSha256: sha256,
		...(signal ? { signal } : {}),
	});
	try {
		for (let offset = 0; offset < bytes.byteLength; offset += writer.maximumChunkBytes) {
			await writer.write(
				bytes.subarray(offset, Math.min(bytes.byteLength, offset + writer.maximumChunkBytes)),
				signal ? { signal } : undefined,
			);
		}
		await writer.commit(signal ? { signal } : undefined);
	} catch (error) {
		await writer.abort().catch(() => undefined);
		throw error;
	}
}

/** Everything that is not a video source, which this operation does not cut. */
function nonVideoSourceIds(project: Readonly<Record<string, unknown>>): readonly string[] {
	return projectSources(project)
		.filter((source) => source.kind !== 'video')
		.map((source) => String(source.id ?? ''))
		.filter(Boolean);
}

function rationalRate(value: unknown): Readonly<{ num: number; den: number }> {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Object.freeze({ num: Math.round(value * 1000), den: 1000 });
	}
	if (value && typeof value === 'object') {
		const record = value as Readonly<Record<string, unknown>>;
		const num = Number(record.num);
		const den = Number(record.den);
		if (Number.isSafeInteger(num) && num > 0 && Number.isSafeInteger(den) && den > 0) {
			return Object.freeze({ num, den });
		}
	}
	throw new TypeError('Trimming a video source requires its frame rate.');
}

async function digestHex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function projectSources(
	project: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] {
	const sources = project?.sources;
	return (Array.isArray(sources) ? sources : []).filter(
		(value): value is Readonly<Record<string, unknown>> => Boolean(value) && typeof value === 'object',
	);
}

export type { TrimMediaPlan, TrimMediaRunResult, TrimMediaProjectEdit };

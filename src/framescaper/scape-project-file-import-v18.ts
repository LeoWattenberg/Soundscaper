/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	aggregateScapeErrors,
	awaitScapeOperation,
	throwIfScapeAborted,
} from '../common/editor/scape-abort.ts';
import type { ScapeArchiveEntry } from '../common/editor/scape-archive-envelope.ts';
import {
	createScapeDigest,
	extractScapeAudio,
	scapeAudioSourceStream,
	scapeHex,
	verifyScapeExtractedAsset,
} from '../common/editor/scape-archive-media.ts';
import { extractScapeVideo } from '../common/editor/scape-archive-video.ts';
import { ScapeAudioChunkBudget, type ScapeExpandedByteBudget } from '../common/editor/scape-expanded-byte-budget.ts';
import { preflightScapeImportCapacity } from '../common/editor/scape-import-capacity.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import type { OwnedMediaAssetPublication, OwnedMediaAssetWriter } from '../common/editor/storage/media-asset-write-contract.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	normalizeVideoTimingAssetReference,
	validateVideoTimingAssetBytes,
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import type {
	FramescaperScapeAssetDescriptorV18,
	FramescaperScapeManifestV18,
} from './scape-project-file-envelope-v18.ts';
import type { FramescaperScapeArchivePublicationRequestV18 } from './scape-project-preservation-v18.ts';

const AUDIO_ENCODING = 'audio-f32le-chunks-v1';

interface AudioWriter {
	write(channels: readonly Float32Array[], options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown>;
	commit(
		metadata?: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal; ifAbsent?: boolean }>,
	): PromiseLike<Readonly<Record<string, unknown>>>;
	abort(): PromiseLike<unknown>;
}

export interface FramescaperScapeCanonicalImportStoreV18 {
	estimateStorage?(): PromiseLike<unknown> | unknown;
	getSourceMetadata?(sourceId: string): PromiseLike<unknown> | unknown;
	readSourceChunks?(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<readonly Float32Array[] | Readonly<{ channels?: readonly Float32Array[] }>>;
	beginSourceWrite?(
		sourceId: string,
		metadata?: Readonly<Record<string, unknown>>,
	): PromiseLike<AudioWriter> | AudioWriter;
	discardSourceIfCurrent?(source: Readonly<Record<string, unknown>>): PromiseLike<boolean> | boolean;
	getMediaAssetMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	loadMediaAsset(sourceId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): PromiseLike<OwnedMediaAssetWriter> | OwnedMediaAssetWriter;
}

export interface FramescaperScapeCanonicalStageContextInternalV18 {
	readonly manifest: FramescaperScapeManifestV18;
	readonly project: FramescaperProjectV18;
	readonly publication: FramescaperScapeArchivePublicationRequestV18;
	readonly entryByName: ReadonlyMap<string, ScapeArchiveEntry>;
	readonly expandedByteBudget: ScapeExpandedByteBudget;
	readonly signal?: AbortSignal;
}

interface CleanupCapability {
	cleanup(): PromiseLike<unknown> | unknown;
}

/** Owns canonical archive bodies until the sibling project transaction roots them. */
export class FramescaperScapeCanonicalImportV18 {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #store: FramescaperScapeCanonicalImportStoreV18;
	readonly #cleanup: CleanupCapability[] = [];
	#state: 'open' | 'complete' | 'rolled-back' = 'open';

	constructor(
		profile: EditorProjectRuntimeProfile | unknown,
		store: FramescaperScapeCanonicalImportStoreV18 | unknown,
	) {
		assertFramescaperProjectV18Profile(profile);
		assertStore(store);
		this.#profile = profile;
		this.#store = store;
	}

	async stage(context: FramescaperScapeCanonicalStageContextInternalV18): Promise<void> {
		if (this.#state !== 'open' || this.#cleanup.length !== 0) {
			throw new Error('The V18 canonical import transaction cannot be reused.');
		}
		throwIfScapeAborted(context.signal);
		await preflightScapeImportCapacity(context.manifest, {
			estimateStorage: typeof this.#store.estimateStorage === 'function'
				? () => this.#store.estimateStorage!()
				: null,
			...(context.signal ? { signal: context.signal } : {}),
		});
		const origin = cloneFramescaperProjectV18(this.#profile, context.project);
		const target = publicationProject(this.#profile, origin, context.publication);
		const pairs = pairSources(origin, target);
		const descriptors = new Map(context.manifest.assets.map((asset) => [asset.sourceId, asset]));
		const proxyKeys = proxyBodyKeys(origin);
		const audioBudget = new ScapeAudioChunkBudget();
		try {
			for (const { originSource, targetSource } of pairs) {
				throwIfScapeAborted(context.signal);
				const descriptor = requiredCanonicalDescriptor(descriptors, String(originSource.id), proxyKeys);
				const entry = requiredEntry(context.entryByName, descriptor.entry);
				if (originSource.kind === 'video') {
					await this.#stageMedia(
						String(targetSource.storageKey ?? targetSource.id), descriptor, entry, null, context,
					);
					const originTiming = timingReference(originSource.timingAsset);
					const targetTiming = timingReference(targetSource.timingAsset);
					if ((originTiming === null) !== (targetTiming === null)
						|| (originTiming && targetTiming && JSON.stringify(originTiming) !== JSON.stringify(targetTiming))) {
						throw new Error('A V18 archive target changed canonical video timing authority.');
					}
					if (originTiming) {
						const timingDescriptor = requiredCanonicalDescriptor(
							descriptors, originTiming.storageKey, proxyKeys,
						);
						await this.#stageMedia(
							targetTiming!.storageKey,
							timingDescriptor,
							requiredEntry(context.entryByName, timingDescriptor.entry),
							targetTiming,
							context,
						);
					}
				} else {
					await this.#stageAudio(targetSource, descriptor, entry, context, audioBudget);
				}
			}
		} catch (error) {
			return this.rollback(error);
		}
	}

	complete(): void {
		if (this.#state !== 'open') throw new Error('The V18 canonical import transaction is closed.');
		this.#state = 'complete';
		this.#cleanup.length = 0;
	}

	async discard(): Promise<void> {
		if (this.#state === 'complete') return;
		this.#state = 'rolled-back';
		const failures = await this.#runCleanup();
		if (failures.length) {
			throw new AggregateError(failures, 'The V18 canonical archive bodies could not be discarded.');
		}
	}

	async rollback(primary: unknown): Promise<never> {
		if (this.#state === 'complete') throw primary;
		this.#state = 'rolled-back';
		const failures = await this.#runCleanup();
		throw aggregateScapeErrors(
			primary,
			failures,
			'The V18 canonical archive import and rollback both failed.',
		);
	}

	async #runCleanup(): Promise<unknown[]> {
		const failures: unknown[] = [];
		for (const capability of [...this.#cleanup].reverse()) {
			try { await capability.cleanup(); } catch (error) { failures.push(error); }
		}
		this.#cleanup.length = 0;
		return failures;
	}

	async #stageAudio(
		targetSource: Record<string, unknown>,
		descriptor: FramescaperScapeAssetDescriptorV18,
		entry: ScapeArchiveEntry,
		context: FramescaperScapeCanonicalStageContextInternalV18,
		audioBudget: ScapeAudioChunkBudget,
	): Promise<void> {
		if (descriptor.kind !== 'audio' || descriptor.encoding !== AUDIO_ENCODING) {
			throw new Error('A canonical audio descriptor has an unsupported role.');
		}
		const storageKey = String(targetSource.storageKey ?? targetSource.id);
		const existing = await this.#store.getSourceMetadata!(storageKey);
		if (existing !== null && existing !== undefined) {
			await verifyStoredAudio(this.#store, targetSource, descriptor, context.signal, audioBudget);
			return;
		}
		const writer = await this.#store.beginSourceWrite!(storageKey, sourceMetadata(targetSource));
		assertAudioWriter(writer);
		let committed: Readonly<Record<string, unknown>> | null = null;
		try {
			const extracted = await extractScapeAudio(
				entry,
				writer,
				targetSource as never,
				context.signal,
				context.expandedByteBudget,
				audioBudget,
			);
			verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, storageKey);
			committed = await awaitScapeOperation(writer.commit({
				sampleRate: targetSource.sampleRate,
				channelCount: targetSource.channelCount,
				chunkFrames: targetSource.chunkFrames,
			}, { ...(context.signal ? { signal: context.signal } : {}), ifAbsent: true }), context.signal);
			this.#cleanup.push({ cleanup: () => this.#store.discardSourceIfCurrent!(committed!) });
		} catch (error) {
			try { if (!committed) await writer.abort(); }
			catch (cleanupError) {
				throw aggregateScapeErrors(error, [cleanupError], 'The V18 audio stage and abort both failed.');
			}
			throw error;
		}
	}

	async #stageMedia(
		storageKey: string,
		descriptor: FramescaperScapeAssetDescriptorV18,
		entry: ScapeArchiveEntry,
		timing: Readonly<VideoTimingAssetReference> | null,
		context: FramescaperScapeCanonicalStageContextInternalV18,
	): Promise<void> {
		const existing = await this.#store.getMediaAssetMetadata(storageKey);
		if (existing !== null && existing !== undefined) {
			await verifyStoredMedia(this.#store, storageKey, descriptor, timing, context.signal);
			return;
		}
		const writer = await this.#store.beginMediaAssetWrite(storageKey, {
			name: descriptor.entry,
			kind: descriptor.kind,
			encoding: descriptor.encoding,
			mimeType: descriptor.mimeType ?? '',
			...(timing ? timingSummary(timing) : {}),
		}, {
			expectedBytes: descriptor.size,
			expectedSha256: descriptor.sha256,
			...(context.signal ? { signal: context.signal } : {}),
		});
		assertOwnedWriter(writer);
		let publication: OwnedMediaAssetPublication | null = null;
		const timingChunks: Uint8Array[] = [];
		try {
			const sink = timing ? captureWriter(writer, timingChunks) : writer;
			const extracted = await extractScapeVideo(entry, sink, context.signal, context.expandedByteBudget);
			verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, storageKey);
			if (timing) validateVideoTimingAssetBytes(timing, join(timingChunks, descriptor.size));
			publication = await writer.commitOwned(context.signal ? { signal: context.signal } : {});
			assertPublishedMetadata(publication.metadata, descriptor);
			this.#cleanup.push({ cleanup: () => publication!.discardIfCurrent() });
		} catch (error) {
			try {
				if (publication) await publication.discardIfCurrent();
				else await writer.abort();
			} catch (cleanupError) {
				throw aggregateScapeErrors(error, [cleanupError], 'The V18 media stage and abort both failed.');
			}
			throw error;
		}
	}
}

async function verifyStoredAudio(
	store: FramescaperScapeCanonicalImportStoreV18,
	source: Record<string, unknown>,
	descriptor: FramescaperScapeAssetDescriptorV18,
	signal: AbortSignal | undefined,
	audioBudget: ScapeAudioChunkBudget,
): Promise<void> {
	const digest = createScapeDigest();
	let size = 0;
	const stream = scapeAudioSourceStream(
		store as Required<Pick<FramescaperScapeCanonicalImportStoreV18, 'readSourceChunks'>>,
		source as never,
		digest,
		(bytes) => { size += bytes; },
		signal,
		audioBudget,
	);
	const reader = stream.getReader();
	try { while (!(await reader.read()).done) throwIfScapeAborted(signal); }
	finally { reader.releaseLock(); }
	verifyScapeExtractedAsset(descriptor, scapeHex(digest.digest()), size, String(source.id));
}

async function verifyStoredMedia(
	store: FramescaperScapeCanonicalImportStoreV18,
	storageKey: string,
	descriptor: FramescaperScapeAssetDescriptorV18,
	timing: Readonly<VideoTimingAssetReference> | null,
	signal?: AbortSignal,
): Promise<void> {
	const metadata = await store.getMediaAssetMetadata(storageKey) as Record<string, unknown> | null;
	assertPublishedMetadata(metadata, descriptor);
	const body = canonicalMediaContentBlob(await store.loadMediaAsset(storageKey, signal ? { signal } : {}));
	if (body.size !== descriptor.size) throw new Error(`Canonical body ${storageKey} changed size.`);
	const digest = createScapeDigest();
	const reader = body.stream().getReader();
	const timingBytes = timing ? new Uint8Array(descriptor.size) : null;
	let offset = 0;
	try {
		while (true) {
			throwIfScapeAborted(signal);
			const next = await reader.read();
			if (next.done) break;
			const bytes = next.value;
			digest.update(bytes);
			if (timingBytes) { timingBytes.set(bytes, offset); offset += bytes.byteLength; }
		}
	} finally { reader.releaseLock(); }
	if (scapeHex(digest.digest()) !== descriptor.sha256) throw new Error(`Canonical body ${storageKey} changed digest.`);
	if (timing) validateVideoTimingAssetBytes(timing, timingBytes!);
}

function publicationProject(
	profile: EditorProjectRuntimeProfile,
	origin: FramescaperProjectV18,
	publication: FramescaperScapeArchivePublicationRequestV18,
): FramescaperProjectV18 {
	return publication.mode === 'create'
		? origin
		: cloneFramescaperProjectV18(profile, publication.project);
}

function pairSources(origin: FramescaperProjectV18, target: FramescaperProjectV18) {
	if (origin.sources.length !== target.sources.length) throw new Error('A V18 archive target changed source inventory.');
	return origin.sources.map((originValue, index) => {
		const targetValue = target.sources[index];
		if (!targetValue || originValue.kind !== targetValue.kind) {
			throw new Error('A V18 archive target changed canonical source order or kind.');
		}
		return {
			originSource: originValue as unknown as Record<string, unknown>,
			targetSource: targetValue as unknown as Record<string, unknown>,
		};
	});
}

function proxyBodyKeys(project: FramescaperProjectV18): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const source of project.sources) {
		if (source.kind !== 'video' || source.proxyAttachment === null) continue;
		keys.add(source.proxyAttachment.storageKey);
		keys.add(source.proxyAttachment.timingAsset.storageKey);
	}
	return keys;
}

function requiredCanonicalDescriptor(
	descriptors: ReadonlyMap<string, FramescaperScapeAssetDescriptorV18>,
	sourceId: string,
	proxyKeys: ReadonlySet<string>,
): FramescaperScapeAssetDescriptorV18 {
	if (proxyKeys.has(sourceId)) throw new Error('A proxy body cannot be staged as canonical media.');
	const descriptor = descriptors.get(sourceId);
	if (!descriptor || descriptor.kind === 'video-proxy') {
		throw new Error(`Missing canonical Scape descriptor: ${sourceId}.`);
	}
	return descriptor;
}

function requiredEntry(entries: ReadonlyMap<string, ScapeArchiveEntry>, name: string): ScapeArchiveEntry {
	const entry = entries.get(name);
	if (!entry?.getData) throw new Error(`The .scape archive is missing ${name}.`);
	return entry;
}

function timingReference(value: unknown): Readonly<VideoTimingAssetReference> | null {
	return value === null || value === undefined ? null : normalizeVideoTimingAssetReference(value);
}

function sourceMetadata(source: Record<string, unknown>): Readonly<Record<string, unknown>> {
	return {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	};
}

function timingSummary(timing: Readonly<VideoTimingAssetReference>): Readonly<Record<string, unknown>> {
	return {
		frameCount: timing.frameCount,
		timescale: timing.timescale,
		finalFrameDurationTicks: timing.finalFrameDurationTicks,
	};
}

function captureWriter(writer: OwnedMediaAssetWriter, chunks: Uint8Array[]): OwnedMediaAssetWriter {
	return {
		maximumChunkBytes: writer.maximumChunkBytes,
		get bytesWritten() { return writer.bytesWritten; },
		async write(bytes, options) { chunks.push(bytes.slice()); await writer.write(bytes, options); },
		commit: (options) => writer.commit(options),
		commitOwned: (options) => writer.commitOwned(options),
		abort: () => writer.abort(),
	};
}

function join(chunks: readonly Uint8Array[], size: number): Uint8Array {
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	if (offset !== size) throw new Error('A V18 timing body ended before its admitted size.');
	return output;
}

function assertStore(value: unknown): asserts value is FramescaperScapeCanonicalImportStoreV18 {
	if (!value || typeof value !== 'object') throw new TypeError('An exact V18 canonical import store is required.');
	const store = value as Record<string, unknown>;
	for (const method of [
		'getSourceMetadata', 'readSourceChunks', 'beginSourceWrite', 'discardSourceIfCurrent',
		'getMediaAssetMetadata', 'loadMediaAsset', 'beginMediaAssetWrite',
	]) if (typeof store[method] !== 'function') throw new TypeError(`The V18 canonical store requires ${method}.`);
}

function assertAudioWriter(value: unknown): asserts value is AudioWriter {
	const writer = value as Partial<AudioWriter> | null;
	if (!writer || typeof writer.write !== 'function' || typeof writer.commit !== 'function'
		|| typeof writer.abort !== 'function') throw new TypeError('An ownership-aware audio writer is required.');
}

function assertOwnedWriter(value: unknown): asserts value is OwnedMediaAssetWriter {
	if (!value || typeof value !== 'object' || typeof (value as OwnedMediaAssetWriter).commitOwned !== 'function') {
		throw new TypeError('An ownership-aware media writer is required.');
	}
}

function assertPublishedMetadata(
	value: unknown,
	descriptor: FramescaperScapeAssetDescriptorV18,
): void {
	const metadata = value && typeof value === 'object' ? value as Record<string, unknown> : null;
	if (!metadata || metadata.sha256 !== descriptor.sha256 || metadata.size !== descriptor.size
		|| (metadata.mimeType ?? '') !== (descriptor.mimeType ?? '')) {
		throw new Error(`Persisted canonical body ${descriptor.sourceId} failed verification.`);
	}
}

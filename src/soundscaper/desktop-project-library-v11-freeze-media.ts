/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry } from '../common/editor/scape-archive-envelope.ts'
import { SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts'
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts'
import {
	createScapeDigest,
	extractScapeAudio,
	scapeAudioSourceLayout,
	scapeAudioSourceStream,
	scapeHex,
	verifyScapeExtractedAsset,
	type ScapeAudioSource,
} from '../common/editor/scape-archive-media.ts'
import {
	ScapeAudioChunkBudget,
	ScapeExpandedByteBudget,
} from '../common/editor/scape-expanded-byte-budget.ts'
import type { StorageRecord } from '../common/editor/storage/media-records.ts'
import type { AudioSourceWriter } from '../common/editor/storage/source-write-repository.ts'
import type { SoundscaperProductionProject } from './editor-project-production-validation.ts'
import {
	SOUNDSCAPER_DESKTOP_V11_MAXIMUM_CHUNK_BYTES,
	validateSoundscaperDesktopV11BodyChunk,
	type SoundscaperDesktopV11Body,
	type SoundscaperDesktopV11BundleSnapshot,
	type SoundscaperDesktopV11RendererBridge,
} from './desktop-project-library-v11-renderer-contract.ts'

interface FreezeSource extends ScapeAudioSource {
	readonly storageKey: string
	readonly sampleRate: number
	readonly mimeType: string
	readonly contentSha256: string
}

export interface SoundscaperDesktopV11FreezeStore {
	getSourceMetadata(sourceId: string): PromiseLike<unknown> | unknown
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<readonly Float32Array[] | Readonly<{ channels?: readonly Float32Array[] }>>
	beginSourceWrite(sourceId: string, metadata?: Record<string, unknown>): Promise<AudioSourceWriter>
	discardSourceIfCurrent(source: StorageRecord): PromiseLike<boolean> | boolean
}

export interface SoundscaperDesktopV11FreezeAcquisition {
	readonly acquiredBodyCount: number
	commit(): void
	rollback(): Promise<void>
}

/** Acquire every declared freeze body before publishing its exact shadow. */
export async function acquireSoundscaperDesktopV11FreezeBodies(
	snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>,
	bridge: Pick<SoundscaperDesktopV11RendererBridge, 'readBodyChunk'>,
	store: SoundscaperDesktopV11FreezeStore,
	signal?: AbortSignal,
): Promise<SoundscaperDesktopV11FreezeAcquisition> {
	preflightBodies(snapshot)
	const acquired: StorageRecord[] = []
	let settled = false
	const rollback = async (): Promise<void> => {
		if (settled) return
		settled = true
		const failures: unknown[] = []
		for (const record of acquired.reverse()) {
			try { await store.discardSourceIfCurrent(record) }
			catch (error) { failures.push(error) }
		}
		if (failures.length === 1) throw failures[0]
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Soundscaper desktop freeze-body rollback failed.')
		}
	}
	try {
		for (const body of snapshot.bundle.bodies) {
			throwIfScapeAborted(signal)
			const source = freezeSource(snapshot.project, body)
			const metadata = await store.getSourceMetadata(body.storageKey)
			throwIfScapeAborted(signal)
			if (metadata !== null && metadata !== undefined) {
				await assertStoredBody(source, body, metadata, store, signal)
				continue
			}
			acquired.push(await acquireBody(snapshot, source, body, bridge, store, signal))
		}
		return Object.freeze({
			acquiredBodyCount: acquired.length,
			commit() { settled = true },
			rollback,
		})
	} catch (error) {
		try { await rollback() }
		catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Soundscaper desktop freeze-body acquisition and rollback failed.',
			)
		}
		throw error
	}
}

/** Stream one canonical local freeze body, refusing geometry, length, or digest drift. */
export async function streamSoundscaperDesktopV11FreezeBody(
	project: SoundscaperProductionProject,
	body: Readonly<SoundscaperDesktopV11Body>,
	store: Pick<SoundscaperDesktopV11FreezeStore, 'readSourceChunks'>,
	onChunk: (offset: number, bytes: Uint8Array, final: boolean) => PromiseLike<void> | void,
	signal?: AbortSignal,
): Promise<void> {
	const source = freezeSource(project, body)
	const digest = createScapeDigest()
	let emitted = 0
	const reader = scapeAudioSourceStream(
		store,
		source,
		digest,
		(length) => { emitted += length },
		signal,
	).getReader()
	let delivered = 0
	try {
		while (true) {
			throwIfScapeAborted(signal)
			const next = await reader.read()
			if (next.done) break
			for (let offset = 0; offset < next.value.byteLength;) {
				const length = Math.min(
					SOUNDSCAPER_DESKTOP_V11_MAXIMUM_CHUNK_BYTES,
					next.value.byteLength - offset,
				)
				const bytes = next.value.subarray(offset, offset + length)
				if (delivered + bytes.byteLength > body.byteLength) {
					throw new Error('The local freeze body exceeded its exact desktop descriptor.')
				}
				await onChunk(delivered, bytes, delivered + bytes.byteLength === body.byteLength)
				delivered += bytes.byteLength
				offset += bytes.byteLength
			}
		}
	} finally {
		reader.releaseLock()
	}
	if (emitted !== body.byteLength || delivered !== body.byteLength
		|| scapeHex(digest.digest()) !== body.sha256) {
		throw new Error('The local freeze body changed before desktop publication.')
	}
}

function preflightBodies(snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>): void {
	const bytes = new ScapeExpandedByteBudget(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes)
	const chunks = new ScapeAudioChunkBudget()
	for (const body of snapshot.bundle.bodies) {
		const source = freezeSource(snapshot.project, body)
		const layout = scapeAudioSourceLayout(source)
		bytes.consume(layout.archiveBytes, body.sourceId)
		chunks.consumeMany(layout.chunkCount, body.sourceId)
	}
}

async function assertStoredBody(
	source: FreezeSource,
	body: Readonly<SoundscaperDesktopV11Body>,
	metadataValue: unknown,
	store: Pick<SoundscaperDesktopV11FreezeStore, 'readSourceChunks'>,
	signal?: AbortSignal,
): Promise<void> {
	const metadata = record(metadataValue, `stored freeze source ${body.storageKey}`)
	if (metadata.id !== body.storageKey
		|| metadata.frameCount !== source.frameCount
		|| metadata.channelCount !== source.channelCount
		|| metadata.chunkFrames !== source.chunkFrames
		|| metadata.sampleRate !== source.sampleRate) {
		throw new Error(`Recipient-local freeze source ${body.sourceId} conflicts with its desktop body.`)
	}
	let bytes = 0
	const digest = createScapeDigest()
	const reader = scapeAudioSourceStream(
		store, source, digest, (length) => { bytes += length }, signal,
	).getReader()
	try {
		while (!(await reader.read()).done) throwIfScapeAborted(signal)
	} finally {
		reader.releaseLock()
	}
	if (bytes !== body.byteLength || scapeHex(digest.digest()) !== body.sha256) {
		throw new Error(`Recipient-local freeze source ${body.sourceId} changed canonical PCM bytes.`)
	}
}

async function acquireBody(
	snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>,
	source: FreezeSource,
	body: Readonly<SoundscaperDesktopV11Body>,
	bridge: Pick<SoundscaperDesktopV11RendererBridge, 'readBodyChunk'>,
	store: Pick<SoundscaperDesktopV11FreezeStore, 'beginSourceWrite'>,
	signal?: AbortSignal,
): Promise<StorageRecord> {
	const writer = await store.beginSourceWrite(body.storageKey, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	})
	try {
		const extracted = await extractScapeAudio(
			bodyEntry(snapshot, body, bridge), writer, source, signal,
		)
		verifyScapeExtractedAsset(
			{ entry: body.bindingId, size: body.byteLength, sha256: body.sha256 },
			extracted.digest,
			extracted.size,
			`Soundscaper freeze source ${body.sourceId}`,
		)
		return await writer.commit({
			sampleRate: source.sampleRate,
			channelCount: source.channelCount,
			chunkFrames: source.chunkFrames,
		}, { signal, ifAbsent: true })
	} catch (error) {
		try { await writer.abort() }
		catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Soundscaper desktop freeze-body write and cleanup failed.',
			)
		}
		throw error
	}
}

function bodyEntry(
	snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>,
	body: Readonly<SoundscaperDesktopV11Body>,
	bridge: Pick<SoundscaperDesktopV11RendererBridge, 'readBodyChunk'>,
): ScapeArchiveEntry {
	return Object.freeze({
		filename: body.bindingId,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: body.byteLength,
		uncompressedSize: body.byteLength,
		async getData(
			writable: WritableStream<Uint8Array>,
			options?: Readonly<{ signal?: AbortSignal }>,
		) {
			const writer = writable.getWriter()
			try {
				for (let offset = 0; offset < body.byteLength;) {
					throwIfScapeAborted(options?.signal)
					const length = Math.min(
						SOUNDSCAPER_DESKTOP_V11_MAXIMUM_CHUNK_BYTES,
						body.byteLength - offset,
					)
					const bytes = validateSoundscaperDesktopV11BodyChunk(await bridge.readBodyChunk({
						projectId: snapshot.bundle.project.projectId,
						metadataRevision: snapshot.bundle.metadataRevision,
						projectRevision: snapshot.bundle.project.projectRevision,
						projectSha256: snapshot.bundle.project.sha256,
						body,
						offset,
						length,
					}), length)
					await writer.write(bytes)
					offset += bytes.byteLength
				}
				await writer.close()
			} catch (error) {
				try { await writer.abort(error) } catch { /* the transfer error owns refusal */ }
				throw error
			} finally {
				writer.releaseLock()
			}
		},
	})
}

function freezeSource(
	project: SoundscaperProductionProject,
	body: Readonly<SoundscaperDesktopV11Body>,
): FreezeSource {
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[]
	const matches = sources.filter(({ id }) => id === body.sourceId)
	if (matches.length !== 1) throw new Error(`Freeze source ${body.sourceId} is missing or ambiguous.`)
	const source = matches[0]!
	if (source.kind !== 'audio' || source.storageKey !== body.storageKey
		|| source.contentSha256 !== body.sha256 || typeof source.mimeType !== 'string'
		|| typeof source.sampleRate !== 'number') {
		throw new Error(`Freeze source ${body.sourceId} changed its exact desktop identity.`)
	}
	return source as unknown as FreezeSource
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} metadata is invalid.`)
	}
	return value as Readonly<Record<string, unknown>>
}

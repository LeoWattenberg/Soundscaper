/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';

import type { DesktopLibraryMedia } from './project-library-contract.ts';
import type {
	DesktopLibraryLoadedProjectBundle,
} from './project-library-projects.ts';
import {
	createDesktopLibraryMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
	type DesktopLibraryManagedMediaEncoding,
} from './project-library-media-binding.ts';
import type { DesktopProjectLibraryHost } from './project-library-host.ts';
import {
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9-validation.ts';
import { collectProjectSourceIds } from '../src/common/editor/retention.js';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { SequentialUploadInput } from './project-library-sequential-upload.ts';

export const MAXIMUM_SHARED_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAXIMUM_SHARED_SOURCE_BYTES = 64 * 1024 * 1024 * 1024;
export const MAXIMUM_SHARED_SOURCE_READS = 4;
export const MAXIMUM_SHARED_SOURCE_SESSIONS = 4;

const DIGEST = /^[a-f0-9]{64}$/u;
const WRITE_ID = /^[a-f0-9]{32}$/u;

interface ManagedAudioSource extends Record<string, unknown> {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: string;
	readonly chunkFrames: number;
}

interface ManagedVideoSource extends Record<string, unknown> {
	readonly id: string;
	readonly kind: 'video';
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec?: string;
	readonly hasAudio: boolean;
}

type ManagedSource = ManagedAudioSource | ManagedVideoSource;

interface DesktopSharedManagedSourceDescriptorBase {
	readonly bindingId: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly sourceId: string;
	readonly storageKey: string;
}

export type DesktopSharedManagedSourceDescriptor = DesktopSharedManagedSourceDescriptorBase & (
	| Readonly<{ readonly encoding: typeof DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING; readonly kind: 'audio' }>
	| Readonly<{ readonly encoding: typeof DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING; readonly kind: 'video' }>
);

export interface DesktopSharedProjectBundle {
	readonly document: string;
	readonly sources: readonly DesktopSharedManagedSourceDescriptor[];
}

export interface DesktopSharedSourceWriteDeclaration {
	readonly byteLength: number;
	readonly encoding: DesktopLibraryManagedMediaEncoding;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sha256: string;
	readonly sourceId: string;
}

export type DesktopSharedSourceWriteAdmission = Readonly<{
	readonly status: 'present';
	readonly source: DesktopSharedManagedSourceDescriptor;
}> | Readonly<{
	readonly status: 'ready';
	readonly chunkSize: number;
	readonly writeId: string;
}>;

export interface DesktopSharedSourceChunkWrite {
	readonly bytes: Uint8Array;
	readonly offset: number;
	readonly writeId: string;
}

export interface DesktopSharedSourceWriteCompletion {
	readonly sha256: string;
	readonly writeId: string;
}

type ManagedMediaHost = Pick<DesktopProjectLibraryHost,
	'publishManagedMedia'
	| 'readManagedMedia'
	| 'readProjectBundleById'>;

interface UploadSession {
	readonly id: string;
	readonly input: SequentialUploadInput;
	readonly operation: Promise<DesktopSharedManagedSourceDescriptor>;
	readonly sha256: string;
	state: 'aborting' | 'finishing' | 'open';
	written: number;
}

/** Main-owned source transfer facade; no filesystem path crosses this seam. */
export class DesktopSharedProjectMediaService {
	readonly #host: ManagedMediaHost;
	readonly #randomId: () => string;
	readonly #sessions = new Map<string, UploadSession>();
	#activeReads = 0;
	#disposed = false;
	#writeSlots = 0;

	constructor(
		host: ManagedMediaHost,
		options: Readonly<{ randomId?: () => string }> = {},
	) {
		assertHost(host);
		this.#host = host;
		this.#randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
	}

	async readProjectBundle(
		projectId: string,
		signal?: AbortSignal,
	): Promise<DesktopSharedProjectBundle | null> {
		this.#assertOpen();
		const loaded = await this.#host.readProjectBundleById(projectId, signal);
		if (!loaded) return null;
		const project = currentProject(loaded);
		return Object.freeze({
			document: serializeScapeProjectDocument(project),
			sources: managedSources(loaded, project),
		});
	}

	async beginSourceWrite(
		declaration: DesktopSharedSourceWriteDeclaration,
		signal?: AbortSignal,
	): Promise<DesktopSharedSourceWriteAdmission> {
		this.#assertOpen();
		const request = sourceWriteDeclaration(declaration);
		this.#reserveWriteSlot();
		let retainedSlot = false;
		try {
			const loaded = await this.#host.readProjectBundleById(request.projectId, signal);
			this.#assertOpen();
			if (!loaded) throw new Error('Desktop shared project is unavailable for managed-media preparation');
			const project = currentProject(loaded);
			if (request.projectRevision !== project.revision) {
				throw new Error('Desktop shared project revision changed during managed-media preparation');
			}
			const source = requiredReachableSource(project, request.sourceId, request.encoding);
			const expectedBytes = declaredSourceBytes(source, request.byteLength);
			const bindingKey = managedSourceBindingKey(source);
			const binding = createDesktopLibraryMediaBinding(
				request.encoding,
				project.id,
				bindingKey,
				project.revision,
				loaded.catalog.sha256,
			);
			const existing = loaded.media.find(({ id }) => id === binding.id);
			if (existing) {
				if (existing.byteLength !== expectedBytes) {
					throw new Error(source.kind === 'audio'
						? 'Desktop library managed audio does not match its canonical PCM geometry'
						: 'Desktop library managed original video does not match its declared byte geometry');
				}
				if (existing.sha256 !== request.sha256) {
					throw new Error(`Desktop library managed ${source.kind === 'audio' ? 'audio' : 'original video'} does not match the source-write declaration`);
				}
				const sourceDescriptor = managedSourceDescriptor(source, existing, expectedBytes);
				await this.#host.publishManagedMedia({
					encoding: request.encoding,
					projectId: project.id,
					storageKey: bindingKey,
					byteLength: existing.byteLength,
					sha256: existing.sha256,
					chunks: emptyChunks(),
					expectedProjectRevision: project.revision,
					expectedProjectSha256: loaded.catalog.sha256,
					signal,
				});
				this.#assertOpen();
				return Object.freeze({ status: 'present', source: sourceDescriptor });
			}
			const prefix = request.encoding === DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING ? 'm' : 'v';
			const reusable = loaded.media.some((media) => media.id.startsWith(prefix)
				&& media.byteLength === expectedBytes && media.sha256 === request.sha256);
			if (reusable) {
				const media = await this.#host.publishManagedMedia({
					encoding: request.encoding,
					projectId: project.id,
					storageKey: bindingKey,
					byteLength: expectedBytes,
					sha256: request.sha256,
					chunks: emptyChunks(),
					reuseExistingBody: true,
					expectedProjectRevision: project.revision,
					expectedProjectSha256: loaded.catalog.sha256,
					signal,
				});
				this.#assertOpen();
				return Object.freeze({
					status: 'present',
					source: managedSourceDescriptor(source, media, expectedBytes),
				});
			}

			const id = this.#newWriteId();
			const input = new SequentialUploadInput();
			const operation = this.#host.publishManagedMedia({
				encoding: request.encoding,
				projectId: project.id,
				storageKey: bindingKey,
				byteLength: request.byteLength,
				sha256: request.sha256,
				chunks: input,
				expectedProjectRevision: project.revision,
				expectedProjectSha256: loaded.catalog.sha256,
				signal,
			}).then((media) => managedSourceDescriptor(source, media, expectedBytes));
			const session: UploadSession = {
				id, input, operation, sha256: request.sha256, state: 'open', written: 0,
			};
			this.#sessions.set(id, session);
			retainedSlot = true;
			void operation.catch((error: unknown) => {
				input.fail(error);
				this.#deleteSession(id);
			});
			return Object.freeze({ status: 'ready', chunkSize: MAXIMUM_SHARED_SOURCE_CHUNK_BYTES, writeId: id });
		} finally {
			if (!retainedSlot) this.#releaseWriteSlot();
		}
	}

	async writeSourceChunk(value: DesktopSharedSourceChunkWrite): Promise<Readonly<{ nextOffset: number }>> {
		this.#assertOpen();
		const session = this.#session(value.writeId);
		const offset = nonNegativeInteger(value.offset, 'Desktop shared-source write offset');
		if (offset !== session.written) throw new RangeError('Desktop shared-source chunk offset is out of sequence');
		const bytes = exactBytes(value.bytes);
		if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_SHARED_SOURCE_CHUNK_BYTES) {
			throw new RangeError('Desktop shared-source chunk exceeds its byte limit');
		}
		await session.input.write(bytes);
		session.written += bytes.byteLength;
		return Object.freeze({ nextOffset: session.written });
	}

	async finishSourceWrite(
		value: DesktopSharedSourceWriteCompletion,
	): Promise<DesktopSharedManagedSourceDescriptor> {
		this.#assertOpen();
		const session = this.#session(value.writeId);
		const sha256 = digest(value.sha256);
		if (sha256 !== session.sha256) {
			session.state = 'aborting';
			session.input.fail(new Error('Desktop shared-source changed while it was being transferred'));
			try {
				await session.operation.catch(() => undefined);
			} finally {
				this.#deleteSession(session.id);
			}
			throw new Error('Desktop shared-source changed while it was being transferred');
		}
		session.input.finish();
		session.state = 'finishing';
		try {
			return await session.operation;
		} finally {
			this.#deleteSession(session.id);
		}
	}

	async abortSourceWrite(writeId: string): Promise<boolean> {
		const id = validWriteId(writeId);
		const session = this.#sessions.get(id);
		if (!session || session.state !== 'open') return false;
		session.state = 'aborting';
		session.input.fail(new Error('Desktop shared-source write was aborted'));
		try {
			await session.operation.catch(() => undefined);
			return true;
		} finally {
			this.#deleteSession(id);
		}
	}

	async readSourceChunk(
		bindingId: string,
		options: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	): Promise<Uint8Array> {
		this.#assertOpen();
		if (this.#activeReads >= MAXIMUM_SHARED_SOURCE_READS) {
			throw new RangeError('Desktop shared-source read capacity is exhausted');
		}
		this.#activeReads += 1;
		try {
			return await this.#host.readManagedMedia(bindingId, options);
		} finally {
			this.#activeReads -= 1;
		}
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const sessions = [...this.#sessions.values()];
		for (const session of sessions) {
			if (session.state === 'open') session.state = 'aborting';
			session.input.fail(new Error('Desktop shared-source service was disposed'));
		}
		await Promise.allSettled(sessions.map(({ operation }) => operation));
		for (const session of sessions) this.#deleteSession(session.id);
	}

	#deleteSession(id: string): boolean {
		if (!this.#sessions.delete(id)) return false;
		this.#releaseWriteSlot();
		return true;
	}

	#session(value: unknown): UploadSession {
		const session = this.#sessions.get(validWriteId(value));
		if (!session || session.state !== 'open') {
			throw new Error('Unknown desktop shared-source write session');
		}
		return session;
	}

	#newWriteId(): string {
		let id: string;
		do {
			id = this.#randomId();
			if (!WRITE_ID.test(id)) throw new TypeError('Desktop shared-source write id generator returned an invalid value');
		} while (this.#sessions.has(id));
		return id;
	}

	#releaseWriteSlot(): void {
		if (this.#writeSlots < 1) throw new Error('Desktop shared-source write slot accounting underflow');
		this.#writeSlots -= 1;
	}

	#reserveWriteSlot(): void {
		if (this.#writeSlots >= MAXIMUM_SHARED_SOURCE_SESSIONS) {
			throw new RangeError('Desktop shared-source write session capacity is exhausted');
		}
		this.#writeSlots += 1;
	}

	#assertOpen(): void {
		if (this.#disposed) throw new Error('Desktop shared-source service is disposed');
	}
}

function currentProject(loaded: DesktopLibraryLoadedProjectBundle): AudioEditorProjectV9 {
	validateAudioEditorProjectV9(loaded.project);
	return loaded.project as AudioEditorProjectV9;
}

function managedSources(
	loaded: DesktopLibraryLoadedProjectBundle,
	project: AudioEditorProjectV9,
): readonly DesktopSharedManagedSourceDescriptor[] {
	const descriptors: DesktopSharedManagedSourceDescriptor[] = [];
	for (const sourceId of collectProjectSourceIds(project)) {
		const source = requiredReachableSource(project, sourceId);
		const encoding = sourceEncoding(source);
		const binding = createDesktopLibraryMediaBinding(
			encoding,
			project.id,
			managedSourceBindingKey(source),
			project.revision,
			loaded.catalog.sha256,
		);
		const media = loaded.media.find(({ id }) => id === binding.id);
		if (!media) continue;
		const expectedBytes = source.kind === 'audio' ? canonicalAudioBytes(source) : positiveVideoBytes(media.byteLength);
		descriptors.push(managedSourceDescriptor(source, media, expectedBytes));
	}
	return Object.freeze(descriptors);
}

function managedSourceDescriptor(
	source: ManagedSource,
	media: DesktopLibraryMedia,
	expectedBytes: number,
): DesktopSharedManagedSourceDescriptor {
	if (media.byteLength !== expectedBytes) {
		throw new Error(source.kind === 'audio'
			? 'Desktop library managed audio does not match its canonical PCM geometry'
			: 'Desktop library managed original video byte geometry is invalid');
	}
	const common = {
		bindingId: media.id,
		byteLength: media.byteLength,
		sha256: media.sha256,
		sourceId: source.id,
		storageKey: source.storageKey,
	};
	return source.kind === 'audio'
		? Object.freeze({ ...common, encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING, kind: 'audio' as const })
		: Object.freeze({ ...common, encoding: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING, kind: 'video' as const });
}

function requiredReachableSource(
	project: AudioEditorProjectV9,
	sourceId: string,
	encoding?: DesktopLibraryManagedMediaEncoding,
): ManagedSource {
	if (!collectProjectSourceIds(project).has(sourceId)) {
		throw new ReferenceError('Desktop shared-source declaration does not identify a reachable source');
	}
	const matches = project.sources.filter((candidate) => candidate.id === sourceId);
	if (matches.length !== 1) throw new ReferenceError('Desktop shared-source declaration has no unique project source');
	const source = matches[0] as ManagedSource;
	if (source.kind !== 'audio' && source.kind !== 'video') throw new TypeError('Desktop managed-source kind is unsupported');
	if (encoding && sourceEncoding(source) !== encoding) {
		throw new TypeError('Desktop shared-source encoding does not match its reachable source kind');
	}
	return source;
}

function sourceWriteDeclaration(value: unknown): DesktopSharedSourceWriteDeclaration {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write declaration must be an object');
	}
	const record = value as Record<string, unknown>;
	const encoding = sourceEncodingFromValue(record.encoding);
	const byteLength = boundedBytes(record.byteLength);
	if (encoding === DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING && byteLength === 0) {
		throw new RangeError('Desktop shared-source original video byte length must be positive');
	}
	return Object.freeze({
		byteLength,
		encoding,
		projectId: nonEmptyString(record.projectId, 'project identity'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'Desktop shared-source project revision'),
		sha256: digest(record.sha256),
		sourceId: nonEmptyString(record.sourceId, 'source identity'),
	});
}

function canonicalAudioBytes(source: ManagedAudioSource): number {
	const frameCount = nonNegativeInteger(source.frameCount, 'Desktop shared-source frame count');
	const channelCount = positiveInteger(source.channelCount, 'Desktop shared-source channel count');
	const chunkFrames = positiveInteger(source.chunkFrames, 'Desktop shared-source chunk size');
	const frames = BigInt(frameCount);
	const chunks = frames === 0n ? 0n : ((frames - 1n) / BigInt(chunkFrames)) + 1n;
	const bytes = frames * BigInt(channelCount * Float32Array.BYTES_PER_ELEMENT) + chunks * 4n;
	if (bytes > BigInt(MAXIMUM_SHARED_SOURCE_BYTES)) {
		throw new RangeError('Desktop shared-source canonical PCM exceeds its byte limit');
	}
	return Number(bytes);
}

function declaredSourceBytes(source: ManagedSource, declaredBytes: number): number {
	if (source.kind === 'video') return positiveVideoBytes(declaredBytes);
	const canonicalBytes = canonicalAudioBytes(source);
	if (canonicalBytes !== declaredBytes) {
		throw new RangeError('Desktop shared-source declaration does not match canonical PCM geometry');
	}
	return canonicalBytes;
}

function managedSourceBindingKey(source: ManagedSource): string {
	return source.kind === 'audio'
		? JSON.stringify([
			source.storageKey, source.frameCount, source.channelCount, source.sampleRate,
			source.originalSampleRate, source.sampleFormat, source.chunkFrames,
		])
		: JSON.stringify([
			source.storageKey, source.mimeType, source.frameCount, source.sampleRate,
			source.width, source.height, source.frameRate, source.videoCodec,
			source.audioCodec, source.hasAudio,
		]);
}

function sourceEncoding(source: ManagedSource): DesktopLibraryManagedMediaEncoding {
	return source.kind === 'audio'
		? DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING
		: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING;
}

function sourceEncodingFromValue(value: unknown): DesktopLibraryManagedMediaEncoding {
	if (value !== DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING && value !== DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING) {
		throw new TypeError('Desktop shared-source write declaration has an unsupported encoding');
	}
	return value;
}

function positiveVideoBytes(value: unknown): number {
	const bytes = boundedBytes(value);
	if (bytes === 0) throw new RangeError('Desktop shared-source original video byte length must be positive');
	return bytes;
}

function boundedBytes(value: unknown): number {
	const bytes = nonNegativeInteger(value, 'Desktop shared-source byte length');
	if (bytes > MAXIMUM_SHARED_SOURCE_BYTES) {
		throw new RangeError('Desktop shared-source byte length exceeds its limit');
	}
	return bytes;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`${label} must be positive`);
	return result;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Desktop shared-source ${label} is invalid`);
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError('Desktop shared-source SHA-256 digest is invalid');
	}
	return value;
}

function validWriteId(value: unknown): string {
	if (typeof value !== 'string' || !WRITE_ID.test(value)) {
		throw new TypeError('Desktop shared-source write id is invalid');
	}
	return value;
}

function exactBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new TypeError('Desktop shared-source chunk must be binary data');
	return value.slice();
}

async function* emptyChunks(): AsyncGenerator<Uint8Array> {
	throw new Error('An existing managed-media binding must not consume a new body');
}

function assertHost(value: ManagedMediaHost): void {
	if (!value || typeof value !== 'object') throw new TypeError('Desktop shared-source service requires a host');
	for (const method of ['publishManagedMedia', 'readManagedMedia', 'readProjectBundleById'] as const) {
		if (typeof value[method] !== 'function') throw new TypeError('Desktop shared-source service requires a host');
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	openFramescaperImageFramePackV1,
} from '../common/editor/timeline-image-frame-pack-v1.ts';
import type {
	FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { trustedMediaContentSha256 } from '../common/editor/storage/media-content-provenance.ts';
import { publishSource, type StorageRecord } from '../common/editor/storage/media-records.ts';
import {
	applyMemoryMutations,
	setMemoryMutation,
} from '../common/editor/storage/project-repository-support.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import type { MediaAssetWriter } from '../common/editor/storage/media-asset-write-contract.ts';
import {
	applyFramescaperProjectCommandTimelineImage,
} from './editor-project-timeline-image-commands.ts';
import { assertFramescaperProjectTimelineImageProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';
import { preparePublication, sameProject, canonicalTimestamp, revisionKey, closedRecord, record, type PreparedPublication } from './internal/timeline-image-publication-transition-v1.ts';

export const FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE = 'timeline-image' as const;
export const FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE = 'framescaper-image-asset-v1' as const;

const PUBLISHER_DEPENDENCY_FIELDS = ['port', 'store', 'projectCodec'] as const;
const PUBLISHER_REQUEST_FIELDS = ['expected', 'project', 'bytes', 'signal'] as const;

export interface FramescaperTimelineImagePublicationTransitionTimelineImage {
	readonly expected: unknown;
	readonly project: unknown;
}

export interface FramescaperTimelineImagePublicationTimelineImage
	extends FramescaperTimelineImagePublicationTransitionTimelineImage {
	readonly bytes: Uint8Array;
	readonly signal?: AbortSignal;
}

export interface FramescaperTimelineImagePublicationStoreTimelineImage {
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{
			readonly expectedBytes: number;
			readonly expectedSha256: string;
			readonly signal?: AbortSignal;
		}>,
	): Promise<MediaAssetWriter>;
	getMediaAssetMetadata(sourceId: string): Promise<Record<string, unknown> | null>;
	deleteMediaAsset(sourceId: string): Promise<void>;
}

export interface FramescaperTimelineImagePublisherTimelineImageDependencies {
	readonly port: StorageRepositoryPort;
	readonly store: FramescaperTimelineImagePublicationStoreTimelineImage;
	readonly projectCodec?: FramescaperTimelineImageProjectCodecTimelineImage;
}

export interface FramescaperTimelineImageProjectCodecTimelineImage {
	readonly authenticate: (profile: unknown) => void;
	readonly clone: (profile: unknown, project: unknown) => FramescaperProjectTimelineImage;
	readonly apply: (
		profile: unknown,
		project: unknown,
		command: unknown,
		options: Readonly<{ readonly now?: Date | string }>,
	) => FramescaperProjectTimelineImage;
}

const V32_PROJECT_CODEC: FramescaperTimelineImageProjectCodecTimelineImage = Object.freeze({
	authenticate: assertFramescaperProjectTimelineImageProfile,
	clone: cloneFramescaperProjectTimelineImage,
	apply: applyFramescaperProjectCommandTimelineImage,
});

/** Low-level CAS that roots one already-verified staged body with its exact timelineImage revision. */
export class FramescaperTimelineImagePublicationRepositoryTimelineImage {
	readonly #profile: unknown;
	readonly #port: StorageRepositoryPort;
	readonly #codec: FramescaperTimelineImageProjectCodecTimelineImage;

	constructor(
		profile: unknown,
		port: StorageRepositoryPort | unknown,
		codec: FramescaperTimelineImageProjectCodecTimelineImage = V32_PROJECT_CODEC,
	) {
		assertProjectCodec(codec);
		codec.authenticate(profile);
		assertPort(port);
		this.#profile = profile;
		this.#port = port;
		this.#codec = codec;
	}

	async publishIfCurrent(
		value: FramescaperTimelineImagePublicationTransitionTimelineImage | unknown,
	): Promise<FramescaperProjectTimelineImage | null> {
		const publication = preparePublication(this.#profile, value, this.#codec);
		const database = await this.#port.database();
		const published = database
			? await publishIndexedDb(database, publication)
			: publishMemory(this.#port, publication);
		return published ? this.#codec.clone(this.#profile, publication.project) : null;
	}
}

/** Authenticated writer plus project CAS with determinate staged-body cleanup. */
export class FramescaperTimelineImagePublisherTimelineImage {
	readonly #profile: unknown;
	readonly #repository: FramescaperTimelineImagePublicationRepositoryTimelineImage;
	readonly #store: FramescaperTimelineImagePublicationStoreTimelineImage;
	readonly #codec: FramescaperTimelineImageProjectCodecTimelineImage;

	constructor(
		profile: unknown,
		dependenciesValue: FramescaperTimelineImagePublisherTimelineImageDependencies | unknown,
	) {
		const dependencies = closedRecord(
			dependenciesValue,
			PUBLISHER_DEPENDENCY_FIELDS,
			'timelineImage timeline-image publisher dependencies',
			['projectCodec'],
		);
		assertPort(dependencies.port);
		assertStore(dependencies.store);
		const codec = dependencies.projectCodec === undefined
			? V32_PROJECT_CODEC : dependencies.projectCodec as FramescaperTimelineImageProjectCodecTimelineImage;
		assertProjectCodec(codec);
		codec.authenticate(profile);
		this.#profile = profile;
		this.#store = dependencies.store;
		this.#codec = codec;
		this.#repository = new FramescaperTimelineImagePublicationRepositoryTimelineImage(
			profile,
			dependencies.port,
			codec,
		);
	}

	async publishIfCurrent(
		value: FramescaperTimelineImagePublicationTimelineImage | unknown,
	): Promise<FramescaperProjectTimelineImage | null> {
		this.#codec.authenticate(this.#profile);
		const requestValue = closedRecord(
			value,
			PUBLISHER_REQUEST_FIELDS,
			'timelineImage timeline-image publication request',
			['signal'],
		);
		const publication = preparePublication(this.#profile, {
			expected: requestValue.expected,
			project: requestValue.project,
		}, this.#codec);
		if (publication.source.schemaVersion !== 1) throw new RangeError('The permanent timeline-image publisher requires source version 1.');
		const source = publication.source;
		const signal = optionalSignal(requestValue.signal);
		const bytes = snapshotBytes(requestValue.bytes, source.assetByteLength);
		throwIfAborted(signal);
		await openFramescaperImageFramePackV1({
			source,
			read: (offset, length) => bytes.slice(offset, offset + length),
			signal,
		});
		throwIfAborted(signal);
		let writer: MediaAssetWriter | null = null;
		let bodyCommitted = false;
		try {
			writer = await this.#store.beginMediaAssetWrite(
				source.storageKey,
				{
					name: source.name,
					kind: FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE,
					encoding: FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE,
					mimeType: source.mimeType,
				},
				{
					expectedBytes: source.assetByteLength,
					expectedSha256: source.contentSha256,
					...(signal ? { signal } : {}),
				},
			);
			for (let offset = 0; offset < bytes.byteLength; offset += writer.maximumChunkBytes) {
				throwIfAborted(signal);
				await writer.write(bytes.slice(offset, offset + writer.maximumChunkBytes), signal ? { signal } : {});
			}
			await writer.commit(signal ? { signal } : {});
			bodyCommitted = true;
			throwIfAborted(signal);
			const published = await this.#repository.publishIfCurrent({
				expected: publication.expected,
				project: publication.project,
			});
			if (published !== null) return published;
			await this.#cleanupOwnedBody(source);
			bodyCommitted = false;
			return null;
		} catch (error) {
			try {
				if (bodyCommitted) await this.#cleanupOwnedBody(source);
				else await writer?.abort();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'timelineImage timeline-image publication and owned-body rollback both failed.',
				);
			}
			throw error;
		}
	}

	async #cleanupOwnedBody(source: Pick<FramescaperImageSourceV1, 'storageKey' | 'mimeType' | 'assetByteLength' | 'contentSha256'>): Promise<void> {
		const metadata = await this.#store.getMediaAssetMetadata(source.storageKey);
		if (metadata === null) return;
		if (metadata.sha256 !== source.contentSha256
			|| metadata.size !== source.assetByteLength
			|| metadata.mimeType !== source.mimeType
			|| metadata.kind !== FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE
			|| metadata.encoding !== FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE
			|| !Object.hasOwn(metadata, 'pendingProjectUntil')) {
			throw new Error('The staged timelineImage image body lost cleanup ownership.');
		}
		await this.#store.deleteMediaAsset(source.storageKey);
	}
}

function assertProjectCodec(value: unknown): asserts value is FramescaperTimelineImageProjectCodecTimelineImage {
	if (!value || typeof value !== 'object') throw new TypeError('A timeline-image project codec is required.');
	for (const method of ['authenticate', 'clone', 'apply'] as const) {
		if (typeof (value as Readonly<Record<string, unknown>>)[method] !== 'function') {
			throw new TypeError(`The timeline-image project codec requires ${method}.`);
		}
	}
}

async function publishIndexedDb(
	database: IDBDatabase,
	publication: PreparedPublication,
): Promise<boolean> {
	return transact(database, ['projects', 'revisions', 'mediaAssets'], 'readwrite', async ({
		projects, revisions, mediaAssets,
	}) => {
		const current = await request(projects.get(publication.projectId));
		if (!sameProject(current, publication.expected)) return false;
		assertBaseRevision(
			await request(revisions.get(revisionKey(publication.projectId, publication.baseRevision))),
			publication,
		);
		const nextKey = revisionKey(publication.projectId, publication.nextRevision);
		if (await request(revisions.get(nextKey)) !== undefined) {
			throw new Error('The timelineImage image publication next revision is occupied.');
		}
		const row = stagedBody(
			await request(mediaAssets.get(publication.source.storageKey)),
			publication.source,
		);
		mediaAssets.put(publishSource(row));
		projects.put(publication.project);
		revisions.put({
			key: nextKey,
			projectId: publication.projectId,
			revision: publication.nextRevision,
			project: publication.project,
		});
		return true;
	});
}

function publishMemory(port: StorageRepositoryPort, publication: PreparedPublication): boolean {
	const { memory } = port;
	if (!sameProject(memory.projects.get(publication.projectId), publication.expected)) return false;
	assertBaseRevision(
		memory.revisions.get(revisionKey(publication.projectId, publication.baseRevision)),
		publication,
	);
	const nextKey = revisionKey(publication.projectId, publication.nextRevision);
	if (memory.revisions.has(nextKey)) throw new Error('The timelineImage image publication next revision is occupied.');
	const row = stagedBody(memory.mediaAssets.get(publication.source.storageKey), publication.source);
	applyMemoryMutations([
		setMemoryMutation(memory.mediaAssets, publication.source.storageKey, structuredClone(publishSource(row))),
		setMemoryMutation(memory.projects, publication.projectId, structuredClone(publication.project)),
		setMemoryMutation(memory.revisions, nextKey, structuredClone({
			key: nextKey,
			projectId: publication.projectId,
			revision: publication.nextRevision,
			project: publication.project,
		})),
	]);
	return true;
}

function stagedBody(value: unknown, source: Pick<FramescaperImageSourceV1, 'storageKey' | 'mimeType' | 'assetByteLength' | 'contentSha256'>): StorageRecord {
	const row = record(value, 'timelineImage staged image body') as StorageRecord;
	const committedAt = canonicalTimestamp(row.committedAt, 'body committedAt');
	const pendingUntil = canonicalTimestamp(row.pendingProjectUntil, 'body pendingProjectUntil');
	if (Date.parse(pendingUntil) <= Date.parse(committedAt)
		|| row.sourceId !== source.storageKey
		|| row.kind !== FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE
		|| row.encoding !== FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE
		|| row.mimeType !== source.mimeType
		|| row.size !== source.assetByteLength
		|| trustedMediaContentSha256(row) !== source.contentSha256) {
		throw new Error('The staged timelineImage image body does not match its immutable source authority.');
	}
	return row;
}

function assertBaseRevision(value: unknown, publication: PreparedPublication): void {
	const row = record(value, 'timelineImage image base revision');
	const key = revisionKey(publication.projectId, publication.baseRevision);
	if (row.key !== key || row.projectId !== publication.projectId
		|| row.revision !== publication.baseRevision
		|| !sameProject(row.project, publication.expected)) {
		throw new Error('The exact timelineImage image base revision is missing or changed.');
	}
}

function snapshotBytes(value: unknown, expectedBytes: number): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== expectedBytes) {
		throw new RangeError('timelineImage image publication bytes must match the exact asset length.');
	}
	return value.slice();
}

function assertPort(value: unknown): asserts value is StorageRepositoryPort {
	if (!value || typeof value !== 'object'
		|| typeof (value as StorageRepositoryPort).database !== 'function'
		|| !(value as StorageRepositoryPort).memory
		|| typeof (value as StorageRepositoryPort).memory !== 'object') {
		throw new TypeError('A storage repository port is required for timelineImage image publication.');
	}
}

function assertStore(value: unknown): asserts value is FramescaperTimelineImagePublicationStoreTimelineImage {
	if (!value || typeof value !== 'object') throw new TypeError('A timelineImage image publication store is required.');
	for (const method of ['beginMediaAssetWrite', 'getMediaAssetMetadata', 'deleteMediaAsset'] as const) {
		if (typeof (value as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`The timelineImage image publication store requires ${method}.`);
		}
	}
}

function optionalSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	if (!(value instanceof AbortSignal)) throw new TypeError('timelineImage image publication signal must be an AbortSignal.');
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('timelineImage image publication cancelled.', 'AbortError');
}

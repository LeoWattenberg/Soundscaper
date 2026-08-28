/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	openFramescaperImageFramePackV1,
} from '../common/editor/timeline-image-frame-pack-v1.ts';
import type {
	FramescaperImageClipV1,
	FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
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

export const FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE = 'timeline-image' as const;
export const FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE = 'framescaper-image-asset-v1' as const;

const TRANSITION_FIELDS = ['expected', 'project'] as const;
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

interface PreparedPublication {
	readonly expected: FramescaperProjectTimelineImage;
	readonly project: FramescaperProjectTimelineImage;
	readonly source: FramescaperImageSourceV1;
	readonly clip: FramescaperImageClipV1;
	readonly projectId: string;
	readonly baseRevision: number;
	readonly nextRevision: number;
}

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
		const signal = optionalSignal(requestValue.signal);
		const bytes = snapshotBytes(requestValue.bytes, publication.source.assetByteLength);
		throwIfAborted(signal);
		await openFramescaperImageFramePackV1({
			source: publication.source,
			read: (offset, length) => bytes.slice(offset, offset + length),
			signal,
		});
		throwIfAborted(signal);
		let writer: MediaAssetWriter | null = null;
		let bodyCommitted = false;
		try {
			writer = await this.#store.beginMediaAssetWrite(
				publication.source.storageKey,
				{
					name: publication.source.name,
					kind: FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE,
					encoding: FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE,
					mimeType: publication.source.mimeType,
				},
				{
					expectedBytes: publication.source.assetByteLength,
					expectedSha256: publication.source.contentSha256,
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
			await this.#cleanupOwnedBody(publication.source);
			bodyCommitted = false;
			return null;
		} catch (error) {
			try {
				if (bodyCommitted) await this.#cleanupOwnedBody(publication.source);
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

	async #cleanupOwnedBody(source: FramescaperImageSourceV1): Promise<void> {
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

function preparePublication(
	profile: unknown,
	value: unknown,
	codec: FramescaperTimelineImageProjectCodecTimelineImage,
): PreparedPublication {
	const raw = closedRecord(value, TRANSITION_FIELDS, 'timelineImage timeline-image publication');
	const expected = codec.clone(profile, raw.expected);
	const project = codec.clone(profile, raw.project);
	if (project.id !== expected.id) throw new Error('timelineImage image publication cannot change project identity.');
	const baseRevision = revision(expected.revision, 'base');
	const nextRevision = safeNextRevision(baseRevision);
	if (project.revision !== nextRevision) {
		throw new Error('timelineImage image publication must publish exactly the next revision.');
	}
	assertFreshTimestamp(expected.updatedAt, project.updatedAt);
	const expectedSourceIds = new Set(records(expected.sources, 'timelineImage base sources').map(stableId));
	const addedSources = records(project.sources, 'timelineImage target sources')
		.filter((source) => source.kind === 'image' && !expectedSourceIds.has(stableId(source)));
	if (addedSources.length !== 1) throw new Error('timelineImage image publication requires one fresh image source.');
	const source = addedSources[0] as unknown as FramescaperImageSourceV1;
	const expectedClipIds = new Set(allClips(expected).map(stableId));
	const addedClips = allClips(project)
		.filter((clip) => clip.kind === 'image' && !expectedClipIds.has(stableId(clip)));
	if (addedClips.length !== 1) throw new Error('timelineImage image publication requires one fresh image clip.');
	const clip = addedClips[0] as unknown as FramescaperImageClipV1;
	if (clip.sourceId !== source.id) throw new Error('The fresh timelineImage image clip must own its fresh source.');
	const placement = imagePlacement(project, clip.id);
	const trackCommand = freshTrackCommand(expected, project, clip, placement);
	const reconstructed = codec.apply(profile, expected, {
		type: 'batch',
		commands: [...(trackCommand ? [trackCommand] : []), {
			type: 'image-source/set', sourceId: source.id, expectedSource: null, source,
		}, {
			type: 'image-clip/set', clipId: clip.id,
			expectedClip: null, expectedPlacement: null, clip, placement,
		}],
	}, { now: String(project.updatedAt) });
	if (!sameProject(reconstructed, project)) {
		throw new Error('timelineImage image publication may add only one source, one clip, and its placement.');
	}
	return Object.freeze({
		expected,
		project,
		source: structuredClone(source),
		clip: structuredClone(clip),
		projectId: expected.id,
		baseRevision,
		nextRevision,
	});
}

function assertProjectCodec(value: unknown): asserts value is FramescaperTimelineImageProjectCodecTimelineImage {
	if (!value || typeof value !== 'object') throw new TypeError('A timeline-image project codec is required.');
	for (const method of ['authenticate', 'clone', 'apply'] as const) {
		if (typeof (value as Readonly<Record<string, unknown>>)[method] !== 'function') {
			throw new TypeError(`The timeline-image project codec requires ${method}.`);
		}
	}
}

function freshTrackCommand(
	expected: FramescaperProjectTimelineImage,
	project: FramescaperProjectTimelineImage,
	clip: FramescaperImageClipV1,
	placement: ReturnType<typeof imagePlacement>,
): Record<string, unknown> | null {
	const expectedIds = new Set(records(expected.tracks, 'timelineImage base tracks').map(stableId));
	const targetTracks = records(project.tracks, 'timelineImage target tracks');
	const added = targetTracks.filter((track) => !expectedIds.has(stableId(track)));
	if (added.length === 0) return null;
	if (added.length !== 1 || placement.scope !== 'timeline') {
		throw new Error('timelineImage image publication may create at most one timeline video track.');
	}
	const track = added[0]!;
	const trackId = stableId(track);
	if (trackId !== placement.trackId || track.type !== 'video' || track.locked === true
		|| !Array.isArray(track.clipIds)
		|| track.clipIds.length !== 1 || track.clipIds[0] !== clip.id) {
		throw new Error('The fresh timelineImage image track must be unlocked and own only the fresh image clip.');
	}
	const primaryId = String(project.primarySequenceId);
	const owners = records(project.sequences, 'timelineImage target sequences').filter(({ trackIds }) => (
		Array.isArray(trackIds) && trackIds.includes(trackId)
	));
	if (owners.length !== 1 || owners[0]!.id !== primaryId) {
		throw new Error('The fresh timelineImage image track must belong only to the primary sequence.');
	}
	return {
		type: 'track/add',
		track: { ...structuredClone(track), clipIds: [] },
		index: targetTracks.indexOf(track),
	};
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

function stagedBody(value: unknown, source: FramescaperImageSourceV1): StorageRecord {
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

function imagePlacement(project: FramescaperProjectTimelineImage, clipId: string) {
	const timeline = records(project.clips, 'timelineImage target timeline clips').some(({ id }) => id === clipId);
	const bin = records(record(project.projectBin, 'timelineImage target project bin').clips, 'timelineImage target bin clips')
		.some(({ id }) => id === clipId);
	if (timeline === bin) throw new Error('The fresh timelineImage image clip requires one exact placement.');
	if (bin) return Object.freeze({ scope: 'project-bin' as const });
	const owners = records(project.tracks, 'timelineImage target tracks').filter(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(clipId)
	));
	if (owners.length !== 1 || owners[0]!.type !== 'video') {
		throw new Error('The fresh timelineImage timeline image requires one video-track owner.');
	}
	return Object.freeze({ scope: 'timeline' as const, trackId: stableId(owners[0]!) });
}

function allClips(project: FramescaperProjectTimelineImage): Record<string, unknown>[] {
	return [
		...records(project.clips, 'timelineImage timeline clips'),
		...records(record(project.projectBin, 'timelineImage project bin').clips, 'timelineImage bin clips'),
	];
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

function assertFreshTimestamp(before: unknown, after: unknown): void {
	const base = canonicalTimestamp(before, 'base updatedAt');
	const next = canonicalTimestamp(after, 'target updatedAt');
	if (Date.parse(next) <= Date.parse(base)) {
		throw new Error('timelineImage image publication requires one fresh updatedAt timestamp.');
	}
}

function canonicalTimestamp(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`timelineImage image ${name} must be a timestamp.`);
	const date = new Date(value);
	if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
		throw new TypeError(`timelineImage image ${name} must be canonical.`);
	}
	return value;
}

function revision(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The timelineImage image ${name} revision must be a non-negative safe integer.`);
	}
	return Number(value);
}

function safeNextRevision(value: number): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError('The timelineImage image revision cannot increment safely.');
	return value + 1;
}

function revisionKey(projectId: string, revisionValue: number): string {
	return `${projectId}:${String(revisionValue).padStart(12, '0')}`;
}

function sameProject(left: unknown, right: unknown): boolean {
	try { return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right); }
	catch { return false; }
}

function optionalSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	if (!(value instanceof AbortSignal)) throw new TypeError('timelineImage image publication signal must be an AbortSignal.');
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('timelineImage image publication cancelled.', 'AbortError');
}

function stableId(value: Record<string, unknown>): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('timelineImage image identity must be non-empty.');
	return value.id;
}

function closedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
	optional: readonly Fields[number][] = [],
): Record<Fields[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const required = fields.filter((field) => !optional.includes(field));
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| required.some((field) => !Object.hasOwn(value, field))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	const output = Object.create(null) as Record<Fields[number], unknown>;
	for (const key of keys as string[]) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property.`);
		}
		output[key as Fields[number]] = descriptor.value;
	}
	return output;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	openFramescaperImageFramePackV1,
} from '../common/editor/timeline-image-frame-pack-v1.ts';
import type {
	FramescaperImageClipV1,
	FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v32.ts';
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
	applyFramescaperProjectCommandV32,
} from './editor-project-v32-commands.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import {
	cloneFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';

export const FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_V32 = 'timeline-image-asset' as const;
export const FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_V32 = 'framescaper-image-asset-v1' as const;

const TRANSITION_FIELDS = ['expected', 'project'] as const;
const PUBLISHER_DEPENDENCY_FIELDS = ['port', 'store', 'projectCodec'] as const;
const PUBLISHER_REQUEST_FIELDS = ['expected', 'project', 'bytes', 'signal'] as const;

export interface FramescaperTimelineImagePublicationTransitionV32 {
	readonly expected: unknown;
	readonly project: unknown;
}

export interface FramescaperTimelineImagePublicationV32
	extends FramescaperTimelineImagePublicationTransitionV32 {
	readonly bytes: Uint8Array;
	readonly signal?: AbortSignal;
}

export interface FramescaperTimelineImagePublicationStoreV32 {
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

export interface FramescaperTimelineImagePublisherV32Dependencies {
	readonly port: StorageRepositoryPort;
	readonly store: FramescaperTimelineImagePublicationStoreV32;
	readonly projectCodec?: FramescaperTimelineImageProjectCodecV32;
}

export interface FramescaperTimelineImageProjectCodecV32 {
	readonly authenticate: (profile: unknown) => void;
	readonly clone: (profile: unknown, project: unknown) => FramescaperProjectV32;
	readonly apply: (
		profile: unknown,
		project: unknown,
		command: unknown,
		options: Readonly<{ readonly now?: Date | string }>,
	) => FramescaperProjectV32;
}

const V32_PROJECT_CODEC: FramescaperTimelineImageProjectCodecV32 = Object.freeze({
	authenticate: assertFramescaperProjectV32Profile,
	clone: cloneFramescaperProjectV32,
	apply: applyFramescaperProjectCommandV32,
});

interface PreparedPublication {
	readonly expected: FramescaperProjectV32;
	readonly project: FramescaperProjectV32;
	readonly source: FramescaperImageSourceV1;
	readonly clip: FramescaperImageClipV1;
	readonly projectId: string;
	readonly baseRevision: number;
	readonly nextRevision: number;
}

/** Low-level CAS that roots one already-verified staged body with its exact V32 revision. */
export class FramescaperTimelineImagePublicationRepositoryV32 {
	readonly #profile: unknown;
	readonly #port: StorageRepositoryPort;
	readonly #codec: FramescaperTimelineImageProjectCodecV32;

	constructor(
		profile: unknown,
		port: StorageRepositoryPort | unknown,
		codec: FramescaperTimelineImageProjectCodecV32 = V32_PROJECT_CODEC,
	) {
		assertProjectCodec(codec);
		codec.authenticate(profile);
		assertPort(port);
		this.#profile = profile;
		this.#port = port;
		this.#codec = codec;
	}

	async publishIfCurrent(
		value: FramescaperTimelineImagePublicationTransitionV32 | unknown,
	): Promise<FramescaperProjectV32 | null> {
		const publication = preparePublication(this.#profile, value, this.#codec);
		const database = await this.#port.database();
		const published = database
			? await publishIndexedDb(database, publication)
			: publishMemory(this.#port, publication);
		return published ? this.#codec.clone(this.#profile, publication.project) : null;
	}
}

/** Authenticated writer plus project CAS with determinate staged-body cleanup. */
export class FramescaperTimelineImagePublisherV32 {
	readonly #profile: unknown;
	readonly #repository: FramescaperTimelineImagePublicationRepositoryV32;
	readonly #store: FramescaperTimelineImagePublicationStoreV32;
	readonly #codec: FramescaperTimelineImageProjectCodecV32;

	constructor(
		profile: unknown,
		dependenciesValue: FramescaperTimelineImagePublisherV32Dependencies | unknown,
	) {
		const dependencies = closedRecord(
			dependenciesValue,
			PUBLISHER_DEPENDENCY_FIELDS,
			'V32 timeline-image publisher dependencies',
			['projectCodec'],
		);
		assertPort(dependencies.port);
		assertStore(dependencies.store);
		const codec = dependencies.projectCodec === undefined
			? V32_PROJECT_CODEC : dependencies.projectCodec as FramescaperTimelineImageProjectCodecV32;
		assertProjectCodec(codec);
		codec.authenticate(profile);
		this.#profile = profile;
		this.#store = dependencies.store;
		this.#codec = codec;
		this.#repository = new FramescaperTimelineImagePublicationRepositoryV32(
			profile,
			dependencies.port,
			codec,
		);
	}

	async publishIfCurrent(
		value: FramescaperTimelineImagePublicationV32 | unknown,
	): Promise<FramescaperProjectV32 | null> {
		this.#codec.authenticate(this.#profile);
		const requestValue = closedRecord(
			value,
			PUBLISHER_REQUEST_FIELDS,
			'V32 timeline-image publication request',
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
					kind: FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_V32,
					encoding: FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_V32,
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
					'V32 timeline-image publication and owned-body rollback both failed.',
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
			|| metadata.kind !== FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_V32
			|| metadata.encoding !== FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_V32
			|| !Object.hasOwn(metadata, 'pendingProjectUntil')) {
			throw new Error('The staged V32 image body lost cleanup ownership.');
		}
		await this.#store.deleteMediaAsset(source.storageKey);
	}
}

function preparePublication(
	profile: unknown,
	value: unknown,
	codec: FramescaperTimelineImageProjectCodecV32,
): PreparedPublication {
	const raw = closedRecord(value, TRANSITION_FIELDS, 'V32 timeline-image publication');
	const expected = codec.clone(profile, raw.expected);
	const project = codec.clone(profile, raw.project);
	if (project.id !== expected.id) throw new Error('V32 image publication cannot change project identity.');
	const baseRevision = revision(expected.revision, 'base');
	const nextRevision = safeNextRevision(baseRevision);
	if (project.revision !== nextRevision) {
		throw new Error('V32 image publication must publish exactly the next revision.');
	}
	assertFreshTimestamp(expected.updatedAt, project.updatedAt);
	const expectedSourceIds = new Set(records(expected.sources, 'V32 base sources').map(stableId));
	const addedSources = records(project.sources, 'V32 target sources')
		.filter((source) => source.kind === 'image' && !expectedSourceIds.has(stableId(source)));
	if (addedSources.length !== 1) throw new Error('V32 image publication requires one fresh image source.');
	const source = addedSources[0] as unknown as FramescaperImageSourceV1;
	const expectedClipIds = new Set(allClips(expected).map(stableId));
	const addedClips = allClips(project)
		.filter((clip) => clip.kind === 'image' && !expectedClipIds.has(stableId(clip)));
	if (addedClips.length !== 1) throw new Error('V32 image publication requires one fresh image clip.');
	const clip = addedClips[0] as unknown as FramescaperImageClipV1;
	if (clip.sourceId !== source.id) throw new Error('The fresh V32 image clip must own its fresh source.');
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
		throw new Error('V32 image publication may add only one source, one clip, and its placement.');
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

function assertProjectCodec(value: unknown): asserts value is FramescaperTimelineImageProjectCodecV32 {
	if (!value || typeof value !== 'object') throw new TypeError('A timeline-image project codec is required.');
	for (const method of ['authenticate', 'clone', 'apply'] as const) {
		if (typeof (value as Readonly<Record<string, unknown>>)[method] !== 'function') {
			throw new TypeError(`The timeline-image project codec requires ${method}.`);
		}
	}
}

function freshTrackCommand(
	expected: FramescaperProjectV32,
	project: FramescaperProjectV32,
	clip: FramescaperImageClipV1,
	placement: ReturnType<typeof imagePlacement>,
): Record<string, unknown> | null {
	const expectedIds = new Set(records(expected.tracks, 'V32 base tracks').map(stableId));
	const targetTracks = records(project.tracks, 'V32 target tracks');
	const added = targetTracks.filter((track) => !expectedIds.has(stableId(track)));
	if (added.length === 0) return null;
	if (added.length !== 1 || placement.scope !== 'timeline') {
		throw new Error('V32 image publication may create at most one timeline video track.');
	}
	const track = added[0]!;
	const trackId = stableId(track);
	if (trackId !== placement.trackId || track.type !== 'video' || track.locked === true
		|| !Array.isArray(track.clipIds)
		|| track.clipIds.length !== 1 || track.clipIds[0] !== clip.id) {
		throw new Error('The fresh V32 image track must be unlocked and own only the fresh image clip.');
	}
	const primaryId = String(project.primarySequenceId);
	const owners = records(project.sequences, 'V32 target sequences').filter(({ trackIds }) => (
		Array.isArray(trackIds) && trackIds.includes(trackId)
	));
	if (owners.length !== 1 || owners[0]!.id !== primaryId) {
		throw new Error('The fresh V32 image track must belong only to the primary sequence.');
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
			throw new Error('The V32 image publication next revision is occupied.');
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
	if (memory.revisions.has(nextKey)) throw new Error('The V32 image publication next revision is occupied.');
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
	const row = record(value, 'V32 staged image body') as StorageRecord;
	const committedAt = canonicalTimestamp(row.committedAt, 'body committedAt');
	const pendingUntil = canonicalTimestamp(row.pendingProjectUntil, 'body pendingProjectUntil');
	if (Date.parse(pendingUntil) <= Date.parse(committedAt)
		|| row.sourceId !== source.storageKey
		|| row.kind !== FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_V32
		|| row.encoding !== FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_V32
		|| row.mimeType !== source.mimeType
		|| row.size !== source.assetByteLength
		|| trustedMediaContentSha256(row) !== source.contentSha256) {
		throw new Error('The staged V32 image body does not match its immutable source authority.');
	}
	return row;
}

function assertBaseRevision(value: unknown, publication: PreparedPublication): void {
	const row = record(value, 'V32 image base revision');
	const key = revisionKey(publication.projectId, publication.baseRevision);
	if (row.key !== key || row.projectId !== publication.projectId
		|| row.revision !== publication.baseRevision
		|| !sameProject(row.project, publication.expected)) {
		throw new Error('The exact V32 image base revision is missing or changed.');
	}
}

function imagePlacement(project: FramescaperProjectV32, clipId: string) {
	const timeline = records(project.clips, 'V32 target timeline clips').some(({ id }) => id === clipId);
	const bin = records(record(project.projectBin, 'V32 target project bin').clips, 'V32 target bin clips')
		.some(({ id }) => id === clipId);
	if (timeline === bin) throw new Error('The fresh V32 image clip requires one exact placement.');
	if (bin) return Object.freeze({ scope: 'project-bin' as const });
	const owners = records(project.tracks, 'V32 target tracks').filter(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(clipId)
	));
	if (owners.length !== 1 || owners[0]!.type !== 'video') {
		throw new Error('The fresh V32 timeline image requires one video-track owner.');
	}
	return Object.freeze({ scope: 'timeline' as const, trackId: stableId(owners[0]!) });
}

function allClips(project: FramescaperProjectV32): Record<string, unknown>[] {
	return [
		...records(project.clips, 'V32 timeline clips'),
		...records(record(project.projectBin, 'V32 project bin').clips, 'V32 bin clips'),
	];
}

function snapshotBytes(value: unknown, expectedBytes: number): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== expectedBytes) {
		throw new RangeError('V32 image publication bytes must match the exact asset length.');
	}
	return value.slice();
}

function assertPort(value: unknown): asserts value is StorageRepositoryPort {
	if (!value || typeof value !== 'object'
		|| typeof (value as StorageRepositoryPort).database !== 'function'
		|| !(value as StorageRepositoryPort).memory
		|| typeof (value as StorageRepositoryPort).memory !== 'object') {
		throw new TypeError('A storage repository port is required for V32 image publication.');
	}
}

function assertStore(value: unknown): asserts value is FramescaperTimelineImagePublicationStoreV32 {
	if (!value || typeof value !== 'object') throw new TypeError('A V32 image publication store is required.');
	for (const method of ['beginMediaAssetWrite', 'getMediaAssetMetadata', 'deleteMediaAsset'] as const) {
		if (typeof (value as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`The V32 image publication store requires ${method}.`);
		}
	}
}

function assertFreshTimestamp(before: unknown, after: unknown): void {
	const base = canonicalTimestamp(before, 'base updatedAt');
	const next = canonicalTimestamp(after, 'target updatedAt');
	if (Date.parse(next) <= Date.parse(base)) {
		throw new Error('V32 image publication requires one fresh updatedAt timestamp.');
	}
}

function canonicalTimestamp(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`V32 image ${name} must be a timestamp.`);
	const date = new Date(value);
	if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
		throw new TypeError(`V32 image ${name} must be canonical.`);
	}
	return value;
}

function revision(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The V32 image ${name} revision must be a non-negative safe integer.`);
	}
	return Number(value);
}

function safeNextRevision(value: number): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError('The V32 image revision cannot increment safely.');
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
	if (!(value instanceof AbortSignal)) throw new TypeError('V32 image publication signal must be an AbortSignal.');
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('V32 image publication cancelled.', 'AbortError');
}

function stableId(value: Record<string, unknown>): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('V32 image identity must be non-empty.');
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

/* SPDX-License-Identifier: AGPL-3.0-only */

import { compactProjectSourceMetadata } from '../retention.js';
import { serializeScapeProjectDocument } from '../scape-project-document.ts';
import { canonicalMediaContentBlob } from './media-content-digest.ts';
import { trustedMediaContentSha256 } from './media-content-provenance.ts';
import { request, transact } from './indexeddb-backend.ts';
import { asRecord } from './project-repository-support.ts';
import { sameProjectSnapshot } from './project-snapshot-equality.ts';
import type { ProjectDocument } from './project-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import type { StorageRepositories } from './repositories.ts';
import type { StorageRecord } from './media-records.ts';

export interface ProjectMediaResourceAuditV1 { readonly kind: 'project-media-resource-audit-v1'; }
interface State {
	readonly database: IDBDatabase | null;
	readonly memory: StorageRepositoryPort['memory'];
	readonly project: string;
	readonly pins: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}
const STATES = new WeakMap<object, State>(), ENROLLED = new WeakMap<object, Readonly<ProjectMediaResourceAuditV1>>();
const READ = Blob.prototype.arrayBuffer, SLICE = Blob.prototype.slice, FILL = Uint8Array.prototype.fill;

/** Fixed Current image-body authentication, not a raw-pin publication grant.
 * Lazy body owners keep unrelated storage startup graphs unchanged. Complete
 * scalar admission precedes every read; only a genuine native audit can enroll
 * an exact next project. Both guarded and raw ports must resolve to the same
 * actual database and memory backend before the publication transaction. */
export async function authenticateFramescaperProjectMediaResourcesV1(port: StorageRepositoryPort,
	media: StorageRepositories['media'], value: ProjectDocument): Promise<void> {
	const snapshot = compactProjectSourceMetadata(structuredClone(value)) as ProjectDocument;
	const serialized = serializeScapeProjectDocument(snapshot);
	if (snapshot.schemaFamily !== 'framescaper' || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.sources)) throw new TypeError('Current image audit requires an actual Frame project.');
	const [sourceOwner, collector, packOwner, lutOwner, brushOwner, mediaOwner, projection, rawOwner] = await Promise.all([
		import('../timeline-image-model-current-v1.ts'), import('../video-cube-lut-project-references-current-v1.ts'),
		import('../timeline-image-frame-pack-v1.ts'), import('../imaging/cube-lut-resource-v1.ts'), import('../imaging/brush-mask-resource-v1.ts'), import('./media-repository.ts'),
		import('../timeline-image-pack-source-current-v1.ts'), import('../timeline-image-raw-pack-current-v1.ts'),
	]);
	const closure = collector.collectFramescaperImageProjectResourcesCurrentV1(snapshot);
	const images = snapshot.sources.filter(source => asRecord(source)?.kind === 'image').map(sourceOwner.normalizeFramescaperImageSourceCurrentV1);
	for (const source of images) if (source.schemaVersion === 4) {
		if (BigInt(source.assetByteLength) * 3n + rawOwner.prepareFramescaperRawImageOriginalCurrentV1(source).decodeWorkingBytes > 1024n * 1024n * 1024n) throw new RangeError('Frame RAW native audit exceeds its 1 GiB working bound.');
	}
	const native = await mediaOwner.captureMediaProjectResourceAuditReaderV1(media, port), database = native.database;
	const pins = new Map<string, Readonly<Record<string, unknown>>>();
	for (const source of images) {
		const row = await pin(source.storageKey, source.assetByteLength, source.contentSha256);
		if (row.kind !== 'timeline-image' || row.encoding !== 'framescaper-image-asset-v1' || row.mimeType !== source.mimeType) throw new Error('Frame Original native metadata differs from its immutable pack authority.');
		const body = await bodyFor(source.storageKey, source.assetByteLength);
		if (source.schemaVersion === 4) await rawOwner.withFramescaperRawImageOriginalCurrentV1({ source,
			read: async (offset, length) => new Uint8Array(await Reflect.apply(READ, Reflect.apply(SLICE, body, [offset, offset + length]) as Blob, []) as ArrayBuffer) }, () => undefined);
		const packed = projection.framescaperImagePackSourceCurrentV1(source);
		const reader = await packOwner.openFramescaperImageFramePackV1({ source: packed,
			read: async (offset, length) => new Uint8Array(await Reflect.apply(READ, Reflect.apply(SLICE, body, [offset, offset + length]) as Blob, []) as ArrayBuffer) });
		for (let index = 0; index < source.canonical.frameCount; index++) {
			const pixels = await reader.readFrame(index), backing = pixels.buffer;
			Reflect.apply(FILL, new Uint8Array(backing), [0]);
		}
	}
	for (const reference of closure.luts) {
		await pin(reference.storageKey, reference.byteLength, reference.sha256);
		const body = await bodyFor(reference.storageKey, reference.byteLength), backing = await Reflect.apply(READ, body, []) as ArrayBuffer;
		try { await lutOwner.withCubeLutResourceV1({ reference, bytes: new Uint8Array(backing) }, () => undefined); }
		finally { Reflect.apply(FILL, new Uint8Array(backing), [0]); }
	}
	for (const reference of closure.brushes) {
		await pin(reference.storageKey, reference.byteLength, reference.sha256);
		const body = await bodyFor(reference.storageKey, reference.byteLength), backing = await Reflect.apply(READ, body, []) as ArrayBuffer;
		try { await brushOwner.withBrushMaskResourceV1({ reference, bytes: new Uint8Array(backing) }, () => undefined); }
		finally { Reflect.apply(FILL, new Uint8Array(backing), [0]); }
	}
	if (canonical(value) !== serialized) throw new Error('Frame project changed during native resource authentication.');
	const audit = Object.freeze({ kind: 'project-media-resource-audit-v1' as const });
	STATES.set(audit, { database, memory: native.memory, project: serialized, pins }); ENROLLED.set(value, audit);

	async function pin(key: string, size: number, digest: string): Promise<Readonly<Record<string, unknown>>> {
		const row = asRecord(database ? await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets!.get(key))) : native.memory.mediaAssets.get(key));
		if (!row) throw new Error('Frame resource body is missing before native publication.');
		if (row.sourceId !== key || row.size !== size || trustedMediaContentSha256(row as StorageRecord) !== digest) throw new Error('Frame resource body conflicts with immutable size or SHA authority.');
		const identity = rowIdentity(row), previous = pins.get(key);
		if (previous && !sameProjectSnapshot(previous, identity)) throw new Error('Frame resource body changed between declared owners.');
		pins.set(key, identity); return identity;
	}
	async function bodyFor(key: string, size: number): Promise<Blob> {
		const body = canonicalMediaContentBlob(await native.loadAsset(key, { expectedSize: size }));
		if (body.size !== size) throw new Error('Frame resource body has a stale native size.'); return body;
	}
}

/** No scalar copy, foreign backend or mutated project can reuse enrollment. */
export function captureProjectMediaResourceAuditV1(value: ProjectDocument): Readonly<ProjectMediaResourceAuditV1> | undefined {
	const audit = ENROLLED.get(value);
	if (!audit) {
		if (value.schemaFamily === 'framescaper' && Array.isArray(value.sources) && value.sources.some(source => asRecord(source)?.kind === 'image'
			&& (asRecord(source)?.schemaVersion === 3 || asRecord(source)?.schemaVersion === 4))) throw new Error('Current Frame project publication requires its genuine native body audit.');
		return undefined;
	}
	if (canonical(value) !== state(audit).project) throw new Error('Native body audit is outside its exact project snapshot.'); return audit;
}
export function assertProjectMediaResourceAuditBackendV1(audit: Readonly<ProjectMediaResourceAuditV1>, port: StorageRepositoryPort, database: IDBDatabase | null): void {
	const owned = state(audit); if (owned.database !== database || owned.memory !== port.memory) throw new Error('Native resource audit belongs to another backend.');
}
export function projectMediaResourceAuditKeysV1(audit: Readonly<ProjectMediaResourceAuditV1>): readonly string[] { return [...state(audit).pins.keys()]; }
export function assertProjectMediaResourceAuditRowV1(audit: Readonly<ProjectMediaResourceAuditV1>, key: string, value: unknown): void {
	const expected = state(audit).pins.get(key), row = asRecord(value);
	if (!expected || !row || !sameProjectSnapshot(rowIdentity(row), expected)) throw new Error('Frame resource body changed before the atomic project ACK.');
}
function state(audit: Readonly<ProjectMediaResourceAuditV1>): State { const value = STATES.get(audit); if (!value) throw new TypeError('Native resource audit requires its actual body owner.'); return value; }
function canonical(value: ProjectDocument): string { return serializeScapeProjectDocument(compactProjectSourceMetadata(structuredClone(value))); }
function rowIdentity(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
	const { blob, ...identity } = value;
	return { ...identity, ...(blob === undefined ? {} : { blob: { size: canonicalMediaContentBlob(blob).size, type: canonicalMediaContentBlob(blob).type } }) };
}

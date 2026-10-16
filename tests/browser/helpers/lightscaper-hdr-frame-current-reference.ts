/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { openFramescaperImageFramePackV1 } from '../../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../../src/common/editor/timeline-image-pack-source-current-v1.ts';
import { normalizeFramescaperHdrImageSourceCurrentV1 } from '../../../src/common/editor/timeline-image-model-hdr-current-v1.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../../../src/common/editor/video-cube-lut-project-references-current-v1.ts';
import { createFramescaperProjectStore } from '../../../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../../../src/framescaper/editor-project-storage-profile.ts';
import { editorProjectStorageProfileNames } from '../../../src/common/editor/storage/project-storage-profile.ts';

export { readRepairFramePhotoCustodyNativeV1 as readHdrPhotoCustodyCurrentV1 } from './lightscaper-repair-frame-current-reference.ts';
const DATABASE = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
const READ = Blob.prototype.arrayBuffer, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;

/** Poll only the actual committed row. No renderer or Original borrower runs. */
export async function readHdrFrameScalarCurrentV1(projectId: string) {
	check(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId), 'HDR observation requires an existing project ID.');
	const database = await existing(DATABASE);
	try {
		const project = await transact(database, ['projects'], 'readonly', async stores => {
			check(stores.projects, 'Actual Frame project store is missing.'); return cloneFramescaperProject(PROFILE, await request(stores.projects.get(projectId)));
		});
		check(project.id === projectId, 'HDR project identity changed.');
		const images = project.sources.filter(source => source.kind === 'image'); check(images.length === 1, 'HDR fixture requires one Source5.');
		const source = normalizeFramescaperHdrImageSourceCurrentV1(images[0]); return { project, source, revision: project.revision };
	} finally { database.close(); }
}

/** Authenticate actual native body/token custody. The independent fixed-format
 * parse below observes RGBFloat32LE bits; it never renders an alternative image
 * or replaces the application's importer, reader, codec or publication. */
export async function readHdrFrameCustodyCurrentV1(projectId: string) {
	const initial = await readHdrFrameScalarCurrentV1(projectId), source = initial.source;
	check(source.canonical.width === 2 && source.canonical.height === 1 && source.original.byteLength <= 4096 && source.assetByteLength <= 65_536,
		'HDR observer requires its bounded two-pixel native fixture.');
	const resources = collectFramescaperImageProjectResourcesCurrentV1(initial.project);
	check(resources.luts.length === 0 && resources.brushes.length === 0, 'HDR fixture must not hide unobserved resource bodies.');
	const store = createFramescaperProjectStore(PROFILE, { indexedDB, locks: navigator.locks, syncWorkerClient: null });
	let packed: Uint8Array<ArrayBuffer> | undefined, original: Uint8Array | undefined, cache: Uint8Array | undefined;
	const run = async () => {
		const row = await nativeRecord(source.storageKey), metadata = await store.getMediaAssetMetadata(source.storageKey);
		check(row.sourceId === source.storageKey && row.sha256 === source.contentSha256 && row.size === source.assetByteLength
			&& typeof row.mediaContentToken === 'string' && row.mediaContentDigestVersion === 1, 'HDR native pack identity/token differs.');
		const body = canonicalMediaContentBlob(await store.loadMediaAsset(source.storageKey));
		check(Number(Reflect.apply(SIZE, body, [])) === source.assetByteLength && await digestMediaContent(body) === source.contentSha256, 'HDR immutable pack body differs.');
		packed = new Uint8Array(await Reflect.apply(READ, body, []) as ArrayBuffer);
		const reader = await openFramescaperImageFramePackV1({ source: framescaperImagePackSourceCurrentV1(source), read: (offset, length) => packed!.slice(offset, offset + length) });
		check(JSON.stringify(reader.receipt) === canonical({ schemaVersion: 1, kind: 'hdr-original', hdr: source.hdr }), 'HDR packed receipt differs from its source.');
		original = await reader.readOriginal(); cache = await reader.readFrame(0);
		check(original.byteLength === source.original.byteLength && hash(original) === source.original.sha256 && cache.byteLength === 8, 'HDR Original/cache custody differs.');
		const native = inspectOriginal(original);
		check(native.pixelsSha256 === source.hdr.pixelsSha256 && native.metadataSha256 === source.hdr.metadataSha256, 'HDR native payload receipt differs.');
		check(JSON.stringify(await readHdrFrameScalarCurrentV1(projectId)) === JSON.stringify(initial), 'HDR project changed during observation.');
		check(JSON.stringify(await nativeRecord(source.storageKey)) === JSON.stringify(row)
			&& JSON.stringify(await store.getMediaAssetMetadata(source.storageKey)) === JSON.stringify(metadata), 'HDR immutable native content token changed during observation.');
		return { ...initial, resources, row, metadata, original: { bytes: Array.from(original), sha256: hash(original), byteLength: original.byteLength }, cache: Array.from(cache), native };
	};
	const outcome = await run().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const failures: unknown[] = outcome.ok ? [] : [outcome.error];
	for (const retire of [() => { packed?.fill(0); original?.fill(0); cache?.fill(0); }, () => store.close()]) {
		try { await retire(); } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'HDR native observation and retirement failed.', { cause: failures[0] });
	if (outcome.ok) return outcome.value; throw new Error('HDR observation has no outcome.');
}

function inspectOriginal(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	check(new TextDecoder().decode(bytes.subarray(0, 8)) === 'LSCHDRF1' && view.getUint32(8, true) === 64 && view.getUint32(12, true) === 1, 'HDR fixed header differs.');
	check(view.getUint32(16, true) === 2 && view.getUint32(20, true) === 1 && view.getUint32(28, true) === 24, 'HDR native extent/payload differs.');
	const metadataLength = view.getUint32(24, true), payload = Math.ceil((64 + metadataLength) / 4) * 4;
	check(metadataLength <= 4096 && payload + 24 === bytes.byteLength, 'HDR native fixture exceeds its bounded metadata/body.');
	const metadata = bytes.subarray(64, 64 + metadataLength), metadataSha256 = hash(metadata);
	check(bytesToHex(bytes.subarray(32, 64)) === metadataSha256, 'HDR metadata SHA256 differs.');
	const provenance: unknown = JSON.parse(new TextDecoder().decode(metadata));
	check(new TextDecoder().decode(metadata) === canonical(provenance), 'HDR provenance is not canonical JSON.');
	for (let at = 64 + metadataLength; at < payload; at++) check(bytes[at] === 0, 'HDR padding must be zero.');
	const values = [], bits = [];
	for (let index = 0; index < 6; index++) { const value = view.getFloat32(payload + index * 4, true); check(Number.isFinite(value), 'HDR native samples must remain finite.'); values.push(value); bits.push(view.getUint32(payload + index * 4, true)); }
	return { provenance, values, bits, pixelsSha256: hash(bytes.subarray(payload)), metadataSha256 };
}
async function nativeRecord(key: string): Promise<Readonly<Record<string, unknown>>> {
	const database = await existing(DATABASE);
	try { return await transact(database, ['mediaAssets'], 'readonly', async stores => {
		check(stores.mediaAssets, 'Native Frame asset store is missing.'); const value: unknown = await request(stores.mediaAssets.get(key));
		check(value && typeof value === 'object' && !Array.isArray(value), 'Native Frame asset row is missing.');
		const { blob, ...scalar } = value as Record<string, unknown>;
		return { ...scalar, ...(blob == null ? {} : { blob: { size: Number(Reflect.apply(SIZE, blob, [])), type: Reflect.apply(TYPE, blob, []) as string } }) };
	}); } finally { database.close(); }
}
function existing(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => { const opening = indexedDB.open(name);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true }); opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true }); });
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
	const text = JSON.stringify(value); if (text === undefined) throw new TypeError('HDR observation requires closed JSON.'); return text;
}
function hash(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

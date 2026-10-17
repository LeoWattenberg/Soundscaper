/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { openFramescaperImageFramePackV1 } from '../../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../../src/common/editor/timeline-image-pack-source-current-v1.ts';
import { normalizeFramescaperImageSourceV4 } from '../../../src/common/editor/timeline-image-model-v4.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../../../src/common/editor/video-cube-lut-project-references-current-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { decodeLibRawOriginalWasmV1 } from '../../../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { createFramescaperProjectStore } from '../../../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../../../src/framescaper/editor-project-storage-profile.ts';
import { editorProjectStorageProfileNames } from '../../../src/common/editor/storage/project-storage-profile.ts';

export { readRepairFramePhotoCustodyNativeV1 as readRawFramePhotoCustodyCurrentV1 } from './lightscaper-repair-frame-current-reference.ts';
const DATABASE = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
const READ = Blob.prototype.arrayBuffer, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;
let compiled: Promise<WebAssembly.Module> | undefined;
function nativeModule() {
	compiled ??= (async () => {
		const response = await fetch('https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm', { credentials: 'omit', mode: 'cors', redirect: 'error' });
		check(response.ok, 'Pinned RAW observer runtime is unavailable.'); const bytes = new Uint8Array(await response.arrayBuffer());
		try { return await compilePinnedLibRawModuleV1(bytes); } finally { bytes.fill(0); }
	})(); return compiled;
}

/** Read only the actual committed row. Polling opens no render/Original scope. */
export async function readRawFrameScalarCurrentV1(projectId: string) {
	identity(projectId); const database = await existing(DATABASE);
	try {
		const project = await transact(database, ['projects'], 'readonly', async stores => {
			check(stores.projects, 'Actual Frame project store is missing.'); return cloneFramescaperProject(PROFILE, await request(stores.projects.get(projectId)));
		});
		check(project.id === projectId, 'Frame observer project identity changed.');
		const images = project.sources.filter(source => source.kind === 'image'); check(images.length === 1, 'RAW Frame fixture requires one image source.');
		const source = normalizeFramescaperImageSourceV4(images[0]); return { project, source, revision: project.revision };
	} finally { database.close(); }
}

/** Authenticate bounded immutable pack/Original custody from native storage,
 * then independently open the pinned C ABI. No renderer, importer, publisher,
 * controller replacement or Worker URL adaptation participates in observation. */
export async function readRawFrameCustodyCurrentV1(projectId: string) {
	const initial = await readRawFrameScalarCurrentV1(projectId), source = initial.source;
	check(source.canonical.width === 32 && source.canonical.height === 32 && source.original.byteLength <= 4096 && source.assetByteLength <= 65_536,
		'RAW Frame observer requires the bounded owned 32 by 32 DNG.');
	const resources = collectFramescaperImageProjectResourcesCurrentV1(initial.project);
	check(resources.luts.length === 0 && resources.brushes.length === 0, 'RAW Frame witness must have no unobserved resource bodies.');
	const store = createFramescaperProjectStore(PROFILE, { indexedDB, locks: navigator.locks, syncWorkerClient: null });
	const metadata = store.getMediaAssetMetadata.bind(store), load = store.loadMediaAsset.bind(store);
	let packed: Uint8Array<ArrayBuffer> | undefined, original: Uint8Array | undefined, pixels: Uint8Array | undefined, words: Uint16Array | undefined;
	const run = async () => {
		const row = await nativeRecord(source.storageKey), token = await metadata(source.storageKey);
		check(row.sourceId === source.storageKey && row.sha256 === source.contentSha256 && row.size === source.assetByteLength
			&& typeof row.mediaContentToken === 'string' && row.mediaContentDigestVersion === 1, 'RAW Frame native body identity or content token differs.');
		const body = canonicalMediaContentBlob(await load(source.storageKey));
		check(Number(Reflect.apply(SIZE, body, [])) === source.assetByteLength && await digestMediaContent(body) === source.contentSha256, 'RAW Frame immutable pack body differs.');
		packed = new Uint8Array(await Reflect.apply(READ, body, []) as ArrayBuffer);
		const reader = await openFramescaperImageFramePackV1({ source: framescaperImagePackSourceCurrentV1(source), read: (offset, length) => packed!.slice(offset, offset + length) });
		check(JSON.stringify(reader.receipt) === canonicalReceipt(source.raw), 'Packed RAW receipt differs from the source declaration.');
		original = await reader.readOriginal(); pixels = await reader.readFrame(0);
		check(original.length === source.original.byteLength && hash(original) === source.original.sha256 && pixels.length === 4096, 'RAW Frame retained Original/cache differs.');
		const nativeInput = new Uint8Array(original);
		let decoded: ReturnType<typeof decodeLibRawOriginalWasmV1>;
		try { decoded = decodeLibRawOriginalWasmV1(await nativeModule(), nativeInput); } finally { nativeInput.fill(0); }
		words = decoded.frame.pixels;
		check(words.length === 4096 && JSON.stringify(decoded.frame.descriptor) === JSON.stringify(source.raw.descriptor) && decoded.rawFlip === source.raw.rawFlip,
			'RAW Frame actual native descriptor/orientation differs from its receipt.');
		const bytes = new Uint8Array(words.length * 2), wire = new DataView(bytes.buffer); let nativeSha256: string;
		try { for (let index = 0; index < words.length; index++) wire.setUint16(index * 2, words[index]!); nativeSha256 = hash(bytes); }
		finally { bytes.fill(0); }
		check(nativeSha256 === source.raw.pixelsSha256, 'RAW Frame independent native big-endian word SHA differs.');
		const after = await readRawFrameScalarCurrentV1(projectId);
		check(JSON.stringify(after) === JSON.stringify(initial), 'RAW Frame project changed during observation.');
		check(JSON.stringify(await nativeRecord(source.storageKey)) === JSON.stringify(row) && JSON.stringify(await metadata(source.storageKey)) === JSON.stringify(token),
			'RAW Frame native body content token changed during observation.');
		return { ...initial, resources, original: { bytes: Array.from(original), sha256: hash(original), byteLength: original.length },
			cache: Array.from(pixels), native: { descriptor: decoded.frame.descriptor, rawFlip: decoded.rawFlip, words: Array.from(words), sha256: nativeSha256 }, token, row };
	};
	const outcome = await run().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const errors: unknown[] = [];
	for (const retire of [() => { packed?.fill(0); original?.fill(0); pixels?.fill(0); words?.fill(0); }, () => store.close()]) {
		try { await retire(); } catch (error) { errors.push(error); }
	}
	if (!outcome.ok) { if (errors.length) throw new AggregateError([outcome.error, ...errors], 'RAW Frame observation and retirement failed.', { cause: outcome.error }); throw outcome.error; }
	if (errors.length) throw new AggregateError(errors, 'RAW Frame observation retirement failed.'); return outcome.value;
}

function canonicalReceipt(raw: unknown): string {
	// The pack codec orders object keys canonically; this independent comparison
	// orders only inert observer facts, without reusing its receipt normalizer.
	const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
		? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)])) : value;
	return JSON.stringify(ordered({ schemaVersion: 1, kind: 'raw-original', raw }));
}
async function nativeRecord(key: string): Promise<Readonly<Record<string, unknown>>> {
	const database = await existing(DATABASE);
	try {
		return await transact(database, ['mediaAssets'], 'readonly', async stores => {
			check(stores.mediaAssets, 'Native Frame asset store is missing.'); const value: unknown = await request(stores.mediaAssets.get(key));
			check(value && typeof value === 'object' && !Array.isArray(value), 'Native Frame asset row is missing.'); const row = value as Record<string, unknown>;
			const { blob, ...scalar } = row; return { ...scalar, ...(blob == null ? {} : { blob: { size: Number(Reflect.apply(SIZE, blob, [])), type: Reflect.apply(TYPE, blob, []) as string } }) };
		});
	} finally { database.close(); }
}
function existing(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => { const opening = indexedDB.open(name);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true }); opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true }); });
}
function identity(value: unknown): void { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value), 'RAW Frame observer needs an exact project ID.'); }
function hash(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

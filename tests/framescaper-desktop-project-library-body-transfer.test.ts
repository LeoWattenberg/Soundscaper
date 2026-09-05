/* SPDX-License-Identifier: AGPL-3.0-only */

// The baseline transfer wraps the core original/proxy/timing inventory with the still, cube LUT and
// transcript bodies a project also owns; each test drives one entry point over all three families.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1 } from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-management-v27.ts';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_ENCODING, VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';
import {
	acquireFramescaperDesktopBodies as acquireBodies,
	prepareFramescaperDesktopPublicationBodies as prepareBodies,
	uploadFramescaperDesktopPublicationBodies as uploadBodies,
	validateFramescaperDesktopBodies as validateBodies,
	type FramescaperDesktopBodyDescriptor, type FramescaperDesktopBodyStore,
	type FramescaperDesktopPreparedBody,
} from '../src/framescaper/desktop-project-library-body-transfer.ts';
import {
	FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES as MAXIMUM_CHUNK_BYTES,
} from '../src/framescaper/desktop-project-library-core-body-transfer.ts';
import type { FramescaperProject } from '../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;
type Descriptor = Readonly<FramescaperDesktopBodyDescriptor>;
type Prepared = Readonly<FramescaperDesktopPreparedBody>;

interface StoredAsset { readonly bytes: Uint8Array; readonly metadata: Data }

interface StoreLog {
	readonly loaded: string[]; readonly begun: Data[]; readonly written: number[];
	readonly committed: string[]; readonly aborted: string[]; readonly discarded: string[];
}

interface StoreOptions {
	readonly log?: StoreLog; readonly failAbort?: boolean;
	readonly metadata?: (key: string) => Data | null | undefined;
	readonly publicationMetadata?: (key: string, metadata: Data) => Data;
}

interface ProjectInput {
	readonly sources?: readonly Data[]; readonly videoFreezeFallbacks?: readonly Data[];
	readonly videoVisualPresentations?: readonly Data[]; readonly assistanceAssets?: readonly Data[];
}

const UTF8 = new TextEncoder();
const PROJECT_SHA256 = 'ab'.repeat(32);
const ORIGINAL_BYTES = UTF8.encode('framescaper managed original body');
const ORIGINAL_SHA256 = digestOf(ORIGINAL_BYTES);
const ORIGINAL_KEY = `media-sha256:${ORIGINAL_SHA256}`;
const PROXY_BYTES = UTF8.encode('framescaper managed proxy body');
const PROXY_SHA256 = digestOf(PROXY_BYTES);
const PROXY_KEY = `video-proxy-sha256:${PROXY_SHA256}`;
const SOURCE_TIMING = createVideoTimingAssetPublication(ORIGINAL_SHA256, timingInput(3));
const PROXY_TIMING = createVideoTimingAssetPublication(PROXY_SHA256, timingInput(5));
const SOURCE_TIMING_KEY = SOURCE_TIMING.reference.storageKey;
const PROXY_TIMING_KEY = PROXY_TIMING.reference.storageKey;
const STILL_BYTES = UTF8.encode('framescaper managed still body');
const STILL_KEY = 'still-body';
const LUT_TEXT = [
	'TITLE "Fixture"', 'LUT_3D_SIZE 2', '0.0 0.0 0.0', '1.0 0.0 0.0', '0.0 1.0 0.0', '1.0 1.0 0.0',
	'0.0 0.0 1.0', '1.0 0.0 1.0', '0.0 1.0 1.0', '1.0 1.0 1.0', '',
].join('\n');
const LUT_BYTES = UTF8.encode(LUT_TEXT);
const LUT = parseCubeLutV1(LUT_TEXT);
const LUT_KEY = 'cube-lut-body';
const TRANSCRIPT_MIME = ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1;
const TRANSCRIPT_BYTES = UTF8.encode('{"schemaVersion":1,"segments":[]}');
const TRANSCRIPT_KEY = `assistance-transcript-sha256:${digestOf(TRANSCRIPT_BYTES)}`;
const BODY_KEYS = [ORIGINAL_KEY, SOURCE_TIMING_KEY, PROXY_KEY, PROXY_TIMING_KEY, STILL_KEY,
	LUT_KEY, TRANSCRIPT_KEY];
const BODY_LENGTHS = [ORIGINAL_BYTES.byteLength, SOURCE_TIMING.bytes.byteLength,
	PROXY_BYTES.byteLength, PROXY_TIMING.bytes.byteLength, STILL_BYTES.byteLength,
	LUT_BYTES.byteLength, TRANSCRIPT_BYTES.byteLength];

function digestOf(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

function timingInput(frames: number) {
	return { timescale: 1_000, finalFrameDurationTicks: 40n,
		presentationTicks: Array.from({ length: frames }, (_, index) => BigInt(index * 40)) };
}

function attachment(): Data {
	return {
		kind: 'video-proxy-attachment', version: 1, storageKey: PROXY_KEY, mimeType: 'video/mp4',
		rule: 'exact-original-generation-proxy-content-and-timing-v1', sha256: PROXY_SHA256,
		byteLength: PROXY_BYTES.byteLength, originalSha256: ORIGINAL_SHA256, generatorVersion: 1,
		originalAuthorityKind: 'owned', generatorId: 'ffmpeg', recipeId: 'proxy-h264-540-v1',
		recipeVersion: 1, timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 5, boundaryCount: 6, timingAsset: PROXY_TIMING.reference,
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function videoSource(overrides: Data = {}): Data {
	return { kind: 'video', id: 'video-1', name: 'take one', imageSequence: null,
		storageKey: ORIGINAL_KEY, mimeType: 'video/mp4', contentSha256: ORIGINAL_SHA256,
		timingAsset: SOURCE_TIMING.reference, proxyAttachment: attachment(), ...overrides };
}

function stillSource(overrides: Data = {}): Data {
	return { kind: 'still', id: 'still-1', mimeType: 'image/png', storageKey: STILL_KEY,
		contentSha256: digestOf(STILL_BYTES), ...overrides };
}

function lutReference(overrides: Data = {}): Data {
	return { storageKey: LUT_KEY, sha256: LUT.sha256, byteLength: LUT.byteLength, size: LUT.size,
		domainMin: LUT.domainMin, domainMax: LUT.domainMax, ...overrides };
}

function transcriptAsset(): Data {
	return { id: 'transcript-1', body: { storageKey: TRANSCRIPT_KEY, mimeType: TRANSCRIPT_MIME,
		byteLength: TRANSCRIPT_BYTES.byteLength, sha256: digestOf(TRANSCRIPT_BYTES) } };
}

function conflictingLut(): Data {
	return { id: 'presentation-1', grade: { lut: lutReference({ size: 3 }) } };
}

function projectOf(input: ProjectInput = {}): FramescaperProject {
	return {
		sources: [videoSource(), stillSource()], videoFreezeFallbacks: [], videoFinishingPresets: [],
		videoProcessorStacks: [], videoMotionAnalyses: [], assistanceAssets: [transcriptAsset()],
		videoVisualPresentations: [{ id: 'presentation-1', grade: { lut: lutReference() } }],
		...input,
	} as unknown as FramescaperProject;
}

function assetOf(sourceId: string, mimeType: string, bytes: Uint8Array, kind?: string): [string, StoredAsset] {
	return [sourceId, { bytes, metadata: { sourceId, mimeType, size: bytes.byteLength,
		sha256: digestOf(bytes), ...(kind === undefined ? {} : { kind }) } }];
}

function retainedAssets(): Map<string, StoredAsset> {
	return new Map<string, StoredAsset>([
		assetOf(ORIGINAL_KEY, 'video/mp4', ORIGINAL_BYTES), assetOf(PROXY_KEY, 'video/mp4', PROXY_BYTES),
		assetOf(SOURCE_TIMING_KEY, VIDEO_TIMING_ASSET_MIME_TYPE, SOURCE_TIMING.bytes),
		assetOf(PROXY_TIMING_KEY, VIDEO_TIMING_ASSET_MIME_TYPE, PROXY_TIMING.bytes),
		assetOf(STILL_KEY, 'image/png', STILL_BYTES, 'still'), assetOf(LUT_KEY, 'text/plain', LUT_BYTES),
		assetOf(TRANSCRIPT_KEY, TRANSCRIPT_MIME, TRANSCRIPT_BYTES),
	]);
}

/** The exact identity string the transfer derives from one trusted metadata record. */
function identityOf(metadata: Data): string {
	return JSON.stringify({ sourceId: metadata.sourceId, mimeType: metadata.mimeType,
		size: metadata.size, sha256: metadata.sha256, kind: metadata.kind ?? null,
		encoding: metadata.encoding ?? null });
}

function emptyLog(): StoreLog {
	return { loaded: [], begun: [], written: [], committed: [], aborted: [], discarded: [] };
}

function assetStore(assets: Map<string, StoredAsset>, options: StoreOptions = {}): FramescaperDesktopBodyStore {
	const log = options.log ?? emptyLog();
	return {
		getMediaAssetMetadata: (key) => options.metadata?.(key) ?? assets.get(key)?.metadata ?? null,
		loadMediaAsset(key) {
			log.loaded.push(key);
			if (!assets.has(key)) throw new Error(`${key} is not retained.`);
			return new Blob([assets.get(key)!.bytes as Uint8Array<ArrayBuffer>]);
		},
		async beginMediaAssetWrite(key, metadata, writeOptions) {
			log.begun.push({ ...metadata });
			const published = { sourceId: key, mimeType: metadata.mimeType as string,
				size: writeOptions.expectedBytes, sha256: writeOptions.expectedSha256 };
			return {
				maximumChunkBytes: MAXIMUM_CHUNK_BYTES, bytesWritten: 0,
				async write(bytes: Uint8Array) { log.written.push(bytes.byteLength); },
				async commit() { throw new Error('An owned publication is required.'); },
				async commitOwned() {
					log.committed.push(key);
					return { metadata: options.publicationMetadata?.(key, published) ?? published,
						async discardIfCurrent() { log.discarded.push(key); return true; } };
				},
				async abort() { log.aborted.push(key);
					if (options.failAbort) throw new Error(`${key} could not be abandoned.`); },
			} satisfies OwnedMediaAssetWriter;
		},
	};
}

function chunkBridge(assets: Map<string, StoredAsset>, mutate?: (bytes: Uint8Array, key: string) => unknown) {
	const reads: string[] = [];
	return {
		reads, async readBodyChunk({ body, offset, length }: Readonly<{ body: Descriptor;
			offset: number; length: number }>) {
			reads.push(`${body.storageKey}@${String(offset)}+${String(length)}`);
			const bytes = assets.get(body.storageKey)?.bytes.slice(offset, offset + length) ?? new Uint8Array();
			return mutate ? mutate(bytes, body.storageKey) : bytes;
		},
	};
}

function preparedFixture(project = projectOf(), assets = retainedAssets()): Promise<readonly Prepared[]> {
	return prepareBodies(project, PROJECT_SHA256, assetStore(assets));
}

test('preflight describes the core inventory, then the still, cube LUT and transcript bodies', async () => {
	const prepared = await preparedFixture();
	assert.equal(Object.isFrozen(prepared), true);
	assert.deepEqual(prepared.map(({ descriptor }) => descriptor.kind), ['video-original',
		'video-timing', 'video-proxy', 'video-timing', 'framescaper-still', 'framescaper-cube-lut',
		'assistance-transcript']);
	assert.deepEqual(prepared.map(({ descriptor }) => descriptor.encoding), [
		'framescaper-video-original-v1', VIDEO_TIMING_ASSET_ENCODING, 'video-proxy-v1',
		VIDEO_TIMING_ASSET_ENCODING, 'still-image-v1', 'cube-lut-v1', 'assistance-transcript-v1']);
	assert.deepEqual(prepared.map(({ descriptor }) => descriptor.storageKey), BODY_KEYS);
	assert.deepEqual(prepared.map(({ descriptor }) => descriptor.byteLength), BODY_LENGTHS);
	assert.deepEqual(prepared.map(({ blob }) => blob?.size), BODY_LENGTHS);
	assert.equal(prepared[4]?.metadataIdentity, identityOf(retainedAssets().get(STILL_KEY)!.metadata));
	assert.equal(Object.isFrozen(prepared[4]), true);
	const descriptors = prepared.map(({ descriptor }) => descriptor);
	const validated = validateBodies(projectOf(), PROJECT_SHA256, descriptors);
	assert.deepEqual([validated, Object.isFrozen(validated)], [descriptors, true]);
});

test('preflight numbers extension bodies after the core inventory and loads only the selected one', async () => {
	const log = emptyLog();
	const seen: [string, number][] = [];
	const prepared = await prepareBodies(projectOf(), PROJECT_SHA256,
		assetStore(retainedAssets(), { log }), undefined, (descriptor, bodyIndex) => {
			seen.push([descriptor.kind, bodyIndex]);
			return descriptor.kind === 'framescaper-cube-lut';
		});
	assert.deepEqual(seen.map(([, bodyIndex]) => bodyIndex), [0, 1, 2, 3, 4, 5, 6]);
	assert.deepEqual(seen[5], ['framescaper-cube-lut', 5]);
	assert.deepEqual(log.loaded, [LUT_KEY]);
	assert.deepEqual(prepared.map(({ blob }) => blob !== null), [false, false, false, false, false, true, false]);
});

test('preflight skips an unretained original but refuses an unretained extension body', async () => {
	const assets = retainedAssets();
	assets.delete(ORIGINAL_KEY);
	const prepared = await preparedFixture(projectOf(), assets);
	assert.deepEqual(prepared.map(({ descriptor }) => descriptor.storageKey), BODY_KEYS.slice(1));
	assets.delete(STILL_KEY);
	await assert.rejects(preparedFixture(projectOf(), assets), /framescaper-still metadata is missing/u);
});

test('preflight refuses extension metadata that contradicts its project authority or binding', async () => {
	const authority = /body conflicts with project authority/u;
	const binding = /framescaper-still metadata conflicts with its project binding/u;
	for (const [key, overrides, message] of [
		[STILL_KEY, { size: 512 * 1024 * 1024 + 1 }, authority], [LUT_KEY, { size: LUT.byteLength + 1 }, authority],
		[LUT_KEY, { sha256: 'cd'.repeat(32) }, authority], [STILL_KEY, { mimeType: 'image/jpeg' }, authority],
		[STILL_KEY, { kind: 'framescaper-still' }, binding], [STILL_KEY, { encoding: 'freeze-render-v1' }, binding],
	] as const) {
		const assets = retainedAssets();
		const asset = assets.get(key)!;
		assets.set(key, { bytes: asset.bytes, metadata: { ...asset.metadata, ...overrides } });
		await assert.rejects(preparedFixture(projectOf(), assets), message);
	}
});

test('preflight refuses extension metadata that is absent, malformed or incomplete', async () => {
	const incomplete = /metadata is incomplete/u;
	for (const [metadata, message] of [
		['metadata' as unknown as Data, /framescaper-still metadata is missing/u],
		[[] as unknown as Data, /framescaper-still metadata is missing/u],
		[{ mimeType: 'image/png', size: 1, sha256: 'ab'.repeat(32) }, incomplete],
		[{ sourceId: STILL_KEY, mimeType: 'image/png', size: 0, sha256: 'ab'.repeat(32) }, incomplete],
		[{ sourceId: STILL_KEY, mimeType: 'image/png', size: 1, sha256: 'no' }, incomplete],
	] as const) {
		const assets = retainedAssets();
		assets.set(STILL_KEY, { bytes: STILL_BYTES, metadata: metadata as Data });
		await assert.rejects(preparedFixture(projectOf(), assets), message);
	}
});

test('preflight refuses an extension body whose metadata identity changed between its reads', async () => {
	const assets = retainedAssets();
	const stored = assets.get(STILL_KEY)!.metadata;
	let reads = 0;
	// Only the third read of the still drops the storage kind, leaving every other field intact.
	const store = assetStore(assets, { metadata: (key) => (key === STILL_KEY && ++reads === 3
		? { sourceId: stored.sourceId, mimeType: stored.mimeType, size: stored.size, sha256: stored.sha256 }
		: undefined) });
	await assert.rejects(prepareBodies(projectOf(), PROJECT_SHA256, store),
		/Managed baseline framescaper-still metadata changed during preflight/u);
});

test('preflight refuses a cube LUT body whose geometry contradicts its project reference', async () => {
	await assert.rejects(preparedFixture(projectOf({ videoVisualPresentations: [conflictingLut()] })),
		/cube LUT archive body conflicts with its project reference/u);
});

test('a still that backs a freeze fallback transfers under its freeze-render storage kind', async () => {
	const assets = retainedAssets();
	assets.set(...assetOf(STILL_KEY, 'image/png', STILL_BYTES, 'freeze-render'));
	const prepared = await preparedFixture(
		projectOf({ videoFreezeFallbacks: [{ renderedSourceId: 'still-1' }] }), assets);
	assert.deepEqual([prepared[4]?.descriptor.kind, prepared[4]?.descriptor.encoding],
		['framescaper-freeze-render', 'freeze-render-v1']);
});

test('preflight refuses a baseline inventory that exceeds its aggregate byte budget', async () => {
	const sources = Array.from({ length: 129 }, (_, index) => stillSource({
		id: `still-${String(index)}`, storageKey: `still-body-${String(index)}`,
		contentSha256: String(index).padStart(64, '0'),
	}));
	await assert.rejects(prepareBodies(
		projectOf({ sources, videoVisualPresentations: [], assistanceAssets: [] }), PROJECT_SHA256, {
		getMediaAssetMetadata: (key: string) => ({ sourceId: key, mimeType: 'image/png',
			size: 512 * 1024 * 1024, sha256: key.replace('still-body-', '').padStart(64, '0') }),
		loadMediaAsset: () => { throw new Error('an unselected body is never loaded'); },
	} as unknown as FramescaperDesktopBodyStore, undefined, () => false),
	/exceed their aggregate byte limit/u);
});

function uploadMetadata(descriptor: Descriptor, overrides: Data = {}): Data {
	return { sourceId: descriptor.storageKey, mimeType: descriptor.mimeType,
		size: descriptor.byteLength, sha256: descriptor.sha256, kind: 'still', ...overrides };
}

function uploadBody(bytes: Uint8Array, overrides: Partial<Descriptor> = {}): Prepared {
	const descriptor: Descriptor = {
		kind: 'framescaper-still', encoding: 'still-image-v1', sourceId: STILL_KEY,
		storageKey: STILL_KEY, mimeType: 'image/png', byteLength: bytes.byteLength,
		sha256: digestOf(bytes), ...overrides,
	};
	return {
		descriptor, blob: new Blob([bytes as Uint8Array<ArrayBuffer>]),
		metadataIdentity: identityOf(uploadMetadata(descriptor)),
	};
}

function uploadStore(prepared: Prepared, overrides: Data = {}) {
	return { getMediaAssetMetadata: () => uploadMetadata(prepared.descriptor, overrides) };
}

function acknowledgingBridge(calls: Data[], acknowledge?: (request: Data) => unknown) {
	return {
		async writePublicationChunk(request: Readonly<{ publicationId: string; bodyIndex: number;
			offset: number; bytes: Uint8Array }>) {
			calls.push({ ...request, byteLength: request.bytes.byteLength });
			if (acknowledge) return acknowledge({ ...request });
			return { bodyIndex: request.bodyIndex, complete: true,
				nextOffset: request.offset + request.bytes.byteLength };
		},
	};
}

test('upload writes one acknowledged chunk per prepared body and re-reads each body metadata', async () => {
	const assets = retainedAssets();
	const store = assetStore(assets);
	const prepared = await prepareBodies(projectOf(), PROJECT_SHA256, store);
	const calls: Data[] = [];
	const reread: string[] = [];
	await uploadBodies('publication-1', prepared, acknowledgingBridge(calls), {
		getMediaAssetMetadata(key: string) { reread.push(key); return store.getMediaAssetMetadata(key); },
	});
	assert.deepEqual(calls.map((call) => [call.publicationId, call.bodyIndex, call.offset]),
		BODY_KEYS.map((_key, index) => ['publication-1', index, 0]));
	assert.deepEqual(calls.map((call) => call.byteLength), BODY_LENGTHS);
	assert.deepEqual(reread, BODY_KEYS);
});

test('upload splits a body wider than one chunk into exact sequential writes', async () => {
	const bytes = new Uint8Array(MAXIMUM_CHUNK_BYTES + 16).fill(7);
	const prepared = uploadBody(bytes);
	const calls: Data[] = [];
	const completions: boolean[] = [];
	await uploadBodies('publication-2', [prepared], acknowledgingBridge(calls, (request) => {
		const nextOffset = Number(request.offset) + (request.bytes as Uint8Array).byteLength;
		completions.push(nextOffset === bytes.byteLength);
		return { bodyIndex: request.bodyIndex, nextOffset, complete: nextOffset === bytes.byteLength };
	}), uploadStore(prepared));
	assert.deepEqual(calls.map((call) => call.offset), [0, MAXIMUM_CHUNK_BYTES]);
	assert.deepEqual(calls.map((call) => call.byteLength), [MAXIMUM_CHUNK_BYTES, 16]);
	assert.deepEqual(completions, [false, true]);
});

test('upload skips a body whose bytes were never selected', async () => {
	const calls: Data[] = [];
	await uploadBodies('publication-3', [{ ...uploadBody(STILL_BYTES), blob: null }],
		acknowledgingBridge(calls),
		{ getMediaAssetMetadata: () => { throw new Error('an unselected body is never re-read'); } });
	assert.deepEqual(calls, []);
});

test('upload refuses an acknowledgement that is not a closed three-field record', async () => {
	const prepared = uploadBody(STILL_BYTES);
	const end = STILL_BYTES.byteLength;
	const shape = /acknowledgement changed shape/u;
	for (const [value, message] of [
		[null, /acknowledgement is invalid/u], [[], /acknowledgement is invalid/u],
		[{ bodyIndex: 0, nextOffset: end }, shape],
		[{ bodyIndex: 0, nextOffset: end, complete: true, extra: 1 }, shape],
		[{ bodyIndex: 0, nextOffset: 0.5, complete: true }, shape],
		[{ bodyIndex: 0, nextOffset: end, complete: 'yes' }, shape],
	] as const) {
		await assert.rejects(uploadBodies('publication-4', [prepared],
			acknowledgingBridge([], () => value), uploadStore(prepared)), { name: 'TypeError', message });
	}
});

test('upload refuses an acknowledgement that renumbers its sequential write', async () => {
	const prepared = uploadBody(STILL_BYTES);
	for (const acknowledgement of [
		{ bodyIndex: 1, nextOffset: STILL_BYTES.byteLength, complete: true },
		{ bodyIndex: 0, nextOffset: 1, complete: true },
		{ bodyIndex: 0, nextOffset: STILL_BYTES.byteLength, complete: false },
	]) {
		await assert.rejects(uploadBodies('publication-5', [prepared],
			acknowledgingBridge([], () => acknowledgement), uploadStore(prepared)),
		/acknowledgement changed its sequential write/u);
	}
});

test('upload refuses a body whose chunks, bytes or metadata identity drifted after preflight', async () => {
	const { descriptor } = uploadBody(STILL_BYTES);
	for (const buffer of [new ArrayBuffer(3), 'bytes' as unknown as ArrayBuffer]) {
		const blob = { slice: () => ({ arrayBuffer: async () => buffer }) } as unknown as Blob;
		const inexact: Prepared = { descriptor, blob, metadataIdentity: 'unused' };
		await assert.rejects(uploadBodies('publication-6', [inexact], acknowledgingBridge([]),
			uploadStore(inexact)), /framescaper-still emitted an inexact chunk/u);
	}
	const drifted = uploadBody(STILL_BYTES, { sha256: 'cd'.repeat(32) });
	await assert.rejects(uploadBodies('publication-7', [drifted], acknowledgingBridge([]),
		uploadStore(drifted)), /framescaper-still changed during upload/u);
	const prepared = uploadBody(STILL_BYTES);
	await assert.rejects(uploadBodies('publication-8', [prepared], acknowledgingBridge([]),
		uploadStore(prepared, { kind: undefined })),
	/framescaper-still metadata changed during upload/u);
	await assert.rejects(uploadBodies('publication-9', [prepared], acknowledgingBridge([]),
		uploadStore(prepared, { sourceId: 'moved' })),
	/framescaper-still metadata conflicts with its project binding/u);
});

async function acquisitionSetup(options: StoreOptions & Readonly<{
	project?: FramescaperProject; retained?: Map<string, StoredAsset>;
	mutate?: (bytes: Uint8Array, key: string) => unknown;
}> = {}) {
	const log = emptyLog();
	const project = options.project ?? projectOf();
	const prepared = await prepareBodies(project, PROJECT_SHA256, assetStore(retainedAssets()),
		undefined, () => false);
	return { log, project, descriptors: prepared.map(({ descriptor }) => descriptor),
		bridge: chunkBridge(retainedAssets(), options.mutate),
		store: assetStore(options.retained ?? new Map(), { ...options, log }) };
}

function acquire(setup: Awaited<ReturnType<typeof acquisitionSetup>>): Promise<void> {
	return acquireBodies(setup.project, PROJECT_SHA256, setup.descriptors, setup.bridge, setup.store);
}

test('acquisition retains every missing body under its storage kind and reference name', async () => {
	const setup = await acquisitionSetup();
	await acquire(setup);
	assert.deepEqual(setup.bridge.reads,
		BODY_KEYS.map((key, index) => `${key}@0+${String(BODY_LENGTHS[index])}`));
	assert.deepEqual(setup.log.begun.map(({ kind }) => kind), ['video-original', 'video-timing',
		'video-proxy', 'video-timing', 'still', 'cube-lut', 'assistance-transcript']);
	assert.deepEqual(setup.log.begun.slice(4).map(({ name }) => name),
		['still:framescaper:still:still-1', `lut:framescaper:lut:${LUT.sha256}`,
			`assistance:transcript:${TRANSCRIPT_KEY}`]);
	assert.deepEqual(setup.log.begun[0]?.name, ORIGINAL_KEY);
	assert.deepEqual(setup.log.committed, BODY_KEYS);
	assert.deepEqual(setup.log.written, BODY_LENGTHS);
	assert.deepEqual([setup.log.aborted, setup.log.discarded], [[], []]);
});

test('acquisition verifies an already retained inventory without crossing the bridge', async () => {
	const setup = await acquisitionSetup({ retained: retainedAssets() });
	await acquire(setup);
	assert.deepEqual(setup.bridge.reads, []);
	assert.deepEqual(setup.log.begun, []);
	assert.deepEqual(setup.log.loaded, BODY_KEYS);
});

test('acquisition refuses a bridge chunk of the wrong length and abandons its writer', async () => {
	const setup = await acquisitionSetup({ mutate: (bytes) => bytes.subarray(1) });
	await assert.rejects(acquire(setup), /baseline body read returned an inexact chunk/u);
	assert.deepEqual(setup.log.aborted, [ORIGINAL_KEY]);
	assert.deepEqual(setup.log.committed, []);
});

test('acquisition refuses bytes that fail the descriptor digest and rolls back what it published', async () => {
	const setup = await acquisitionSetup({
		mutate: (bytes, key) => (key === STILL_KEY ? new Uint8Array(bytes.byteLength) : bytes) });
	await assert.rejects(acquire(setup), /baseline framescaper-still body failed its SHA-256 binding/u);
	assert.deepEqual(setup.log.committed, BODY_KEYS.slice(0, 4));
	assert.deepEqual(setup.log.aborted, [STILL_KEY]);
	assert.deepEqual(setup.log.discarded, [...BODY_KEYS.slice(0, 4)].reverse());
});

test('acquisition refuses a cube LUT body whose geometry contradicts its project reference', async () => {
	const setup = await acquisitionSetup({ project: projectOf({ videoVisualPresentations: [conflictingLut()] }) });
	await assert.rejects(acquire(setup), /cube LUT archive body conflicts with its project reference/u);
	assert.deepEqual(setup.log.committed, BODY_KEYS.slice(0, 5));
	assert.deepEqual(setup.log.aborted, [LUT_KEY]);
	assert.deepEqual(setup.log.discarded, [...BODY_KEYS.slice(0, 5)].reverse());
});

test('acquisition refuses a publication that changed its descriptor', async () => {
	const setup = await acquisitionSetup({ publicationMetadata: (key, metadata) => (
		key === STILL_KEY ? { ...metadata, size: 1 } : metadata) });
	await assert.rejects(acquire(setup), /framescaper-still publication changed its descriptor/u);
	assert.deepEqual(setup.log.committed, BODY_KEYS.slice(0, 5));
	assert.deepEqual(setup.log.aborted, [STILL_KEY]);
	assert.deepEqual(setup.log.discarded, [...BODY_KEYS.slice(0, 4)].reverse());
});

test('a rollback failure is reported as an aggregate error around the original refusal', async () => {
	const setup = await acquisitionSetup({ failAbort: true, mutate: (bytes) => bytes.subarray(1) });
	await assert.rejects(acquire(setup), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /baseline body acquisition rollback failed/u);
		assert.match((error.cause as Error).message, /inexact chunk/u);
		assert.equal(error.errors.length, 2);
		return true;
	});
	assert.deepEqual(setup.log.aborted, [ORIGINAL_KEY]);
});

test('acquisition refuses two timing references that disagree under one storage key', async () => {
	const second = videoSource({ id: 'video-2', name: 'take two', proxyAttachment: null,
		timingAsset: { ...SOURCE_TIMING.reference, sourceSha256: PROXY_SHA256 } });
	const setup = await acquisitionSetup({
		project: projectOf({ sources: [videoSource(), second], assistanceAssets: [] }) });
	await assert.rejects(acquire(setup), /timing body .* has conflicting references/u);
	assert.deepEqual(setup.log.begun, []);
});

test('preflight, upload and acquisition each stop at an aborted signal', async () => {
	const controller = new AbortController();
	const prepared = uploadBody(STILL_BYTES);
	const descriptors = (await preparedFixture()).map(({ descriptor }) => descriptor);
	// The core inventory completes first, so only the extension loop observes this abort.
	await assert.rejects(prepareBodies(projectOf(), PROJECT_SHA256, assetStore(retainedAssets()),
		controller.signal, (_descriptor, bodyIndex) => {
			if (bodyIndex === 3) controller.abort();
			return false;
		}), { name: 'AbortError' });
	await assert.rejects(uploadBodies('publication-10', [prepared], acknowledgingBridge([]),
		uploadStore(prepared), controller.signal), { name: 'AbortError' });
	await assert.rejects(acquireBodies(projectOf(), PROJECT_SHA256, descriptors,
		chunkBridge(retainedAssets()), assetStore(retainedAssets()), controller.signal),
	{ name: 'AbortError' });
});

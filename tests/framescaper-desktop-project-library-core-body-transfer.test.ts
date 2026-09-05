/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_ENCODING, VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';
import {
	acquireFramescaperDesktopCoreBodies as acquireBodies,
	FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES as MAXIMUM_CHUNK_BYTES,
	prepareFramescaperDesktopCorePublicationBodies as prepareBodies,
	uploadFramescaperDesktopCorePublicationBodies as uploadBodies,
	validateFramescaperDesktopCoreBodies as validateBodies,
	type FramescaperDesktopCoreBodyDescriptor, type FramescaperDesktopCoreBodyStore,
	type FramescaperDesktopCorePreparedBody,
} from '../src/framescaper/desktop-project-library-core-body-transfer.ts';
import type { FramescaperProject } from '../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;
type Descriptor = Readonly<FramescaperDesktopCoreBodyDescriptor>;
type Prepared = Readonly<FramescaperDesktopCorePreparedBody>;

interface StoredAsset { readonly bytes: Uint8Array; readonly metadata: Data }

interface StoreLog {
	readonly loaded: string[]; readonly begun: string[]; readonly written: number[];
	readonly committed: string[]; readonly aborted: string[]; readonly discarded: string[];
}

const PROJECT_SHA256 = 'ab'.repeat(32);
const ORIGINAL_BYTES = new TextEncoder().encode('framescaper managed original body');
const ORIGINAL_SHA256 = digestOf(ORIGINAL_BYTES);
const ORIGINAL_KEY = `media-sha256:${ORIGINAL_SHA256}`;
const PROXY_BYTES = new TextEncoder().encode('framescaper managed proxy body');
const PROXY_SHA256 = digestOf(PROXY_BYTES);
const PROXY_KEY = `video-proxy-sha256:${PROXY_SHA256}`;
const SOURCE_TIMING = createVideoTimingAssetPublication(ORIGINAL_SHA256, timingInput(3));
const PROXY_TIMING = createVideoTimingAssetPublication(PROXY_SHA256, timingInput(5));
const SOURCE_TIMING_KEY = SOURCE_TIMING.reference.storageKey;
const PROXY_TIMING_KEY = PROXY_TIMING.reference.storageKey;

function digestOf(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

function timingInput(frames: number) {
	return {
		timescale: 1_000, finalFrameDurationTicks: 40n,
		presentationTicks: Array.from({ length: frames }, (_, index) => BigInt(index * 40)),
	};
}

function attachment(): Data {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: PROXY_KEY, mimeType: 'video/mp4',
		byteLength: PROXY_BYTES.byteLength, sha256: PROXY_SHA256,
		originalSha256: ORIGINAL_SHA256, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 5, boundaryCount: 6, timingAsset: PROXY_TIMING.reference,
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function videoSource(overrides: Data = {}): Data {
	return {
		kind: 'video', id: 'video-source', name: 'take one',
		storageKey: ORIGINAL_KEY, mimeType: 'video/mp4', contentSha256: ORIGINAL_SHA256,
		timingAsset: SOURCE_TIMING.reference, proxyAttachment: attachment(),
		...overrides,
	};
}

function projectOf(...sources: Data[]): FramescaperProject { return { sources } as unknown as FramescaperProject; }

function assetOf(sourceId: string, mimeType: string, bytes: Uint8Array): [string, StoredAsset] {
	return [sourceId, { bytes, metadata: { sourceId, mimeType, size: bytes.byteLength, sha256: digestOf(bytes) } }];
}

function identityOf(sourceId: string, mimeType: string, size: number, sha256: string): string {
	return JSON.stringify({ sourceId, mimeType, size, sha256 });
}

/** Every managed body the full fixture source retains, keyed the way the store is. */
function retainedAssets(): Map<string, StoredAsset> {
	return new Map<string, StoredAsset>([
		assetOf(ORIGINAL_KEY, 'video/mp4', ORIGINAL_BYTES),
		assetOf(SOURCE_TIMING_KEY, VIDEO_TIMING_ASSET_MIME_TYPE, SOURCE_TIMING.bytes),
		assetOf(PROXY_KEY, 'video/mp4', PROXY_BYTES),
		assetOf(PROXY_TIMING_KEY, VIDEO_TIMING_ASSET_MIME_TYPE, PROXY_TIMING.bytes),
	]);
}

function emptyLog(): StoreLog {
	return { loaded: [], begun: [], written: [], committed: [], aborted: [], discarded: [] };
}

interface StoreOptions {
	readonly log?: StoreLog; readonly failAbort?: boolean;
	readonly publicationMetadata?: (key: string, metadata: Data) => Data;
}

function assetStore(
	assets: Map<string, StoredAsset>,
	options: StoreOptions = {},
): FramescaperDesktopCoreBodyStore {
	const log = options.log ?? emptyLog();
	return {
		getMediaAssetMetadata: (key) => assets.get(key)?.metadata ?? null,
		loadMediaAsset(key) {
			log.loaded.push(key);
			const asset = assets.get(key);
			if (!asset) throw new Error(`${key} is not retained.`);
			return new Blob([asset.bytes as Uint8Array<ArrayBuffer>]);
		},
		async beginMediaAssetWrite(key, metadata, writeOptions) {
			log.begun.push(key);
			const published = { sourceId: key, mimeType: metadata.mimeType as string,
				size: writeOptions.expectedBytes, sha256: writeOptions.expectedSha256 };
			return {
				maximumChunkBytes: MAXIMUM_CHUNK_BYTES, bytesWritten: 0,
				async write(bytes) { log.written.push(bytes.byteLength); },
				async commit() { throw new Error('An owned publication is required.'); },
				async commitOwned() {
					log.committed.push(key);
					return {
						metadata: options.publicationMetadata?.(key, published) ?? published,
						async discardIfCurrent() { log.discarded.push(key); return true; },
					};
				},
				async abort() {
					log.aborted.push(key);
					if (options.failAbort) throw new Error(`${key} could not be abandoned.`);
				},
			} satisfies OwnedMediaAssetWriter;
		},
	};
}

function chunkBridge(assets: Map<string, StoredAsset>, mutate?: (bytes: Uint8Array) => unknown) {
	const reads: string[] = [];
	return {
		reads,
		async readBodyChunk({ body, offset, length }: Readonly<{
			body: Descriptor; offset: number; length: number;
		}>) {
			reads.push(`${body.storageKey}@${String(offset)}+${String(length)}`);
			const bytes = assets.get(body.storageKey)?.bytes.slice(offset, offset + length) ?? new Uint8Array();
			return mutate ? mutate(bytes) : bytes;
		},
	};
}

async function preparedFixture(): Promise<readonly Prepared[]> {
	return prepareBodies(projectOf(videoSource()), PROJECT_SHA256, assetStore(retainedAssets()));
}

async function acquisitionSetup(options: StoreOptions & Readonly<{
	retained?: Map<string, StoredAsset>; mutate?: (bytes: Uint8Array) => unknown;
}> = {}) {
	const log = emptyLog();
	return {
		log,
		descriptors: (await preparedFixture()).map((body) => body.descriptor),
		bridge: chunkBridge(retainedAssets(), options.mutate),
		store: assetStore(options.retained ?? new Map(), { ...options, log }),
	};
}

function acquire(setup: Awaited<ReturnType<typeof acquisitionSetup>>): Promise<void> {
	return acquireBodies(
		projectOf(videoSource()), PROJECT_SHA256, setup.descriptors, setup.bridge, setup.store,
	);
}

test('preflight describes the original, its timing asset, the proxy and the proxy timing in project order', async () => {
	const prepared = await preparedFixture();
	assert.equal(Object.isFrozen(prepared), true);
	assert.deepEqual(prepared.map(({ descriptor }) => (
		[descriptor.kind, descriptor.encoding, descriptor.storageKey, descriptor.byteLength]
	)), [
		['video-original', 'framescaper-video-original-v1', ORIGINAL_KEY, ORIGINAL_BYTES.byteLength],
		['video-timing', VIDEO_TIMING_ASSET_ENCODING, SOURCE_TIMING_KEY, SOURCE_TIMING.bytes.byteLength],
		['video-proxy', 'video-proxy-v1', PROXY_KEY, PROXY_BYTES.byteLength],
		['video-timing', VIDEO_TIMING_ASSET_ENCODING, PROXY_TIMING_KEY, PROXY_TIMING.bytes.byteLength],
	]);
	assert.match(prepared[2]?.descriptor.bindingId ?? '', /^p[a-f0-9]{64}$/u);
	assert.equal(prepared[0]?.descriptor.bindingId, undefined);
	assert.equal(prepared[0]?.blob?.size, ORIGINAL_BYTES.byteLength);
	assert.equal(prepared[0]?.metadataIdentity,
		identityOf(ORIGINAL_KEY, 'video/mp4', ORIGINAL_BYTES.byteLength, ORIGINAL_SHA256));
	assert.equal(Object.isFrozen(prepared[0]), true);
});

test('a preflighted inventory is exactly what validation admits back', async () => {
	const prepared = await preparedFixture();
	const descriptors = prepared.map((body) => body.descriptor);
	const validated = validateBodies(projectOf(videoSource()), PROJECT_SHA256, descriptors);
	assert.deepEqual(validated, descriptors);
	assert.equal(Object.isFrozen(validated), true);
});

test('preflight skips an unretained original but refuses an unretained proxy', async () => {
	const assets = retainedAssets();
	assets.delete(ORIGINAL_KEY);
	const prepared = await prepareBodies(projectOf(videoSource()), PROJECT_SHA256, assetStore(assets));
	assert.deepEqual(prepared.map((body) => body.descriptor.storageKey),
		[SOURCE_TIMING_KEY, PROXY_KEY, PROXY_TIMING_KEY]);
	assets.delete(PROXY_KEY);
	await assert.rejects(
		prepareBodies(projectOf(videoSource()), PROJECT_SHA256, assetStore(assets)),
		/video-proxy body video-proxy-sha256:[a-f0-9]{64} is missing/u,
	);
});

test('preflight refuses an original the project never bound to a content digest', async () => {
	const source = videoSource({ contentSha256: 'not-a-digest', proxyAttachment: null, timingAsset: null });
	await assert.rejects(
		prepareBodies(projectOf(source), PROJECT_SHA256, assetStore(retainedAssets())),
		/has no project-bound content digest/u,
	);
});

test('preflight refuses metadata that is absent or conflicts with its project binding', async () => {
	const assets = retainedAssets();
	const conflicts = { ...assets.get(ORIGINAL_KEY)?.metadata, mimeType: 'video/webm' };
	for (const [metadata, message] of [
		['metadata' as unknown as Data, /video-original metadata is missing/u],
		[conflicts, /video-original metadata conflicts with its project binding/u],
	] as const) {
		assets.set(ORIGINAL_KEY, { bytes: ORIGINAL_BYTES, metadata });
		await assert.rejects(
			prepareBodies(projectOf(videoSource()), PROJECT_SHA256, assetStore(assets)), message,
		);
	}
});

test('preflight refuses a body whose metadata changed between its two reads', async () => {
	const assets = retainedAssets();
	let reads = 0;
	await assert.rejects(prepareBodies(projectOf(videoSource()), PROJECT_SHA256, {
		...assetStore(assets),
		// Only the second read of the original body reports a different resident size.
		getMediaAssetMetadata: (key) => (++reads === 2
			? { ...assets.get(key)?.metadata, size: ORIGINAL_BYTES.byteLength + 1 }
			: assets.get(key)?.metadata ?? null),
	}), /video-original body .* changed during preflight/u);
});

test('preflight refuses body content that fails its immutable digest', async () => {
	await assert.rejects(prepareBodies(projectOf(videoSource()), PROJECT_SHA256, {
		...assetStore(retainedAssets()),
		loadMediaAsset: () => new Blob([new Uint8Array(ORIGINAL_BYTES.byteLength)]),
	}), /video-original body failed immutable verification/u);
});

test('preflight loads only the bodies its selection predicate admits', async () => {
	const log = emptyLog();
	const prepared = await prepareBodies(
		projectOf(videoSource()), PROJECT_SHA256, assetStore(retainedAssets(), { log }), undefined,
		(descriptor, bodyIndex) => bodyIndex === 2 && descriptor.kind === 'video-proxy',
	);
	assert.deepEqual(log.loaded, [PROXY_KEY]);
	assert.deepEqual(prepared.map((body) => body.blob === null), [true, true, false, true]);
});

test('preflight refuses managed bodies that exceed their aggregate byte budget', async () => {
	const bare = { timingAsset: null, proxyAttachment: null };
	const sources = ['body-a', 'body-b'].map((key) => videoSource({ id: key, storageKey: key, ...bare }));
	await assert.rejects(prepareBodies(projectOf(...sources), PROJECT_SHA256, {
		getMediaAssetMetadata: (key: string) => ({ sourceId: key, mimeType: 'video/mp4',
			size: 64 * 1024 * 1024 * 1024, sha256: ORIGINAL_SHA256 }),
		loadMediaAsset: () => { throw new Error('an unselected body must not be loaded'); },
		beginMediaAssetWrite: () => { throw new Error('preflight never writes'); },
	} as unknown as FramescaperDesktopCoreBodyStore, undefined, () => false),
	/exceed their aggregate byte limit/u);
});

test('two sources that share one managed body describe it once, and are refused when they disagree', async () => {
	const shared = { timingAsset: null, proxyAttachment: null };
	const prepared = await prepareBodies(projectOf(
		videoSource({ id: 'a', name: 'first', ...shared }),
		videoSource({ id: 'b', name: 'second', ...shared }),
	), PROJECT_SHA256, assetStore(retainedAssets()));
	assert.deepEqual(prepared.map((body) => body.descriptor.storageKey), [ORIGINAL_KEY]);
	assert.throws(() => validateBodies(projectOf(
		videoSource({ id: 'a', ...shared }),
		videoSource({ id: 'b', mimeType: 'video/webm', ...shared }),
	), PROJECT_SHA256, []), /managed body aliases for .* conflict/u);
});

test('a project beyond the managed body ceiling is refused', () => {
	const sources = Array.from({ length: 4_095 }, (_, index) => videoSource({
		id: `source-${String(index)}`, storageKey: `body-${String(index)}`,
		timingAsset: null, proxyAttachment: null,
	}));
	assert.throws(() => validateBodies(projectOf(...sources), PROJECT_SHA256, []), /body limit exceeded/u);
});

test('an inventory is read only against a well-formed project digest', () => {
	assert.throws(() => validateBodies(projectOf(), 'not-a-digest', []), /project digest is invalid/u);
	assert.deepEqual(validateBodies(projectOf(), PROJECT_SHA256, []), []);
});

test('a malformed inventory is refused before any project body is compared', () => {
	assert.throws(() => validateBodies(projectOf(), PROJECT_SHA256, [null]), /kind requires a record/u);
	assert.throws(
		() => validateBodies(projectOf(), PROJECT_SHA256, new Array<unknown>(4_095).fill(null)),
		/must be a bounded dense array/u,
	);
});

test('an inventory that repeats, drops or adds a body against the project is refused', async () => {
	const descriptors = (await preparedFixture()).map((body) => body.descriptor);
	const project = projectOf(videoSource());
	assert.throws(() => validateBodies(project, PROJECT_SHA256, [descriptors[0], descriptors[0]]),
		/body media-sha256:[a-f0-9]{64} is duplicated/u);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, descriptors.slice(0, 2)),
		/video-proxy body is missing/u);
	assert.throws(() => validateBodies(
		projectOf(videoSource({ proxyAttachment: null })), PROJECT_SHA256, descriptors,
	), /inventory contains an unbound body/u);
});

test('an inventory whose order differs from the project order is refused', async () => {
	const project = projectOf(videoSource({ proxyAttachment: null }));
	const descriptors = (await prepareBodies(project, PROJECT_SHA256, assetStore(retainedAssets())))
		.map((body) => body.descriptor);
	assert.equal(descriptors.length, 2);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, [...descriptors].reverse()),
		/inventory order changed/u);
});

test('a descriptor that drifts from its project binding is refused', async () => {
	const descriptors = (await preparedFixture()).map((body) => body.descriptor);
	const drifted = [...descriptors];
	drifted[2] = { ...descriptors[2] as Descriptor, byteLength: PROXY_BYTES.byteLength + 1 };
	assert.throws(() => validateBodies(projectOf(videoSource()), PROJECT_SHA256, drifted),
		/video-proxy descriptor changed its project binding/u);
});

test('a descriptor field served by an accessor is refused', async () => {
	const descriptors = (await preparedFixture()).map((body) => body.descriptor);
	const accessor = { ...descriptors[0] as Descriptor } as Data;
	let reads = 0;
	Object.defineProperty(accessor, 'sha256',
		{ enumerable: true, get() { reads += 1; return ORIGINAL_SHA256; } });
	assert.throws(
		() => validateBodies(projectOf(videoSource()), PROJECT_SHA256, [accessor, ...descriptors.slice(1)]),
		/must be an own enumerable data property/u,
	);
	assert.equal(reads, 0);
});

function uploadFixture(bytes: Uint8Array, overrides: Partial<Descriptor> = {}): Prepared {
	const sha256 = digestOf(bytes);
	return {
		descriptor: {
			kind: 'video-original', encoding: 'framescaper-video-original-v1',
			sourceId: ORIGINAL_KEY, storageKey: ORIGINAL_KEY, mimeType: 'video/mp4',
			byteLength: bytes.byteLength, sha256, ...overrides,
		},
		blob: new Blob([bytes as Uint8Array<ArrayBuffer>]),
		metadataIdentity: identityOf(ORIGINAL_KEY, 'video/mp4', bytes.byteLength, sha256),
	};
}

function uploadStore({ descriptor }: Prepared, overrides: Data = {}) {
	return {
		getMediaAssetMetadata: () => ({ sourceId: descriptor.storageKey, mimeType: descriptor.mimeType,
			size: descriptor.byteLength, sha256: descriptor.sha256, ...overrides }),
	};
}

function acknowledgingBridge(calls: Data[], acknowledge?: (request: Data) => unknown) {
	return {
		async writePublicationChunk(request: Readonly<{
			publicationId: string; bodyIndex: number; offset: number; bytes: Uint8Array;
		}>) {
			calls.push({ ...request, byteLength: request.bytes.byteLength });
			if (acknowledge) return acknowledge({ ...request });
			return { bodyIndex: request.bodyIndex, complete: true,
				nextOffset: request.offset + request.bytes.byteLength };
		},
	};
}

test('upload writes one acknowledged chunk per selected body and re-reads its metadata', async () => {
	const prepared = uploadFixture(ORIGINAL_BYTES);
	const calls: Data[] = [];
	let metadataReads = 0;
	const store = uploadStore(prepared);
	await uploadBodies('publication-1', [prepared], acknowledgingBridge(calls), {
		getMediaAssetMetadata: () => { metadataReads += 1; return store.getMediaAssetMetadata(); },
	});
	assert.deepEqual(calls, [{ publicationId: 'publication-1', bodyIndex: 0, offset: 0,
		bytes: ORIGINAL_BYTES, byteLength: ORIGINAL_BYTES.byteLength }]);
	assert.equal(metadataReads, 1);
});

test('upload splits a body wider than one chunk into exact sequential writes', async () => {
	const bytes = new Uint8Array(MAXIMUM_CHUNK_BYTES + 16).fill(7);
	const prepared = uploadFixture(bytes);
	const calls: Data[] = [];
	const completions: boolean[] = [];
	await uploadBodies('publication-2', [prepared], acknowledgingBridge(calls, (request) => {
		const nextOffset = Number(request.offset) + (request.bytes as Uint8Array).byteLength;
		const complete = nextOffset === bytes.byteLength;
		completions.push(complete);
		return { bodyIndex: request.bodyIndex, nextOffset, complete };
	}), uploadStore(prepared));
	assert.deepEqual(calls.map((call) => call.offset), [0, MAXIMUM_CHUNK_BYTES]);
	assert.deepEqual(calls.map((call) => call.byteLength), [MAXIMUM_CHUNK_BYTES, 16]);
	assert.deepEqual(completions, [false, true]);
});

test('upload skips a body whose bytes were never selected', async () => {
	const prepared = { ...uploadFixture(ORIGINAL_BYTES), blob: null };
	const calls: Data[] = [];
	await uploadBodies('publication-3', [prepared], acknowledgingBridge(calls), {
		getMediaAssetMetadata: () => { throw new Error('an unselected body is never re-read'); },
	});
	assert.deepEqual(calls, []);
});

test('upload refuses an acknowledgement that is not a closed record', async () => {
	const prepared = uploadFixture(ORIGINAL_BYTES);
	await assert.rejects(uploadBodies('publication-4', [prepared],
		acknowledgingBridge([], () => null), uploadStore(prepared)), /must be a plain record/u);
	await assert.rejects(uploadBodies('publication-4', [prepared],
		acknowledgingBridge([], () => ({ bodyIndex: 0 })), uploadStore(prepared)),
	/missing or unsupported fields/u);
});

test('upload refuses an acknowledgement that renumbers its sequential write', async () => {
	const prepared = uploadFixture(ORIGINAL_BYTES);
	for (const acknowledgement of [
		{ bodyIndex: 1, nextOffset: ORIGINAL_BYTES.byteLength, complete: true },
		{ bodyIndex: 0, nextOffset: 1, complete: true },
		{ bodyIndex: 0, nextOffset: ORIGINAL_BYTES.byteLength, complete: false },
	]) {
		await assert.rejects(uploadBodies('publication-5', [prepared],
			acknowledgingBridge([], () => acknowledgement), uploadStore(prepared)),
		/acknowledgement changed its sequential write/u);
	}
});

test('upload refuses a body blob that emits an inexact chunk', async () => {
	const descriptor = uploadFixture(ORIGINAL_BYTES).descriptor;
	for (const buffer of [new ArrayBuffer(3), 'bytes' as unknown as ArrayBuffer]) {
		const blob = { slice: () => ({ arrayBuffer: async () => buffer }) } as unknown as Blob;
		const prepared: Prepared = { descriptor, blob, metadataIdentity: 'unused' };
		await assert.rejects(uploadBodies('publication-6', [prepared],
			acknowledgingBridge([]), uploadStore(prepared)), /body emitted an inexact chunk/u);
	}
});

test('upload refuses a body whose bytes or metadata drifted after preflight', async () => {
	const drifted = uploadFixture(ORIGINAL_BYTES, { sha256: 'cd'.repeat(32) });
	await assert.rejects(uploadBodies('publication-7', [drifted], acknowledgingBridge([]),
		uploadStore(drifted)), /video-original body changed during upload/u);
	const prepared = uploadFixture(ORIGINAL_BYTES);
	await assert.rejects(uploadBodies('publication-8', [prepared], acknowledgingBridge([]),
		uploadStore(prepared, { sourceId: 'moved' })), /metadata conflicts with its project binding/u);
});

test('acquisition leaves an already retained inventory untouched', async () => {
	const setup = await acquisitionSetup({ retained: retainedAssets() });
	await acquire(setup);
	assert.deepEqual(setup.bridge.reads, []);
	assert.deepEqual(setup.log.begun, []);
	assert.deepEqual(setup.log.loaded, [ORIGINAL_KEY, SOURCE_TIMING_KEY, PROXY_KEY, PROXY_TIMING_KEY]);
});

test('acquisition retains every missing body through one owned publication each', async () => {
	const setup = await acquisitionSetup();
	const lengths = [ORIGINAL_BYTES.byteLength, SOURCE_TIMING.bytes.byteLength,
		PROXY_BYTES.byteLength, PROXY_TIMING.bytes.byteLength];
	const keys = [ORIGINAL_KEY, SOURCE_TIMING_KEY, PROXY_KEY, PROXY_TIMING_KEY];
	await acquire(setup);
	assert.deepEqual(setup.bridge.reads, keys.map((key, index) => `${key}@0+${String(lengths[index])}`));
	assert.deepEqual(setup.log.begun, keys);
	assert.deepEqual(setup.log.committed, keys);
	assert.deepEqual(setup.log.written, lengths);
	assert.deepEqual([setup.log.aborted, setup.log.discarded], [[], []]);
});

test('acquisition refuses a bridge chunk of the wrong length and abandons its writer', async () => {
	const setup = await acquisitionSetup({ mutate: (bytes) => bytes.subarray(1) });
	await assert.rejects(acquire(setup), /body read returned an inexact chunk/u);
	assert.deepEqual(setup.log.aborted, [ORIGINAL_KEY]);
	assert.deepEqual(setup.log.committed, []);
});

test('acquisition refuses bytes that fail the descriptor digest and rolls back what it published', async () => {
	let reads = 0;
	// The second body is served the right length of the wrong bytes.
	const setup = await acquisitionSetup({
		mutate: (bytes) => (++reads === 2 ? new Uint8Array(bytes.byteLength) : bytes),
	});
	await assert.rejects(acquire(setup), /video-timing body failed its SHA-256 binding/u);
	assert.deepEqual(setup.log.committed, [ORIGINAL_KEY]);
	assert.deepEqual(setup.log.aborted, [SOURCE_TIMING_KEY]);
	assert.deepEqual(setup.log.discarded, [ORIGINAL_KEY]);
});

test('acquisition refuses a publication that changed its descriptor', async () => {
	const setup = await acquisitionSetup({
		publicationMetadata: (key, metadata) => (
			key === SOURCE_TIMING_KEY ? { ...metadata, size: 1 } : metadata
		),
	});
	await assert.rejects(acquire(setup), /video-timing publication changed its descriptor/u);
	assert.deepEqual(setup.log.committed, [ORIGINAL_KEY, SOURCE_TIMING_KEY]);
	// The timing body, misreported by its store, is committed too: it rolls back ahead of the rest.
	assert.deepEqual(setup.log.discarded, [SOURCE_TIMING_KEY, ORIGINAL_KEY]);
	assert.deepEqual(setup.log.aborted, []);
});

test('a rollback failure is reported as an aggregate error around the original refusal', async () => {
	const setup = await acquisitionSetup({ failAbort: true, mutate: (bytes) => bytes.subarray(1) });
	await assert.rejects(acquire(setup), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /body acquisition rollback failed/u);
		assert.match((error.cause as Error).message, /inexact chunk/u);
		assert.equal(error.errors.length, 2);
		return true;
	});
	assert.deepEqual(setup.log.aborted, [ORIGINAL_KEY]);
});

test('preflight, upload and acquisition all stop at an already aborted signal', async () => {
	const assets = retainedAssets();
	const descriptors = (await preparedFixture()).map((body) => body.descriptor);
	const prepared = uploadFixture(ORIGINAL_BYTES);
	const controller = new AbortController();
	const aborted = { name: 'AbortError' };
	controller.abort();
	await assert.rejects(prepareBodies(projectOf(videoSource()), PROJECT_SHA256,
		assetStore(assets), controller.signal), aborted);
	await assert.rejects(uploadBodies('publication-9', [prepared], acknowledgingBridge([]),
		uploadStore(prepared), controller.signal), aborted);
	await assert.rejects(acquireBodies(projectOf(videoSource()), PROJECT_SHA256, descriptors,
		chunkBridge(assets), assetStore(assets), controller.signal), aborted);
});

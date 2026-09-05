/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Finishing Scape staging has two body routes: proxy timing, cube LUT and motion bodies are buffered
 * whole and re-validated, while stills, freeze renders and proxies stream into the owned media
 * writer. Both are driven here against a recording store, so refusals surface as errors.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { ScapeArchiveEntry, ScapeAssetDescriptor, ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import { SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES } from '../src/common/editor/scape-archive-video.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import type { ScapeImportStore, ScapeImportTransaction } from '../src/common/editor/scape-import-transaction.ts';
import type { ScapeProjectAssetExtensionImportRequest } from '../src/common/editor/scape-project-asset-extension.ts';
import type { OwnedMediaAssetPublication } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { videoMotionSettingsSha256V1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import type { VideoMotionAnalysisReferenceV1, VideoProcessorStackV1 } from '../src/common/editor/video-motion-model-v27.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { stageFramescaperScapeImportAssetsFinishing } from '../src/framescaper/editor-scape-asset-import-finishing.ts';
import type { FramescaperScapeAssetReferenceFinishing } from '../src/framescaper/editor-scape-asset-plan-finishing.ts';

type Json = Record<string, unknown>;
type Reference = FramescaperScapeAssetReferenceFinishing;

/** `emitted` lets the archive stream bytes that differ from the declared body. */
type Fixture = Readonly<{
	reference: Reference; bytes: Uint8Array; emitted?: Uint8Array; omitEntry?: boolean;
}>;

interface WriteLog {
	readonly storageKey: string; readonly metadata: Json; readonly options: Json;
	readonly chunks: Uint8Array[]; committed: boolean; aborted: boolean; discarded: boolean;
}

type HarnessOptions = Readonly<{
	stored?: ReadonlyMap<string, unknown>; bodies?: ReadonlyMap<string, Uint8Array>;
	onWrite?: () => void; onAbort?: () => void; onTrack?: () => void; published?: (metadata: Json) => Json;
	writer?: 'unowned' | 'oversized'; withoutLoad?: boolean;
}>;

const UTF8 = new TextEncoder();
const MANIFEST = {} as unknown as ScapeManifest;
const MOTION_TRANSFORM = { scale: 1, rotationRadians: 0, translateX: 0, translateY: 0, inlierCount: 0, meanError: 0 };
const STILL_BYTES = UTF8.encode('finishing still body');
const PROXY_BYTES = UTF8.encode('finishing proxy body');
const LUT_TEXT = [
	'TITLE "Fixture"', 'LUT_3D_SIZE 2', '0.0 0.0 0.0', '1.0 0.0 0.0', '0.0 1.0 0.0', '1.0 1.0 0.0',
	'0.0 0.0 1.0', '1.0 0.0 1.0', '0.0 1.0 1.0', '1.0 1.0 1.0', '',
].join('\n');

test('a rebound still streams to the storage key its remapped source owns, under the caller signal', async () => {
	const harnessValue = harness();
	const controller = new AbortController();
	await stageFramescaperScapeImportAssetsFinishing(request([stillFixture()], harnessValue, {
		project: { sources: [{ id: 'still-new', kind: 'still', storageKey: 'still-body-new' }] },
		sourceIdMap: new Map([['still-old', 'still-new']]),
		signal: controller.signal,
	}));

	const log = harnessValue.writes[0]!;
	assert.equal(harnessValue.writes.length, 1);
	assert.equal(log.storageKey, 'still-body-new');
	assert.deepEqual(log.metadata, {
		name: `still:${digest(STILL_BYTES)}`, kind: 'still', encoding: 'still-image-v1', mimeType: 'image/png',
	});
	assert.deepEqual(log.options, {
		expectedBytes: STILL_BYTES.byteLength, expectedSha256: digest(STILL_BYTES), signal: controller.signal,
	});
	assert.deepEqual(concat(log.chunks), STILL_BYTES);
	assert.equal(log.committed, true);
	assert.equal(harnessValue.tracked.length, 1);
});

test('a proxy body with no source identity streams to the storage key its reference declares', async () => {
	const harnessValue = harness();
	await stageFramescaperScapeImportAssetsFinishing(request([proxyFixture()], harnessValue, {}));

	const log = harnessValue.writes[0]!;
	assert.equal(log.storageKey, 'video-proxy-body');
	assert.equal(log.metadata.kind, 'video-proxy');
	assert.deepEqual(concat(log.chunks), PROXY_BYTES);
});

test('a freeze render whose rebound source is no longer a still refuses before any write', async () => {
	const harnessValue = harness();
	const freeze = stillFixture({
		role: 'freeze-render', kind: 'framescaper-freeze-render', encoding: 'freeze-render-v1',
		archiveId: 'framescaper:freeze-render:still-old', entry: 'framescaper/finishing/freeze/still-old/body',
	});
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(request([freeze], harnessValue, {
			project: { sources: [{ id: 'still-old', kind: 'video', storageKey: 'video-body' }] },
		})),
		/The finishing freeze-render body lost its rebound still source\./u,
	);
	assert.equal(harnessValue.writes.length, 0);
});

test('a reference whose archive entry is absent names the missing entry', async () => {
	const harnessValue = harness();
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(
			request([{ ...proxyFixture(), omitEntry: true }], harnessValue, {}),
		),
		/The finishing Scape archive is missing framescaper\/finishing\/proxy\/body\./u,
	);
	assert.equal(harnessValue.writes.length, 0);
});

test('import validation must be a record carrying both a reference list and a descriptor map', async () => {
	const harnessValue = harness();
	const staged = (validation: unknown): Promise<void> => stageFramescaperScapeImportAssetsFinishing(
		request([proxyFixture()], harnessValue, { validation }),
	);
	await assert.rejects(staged([]), {
		name: 'TypeError', message: /The exact finishing Scape import validation is required\./u,
	});
	await assert.rejects(staged({ references: [], descriptorByArchiveId: {} }), {
		name: 'TypeError', message: /The finishing Scape import validation is incomplete\./u,
	});
	assert.equal(harnessValue.writes.length, 0);
});

test('a buffered cube LUT body is written whole once its parsed geometry matches its reference', async () => {
	const harnessValue = harness();
	await stageFramescaperScapeImportAssetsFinishing(request([lutFixture()], harnessValue, {}));

	const log = harnessValue.writes[0]!;
	assert.equal(log.metadata.kind, 'cube-lut');
	assert.equal(log.metadata.encoding, 'cube-lut-v1');
	assert.deepEqual(concat(log.chunks), UTF8.encode(LUT_TEXT));
});

test('a cube LUT body whose parsed size contradicts its project reference is refused', async () => {
	const harnessValue = harness();
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(request([lutFixture(3)], harnessValue, {})),
		/The finishing cube LUT archive body conflicts with its project reference\./u,
	);
	assert.equal(harnessValue.writes.length, 0);
});

test('a buffered proxy timing body is written under the video-timing role unless its summary drifted', async () => {
	const staged = harness();
	const drifted = harness();
	await stageFramescaperScapeImportAssetsFinishing(request([timingFixture()], staged, {}));
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(request([timingFixture(2000)], drifted, {})),
		/The timing asset bytes failed their persisted summary binding\./u,
	);

	assert.equal(staged.writes[0]!.metadata.kind, 'video-timing');
	assert.deepEqual(concat(staged.writes[0]!.chunks), timingFixture().bytes);
	assert.equal(drifted.writes.length, 0);
});

test('a buffered body whose archive bytes fail their descriptor digest is refused', async () => {
	const harnessValue = harness();
	const fixture = { ...lutFixture(), emitted: UTF8.encode(LUT_TEXT.replace('Fixture', 'Fixturx')) };
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(request([fixture], harnessValue, {})),
		/failed SHA-256 verification\./u,
	);
	assert.equal(harnessValue.writes.length, 0);
});

test('a rebound motion analysis is re-encoded for its new source and its project record is rewritten', async () => {
	const harnessValue = harness();
	const motion = motionFixture('video-old', 'video-new');
	await stageFramescaperScapeImportAssetsFinishing(
		request([motion.fixture], harnessValue, { project: motion.project }),
	);

	const log = harnessValue.writes[0]!;
	const written = concat(log.chunks);
	const analysis = (motion.project.videoMotionAnalyses as Json[])[0]!;
	assert.notDeepEqual(written, motion.fixture.bytes);
	assert.equal((JSON.parse(new TextDecoder().decode(written)) as Json).sourceId, 'video-new');
	assert.equal(analysis.sha256, digest(written));
	assert.equal(analysis.storageKey, `motion-sha256:${digest(written)}`);
	assert.equal(analysis.byteLength, written.byteLength);
	assert.equal(log.storageKey, analysis.storageKey);
	assert.equal(log.metadata.kind, 'motion-analysis');
	assert.deepEqual(log.options, { expectedBytes: written.byteLength, expectedSha256: digest(written) });
});

test('a motion analysis whose source identity did not move keeps its archive bytes and digest', async () => {
	const harnessValue = harness();
	const motion = motionFixture('video-kept', 'video-kept');
	await stageFramescaperScapeImportAssetsFinishing(
		request([motion.fixture], harnessValue, { project: motion.project }),
	);

	const log = harnessValue.writes[0]!;
	assert.deepEqual(concat(log.chunks), motion.fixture.bytes);
	assert.equal((motion.project.videoMotionAnalyses as Json[])[0]!.sha256, digest(motion.fixture.bytes));
	assert.equal(log.storageKey, motion.fixture.reference.storageKey);
});

test('a motion analysis whose stack and analysis disagree on the rebound source is refused', async () => {
	const harnessValue = harness();
	const motion = motionFixture('video-old', 'video-new');
	(motion.project.videoProcessorStacks as Json[])[0]!.sourceId = 'video-other';
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(
			request([motion.fixture], harnessValue, { project: motion.project }),
		),
		/The finishing motion analysis could not follow its rebound source identity\./u,
	);
	assert.equal(harnessValue.writes.length, 0);
});

test('an already stored buffered body is verified against immutable content instead of rewritten', async () => {
	const fixture = lutFixture();
	const harnessValue = harness({
		stored: new Map([['cube-lut-body', storedMetadata(fixture, 'cube-lut')]]),
		bodies: new Map([['cube-lut-body', UTF8.encode(LUT_TEXT)]]),
	});
	await stageFramescaperScapeImportAssetsFinishing(request([fixture], harnessValue, {}));

	assert.equal(harnessValue.writes.length, 0);
	assert.equal(harnessValue.tracked.length, 0);
});

test('an already stored body must match its metadata and content through a readable store', async () => {
	const fixture = lutFixture();
	const metadata = storedMetadata(fixture, 'cube-lut');
	const staged = (options: HarnessOptions): Promise<void> => stageFramescaperScapeImportAssetsFinishing(
		request([fixture], harness({ stored: new Map([['cube-lut-body', metadata]]), ...options }), {}),
	);
	await assert.rejects(
		staged({ bodies: new Map([['cube-lut-body', UTF8.encode(LUT_TEXT.replace('Fixture', 'Fixturx'))]]) }),
		/Stored finishing archive body cube-lut-body conflicts with immutable content\./u,
	);
	await assert.rejects(
		staged({ stored: new Map([['cube-lut-body', { ...metadata, size: 3 }]]) }),
		/Stored finishing archive body cube-lut-body has conflicting role, size, or digest\./u,
	);
	await assert.rejects(staged({ stored: new Map([['cube-lut-body', 'stored']]) }), {
		name: 'TypeError', message: /stored finishing cube-lut metadata is invalid\./u,
	});
	await assert.rejects(staged({ withoutLoad: true }), {
		name: 'TypeError', message: /The finishing Scape import requires immutable media-body reads\./u,
	});
});

test('an already stored streaming body still verifies the archive stream it skipped writing', async () => {
	const fixture = proxyFixture();
	const harnessValue = harness({
		stored: new Map([['video-proxy-body', storedMetadata(fixture, 'video-proxy')]]),
		bodies: new Map([['video-proxy-body', PROXY_BYTES]]),
	});
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(request([{
			...fixture, emitted: UTF8.encode('finishing proxy bodx'),
		}], harnessValue, {})),
		/video-proxy-body failed SHA-256 verification\./u,
	);
	assert.equal(harnessValue.writes.length, 0);
});

test('the import requires a writer that both owns its publication and holds the fixed chunk bound', async () => {
	for (const writer of ['unowned', 'oversized'] as const) {
		await assert.rejects(
			stageFramescaperScapeImportAssetsFinishing(request([lutFixture()], harness({ writer }), {})),
			{ name: 'TypeError', message: /requires an exact bounded owned media writer\./u },
		);
	}
});

test('a failed body write aborts its writer, while a refused publication is discarded instead', async () => {
	const failure = new Error('the body write failed');
	const written = harness({ onWrite: () => { throw failure; } });
	const refused = harness({ onTrack: () => { throw failure; } });
	const staged = (value: ReturnType<typeof harness>): Promise<void> => (
		stageFramescaperScapeImportAssetsFinishing(request([lutFixture()], value, {}))
	);
	await assert.rejects(staged(written), (error: unknown) => error === failure);
	await assert.rejects(staged(refused), (error: unknown) => error === failure);
	assert.deepEqual([written.writes[0]!.aborted, written.writes[0]!.discarded], [true, false]);
	assert.deepEqual([refused.writes[0]!.aborted, refused.writes[0]!.discarded], [false, true]);
	assert.equal(written.tracked.length, 0);
});

test('a failed body write whose abort also fails reports both errors together', async () => {
	const failure = new Error('the body write failed');
	const cleanup = new Error('the writer could not be abandoned');
	const harnessValue = harness({
		onWrite: () => { throw failure; }, onAbort: () => { throw cleanup; },
	});
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(request([lutFixture()], harnessValue, {})),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.message, 'The finishing Scape body write and cleanup both failed.');
			assert.deepEqual(error.errors, [failure, cleanup]);
			return true;
		},
	);
});

test('a publication whose metadata contradicts the staged material stays tracked for rollback', async () => {
	const harnessValue = harness({
		published: (metadata) => ({ ...metadata, sha256: digest(UTF8.encode('other')) }),
	});
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(request([lutFixture()], harnessValue, {})),
		/Stored finishing archive body cube-lut-body has conflicting role, size, or digest\./u,
	);
	assert.equal(harnessValue.tracked.length, 1);
	assert.equal(harnessValue.writes[0]!.discarded, false);
	assert.equal(harnessValue.writes[0]!.aborted, false);
});

test('an already aborted signal stops staging before the store is consulted', async () => {
	const harnessValue = harness();
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		stageFramescaperScapeImportAssetsFinishing(
			request([proxyFixture()], harnessValue, { signal: controller.signal }),
		),
		{ name: 'AbortError' },
	);
	assert.equal(harnessValue.writes.length, 0);
});

function harness(options: HarnessOptions = {}) {
	const writes: WriteLog[] = [];
	const tracked: OwnedMediaAssetPublication[] = [];
	const store: Json = {
		getMediaAssetMetadata: (key: string) => Promise.resolve(options.stored?.get(key) ?? null),
		beginMediaAssetWrite(key: string, metadata: Json, writeOptions: Json) {
			const log: WriteLog = {
				storageKey: key, metadata, options: writeOptions, chunks: [],
				committed: false, aborted: false, discarded: false,
			};
			writes.push(log);
			const writer = {
				maximumChunkBytes: options.writer === 'oversized'
					? SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES + 1 : SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
				get bytesWritten() { return concat(log.chunks).byteLength; },
				async write(bytes: Uint8Array) { options.onWrite?.(); log.chunks.push(bytes.slice()); },
				async commit() { return {}; },
				async abort() { log.aborted = true; options.onAbort?.(); },
				async commitOwned() {
					log.committed = true;
					const body = concat(log.chunks);
					const published: Json = {
						sourceId: key, size: body.byteLength, sha256: digest(body), kind: metadata.kind,
						encoding: metadata.encoding, mimeType: metadata.mimeType,
					};
					return {
						metadata: options.published?.(published) ?? published,
						discardIfCurrent: async () => { log.discarded = true; return true; },
					};
				},
			};
			if (options.writer !== 'unowned') return Promise.resolve(writer);
			const { commitOwned, ...unowned } = writer;
			return Promise.resolve(unowned);
		},
	};
	if (!options.withoutLoad) {
		store.loadMediaAsset = (key: string) => Promise.resolve(
			new Blob([(options.bodies?.get(key) ?? new Uint8Array()).slice().buffer as ArrayBuffer]),
		);
	}
	const transaction = {
		trackProvisionalMedia(publication: OwnedMediaAssetPublication) {
			options.onTrack?.();
			tracked.push(publication);
		},
	} as unknown as ScapeImportTransaction;
	return { store: store as unknown as ScapeImportStore, transaction, writes, tracked };
}

function request(
	fixtures: readonly Fixture[],
	harnessValue: ReturnType<typeof harness>,
	overrides: Readonly<{
		project?: Json; sourceIdMap?: ReadonlyMap<string, string>; signal?: AbortSignal; validation?: unknown;
	}>,
): ScapeProjectAssetExtensionImportRequest {
	const entryByName = new Map<string, ScapeArchiveEntry>();
	const descriptorByArchiveId = new Map<string, ScapeAssetDescriptor>();
	for (const fixture of fixtures) {
		const descriptor = assetDescriptor(fixture);
		descriptorByArchiveId.set(descriptor.sourceId, descriptor);
		if (fixture.omitEntry) continue;
		entryByName.set(descriptor.entry, archiveEntry(descriptor.entry, fixture.emitted ?? fixture.bytes));
	}
	return {
		archiveProject: {}, project: overrides.project ?? {}, manifest: MANIFEST, entryByName,
		expandedByteBudget: new ScapeExpandedByteBudget(64 * 1024 * 1024),
		sourceIdMap: overrides.sourceIdMap ?? new Map<string, string>(),
		validation: overrides.validation
			?? { references: fixtures.map(({ reference }) => reference), descriptorByArchiveId },
		store: harnessValue.store, transaction: harnessValue.transaction,
		...(overrides.signal ? { signal: overrides.signal } : {}),
	};
}

function archiveEntry(filename: string, bytes: Uint8Array): ScapeArchiveEntry {
	return {
		filename, directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: bytes.byteLength, uncompressedSize: bytes.byteLength,
		async getData(writable) {
			const output = writable.getWriter();
			await output.write(bytes);
			await output.close();
		},
	};
}

function assetDescriptor({ reference, bytes }: Fixture): ScapeAssetDescriptor {
	return {
		sourceId: reference.archiveId, kind: reference.kind, encoding: reference.encoding,
		entry: reference.entry, mimeType: reference.mimeType, size: bytes.byteLength, sha256: digest(bytes),
	};
}

function storedMetadata({ reference, bytes }: Fixture, kind: string): Json {
	return {
		sourceId: reference.storageKey, size: bytes.byteLength, sha256: digest(bytes),
		kind, encoding: reference.encoding, mimeType: reference.mimeType,
	};
}

function assetReference(overrides: Partial<Reference>): Reference {
	const base: Reference = {
		role: 'still', archiveId: 'framescaper:still:still-old', kind: 'framescaper-still',
		encoding: 'still-image-v1', entry: 'framescaper/finishing/still/still-old/body',
		mimeType: 'image/png', storageKey: 'still-body', sha256: digest(STILL_BYTES),
		byteLength: null, maximumBytes: 512 * 1024 * 1024, sourceId: null,
		timingReference: null, lutReference: null, motionReference: null, processorStack: null,
	};
	return Object.freeze({ ...base, ...overrides });
}

function stillFixture(overrides: Partial<Reference> = {}): Fixture {
	return { reference: assetReference({ sourceId: 'still-old', ...overrides }), bytes: STILL_BYTES };
}

function proxyFixture(): Fixture {
	return {
		reference: assetReference({
			role: 'proxy', archiveId: 'framescaper:proxy:body', kind: 'framescaper-video-proxy',
			encoding: 'video-proxy-v1', entry: 'framescaper/finishing/proxy/body',
			mimeType: 'video/mp4', storageKey: 'video-proxy-body',
			sha256: digest(PROXY_BYTES), byteLength: PROXY_BYTES.byteLength,
		}),
		bytes: PROXY_BYTES,
	};
}

/** A declared LUT size other than the parsed one models a project reference that drifted. */
function lutFixture(declaredSize?: number): Fixture {
	const parsed = parseCubeLutV1(LUT_TEXT);
	return {
		reference: assetReference({
			role: 'lut', archiveId: 'framescaper:lut:body', kind: 'framescaper-cube-lut',
			encoding: 'cube-lut-v1', entry: 'framescaper/finishing/lut/body.cube',
			mimeType: 'text/plain', storageKey: 'cube-lut-body',
			sha256: parsed.sha256, byteLength: parsed.byteLength,
			lutReference: {
				storageKey: 'cube-lut-body', sha256: parsed.sha256, byteLength: parsed.byteLength,
				size: declaredSize ?? parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax,
			},
		}),
		bytes: UTF8.encode(LUT_TEXT),
	};
}

function timingFixture(declaredTimescale = 1000): Fixture {
	const { reference, bytes } = createVideoTimingAssetPublication(digest(PROXY_BYTES), {
		timescale: 1000, presentationTicks: [0n, 100n], finalFrameDurationTicks: 100n,
	});
	return {
		reference: assetReference({
			role: 'proxy-timing', archiveId: 'framescaper:proxy-timing:body',
			kind: 'framescaper-proxy-timing', encoding: reference.encoding,
			entry: 'framescaper/finishing/proxy-timing/body.scti',
			mimeType: 'application/vnd.soundscaper.video-timing',
			storageKey: reference.storageKey, sha256: reference.sha256, byteLength: reference.byteLength,
			timingReference: { ...reference, timescale: declaredTimescale },
		}),
		bytes,
	};
}

function motionFixture(
	archiveSourceId: string,
	projectSourceId: string,
): Readonly<{ fixture: Fixture; project: Json }> {
	const archiveStack = processorStack(archiveSourceId);
	const inputSha256 = digest(UTF8.encode('motion input'));
	const settingsSha256 = videoMotionSettingsSha256V1(archiveStack);
	const bytes = UTF8.encode(JSON.stringify({
		schemaVersion: 1, analysisId: 'motion-1', sourceId: archiveSourceId, processorStackId: 'stack-1',
		inputSha256, settingsSha256, analysisWidth: 4, analysisHeight: 4, startFrame: 0, endFrame: 2,
		transforms: [{ frameNumber: 1, transform: MOTION_TRANSFORM }],
	}));
	const analysis: VideoMotionAnalysisReferenceV1 = {
		schemaVersion: 1, id: 'motion-1', sourceId: archiveSourceId, processorStackId: 'stack-1',
		inputSha256, settingsSha256, storageKey: `motion-sha256:${digest(bytes)}`, sha256: digest(bytes),
		byteLength: bytes.byteLength, startFrame: 0, endFrame: 2,
	};
	return {
		fixture: {
			reference: assetReference({
				role: 'motion', archiveId: `framescaper:motion:${analysis.sha256}`,
				kind: 'framescaper-motion-analysis', encoding: 'motion-analysis-json-v1',
				entry: `framescaper/finishing/motion/${analysis.sha256}.json`,
				mimeType: 'application/vnd.framescaper.motion-analysis+json',
				storageKey: analysis.storageKey, sha256: analysis.sha256,
				byteLength: analysis.byteLength, maximumBytes: 1024 * 1024 * 1024,
				sourceId: archiveSourceId, motionReference: analysis, processorStack: archiveStack,
			}),
			bytes,
		},
		project: {
			videoMotionAnalyses: [{ ...analysis, sourceId: projectSourceId }],
			videoProcessorStacks: [{ ...processorStack(projectSourceId) }],
		},
	};
}

function processorStack(sourceId: string): VideoProcessorStackV1 {
	return { schemaVersion: 1, id: 'stack-1', sourceId, processors: [] };
}

function digest(bytes: Uint8Array): string {
	return bytesToHex(sha256(bytes));
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter,
} from '@zip.js/zip.js';

import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from '../src/common/editor/storage/media-content-digest.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-management-v27.ts';
import {
	analyzeVideoMotionV1,
	requireVideoMotionAnalysisBodyV1,
} from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import { createFramescaperScapeNativeRuntimeV27 } from '../src/framescaper/editor-scape-native-v27.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from '../src/framescaper/editor-project-feature-requirements-v27.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	type FramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import {
	rewriteScapeManifest,
	rewriteScapeProjectDocument,
} from './helpers/scape-archive-rewrite.js';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;
const RUNTIME = createFramescaperScapeNativeRuntimeV27(PROFILE);
const ORIGINAL_BYTES = new TextEncoder().encode('V27 original video body');
const STILL_BYTES = new TextEncoder().encode('V27 deterministic freeze still');
const PROXY_BYTES = new TextEncoder().encode('V27 proxy body');
const ORIGINAL_SHA = digestScapeBytes(ORIGINAL_BYTES);
const STILL_SHA = digestScapeBytes(STILL_BYTES);
const PROXY_SHA = digestScapeBytes(PROXY_BYTES);
const LUT_TEXT = [
	'LUT_3D_SIZE 2',
	'0 0 0', '0 0 1', '0 1 0', '0 1 1',
	'1 0 0', '1 0 1', '1 1 0', '1 1 1',
].join('\n');

type Store = ReturnType<typeof createProjectStore>;

interface Fixture {
	readonly project: FramescaperProjectV27;
	readonly timing: ReturnType<typeof createVideoTimingAssetPublication>;
	readonly motion: Awaited<ReturnType<typeof analyzeVideoMotionV1>>;
	readonly lut: ReturnType<typeof parseCubeLutV1>;
}

test('selected V27 Scape roundtrip owns every durable M4 body with exact roles', async (context) => {
	const fixture = await projectFixture();
	const sender = memoryStore(context, 'roundtrip-sender');
	const recipient = memoryStore(context, 'roundtrip-recipient');
	await seedBodies(sender, fixture);

	const exported = await RUNTIME.exportScapeProject(fixture.project, sender) as ArchiveExport;
	assert.deepEqual(exported.manifest.assets.map(({ kind }) => kind), [
		'video',
		'framescaper-video-proxy',
		'framescaper-proxy-timing',
		'framescaper-freeze-render',
		'framescaper-cube-lut',
		'framescaper-motion-analysis',
	]);
	assert.equal(exported.manifest.assets.filter(({ kind }) => kind === 'framescaper-cube-lut').length, 1,
		'presentation and preset references must share one authenticated LUT body');

	const imported = await RUNTIME.importScapeProject(exported.blob!, recipient) as ImportResult;
	assert.equal(imported.readOnly, false);
	assert.equal(imported.collision, null);
	assert.deepEqual(imported.project, fixture.project);
	await assertBody(recipient, 'video-source', ORIGINAL_BYTES);
	await assertBody(recipient, 'still-source', STILL_BYTES);
	await assertBody(recipient, `video-proxy-sha256:${PROXY_SHA}`, PROXY_BYTES);
	await assertBody(recipient, fixture.timing.reference.storageKey, fixture.timing.bytes);
	await assertBody(recipient, `lut-sha256:${fixture.lut.sha256}`, new TextEncoder().encode(LUT_TEXT));
	await assertBody(recipient, fixture.motion.reference.storageKey, fixture.motion.bytes);

	const returned = await RUNTIME.exportScapeProject(imported.project, recipient) as ArchiveExport;
	assert.deepEqual(assetAuthority(returned), assetAuthority(exported));
});

test('source collisions rebind still, generator links, freeze, color, and canonical motion bodies', async (context) => {
	const fixture = await projectFixture();
	const sender = memoryStore(context, 'collision-sender');
	const recipient = memoryStore(context, 'collision-recipient');
	await seedBodies(sender, fixture);
	await recipient.writeMediaAsset('video-source', new Blob(['occupied video']), {
		name: 'occupied.mp4', mimeType: 'video/mp4',
	});
	await recipient.writeMediaAsset('still-source', new Blob(['occupied still']), {
		name: 'occupied.png', mimeType: 'image/png',
	});
	const exported = await RUNTIME.exportScapeProject(fixture.project, sender) as ArchiveExport;

	const imported = await RUNTIME.importScapeProject(exported.blob!, recipient) as ImportResult;
	const video = sources(imported.project).find(({ kind }) => kind === 'video')!;
	const still = sources(imported.project).find(({ kind }) => kind === 'still')!;
	const generator = sources(imported.project).find(({ kind }) => kind === 'generator')!;
	assert.notEqual(video.id, 'video-source');
	assert.notEqual(still.id, 'still-source');
	assert.equal(video.storageKey, video.id);
	assert.equal(still.storageKey, still.id);
	const generatorInputs = generatorInputsOf(generator);
	assert.equal(generatorInputs[0]?.sourceRef, still.id);
	const freezeFallbacks = imported.project.videoFreezeFallbacks as readonly Readonly<{
		renderedSourceId: string;
	}>[];
	assert.equal(freezeFallbacks[0]?.renderedSourceId, still.id);
	assert.ok(imported.project.videoSourceColorInterpretations.some(({ sourceId }) => sourceId === still.id));
	assert.ok(imported.project.videoSourceColorInterpretations.some(({ sourceId }) => sourceId === video.id));
	await assertBody(recipient, String(video.storageKey), ORIGINAL_BYTES);
	await assertBody(recipient, String(still.storageKey), STILL_BYTES);

	const analysis = imported.project.videoMotionAnalyses[0]!;
	const stack = imported.project.videoProcessorStacks[0]!;
	assert.equal(analysis.sourceId, video.id);
	assert.equal(stack.sourceId, video.id);
	assert.notEqual(analysis.storageKey, fixture.motion.reference.storageKey,
		'motion JSON must be canonically rebound instead of retaining a stale source identity');
	const motionBytes = new Uint8Array(await (await recipient.loadMediaAsset(analysis.storageKey))!.arrayBuffer());
	const motion = requireVideoMotionAnalysisBodyV1(analysis, motionBytes, {
		inputSha256: analysis.inputSha256, processorStack: stack,
	});
	assert.equal(motion.sourceId, video.id);
	assert.equal(motion.settingsSha256, analysis.settingsSha256);
	assert.equal((video.proxyAttachment as Record<string, unknown>).storageKey,
		`video-proxy-sha256:${PROXY_SHA}`);
	assert.equal(await bodyText(recipient, 'video-source'), 'occupied video');
	assert.equal(await bodyText(recipient, 'still-source'), 'occupied still');
});

test('corrupt extension bodies roll back every earlier staged body and the project document', async (context) => {
	const fixture = await projectFixture();
	const sender = memoryStore(context, 'corruption-sender');
	const recipient = memoryStore(context, 'corruption-recipient');
	await seedBodies(sender, fixture);
	const exported = await RUNTIME.exportScapeProject(fixture.project, sender) as ArchiveExport;
	const motion = exported.manifest.assets.find(({ kind }) => kind === 'framescaper-motion-analysis')!;
	const corrupt = await rewriteEntry(exported.blob!, motion.entry, Uint8Array.from(fixture.motion.bytes, (byte, index) => (
		index === 0 ? byte ^ 0xff : byte
	)));

	await assert.rejects(RUNTIME.importScapeProject(corrupt, recipient), /digest|SHA|stale|verification/iu);
	assert.equal(await recipient.loadProject(String(fixture.project.id)), null);
	for (const key of [
		'still-source', `video-proxy-sha256:${PROXY_SHA}`, fixture.timing.reference.storageKey,
		`lut-sha256:${fixture.lut.sha256}`, fixture.motion.reference.storageKey, 'video-source',
	]) assert.equal(await recipient.getMediaAssetMetadata(key), null, `rollback leaked ${key}`);
});

test('content-addressed collisions refuse before publication', async (context) => {
	const fixture = await projectFixture();
	const sender = memoryStore(context, 'conflict-sender');
	const recipient = memoryStore(context, 'conflict-recipient');
	await seedBodies(sender, fixture);
	await recipient.writeMediaAsset(`lut-sha256:${fixture.lut.sha256}`, new Blob(['wrong LUT'], {
		type: 'text/plain',
	}), { name: 'wrong.cube', mimeType: 'text/plain' });
	const exported = await RUNTIME.exportScapeProject(fixture.project, sender) as ArchiveExport;
	await assert.rejects(RUNTIME.importScapeProject(exported.blob!, recipient), /conflict|digest|immutable/iu);
	assert.equal(await recipient.loadProject(String(fixture.project.id)), null);
	assert.equal(await recipient.getMediaAssetMetadata('still-source'), null);
});

test('V27 asset roles remain project-bound when the archive descriptor is tampered', async (context) => {
	const fixture = await projectFixture();
	const sender = memoryStore(context, 'descriptor-sender');
	const recipient = memoryStore(context, 'descriptor-recipient');
	await seedBodies(sender, fixture);
	const exported = await RUNTIME.exportScapeProject(fixture.project, sender) as ArchiveExport;
	const tampered = await rewriteScapeManifest(exported.blob!, (manifest: ArchiveExport['manifest']) => {
		const lut = manifest.assets.find(({ kind }) => kind === 'framescaper-cube-lut');
		if (!lut) throw new Error('missing LUT fixture descriptor');
		(lut as { kind: string }).kind = 'framescaper-still';
	});

	await assert.rejects(RUNTIME.importScapeProject(tampered, recipient), /descriptor|conflict|inventory/iu);
	assert.equal(await recipient.loadProject(String(fixture.project.id)), null);
	assert.equal(await recipient.getMediaAssetMetadata('still-source'), null);
});

test('V25/V26 archives keep opaque read-only custody without importing V27 bodies', async (context) => {
	const fixture = await projectFixture();
	const sender = memoryStore(context, 'opaque-sender');
	await seedBodies(sender, fixture);
	const exported = await RUNTIME.exportScapeProject(fixture.project, sender) as ArchiveExport;
	for (const schemaVersion of [25, 26]) {
		const recipient = memoryStore(context, `opaque-v${String(schemaVersion)}`);
		const opaque = await rewriteScapeProjectDocument(exported.blob!, (project: Record<string, unknown>) => {
			project.schemaVersion = schemaVersion;
			project.nativeVideoSources = [{ retainedOpaque: true }];
		});
		const inspected = await RUNTIME.inspectScapeProject(
			opaque, null, { signal: new AbortController().signal }, { retain() {} },
		);
		assert.equal(inspected.schemaVersion, schemaVersion);
		assert.equal(inspected.readOnly, true);
		const imported = await RUNTIME.importScapeProject(opaque, recipient) as ImportResult;
		assert.equal(imported.readOnly, true);
		assert.equal((imported.project as unknown as Record<string, unknown>).schemaVersion, schemaVersion);
		assert.equal(await recipient.getMediaAssetMetadata('still-source'), null);
		assert.deepEqual(await recipient.listProjects(), []);
	}
});

async function projectFixture(): Promise<Fixture> {
	const lut = parseCubeLutV1(LUT_TEXT);
	const timing = createVideoTimingAssetPublication(PROXY_SHA, {
		timescale: 1_000,
		presentationTicks: Array.from({ length: 10 }, (_, index) => BigInt(index * 100)),
		finalFrameDurationTicks: 100n,
	});
	const stack = processorStack('video-source');
	const motion = await analyzeVideoMotionV1({
		analysisId: 'motion-analysis', inputSha256: ORIGINAL_SHA, processorStack: stack,
		frames: [
			{ frameNumber: 0, frame: grayFrame(0) },
			{ frameNumber: 1, frame: grayFrame(1) },
		],
	});
	const options = framescaperV20Options();
	const video = (options.sources as Record<string, unknown>[])[0]!;
	video.contentSha256 = ORIGINAL_SHA;
	options.sources = [video];
	const videoClip = (options.clips as Record<string, unknown>[])[0]!;
	const stillClip = {
		schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
	};
	const generatorClip = {
		schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 20, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	};
	options.clips = [videoClip, stillClip, generatorClip];
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = ['video-clip', 'still-clip', 'generator-clip'];
	options.tracks = [track];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = ['video-track'];
	const freeze = createVideoFreezeFallbackV1({
		renderedSourceId: 'still-source', renderedAssetSha256: STILL_SHA,
		authoredStateSha256: '11'.repeat(32), inputIdentitiesSha256: '22'.repeat(32),
		renderPlanFingerprintSha256: '33'.repeat(32), nativeEffectFingerprintSha256: '44'.repeat(32),
	});
	const lutReference = {
		storageKey: `lut-sha256:${lut.sha256}`, sha256: lut.sha256, byteLength: lut.byteLength,
		size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax,
	};
	const grade = {
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1,
		lut: lutReference,
	};
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [stillSource()], generatorSources: [generatorSource()], freezeFallbacks: [freeze],
		},
		finishing: {
			processorStacks: [stack], motionAnalyses: [motion.reference],
			visualPresentations: [{
				schemaVersion: 1, id: 'graded-video', owner: { kind: 'clip', id: 'video-clip' },
				enabled: true, opacity: 1, blendMode: 'normal', grade,
				processorStackId: stack.id, maskMatteIds: [],
			}],
			finishingPresets: [{
				schemaVersion: 1, kind: 'video-finishing-preset', id: 'look', name: 'Look',
				template: { enabled: true, opacity: 1, blendMode: 'normal', grade },
			}],
		},
	});
	const mutable = structuredClone(project) as unknown as Record<string, unknown>;
	const mutableVideo = (mutable.sources as Record<string, unknown>[])
		.find(({ id }) => id === 'video-source')!;
	mutableVideo.proxyAttachment = proxyAttachment(timing);
	mutable.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, mutable);
	return { project: cloneFramescaperProjectV27(PROFILE, mutable), timing, motion, lut };
}

async function seedBodies(store: Store, fixture: Fixture): Promise<void> {
	await store.writeMediaAsset('video-source', new Blob([ORIGINAL_BYTES], { type: 'video/mp4' }), {
		name: 'original.mp4', mimeType: 'video/mp4',
	});
	await store.writeMediaAsset('still-source', new Blob([STILL_BYTES], { type: 'image/png' }), {
		name: 'freeze.png', mimeType: 'image/png',
	});
	await store.writeMediaAsset(`video-proxy-sha256:${PROXY_SHA}`, new Blob([PROXY_BYTES], {
		type: 'video/mp4',
	}), { name: 'proxy.mp4', mimeType: 'video/mp4', kind: 'video-proxy', encoding: 'video-proxy-v1' });
	await store.writeMediaAsset(fixture.timing.reference.storageKey, new Blob([
		Uint8Array.from(fixture.timing.bytes),
	], { type: 'application/vnd.soundscaper.video-timing' }), {
		name: 'proxy.scti', mimeType: 'application/vnd.soundscaper.video-timing',
		kind: 'video-timing', encoding: fixture.timing.reference.encoding,
	});
	await store.writeMediaAsset(`lut-sha256:${fixture.lut.sha256}`, new Blob([LUT_TEXT], {
		type: 'text/plain',
	}), { name: 'look.cube', mimeType: 'text/plain' });
	await store.writeMediaAsset(fixture.motion.reference.storageKey, new Blob([
		Uint8Array.from(fixture.motion.bytes),
	], { type: 'application/vnd.framescaper.motion-analysis+json' }), {
		name: 'motion.json', mimeType: 'application/vnd.framescaper.motion-analysis+json',
	});
}

function proxyAttachment(timing: Fixture['timing']) {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA}`, mimeType: 'video/mp4',
		byteLength: PROXY_BYTES.byteLength, sha256: PROXY_SHA, originalSha256: ORIGINAL_SHA,
		originalAuthorityKind: 'owned', generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11, timingAsset: timing.reference,
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function stillSource() {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Freeze',
		mimeType: 'image/png', storageKey: 'still-source', contentSha256: STILL_SHA,
		width: 2, height: 2, hasAlpha: true,
	};
}

function generatorSource() {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'External composite',
		width: 2, height: 2, frameRate: { num: 10, den: 1 }, frameCount: 10,
		generator: {
			kind: 'external-generator', bindingId: 'builtin-composite',
			inputs: [{ name: 'plate', sourceRef: 'still-source' }],
		},
	};
}

function processorStack(sourceId: string) {
	return {
		schemaVersion: 1 as const, id: 'motion-stack', sourceId,
		processors: [{
			schemaVersion: 1 as const, id: 'tracker', kind: 'tracking' as const, enabled: true,
			maximumFeatures: 16, quality: 0.01, minimumDistance: 1,
			windowRadius: 2, pyramidLevels: 2,
		}],
	};
}

function grayFrame(offset: number) {
	const samples = Array.from({ length: 64 }, () => 0);
	for (let y = 2; y < 5; y += 1) for (let x = 1 + offset; x < 4 + offset; x += 1) {
		samples[y * 8 + x] = 1;
	}
	return createGrayVideoFrameV1({ width: 8, height: 8, samples });
}

async function assertBody(store: Store, storageKey: string, expected: Uint8Array): Promise<void> {
	const body = await store.loadMediaAsset(storageKey);
	assert.ok(body, `missing ${storageKey}`);
	assert.equal(await digestMediaContent(body), digestScapeBytes(expected));
}

async function bodyText(store: Store, storageKey: string): Promise<string> {
	const body = await store.loadMediaAsset(storageKey);
	assert.ok(body, `missing ${storageKey}`);
	return canonicalMediaContentBlob(body).text();
}

function sources(project: FramescaperProjectV27): Record<string, unknown>[] {
	return project.sources as unknown as Record<string, unknown>[];
}

function generatorInputsOf(generator: Record<string, unknown>): Record<string, unknown>[] {
	const document = record(generator.generator, 'generator document');
	if (!Array.isArray(document.inputs)) throw new TypeError('generator inputs are missing');
	return document.inputs as Record<string, unknown>[];
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is invalid`);
	return value as Record<string, unknown>;
}

function assetAuthority(value: ArchiveExport) {
	return value.manifest.assets.map(({ sourceId, kind, encoding, entry, mimeType, size, sha256 }) => ({
		sourceId, kind, encoding, entry, mimeType, size, sha256,
	}));
}

function memoryStore(context: TestContext, label: string): Store {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: `framescaper-v27-scape-${label}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

async function rewriteEntry(blob: Blob, filename: string, replacement: Uint8Array): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const contents = await Promise.all(entries.map(async (entry) => {
		if (!('getData' in entry) || typeof entry.getData !== 'function') {
			throw new Error(`unexpected directory entry: ${entry.filename}`);
		}
		return {
			filename: entry.filename,
			value: entry.filename === filename ? new Blob([Uint8Array.from(replacement).buffer])
				: entry.filename === 'project.json' || entry.filename === 'manifest.json'
					? await entry.getData(new TextWriter()) : await entry.getData(new BlobWriter()),
		};
	}));
	await reader.close();
	const output = new BlobWriter('application/vnd.soundscaper.scape+zip');
	const writer = new ZipWriter(output, { zip64: true, useWebWorkers: false, level: 0 });
	for (const content of contents) await writer.add(content.filename,
		typeof content.value === 'string' ? new TextReader(content.value) : content.value.stream(),
		{ zip64: true, level: 0 });
	return writer.close(undefined, { zip64: true });
}

interface ArchiveExport {
	readonly blob: Blob | null;
	readonly manifest: Readonly<{ readonly assets: readonly Readonly<{
		readonly sourceId: string; readonly kind: string; readonly encoding: string;
		readonly entry: string; readonly mimeType?: string; readonly size: number; readonly sha256: string;
	}>[] }>;
}

interface ImportResult {
	readonly project: FramescaperProjectV27;
	readonly readOnly: boolean;
	readonly collision: 'copy' | 'replace' | null;
}

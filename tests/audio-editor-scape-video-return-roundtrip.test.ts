/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import {
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { VIDEO_DERIVATIVE_RECIPES } from '../src/common/editor/storage/video-derivative-relationship.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const NOW = '2026-08-08T16:00:00.000Z';
const PROJECT_ID = 'scape-video-return-roundtrip';
const TARGET_CLIP_ID = 'canonical-target-video-clip';
const CANONICAL_SOURCE_ID = 'canonical-target-video-source';
const FALLBACK_SOURCE_ID = 'rendered-target-video-source';
const CANONICAL_BODY = new TextEncoder().encode('canonical target video body');
const FALLBACK_BODY = new TextEncoder().encode('rendered video-effects clip body');
const CLIP_VIDEO_EFFECTS = [{
	id: 'pixelate-a', type: 'pixelate', enabled: true, params: { blockSize: 12 },
}] as const;

type ProjectStore = ReturnType<typeof createProjectStore>;

interface ScapeImportResult {
	readonly project: AudioEditorProjectCurrent;
	readonly readOnly: boolean;
	readonly collision: 'copy' | 'replace' | null;
}

interface VideoDerivativeStore {
	saveVideoDerivative(sourceId: string, input: Readonly<{
		timestamp: number;
		type: string;
		recipe: Readonly<{ id: string; version: number }>;
		blob: Blob;
	}>): Promise<Record<string, unknown>>;
	loadVideoDerivative(sourceId: string, selector: Readonly<{
		timestamp: number;
		type: string;
		recipe: Readonly<{ id: string; version: number }>;
	}>): Promise<Blob | null>;
	listVideoDerivatives(sourceId: string): Promise<readonly unknown[]>;
}

test('a portable Scape roundtrip returns the clip-render fallback to a natively editable Framescaper', async (context) => {
	const sender = memoryStore(context, 'scape-video-return-sender');
	const recipient = memoryStore(context, 'scape-video-return-recipient');
	const home = memoryStore(context, 'scape-video-return-home');
	const project = fallbackProject({
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: FALLBACK_SOURCE_ID,
		sha256: digestScapeBytes(FALLBACK_BODY),
		targetClipId: TARGET_CLIP_ID,
	});
	await persistProjectMedia(sender);

	const outbound = await exportScapeProject(project, sender);
	const outboundDigests = assetDigests(outbound);
	assert.deepEqual(outboundDigests, [
		digestScapeBytes(CANONICAL_BODY), digestScapeBytes(FALLBACK_BODY),
	].sort());

	const delivered = await importScapeProject(outbound.blob, recipient) as ScapeImportResult;
	assert.equal(delivered.readOnly, false);
	const deliveredReport = evaluateProjectFeatureRequirements(
		delivered.project.featureRequirements,
		{ ...productAvailability('soundscaper'), ...projectStructures(delivered.project) },
	);
	assert.equal(deliveredReport.compatible, false, 'Soundscaper must treat video effects as unavailable');
	assert.equal(deliveredReport.items[0]?.availability, 'unavailable');
	assert.equal(deliveredReport.items[0]?.disposition, 'rendered-fallback');
	assert.equal(deliveredReport.items[0]?.fallback?.role, 'video-clip-render-v1');

	const reopenedValue = await recipient.loadProject(PROJECT_ID);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectCurrent;
	assert.deepEqual(reopened.featureRequirements, project.featureRequirements);
	assert.deepEqual(reopened.clips[0]?.videoEffects, [...CLIP_VIDEO_EFFECTS]);

	const recipientDerivatives = recipient as unknown as VideoDerivativeStore;
	assert.deepEqual(await recipientDerivatives.listVideoDerivatives(CANONICAL_SOURCE_ID), [],
		'no disposable preview may arrive with the transfer');
	const regenerated = await recipientDerivatives.saveVideoDerivative(CANONICAL_SOURCE_ID, {
		timestamp: 0,
		type: 'poster',
		recipe: VIDEO_DERIVATIVE_RECIPES.poster,
		blob: new Blob(['recipient regenerated poster'], { type: 'image/webp' }),
	});
	assert.equal(regenerated.originalSha256, digestScapeBytes(CANONICAL_BODY),
		'a regenerated preview must bind the exact admitted original that survived the transfer');
	assert.equal(
		await (await recipientDerivatives.loadVideoDerivative(CANONICAL_SOURCE_ID, {
			timestamp: 0, type: 'poster', recipe: VIDEO_DERIVATIVE_RECIPES.poster,
		}))?.text(),
		'recipient regenerated poster',
	);

	const returning = await exportScapeProject(reopened, recipient);
	assert.deepEqual(assetDigests(returning), outboundDigests,
		'the read-only recipient must return the exact portable bodies it received');

	const returned = await importScapeProject(returning.blob, home) as ScapeImportResult;
	assert.equal(returned.readOnly, false);
	const returnedReport = evaluateProjectFeatureRequirements(
		returned.project.featureRequirements,
		{ ...productAvailability('framescaper'), ...projectStructures(returned.project) },
	);
	assert.equal(returnedReport.compatible, true, 'the returning Framescaper must reopen natively editable');
	assert.equal(returnedReport.items[0]?.availability, 'available');
	assert.equal(returnedReport.items[0]?.disposition, 'native');
	assert.equal(returnedReport.items[0]?.fallback?.role, 'video-clip-render-v1',
		'the retained fallback must survive the return to the capable product');

	assert.deepEqual(returned.project.featureRequirements, project.featureRequirements);
	assert.deepEqual(returned.project.clips[0]?.videoEffects, [...CLIP_VIDEO_EFFECTS],
		'the native clip video-effects payload must survive both legs untouched');
	assert.deepEqual(await storedMediaBytes(home, CANONICAL_SOURCE_ID), CANONICAL_BODY);
	assert.deepEqual(await storedMediaBytes(home, FALLBACK_SOURCE_ID), FALLBACK_BODY);

	const homeValue = await home.loadProject(PROJECT_ID);
	assert.ok(homeValue);
	const reopenedHome = homeValue as unknown as AudioEditorProjectCurrent;
	assert.deepEqual(reopenedHome.featureRequirements, project.featureRequirements);
	assert.deepEqual(reopenedHome.clips[0]?.videoEffects, [...CLIP_VIDEO_EFFECTS]);
	assert.deepEqual(
		await (home as unknown as VideoDerivativeStore).listVideoDerivatives(CANONICAL_SOURCE_ID),
		[],
		'the regenerated recipient preview must stay out of the returning transfer',
	);
});

test('a whole-project video render fallback survives the same Scape return roundtrip', async (context) => {
	const sender = memoryStore(context, 'scape-whole-video-return-sender');
	const recipient = memoryStore(context, 'scape-whole-video-return-recipient');
	const home = memoryStore(context, 'scape-whole-video-return-home');
	const project = fallbackProject({
		role: 'project-video-render-v1',
		kind: 'video',
		sourceId: FALLBACK_SOURCE_ID,
		sha256: digestScapeBytes(FALLBACK_BODY),
	});
	await persistProjectMedia(sender);

	const outbound = await exportScapeProject(project, sender);
	const delivered = await importScapeProject(outbound.blob, recipient) as ScapeImportResult;
	const deliveredReport = evaluateProjectFeatureRequirements(
		delivered.project.featureRequirements,
		{ ...productAvailability('soundscaper'), ...projectStructures(delivered.project) },
	);
	assert.equal(deliveredReport.compatible, false);
	assert.equal(deliveredReport.items[0]?.disposition, 'rendered-fallback');
	assert.equal(deliveredReport.items[0]?.fallback?.role, 'project-video-render-v1');

	const reopenedValue = await recipient.loadProject(PROJECT_ID);
	assert.ok(reopenedValue);
	const returning = await exportScapeProject(reopenedValue as unknown as AudioEditorProjectCurrent, recipient);
	assert.deepEqual(assetDigests(returning), assetDigests(outbound),
		'the read-only recipient must return the exact portable bodies it received');

	const returned = await importScapeProject(returning.blob, home) as ScapeImportResult;
	const returnedReport = evaluateProjectFeatureRequirements(
		returned.project.featureRequirements,
		{ ...productAvailability('framescaper'), ...projectStructures(returned.project) },
	);
	assert.equal(returnedReport.compatible, true, 'the returning Framescaper must reopen natively editable');
	assert.equal(returnedReport.items[0]?.disposition, 'native');
	assert.equal(returnedReport.items[0]?.fallback?.role, 'project-video-render-v1');
	assert.deepEqual(returned.project.featureRequirements, project.featureRequirements);
	assert.deepEqual(await storedMediaBytes(home, CANONICAL_SOURCE_ID), CANONICAL_BODY);
	assert.deepEqual(await storedMediaBytes(home, FALLBACK_SOURCE_ID), FALLBACK_BODY);
});

function fallbackProject(
	fallback: AudioEditorProjectCurrent['featureRequirements']['requirements'][number]['fallback'],
): AudioEditorProjectCurrent {
	const canonicalSource = createVideoSourceV9({
		id: CANONICAL_SOURCE_ID,
		storageKey: CANONICAL_SOURCE_ID,
		name: 'Canonical target.mp4',
		mimeType: 'video/mp4',
		frameCount: 80,
		sampleRate: 48_000,
		width: 1_280,
		height: 720,
		frameRate: 24,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	});
	const fallbackSource = createVideoSourceV9({
		id: FALLBACK_SOURCE_ID,
		storageKey: FALLBACK_SOURCE_ID,
		name: 'Rendered target.mp4',
		mimeType: 'video/mp4',
		frameCount: 1_600,
		sampleRate: 48_000,
		width: 1_280,
		height: 720,
		frameRate: 24,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	});
	const target = createVideoClipV9({
		id: TARGET_CLIP_ID,
		sourceId: CANONICAL_SOURCE_ID,
		title: 'Canonical target clip',
		timelineStartFrame: 120,
		sourceStartFrame: 8,
		sourceDurationFrames: 40,
		durationFrames: 20,
		speedRatio: 2,
		videoEffects: [...CLIP_VIDEO_EFFECTS],
	});
	return createCurrentAudioEditorProject({
		id: PROJECT_ID,
		title: 'Portable video return roundtrip',
		now: NOW,
		sampleRate: 48_000,
		sources: [canonicalSource, fallbackSource],
		clips: [target],
		tracks: [createVideoTrackV9({
			id: 'canonical-video-track',
			name: 'Canonical video',
			clipIds: [TARGET_CLIP_ID],
		})],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-video-effects-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher video-effects render',
				disposition: 'rendered-fallback',
				fallback,
			}],
		},
	});
}

function productAvailability(productId: 'soundscaper' | 'framescaper'): Readonly<{
	knownFeatureIds: ReadonlySet<string>;
	availableFeatureIds: ReadonlySet<string>;
}> {
	const capabilities = PRODUCT_PROFILES[productId].capabilities as Readonly<Record<string, unknown>>;
	const entries = Object.entries(PROJECT_FEATURE_CAPABILITY_IDS);
	return {
		knownFeatureIds: new Set(entries.map(([, featureId]) => featureId)),
		availableFeatureIds: new Set(entries
			.filter(([key]) => capabilities[key] === true)
			.map(([, featureId]) => featureId)),
	};
}

function projectStructures(project: AudioEditorProjectCurrent): Readonly<{
	sources: AudioEditorProjectCurrent['sources'];
	clips: AudioEditorProjectCurrent['clips'];
	tracks: AudioEditorProjectCurrent['tracks'];
	schemaVersion: number;
	sampleRate: number;
	sequences: AudioEditorProjectCurrent['sequences'];
	primarySequenceId: string;
}> {
	return {
		sources: project.sources,
		clips: project.clips,
		tracks: project.tracks,
		schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate,
		sequences: project.sequences,
		primarySequenceId: project.primarySequenceId,
	};
}

function assetDigests(exported: Readonly<{
	manifest: Readonly<{ assets: ReadonlyArray<Readonly<{ sha256: string }>> }>;
}>): string[] {
	return exported.manifest.assets.map(({ sha256 }) => sha256).sort();
}

async function persistProjectMedia(store: ProjectStore): Promise<void> {
	await store.writeMediaAsset(CANONICAL_SOURCE_ID, new Blob([CANONICAL_BODY]), {
		name: 'Canonical target.mp4',
		mimeType: 'video/mp4',
	});
	await store.writeMediaAsset(FALLBACK_SOURCE_ID, new Blob([FALLBACK_BODY]), {
		name: 'Rendered target.mp4',
		mimeType: 'video/mp4',
	});
}

async function storedMediaBytes(store: ProjectStore, storageKey: string): Promise<Uint8Array> {
	const body = await store.loadMediaAsset(storageKey);
	if (!body) throw new ReferenceError(`Missing stored media asset ${storageKey}.`);
	return new Uint8Array(await body.arrayBuffer());
}

function memoryStore(context: TestContext, label: string): ProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

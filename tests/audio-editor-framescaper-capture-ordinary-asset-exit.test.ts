/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { prepareLinkedSplitCommand } from '../src/common/editor/commands/clip-link-runtime.js';
import {
	createFramescaperCaptureCanonicalPublicationService,
	type FramescaperCaptureCanonicalStore,
} from '../src/common/editor/controller/framescaper-capture-canonical-publication.ts';
import {
	createFramescaperCaptureExactPresentationRange,
} from '../src/common/editor/controller/framescaper-capture-exact-presentation-range.ts';
import {
	createFramescaperCaptureDurableSessionCoordinator,
	type FramescaperCaptureDurableSession,
} from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import type { AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type {
	LinkedVideoOriginalPort,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createFramescaperPlaybackProjectService } from '../src/framescaper/editor-project-playback.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import {
	applyFramescaperProjectCommand,
	type FramescaperProjectCommand,
} from '../src/framescaper/editor-project-commands.ts';
import type { FramescaperProjectComposition } from '../src/framescaper/editor-project-composition.ts';
import { createFramescaperProject, validateFramescaperProject, type FramescaperProject } from
	'../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createFramescaperVideoExportStrategy } from '../src/framescaper/video-export-strategy.ts';

const PROFILE = FRAMESCAPER_PROJECT_RUNTIME_PROFILE;
const PROJECT_ID = 'capture-ordinary-exit-project';
const SESSION_ID = 'capture-ordinary-exit-session';
const CAMERA_SOURCE_ID = 'capture-camera-source';
const MICROPHONE_SOURCE_ID = 'capture-microphone-source';
const ORIGINAL_LOCATOR_ID = 'locator_capture_original_0001';
const ORIGINAL_LOCATOR_REVISION = 'revision_capture_original_01';
const RELINKED_LOCATOR_ID = 'locator_capture_relinked_0001';
const RELINKED_LOCATOR_REVISION = 'revision_capture_relinked_01';
const VIDEO_BYTES = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4);
const VIDEO_TIMING = Object.freeze({
	timescale: 1_000,
	presentationTicks: Object.freeze([0n, 500n]),
	finalFrameDurationTicks: 500n,
});
type CaptureProject = FramescaperProject & FramescaperProjectComposition;

test('capture-published assets traverse ordinary relink, edit, Scape, and delivery paths', async (context) => {
	const fixture = await publishCapture(context);
	const published = fixture.project;
	assert.equal(validateFramescaperProject(PROFILE, published), true);
	assert.equal(published.schemaVersion, 1, 'capture provenance must not change the baseline project schema');
	assert.deepEqual(captureProvenance(source(published, CAMERA_SOURCE_ID)), {
		role: 'camera', streamId: 'camera-stream', recoveryProvenance: 'live',
	});
	assert.deepEqual(captureProvenance(source(published, MICROPHONE_SOURCE_ID)), {
		role: 'microphone', streamId: 'microphone-stream', recoveryProvenance: 'live',
	});

	const retainedVideo = await requiredMedia(fixture.store, CAMERA_SOURCE_ID);
	fixture.locators.set(ORIGINAL_LOCATOR_ID, snapshot(retainedVideo, ORIGINAL_LOCATOR_REVISION));
	fixture.locators.set(RELINKED_LOCATOR_ID, snapshot(retainedVideo, RELINKED_LOCATOR_REVISION));
	const originalBinding = await fixture.store.bindLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(published),
		ORIGINAL_LOCATOR_ID,
		{
			expectedLocatorRevision: ORIGINAL_LOCATOR_REVISION,
			expectedSnapshot: retainedVideo,
		},
	);
	const rebound = await fixture.store.relinkLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(published),
		RELINKED_LOCATOR_ID,
		{
			expectedBindingToken: originalBinding.bindingToken,
			expectedLocatorRevision: RELINKED_LOCATOR_REVISION,
			expectedSnapshot: retainedVideo,
		},
	);
	assert.equal(rebound.locatorId, RELINKED_LOCATOR_ID);
	assert.equal(rebound.sha256, videoSource(published).contentSha256);

	const cameraEntry = fixture.publication.plan.entries.find(({ role }) => role === 'camera');
	assert.ok(cameraEntry?.timelineClipId);
	const splitIds = ['camera-right', 'microphone-right', 'capture-right-av-link'];
	const splitCommand = prepareLinkedSplitCommand(
		published,
		cameraEntry.timelineClipId,
		24_000,
		() => requiredShift(splitIds),
	);
	const edited = applyFramescaperProjectCommand(
		PROFILE,
		published,
		splitCommand as unknown as FramescaperProjectCommand,
		{ now: '2026-08-20T12:02:00.000Z' },
	) as CaptureProject;
	assert.equal(validateFramescaperProject(PROFILE, edited), true);
	assert.equal(edited.clips.length, 4, 'the ordinary linked split creates two aligned A/V pairs');
	assert.deepEqual(edited.sources, published.sources, 'an occurrence edit does not rewrite capture assets');
	assert.equal(edited.clips.find(({ id }) => id === 'camera-right')?.avLinkId, 'capture-right-av-link');
	assert.equal(edited.clips.find(({ id }) => id === 'microphone-right')?.avLinkId, 'capture-right-av-link');

	const runtime = createFramescaperScapeNativeRuntime(PROFILE);
	const exported = await runtime.exportScapeProject(edited, fixture.store);
	assert.ok(exported.blob);
	const inspection = await runtime.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain: () => undefined },
	);
	assert.equal(inspection.schemaVersion, 1);
	assert.equal(inspection.readOnly, false);

	// The product store has one authenticated storage profile. Retire the sender
	// before opening the recipient so this is a genuine empty-store import.
	await fixture.store.clear();
	await fixture.store.close();
	const recipient = createFramescaperProjectStore(PROFILE, {
		indexedDB: null,
		preferOpfs: false,
	});
	context.after(async () => { await recipient.close(); });
	const imported = await runtime.importScapeProject(exported.blob, recipient, { collision: 'copy' });
	assert.equal(imported.readOnly, false);
	assert.equal(validateFramescaperProject(PROFILE, imported.project), true);
	const reopenedValue = await recipient.loadProject(edited.id);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as CaptureProject;
	assert.equal(validateFramescaperProject(PROFILE, reopened), true);
	assert.deepEqual(reopened.clips, edited.clips);
	assert.deepEqual(
		captureProvenance(source(reopened, CAMERA_SOURCE_ID)),
		captureProvenance(source(edited, CAMERA_SOURCE_ID)),
	);
	assert.deepEqual(
		new Uint8Array(await (await requiredMedia(recipient, CAMERA_SOURCE_ID)).arrayBuffer()),
		VIDEO_BYTES,
	);
	assert.ok(await recipient.getSourceMetadata(MICROPHONE_SOURCE_ID));
	const timingStorageKey = timingAssetStorageKey(videoSource(reopened));
	assert.ok(await recipient.getMediaAssetMetadata(timingStorageKey));

	const playback = createFramescaperPlaybackProjectService(PROFILE, { timingStore: recipient });
	const delivery = playback.projectForVideoRenderedFallbackDelivery?.(reopened);
	assert.ok(delivery);
	assert.deepEqual(delivery.requiredAudioSourceIds, []);
	assert.deepEqual(delivery.requiredVideoSourceIds, []);
	const deliveryProject = delivery.project as unknown as AudioEditorProjectCurrent;
	assert.equal(deliveryProject.schemaVersion, 1);
	assert.deepEqual(
		captureProvenance(source(deliveryProject, CAMERA_SOURCE_ID)),
		captureProvenance(source(reopened, CAMERA_SOURCE_ID)),
		'the ordinary runtime projection preserves bounded source provenance',
	);

	const strategy = createFramescaperVideoExportStrategy(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject: reopened, delivery });
	const baselinePlan = strategy.createPlan({
		canonicalProject: reopened,
		exportProject,
		format: 'webm',
		range: 'project',
		includeAudio: true,
		canvas: undefined,
	});
	assert.ok(baselinePlan, 'capture uses the maintained keyed baseline delivery planner');
	assert.equal(baselinePlan.strategy, 'framescaper-keyframed-rgba-v1');
	assert.deepEqual(baselinePlan.activeSourceIds, [CAMERA_SOURCE_ID]);
	const deliveryPlan = createVideoExportPlan(exportProject, {
		format: 'webm',
		range: 'project',
		includeAudio: true,
	});
	const deliveryInputs = deliveryPlan.inputs as readonly Readonly<{
		kind: string;
		sourceId?: string;
	}>[];
	assert.deepEqual(
		deliveryInputs.filter(({ kind }) => kind === 'video-source').map(({ sourceId }) => sourceId),
		[CAMERA_SOURCE_ID],
	);
	assert.equal(deliveryInputs.at(-1)?.kind, 'staged-audio-mix');
});

interface CaptureExitFixture {
	readonly locators: Map<string, Readonly<{ blob: Blob; locatorRevision: string }>>;
	readonly project: CaptureProject;
	readonly publication: Awaited<ReturnType<ReturnType<
		typeof createFramescaperCaptureCanonicalPublicationService
	>['publish']>>;
	readonly store: AudioEditorProjectStore;
}

async function publishCapture(context: TestContext): Promise<CaptureExitFixture> {
	const locators = new Map<string, Readonly<{ blob: Blob; locatorRevision: string }>>();
	const linkedVideoOriginalPort: LinkedVideoOriginalPort = {
		load(locatorId, { expectedRevision }) {
			const candidate = locators.get(locatorId) ?? null;
			return expectedRevision !== null && candidate?.locatorRevision !== expectedRevision
				? null
				: candidate;
		},
		release: () => true,
	};
	const store = createFramescaperProjectStore(PROFILE, {
		indexedDB: null,
		preferOpfs: false,
		linkedVideoOriginalPort,
	});
	context.after(async () => { await store.close(); });
	const encodedSpools = store.encodedCaptureSpoolRepository;
	const rawPcmSpools = store.rawPcmSpoolRepository;
	const manifests = store.framescaperCaptureManifestRepository;
	assert.ok(encodedSpools);
	assert.ok(rawPcmSpools);
	assert.ok(manifests);
	let project = createFramescaperProject(PROFILE, {
		id: PROJECT_ID,
		title: 'Capture ordinary exit',
		now: '2026-08-20T12:00:00.000Z',
		sampleRate: 48_000,
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		primarySequenceId: 'main-sequence',
	}) as CaptureProject;
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools,
		rawPcmSpools,
		manifests,
		now: () => 100,
	});
	const session = await coordinator.create({
		sessionId: SESSION_ID,
		generation: 1,
		projectFence: {
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: PROJECT_ID, baseRevision: project.revision, baseSha256: 'ab'.repeat(32),
		},
		origin: { sequenceId: 'main-sequence', playheadMicroseconds: 0, destination: 'both' },
		monotonicOriginMicroseconds: 0,
		streams: [{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'camera-stream', spoolId: 'camera-spool', sourceId: CAMERA_SOURCE_ID,
			mimeType: 'video/webm',
		}, {
			kind: 'raw-pcm', role: 'microphone', required: true,
			streamId: 'microphone-stream', spoolId: 'microphone-spool', sourceId: MICROPHONE_SOURCE_ID,
			sampleRate: 8_000, channelCount: 2, chunkFrames: 8_000,
		}],
	});
	await populateSession(session);
	await session.seal();
	const service = createFramescaperCaptureCanonicalPublicationService({
		store: captureStore(store),
		manifests,
		encodedSpools,
		rawPcmSpools,
		probeVideo: () => ({
			backend: 'ordinary-exit-test-probe', nominalRate: { num: 2, den: 1 },
			timing: VIDEO_TIMING, width: 640, height: 480,
		}),
		assertProjectFence: () => undefined,
		commitAtomic(command) {
			project = applyFramescaperProjectCommand(
				PROFILE, project, command, { now: '2026-08-20T12:01:00.000Z' },
			) as CaptureProject;
			return { status: 'committed', value: project.revision };
		},
		recordRetryableRecovery: () => undefined,
		now: () => 101,
	});
	let id = 0;
	const publication = await service.publish({
		manifest: session.manifest,
		recoveryProvenance: 'live',
		destination: 'both',
		recordStartFrame: 0,
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
		trackInsertionIndex: 0,
		streams: session.manifest.streams.map(({ streamId, role, timing }) => ({
			streamId, role,
			exactPresentationRange: createFramescaperCaptureExactPresentationRange(
				timing.firstPresentationMicroseconds!, timing.lastPresentationEndMicroseconds!,
			),
			startOffsetFrames: 0,
			presentationEndOffsetFrames: 48_000,
			metrics: {
				confidence: 'exact', droppedUnits: 0,
				maximumAbsoluteDriftMicroseconds: 0, finalDriftMicroseconds: 0,
			},
			terminationReason: null,
		})),
		createId: (prefix) => `${prefix}-${String(++id)}`,
	});
	return Object.freeze({ locators, project, publication, store });
}

async function populateSession(session: FramescaperCaptureDurableSession): Promise<void> {
	for (const [sequence, bytes] of [VIDEO_BYTES.slice(0, 4), VIDEO_BYTES.slice(4)].entries()) {
		await session.append({
			kind: 'encoded-video', sessionId: SESSION_ID, streamId: 'camera-stream', role: 'camera',
			sequence, presentationTimeUs: sequence * 500_000, durationUs: 500_000,
			receiptTimeMs: sequence, droppedBefore: { value: 0, confidence: 'exact' },
			byteLength: bytes.byteLength, bytes, mimeType: 'video/webm', keyFrame: sequence === 0,
		});
	}
	const samples = new Float32Array(16_000);
	samples[0] = 0.25;
	samples[1] = -0.25;
	await session.append({
		kind: 'pcm-audio', sessionId: SESSION_ID, streamId: 'microphone-stream', role: 'microphone',
		sequence: 0, presentationTimeUs: 0, durationUs: 1_000_000, receiptTimeMs: 0,
		droppedBefore: { value: 0, confidence: 'exact' }, frameCount: 8_000,
		sampleRate: 8_000, channelCount: 2, samples,
	});
}

function captureStore(store: AudioEditorProjectStore): FramescaperCaptureCanonicalStore {
	return {
		getSourceMetadata: store.getSourceMetadata.bind(store),
		beginSourceWrite: store.beginSourceWrite.bind(store),
		discardSourceIfCurrent: store.discardSourceIfCurrent.bind(store),
		getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store),
		beginMediaAssetWrite: store.beginMediaAssetWrite.bind(store),
		async loadMediaAsset(sourceId, options) {
			const loaded = await store.loadMediaAsset(sourceId, options);
			return loaded === null ? null : loaded instanceof Blob
				? loaded
				: new Blob([await loaded.arrayBuffer()], { type: loaded.type });
		},
	};
}

function source(
	project: Readonly<{ readonly sources: readonly Readonly<Record<string, unknown>>[] }>,
	id: string,
): Readonly<Record<string, unknown>> {
	const value = project.sources.find((candidate) => candidate.id === id);
	if (!value) throw new Error(`Missing source ${id}`);
	return value;
}

function videoSource(project: CaptureProject) {
	const value = source(project, CAMERA_SOURCE_ID);
	if (value.kind !== 'video') throw new TypeError('Expected the captured camera video source.');
	return value as typeof value & Readonly<{
		kind: 'video'; contentSha256: string; timingAsset: Readonly<Record<string, unknown>>;
	}>;
}

function captureProvenance(value: Readonly<Record<string, unknown>>): Readonly<{
	role: unknown;
	streamId: unknown;
	recoveryProvenance: unknown;
}> {
	const extensions = value.opaqueExtensions as Readonly<Record<string, unknown>>;
	const capture = extensions.framescaperCaptureV1 as Readonly<Record<string, unknown>>;
	return Object.freeze({
		role: capture.role,
		streamId: capture.streamId,
		recoveryProvenance: capture.recoveryProvenance,
	});
}

function timingAssetStorageKey(value: Readonly<Record<string, unknown>>): string {
	const timingAsset = value.timingAsset as Readonly<Record<string, unknown>>;
	if (typeof timingAsset.storageKey !== 'string') throw new TypeError('Missing video timing storage key.');
	return timingAsset.storageKey;
}

async function requiredMedia(store: AudioEditorProjectStore, storageKey: string): Promise<Blob> {
	const body = await store.loadMediaAsset(storageKey);
	if (!body) throw new Error(`Missing media ${storageKey}`);
	return body instanceof Blob ? body : new Blob([await body.arrayBuffer()], { type: body.type });
}

function snapshot(blob: Blob, locatorRevision: string) {
	return Object.freeze({ blob, locatorRevision });
}

function requiredShift(values: string[]): string {
	const value = values.shift();
	if (!value) throw new Error('Missing deterministic split identity.');
	return value;
}

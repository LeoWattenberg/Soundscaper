/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
	createAssistanceAssetReferenceV1,
} from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import {
	snapshotAssistanceAssetUpsertCommandV1,
} from '../src/common/editor/assistance/assistance-asset-command-v1.ts';
import {
	createAddLabelCommand,
	createAddLabelTrackCommand,
	createAddTrackCommand,
} from '../src/common/editor/commands/factories.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from '../src/common/editor/project-owned-feature-requirements.ts';
import { verifyProjectFallbackIntegrity } from '../src/common/editor/project-fallback-integrity.ts';
import {
	FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION,
	isFramescaperCaptureProjectSchema,
	isFramescaperSequenceProjectSchema,
	isFramescaperVideoCompositionProjectSchema,
	isFramescaperVideoKeyframeProjectSchema,
	isFramescaperVideoRetimeProjectSchema,
	isMaintainedProjectFeatureSchema,
	isMaintainedRenderedFallbackProjectSchema,
	isProductionMixerProjectSchema,
	isTimelineAnnotationProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import {
	FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v28.ts';
import {
	FRAMESCAPER_V31_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v31.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v31.ts';
import { createEditorProjectRuntimeV31Selection } from '../src/framescaper/editor-project-runtime-v31-selection.ts';
import { FRAMESCAPER_PROFILE } from '../src/framescaper/product.js';
import { FRAMESCAPER_V31_PRODUCT_ROUTE } from '../src/framescaper/product-route-v31.ts';
import { createFramescaperScapeNativeRuntimeV31 } from '../src/framescaper/editor-scape-native-v31.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { createSoundscaperProjectV30 } from '../src/soundscaper/editor-project-v30.ts';
import {
	FramescaperProjectV31ReimportRequiredError,
	cloneFramescaperProjectV31,
	createFramescaperProjectV31,
	loadFramescaperProjectV31,
	reimportFramescaperProjectV31,
	validateFramescaperProjectV31,
} from '../src/framescaper/editor-project-v31.ts';

const NOW = '2026-08-25T00:00:00.000Z';
const SOURCE_SHA256 = 'ab'.repeat(32);
const BODY_SHA256 = 'ef'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);
const TIMING_REFERENCE = createVideoTimingAssetPublication(SOURCE_SHA256, {
	timescale: 1,
	presentationTicks: [0n, 1n],
	finalFrameDurationTicks: 1n,
}).reference;
const TIMING_SHA256 = TIMING_REFERENCE.sha256;

function source() {
	return createVideoSource({
		id: 'dialogue-video', name: 'Dialogue', mimeType: 'video/mp4',
		storageKey: 'owned:dialogue-video', contentSha256: SOURCE_SHA256,
		sampleFrameCount: 96_000, sampleRate: 48_000, sourceFrameCount: 2,
		frameRate: { num: 1, den: 1 }, width: 640, height: 360,
		videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
		timingAsset: TIMING_REFERENCE,
		timingDecision: { mode: 'exact', rate: { num: 1, den: 1 } },
	});
}

function transcript(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'transcript-01', kind: 'transcript-v1', sourceId: 'dialogue-video',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 96_000,
		sourceVideoTimingSha256: TIMING_SHA256, recipeId: 'speech-transcript', recipeVersion: 1,
		modelArtifactSha256s: [MODEL_SHA256],
		body: {
			storageKey: `assistance-transcript-sha256:${BODY_SHA256}`,
			mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
			byteLength: 8_192, sha256: BODY_SHA256,
		},
		...overrides,
	};
}

function project(assistanceAssets: readonly unknown[] = [transcript()]) {
	return createFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v31', title: 'Transcript custody', now: NOW,
		sources: [source()], assistanceAssets,
	} as never);
}

test('F31 inherits every selected F28 shared schema authority and activates capture', () => {
	assert.equal(FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION, 31);
	for (const predicate of [
		isProductionMixerProjectSchema, isFramescaperSequenceProjectSchema,
		isFramescaperVideoCompositionProjectSchema, isFramescaperVideoKeyframeProjectSchema,
		isFramescaperVideoRetimeProjectSchema, isTimelineAnnotationProjectSchema,
		isMaintainedProjectFeatureSchema, isMaintainedRenderedFallbackProjectSchema,
	]) assert.equal(predicate(31), true, predicate.name);
	assert.equal(isFramescaperCaptureProjectSchema(31), true);
	const registration = (profile: unknown) => editorProjectFeatureCapabilityProfileDefinition(profile)
		.registrations.find(({ key }) => key === 'assistanceAssets');
	assert.notEqual(registration(FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE)?.available, true);
	assert.equal(registration(FRAMESCAPER_V31_PROJECT_FEATURE_CAPABILITY_PROFILE)?.available, true);
});

test('F31 owns canonical source-bound transcript references and clones exact authority', () => {
	const held = project();
	assert.equal(validateFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, held), true);
	assert.deepEqual(held.assistanceAssets[0], createAssistanceAssetReferenceV1(transcript()));
	assert.equal(held.featureRequirements.requirements.some(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.assistanceAssets
	)), true);
	const cloned = cloneFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, held);
	assert.deepEqual(cloned, held);
	assert.notEqual(cloned, held);
	assert.notEqual(cloned.assistanceAssets, held.assistanceAssets);
	assert.throws(() => createFramescaperProjectV31(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE),
		/authenticated.*F31 runtime profile/iu);
});

test('F28 enters F31 only through explicit reimport and no assistance result is invented', () => {
	const predecessor = createFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v28', title: 'Predecessor', now: NOW,
	} as never);
	assert.throws(() => loadFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, predecessor),
		(error) => error instanceof FramescaperProjectV31ReimportRequiredError
			&& error.schemaVersion === 28);
	const upgraded = reimportFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, predecessor);
	assert.equal(upgraded.schemaVersion, 31);
	assert.deepEqual(upgraded.assistanceAssets, []);
	assert.equal(loadFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, project()).readOnly, false);
	assert.throws(() => reimportFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, { ...predecessor, schemaVersion: 27 },
	), FramescaperProjectV31ReimportRequiredError);
});

test('F31 retains historical, unowned, and future documents opaquely while other old versions require reimport', () => {
	const held = project();
	for (const schemaVersion of [22, 23, 24, 25, 26, 29, 30]) {
		const loaded = loadFramescaperProjectV31(
			FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, { ...held, schemaVersion },
		);
		assert.equal(loaded.readOnly, true);
		assert.equal(loaded.reason, 'known-dormant-custody');
	}
	const future = loadFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		{ ...held, schemaVersion: 32, futureCustody: { retained: true } },
	);
	assert.equal(future.readOnly, true);
	assert.equal(future.reason, 'newer-schema');
	assert.deepEqual((future.project as Record<string, unknown>).futureCustody, { retained: true });
	assert.throws(() => loadFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, { ...held, schemaVersion: 27 },
	), FramescaperProjectV31ReimportRequiredError);
});

test('F31 opens an S30 document through inert read-only custody without claiming native authority', async () => {
	const runtime = createEditorProjectRuntimeV31Selection(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE);
	const held = createSoundscaperProjectV30({
		id: 'soundscaper-v30', title: 'Foreign S30 custody', now: NOW,
	});
	const history = runtime.createHistory(held);
	assert.equal(history.present.schemaVersion, 30);
	assert.deepEqual(history.present.sources, []);
	assert.deepEqual(history.present.clips, []);
	assert.deepEqual(history.present.tracks, []);
	const fallbackAdmission = await verifyProjectFallbackIntegrity(history.present, {});
	assert.doesNotThrow(() => fallbackAdmission.assertCurrent(history.present));

	const session = runtime.createSessionController();
	session.openProject(history.present, { history, readOnly: true });
	const [tab] = session.getSnapshot().tabs;
	assert.equal(tab.readOnly, true);
	assert.equal(tab.history.present.schemaVersion, 30);
	assert.deepEqual(tab.history.present.sources, []);
});

test('F31 validation is closed and authenticates transcript source and timing bindings', () => {
	assert.throws(() => project([{ ...transcript(), extra: true }]), /unsupported field/iu);
	assert.throws(() => project([transcript({ sourceSha256: '34'.repeat(32) })]), /source digest/iu);
	assert.throws(() => project([transcript({ sourceVideoTimingSha256: '56'.repeat(32) })]),
		/video timing digest/iu);
	assert.throws(() => project([transcript({ sourceEndFrame: 96_001 })]), /exceeds source bounds/iu);
	assert.throws(() => validateFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, { ...project(), unknownAuthority: true },
	), /unsupported field/iu);
});

test('F31 inherited edits, runtime projection and undo retain exact assistance custody', () => {
	const runtime = createEditorProjectRuntimeV31Selection(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE);
	const held = project();
	const command = createAddTrackCommand({
		type: 'audio', id: 'dialogue-track', name: 'Dialogue', armed: false,
	});
	const updated = runtime.applyCommand(held, command, { now: NOW });
	assert.equal(updated.schemaVersion, 31);
	assert.deepEqual(updated.assistanceAssets, held.assistanceAssets);
	assert.equal((updated.tracks as readonly Readonly<{ readonly id: string }>[])
		.some(({ id }) => id === 'dialogue-track'), true);
	const projected = runtime.projectForRuntimeConsumers(updated);
	assert.equal(projected.schemaVersion, 31);
	assert.deepEqual(projected.assistanceAssets, held.assistanceAssets);
	const history = runtime.executeCommand(runtime.createHistory(held), command, { now: NOW });
	const undone = runtime.undo(history, { now: NOW });
	assert.deepEqual(undone.present.assistanceAssets, held.assistanceAssets);
	assert.equal((undone.present.tracks as readonly Readonly<{ readonly id: string }>[])
		.some(({ id }) => id === 'dialogue-track'), false);
});

test('F31 inherited automation survives undo and redo without losing assistance custody', () => {
	const runtime = createEditorProjectRuntimeV31Selection(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE);
	const held = runtime.applyCommand(project(), createAddTrackCommand({
		type: 'audio', id: 'dialogue-track', name: 'Dialogue', armed: false,
	}), { now: NOW });
	const lane = {
		id: 'dialogue-gain',
		address: {
			kind: 'strip', strip: { kind: 'track', id: 'dialogue-track' }, parameterId: 'gain',
		},
		timebase: 'absolute-samples',
		points: [{ id: 'start', position: 0, value: 0.5 }],
		segments: [],
	} as const;
	const executed = runtime.executeCommand(runtime.createHistory(held), {
		type: 'automation-lane/set', laneId: lane.id, expected: null, lane,
	}, { now: NOW });
	assert.deepEqual(executed.present.automationLanes, [lane]);
	const undone = runtime.undo(executed, { now: NOW });
	assert.deepEqual(undone.present.automationLanes, []);
	const redone = runtime.redo(undone, { now: NOW });
	assert.deepEqual(redone.present.automationLanes, [lane]);
	assert.deepEqual(redone.present.assistanceAssets, held.assistanceAssets);
});

test('selected F31 history upserts one transcript reference as one undoable commit', () => {
	const runtime = createEditorProjectRuntimeV31Selection(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE);
	const initial = project([]);
	const command = snapshotAssistanceAssetUpsertCommandV1({
		type: 'assistance-asset/upsert', expectedReference: null, reference: transcript(),
		commands: [
			createAddLabelTrackCommand({ id: 'transcript-labels', name: 'Transcript' }),
			createAddLabelCommand('transcript-labels', {
				id: 'transcript-label-01', title: 'Speaker 1', startFrame: 0, endFrame: 48_000,
			}),
		],
	});
	const executed = runtime.executeCommand(runtime.createHistory(initial), command, { now: NOW });
	assert.equal(executed.undoStack.length, 1);
	assert.equal(Number(executed.present.revision), Number(initial.revision) + 1);
	assert.deepEqual(executed.present.assistanceAssets, [createAssistanceAssetReferenceV1(transcript())]);
	assert.deepEqual(executed.present.sources, initial.sources);
	assert.deepEqual(executed.present.ofxEffects, initial.ofxEffects);
	const executedTracks = executed.present.tracks as readonly Readonly<{ id: string }>[];
	assert.equal(executedTracks.some(({ id }) => id === 'transcript-labels'), true);
	assert.equal(executed.present.featureRequirements.requirements.some(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.assistanceAssets
	)), true);
	assert.throws(() => runtime.applyCommand(executed.present, command), /expected.*stale/iu);
	const failing = snapshotAssistanceAssetUpsertCommandV1({
		type: 'assistance-asset/upsert', expectedReference: null, reference: transcript(),
		commands: [createAddLabelCommand('missing-label-track', {
			id: 'orphan-label', title: 'Orphan', startFrame: 0, endFrame: 1,
		})],
	});
	assert.throws(() => runtime.applyCommand(executed.present, failing), /expected.*stale/iu);
	assert.throws(() => runtime.applyCommand(initial, failing), /track|missing|unknown/iu);
	assert.deepEqual(initial.assistanceAssets, []);
	const initialTracks = initial.tracks as readonly Readonly<{ id: string }>[];
	assert.equal(initialTracks.some(({ id }) => id === 'transcript-labels'), false);
	const undone = runtime.undo(executed, { now: NOW });
	assert.deepEqual(undone.present.assistanceAssets, []);
	assert.deepEqual(undone.present.tracks, initial.tracks);
	const redone = runtime.redo(undone, { now: NOW });
	assert.deepEqual(redone.present.assistanceAssets, [createAssistanceAssetReferenceV1(transcript())]);
	const redoneTracks = redone.present.tracks as readonly Readonly<{ id: string }>[];
	assert.equal(redoneTracks.some(({ id }) => id === 'transcript-labels'), true);
	assert.deepEqual(redone.present.sources, initial.sources);
});

test('F31 route ownership selects capture, assistance UI and the product route', () => {
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.projectSchemaVersion, 31);
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.desktopTransport.projectSchemaVersion, 31);
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.desktopLibraryHandshake.projectSchemaVersion, 31);
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.desktopLibraryHandshake.desktopLibrarySchemaVersion, 20);
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.desktopTransport.activation, 'selected');
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.selected, true);
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.framescaperCapture, true);
	assert.equal(FRAMESCAPER_V31_PRODUCT_ROUTE.assistanceUi, true);
	assert.equal(FRAMESCAPER_PROFILE.applicationFeatures.framescaperCapture, true);
	assert.equal(FRAMESCAPER_PROFILE.capabilities.assistanceAssets, true);
});

test('F31 portable export projects inherited native state through the V27 asset authority', async () => {
	const runtime = createFramescaperScapeNativeRuntimeV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE);
	const portable = createFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v31-portable', title: 'Portable F31', now: NOW,
	} as never);
	const exported = await runtime.exportScapeProject(portable, {
		async *readSourceChunks() { /* Empty F31 fixture has no audio source bodies. */ },
		async loadMediaAsset() { return null; },
	} as never);
	assert.ok(exported.blob);
	assert.equal(exported.manifest.project.schemaVersion, FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION);
});

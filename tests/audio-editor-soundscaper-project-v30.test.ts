/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_ASSET_REFERENCE_LIMITS_V1,
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
	createAssistanceAssetReferenceV1,
} from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import { createAudioSource, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	PROJECT_FEATURE_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from '../src/common/editor/project-owned-feature-requirements.ts';
import {
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
	isActiveAudioEditorProjectSchema,
	isAudioWarpProjectSchema,
	isFoundationProjectSchema,
	isMaintainedProjectFeatureSchema,
	isMaintainedRenderedFallbackProjectSchema,
	isMasteringSequenceProjectSchema,
	isProductionMixerProjectSchema,
	isSoundscaperProductionProjectSchema,
	isSourceCharacteristicsProjectSchema,
	isTakeCompProjectSchema,
	isTimelineAnnotationProjectSchema,
	isTrackFolderProjectSchema,
	isTrackLockProjectSchema,
	isVideoRetimeCurveProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import {
	SOUNDSCAPER_V29_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/soundscaper/editor-project-feature-capability-profile-v29.ts';
import {
	SOUNDSCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/soundscaper/editor-project-feature-capability-profile-v30.ts';
import { createSoundscaperProjectV29 } from '../src/soundscaper/editor-project-v29.ts';
import {
	SoundscaperProjectV30ReimportRequiredError,
	cloneSoundscaperProjectV30,
	createSoundscaperProjectV30,
	loadSoundscaperProjectV30,
	validateSoundscaperProjectV30,
} from '../src/soundscaper/editor-project-v30.ts';

const NOW = '2026-08-25T00:00:00.000Z';
const SOURCE_SHA256 = 'ab'.repeat(32);
const BODY_SHA256 = 'cd'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);

function audioSource() {
	return createAudioSource({
		id: 'dialogue-source', name: 'Dialogue', storageKey: 'owned:dialogue-source',
		contentSha256: SOURCE_SHA256, frameCount: 96_000, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
}

function transcriptReference(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'transcript-01', kind: 'transcript-v1', sourceId: 'dialogue-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 4_800, sourceEndFrame: 52_800,
		sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
		modelArtifactSha256s: [MODEL_SHA256],
		body: {
			storageKey: `assistance-transcript-sha256:${BODY_SHA256}`,
			mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
			byteLength: 8_192, sha256: BODY_SHA256,
		},
		...overrides,
	};
}

function project(assistanceAssets: readonly unknown[] = [transcriptReference()]) {
	return createSoundscaperProjectV30({
		id: 'soundscaper-v30', title: 'Transcript custody', now: NOW,
		sources: [audioSource()], assistanceAssets,
	} as never);
}

test('V30 is inherited Soundscaper authority and registers assistance assets only where held', () => {
	assert.equal(SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION, 30);
	for (const predicate of [
		isFoundationProjectSchema, isSoundscaperProductionProjectSchema,
		isProductionMixerProjectSchema, isMasteringSequenceProjectSchema,
		isActiveAudioEditorProjectSchema, isTimelineAnnotationProjectSchema,
		isTrackFolderProjectSchema, isSourceCharacteristicsProjectSchema,
		isTrackLockProjectSchema, isVideoRetimeCurveProjectSchema,
		isTakeCompProjectSchema, isAudioWarpProjectSchema,
		isMaintainedProjectFeatureSchema, isMaintainedRenderedFallbackProjectSchema,
	]) assert.equal(predicate(30), true, predicate.name);
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.assistanceAssets,
		'org.soundscaper.capability.assistance-assets');
	const registration = (profile: unknown) => editorProjectFeatureCapabilityProfileDefinition(profile)
		.registrations.find(({ key }) => key === 'assistanceAssets');
	assert.equal(registration(SOUNDSCAPER_V29_PROJECT_FEATURE_CAPABILITY_PROFILE)?.available, false);
	assert.equal(registration(SOUNDSCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE)?.available, true);
});

test('V30 owns normalized transcript-v1 references and their exact capability requirement', () => {
	const held = project();
	assert.equal(validateSoundscaperProjectV30(held), true);
	assert.deepEqual(held.assistanceAssets[0], createAssistanceAssetReferenceV1(transcriptReference()));
	assert.equal(Object.isFrozen(held.assistanceAssets), true);
	assert.equal(Object.isFrozen(held.assistanceAssets[0]?.body), true);
	assert.equal(held.featureRequirements.requirements.some(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.assistanceAssets
	)), true);
	const cloned = cloneSoundscaperProjectV30(held);
	assert.deepEqual(cloned, held);
	assert.notEqual(cloned, held);
	assert.notEqual(cloned.assistanceAssets, held.assistanceAssets);
});

test('V29 upgrades exactly once with no invented assets and future data stays opaque', () => {
	const predecessor = createSoundscaperProjectV29({
		id: 'soundscaper-v29', title: 'Predecessor', now: NOW,
	} as never);
	const upgraded = loadSoundscaperProjectV30(predecessor);
	assert.equal(upgraded.readOnly, false);
	assert.equal(upgraded.project.schemaVersion, 30);
	assert.deepEqual((upgraded.project as ReturnType<typeof project>).assistanceAssets, []);
	assert.equal(loadSoundscaperProjectV30(project()).readOnly, false);
	assert.throws(() => loadSoundscaperProjectV30({ ...predecessor, schemaVersion: 23 }), (error) => {
		assert.ok(error instanceof SoundscaperProjectV30ReimportRequiredError);
		assert.equal(error.sourceSchemaVersion, 23);
		return true;
	});
	const future = { ...project(), schemaVersion: 31, futureCustody: { retained: true } };
	const loaded = loadSoundscaperProjectV30(future);
	assert.equal(loaded.readOnly, true);
	assert.equal(loaded.reason, 'newer-schema');
	assert.deepEqual((loaded.project as Record<string, unknown>).futureCustody, { retained: true });
});

test('transcript references are closed, content-addressed and exactly source-bound', () => {
	assert.throws(() => project([transcriptReference({ kind: 'embedding-v1' })]), /transcript-v1/iu);
	assert.throws(() => project([{ ...transcriptReference(), extra: true }]), /unsupported field/iu);
	assert.throws(() => project([transcriptReference({ sourceSha256: 'ef'.repeat(32) })]),
		/source digest/iu);
	assert.throws(() => project([transcriptReference({ sourceId: 'missing-source' })]),
		/missing source/iu);
	assert.throws(() => project([transcriptReference({ sourceEndFrame: 4_800 })]),
		/positive half-open/iu);
	assert.throws(() => project([transcriptReference({ sourceEndFrame: 96_001 })]),
		/exceeds source bounds/iu);
	assert.throws(() => project([transcriptReference({ sourceVideoTimingSha256: 'ef'.repeat(32) })]),
		/audio-only source/iu);
	assert.throws(() => project([transcriptReference({ body: {
		...transcriptReference().body as object,
		storageKey: `assistance-transcript-sha256:${'ef'.repeat(32)}`,
	} })]), /storage key.*digest/iu);
	assert.throws(() => project([transcriptReference({ body: {
		...transcriptReference().body as object, segments: [],
	} })]), /unsupported field/iu);
});

test('transcript collections and exact model artifact sets are bounded and canonical', () => {
	assert.throws(() => project([
		transcriptReference({ id: 'duplicate' }), transcriptReference({ id: 'duplicate' }),
	]), /duplicate assistance asset ID/iu);
	assert.throws(() => project([transcriptReference({ modelArtifactSha256s: [] })]),
		/1 through/iu);
	assert.throws(() => project([transcriptReference({
		modelArtifactSha256s: ['ff'.repeat(32), MODEL_SHA256],
	})]), /sorted and unique/iu);
	assert.throws(() => project(Array.from(
		{ length: ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumAssets + 1 },
		() => transcriptReference(),
	)), /maximum/iu);
});

test('video transcripts require the exact video timing body while audio-only sources forbid one', () => {
	const timing = createVideoTimingAssetPublication(SOURCE_SHA256, {
		timescale: 1,
		presentationTicks: [0n, 1n],
		finalFrameDurationTicks: 1n,
	}).reference;
	const video = createVideoSource({
		id: 'video-source', name: 'Dialogue video', mimeType: 'video/mp4',
		storageKey: 'owned:video-source', contentSha256: SOURCE_SHA256,
		sampleFrameCount: 96_000, sampleRate: 48_000, sourceFrameCount: 2,
		frameRate: { num: 1, den: 1 }, width: 640, height: 360,
		videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
		timingAsset: timing, timingDecision: { mode: 'exact', rate: { num: 1, den: 1 } },
	});
	const reference = transcriptReference({
		sourceId: 'video-source', sourceStartFrame: 0, sourceEndFrame: 96_000,
		sourceVideoTimingSha256: timing.sha256,
	});
	assert.doesNotThrow(() => createSoundscaperProjectV30({
		id: 'video-v30', title: 'Video transcript', now: NOW,
		sources: [video], assistanceAssets: [reference],
	} as never));
	for (const sourceVideoTimingSha256 of [null, 'ef'.repeat(32)]) {
		assert.throws(() => createSoundscaperProjectV30({
			id: 'video-v30', title: 'Video transcript', now: NOW,
			sources: [video],
			assistanceAssets: [transcriptReference({
				...reference, sourceVideoTimingSha256,
			})],
		} as never), /video timing digest/iu);
	}
});

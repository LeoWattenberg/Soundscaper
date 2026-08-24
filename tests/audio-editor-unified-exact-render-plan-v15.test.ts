/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeMediaPlanEnvelopeV2,
} from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	assertNativeMediaPlanEnvelopeV3,
	createNativeMediaPlanEnvelopeV3,
} from '../src/common/editor/native-media-plan-envelope-v3.ts';
import {
	FRAMESCAPER_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1,
} from '../src/common/editor/unified-exact-render-delivery-v15.ts';
import {
	createUnifiedExactRenderPlan,
	type UnifiedExactRenderPlanV14,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;

test('V15 seals one explicit mov_text caption delivery without changing V14 custody', () => {
	const v14 = encodedPlan();
	const plan = createUnifiedExactRenderPlan(v15Candidate(v14, {
		captionDelivery: captionDelivery({
			mux: { codec: 'mov_text', documentSha256: SHA_A },
		}),
		companionAudio: null,
	}));

	assert.equal(plan.version, 15);
	assert.deepEqual(plan.captionDelivery, {
		stage: 'post-finishing-delivery', trackId: 'caption-main', cueSetSha256: SHA_B,
		mux: { codec: 'mov_text', documentSha256: SHA_A },
		burnIn: null, sidecar: null,
	});
	assert.equal(plan.companionAudio, null);
	assert.throws(() => createNativeMediaPlanEnvelopeV2(plan), /V13 and V14/u);

	const envelope = createNativeMediaPlanEnvelopeV3(plan);
	assert.equal(envelope.envelopeVersion, 3);
	assert.equal(envelope.planVersion, 15);
	assert.equal(envelope.strategy, 'framescaper-unified-exact-v15-delivery');
	assert.equal(envelope.summary.captionDelivery?.trackId, 'caption-main');
	assert.equal(envelope.summary.companionAudio, null);
	assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV3(envelope));
	assert.equal(Object.isFrozen(plan.captionDelivery), true);
	assert.equal(Object.isFrozen(plan), true);
});

test('V15 keeps V14 envelopes executable with their original sidecar-only semantics', () => {
	const envelope = createNativeMediaPlanEnvelopeV3(encodedPlan());
	assert.equal(envelope.planVersion, 14);
	assert.equal(envelope.strategy, 'framescaper-unified-exact-v14-native');
	assert.equal(envelope.summary.captionDelivery, null);
	assert.equal(envelope.summary.companionAudio, null);
	assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV3(envelope));
});

test('V15 image sequences bind one user-selected ordinary audio plan', () => {
	assert.deepEqual(FRAMESCAPER_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1, [
		'wav', 'bwf', 'aiff', 'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
	]);
	const v14 = imageSequencePlan();
	const plan = createUnifiedExactRenderPlan(v15Candidate(v14, {
		captionDelivery: captionDelivery({
			sidecar: { format: 'vtt', documentSha256: SHA_A },
		}),
		companionAudio: {
			formatId: 'bwf', fileName: 'audio.wav', planFingerprint: SHA_A,
			recoveryClass: 'atomic-restart',
		},
	}));
	assert.equal(plan.companionAudio?.formatId, 'bwf');
	assert.equal(plan.companionAudio?.fileName, 'audio.wav');
	assert.equal(createNativeMediaPlanEnvelopeV3(plan).summary.companionAudio?.formatId, 'bwf');
});

test('V15 refuses hidden caption substitutions and unclosed companion audio', () => {
	const encoded = encodedPlan();
	const image = imageSequencePlan();
	for (const candidate of [
		v15Candidate(encoded, {
			captionDelivery: captionDelivery({ mux: { codec: 'webvtt', documentSha256: SHA_A } }),
			companionAudio: null,
		}),
		v15Candidate(encoded, {
			captionDelivery: captionDelivery({ mux: { codec: 'mov_text', documentSha256: SHA_A } }, 'missing-track'),
			companionAudio: null,
		}),
		v15Candidate(encoded, {
			captionDelivery: null,
			companionAudio: {
				formatId: 'bwf', fileName: 'audio.wav', planFingerprint: SHA_A,
				recoveryClass: 'atomic-restart',
			},
		}),
		v15Candidate(image, {
			captionDelivery: null,
			companionAudio: null,
		}),
		v15Candidate(image, {
			captionDelivery: captionDelivery({ sidecar: { format: 'vtt' } }),
			companionAudio: {
				formatId: 'bwf', fileName: 'audio.wav', planFingerprint: SHA_A,
				recoveryClass: 'atomic-restart',
			},
		}),
		v15Candidate(image, {
			captionDelivery: null,
			companionAudio: {
				formatId: 'custom-ffmpeg', fileName: 'audio.wav', planFingerprint: SHA_A,
				recoveryClass: 'atomic-restart',
			},
		}),
		v15Candidate(image, {
			captionDelivery: null,
			companionAudio: {
				formatId: 'flac', fileName: 'audio.wav', planFingerprint: SHA_A,
				recoveryClass: 'atomic-restart',
			},
		}),
	]) {
		assert.throws(() => createUnifiedExactRenderPlan(candidate), /caption|companion|format|track/iu);
	}
});

test('V15 refuses burn-in for the ProRes 4444 alpha mezzanine', () => {
	const alpha = structuredClone(encodedPlan()) as Record<string, unknown>;
	alpha.deliveryProfile = 'encode-mov-prores-4444';
	alpha.codecs = {
		video: 'prores', videoEncoder: 'prores_ks', audio: 'pcm_s16le', audioEncoder: 'pcm_s16le',
		pixelFormat: 'yuva444p10le',
	};
	const output = alpha.output as Record<string, unknown>;
	output.canvas = { ...(output.canvas as Record<string, unknown>), pixelFormat: 'yuva444p10le' };
	assert.throws(() => createUnifiedExactRenderPlan(v15Candidate(alpha as unknown as UnifiedExactRenderPlanV14, {
		captionDelivery: captionDelivery({
			burnIn: {
				planSha256: SHA_A, fontSubsetIds: ['font-main'], alphaDisposition: 'caption-composited',
			},
		}),
		companionAudio: null,
	})), /ProRes 4444.*burn/iu);
});

test('V15 makes PNG caption compositing into authored alpha explicit', () => {
	const image = imageSequencePlan();
	const companionAudio = {
		formatId: 'bwf', fileName: 'audio.wav', planFingerprint: SHA_A,
		recoveryClass: 'atomic-restart',
	};
	assert.throws(() => createUnifiedExactRenderPlan(v15Candidate(image, {
		captionDelivery: captionDelivery({
			burnIn: {
				planSha256: SHA_A, fontSubsetIds: ['font-main'], alphaDisposition: 'opaque-output',
			},
		}),
		companionAudio,
	})), /alpha.*caption-composited/iu);
	const plan = createUnifiedExactRenderPlan(v15Candidate(image, {
		captionDelivery: captionDelivery({
			burnIn: {
				planSha256: SHA_A, fontSubsetIds: ['font-main'], alphaDisposition: 'caption-composited',
			},
		}),
		companionAudio,
	}));
	assert.equal(plan.captionDelivery?.burnIn?.alphaDisposition, 'caption-composited');
});

function encodedPlan(): UnifiedExactRenderPlanV14 {
	const project = createFramescaperProjectV28(PROFILE, framescaperV20Options());
	return createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
}

function imageSequencePlan(): UnifiedExactRenderPlanV14 {
	const project = createFramescaperProjectV28(PROFILE, framescaperV20Options());
	return createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project, {
			kind: 'image-sequence', format: 'png', frameRate: { num: 30, den: 1 }, preserveAlpha: true,
		}), {
			kind: 'image-sequence', format: 'png', frameRate: { num: 30, den: 1 }, preserveAlpha: true,
		},
	);
}

function v15Candidate(
	plan: UnifiedExactRenderPlanV14,
	delivery: Readonly<{ captionDelivery: unknown; companionAudio: unknown }>,
): Record<string, unknown> {
	const candidate = structuredClone(plan) as Record<string, unknown>;
	candidate.version = 15;
	candidate.captionDelivery = delivery.captionDelivery;
	candidate.companionAudio = delivery.companionAudio;
	const finishing = (candidate.nodes as Record<string, unknown>[])
		.find((node) => node.kind === 'finishing');
	assert.ok(finishing);
	finishing.captionTracks = [captionTrack()];
	return candidate;
}

function captionDelivery(
	override: Readonly<Record<string, unknown>>,
	trackId = 'caption-main',
): Record<string, unknown> {
	return {
		stage: 'post-finishing-delivery', trackId, cueSetSha256: SHA_B,
		mux: null, burnIn: null, sidecar: null, ...override,
	};
}

function captionTrack(): Record<string, unknown> {
	return {
		schemaVersion: 1, id: 'caption-main', sequenceId: 'main-sequence', name: 'English', language: 'en',
		styles: [], regions: [], speakers: [], cues: [{
			schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 1, text: 'Hello',
			styleId: null, regionId: null, speakerId: null, words: [],
		}],
	};
}

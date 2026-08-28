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
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const PROFILE = FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE;

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
			authorityFingerprint: SHA_B,
			recoveryClass: 'atomic-restart',
		},
	}));
	assert.equal(plan.companionAudio?.formatId, 'bwf');
	assert.equal(plan.companionAudio?.fileName, 'audio.wav');
	assert.equal(plan.companionAudio?.planFingerprint, SHA_A);
	assert.equal(plan.companionAudio?.authorityFingerprint, SHA_B);
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
				authorityFingerprint: SHA_B,
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
				authorityFingerprint: SHA_B,
				recoveryClass: 'atomic-restart',
			},
		}),
		v15Candidate(image, {
			captionDelivery: null,
			companionAudio: {
				formatId: 'custom-ffmpeg', fileName: 'audio.wav', planFingerprint: SHA_A,
				authorityFingerprint: SHA_B,
				recoveryClass: 'atomic-restart',
			},
		}),
		v15Candidate(image, {
			captionDelivery: null,
			companionAudio: {
				formatId: 'flac', fileName: 'audio.wav', planFingerprint: SHA_A,
				authorityFingerprint: SHA_B,
				recoveryClass: 'atomic-restart',
			},
		}),
	].map((candidate, index) => [candidate, [
		/cannot be muxed into mov/iu,
		/not in the exact finishing plan/iu,
		/only for a non-embedded image-sequence delivery/iu,
		/requires companion audio for its programme audio/iu,
		/caption sidecar\.documentSha256 is required/iu,
		/outside the closed built-in registry/iu,
		/file name does not match its format/iu,
	][index]!] as const)) {
		// Each candidate pins its own refusal: a union regex over seven causes
		// would accept the wrong branch dying for the wrong reason.
		assert.throws(() => createUnifiedExactRenderPlan(candidate[0]), candidate[1]);
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
		authorityFingerprint: SHA_B,
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

test('V15 font subset order is code-unit exact, never the validator locale', () => {
	// The adapter sorts with Array#sort (code-unit); the admission must agree
	// under every ICU configuration, or a case-diverging subset pair becomes
	// a plan that validates on one machine and refuses on another.
	const image = imageSequencePlan();
	const companionAudio = {
		formatId: 'bwf', fileName: 'audio.wav', planFingerprint: SHA_A,
		authorityFingerprint: SHA_B,
		recoveryClass: 'atomic-restart',
	};
	const burn = (fontSubsetIds: readonly string[]) => v15Candidate(image, {
		captionDelivery: captionDelivery({
			burnIn: { planSha256: SHA_A, fontSubsetIds, alphaDisposition: 'caption-composited' },
		}),
		companionAudio,
	});
	const plan = createUnifiedExactRenderPlan(burn(['Zebra', 'alpha']));
	assert.deepEqual(plan.captionDelivery?.burnIn?.fontSubsetIds, ['Zebra', 'alpha']);
	assert.throws(
		() => createUnifiedExactRenderPlan(burn(['alpha', 'Zebra'])),
		/unique and sorted/u,
	);
});

test('companion audio file names carry the export catalog extension', async () => {
	// The helper restates the catalog's per-format extensions; deriving the
	// expectation from the catalog itself is what catches the next divergence
	// (WavPack shipped as audio.wavpack while every tool expects .wv).
	const { framescaperImageSequenceCompanionAudioFileNameV15 } = await import(
		'../src/common/editor/unified-exact-render-delivery-v15.ts');
	const { PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1 } = await import(
		'../src/common/editor/platform-image-sequence-companion-audio.ts');
	const { MEDIA_EXPORT_FORMATS } = await import('../src/common/editor/media-export.js');
	for (const format of PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1) {
		assert.equal(
			framescaperImageSequenceCompanionAudioFileNameV15(format),
			`audio.${(MEDIA_EXPORT_FORMATS as unknown as Record<string, { extension: string }>)[format]!.extension}`,
			format,
		);
	}
});

function encodedPlan(): UnifiedExactRenderPlanV14 {
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
	return createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
}

function imageSequencePlan(): UnifiedExactRenderPlanV14 {
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
	return createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project, {
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

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertAssistanceOnnxAudioModelBindingV1,
	assertAssistanceOnnxDereverbModelBindingV1,
	assertAssistanceOnnxEnhancementSeparationModelBindingV1,
	assertAssistanceQwenEditorialModelBindingV1,
	assertAssistanceTransNetV2ModelBindingV1,
	assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1,
} from '../desktop/assistance-operation-family-execution.ts';

const DIGEST = 'ab'.repeat(32);
const WAV2VEC2_SHA256 =
	'b73fe60ddcd3fd07f91d65d50b4f10ba99039104c4fb5db5bdafbb27610bb6eb';
const QWEN_SHA256 =
	'7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5';

test('main admission closes every pending derived-model catalog identity and version', () => {
	assert.doesNotThrow(() => assertAssistanceOnnxEnhancementSeparationModelBindingV1(
		'source-separation', binding('tiger-dnr', '1.0.0'),
	));
	assert.doesNotThrow(() => assertAssistanceOnnxAudioModelBindingV1(
		'audio-tagging', binding('panns-cnn10', '1.0.0'),
	));
	for (const modelId of ['beat-this-small0', 'beat-this-final0']) {
		assert.doesNotThrow(() => assertAssistanceOnnxAudioModelBindingV1(
			'beat-tracking', binding(modelId, '1.1.0'),
		));
	}
	assert.doesNotThrow(() => assertAssistanceTransNetV2ModelBindingV1(
		binding('transnetv2', '1.0.0'),
	));
	assert.doesNotThrow(() => assertAssistanceOnnxDereverbModelBindingV1(
		binding('dereverb-room', '1.0.0'),
	));

	assert.throws(() => assertAssistanceOnnxAudioModelBindingV1(
		'audio-tagging', binding('panns-cnn10', 'converted-v1'),
	), /PANNs|1\.0\.0|identity/iu);
	assert.throws(() => assertAssistanceOnnxDereverbModelBindingV1(
		binding('dereverb-room', '2.0.0'),
	), /dereverb-room|1\.0\.0/iu);
	assert.throws(() => assertAssistanceOnnxDereverbModelBindingV1(
		binding('tiger-dnr', '1.0.0'),
	), /dereverb-room/u);
	assert.throws(() => assertAssistanceTransNetV2ModelBindingV1(
		binding('transnetv2', '2.0.0'),
	), /TransNetV2|1\.0\.0|identity/iu);
});

test('direct-pin admission also binds exact catalog version and artifact SHA-256', () => {
	assert.doesNotThrow(() => assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1({
		...binding('wav2vec2-base-960h', '1.0.0'), artifactSha256s: [WAV2VEC2_SHA256],
	}));
	assert.doesNotThrow(() => assertAssistanceQwenEditorialModelBindingV1({
		...binding('qwen3-4b-q4-k-m', '1.0.0'), artifactSha256s: [QWEN_SHA256],
	}));

	assert.throws(() => assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1({
		...binding('wav2vec2-base-960h', '2.0.0'), artifactSha256s: [WAV2VEC2_SHA256],
	}), /wav2vec2|version|identity/iu);
	assert.throws(() => assertAssistanceQwenEditorialModelBindingV1({
		...binding('qwen3-4b-q4-k-m', '1.0.0'), artifactSha256s: [DIGEST],
	}), /Qwen|digest|identity/iu);
});

function binding(modelId: string, version: string) {
	return Object.freeze({ modelId, version, artifactSha256s: Object.freeze([DIGEST]) });
}

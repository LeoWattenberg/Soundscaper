/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceTtsScriptBodyPublicationV1 } from
	'../src/common/editor/assistance/tts-script-body-publication-v1.ts';
import { createAssistanceAssetReferenceV1, validateAssistanceAssetSourceBindingsV1 } from
	'../src/common/editor/assistance/assistance-asset-reference-v1.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = 'cd'.repeat(32);

function publication() {
	return createAssistanceTtsScriptBodyPublicationV1({
		assetId: 'tts-script-1', text: 'Hello, world.', language: 'en-US',
		voiceId: 'en_US-lessac-medium', speed: 1.25,
		source: { sourceId: 'generated-audio', sourceSha256: SOURCE_SHA256,
			sourceStartFrame: 0, sourceEndFrame: 48_000 },
		model: { modelId: 'piper-en-us-lessac-medium', modelVersion: '1.0.0',
			artifactSha256s: [MODEL_SHA256] },
		recipe: { id: 'text-to-speech', version: 1 },
	});
}

test('TTS script publication binds exact generated source, model, voice and settings', () => {
	const result = publication();
	assert.equal(result.reference.kind, 'tts-script-v1');
	assert.equal(result.reference.sourceSha256, SOURCE_SHA256);
	assert.equal(result.reference.sourceEndFrame, 48_000);
	assert.equal(result.reference.body.byteLength, result.bytes.byteLength);
	assert.equal(result.body.text, 'Hello, world.');
	assert.equal(result.body.voiceId, 'en_US-lessac-medium');
	assert.equal(result.body.speed, 1.25);
	assert.equal(result.body.modelId, 'piper-en-us-lessac-medium');
	assert.equal(result.body.modelVersion, '1.0.0');
	assert.deepEqual(result.body.artifactSha256s, [MODEL_SHA256]);
	assert.deepEqual(result.body.recipe, { id: 'text-to-speech', version: 1 });
	assert.deepEqual(JSON.parse(new TextDecoder().decode(result.bytes)), result.body);
	assert.deepEqual(createAssistanceAssetReferenceV1(result.reference), result.reference);
});

test('TTS script body identity changes with text, voice or speed', () => {
	const original = publication();
	for (const change of [{ text: 'Different text.' }, { voiceId: 'another-voice' },
		{ speed: 0.9 }]) {
		const changed = createAssistanceTtsScriptBodyPublicationV1({
			assetId: original.reference.id,
			text: original.body.text, language: original.body.language,
			voiceId: original.body.voiceId, speed: original.body.speed,
			source: { sourceId: original.reference.sourceId,
				sourceSha256: original.reference.sourceSha256,
				sourceStartFrame: 0, sourceEndFrame: original.reference.sourceEndFrame },
			model: { modelId: original.body.modelId,
				modelVersion: original.body.modelVersion,
				artifactSha256s: original.body.artifactSha256s },
			recipe: original.body.recipe,
			...change,
		});
		assert.notEqual(changed.reference.body.sha256, original.reference.body.sha256);
	}
});

test('TTS script accepts the exact Kokoro language variants', () => {
	const original = publication();
	for (const language of ['a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z']) {
		const result = createAssistanceTtsScriptBodyPublicationV1({
			assetId: original.reference.id, text: original.body.text,
			language, voiceId: original.body.voiceId, speed: original.body.speed,
			source: { sourceId: original.reference.sourceId,
				sourceSha256: original.reference.sourceSha256,
				sourceStartFrame: 0, sourceEndFrame: original.reference.sourceEndFrame },
			model: { modelId: original.body.modelId, modelVersion: original.body.modelVersion,
				artifactSha256s: original.body.artifactSha256s },
			recipe: original.body.recipe,
		});
		assert.equal(result.body.language, language);
	}
});

test('TTS script preserves multiline narration and refuses other controls', () => {
	const original = publication();
	const request = {
		assetId: original.reference.id, text: 'First line.\nSecond line.\r\nThird line.',
		language: 'a', voiceId: original.body.voiceId, speed: original.body.speed,
		source: { sourceId: original.reference.sourceId,
			sourceSha256: original.reference.sourceSha256,
			sourceStartFrame: 0, sourceEndFrame: original.reference.sourceEndFrame },
		model: { modelId: original.body.modelId, modelVersion: original.body.modelVersion,
			artifactSha256s: original.body.artifactSha256s }, recipe: original.body.recipe,
	};
	assert.equal(createAssistanceTtsScriptBodyPublicationV1(request).body.text, request.text);
	assert.throws(() => createAssistanceTtsScriptBodyPublicationV1({
		...request, text: 'A\tB',
	}), /bounded plain text/u);
	assert.throws(() => createAssistanceTtsScriptBodyPublicationV1({
		...request, text: 'A\rB',
	}), /bounded plain text/u);
});

test('TTS scripts reject partial source ranges and malformed settings', () => {
	const valid = publication();
	assert.throws(() => createAssistanceTtsScriptBodyPublicationV1({
		assetId: valid.reference.id, text: valid.body.text, language: valid.body.language,
		voiceId: valid.body.voiceId, speed: valid.body.speed,
		source: { sourceId: valid.reference.sourceId,
			sourceSha256: valid.reference.sourceSha256,
			sourceStartFrame: 1, sourceEndFrame: valid.reference.sourceEndFrame },
		model: { modelId: valid.body.modelId, modelVersion: valid.body.modelVersion,
			artifactSha256s: valid.body.artifactSha256s },
		recipe: valid.body.recipe,
	}), /full positive generated source range/u);
	assert.throws(() => createAssistanceAssetReferenceV1({
		...valid.reference, sourceVideoTimingSha256: 'ef'.repeat(32),
	}), /audio-only/u);
	assert.throws(() => createAssistanceAssetReferenceV1({
		...valid.reference, sourceStartFrame: 1,
	}), /frame zero/u);
	assert.throws(() => validateAssistanceAssetSourceBindingsV1([valid.reference], [{
		kind: 'audio', id: valid.reference.sourceId,
		contentSha256: valid.reference.sourceSha256,
		frameCount: valid.reference.sourceEndFrame + 1,
	}]), /full audio source/u);
});

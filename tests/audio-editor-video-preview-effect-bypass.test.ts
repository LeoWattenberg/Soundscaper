/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureVideoEffectBypassMetadata } from '../src/common/editor/project-feature-video-effect-bypass.ts';
import { createVideoPreviewEffectBypass } from '../src/common/editor/ui/workspace/video-preview-effect-bypass.ts';

function metadata(): ProjectFeatureVideoEffectBypassMetadata {
	return {
		schemaVersion: 1,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		requirementIds: ['video-effects'],
		placeholders: [{
			location: 'timeline', clipId: 'clip-a', effectId: 'pixelate-a', effectType: 'pixelate',
		}, {
			location: 'project-bin', clipId: 'clip-a', effectId: 'bin-effect', effectType: 'vignette',
		}],
	};
}

test('video preview bypass filters exact timeline effects and caches projected stacks', () => {
	let payloadReads = 0;
	const affected = { id: 'pixelate-a', type: 'pixelate', enabled: true } as Record<string, unknown>;
	Object.defineProperty(affected, 'params', {
		enumerable: true,
		get() {
			payloadReads += 1;
			throw new Error('affected params were read');
		},
	});
	const disabled = { id: 'disabled', type: 'glow', enabled: false, params: {} };
	const retained = { id: 'vignette-a', type: 'vignette', enabled: true, params: { amount: 0.5 } };
	const effects = [affected, disabled, retained];
	const bypass = createVideoPreviewEffectBypass(metadata());
	const projected = bypass.effectsFor('clip-a', effects);

	assert.notStrictEqual(projected, effects);
	assert.deepEqual(projected, [disabled, retained]);
	assert.strictEqual(projected[0], disabled);
	assert.strictEqual(projected[1], retained);
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(payloadReads, 0);
	assert.strictEqual(bypass.effectsFor('clip-a', effects), projected);
	assert.equal(bypass.activeEffectCount('clip-a', effects), 1);
	assert.equal(payloadReads, 0);
});

test('video preview bypass preserves stack identity when clip, type, or location does not match', () => {
	const effects = [{ id: 'pixelate-a', type: 'pixelate', enabled: true, params: { blockSize: 16 } }];
	for (const candidate of [
		createVideoPreviewEffectBypass(null),
		createVideoPreviewEffectBypass({ ...metadata(), featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects } as never),
		createVideoPreviewEffectBypass({
			...metadata(),
			placeholders: [{
				location: 'timeline', clipId: 'other-clip', effectId: 'pixelate-a', effectType: 'pixelate',
			}],
		}),
		createVideoPreviewEffectBypass({
			...metadata(),
			placeholders: [{
				location: 'timeline', clipId: 'clip-a', effectId: 'pixelate-a', effectType: 'glow',
			}],
		}),
		createVideoPreviewEffectBypass({
			...metadata(),
			placeholders: [{
				location: 'project-bin', clipId: 'clip-a', effectId: 'pixelate-a', effectType: 'pixelate',
			}],
		}),
	]) {
		assert.strictEqual(candidate.effectsFor('clip-a', effects), effects);
		assert.equal(candidate.activeEffectCount('clip-a', effects), 1);
	}
});

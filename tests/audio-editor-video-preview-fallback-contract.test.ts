/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoPreviewFallbackLedgerLayers,
	resolveVideoPreviewRenderIssue,
	shouldHideVideoPreviewIdentityFallback,
} from '../src/common/editor/ui/workspace/video-preview-fallback.ts';

test('constructor fallback inputs retain composition identity and effects', () => {
	const renderDescription = Object.freeze({ blendMode: 'multiply', canonical: true });
	const layers = createVideoPreviewFallbackLedgerLayers([{
		clips: [{
			available: true,
			clipId: 'clip-authored',
			clip: { videoEffects: [{ id: 'effect-a' }] },
			renderDescription,
		}, {
			available: false,
			clipId: 'clip-unavailable',
			clip: { videoEffects: [] },
			renderDescription: { blendMode: 'screen' },
		}],
	}], (_clipId, effects) => effects);

	assert.equal(layers.length, 1);
	assert.equal(layers[0]?.blendMode, 'multiply');
	assert.deepEqual(layers[0]?.entries, [{
		clipId: 'clip-authored',
		effects: [{ id: 'effect-a' }],
		renderDescription,
	}]);
	assert.strictEqual(layers[0]?.entries[0]?.renderDescription, renderDescription);
});

test('render issues expose composition omissions independently from effect omissions', () => {
	const issue = resolveVideoPreviewRenderIssue({
		effects: {
			requested: ['effect-a'],
			omitted: [],
		},
		composition: {
			requested: [
				{ clipId: 'clip-a', blendMode: 'multiply' },
				{ clipId: 'clip-b', blendMode: 'screen' },
			],
			fallbackRendered: ['clip-a'],
			omitted: ['clip-b'],
		},
	});

	assert.deepEqual(issue, {
		requestedEffectCount: 1,
		omittedEffectIds: [],
		requestedCompositionCount: 2,
		omittedCompositionClipIds: ['clip-a', 'clip-b'],
	});
	assert.equal(Object.isFrozen(issue), true);
	assert.equal(Object.isFrozen(issue.omittedCompositionClipIds), true);
});

test('authored composition never falls back to an untransformed DOM video', () => {
	assert.equal(shouldHideVideoPreviewIdentityFallback('fallback', { canonical: true }), true);
	assert.equal(shouldHideVideoPreviewIdentityFallback('ready', { canonical: true }), false);
	assert.equal(shouldHideVideoPreviewIdentityFallback('fallback', null), false);
	assert.equal(shouldHideVideoPreviewIdentityFallback('fallback', undefined), false);
});

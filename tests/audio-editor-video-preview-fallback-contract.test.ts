/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoPreviewFallbackLedgerLayers,
	resolveVideoPreviewRenderIssue,
	shouldHideVideoPreviewIdentityFallback,
} from '../src/common/editor/ui/workspace/video-preview-fallback.ts';
import { collectProductVideoVisualPreviewEffectIds } from '../src/common/editor/ui/workspace/product-video-visual-preview-effect-ledger.ts';

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

test('render issues retain effects already executed by an exact product preview', () => {
	assert.deepEqual(resolveVideoPreviewRenderIssue({
		effects: { requested: [], omitted: [] },
	}, ['adjustment-effect']), {
		requestedEffectCount: 1,
		omittedEffectIds: [],
		requestedCompositionCount: 0,
		omittedCompositionClipIds: [],
	});
});

test('exact preview effect ledger includes each executed active effect once', () => {
	const adjustmentEffect = Object.freeze({ id: 'adjustment-effect', enabled: true });
	assert.deepEqual(collectProductVideoVisualPreviewEffectIds([{
		trackId: 'video-track',
		entries: [{ effects: [adjustmentEffect, { id: 'disabled-media-effect', enabled: false }] }],
	}], {
		layers: [],
		adjustments: [{
			nodeId: 'active-adjustment', targetTrackIds: ['video-track'],
			effects: [adjustmentEffect], opacity: 1, blendMode: 'normal', maskIds: [],
		}, {
			nodeId: 'inactive-adjustment', targetTrackIds: ['absent-track'],
			effects: [{ id: 'inactive-effect', enabled: true }], opacity: 1,
			blendMode: 'normal', maskIds: [],
		}],
		activeFreezeNodeIds: [], availablePresetIds: [],
		ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] },
	}), ['adjustment-effect']);
});

test('exact preview effect ledger rejects unauthenticated media effect state', () => {
	assert.throws(() => collectProductVideoVisualPreviewEffectIds([{
		trackId: 'video-track', entries: [{ effects: 'adjustment-effect' }],
	}], {
		layers: [], adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [],
		ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] },
	}), /effects must be an array/u);
});

test('authored composition never falls back to an untransformed DOM video', () => {
	assert.equal(shouldHideVideoPreviewIdentityFallback('fallback', { canonical: true }), true);
	assert.equal(shouldHideVideoPreviewIdentityFallback('ready', { canonical: true }), false);
	assert.equal(shouldHideVideoPreviewIdentityFallback('fallback', null), false);
	assert.equal(shouldHideVideoPreviewIdentityFallback('fallback', undefined), false);
});

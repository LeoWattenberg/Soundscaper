/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	composeProductVideoVisualPreviewLayers,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-composition.ts';
import type {
	ProductVideoVisualPreviewFrame,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';

test('product visual layers join media painter order and adjustments execute as layer effects', () => {
	const media = [{
		trackId: 'background', trackIndex: 2,
		entries: [{ clipId: 'video', effects: [{
			id: 'adjust-brightness', type: 'color-adjust', enabled: true,
			params: { brightness: 0.25, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
		}] }],
	}];
	const frame = visualFrame();
	const layers = composeProductVideoVisualPreviewLayers(media, frame);
	assert.deepEqual(layers.map(({ trackId }) => trackId), ['background', 'foreground']);
	assert.deepEqual(layers[0].effects, [{
		id: 'adjust-brightness', type: 'color-adjust', enabled: true,
		params: { brightness: 0.25, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
	}]);
	assert.deepEqual(layers[0].entries[0]?.effects, [],
		'adjustment-owned effects execute once at layer scope, not again on their inventory clip');
	assert.equal(Object.isFrozen(layers), true);
	assert.equal(Object.isFrozen(layers[0].effects), true);
});

test('product visual composition rejects every unexplained or ambiguous active state', () => {
	const frame = visualFrame();
	assert.throws(() => composeProductVideoVisualPreviewLayers([], {
		...frame,
		ledger: { ...frame.ledger, consumedNodeIds: [], omittedNodeIds: ['render:visual:title'] },
	}), /unexplained omissions/iu);
	assert.throws(() => composeProductVideoVisualPreviewLayers([{
		trackId: 'foreground', trackIndex: 0, entries: [{ clipId: 'video' }],
	}], frame), /ambiguous active layers/iu);
	assert.throws(() => composeProductVideoVisualPreviewLayers([], {
		...frame,
		adjustments: [{ ...frame.adjustments[0]!, opacity: 0.5 }],
	}), /unconsumed presentation/iu);
});

function visualFrame(): ProductVideoVisualPreviewFrame {
	return {
		layers: [{
			trackId: 'foreground', trackIndex: 0,
			entries: [{ clipId: 'title', effects: [] }],
		}],
		adjustments: [{
			nodeId: 'render:visual:adjustment', targetTrackIds: ['background'],
			effects: [{
				id: 'adjust-brightness', type: 'color-adjust', enabled: true,
				params: { brightness: 0.25, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
			}],
			opacity: 1, blendMode: 'normal', maskIds: [],
		}],
		activeFreezeNodeIds: [], availablePresetIds: [],
		ledger: {
			requestedNodeIds: ['render:visual:title'],
			consumedNodeIds: ['render:visual:title'], omittedNodeIds: [],
		},
	};
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	identityVisualPlacement,
	multiplyVisualMaskPlanes,
} from '../src/framescaper/visual-finishing-kernel.ts';

test('visual mask multiplication rounds after every authored mask in stable order', () => {
	const masks = new Map([
		['first', Uint8Array.of(1, 254, 128, 255)],
		['second', Uint8Array.of(128, 128, 128, 0)],
		['third', Uint8Array.of(128, 128, 127, 255)],
	]);
	const evaluated: string[] = [];

	const combined = multiplyVisualMaskPlanes(['first', 'second', 'third'], 4, (id) => {
		evaluated.push(id);
		return masks.get(id)!;
	});

	assert.deepEqual([...combined], [1, 64, 32, 0]);
	assert.deepEqual(evaluated, ['first', 'second', 'third']);
	assert.deepEqual([...multiplyVisualMaskPlanes([], 3, () => assert.fail('no mask expected'))], [255, 255, 255]);
});

test('identity visual placement freezes full-aperture geometry and retains a fixed normal mode', () => {
	const placement = identityVisualPlacement(1_920, 1_080, 'screen');
	const fixedNormal = identityVisualPlacement(640, 480, 'normal');
	const fixedNormalMode: 'normal' = fixedNormal.blendMode;

	assert.deepEqual(placement, {
		crop: {
			normalized: { left: 0, top: 0, right: 0, bottom: 0 },
			sourcePixels: { x: 0, y: 0, width: 1_920, height: 1_080 },
		},
		sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0],
		opacityStart: 1, opacityEnd: 1, blendMode: 'screen', compositingOrder: 0,
	});
	assert.equal(fixedNormalMode, 'normal');
	assert.deepEqual(fixedNormal.crop.sourcePixels, { x: 0, y: 0, width: 640, height: 480 });
	assert.ok(Object.isFrozen(placement)
		&& Object.isFrozen(placement.crop)
		&& Object.isFrozen(placement.crop.normalized)
		&& Object.isFrozen(placement.crop.sourcePixels)
		&& Object.isFrozen(placement.sourceDisplayToCanvas));
});

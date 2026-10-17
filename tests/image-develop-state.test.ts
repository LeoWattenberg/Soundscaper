/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultPhotoDevelopV1, normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../src/common/editor/imaging/image-develop-contract-v1.ts';

test('The shared Develop owner preserves the existing photo process-1 bytes, defaults and limits', () => {
	const value = { processVersion: 1, effects: [
		{ id: 'z', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } },
		{ id: 'a', type: 'white-balance-v1', enabled: false, params: { tint: -20 } },
	], geometry: { crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, rotationDegrees: -0, flipHorizontal: true, flipVertical: false }, masks: [], maskBindings: [] };
	const expected = '{"processVersion":1,"effects":[{"id":"z","type":"tone-ladder-v1","enabled":true,"params":{"exposure":1,"contrast":0,"highlights":0,"shadows":0,"whites":0,"blacks":0}},{"id":"a","type":"white-balance-v1","enabled":false,"params":{"temperature":0,"tint":-20}}],"geometry":{"crop":{"x":0.1,"y":0.2,"width":0.8,"height":0.7},"rotationDegrees":0,"flipHorizontal":true,"flipVertical":false},"masks":[],"maskBindings":[]}';
	assert.equal(JSON.stringify(normalizeImageDevelopStateV1(value)), expected);
	assert.equal(JSON.stringify(normalizePhotoDevelopV1(value)), expected);
	assert.deepEqual(defaultImageDevelopStateV1(), defaultPhotoDevelopV1());
	assert.equal(IMAGE_DEVELOP_LIMITS_V1.maximumEffects, LIGHTSCAPER_CATALOG_LIMITS.maximumEffects);
	assert.equal(IMAGE_DEVELOP_LIMITS_V1.maximumMasks, LIGHTSCAPER_CATALOG_LIMITS.maximumMasks);
	assert.equal(IMAGE_DEVELOP_LIMITS_V1.maximumBytes, LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes);
});

test('Shared state stays detached and refuses accessors, future processes and dangling masks', () => {
	const effect = { id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 2 } };
	const input = { ...defaultPhotoDevelopV1(), effects: [effect] };
	const normalized = normalizeImageDevelopStateV1(input);
	effect.params.exposure = 3;
	assert.equal(normalized.effects[0]?.params.exposure, 2); assert.ok(Object.isFrozen(normalized.effects[0]?.params));
	let invoked = 0;
	const getter = Object.defineProperty({ ...input }, 'effects', { enumerable: true, get() { invoked++; return []; } });
	assert.throws(() => normalizeImageDevelopStateV1(getter), /own data/iu); assert.equal(invoked, 0);
	assert.throws(() => normalizeImageDevelopStateV1({ ...input, processVersion: 2 }), /process/iu);
	assert.throws(() => normalizeImageDevelopStateV1({ ...input, maskBindings: [{ effectId: 'tone', maskId: 'missing' }] }), /missing/iu);
});

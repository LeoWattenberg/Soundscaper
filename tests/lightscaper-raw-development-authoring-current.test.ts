/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareImageDevelopAuthoringCurrentV1, retainImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-authoring-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';

test('Current metadata authoring keeps the complete source setting while existing editors author repairs, masks, geometry and effects', () => {
	const original = setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode: 'recovery' });
	assert.equal(original.processVersion, 4); const before = JSON.stringify(original);
	const editable = prepareImageDevelopAuthoringCurrentV1(original); assert.equal(editable.processVersion, 3);
	assert.equal(Object.hasOwn(editable, 'rawDevelopment'), false);
	const edited = normalizeImageDevelopStateV3({ ...editable, geometry: { ...editable.geometry, rotationDegrees: 90 } });
	const result = retainImageDevelopRawDevelopmentCurrentV1(original, edited); assert.equal(result.processVersion, 4);
	assert.ok(result.processVersion === 4 && editable.processVersion === 3); assert.equal(result.rawDevelopment.mode, 'recovery');
	assert.equal(result.geometry.rotationDegrees, 90); assert.deepEqual(result.repairs, editable.repairs);
	assert.deepEqual(result.masks, editable.masks); assert.deepEqual(result.maskBindings, editable.maskBindings);
	assert.equal(JSON.stringify(original), before); assert.throws(() => retainImageDevelopRawDevelopmentCurrentV1(original, defaultImageDevelopStateV1()));
});

test('metadata authoring preserves old recipes exactly and a canonical fourth process stays fourth after editing', () => {
	const old = defaultImageDevelopStateV1(); assert.deepEqual(prepareImageDevelopAuthoringCurrentV1(old), old);
	assert.deepEqual(retainImageDevelopRawDevelopmentCurrentV1(old, old), old);
	const fourth = setImageDevelopRawDevelopmentCurrentV1(setImageDevelopRawDevelopmentCurrentV1(old, { schemaVersion: 1, mode: 'headroom' }), { schemaVersion: 1, mode: 'canonical' });
	const result = retainImageDevelopRawDevelopmentCurrentV1(fourth, prepareImageDevelopAuthoringCurrentV1(fourth));
	assert.deepEqual(result, fourth); assert.equal(result.processVersion, 4);
});

test('metadata authoring refuses malformed RAW policy before evaluating edited metadata and never replaces the source RAW group', () => {
	let reads = 0; const hostile = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error('Must remain unread.'); } });
	assert.throws(() => retainImageDevelopRawDevelopmentCurrentV1({ processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'future' } }, hostile));
	assert.equal(reads, 0);
	const source = setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode: 'headroom' });
	assert.throws(() => retainImageDevelopRawDevelopmentCurrentV1(source, setImageDevelopRawDevelopmentCurrentV1(source, { schemaVersion: 1, mode: 'recovery' })));
});

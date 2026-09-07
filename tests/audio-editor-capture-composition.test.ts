/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureComposition } from '../src/common/editor/controller/capture-composition.ts';

test('a product without capture does not construct capture dependencies or proxy resources', () => {
	const result = createCaptureComposition(null, () => { throw new Error('Capture dependencies were evaluated.'); });
	assert.equal(result.binding, null);
	assert.equal(result.proxyScheduler, null);
});

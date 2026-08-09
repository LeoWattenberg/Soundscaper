/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { hasWebGl2Capability } from './browser/helpers/webgl2-capability.js';

function runtimeWithContext(getContext) {
	return { document: { createElement: () => ({ getContext }) } };
}

test('detects WebGL2 from the runtime capability instead of a browser label', () => {
	assert.equal(hasWebGl2Capability(runtimeWithContext(() => ({}))), true);
	assert.equal(hasWebGl2Capability(runtimeWithContext(() => null)), false);
	assert.equal(hasWebGl2Capability({}), false);
	assert.equal(hasWebGl2Capability({ document: {} }), false);
	assert.equal(hasWebGl2Capability({ document: { createElement: () => ({}) } }), false);
});

test('requests the same WebGL2 context the video preview compositor requests', () => {
	const requests = [];
	hasWebGl2Capability(runtimeWithContext((contextId, attributes) => {
		requests.push({ contextId, attributes });
		return {};
	}));
	assert.deepEqual(requests, [{
		contextId: 'webgl2',
		attributes: {
			alpha: true,
			antialias: false,
			depth: false,
			preserveDrawingBuffer: false,
			premultipliedAlpha: false,
			stencil: false,
		},
	}]);
});

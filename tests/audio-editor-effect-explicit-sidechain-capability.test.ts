/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	effectExplicitSidechainCapability,
	effectSupportsExplicitSidechain,
} from '../src/common/editor/effect-explicit-sidechain-capability.ts';

test('the runtime sidechain contract admits only effects with implemented explicit inputs', () => {
	for (const effect of [
		{ type: 'limiter' },
		{ type: 'gate' },
		{ kind: 'AUDACITY-AUTO-DUCK' },
	]) {
		assert.equal(effectExplicitSidechainCapability(effect), 'supported');
		assert.equal(effectSupportsExplicitSidechain(effect), true);
	}

	for (const effect of [
		{ type: 'compressor' },
		{ type: 'highpass' },
		{ type: 'native-plugin', params: { instanceId: 'native-1' } },
		{ type: '' },
	]) {
		assert.equal(effectExplicitSidechainCapability(effect), 'unsupported');
		assert.equal(effectSupportsExplicitSidechain(effect), false);
	}

	assert.equal(effectExplicitSidechainCapability({ id: 'identity-only' }), 'unknown');
	assert.equal(effectSupportsExplicitSidechain({ id: 'identity-only' }), false);
});

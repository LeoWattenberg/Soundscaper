/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	requiredSoundscaperProfessionalNativeSelfTestIds,
} from '../scripts/lib/soundscaper-professional-native-build-candidate.mjs';
import {
	requiredPipelineSoundscaperProfessionalNativeSelfTestIds,
} from '../scripts/lib/soundscaper-professional-native-self-test-plan.mjs';

test('the self-test contract is closed and adds OS codec CTests only where applicable', () => {
	const linux = requiredSoundscaperProfessionalNativeSelfTestIds('linux-x64');
	const mac = requiredSoundscaperProfessionalNativeSelfTestIds('mac-arm64');
	assert(linux.includes('m5f1-handshake'));
	assert(linux.includes('addon-exact-backend-format-inventory'));
	assert(linux.includes('fixture-deterministic-process'));
	assert(linux.includes('isolation-broker-filesystem-grant'));
	assert.equal(linux.includes('isolation-rss-ceiling'), false);
	assert(linux.includes('packaged-electron-utility-process-smoke'));
	assert(linux.includes('delivery-filesystem-protocol'));
	assert.equal(linux.some((id) => id.startsWith('closure-')), false,
		'closure policy checks belong to dependency evidence, not synthetic self-test receipts');
	assert.equal(linux.includes('os-audio-codec-ctest'), false);
	assert(mac.includes('os-audio-codec-ctest'));
	assert(mac.includes('isolation-rss-ceiling'));
	assert(requiredPipelineSoundscaperProfessionalNativeSelfTestIds('mac-arm64')
		.includes('isolation-rss-ceiling'));
	assert.equal(requiredSoundscaperProfessionalNativeSelfTestIds('win-arm64')
		.includes('isolation-rss-ceiling'), false);
});

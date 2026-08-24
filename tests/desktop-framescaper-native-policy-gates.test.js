/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperNativeCapabilityPolicy,
	framescaperNativePolicyRowCleared,
	framescaperNativeQueueOperationCleared,
} from '../desktop/framescaper-native-services-registration.mjs';

test('Framescaper native policy uses each collection exact activation vocabulary', () => {
	const policy = {
		futureDistributionGates: [{ id: 'native-codecs', status: 'enabled' }],
		nativeFormatPolicies: [{ id: 'codec', status: 'implemented' }],
		runtimeProvenance: [{ id: 'host', status: 'documented' }],
	};
	assert.equal(framescaperNativePolicyRowCleared(
		policy, 'futureDistributionGates', 'native-codecs',
	), true);
	assert.equal(framescaperNativePolicyRowCleared(policy, 'nativeFormatPolicies', 'codec'), true);
	assert.equal(framescaperNativePolicyRowCleared(policy, 'runtimeProvenance', 'host'), true);
	policy.futureDistributionGates[0].status = 'implemented';
	policy.nativeFormatPolicies[0].status = 'enabled';
	policy.runtimeProvenance[0].status = 'implemented';
	assert.equal(framescaperNativePolicyRowCleared(
		policy, 'futureDistributionGates', 'native-codecs',
	), false);
	assert.equal(framescaperNativePolicyRowCleared(policy, 'nativeFormatPolicies', 'codec'), false);
	assert.equal(framescaperNativePolicyRowCleared(policy, 'runtimeProvenance', 'host'), false);
});

test('selected ProRes export opens only after its exact format row and parent gate clear', () => {
	const matrix = {
		futureDistributionGates: [
			{ id: 'native-codecs', status: 'enabled' },
			{ id: 'native-plugins', status: 'disabled' },
		],
		nativeFormatPolicies: [
			{ id: 'codec-native-ffmpeg-current-set', status: 'implemented' },
			{ id: 'codec-encode-prores-mov-proxy', status: 'implemented' },
			{ id: 'codec-encode-prores-mov-422-hq', status: 'implemented' },
			{ id: 'codec-decode-png-image-sequence', status: 'blocked' },
			{ id: 'codec-decode-tiff-image-sequence', status: 'blocked' },
			{ id: 'codec-decode-openexr-image-sequence', status: 'blocked' },
			{ id: 'codec-encode-png-image-sequence', status: 'blocked' },
			{ id: 'codec-encode-tiff-image-sequence', status: 'blocked' },
			{ id: 'codec-encode-openexr-image-sequence', status: 'blocked' },
			{ id: 'plugin-format-ofx', status: 'blocked' },
		],
		runtimeProvenance: [
			{ id: 'framescaper-openfx-1-5-1-source-candidate', status: 'documented' },
		],
	};
	let policy = framescaperNativeCapabilityPolicy(matrix);
	assert.equal(policy.selectedRenderCodecCleared, true);
	assert.equal(framescaperNativeQueueOperationCleared(
		policy, { taskKind: 'encoded-export' },
	), true);

	matrix.nativeFormatPolicies.find(({ id }) => id === 'codec-encode-prores-mov-422-hq').status = 'blocked';
	policy = framescaperNativeCapabilityPolicy(matrix);
	assert.equal(policy.nativeCodecsCleared, true,
		'the authenticated current FFmpeg set remains distinct from a selected export policy');
	assert.equal(policy.selectedRenderCodecCleared, false);
	assert.equal(framescaperNativeQueueOperationCleared(
		policy, { taskKind: 'encoded-export' },
	), false);
});

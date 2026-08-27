/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	framescaperNativeExecutionPolicy,
	framescaperNativeQueueOperationExecutionEnabled,
} from '../desktop/framescaper-native-services-registration.mjs';

test('native execution policy is independent of human licensing review state', () => {
	const policy = framescaperNativeExecutionPolicy();
	assert.deepEqual(policy, {
		nativeCodecsExecutionEnabled: true,
		selectedRenderCodecExecutionEnabled: true,
		proxyCodecExecutionEnabled: true,
		imageSequencesExecutionEnabled: true,
	});
	assert.equal(Object.isFrozen(policy), true);
	for (const taskKind of [
		'encoded-export', 'proxy-generation', 'image-sequence-export',
	]) {
		assert.equal(framescaperNativeQueueOperationExecutionEnabled(policy, { taskKind }), true);
	}
	assert.equal(framescaperNativeQueueOperationExecutionEnabled(policy, {
		taskKind: 'future-operation',
	}), false, 'unknown execution operations remain fail-closed');
});

test('native runtime registration does not read the human production licensing matrix', async () => {
	const source = await readFile(new URL(
		'../desktop/framescaper-native-services-registration.mjs', import.meta.url,
	), 'utf8');
	assert.doesNotMatch(source, /production-licensing-matrix|loadCapabilityPolicy|policyRowCleared/u);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAssistanceOperationRequest } from '../desktop/assistance-operation-contract.ts';

const jobId = 'ab'.repeat(20);
const sha256 = '12'.repeat(32);
const model = Object.freeze({
	modelId: 'kokoro-82m-v1.0', version: '1.0.0', artifactSha256s: [sha256],
});

function request(overrides: Record<string, unknown> = {}) {
	return {
		contractVersion: 1, jobId, operation: 'text-to-speech', selectionFence: null,
		models: [model],
		inputs: [{ claimVersion: 1, claimId: 'cd'.repeat(20), jobId, role: 'text',
			mediaType: 'text/plain', byteLength: 32, sha256 }],
		outputs: [{ claimVersion: 1, claimId: 'ef'.repeat(20), jobId,
			role: 'synthesized-audio', mediaType: 'audio/wav', maximumByteLength: 1024 * 1024 }],
		settings: { settingsVersion: 1, language: 'a', voice: 'af_heart', speed: 1 },
		...overrides,
	};
}

test('text-to-speech is source-free and accepts only its text, audio, and voice contract', () => {
	assert.deepEqual(validateAssistanceOperationRequest(request()), request());
	assert.throws(() => validateAssistanceOperationRequest(request({ selectionFence: {} })),
		/selection fence|source.free/iu);
	assert.throws(() => validateAssistanceOperationRequest(request({ inputs: [{
		...request().inputs[0], role: 'audio', mediaType: 'audio/wav',
	}] })), /input role|text/iu);
	assert.throws(() => validateAssistanceOperationRequest(request({ settings: {
		settingsVersion: 1, language: 'a', voice: 'zf_xiaoxiao', speed: 1,
	} })), /voice|language/iu);
	assert.throws(() => validateAssistanceOperationRequest(request({ settings: {
		settingsVersion: 1, language: 'a', voice: 'af_heart', speed: 3,
	} })), /speed/iu);
});

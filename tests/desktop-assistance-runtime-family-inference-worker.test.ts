/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	runAssistanceRuntimeFamilyInferenceWorkerV1,
} from '../desktop/assistance-runtime-family-inference-worker.ts';

const JOB_ID = '1'.repeat(40);
const SHA = '2'.repeat(64);

function job() {
	return {
		protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000,
		grant: {
			grantVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
			task: 'shot-detection' as const, settingsJson: '{}',
			inputs: [{ claimId: '3'.repeat(40), role: 'video' as const, mediaType: 'video/mp4',
				path: '/private/input', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 1 } }],
			models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
				path: '/private/model', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 2 } }],
			outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries' as const,
				mediaType: 'application/vnd.soundscaper.shot-boundaries+json', path: '/private/output',
				maximumByteLength: 1_024, initialByteLength: 0 as const,
				initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				identity: { dev: 1, ino: 3 } }],
		},
		descriptor: {
			familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: '/runtime/runtime.js',
			files: [{ path: '/runtime/runtime.js', relativePath: 'runtime.js',
				byteLength: 1, sha256: SHA, executable: false }],
		},
	};
}

function result() {
	return { resultVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, outputs: [{ claimId: '4'.repeat(40),
			role: 'shot-boundaries' as const,
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			byteLength: 10, sha256: SHA }] };
}

test('the inference entry emits bounded correlated progress and one terminal result', async () => {
	const messages: unknown[] = [];
	await runAssistanceRuntimeFamilyInferenceWorkerV1({
		job: job(), post: (message) => messages.push(message),
		runJob: async ({ onProgress }) => {
			onProgress?.(0.25); onProgress?.(1); return result();
		},
	});
	assert.deepEqual(messages, [
		{ protocolVersion: 1, type: 'progress', jobId: JOB_ID,
			familyId: 'onnxruntime-node', task: 'shot-detection', sequence: 0, value: 0.25 },
		{ protocolVersion: 1, type: 'progress', jobId: JOB_ID,
			familyId: 'onnxruntime-node', task: 'shot-detection', sequence: 1, value: 1 },
		{ protocolVersion: 1, type: 'result', jobId: JOB_ID,
			familyId: 'onnxruntime-node', task: 'shot-detection', result: result() },
	]);
});

test('adapter failures become a strict typed error without exposing paths or a stack', async () => {
	const messages: unknown[] = [];
	const error = new Error(`/private/input ${'x'.repeat(4_000)}`) as Error & { code?: string };
	error.name = 'AdapterError'; error.code = 'ADAPTER_UNAVAILABLE';
	await runAssistanceRuntimeFamilyInferenceWorkerV1({
		job: job(), post: (message) => messages.push(message),
		runJob: async () => { throw error; },
	});
	assert.equal(messages.length, 1);
	const message = messages[0] as { error: { message: string; code: string }; stack?: string };
	assert.equal(message.error.code, 'ADAPTER_UNAVAILABLE');
	assert.ok(Buffer.byteLength(message.error.message) <= 2_048);
	assert.equal(message.error.message.includes('/private/input'), false);
	assert.equal('stack' in message, false);
});

test('foreign descriptor identity fails closed before invoking any runner', async () => {
	let invoked = false;
	await assert.rejects(runAssistanceRuntimeFamilyInferenceWorkerV1({
		job: { ...job(), descriptor: { ...job().descriptor, familyId: 'whisper-cpp' } },
		post: () => undefined,
		runJob: async () => { invoked = true; return result(); },
	}), /descriptor|foreign|family/iu);
	assert.equal(invoked, false);
});

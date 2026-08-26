/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	validateAssistanceRuntimeFamilyDescriptorV1,
	validateAssistanceRuntimeFamilyHostMessageV1,
	validateAssistanceRuntimeFamilyProcessMessageV1,
} from '../desktop/assistance-runtime-family-process-protocol.ts';
import {
	ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
} from '../desktop/assistance-runtime-family-job-contract.ts';

const JOB_ID = '1'.repeat(40);
const SHA = '2'.repeat(64);

function descriptor() {
	return {
		familyId: 'onnxruntime-node', runtimeVersion: '1.29.0', target: 'linux-x64',
		executionProvider: 'cpu', entrypoint: '/runtime/onnx/runtime.js',
		files: [{
			path: '/runtime/onnx/runtime.js', relativePath: 'runtime.js',
			byteLength: 20, sha256: SHA, executable: false,
		}],
	};
}

function grant() {
	return {
		grantVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection',
		settingsJson: '{}',
		inputs: [{ claimId: '3'.repeat(40), role: 'video', mediaType: 'video/mp4',
			path: '/private/input', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 1 } }],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: '/private/model', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 2 } }],
		outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json', path: '/private/output',
			maximumByteLength: 1_024, initialByteLength: 0,
			initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			identity: { dev: 1, ino: 3 } }],
	};
}

function request() {
	return {
		protocolVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection',
		maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000, grant: grant(),
	};
}

test('descriptor messages bind the exact authenticated CPU closure before readiness', () => {
	assert.deepEqual(validateAssistanceRuntimeFamilyDescriptorV1(descriptor()), descriptor());
	assert.deepEqual(validateAssistanceRuntimeFamilyHostMessageV1({
		protocolVersion: ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
		type: 'initialize', descriptor: descriptor(),
	}), {
		protocolVersion: 1, type: 'initialize', descriptor: descriptor(),
	});
	assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({
		...descriptor(), executionProvider: 'cuda',
	}), /CPU|descriptor/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({
		...descriptor(), files: [{ ...descriptor().files[0], path: '/runtime/other' }],
	}), /entrypoint|closure/iu);
});

test('host messages are a closed initialize, job, terminate-worker, and shutdown vocabulary', () => {
	for (const message of [
		{ protocolVersion: 1, type: 'job', request: request() },
		{ protocolVersion: 1, type: 'terminate-worker', jobId: JOB_ID },
		{ protocolVersion: 1, type: 'shutdown' },
	]) assert.deepEqual(validateAssistanceRuntimeFamilyHostMessageV1(message), message);
	assert.throws(() => validateAssistanceRuntimeFamilyHostMessageV1({
		protocolVersion: 1, type: 'job', request: request(), shell: '/bin/sh',
	}), /field|message/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyHostMessageV1({
		protocolVersion: 1, type: 'cancel', jobId: JOB_ID,
	}), /type/iu);
});

test('process progress and terminal messages are bounded and correlate the active request', () => {
	const active = request();
	const messages = [
		{ protocolVersion: 1, type: 'ready', familyId: 'onnxruntime-node', runtimeVersion: '1.29.0' },
		{ protocolVersion: 1, type: 'progress', jobId: JOB_ID, familyId: 'onnxruntime-node',
			task: 'shot-detection', sequence: 0, value: 0.5 },
		{ protocolVersion: 1, type: 'worker-terminated', jobId: JOB_ID,
			familyId: 'onnxruntime-node', task: 'shot-detection' },
		{ protocolVersion: 1, type: 'error', jobId: JOB_ID, familyId: 'onnxruntime-node',
			task: 'shot-detection', error: { name: 'Error', message: 'adapter unavailable', code: 'ADAPTER_UNAVAILABLE' } },
		{ protocolVersion: 1, type: 'result', jobId: JOB_ID, familyId: 'onnxruntime-node',
			task: 'shot-detection', result: { resultVersion: 1, jobId: JOB_ID,
				familyId: 'onnxruntime-node', task: 'shot-detection', outputs: [{
					claimId: '4'.repeat(40), role: 'shot-boundaries',
					mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
					byteLength: 10, sha256: SHA,
				}] } },
	];
	assert.deepEqual(validateAssistanceRuntimeFamilyProcessMessageV1(messages[0]), messages[0]);
	for (const message of messages.slice(1)) {
		assert.deepEqual(validateAssistanceRuntimeFamilyProcessMessageV1(message, active), message);
	}
	assert.throws(() => validateAssistanceRuntimeFamilyProcessMessageV1({
		...messages[1], value: Number.NaN,
	}, active), /finite|progress|wire/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyProcessMessageV1({
		...messages[1], jobId: '9'.repeat(40),
	}, active), /correlate|job/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyProcessMessageV1({
		...messages[3], error: { name: 'Error', message: 'x'.repeat(3_000), code: 'NO' },
	}, active), /bounded|error/iu);
});

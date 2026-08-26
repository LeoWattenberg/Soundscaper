/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
	validateAssistanceRuntimeFamilyJobGrantV1,
	validateAssistanceRuntimeFamilyJobRequestV1,
	validateAssistanceRuntimeFamilyJobResultV1,
} from '../desktop/assistance-runtime-family-job-contract.ts';

const JOB_ID = 'a'.repeat(40);
const INPUT_ID = 'b'.repeat(40);
const OUTPUT_ID = 'c'.repeat(40);
const SHA = 'd'.repeat(64);

function grant() {
	return {
		grantVersion: 1,
		jobId: JOB_ID,
		familyId: 'onnxruntime-node',
		task: 'shot-detection',
		settingsJson: '{}',
		inputs: [{
			claimId: INPUT_ID, role: 'video', mediaType: 'video/mp4',
			path: '/private/input.mp4', byteLength: 123, sha256: SHA,
			identity: { dev: 1, ino: 2 },
		}],
		models: [{
			modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: '/models/transnetv2.onnx', byteLength: 456, sha256: SHA,
			identity: { dev: 1, ino: 3 },
		}],
		outputs: [{
			claimId: OUTPUT_ID, role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			path: '/private/output.json', maximumByteLength: 1_024,
			initialByteLength: 0,
			initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			identity: { dev: 1, ino: 4 },
		}],
	};
}

function request() {
	return {
		protocolVersion: ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
		jobId: JOB_ID,
		familyId: 'onnxruntime-node',
		task: 'shot-detection',
		maximumRssBytes: 1024 ** 3,
		maximumDurationMs: 60_000,
		grant: grant(),
	};
}

test('one generic grant binds exact staged inputs, models, outputs, settings, family, and task', () => {
	const admitted = validateAssistanceRuntimeFamilyJobGrantV1(grant());
	assert.equal(admitted.familyId, 'onnxruntime-node');
	assert.equal(admitted.task, 'shot-detection');
	assert.equal(admitted.inputs[0]!.path, '/private/input.mp4');
	assert.equal(admitted.models[0]!.modelId, 'transnetv2');
	assert.equal(admitted.outputs[0]!.initialByteLength, 0);
	assert.deepEqual(validateAssistanceRuntimeFamilyJobRequestV1(request()), request());
});

test('grant admission rejects foreign tasks, unknown fields, aliases, unsafe paths, and unauthenticated output files', () => {
	const cases = [
		{ ...grant(), task: 'speech-recognition' },
		{ ...grant(), extra: true },
		{ ...grant(), settingsJson: '{ "not": "canonical" }' },
		{ ...grant(), inputs: [{ ...grant().inputs[0], path: '../escape' }] },
		{ ...grant(), inputs: [{ ...grant().inputs[0], sha256: '0'.repeat(63) }] },
		{ ...grant(), outputs: [{ ...grant().outputs[0], initialByteLength: 1 }] },
		{ ...grant(), outputs: [{ ...grant().outputs[0], identity: { dev: 1, ino: 2 } }] },
		{ ...grant(), models: [] },
	];
	for (const candidate of cases) {
		assert.throws(() => validateAssistanceRuntimeFamilyJobGrantV1(candidate),
			/grant|task|field|settings|path|digest|output|identity|model/iu);
	}
});

test('job requests correlate their generic grant and preserve closed family task routing', () => {
	assert.throws(() => validateAssistanceRuntimeFamilyJobRequestV1({
		...request(), familyId: 'whisper-cpp', task: 'speech-recognition',
	}), /correlate|family|grant/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyJobRequestV1({
		...request(), task: 'editorial-generation',
	}), /task/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyJobRequestV1({
		...request(), maximumRssBytes: Number.NaN,
	}), /resource|finite|wire/iu);
});

test('results satisfy each reserved output once without returning filesystem paths', () => {
	const result = {
		resultVersion: 1,
		jobId: JOB_ID,
		familyId: 'onnxruntime-node',
		task: 'shot-detection',
		outputs: [{
			claimId: OUTPUT_ID, role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			byteLength: 200, sha256: SHA,
		}],
	};
	assert.deepEqual(validateAssistanceRuntimeFamilyJobResultV1(result, grant()), result);
	assert.equal(JSON.stringify(result).includes('/private/'), false);
	assert.throws(() => validateAssistanceRuntimeFamilyJobResultV1({
		...result, outputs: [{ ...result.outputs[0], byteLength: 2_048 }],
	}, grant()), /reservation|maximum/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyJobResultV1({
		...result, outputs: [],
	}, grant()), /output/iu);
});

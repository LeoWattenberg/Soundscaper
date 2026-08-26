/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createAssistanceRuntimeFamilyOperationAdapter,
	runtimeFamilyForAssistanceTask,
} from '../desktop/assistance-runtime-family-operation-adapter.ts';
import { AssistanceRuntimeFamilyError } from '../desktop/assistance-runtime-family-host.ts';
import {
	validateAssistanceRuntimeFamilyJobRequestV1,
	type AssistanceRuntimeFamilyJobRequestV1,
} from '../desktop/assistance-runtime-family-job-contract.ts';

const JOB_ID = '12'.repeat(20);
const INPUT_ID = '34'.repeat(20);
const OUTPUT_ID = '56'.repeat(20);

async function files(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-family-operation-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const inputPath = join(root, 'input.bin');
	const modelPath = join(root, 'model.onnx');
	const outputPath = join(root, 'output.json');
	await writeFile(inputPath, 'input');
	await writeFile(modelPath, 'model');
	await (await open(outputPath, 'w')).close();
	return { inputPath, modelPath, outputPath };
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

test('runtime-family task routing is closed over the three isolated CPU families', () => {
	assert.equal(runtimeFamilyForAssistanceTask('shot-detection'), 'onnxruntime-node');
	assert.equal(runtimeFamilyForAssistanceTask('speech-recognition'), 'whisper-cpp');
	assert.equal(runtimeFamilyForAssistanceTask('editorial-generation'), 'llama-cpp');
	assert.equal(runtimeFamilyForAssistanceTask('text-embedding'), 'onnxruntime-node',
		'the retained nomic ONNX model must not be sent to the Qwen-only llama runtime');
	assert.equal(runtimeFamilyForAssistanceTask('subject-detection'), 'onnxruntime-node');
	assert.throws(() => runtimeFamilyForAssistanceTask('face-detection'), /task|family/iu);
	assert.throws(() => runtimeFamilyForAssistanceTask('object-detection'), /task|family/iu);
	assert.throws(() => runtimeFamilyForAssistanceTask('voice-activity-detection'),
		/task|family|unsupported/iu);
});

test('operation adapter captures exact files, runs one family, and returns pathless claims', async (t) => {
	const paths = await files(t);
	const admitted: AssistanceRuntimeFamilyJobRequestV1[] = [];
	const adapter = createAssistanceRuntimeFamilyOperationAdapter({
		router: {
			run: async (value, options) => {
				admitted.push(validateAssistanceRuntimeFamilyJobRequestV1(value));
				options?.onProgress?.(0.5);
				await writeFile(paths.outputPath, '{"ok":true}');
				return {
					resultVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node',
					task: 'shot-detection', outputs: [{
						claimId: OUTPUT_ID, role: 'shot-boundaries', mediaType: 'application/json',
						byteLength: 11, sha256: digest('{"ok":true}'),
					}],
				};
			},
		},
	});
	const progress: number[] = [];
	const outcome = await adapter.run({
		jobId: JOB_ID,
		task: 'shot-detection',
		settings: { schemaVersion: 1, detector: 'transnetv2' },
		maximumRssBytes: 2 * 1024 ** 3,
		maximumDurationMs: 60_000,
		inputs: [{
			claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID, role: 'video',
				mediaType: 'video/mp4', byteLength: 5, sha256: digest('input') },
			path: paths.inputPath,
		}],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: paths.modelPath, byteLength: 5, sha256: digest('model') }],
		outputs: [{
			reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
				role: 'shot-boundaries', mediaType: 'application/json', maximumByteLength: 1_024 },
			path: paths.outputPath,
		}],
		onProgress: (value) => progress.push(value),
	});
	assert.deepEqual(progress, [0.5]);
	assert.equal(admitted[0]?.familyId, 'onnxruntime-node');
	assert.equal(admitted[0]?.grant.settingsJson,
		'{"detector":"transnetv2","schemaVersion":1}');
	assert.match(admitted[0]?.grant.inputs[0]?.path ?? '', /assistance-family-operation/u);
	assert.deepEqual(outcome, {
		outcome: 'completed',
		outputs: [{ claimId: OUTPUT_ID, role: 'shot-boundaries', mediaType: 'application/json',
			byteLength: 11, sha256: digest('{"ok":true}') }],
	});
	assert.doesNotMatch(JSON.stringify(outcome), /assistance-family-operation|model\.onnx/u);
});

test('operation adapter preserves cancellation and maps typed payload/adapter unavailability', async (t) => {
	const paths = await files(t);
	const request = {
		jobId: JOB_ID, task: 'shot-detection' as const, settings: { schemaVersion: 1 },
		maximumRssBytes: 1024, maximumDurationMs: 1000,
		inputs: [{ claim: { claimVersion: 1 as const, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'video' as const, mediaType: 'video/mp4', byteLength: 5, sha256: digest('input') },
			path: paths.inputPath }],
		models: [{ modelId: 'transnetv2', version: '1', artifactRole: 'network',
			path: paths.modelPath, byteLength: 5, sha256: digest('model') }],
		outputs: [{ reservation: { claimVersion: 1 as const, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'shot-boundaries' as const, mediaType: 'application/json', maximumByteLength: 10 },
			path: paths.outputPath }],
	};
	const unavailable = createAssistanceRuntimeFamilyOperationAdapter({ router: {
		run: async () => { throw new AssistanceRuntimeFamilyError('payload-missing',
			'onnxruntime-node', 'missing', JOB_ID); },
	} });
	assert.deepEqual(await unavailable.run(request), {
		outcome: 'unavailable', reason: 'runtime-unavailable',
	});
	const noAdapter = createAssistanceRuntimeFamilyOperationAdapter({ router: {
		run: async () => { throw new AssistanceRuntimeFamilyError('worker-error',
			'onnxruntime-node', 'No reviewed model adapter is mounted.', JOB_ID); },
	} });
	assert.deepEqual(await noAdapter.run(request), {
		outcome: 'unavailable', reason: 'adapter-unavailable',
	});
	const controller = new AbortController();
	controller.abort(new DOMException('stop', 'AbortError'));
	await assert.rejects(unavailable.run({ ...request, signal: controller.signal }), /stop|abort/iu);
});

test('operation adapter rejects non-canonical settings before granting filesystem paths', async () => {
	let called = false;
	const adapter = createAssistanceRuntimeFamilyOperationAdapter({ router: {
		run: async () => { called = true; return null; },
	} });
	await assert.rejects(adapter.run({
		jobId: JOB_ID, task: 'shot-detection', settings: { value: Number.NaN },
		maximumRssBytes: 1, maximumDurationMs: 1,
		inputs: [], models: [], outputs: [],
	}), /settings|finite|files/iu);
	assert.equal(called, false);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from '../desktop/assistance-runtime-family-worker-entry.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);
const SHA = '4'.repeat(64);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-family-worker-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'input.mp4');
	const model = join(root, 'model.onnx');
	const output = join(root, 'output.json');
	const inputBytes = Buffer.from('video');
	const modelBytes = Buffer.from('model');
	await mkdir(join(root, 'runtime'));
	await Promise.all([
		writeFile(input, inputBytes), writeFile(model, modelBytes), writeFile(output, new Uint8Array()),
	]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection', settingsJson: '{}',
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'video', mediaType: 'video/mp4', byteLength: inputBytes.byteLength,
			sha256: digest(inputBytes) }, path: input }],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: model, byteLength: modelBytes.byteLength, sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'shot-boundaries', mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			maximumByteLength: 1_024 }, path: output }],
	});
	const descriptor = {
		familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
		executionProvider: 'cpu' as const, entrypoint: join(root, 'runtime', 'runtime.js'),
		files: [{ path: join(root, 'runtime', 'runtime.js'), relativePath: 'runtime.js',
			byteLength: 1, sha256: SHA, executable: false }],
	};
	const job = {
		protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, maximumRssBytes: 1024 ** 3,
		maximumDurationMs: 60_000, grant, descriptor,
	};
	return { job, paths: { input, model, output } };
}

test('the worker seam reauthenticates every grant, bounds progress, and authenticates output results', async (context) => {
	const { job, paths } = await fixture(context);
	const progress: number[] = [];
	const body = Buffer.from('{"boundaries":[]}');
	const result = await runAssistanceRuntimeFamilyWorkerJobV1({
		job,
		onProgress: (value) => progress.push(value),
		execute: async ({ grant, onProgress }) => {
			assert.equal(grant.inputs[0]!.path, paths.input);
			onProgress(0.25);
			await writeFile(paths.output, body);
			return {
				resultVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection',
				outputs: [{ claimId: OUTPUT_ID, role: 'shot-boundaries',
					mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
					byteLength: body.byteLength, sha256: digest(body) }],
			};
		},
	});
	assert.equal(result.outputs[0]!.sha256, digest(body));
	assert.deepEqual(progress, [0.25]);
});

test('worker execution never starts after a model grant changes', async (context) => {
	const { job, paths } = await fixture(context);
	await writeFile(paths.model, Buffer.from('other'));
	let executions = 0;
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job,
		execute: async () => { executions += 1; throw new Error('must not run'); },
	}), /model|digest/iu);
	assert.equal(executions, 0);
});

test('worker execution refuses invalid progress and result claims even from an injected adapter', async (context) => {
	const { job, paths } = await fixture(context);
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job,
		execute: async ({ onProgress }) => { onProgress(Number.NaN); throw new Error('unreachable'); },
	}), /progress|finite/iu);

	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job,
		execute: async () => {
			const body = Buffer.from('{}');
			await writeFile(paths.output, body);
			return { resultVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node',
				task: 'shot-detection', outputs: [{ claimId: OUTPUT_ID, role: 'shot-boundaries',
					mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
					byteLength: body.byteLength, sha256: '0'.repeat(64) }] };
		},
	}), /digest|output/iu);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	authenticateAssistanceRuntimeFamilyJobGrantFilesV1,
	authenticateAssistanceRuntimeFamilyJobResultFilesV1,
	captureAssistanceRuntimeFamilyJobGrantV1,
} from '../desktop/assistance-runtime-family-file-grants.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);
const INPUT = Buffer.from('selected video bytes');
const MODEL = Buffer.from('authenticated model bytes');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-family-grant-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const privateRoot = join(root, 'private');
	await mkdir(privateRoot, { mode: 0o700 });
	const paths = {
		input: join(privateRoot, 'input.mp4'),
		model: join(privateRoot, 'model.onnx'),
		output: join(privateRoot, 'output.json'),
	};
	await Promise.all([
		writeFile(paths.input, INPUT, { mode: 0o600 }),
		writeFile(paths.model, MODEL, { mode: 0o600 }),
		writeFile(paths.output, new Uint8Array(), { mode: 0o600 }),
	]);
	return paths;
}

function capture(paths: Awaited<ReturnType<typeof fixture>>) {
	return captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection', settingsJson: '{}',
		inputs: [{
			claim: {
				claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
				role: 'video', mediaType: 'video/mp4',
				byteLength: INPUT.byteLength, sha256: digest(INPUT),
			},
			path: paths.input,
		}],
		models: [{
			modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: paths.model, byteLength: MODEL.byteLength, sha256: digest(MODEL),
		}],
		outputs: [{
			reservation: {
				claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
				role: 'shot-boundaries',
				mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
				maximumByteLength: 4_096,
			},
			path: paths.output,
		}],
	});
}

test('main captures and the worker re-authenticates exact regular input, model, and output grants', async (context) => {
	const paths = await fixture(context);
	const grant = await capture(paths);
	assert.equal(grant.inputs[0]!.path, paths.input);
	assert.equal(grant.models[0]!.sha256, digest(MODEL));
	assert.equal(grant.outputs[0]!.initialByteLength, 0);
	assert.notEqual(grant.inputs[0]!.identity.ino, grant.outputs[0]!.identity.ino);
	assert.deepEqual(await authenticateAssistanceRuntimeFamilyJobGrantFilesV1(grant), grant);
});

test('worker authentication refuses changed input bytes and a populated reserved output', async (context) => {
	const paths = await fixture(context);
	const grant = await capture(paths);
	await writeFile(paths.input, Buffer.from('changed video bytes!'));
	await assert.rejects(authenticateAssistanceRuntimeFamilyJobGrantFilesV1(grant), /input|digest|length/iu);

	await writeFile(paths.input, INPUT);
	await writeFile(paths.output, Buffer.from('unreviewed'));
	await assert.rejects(authenticateAssistanceRuntimeFamilyJobGrantFilesV1(grant), /output|empty|length/iu);
});

test('worker results are rebound to the exact output file identity, bytes, and digest', async (context) => {
	const paths = await fixture(context);
	const grant = await capture(paths);
	const body = Buffer.from('{"boundaries":[]}');
	await writeFile(paths.output, body);
	const result = {
		resultVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection',
		outputs: [{
			claimId: OUTPUT_ID, role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			byteLength: body.byteLength, sha256: digest(body),
		}],
	};
	assert.deepEqual(await authenticateAssistanceRuntimeFamilyJobResultFilesV1(
		grant, result,
	), result);
	await assert.rejects(authenticateAssistanceRuntimeFamilyJobResultFilesV1(grant, {
		...result, outputs: [{ ...result.outputs[0], sha256: '0'.repeat(64) }],
	}), /digest|output/iu);
});

test('capture refuses mismatched model evidence and symbolic staged files', async (context) => {
	const paths = await fixture(context);
	await assert.rejects(captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection', settingsJson: '{}',
		inputs: [], outputs: [],
		models: [{
			modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: paths.model, byteLength: MODEL.byteLength, sha256: '0'.repeat(64),
		}],
	}), /model|digest/iu);

	const link = join(paths.input, '..', 'input-link.mp4');
	await symlink(paths.input, link);
	await assert.rejects(captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection', settingsJson: '{}',
		inputs: [{
			claim: {
				claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID, role: 'video', mediaType: 'video/mp4',
				byteLength: INPUT.byteLength, sha256: digest(INPUT),
			},
			path: link,
		}],
		models: [], outputs: [],
	}), /symbolic|canonical|regular/iu);
});

test('grant capture observes cancellation while reading private files', async () => {
	const controller = new AbortController();
	controller.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection', settingsJson: '{}',
		inputs: [], models: [], outputs: [], signal: controller.signal,
	}), (error: Error) => error.name === 'AbortError');
});

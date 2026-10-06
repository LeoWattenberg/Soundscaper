/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyInferenceWorkerV1 } from '../desktop/assistance-runtime-family-inference-worker.ts';
import { createAssistanceOnnxSessionLeaseCacheV1, publishAssistanceOnnxOutputV1 } from '../desktop/assistance-onnx-worker-common.ts';
import type { AssistanceOnnxRuntimeModuleV1, AssistanceOnnxTensorV1 } from '../desktop/assistance-onnx-runtime-worker.ts';

const JOB_ID = '1'.repeat(40), INPUT_ID = '2'.repeat(40), OUTPUT_ID = '3'.repeat(40);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const CPU = { executionProviders: ['cpu'] as const, graphOptimizationLevel: 'all' as const, interOpNumThreads: 1 as const, intraOpNumThreads: 4 as const };

for (const tamper of ['none', 'model', 'runtime', 'output-result'] as const) test(`resident ONNX reauthenticates ${tamper} bytes on every job and retires after any failed authentication`, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-resident-auth-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = { input: join(root, 'input.mp4'), model: join(root, 'model.onnx'), output: join(root, 'output.json'), runtime: join(root, 'runtime.js') };
	const bytes = { input: Buffer.from('video'), model: Buffer.from('model'), runtime: Buffer.from('runtime') };
	await Promise.all([writeFile(paths.input, bytes.input), writeFile(paths.model, bytes.model), writeFile(paths.runtime, bytes.runtime), writeFile(paths.output, new Uint8Array())]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection', settingsJson: '{}',
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'video', mediaType: 'video/mp4', byteLength: bytes.input.byteLength, sha256: digest(bytes.input) }, path: paths.input }],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: paths.model, byteLength: bytes.model.byteLength, sha256: digest(bytes.model) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'shot-boundaries', mediaType: 'application/vnd.soundscaper.shot-boundaries+json', maximumByteLength: 1_024 }, path: paths.output }],
	});
	const job = { protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000, grant,
		descriptor: { familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: paths.runtime,
			files: [{ path: paths.runtime, relativePath: 'runtime.js', byteLength: bytes.runtime.byteLength, sha256: digest(bytes.runtime), executable: false }] },
	};
	let creates = 0, releases = 0, executions = 0;
	class Tensor implements AssistanceOnnxTensorV1 {
		constructor(readonly type: 'uint8' | 'float32' | 'int64', readonly data: Uint8Array | Float32Array | BigInt64Array, readonly dims: readonly number[]) {}
	}
	const runtime: AssistanceOnnxRuntimeModuleV1 = { Tensor, InferenceSession: { async create() {
		creates += 1; return { inputNames: ['input'], outputNames: ['output'], async run() { return {}; }, release() { releases += 1; } };
	} } };
	const cache = createAssistanceOnnxSessionLeaseCacheV1({ getRssBytes: () => 64 * 1024 ** 2 });
	t.after(async () => { await cache.dispose(); });
	const messages: { type: string }[] = [];
	for (let attempt = 0; attempt < 2; attempt += 1) {
		await writeFile(paths.output, new Uint8Array());
		if (attempt === 1 && tamper === 'model') await writeFile(paths.model, Buffer.from('other'));
		if (attempt === 1 && tamper === 'runtime') await writeFile(paths.runtime, Buffer.from('changed'));
		await runAssistanceRuntimeFamilyInferenceWorkerV1({ job, sessionCache: cache,
			post: (message) => { assert.ok(message && typeof message === 'object' && 'type' in message && typeof message.type === 'string'); messages.push({ type: message.type }); },
			execute: async (context) => cache.runAuthenticated(context, async () => {
				executions += 1;
				const session = await cache.wrapRuntime(runtime).InferenceSession.create(paths.model, CPU);
				try { await session.run({}); } finally { await session.release?.(); }
				const result = await publishAssistanceOnnxOutputV1(context, Buffer.from('{"boundaries":[]}'), 'Output exceeds capacity.');
				return attempt === 1 && tamper === 'output-result'
					? { ...result, outputs: result.outputs.map((output) => ({ ...output, sha256: '0'.repeat(64) })) } : result;
			}),
		});
	}
	assert.equal(creates, 1, 'fresh authentication may reuse model math, never skip byte checks');
	assert.equal(executions, tamper === 'model' || tamper === 'runtime' ? 1 : 2);
	assert.equal(messages.at(-1)?.type, tamper === 'none' ? 'result' : 'error');
	assert.equal(cache.idleSessionCount, tamper === 'none' ? 1 : 0);
	assert.equal(releases, tamper === 'none' ? 0 : 1);
});

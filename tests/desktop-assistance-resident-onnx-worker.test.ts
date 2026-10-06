/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { createAssistanceRuntimeFamilyThreadWorkerSpawner } from '../desktop/assistance-runtime-family-thread-worker.ts';
import { createAssistanceFramePackV1 } from '../src/common/editor/assistance/binary-formats-v1.ts';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

test('the real resident worker authenticates fresh jobs, reuses model math and retires after tampering', { timeout: 15_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-resident-worker-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'input.pack'), model = join(root, 'model.onnx'), trace = join(root, 'trace.txt'), entrypoint = join(root, 'runtime.mjs');
	const inputBytes = Buffer.concat(createAssistanceFramePackV1({ width: 48, height: 27, timescale: 1_000,
		frames: [{ sourceFrame: 0, presentationTick: '0', rgba: new Uint8Array(48 * 27 * 4) }] }));
	const modelBytes = Buffer.from('model');
	const runtimeSource = `import { appendFile } from 'node:fs/promises';
export class Tensor { constructor(type, data, dims) { Object.assign(this, {type, data, dims}); } }
export const InferenceSession = { async create() {
 await appendFile(${JSON.stringify(trace)}, 'create\\n');
 return { inputNames: ['frames'], outputNames: ['single_frame_logits','all_frame_logits'],
  async run() { const logits = new Float32Array(100).fill(-20); return {
   single_frame_logits: new Tensor('float32', logits, [1,100,1]), all_frame_logits: new Tensor('float32', logits, [1,100,1]) }; },
  async release() { await appendFile(${JSON.stringify(trace)}, 'release\\n'); } };
} };`;
	await Promise.all([writeFile(input, inputBytes), writeFile(model, modelBytes), writeFile(entrypoint, runtimeSource)]);
	const descriptor = { familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
		executionProvider: 'cpu' as const, entrypoint,
		files: [{ path: entrypoint, relativePath: 'runtime.mjs', byteLength: Buffer.byteLength(runtimeSource), sha256: hash(runtimeSource), executable: false }] };
	const spawn = createAssistanceRuntimeFamilyThreadWorkerSpawner({ residentOnnx: true,
		workerEntry: new URL('../desktop/assistance-runtime-family-inference-worker.ts', import.meta.url) });
	for (let index = 0; index < 3; index += 1) {
		const jobId = String(index + 1).repeat(40), output = join(root, `output${String(index)}.json`);
		await writeFile(output, new Uint8Array());
		const grant = await captureAssistanceRuntimeFamilyJobGrantV1({ jobId, familyId: 'onnxruntime-node', task: 'shot-detection',
			settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'shot-detection', inputRoles: ['frame-pack'], outputRoles: ['shot-boundaries'] }),
			inputs: [{ claim: { claimVersion: 1, claimId: '4'.repeat(40), jobId, role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack',
				byteLength: inputBytes.byteLength, sha256: hash(inputBytes) }, path: input }],
			models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network', path: model, byteLength: modelBytes.byteLength, sha256: hash(modelBytes) }],
			outputs: [{ reservation: { claimVersion: 1, claimId: '5'.repeat(40), jobId, role: 'shot-boundaries',
				mediaType: 'application/vnd.soundscaper.shot-boundaries+json', maximumByteLength: 64 * 1024 }, path: output }],
		});
		if (index === 2) await writeFile(model, Buffer.from('other'));
		const worker = spawn({ protocolVersion: 1, jobId, familyId: 'onnxruntime-node', task: 'shot-detection',
			maximumRssBytes: 2 * 1024 ** 3, maximumDurationMs: 10_000, descriptor, grant }, { onProgress() {} });
		t.after(async () => { await worker.terminate(); });
		if (index === 2) await assert.rejects(worker.completion, /model|digest|authenticated/iu);
		else {
			await worker.completion;
			assert.equal((await readFile(trace, 'utf8')).trim(), 'create', 'worker and native model survive the first completed request');
			assert.ok((await readFile(output)).byteLength > 0);
		}
	}
	assert.deepEqual((await readFile(trace, 'utf8')).trim().split('\n'), ['create', 'release']);
});

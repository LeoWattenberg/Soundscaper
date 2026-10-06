/* SPDX-License-Identifier: AGPL-3.0-only */

/** Synthetic native ONNX helper probe; does not measure production model or Electron UI latency. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createAssistanceOnnxSessionLeaseCacheV1 } from '../../desktop/assistance-onnx-worker-common.ts';

const runtimeEntry = process.argv[2];
if (!runtimeEntry) throw new Error('Pass the extracted pinned ONNX runtime entrypoint path. Run with node --import tsx.');
const runtime = await import(pathToFileURL(resolve(runtimeEntry)).href);
const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-onnx-probe-'));
const modelPath = join(root, 'matmul.onnx');
const dimensions = 768;
const weight = Float32Array.from({ length: dimensions ** 2 }, (_, index) => (index % 17 - 8) / dimensions);
const input = Float32Array.from({ length: dimensions ** 2 }, (_, index) => (index % 11 - 5) / 5);
const model = syntheticMatMulModel(dimensions, weight);
await writeFile(modelPath, model);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runtimeBytes = await readFile(runtimeEntry);
const cpu = { executionProviders: ['cpu'], graphOptimizationLevel: 'all', interOpNumThreads: 1, intraOpNumThreads: 4 };
const grant = { grantVersion: 1, jobId: '1'.repeat(40), familyId: 'onnxruntime-node', task: 'shot-detection',
	settingsJson: '{}', inputs: [], outputs: [], models: [{ modelId: 'synthetic-matmul', version: '1.0.0',
		artifactRole: 'network', path: modelPath, byteLength: model.byteLength, sha256: hash(model), identity: { dev: '1', ino: '2' } }] };
const context = { grant, settings: {}, onProgress() {}, job: { protocolVersion: 1, jobId: grant.jobId,
	familyId: grant.familyId, task: grant.task, grant, maximumRssBytes: 2 * 1024 ** 3, maximumDurationMs: 60_000,
	descriptor: { familyId: grant.familyId, runtimeVersion: '1.29.0', target: 'linux-x64', executionProvider: 'cpu',
		entrypoint: resolve(runtimeEntry), files: [{ path: resolve(runtimeEntry), relativePath: 'index.js',
			byteLength: runtimeBytes.byteLength, sha256: hash(runtimeBytes), executable: false }] } } };
const feeds = { input: new runtime.Tensor('float32', input, [dimensions, dimensions]) };
const cache = createAssistanceOnnxSessionLeaseCacheV1();
try {
	let expected;
	const cold = [], warm = [];
	for (let round = 0; round < 9; round += 1) {
		let began = performance.now();
		const direct = await runtime.InferenceSession.create(modelPath, cpu);
		try {
			const output = await direct.run(feeds);
			expected ??= new Uint32Array(output.output.data.buffer, output.output.data.byteOffset, output.output.data.length).slice();
			assert.deepEqual(new Uint32Array(output.output.data.buffer, output.output.data.byteOffset, output.output.data.length), expected);
		} finally { await direct.release(); }
		cold.push(performance.now() - began);
		began = performance.now();
		await cache.runAuthenticated(context, async () => {
			assert.equal(hash(await readFile(modelPath)), grant.models[0].sha256, 'fresh model bytes each admission');
			const lease = await cache.wrapRuntime(runtime).InferenceSession.create(modelPath, cpu);
			try {
				const output = await lease.run(feeds);
				assert.deepEqual(new Uint32Array(output.output.data.buffer, output.output.data.byteOffset, output.output.data.length), expected);
			} finally { await lease.release(); }
		});
		warm.push(performance.now() - began);
	}
	const threadRuns = [];
	for (const threads of [1, 2, 4]) {
		const session = await runtime.InferenceSession.create(modelPath, { ...cpu, intraOpNumThreads: threads });
		const runs = [];
		try {
			for (let round = 0; round < 9; round += 1) {
				const began = performance.now();
				const output = await session.run(feeds);
				assert.deepEqual(new Uint32Array(output.output.data.buffer, output.output.data.byteOffset, output.output.data.length), expected);
				runs.push(performance.now() - began);
			}
		} finally { await session.release(); }
		threadRuns.push({ threads, medianMs: median(runs.slice(2)), samplesMs: runs });
	}
	process.stdout.write(`${JSON.stringify({ node: process.version, model: 'synthetic 4-layer 768x768 MatMul', modelBytes: model.byteLength,
		modelSha256: hash(model), runtimeEntrySha256: hash(runtimeBytes), exactFloatBits: true, warmupSamples: 2,
		freshNativeSessionMedianMs: median(cold.slice(2)), residentNativeSessionMedianMs: median(warm.slice(2)),
		freshSamplesMs: cold, residentSamplesMs: warm, idleNativeSessions: cache.idleSessionCount, processRssBytes: process.memoryUsage().rss,
		threadRuns }, null, 2)}\n`);
} finally { await cache.dispose(); await rm(root, { recursive: true, force: true }); }

function median(values) { return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)]; }
function varint(value) {
	const result = [];
	do { let byte = value % 128; value = Math.floor(value / 128); if (value) byte |= 128; result.push(byte); } while (value);
	return Buffer.from(result);
}
function scalar(field, value) { return Buffer.concat([varint(field * 8), varint(value)]); }
function bytes(field, value) { const body = typeof value === 'string' ? Buffer.from(value) : value; return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]); }
function valueInfo(name, size) {
	const shape = Buffer.concat([bytes(1, scalar(1, size)), bytes(1, scalar(1, size))]);
	return Buffer.concat([bytes(1, name), bytes(2, bytes(1, Buffer.concat([scalar(1, 1), bytes(2, shape)])))]);
}
function syntheticMatMulModel(size, values) {
	const tensor = Buffer.concat([scalar(1, size), scalar(1, size), scalar(2, 1), bytes(8, 'weights'), bytes(9, Buffer.from(values.buffer))]);
	const nodes = [];
	for (let index = 0; index < 4; index += 1) nodes.push(bytes(1, Buffer.concat([
		bytes(1, index ? `hidden${index}` : 'input'), bytes(1, 'weights'), bytes(2, index === 3 ? 'output' : `hidden${index + 1}`), bytes(4, 'MatMul'),
	])));
	const graph = Buffer.concat([...nodes, bytes(2, 'synthetic-residency'), bytes(5, tensor), bytes(11, valueInfo('input', size)), bytes(12, valueInfo('output', size))]);
	return Buffer.concat([scalar(1, 9), bytes(2, 'soundscaper-performance-probe'), bytes(7, graph), bytes(8, scalar(2, 13))]);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createAssistanceOnnxCpuSessionV1,
	publishAssistanceOnnxOutputV1,
	reviewAssistanceOnnxRuntimeModuleV1,
} from '../desktop/assistance-onnx-worker-common.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from '../desktop/assistance-runtime-family-worker-entry.ts';

const INVALID_RUNTIME = Object.freeze({
	value: 'runtime value rejected',
	surface: 'runtime surface rejected',
});
const INVALID_SESSION = Object.freeze({
	value: 'session value rejected',
	surface: 'session surface rejected',
});

test('shared ONNX runtime review preserves value and surface error boundaries', () => {
	assert.throws(
		() => reviewAssistanceOnnxRuntimeModuleV1(null, INVALID_RUNTIME),
		new TypeError(INVALID_RUNTIME.value),
	);
	assert.throws(
		() => reviewAssistanceOnnxRuntimeModuleV1({ Tensor: class Tensor {} }, INVALID_RUNTIME),
		new TypeError(INVALID_RUNTIME.surface),
	);
	const runtime = fakeRuntime(validSession());
	assert.equal(reviewAssistanceOnnxRuntimeModuleV1(runtime, INVALID_RUNTIME), runtime);
});

test('shared ONNX session creation fixes CPU options and preserves validation boundaries', async () => {
	let receivedPath = '';
	let receivedOptions: unknown;
	const session = validSession();
	const runtime = fakeRuntime(session, (path, options) => {
		receivedPath = path;
		receivedOptions = options;
	});
	assert.equal(await createAssistanceOnnxCpuSessionV1(
		runtime, '/models/network.onnx', INVALID_SESSION,
	), session);
	assert.equal(receivedPath, '/models/network.onnx');
	assert.deepEqual(receivedOptions, {
		executionProviders: ['cpu'], graphOptimizationLevel: 'all',
		interOpNumThreads: 1, intraOpNumThreads: 4,
	});

	await assert.rejects(createAssistanceOnnxCpuSessionV1(
		fakeRuntime(null), '/models/network.onnx', INVALID_SESSION,
	), new TypeError(INVALID_SESSION.value));
	await assert.rejects(createAssistanceOnnxCpuSessionV1(
		fakeRuntime({ inputNames: [], outputNames: [] }),
		'/models/network.onnx', INVALID_SESSION,
	), new TypeError(INVALID_SESSION.surface));
});

test('shared ONNX publication writes one authenticated result without changing its schema',
	async (testContext) => {
		const fixture = await publicationFixture(testContext, 64);
		const body = new TextEncoder().encode('{"schemaVersion":1}');
		const result = await publishAssistanceOnnxOutputV1(
			fixture.context, body, 'output reservation rejected',
		);

		assert.deepEqual(Array.from(await readFile(fixture.outputPath)), Array.from(body));
		assert.deepEqual(fixture.progress, [1]);
		assert.deepEqual(result, {
			resultVersion: 1,
			jobId: '1'.repeat(40),
			familyId: 'onnxruntime-node',
			task: 'text-embedding',
			outputs: [{
				claimId: '2'.repeat(40), role: 'embeddings',
				mediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
				byteLength: body.byteLength,
				sha256: createHash('sha256').update(body).digest('hex'),
			}],
		});
		assert.ok(Object.isFrozen(result));
		assert.ok(Object.isFrozen(result.outputs));
		assert.ok(Object.isFrozen(result.outputs[0]));
	});

test('shared ONNX publication retains exact-count, size, and cancellation checks',
	async (testContext) => {
		const empty = await publicationFixture(testContext, 64, []);
		await assert.rejects(publishAssistanceOnnxOutputV1(
			empty.context, new Uint8Array([1]), 'exact output rejected', { exactOutputCount: 1 },
		), new RangeError('exact output rejected'));

		const bounded = await publicationFixture(testContext, 1);
		await assert.rejects(publishAssistanceOnnxOutputV1(
			bounded.context, new Uint8Array([1, 2]), 'size rejected',
		), new RangeError('size rejected'));

		const controller = new AbortController();
		controller.abort(new DOMException('cancelled', 'AbortError'));
		const cancelled = await publicationFixture(testContext, 64, undefined, controller.signal);
		await assert.rejects(publishAssistanceOnnxOutputV1(
			cancelled.context, new Uint8Array([1]), 'output rejected',
		), { name: 'AbortError' });
		assert.deepEqual(cancelled.progress, []);
	});

function validSession(): AssistanceOnnxInferenceSessionV1 {
	return Object.freeze({
		inputNames: Object.freeze(['input']),
		outputNames: Object.freeze(['output']),
		run: async (): Promise<Readonly<Record<string, AssistanceOnnxTensorV1>>> => ({}),
		release: async (): Promise<void> => undefined,
	});
}

function fakeRuntime(
	session: unknown,
	onCreate?: (path: string, options: unknown) => void,
): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements AssistanceOnnxTensorV1 {
		constructor(
			readonly type: 'uint8' | 'float32' | 'int64',
			readonly data: Uint8Array | Float32Array | BigInt64Array,
			readonly dims: readonly number[],
		) {}
	}
	return Object.freeze({
		Tensor,
		InferenceSession: Object.freeze({
			create: (path: string, options: unknown) => {
				onCreate?.(path, options);
				return Promise.resolve(session) as Promise<AssistanceOnnxInferenceSessionV1>;
			},
		}),
	});
}

async function publicationFixture(
	testContext: TestContext,
	maximumByteLength: number,
	outputs?: AssistanceRuntimeFamilyWorkerExecutionContext['grant']['outputs'],
	signal?: AbortSignal,
): Promise<Readonly<{
	context: AssistanceRuntimeFamilyWorkerExecutionContext;
	outputPath: string;
	progress: number[];
}>> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-onnx-worker-common-'));
	testContext.after(() => rm(root, { recursive: true, force: true }));
	const outputPath = join(root, 'output.bin');
	const progress: number[] = [];
	const output = Object.freeze({
		claimId: '2'.repeat(40), role: 'embeddings' as const,
		mediaType: 'application/vnd.soundscaper.embedding-matrix-v1', path: outputPath,
		maximumByteLength, initialByteLength: 0 as const,
		initialSha256: createHash('sha256').update(new Uint8Array()).digest('hex'),
		identity: Object.freeze({ dev: '1', ino: '2' }),
	});
	const grant = Object.freeze({
		grantVersion: 1 as const, jobId: '1'.repeat(40), familyId: 'onnxruntime-node' as const,
		task: 'text-embedding' as const, settingsJson: '{}', inputs: Object.freeze([]),
		models: Object.freeze([]), outputs: outputs ?? Object.freeze([output]),
	});
	const context: AssistanceRuntimeFamilyWorkerExecutionContext = Object.freeze({
		job: Object.freeze({
			protocolVersion: 1 as const, jobId: grant.jobId, familyId: grant.familyId,
			task: grant.task, maximumRssBytes: 1, maximumDurationMs: 1, grant,
			descriptor: Object.freeze({
				familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
				target: 'linux-x64' as const, executionProvider: 'cpu' as const,
				entrypoint: '/runtime/index.js', files: Object.freeze([]),
			}),
		}),
		grant, settings: Object.freeze({}), signal,
		onProgress: (value: number): void => { progress.push(value); },
	});
	return Object.freeze({ context, outputPath, progress });
}

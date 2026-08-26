/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createAssistanceSemanticQueryExecutorV1,
} from '../desktop/assistance-semantic-query-executor.ts';
import type {
	AssistanceRuntimeFamilyOperationAdapter,
	AssistanceRuntimeFamilyOperationRequest,
} from '../desktop/assistance-runtime-family-operation-adapter.ts';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';

test('semantic queries use installed authenticated models and publish one pathless vector', async (t) => {
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const inputBodies: string[] = [];
	const fixture = await queryFixture(t, writingRuntime(seen, inputBodies));
	const result = await fixture.executor.embed({
		provider: 'transcript', query: 'find red bicycle', signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'completed');
	if (result.outcome === 'completed') {
		assert.equal(result.provider, 'transcript');
		assert.equal(result.embedding.length, 768);
		assert.equal(result.embedding[0], 1);
		assert.ok(result.embedding.slice(1).every((value) => value === 0));
	}
	assert.equal(fixture.modelCalls.status, 1);
	assert.equal(fixture.modelCalls.installed, 2,
		'selection and exact capture each revalidate the installed manifest');
	assert.equal(fixture.modelCalls.paths, 1);
	assert.equal(seen.length, 1);
	assert.equal(seen[0]?.task, 'text-embedding');
	assert.deepEqual(seen[0]?.settings, {
		inputRoles: ['text'], operation: 'text-embedding', outputRoles: ['embeddings'], schemaVersion: 1,
	});
	assert.deepEqual(inputBodies, ['find red bicycle']);
	assert.equal(seen[0]?.inputs[0]?.claim.role, 'text');
	assert.equal(seen[0]?.outputs[0]?.reservation.role, 'embeddings');
});

test('semantic queries report missing installed models and runtime without installing or substituting',
	async (t) => {
	let runtimeCalls = 0;
	const absent = await queryFixture(t, Object.freeze({ run: async () => {
		runtimeCalls += 1;
		throw new Error('runtime must not run');
	} }), { installed: false });
	assert.deepEqual(await absent.executor.embed({
		provider: 'transcript', query: 'query', signal: new AbortController().signal,
	}), { queryResultVersion: 1, outcome: 'unavailable', reason: 'model-unavailable' });
	assert.equal(runtimeCalls, 0);
	assert.equal(absent.modelCalls.paths, 0);

	const unavailable = await queryFixture(t, Object.freeze({ run: async (
		_request: AssistanceRuntimeFamilyOperationRequest,
	) => {
		runtimeCalls += 1;
		return Object.freeze({ outcome: 'unavailable' as const,
			reason: 'runtime-unavailable' as const });
	} }));
	assert.deepEqual(await unavailable.executor.embed({
		provider: 'transcript', query: 'query', signal: new AbortController().signal,
	}), { queryResultVersion: 1, outcome: 'unavailable', reason: 'runtime-unavailable' });
	assert.equal(runtimeCalls, 1);
});

test('semantic query cancellation reaches runtime execution and suppresses output publication', async (t) => {
	let entered!: () => void;
	const running = new Promise<void>((resolve) => { entered = resolve; });
	let runtimeSignal: AbortSignal | undefined;
	const fixture = await queryFixture(t, Object.freeze({ run: async (
		request: AssistanceRuntimeFamilyOperationRequest,
	) => {
		runtimeSignal = request.signal;
		entered();
		await new Promise<void>((_resolve, reject) => request.signal?.addEventListener('abort', () => {
			reject(request.signal?.reason);
		}, { once: true }));
		throw new Error('unreachable');
	} }));
	const controller = new AbortController();
	const query = fixture.executor.embed({ provider: 'transcript', query: 'cancel me',
		signal: controller.signal });
	await running;
	controller.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(query, { name: 'AbortError' });
	assert.equal(runtimeSignal?.aborted, true);
});

async function queryFixture(
	t: TestContext,
	runtime: AssistanceRuntimeFamilyOperationAdapter,
	options: Readonly<{ installed?: boolean }> = {},
) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-semantic-query-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modelPath = join(root, 'model_quantized.onnx');
	await writeFile(modelPath, 'model');
	const digest = sha256('model');
	const installed = options.installed ?? true;
	const modelCalls = { status: 0, installed: 0, paths: 0 };
	const models = Object.freeze({
		status: async () => {
			modelCalls.status += 1;
			return { runtimeAvailable: true, runtimeReason: null, models: [{
				modelId: 'nomic-embed-text-v1.5', version: '1.5.0', task: 'text-embedding',
				availability: installed ? 'installed' as const : 'installable' as const,
				downloadBytes: 5, installedBytes: installed ? 5 : null, attributionRequired: false,
			}] };
		},
		listInstalled: async () => {
			modelCalls.installed += 1;
			return installed ? [{ modelId: 'nomic-embed-text-v1.5', version: '1.5.0',
				totalBytes: 5, artifacts: [{ fileName: 'model_quantized.onnx',
					byteLength: 5, sha256: digest }] }] : [];
		},
		resolveModelPaths: async () => {
			modelCalls.paths += 1;
			return { model_quantized: modelPath };
		},
	});
	const registry = new AssistanceStagingRegistry({ root: join(root, 'staging') });
	return { modelCalls, executor: createAssistanceSemanticQueryExecutorV1({
		registry, models, runtime,
	}) };
}

function writingRuntime(
	seen: AssistanceRuntimeFamilyOperationRequest[],
	inputBodies: string[],
): AssistanceRuntimeFamilyOperationAdapter {
	return Object.freeze({ async run(request: AssistanceRuntimeFamilyOperationRequest) {
		seen.push(request);
		inputBodies.push(await readFile(request.inputs[0]!.path, 'utf8'));
		request.signal?.throwIfAborted();
		const vector = new Float32Array(768);
		vector[0] = 1;
		const body = createAssistanceEmbeddingMatrixV1({ dimensions: 768, vectors: [vector] });
		await writeFile(request.outputs[0]!.path, body);
		return Object.freeze({ outcome: 'completed' as const, outputs: [Object.freeze({
			claimId: request.outputs[0]!.reservation.claimId, role: 'embeddings' as const,
			mediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
			byteLength: body.byteLength, sha256: sha256(body),
		})] });
	} });
}

function sha256(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

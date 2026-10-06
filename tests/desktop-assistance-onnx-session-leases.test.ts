/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';

import { createAssistanceOnnxSessionLeaseCacheV1 } from '../desktop/assistance-onnx-worker-common.ts';
import type { AssistanceOnnxRuntimeModuleV1, AssistanceOnnxTensorV1 } from '../desktop/assistance-onnx-runtime-worker.ts';
import type { AssistanceRuntimeFamilyWorkerExecutionContext } from '../desktop/assistance-runtime-family-worker-entry.ts';

const CPU = { executionProviders: ['cpu'] as const, graphOptimizationLevel: 'all' as const, interOpNumThreads: 1 as const, intraOpNumThreads: 4 as const };

function fixture() {
	let creates = 0, releases = 0;
	class Tensor implements AssistanceOnnxTensorV1 {
		constructor(readonly type: 'uint8' | 'float32' | 'int64', readonly data: Uint8Array | Float32Array | BigInt64Array, readonly dims: readonly number[]) {}
	}
	const runtime: AssistanceOnnxRuntimeModuleV1 = { Tensor, InferenceSession: {
		async create() {
			creates += 1;
			return { inputNames: ['input'], outputNames: ['output'], async run() { return {}; },
				async release() { releases += 1; } };
		},
	} };
	return { runtime, get creates() { return creates; }, get releases() { return releases; } };
}

function context(options: { signal?: AbortSignal; digest?: string; settings?: string; modelBytes?: number } = {}): AssistanceRuntimeFamilyWorkerExecutionContext {
	const grant = { grantVersion: 1 as const, jobId: '1'.repeat(40), familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, settingsJson: options.settings ?? '{}', inputs: [], outputs: [],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network', path: '/private/model.onnx',
			byteLength: options.modelBytes ?? 1_024, sha256: options.digest ?? '2'.repeat(64), identity: { dev: '1', ino: '2' } }],
	};
	return { grant, settings: JSON.parse(grant.settingsJson) as Record<string, unknown>, signal: options.signal, onProgress() {},
		job: { protocolVersion: 1, jobId: grant.jobId, familyId: grant.familyId, task: grant.task,
			maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: { familyId: grant.familyId, runtimeVersion: '1.29.0', target: 'linux-x64', executionProvider: 'cpu',
				entrypoint: '/runtime/index.js', files: [{ path: '/runtime/index.js', relativePath: 'index.js',
					byteLength: 1, sha256: '3'.repeat(64), executable: false }] },
		},
	};
}

test('authenticated ONNX scopes reuse one idle session and keep every request lease isolated', async (t) => {
	const direct = fixture(), cache = createAssistanceOnnxSessionLeaseCacheV1({ getRssBytes: () => 64 * 1024 ** 2 });
	t.after(async () => { await cache.dispose(); });
	let previous: Awaited<ReturnType<AssistanceOnnxRuntimeModuleV1['InferenceSession']['create']>> | undefined;
	for (let index = 0; index < 2; index += 1) await cache.runAuthenticated(context(), async () => {
		const runtime = cache.wrapRuntime(direct.runtime);
		const lease = await runtime.InferenceSession.create('/private/model.onnx', CPU);
		assert.notEqual(lease, previous);
		if (previous) await assert.rejects(async () => { await previous?.run({}); }, /released|scope/iu);
		await lease.run({});
		await lease.release?.();
		previous = lease;
	});
	assert.equal(direct.creates, 1);
	assert.equal(direct.releases, 0);
	assert.equal(cache.idleSessionCount, 1);
	await cache.dispose();
	assert.equal(direct.releases, 1);
});

test('fresh model digests and exact settings select separate native sessions', async (t) => {
	const direct = fixture(), cache = createAssistanceOnnxSessionLeaseCacheV1({ getRssBytes: () => 64 * 1024 ** 2 });
	t.after(async () => { await cache.dispose(); });
	for (const current of [context(), context({ digest: '4'.repeat(64) }), context({ digest: '4'.repeat(64), settings: '{"gain":2}' })]) {
		await cache.runAuthenticated(current, async () => {
			const session = await cache.wrapRuntime(direct.runtime).InferenceSession.create('/private/model.onnx', CPU);
			await session.release?.();
		});
	}
	assert.equal(direct.creates, 3);
	assert.equal(direct.releases, 2);
});

test('ONNX idle leases obey model size, RSS and TTL bounds and failures retire every session', async () => {
	for (const mode of ['large-model', 'rss', 'ttl', 'error', 'cancel'] as const) {
		const direct = fixture(), controller = new AbortController();
		const cache = createAssistanceOnnxSessionLeaseCacheV1({ getRssBytes: () => mode === 'rss' ? 2 * 1024 ** 3 : 64 * 1024 ** 2,
			idleTtlMs: mode === 'ttl' ? 1 : 30_000 });
		const work = cache.runAuthenticated(context({ signal: controller.signal, modelBytes: mode === 'large-model' ? 600 * 1024 ** 2 : 1_024 }), async () => {
			const session = await cache.wrapRuntime(direct.runtime).InferenceSession.create('/private/model.onnx', CPU);
			await session.release?.();
			if (mode === 'error') throw new Error('Inference failed.');
			if (mode === 'cancel') controller.abort();
		});
		if (mode === 'error' || mode === 'cancel') await assert.rejects(work);
		else await work;
		if (mode === 'ttl') await pause(10);
		assert.equal(cache.idleSessionCount, 0, mode);
		assert.equal(direct.releases, 1, mode);
		await cache.dispose();
	}
});

test('ONNX cache refuses creation outside its authenticated scope and concurrent scopes', async () => {
	const direct = fixture(), cache = createAssistanceOnnxSessionLeaseCacheV1();
	assert.throws(() => cache.wrapRuntime(direct.runtime), /authenticated scope/iu);
	await cache.runAuthenticated(context(), async () => {
		await assert.rejects(cache.runAuthenticated(context(), async () => {}), /active/iu);
		await assert.rejects(Promise.resolve(cache.wrapRuntime(direct.runtime).InferenceSession.create('/foreign/model.onnx', CPU)), /authenticated/iu);
	});
	await cache.dispose();
});


test('concurrent native session requests share creation and return independent request leases', async () => {
	const direct = fixture(), cache = createAssistanceOnnxSessionLeaseCacheV1({ getRssBytes: () => 64 * 1024 ** 2 });
	await cache.runAuthenticated(context(), async () => {
		const runtime = cache.wrapRuntime(direct.runtime);
		const [first, second] = await Promise.all([
			runtime.InferenceSession.create('/private/model.onnx', CPU),
			runtime.InferenceSession.create('/private/model.onnx', CPU),
		]);
		assert.notEqual(first, second); assert.equal(direct.creates, 1);
		await first.release?.(); await second.run({}); await second.release?.();
	});
	await cache.dispose(); assert.equal(direct.releases, 1);
});

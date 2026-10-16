/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceOnnxAcceleratedRuntimeV1 } from '../desktop/assistance-onnx-acceleration.ts';
import type {
	AssistanceOnnxInferenceSessionV1, AssistanceOnnxRuntimeModuleV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';

const CPU = { executionProviders: ['cpu'] as const, graphOptimizationLevel: 'all' as const,
	interOpNumThreads: 1 as const, intraOpNumThreads: 4 as const };
type SessionOptions = Parameters<AssistanceOnnxRuntimeModuleV1['InferenceSession']['create']>[1];

function session(onRelease = () => {}): AssistanceOnnxInferenceSessionV1 {
	return { inputNames: ['input'], outputNames: ['output'], run: async () => ({}), release: onRelease };
}

function runtime(create: AssistanceOnnxRuntimeModuleV1['InferenceSession']['create']): AssistanceOnnxRuntimeModuleV1 {
	return { Tensor: class Tensor {
		constructor(readonly type: string, readonly data: Float32Array, readonly dims: readonly number[]) {}
	} as AssistanceOnnxRuntimeModuleV1['Tensor'], InferenceSession: { create } };
}

test('legacy authenticated runtime closures keep their CPU session options', async () => {
	const received: SessionOptions[] = [];
	const native = session();
	const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async (_path, settings) => {
		received.push(settings); return native;
	}), {});
	assert.equal(await accelerated.InferenceSession.create('/model.onnx', CPU), native);
	assert.deepEqual(received, [CPU]);
});

test('authenticated GPU providers are preferred with CPU operator fallback', async () => {
	for (const provider of ['coreml', 'webgpu'] as const) {
		const received: SessionOptions[] = [];
		let released = 0;
		const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async (_path, settings) => {
			received.push(settings); return session(() => { released += 1; });
		}), { executionProviders: [provider, 'cpu'] });
		const result = await accelerated.InferenceSession.create('/model.onnx', CPU);
		assert.deepEqual(received, [{ ...CPU, executionProviders: [provider, 'cpu'] }]);
		await result.release?.();
		await result.release?.();
		assert.equal(released, 1);
	}
});

test('failed GPU session creation tries remaining authenticated providers and then CPU', async () => {
	const attempted: string[][] = [];
	const cpu = session();
	const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async (_path, settings) => {
		attempted.push([...settings.executionProviders]);
		if (settings.executionProviders[0] !== 'cpu') throw new Error('GPU device unavailable');
		return cpu;
	}), { executionProviders: ['coreml', 'webgpu', 'cpu'] });
	const result = await accelerated.InferenceSession.create('/model.onnx', CPU);
	assert.deepEqual(attempted, [['coreml', 'cpu'], ['webgpu', 'cpu'], ['cpu']]);
	await result.release?.();
});

test('a GPU inference error releases that session and retries the same authenticated model on CPU', async () => {
	const events: string[] = [];
	const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async (path, settings) => {
		assert.equal(path, '/authenticated/model.onnx');
		const provider = settings.executionProviders[0]!;
		events.push(`create:${provider}`);
		return { ...session(() => { events.push(`release:${provider}`); }), run: async (feeds) => {
			events.push(`run:${provider}`);
			if (provider !== 'cpu') throw new Error('GPU device lost');
			return feeds;
		} };
	}), { executionProviders: ['webgpu', 'cpu'] });
	const result = await accelerated.InferenceSession.create('/authenticated/model.onnx', CPU);
	const feeds = { input: { type: 'float32', data: new Float32Array([1]), dims: [1] } };
	assert.equal(await result.run(feeds), feeds);
	assert.equal(await result.run(feeds), feeds);
	await result.release?.();
	assert.deepEqual(events, ['create:webgpu', 'run:webgpu', 'release:webgpu', 'create:cpu',
		'run:cpu', 'run:cpu', 'release:cpu']);
});

test('a rejected GPU run cannot retry after cancellation or reuse released sessions', async () => {
	const controller = new AbortController();
	let creations = 0;
	let releases = 0;
	const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async () => {
		creations += 1;
		return { ...session(() => { releases += 1; }), run: async () => {
			controller.abort(); throw new Error('GPU device lost');
		} };
	}), { executionProviders: ['webgpu', 'cpu'] }, () => controller.signal);
	const result = await accelerated.InferenceSession.create('/model.onnx', CPU);
	await assert.rejects(async () => result.run({}), { name: 'AbortError' });
	assert.equal(creations, 1);
	await result.release?.();
	assert.equal(releases, 1);
	await assert.rejects(async () => result.run({}), /released/u);
});

test('CPU errors and GPU cleanup failures retain their original error boundary', async () => {
	const failure = new Error('model is invalid');
	const cpu = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async () => { throw failure; }), {});
	await assert.rejects(async () => cpu.InferenceSession.create('/model.onnx', CPU), (error: unknown) => error === failure);
	let creations = 0;
	const cleanup = new Error('GPU release failed');
	const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async () => {
		creations += 1;
		return { ...session(() => { throw cleanup; }), run: async () => { throw failure; } };
	}), { executionProviders: ['webgpu', 'cpu'] });
	const result = await accelerated.InferenceSession.create('/model.onnx', CPU);
	await assert.rejects(async () => result.run({}), /GPU release failed/u);
	assert.equal(creations, 1);
});

test('malformed GPU outputs remain visible to model validation without CPU retry', async () => {
	let creations = 0;
	const malformed = { unexpected: { type: 'float32', data: new Float32Array([NaN]), dims: [1] } };
	const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async () => {
		creations += 1;
		return { ...session(), run: async () => malformed };
	}), { executionProviders: ['webgpu', 'cpu'] });
	const result = await accelerated.InferenceSession.create('/model.onnx', CPU);
	assert.equal(await result.run({}), malformed);
	assert.equal(creations, 1);
	await result.release?.();
});

test('CPU retry rejects a changed graph surface and releases both native sessions', async () => {
	const gpuError = new Error('GPU device lost');
	const released: string[] = [];
	const accelerated = createAssistanceOnnxAcceleratedRuntimeV1(runtime(async (_path, settings) => {
		const provider = settings.executionProviders[0]!;
		const native = session(() => { released.push(provider); });
		return provider === 'cpu' ? { ...native, inputNames: ['foreign'] }
			: { ...native, run: async () => { throw gpuError; } };
	}), { executionProviders: ['webgpu', 'cpu'] });
	const result = await accelerated.InferenceSession.create('/model.onnx', CPU);
	await assert.rejects(async () => result.run({}), (error: unknown) =>
		error instanceof TypeError && error.cause === gpuError && /model surface/u.test(error.message));
	await result.release?.();
	assert.deepEqual(released, ['webgpu', 'cpu']);
});

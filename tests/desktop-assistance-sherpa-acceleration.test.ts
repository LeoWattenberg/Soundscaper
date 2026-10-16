/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	callSherpaNativeV1,
	createSherpaNativeExecutorV1,
	disposeSherpaNativeV1,
} from '../desktop/assistance-sherpa-acceleration.ts';

test('Sherpa attempts only authenticated providers, preferring GPU before CPU', async () => {
	const attempted: string[] = [];
	const executor = createSherpaNativeExecutorV1({ executionProviders: ['cpu', 'coreml', 'webgpu'] });
	const result = await executor.run(undefined, (provider) => {
		attempted.push(provider);
		if (provider !== 'cpu') return callSherpaNativeV1(() => { throw new Error('unsupported GPU'); });
		return 'recognized';
	});
	assert.equal(result, 'recognized');
	assert.deepEqual(attempted, ['coreml', 'webgpu', 'cpu']);
	await executor.run(undefined, (provider) => { attempted.push(provider); });
	assert.deepEqual(attempted, ['coreml', 'webgpu', 'cpu', 'cpu']);
});

test('Sherpa legacy closures retain CPU baseline and explicit providers must be supported', async () => {
	assert.equal(await createSherpaNativeExecutorV1().run(undefined, (provider) => provider), 'cpu');
	assert.equal(await createSherpaNativeExecutorV1({ provider: 'webgpu' }).run(undefined, (provider) => provider), 'webgpu');
	for (const options of [
		{ executionProviders: [] }, { executionProviders: ['webgpu'] },
		{ executionProviders: ['cpu', 'cpu'] }, { executionProviders: ['cpu', 'cuda'] },
		{ executionProviders: ['cpu'], provider: 'webgpu' }, { provider: 'cuda' },
	]) assert.throws(() => createSherpaNativeExecutorV1(options as never), /provider/iu);
});

test('Sherpa validation, CPU, and cancellation failures preserve their original boundary', async () => {
	const validation = new RangeError('malformed native result');
	const cpuFailure = new Error('CPU failed');
	const attempted: string[] = [];
	const executor = createSherpaNativeExecutorV1({ executionProviders: ['webgpu', 'cpu'] });
	await assert.rejects(executor.run(undefined, (provider) => {
		attempted.push(provider); throw validation;
	}), (error) => error === validation);
	assert.deepEqual(attempted, ['webgpu']);
	await assert.rejects(createSherpaNativeExecutorV1().run(undefined, () => callSherpaNativeV1(() => {
		throw cpuFailure;
	})), (error) => error === cpuFailure);
	const controller = new AbortController();
	await assert.rejects(executor.run(controller.signal, () => callSherpaNativeV1(() => {
		controller.abort(new Error('cancelled')); throw new Error('GPU lost');
	})), /cancelled/iu);
	assert.deepEqual(attempted, ['webgpu']);
	const nativeCancellation = new DOMException('native cancellation', 'AbortError');
	const nativeAttempts: string[] = [];
	await assert.rejects(executor.run(undefined, (provider) => {
		nativeAttempts.push(provider);
		return callSherpaNativeV1(() => { throw nativeCancellation; });
	}), (error) => error === nativeCancellation);
	assert.deepEqual(nativeAttempts, ['webgpu']);
});

test('Sherpa uses a supported native release method and keeps release errors visible', () => {
	const released: string[] = [];
	disposeSherpaNativeV1({ free: () => { released.push('free'); }, dispose: () => { released.push('dispose'); } });
	disposeSherpaNativeV1({ dispose: () => { released.push('dispose'); } });
	disposeSherpaNativeV1({});
	assert.deepEqual(released, ['free', 'dispose']);
	assert.throws(() => disposeSherpaNativeV1({ free: () => { throw new Error('release failed'); } }), /release failed/iu);
});

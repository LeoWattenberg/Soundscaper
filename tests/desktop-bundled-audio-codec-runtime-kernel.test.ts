/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	loadAuthenticatedBundledAudioCodecRuntime,
} from '../desktop/authenticated-bundled-audio-codec-runtime-loader.ts';
import {
	bundledAudioCodecSha256,
	createBundledAudioCodecRuntimeSupport,
} from '../desktop/bundled-audio-codec-runtime-support.ts';
import {
	instantiateDirectBundledAudioCodecWasm,
} from '../desktop/direct-bundled-audio-codec-wasm.ts';

const PAYLOAD = Uint8Array.of(1, 2, 3);

function loader(options: Readonly<{
	readonly target: 'linux-x64';
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}>, events: string[], overrides: Readonly<{
	readonly instantiate?: () => Promise<string>;
	readonly canary?: () => void;
}> = {}) {
	return loadAuthenticatedBundledAudioCodecRuntime(options, {
		codecLabel: 'test',
		admitTarget(value) {
			events.push('target');
			if (value !== 'linux-x64') throw new TypeError('target');
			return value;
		},
		expectedByteLength: PAYLOAD.byteLength, expectedSha256: bundledAudioCodecSha256(PAYLOAD),
		readPayload: async () => { events.push('read'); return PAYLOAD; },
		instantiate: async () => {
			events.push('instantiate');
			return await (overrides.instantiate?.() ?? Promise.resolve('loaded'));
		},
		createCodec: () => { events.push('codec'); return 'codec'; },
		verifyCanary: () => { events.push('canary'); overrides.canary?.(); },
		createRuntime: (target, codec, yieldControl) => {
			events.push('runtime');
			return { target, codec, yieldControl };
		},
	});
}

test('authenticated bundled codec loading validates options outside its fail-closed boundary', async () => {
	await assert.rejects(() => loader({ target: 'invalid' as 'linux-x64' }, []), /target/u);
	await assert.rejects(() => loader({
		target: 'linux-x64', readPayload: 1 as unknown as () => Promise<Uint8Array>,
	}, []), /payload reader/u);
	await assert.rejects(() => loader({
		target: 'linux-x64', yieldControl: 1 as unknown as () => Promise<void>,
	}, []), /scheduler/u);
});

test('authenticated bundled codec loading authenticates, instantiates, canaries, then constructs', async () => {
	const events: string[] = [];
	const runtime = await loader({ target: 'linux-x64' }, events);
	assert.deepEqual(events, ['target', 'read', 'instantiate', 'codec', 'canary', 'runtime']);
	assert.equal(runtime?.target, 'linux-x64');
	assert.equal(runtime?.codec, 'codec');
});

test('authenticated bundled codec loading maps payload, instantiate, and canary failures to null', async () => {
	assert.equal(await loader({
		target: 'linux-x64', readPayload: async () => Uint8Array.of(9),
	}, []), null);
	assert.equal(await loader({ target: 'linux-x64' }, [], {
		instantiate: async () => { throw new Error('instantiate'); },
	}), null);
	assert.equal(await loader({ target: 'linux-x64' }, [], {
		canary: () => { throw new Error('canary'); },
	}), null);
});

test('bundled codec support preserves target, abort, and failure result contracts', () => {
	const support = createBundledAudioCodecRuntimeSupport('Opus');
	assert.equal(support.admitTarget('mac-arm64'), 'mac-arm64');
	assert.throws(() => support.admitTarget('mac-x64'), {
		name: 'TypeError', message: 'The bundled Opus desktop target is unsupported.',
	});
	const abort = new AbortController();
	abort.abort(new Error('owned reason'));
	assert.throws(() => support.throwIfAborted(abort.signal), /owned reason/u);
	assert.equal(support.abortReason().message, 'The bundled Opus operation was cancelled.');
	assert.deepEqual(support.failure('result-failed', 'detail'), {
		status: 'failed', reason: 'result-failed', detail: 'detail',
	});
});

test('direct bundled Wasm authority copies, closes imports, and instantiates', async () => {
	const emptyModule = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const exports = await instantiateDirectBundledAudioCodecWasm(
		emptyModule, {}, (key) => new Error(key), { expectedImportCount: 0 },
	);
	assert.deepEqual(Object.keys(exports), []);

	const importedFunctionModule = Uint8Array.of(
		0, 97, 115, 109, 1, 0, 0, 0,
		1, 4, 1, 96, 0, 0,
		2, 15, 1, 3, 101, 110, 118, 7, 97, 108, 108, 111, 119, 101, 100, 0, 0,
	);
	await instantiateDirectBundledAudioCodecWasm(
		importedFunctionModule, { 'env.allowed': () => undefined },
		(key) => new Error(`forbidden ${key}`), { expectedImportCount: 1 },
	);
	await assert.rejects(() => instantiateDirectBundledAudioCodecWasm(
		importedFunctionModule, {}, (key) => new Error(`forbidden ${key}`),
	), /forbidden env\.allowed/u);
	await assert.rejects(() => instantiateDirectBundledAudioCodecWasm(
		importedFunctionModule, { 'env.allowed': () => undefined }, (key) => new Error(key), {
			expectedImportCount: 0, changedImportInventory: () => new Error('inventory'),
		},
	), /inventory/u);
});

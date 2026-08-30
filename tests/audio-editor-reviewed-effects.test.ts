/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	listReviewedEffectCatalog,
	readReleasePinnedReviewedEffectBytes,
	resolveReviewedEffectCatalogEntry,
} from '../src/common/editor/reviewed-effects/catalog.ts';
import { ReviewedEffectError } from '../src/common/editor/reviewed-effects/errors.ts';
import { verifyReviewedEffectDigest } from '../src/common/editor/reviewed-effects/hash.ts';
import { defineReviewedEffectManifest } from '../src/common/editor/reviewed-effects/manifest.ts';
import {
	processReviewedEffectOffline,
	type ReviewedEffectWorkerPort,
} from '../src/common/editor/reviewed-effects/offline-worker-client.ts';
import {
	createReviewedEffectWorkerRuntime,
	REVIEWED_EFFECT_WORKER_PREPARE,
	REVIEWED_EFFECT_WORKER_REQUEST,
} from '../src/common/editor/reviewed-effects/offline-worker-runtime.ts';
import {
	createReviewedEffectRealtimeNode,
} from '../src/common/editor/reviewed-effects/realtime-worklet-host.ts';
import { ReviewedEffectWorkletProcessor } from '../src/common/editor/reviewed-effects/realtime-worklet.js';
import {
	ReviewedEffectWasmRuntime,
	loadReviewedEffectPackage,
} from '../src/common/editor/reviewed-effects/runtime.ts';
import {
	applyReviewedUtilityGainSelectionOffline,
} from '../src/common/editor/reviewed-effects/selection-effect.ts';
import {
	UTILITY_GAIN_MANIFEST,
	UTILITY_GAIN_PACKAGE_SHA256,
} from '../src/common/editor/reviewed-effects/utility-gain-package.ts';
import { compileReviewedEffectWasm } from '../src/common/editor/reviewed-effects/wasm-abi.ts';

const utilityGainReference = Object.freeze({
	id: 'org.soundscaper.utility-gain',
	version: '1.0.0',
});

test('release catalog is immutable, exact-versioned, and revocation is fail-closed', () => {
	const catalog = listReviewedEffectCatalog();
	assert.ok(Object.isFrozen(catalog));
	assert.ok(catalog.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.manifest)));
	assert.equal(resolveReviewedEffectCatalogEntry(utilityGainReference).realtimeApproved, true);
	assertCode(() => resolveReviewedEffectCatalogEntry({
		id: utilityGainReference.id,
		version: '0.9.0',
	}), 'PACKAGE_REVOKED');
	assertCode(() => resolveReviewedEffectCatalogEntry({
		...utilityGainReference,
		url: 'https://example.invalid/effect.wasm',
	}), 'MANIFEST_INVALID');
	assertCode(() => resolveReviewedEffectCatalogEntry({
		id: utilityGainReference.id,
		version: '2.0.0',
	}), 'PACKAGE_NOT_FOUND');
});

test('closed manifest rejects unknown fields and inconsistent resource declarations', () => {
	assertCode(() => defineReviewedEffectManifest({
		...UTILITY_GAIN_MANIFEST,
		trustOverride: true,
	}), 'MANIFEST_INVALID');
	assertCode(() => defineReviewedEffectManifest({
		...UTILITY_GAIN_MANIFEST,
		resources: {
			...UTILITY_GAIN_MANIFEST.resources,
			maximumOutputBytes: UTILITY_GAIN_MANIFEST.resources.maximumOutputBytes + 4,
		},
	}), 'MANIFEST_INVALID');
});

test('catalog artifact is exact-hash verified and returned as an isolated copy', async () => {
	const first = readReleasePinnedReviewedEffectBytes(utilityGainReference);
	const second = readReleasePinnedReviewedEffectBytes(utilityGainReference);
	assert.notEqual(first, second);
	await verifyReviewedEffectDigest(first, UTILITY_GAIN_PACKAGE_SHA256);
	first[first.length - 1] ^= 1;
	await assert.rejects(
		verifyReviewedEffectDigest(first, UTILITY_GAIN_PACKAGE_SHA256),
		(error: unknown) => isCode(error, 'HASH_MISMATCH'),
	);
	assert.notDeepEqual(first, second);
});

test('WASM admission rejects malformed signatures, forbidden imports, and memory oversize', async () => {
	const original = readReleasePinnedReviewedEffectBytes(utilityGainReference);
	const wrongSignature = original.slice();
	const signature = findSequence(wrongSignature, [0x60, 0x07, 0x7f, 0x7f, 0x7f, 0x7f, 0x7d]);
	wrongSignature[signature + 6] = 0x7f;
	await assert.rejects(
		compileReviewedEffectWasm(wrongSignature, UTILITY_GAIN_MANIFEST),
		(error: unknown) => isCode(error, 'ABI_INVALID'),
	);

	const memoryOversize = original.slice();
	const memorySection = findSequence(memoryOversize, [0x05, 0x04, 0x01, 0x01, 0x01, 0x01]);
	memoryOversize[memorySection + 5] = 0x02;
	await assert.rejects(
		compileReviewedEffectWasm(memoryOversize, UTILITY_GAIN_MANIFEST),
		(error: unknown) => isCode(error, 'WASM_LIMIT'),
	);

	const functionSection = findSequence(original, [0x03, 0x02, 0x01, 0x00]);
	const forbiddenImportSection = Uint8Array.of(
		0x02, 0x09, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x78, 0x00, 0x00,
	);
	const withImport = concatBytes(
		original.subarray(0, functionSection),
		forbiddenImportSection,
		original.subarray(functionSection),
	);
	await assert.rejects(
		compileReviewedEffectWasm(withImport, UTILITY_GAIN_MANIFEST),
		(error: unknown) => isCode(error, 'FORBIDDEN_IMPORT') && /forbidden imports/u.test(error.message),
	);

	const mismatchedTail = defineReviewedEffectManifest({
		...UTILITY_GAIN_MANIFEST,
		tailFrames: 1,
	});
	await assert.rejects(
		compileReviewedEffectWasm(original, mismatchedTail),
		(error: unknown) => isCode(error, 'ABI_INVALID') && /latency, tail, or ABI metadata/u.test(error.message),
	);
});

test('Utility Gain is a zero-import pure-WASM conformance package', async () => {
	const loadedPackage = await loadReviewedEffectPackage(utilityGainReference);
	assert.deepEqual(WebAssembly.Module.imports(loadedPackage.module), []);
	assert.deepEqual(WebAssembly.Module.exports(loadedPackage.module), [
		{ name: 'memory', kind: 'memory' },
		{ name: 'soundscaper_effect_abi_version', kind: 'global' },
		{ name: 'soundscaper_effect_latency_frames', kind: 'global' },
		{ name: 'soundscaper_effect_tail_frames', kind: 'global' },
		{ name: 'soundscaper_effect_process', kind: 'function' },
	]);
	const runtime = new ReviewedEffectWasmRuntime(loadedPackage);
	const output = runtime.process({
		sampleRate: 48_000,
		channels: [Float32Array.of(1, -0.5, 0.25), Float32Array.of(-1, 0.125, 0)],
		parameters: { gain: 2 },
	});
	assert.deepEqual(output.map((channel) => [...channel]), [
		[2, -1, 0.5],
		[-2, 0.25, 0],
	]);
});

test('runtime rejects oversized and malformed PCM before entering WASM', async () => {
	const runtime = new ReviewedEffectWasmRuntime(await loadReviewedEffectPackage(utilityGainReference));
	assertCode(() => runtime.process({
		sampleRate: 48_000,
		channels: [new Float32Array(2_049)],
	}), 'INPUT_LIMIT');
	assertCode(() => runtime.process({
		sampleRate: 48_000,
		channels: [Float32Array.of(1), Float32Array.of(1), Float32Array.of(1)],
	}), 'INPUT_LIMIT');
	assertCode(() => runtime.process({
		sampleRate: 48_000,
		channels: [Float32Array.of(Number.NaN)],
	}), 'INPUT_LIMIT');
});

test('closed worker runtime processes Utility Gain without package JavaScript', async () => {
	const runtime = createReviewedEffectWorkerRuntime();
	const ready = await runtime.execute({
		type: REVIEWED_EFFECT_WORKER_PREPARE,
		requestId: 'utility-worker',
		package: utilityGainReference,
	});
	assert.equal(ready.type, 'ready');
	const response = await runtime.execute({
		type: REVIEWED_EFFECT_WORKER_REQUEST,
		requestId: 'utility-worker',
		sampleRate: 48_000,
		channels: [Float32Array.of(0.5, -0.25)],
		parameters: { gain: 3 },
	});
	assert.equal(response.type, 'result');
	if (response.type === 'result') assert.deepEqual([...response.channels[0]!], [1.5, -0.75]);

	const malformed = await createReviewedEffectWorkerRuntime().execute({
		type: REVIEWED_EFFECT_WORKER_PREPARE,
		requestId: 'unknown-field',
		package: utilityGainReference,
		url: 'https://example.invalid/effect.wasm',
	});
	assert.equal(malformed.type, 'error');
	if (malformed.type === 'error') assert.equal(malformed.error.code, 'WORKER_PROTOCOL');
});

test('dedicated-worker-capable port returns bounded offline processing and terminates', async () => {
	const port = runtimeWorkerPort();
	const output = await processReviewedEffectOffline(utilityGainReference, {
		sampleRate: 44_100,
		channels: [Float32Array.of(0.25, -0.5)],
		parameters: { gain: 4 },
	}, { workerFactory: () => port });
	assert.deepEqual([...output[0]!], [1, -2]);
	assert.equal(port.terminateCount, 1);
});

test('selection integration splits long input across terminating dedicated workers', async () => {
	const ports: FakeWorkerPort[] = [];
	const progress: number[] = [];
	const input = new Float32Array(UTILITY_GAIN_MANIFEST.resources.maximumBlockFrames + 2).fill(0.25);
	const output = await applyReviewedUtilityGainSelectionOffline(
		[input],
		48_000,
		{ gain: 3 },
		{
			onProgress: (value) => progress.push(value),
			workerFactory: () => {
				const port = runtimeWorkerPort();
				ports.push(port);
				return port;
			},
		},
	);
	assert.equal(ports.length, 2);
	assert.ok(ports.every((port) => port.terminateCount === 1));
	assert.equal(output[0]?.length, input.length);
	assert.equal(output[0]?.[0], 0.75);
	assert.equal(output[0]?.at(-1), 0.75);
	// One worker is built and torn down per block, so a real selection takes seconds.
	// Without a per-block report the apply looked frozen for its whole duration.
	assert.equal(progress.length, ports.length);
	assert.equal(progress.at(-1), 1);
	assert.deepEqual(progress, [...progress].sort((left, right) => left - right));
});

test('offline client rejects oversized worker output and terminates the port', async () => {
	const port = preparedWorkerPort((message, currentPort) => {
		const request = message as Readonly<{ requestId: string }>;
		queueMicrotask(() => currentPort.emit('message', {
			data: {
				type: 'result',
				requestId: request.requestId,
				packageKey: 'org.soundscaper.utility-gain@1.0.0',
				channels: [new Float32Array(4_097)],
			},
		}));
	});
	await assert.rejects(processReviewedEffectOffline(utilityGainReference, {
		sampleRate: 48_000,
		channels: [Float32Array.of(1)],
	}, { workerFactory: () => port }), (error: unknown) => isCode(error, 'OUTPUT_LIMIT'));
	assert.equal(port.terminateCount, 1);
});

test('offline client enforces the release-catalog processing timeout', async () => {
	const port = preparedWorkerPort(() => undefined);
	await assert.rejects(processReviewedEffectOffline(utilityGainReference, {
		sampleRate: 48_000,
		channels: [Float32Array.of(1)],
	}, { workerFactory: () => port }), (error: unknown) => isCode(error, 'TIMEOUT'));
	assert.equal(port.terminateCount, 1);
});

test('offline processing deadline starts after worker package preparation', async () => {
	let prepared = false;
	const port = new FakeWorkerPort((message, currentPort) => {
		const request = message as Readonly<{ type: string; requestId: string }>;
		if (request.type === REVIEWED_EFFECT_WORKER_PREPARE) {
			globalThis.setTimeout(() => {
				prepared = true;
				currentPort.emit('message', {
					data: {
						type: 'ready', requestId: request.requestId,
						packageKey: 'org.soundscaper.utility-gain@1.0.0',
					},
				});
			}, UTILITY_GAIN_MANIFEST.resources.processingTimeoutMs + 25);
			return;
		}
		if (!prepared) return;
		queueMicrotask(() => currentPort.emit('message', {
			data: {
				type: 'result', requestId: request.requestId,
				packageKey: 'org.soundscaper.utility-gain@1.0.0',
				channels: [Float32Array.of(2)],
			},
		}));
	});
	const output = await processReviewedEffectOffline(utilityGainReference, {
		sampleRate: 48_000,
		channels: [Float32Array.of(1)],
	}, { workerFactory: () => port });
	assert.deepEqual([...output[0]!], [2]);
	assert.equal(port.terminateCount, 1);
});

test('offline client terminates on cancellation and rejects catalog-mismatched output', async () => {
	const controller = new AbortController();
	const cancelledPort = new FakeWorkerPort(() => undefined);
	const cancelled = processReviewedEffectOffline(utilityGainReference, {
		sampleRate: 48_000,
		channels: [Float32Array.of(1)],
	}, { signal: controller.signal, workerFactory: () => cancelledPort });
	controller.abort(new Error('cancel test'));
	await assert.rejects(cancelled, (error: unknown) => isCode(error, 'REQUEST_ABORTED'));
	assert.equal(cancelledPort.terminateCount, 1);

	const mismatchPort = preparedWorkerPort((message, currentPort) => {
		const request = message as Readonly<{ requestId: string }>;
		queueMicrotask(() => currentPort.emit('message', {
			data: {
				type: 'result',
				requestId: request.requestId,
				packageKey: 'org.example.wrong@1.0.0',
				channels: [Float32Array.of(1)],
			},
		}));
	});
	await assert.rejects(processReviewedEffectOffline(utilityGainReference, {
		sampleRate: 48_000,
		channels: [Float32Array.of(1)],
	}, { workerFactory: () => mismatchPort }), (error: unknown) => isCode(error, 'CATALOG_MISMATCH'));
	assert.equal(mismatchPort.terminateCount, 1);
});

test('static realtime worklet hosts only approved pure-WASM packages', async () => {
	const loadedPackage = await loadReviewedEffectPackage(utilityGainReference);
	const processor = new ReviewedEffectWorkletProcessor({
		processorOptions: {
			packageKey: loadedPackage.key,
			abiVersion: 1,
			wasmModule: loadedPackage.module,
			channelCount: 1,
			parameterValues: [2],
		},
	});
	const output = new Float32Array(3);
	assert.equal(processor.process(
		[[Float32Array.of(0.5, -1, 0.25)]],
		[[output]],
	), true);
	assert.deepEqual([...output], [1, -2, 0.5]);
	assert.throws(() => new ReviewedEffectWorkletProcessor({
		processorOptions: {
			packageKey: 'org.example.unreviewed@1.0.0',
			abiVersion: 1,
			wasmModule: loadedPackage.module,
			channelCount: 1,
			parameterValues: [1],
		},
	}), /not realtime-approved/u);
});

test('realtime host uses its static source and prevalidated catalog module', async () => {
	const previousNode = globalThis.AudioWorkletNode;
	let addedModule = '';
	let capturedOptions: AudioWorkletNodeOptions | undefined;
	class MockAudioWorkletNode {
		readonly port = { postMessage: () => undefined };
		constructor(_context: BaseAudioContext, _name: string, options?: AudioWorkletNodeOptions) {
			capturedOptions = options;
		}
	}
	Object.defineProperty(globalThis, 'AudioWorkletNode', {
		configurable: true,
		writable: true,
		value: MockAudioWorkletNode,
	});
	const context = {
		audioWorklet: {
			addModule: async (url: string) => { addedModule = url; },
		},
	} as unknown as BaseAudioContext;
	try {
		await createReviewedEffectRealtimeNode(context, utilityGainReference, {
			channelCount: 2,
			parameters: { gain: 0.5 },
		});
		assert.match(addedModule, /realtime-worklet\.js/u);
		assert.ok(capturedOptions?.processorOptions?.wasmModule instanceof WebAssembly.Module);
		assert.equal(capturedOptions?.processorOptions?.packageKey, 'org.soundscaper.utility-gain@1.0.0');
		assert.equal(capturedOptions?.channelCount, 2);
	} finally {
		if (previousNode === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else Object.defineProperty(globalThis, 'AudioWorkletNode', {
			configurable: true,
			writable: true,
			value: previousNode,
		});
	}
});

type FakeWorkerEvent = Readonly<{ data?: unknown; error?: unknown; message?: string }>;
type FakeWorkerListener = (event: FakeWorkerEvent) => void;

function runtimeWorkerPort(): FakeWorkerPort {
	const runtime = createReviewedEffectWorkerRuntime();
	return new FakeWorkerPort((message, currentPort) => {
		queueMicrotask(() => {
			void runtime.execute(message).then((response) => currentPort.emit('message', { data: response }));
		});
	});
}

function preparedWorkerPort(
	onProcess: (message: unknown, port: FakeWorkerPort) => void,
): FakeWorkerPort {
	return new FakeWorkerPort((message, currentPort) => {
		const request = message as Readonly<{ type: string; requestId: string }>;
		if (request.type === REVIEWED_EFFECT_WORKER_PREPARE) {
			queueMicrotask(() => currentPort.emit('message', {
				data: {
					type: 'ready',
					requestId: request.requestId,
					packageKey: 'org.soundscaper.utility-gain@1.0.0',
				},
			}));
			return;
		}
		onProcess(message, currentPort);
	});
}

class FakeWorkerPort implements ReviewedEffectWorkerPort {
	readonly listeners = new Map<string, Set<FakeWorkerListener>>();
	readonly onPost: (message: unknown, port: FakeWorkerPort) => void;
	terminateCount = 0;

	constructor(onPost: (message: unknown, port: FakeWorkerPort) => void) {
		this.onPost = onPost;
	}

	addEventListener(type: 'message' | 'messageerror' | 'error', listener: FakeWorkerListener): void {
		let listeners = this.listeners.get(type);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(type, listeners);
		}
		listeners.add(listener);
	}

	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: FakeWorkerListener): void {
		this.listeners.get(type)?.delete(listener);
	}

	postMessage(message: unknown, _transfer?: readonly Transferable[]): void {
		this.onPost(message, this);
	}

	terminate(): void {
		this.terminateCount += 1;
	}

	emit(type: 'message' | 'messageerror' | 'error', event: FakeWorkerEvent): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

function assertCode(operation: () => unknown, code: ReviewedEffectError['code']): void {
	assert.throws(operation, (error: unknown) => isCode(error, code));
}

function isCode(error: unknown, code: ReviewedEffectError['code']): error is ReviewedEffectError {
	return error instanceof ReviewedEffectError && error.code === code;
}

function findSequence(bytes: Uint8Array, sequence: readonly number[]): number {
	for (let offset = 0; offset <= bytes.length - sequence.length; offset += 1) {
		if (sequence.every((byte, index) => bytes[offset + index] === byte)) return offset;
	}
	throw new Error(`Byte sequence was not found: ${sequence.join(',')}`);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

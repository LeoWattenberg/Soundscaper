/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	OfxIsolatedHostManager,
	type OfxCpuAttempt,
	type OfxIsolatedWorkerPort,
} from '../desktop/openfx-isolated-host-manager.ts';
import {
	deserializeHelperError,
	serializeHelperError,
} from '../desktop/helper-contract.ts';
import type {
	HelperJobRequest,
	HelperSupervisorSnapshot,
} from '../desktop/helper-supervisor.ts';
import {
	createOfxHostInvocationV1,
	OfxRetryableGpuError,
} from '../src/common/editor/native-ofx-host-contract.ts';

const PLUGIN_SHA = 'ab'.repeat(32);
const OTHER_SHA = 'cd'.repeat(32);
const STREAM_BYTES = new Uint8Array([1, 2, 3, 4]);
const STREAM_SHA = createHash('sha256').update(STREAM_BYTES).digest('hex');

class Worker implements OfxIsolatedWorkerPort {
	readonly requests: Array<HelperJobRequest<'ofx-scan' | 'ofx-host'>> = [];
	disposals = 0;
	failure: Error | null = null;

	async runJob<Kind extends 'ofx-scan' | 'ofx-host'>(
		request: HelperJobRequest<Kind>,
	): Promise<unknown> {
		this.requests.push(request as HelperJobRequest<'ofx-scan' | 'ofx-host'>);
		if (this.failure) throw this.failure;
		const completion = {
			streamId: 'ef'.repeat(20), byteLength: STREAM_BYTES.byteLength, sha256: STREAM_SHA,
		};
		return request.kind === 'ofx-scan' ? { descriptor: completion } : { output: completion };
	}

	snapshot(): HelperSupervisorSnapshot {
		return { state: 'ready', recentCrashes: 0, quarantined: false };
	}

	clearQuarantine(): void {}

	dispose(): void { this.disposals += 1; }
}

test('each scan is short lived and each exact binary fingerprint owns one runtime', async () => {
	const scanners: Worker[] = [];
	const runtimes = new Map<string, Worker>();
	const manager = new OfxIsolatedHostManager({
		createScanner: () => {
			const worker = new Worker();
			scanners.push(worker);
			return worker;
		},
		createRuntime: (fingerprint) => {
			const worker = new Worker();
			runtimes.set(fingerprint, worker);
			return worker;
		},
	});

	await manager.scan(scanRequest(PLUGIN_SHA));
	await manager.scan(scanRequest(PLUGIN_SHA));
	assert.equal(scanners.length, 2);
	assert.deepEqual(scanners.map(({ disposals }) => disposals), [1, 1]);

	const invocation = invocationFor('gpu-1', PLUGIN_SHA, 'cuda');
	await manager.host(invocation, hostRequest(invocation));
	const secondInvocation = invocationFor('gpu-2', PLUGIN_SHA, 'cuda');
	await manager.host(secondInvocation, hostRequest(secondInvocation));
	assert.equal(runtimes.size, 1);
	assert.equal(runtimes.get(invocation.pluginFingerprint)?.requests.length, 2);
	assert.deepEqual(manager.snapshot().runtimes, [{
		pluginFingerprint: invocation.pluginFingerprint,
		state: 'ready',
		quarantined: false,
		degradedBackends: [],
	}]);

	manager.dispose();
	assert.equal(runtimes.get(invocation.pluginFingerprint)?.disposals, 1);
});

test('a runtime refuses a mismatched grant before spawning or disclosing a path', async () => {
	let runtimeSpawns = 0;
	const manager = new OfxIsolatedHostManager({
		createScanner: () => new Worker(),
		createRuntime: () => { runtimeSpawns += 1; return new Worker(); },
	});
	const invocation = invocationFor('mismatch', PLUGIN_SHA, 'cpu');
	await assert.rejects(
		manager.host(invocation, hostRequest(invocation, { pluginSha: OTHER_SHA })),
		/fingerprint|binary|digest/iu,
	);
	const sibling = invocationFor('different-invocation', PLUGIN_SHA, 'cpu');
	await assert.rejects(
		manager.host(invocation, hostRequest(sibling)),
		/exact admitted invocation/iu,
	);
	assert.equal(runtimeSpawns, 0);
	assert.equal(JSON.stringify(manager.snapshot()).includes('/plugins'), false);
	manager.dispose();
});

test('only typed GPU failures retry once on CPU in the same fingerprint process', async (context) => {
	for (const code of ['OFX_UNSUPPORTED_BACKEND', 'OFX_GPU_EXECUTION_FAILED'] as const) {
		await context.test(code, async () => {
			const runtime = new Worker();
			let attempts = 0;
			runtime.runJob = async function runJob<Kind extends 'ofx-scan' | 'ofx-host'>(
				request: HelperJobRequest<Kind>,
			): Promise<unknown> {
				this.requests.push(request as HelperJobRequest<'ofx-scan' | 'ofx-host'>);
				attempts += 1;
				if (attempts === 1) {
					throw deserializeHelperError(serializeHelperError(
						new OfxRetryableGpuError(code, 'cuda device lost'),
					));
				}
				return { output: {
					streamId: 'ef'.repeat(20), byteLength: STREAM_BYTES.byteLength, sha256: STREAM_SHA,
				} };
			};
			const manager = new OfxIsolatedHostManager({
				createScanner: () => new Worker(),
				createRuntime: () => runtime,
			});
			const gpuInvocation = invocationFor('gpu', PLUGIN_SHA, 'cuda');
			const result = await manager.renderWithCpuFallback({
				invocation: gpuInvocation,
				request: hostRequest(gpuInvocation),
				createCpuAttempt: () => {
					const invocation = invocationFor('cpu', PLUGIN_SHA, 'cpu');
					return { invocation, request: hostRequest(invocation) };
				},
			});
			assert.equal(attempts, 2);
			assert.deepEqual(result, {
				backend: 'cpu',
				retriedOnCpu: true,
				reportsDegradation: true,
				result: { output: {
					streamId: 'ef'.repeat(20), byteLength: STREAM_BYTES.byteLength, sha256: STREAM_SHA,
				} },
			});
			const retained = await manager.renderWithCpuFallback({
				invocation: gpuInvocation,
				request: hostRequest(gpuInvocation),
				createCpuAttempt: () => {
					const invocation = invocationFor('cpu-retained', PLUGIN_SHA, 'cpu');
					return { invocation, request: hostRequest(invocation) };
				},
			});
			assert.equal(attempts, 3, 'a degraded GPU backend is not retried on each frame');
			assert.equal(retained.backend, 'cpu');
			assert.equal(retained.retriedOnCpu, true);
			assert.deepEqual(manager.snapshot().runtimes[0]?.degradedBackends, ['cuda']);
			manager.clearQuarantine(gpuInvocation.pluginFingerprint);
			assert.deepEqual(manager.snapshot().runtimes[0]?.degradedBackends, []);
			manager.dispose();
		});
	}
});

test('authentication, contract, resource, quarantine, and authority errors never retry on CPU', async (context) => {
	const failures = [
		codedError('HELPER_GRANT_IDENTITY_MISMATCH', 'authentication failed'),
		codedError('HELPER_CONTRACT_VIOLATION', 'contract failed'),
		codedError('HELPER_RESOURCE_LIMIT', 'resource failed'),
		codedError('HELPER_QUARANTINED', 'runtime quarantined'),
		codedError('OFX_AUTHORITY_REVOKED', 'authority revoked'),
		codedError('OFX_UNSUPPORTED_BACKEND', 'untyped retry code'),
		new Error('untyped GPU process failure'),
	];
	for (const failure of failures) {
		await context.test(failure.message, async () => {
			const runtime = new Worker();
			runtime.failure = failure;
			let cpuAttempts = 0;
			const manager = new OfxIsolatedHostManager({
				createScanner: () => new Worker(),
				createRuntime: () => runtime,
			});
			const gpuInvocation = invocationFor('gpu', PLUGIN_SHA, 'cuda');
			await assert.rejects(manager.renderWithCpuFallback({
				invocation: gpuInvocation,
				request: hostRequest(gpuInvocation),
				createCpuAttempt: () => {
					cpuAttempts += 1;
					const invocation = invocationFor('cpu', PLUGIN_SHA, 'cpu');
					return { invocation, request: hostRequest(invocation) };
				},
			}), (error: unknown) => error === failure);
			assert.equal(cpuAttempts, 0);
			assert.equal(runtime.requests.length, 1);
			manager.dispose();
		});
	}
});

test('cancellation and CPU failures never trigger another retry', async () => {
	const controller = new AbortController();
	const runtime = new Worker();
	runtime.runJob = async () => {
		controller.abort();
		throw new DOMException('cancelled', 'AbortError');
	};
	const manager = new OfxIsolatedHostManager({
		createScanner: () => new Worker(),
		createRuntime: () => runtime,
	});
	const gpuInvocation = invocationFor('gpu', PLUGIN_SHA, 'cuda');
	await assert.rejects(manager.renderWithCpuFallback({
		invocation: gpuInvocation,
		request: hostRequest(gpuInvocation, { signal: controller.signal }),
		createCpuAttempt: () => {
			const invocation = invocationFor('cpu', PLUGIN_SHA, 'cpu');
			return { invocation, request: hostRequest(invocation) };
		},
	}), /cancel/iu);
	assert.equal(runtime.requests.length, 0, 'the worker double aborted before recording a request');

	runtime.runJob = async () => { throw new Error('cpu failed'); };
	const cpuInvocation = invocationFor('cpu-only', PLUGIN_SHA, 'cpu');
	await assert.rejects(manager.renderWithCpuFallback({
		invocation: cpuInvocation,
		request: hostRequest(cpuInvocation),
		createCpuAttempt: () => { throw new Error('must not be called'); },
	}), /cpu failed/iu);
	manager.dispose();
});

function invocationFor(
	id: string,
	pluginBinarySha256: string,
	requestedBackend: 'cpu' | 'cuda',
) {
	return createOfxHostInvocationV1({
		invocationId: id,
		unifiedPlanVersion: 12,
		unifiedPlanSha256: STREAM_SHA,
		nodeId: 'openfx-node',
		instanceId: 'ofx-instance-1',
		pluginId: 'net.example.Blur',
		pluginBinarySha256,
		context: 'filter',
		action: 'render',
		stateSha256: '12'.repeat(32),
		inputFrameStreamIds: ['34'.repeat(20)],
		outputFrameStreamId: 'ef'.repeat(20),
		outputOrdinal: 3,
		requestedBackend,
		abortSignalId: `abort-${id}`,
	});
}

function codedError(code: string, message: string): Error {
	const error = new Error(message) as Error & { code: string };
	error.code = code;
	return error;
}

function scanRequest(pluginSha: string): HelperJobRequest<'ofx-scan'> {
	return {
		kind: 'ofx-scan',
		grant: {
			executable: executable('ofx-scanner', '/runtime/ofx-scanner', '34'.repeat(32)),
			pluginBinary: executable('ofx-plugin', '/plugins/example.ofx', pluginSha),
			descriptor: outputReservation(null),
			scratch: scratch(),
		},
	};
}

function hostRequest(
	invocation: ReturnType<typeof invocationFor>,
	options: Readonly<{ readonly pluginSha?: string; readonly signal?: AbortSignal }> = {},
): OfxCpuAttempt['request'] {
	return {
		kind: 'ofx-host',
		grant: {
			executable: executable('ofx-host', '/runtime/ofx-host', '56'.repeat(32)),
			pluginBinary: executable(
				'ofx-plugin', '/plugins/example.ofx', options.pluginSha ?? invocation.pluginBinarySha256,
			),
			invocation,
			plan: binding('host-to-helper', '12'.repeat(20)),
			inputs: [{
				name: 'Source', sourceRef: 'source-1',
				pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4,
				frame: binding('host-to-helper', '34'.repeat(20)),
			}],
			output: {
				pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4,
				frame: outputReservation(STREAM_BYTES.byteLength),
			},
			scratch: scratch(),
		},
		...(options.signal ? { signal: options.signal } : {}),
	};
}

function executable(role: 'ofx-scanner' | 'ofx-host' | 'ofx-plugin', path: string, sha256: string) {
	return { role, path, bytes: 32_768, sha256, identity: { dev: 4, ino: 18 } };
}

function binding(direction: 'host-to-helper' | 'helper-to-host', streamId = 'ef'.repeat(20)) {
	return {
		dataPlaneVersion: 1 as const,
		transport: 'message-port' as const,
		streamId,
		direction,
		byteLength: STREAM_BYTES.byteLength,
		sha256: STREAM_SHA,
		maximumChunkBytes: STREAM_BYTES.byteLength,
		maximumInFlightChunks: 1,
	};
}

function outputReservation<const Length extends number | null>(exactByteLength: Length) {
	return {
		dataPlaneVersion: 1 as const, transport: 'message-port' as const,
		streamId: 'ef'.repeat(20), direction: 'helper-to-host' as const,
		exactByteLength, maximumByteLength: exactByteLength ?? 4_096,
		maximumChunkBytes: exactByteLength ?? 4_096, maximumInFlightChunks: 1,
	};
}

function scratch() {
	return {
		rootPath: '/scratch/framescaper',
		rootIdentity: { dev: 4, ino: 21 },
		reservationId: '78'.repeat(20),
		maximumBytes: 8_192,
	};
}

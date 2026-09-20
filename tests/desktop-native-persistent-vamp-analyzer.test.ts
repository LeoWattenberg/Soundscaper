/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createNativePersistentVampAnalyzerJobRunner } from '../desktop/native-helper-persistent-vamp-analyzer-job.js';
import { createNativeVampAnalyzerBackendFactory } from '../desktop/native-vamp-analyzer-helper-backend.ts';
import type { VampAnalyzerDescriptor } from '../desktop/vamp-analyzer-contract.ts';
import type { VampAnalyzerExecutionGrant } from '../desktop/vamp-analyzer-registry.ts';

test('the supervised persistent analyzer path configures, streams, finishes and closes pathlessly', async () => {
	const links: ReturnType<typeof channel>[] = [];
	const calls: string[] = [];
	let supervisorDisposals = 0;
	const runner = createNativePersistentVampAnalyzerJobRunner({
		addonPath: '/authenticated/peer', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64), identity: { dev: 1, ino: 2 } }),
		loadAddon: async () => ({
			openExactAnalyzer: (path: string, identifier: string) => {
				assert.equal(path, '/analyzers/fixture.so');
				assert.equal(identifier, 'org.example.energy');
				calls.push('open');
				return Object.freeze({});
			},
			configureAnalyzer: () => { calls.push('configure'); return { outputs: DESCRIPTOR.outputs }; },
			processAnalyzerPcm: (_instance: unknown, chunk: { startFrame: number }) => {
				calls.push(`process:${String(chunk.startFrame)}`);
				return [{ outputId: 'energy', timestamp: null, duration: null, values: [0.5], label: '' }];
			},
			finishAnalyzer: () => { calls.push('finish'); return []; },
			cancelAnalyzer: () => { calls.push('cancel'); },
			closeAnalyzer: () => { calls.push('close'); },
		}),
	});
	const supervisor = {
		runJob: (request: Record<string, unknown>) => {
			const port = (request.dataPlaneTransfers as { port: FakePort }[])[0].port;
			const handle = runner({
				grant: request.grant, ports: [port], resourcePolicy: RESOURCE_POLICY,
			});
			return handle.completion;
		},
		dispose: () => { supervisorDisposals += 1; },
	};
	const backend = createNativeVampAnalyzerBackendFactory({
		supervisorFor: () => supervisor as never,
		createChannel: () => { const link = channel(); links.push(link); return link as never; },
		mintStreamId: () => 'a'.repeat(40),
	});
	const instance = await backend.open(GRANT);
	const configured = await instance.configure(CONFIGURATION);
	assert.deepEqual(configured.outputs, DESCRIPTOR.outputs);
	const features = await instance.process({
		startFrame: 0, frameCount: 4, channels: [Float32Array.of(1, 2, 3, 4)],
	});
	assert.deepEqual(features, [
		{ outputId: 'energy', timestamp: null, duration: null, values: [0.5], label: '' },
	]);
	assert.deepEqual(await instance.finish(), []);
	await instance.close();
	assert.deepEqual(calls, ['open', 'configure', 'process:0', 'finish', 'close']);
	assert.equal(links[0].port1.closed, true);
	assert.equal(supervisorDisposals, 1);
	assert.equal(JSON.stringify(configured).includes('/analyzers/'), false);
});

test('persistent analyzer cancellation fences a pending operation and releases the exact peer once', async () => {
	const link = channel();
	let release!: () => void;
	let announce!: () => void;
	const started = new Promise<void>((resolve) => { announce = resolve; });
	const blocked = new Promise<void>((resolve) => { release = resolve; });
	let cancels = 0, closes = 0;
	const runner = createNativePersistentVampAnalyzerJobRunner({
		addonPath: '/peer', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64), identity: { dev: 1, ino: 2 } }),
		loadAddon: async () => ({
			openExactAnalyzer: () => Object.freeze({}),
			configureAnalyzer: () => ({ outputs: DESCRIPTOR.outputs }),
			processAnalyzerPcm: async () => { announce(); await blocked; return []; },
			cancelAnalyzer: () => { cancels += 1; }, closeAnalyzer: () => { closes += 1; },
		}),
	});
	const handle = runner({ grant: HELPER_GRANT, ports: [link.port1], resourcePolicy: RESOURCE_POLICY });
	const answer = nextMessage(link.port2);
	link.port2.postMessage({ protocolVersion: 1, kind: 'configure', requestId: 'configure-1', configuration: CONFIGURATION });
	assert.equal((await answer).kind, 'configured');
	link.port2.postMessage({
		protocolVersion: 1, kind: 'process', requestId: 'process-1',
		chunk: { startFrame: 0, frameCount: 4, channels: [Float32Array.of(1, 2, 3, 4)] },
	});
	await started;
	const cancellation = handle.cancel();
	release();
	await cancellation;
	assert.equal((await handle.completion).reason, 'user-cancelled');
	assert.equal(cancels, 1);
	assert.equal(closes, 1);
	assert.equal(link.port1.closed, true);
});

test('the main analyzer backend cancels out of band while process is awaiting its helper', async () => {
	const link = channel();
	let processStarted!: () => void;
	const processingRequest = new Promise<void>((resolve) => { processStarted = resolve; });
	let supervisorDisposals = 0;
	let settleCompletion!: (value: unknown) => void;
	const completion = new Promise((resolve) => { settleCompletion = resolve; });
	link.port1.on('message', ({ data }: { data: Record<string, unknown> }) => {
		if (data.kind === 'configure') {
			link.port1.postMessage({
				protocolVersion: 1, kind: 'configured', requestId: data.requestId,
				outputs: DESCRIPTOR.outputs,
			});
		} else if (data.kind === 'process') processStarted();
	});
	const backend = createNativeVampAnalyzerBackendFactory({
		supervisorFor: () => ({
			runJob: () => completion,
			dispose: () => {
				supervisorDisposals += 1;
				settleCompletion({ reason: 'disposed' });
			},
		}),
		createChannel: () => link as never,
		mintStreamId: () => 'b'.repeat(40),
		mintRequestId: (() => {
			let next = 0;
			return () => `request-${String(next += 1)}`;
		})(),
	});
	const instance = await backend.open(GRANT);
	await instance.configure(CONFIGURATION);
	const processing = instance.process({
		startFrame: 0, frameCount: 4, channels: [Float32Array.of(1, 2, 3, 4)],
	});
	await processingRequest;

	const cancellation = instance.cancel('user-cancelled');
	assert.equal(await Promise.race([
		cancellation.then(() => 'cancelled'),
		new Promise<'blocked'>((resolve) => setImmediate(() => resolve('blocked'))),
	]), 'cancelled', 'cancel must not join the queued RPC tail');
	await assert.rejects(processing, /cancelled/iu);
	assert.equal(link.port2.closed, true);
	assert.equal(supervisorDisposals, 1);
	await instance.close();
	assert.equal(supervisorDisposals, 1, 'close after cancellation remains idempotent');
});

const DESCRIPTOR: VampAnalyzerDescriptor = Object.freeze({
	kind: 'analyzer', format: 'vamp', identifier: 'org.example.energy', name: 'Energy',
	description: '', maker: 'Example', copyright: '', pluginVersion: 1, vampApiVersion: 2,
	inputDomain: 'time', minimumChannels: 1, maximumChannels: 1,
	preferredStepSize: 4, preferredBlockSize: 4, parameters: Object.freeze([]), programs: Object.freeze([]),
	outputs: Object.freeze([{ identifier: 'energy', name: 'Energy', description: '', unit: '',
		binCount: 1, binNames: Object.freeze([]), extents: null, quantizeStep: null,
		sampleType: 'one-sample-per-step' as const, sampleRate: null, hasDuration: false }]),
});

const CONFIGURATION = Object.freeze({
	sampleRate: 48_000, channelCount: 1, stepSize: 4, blockSize: 4,
	frameCount: 4, parameters: Object.freeze({}), program: null,
});

const GRANT: VampAnalyzerExecutionGrant = Object.freeze({
	kind: 'vamp-analyzer', format: 'vamp', analyzerIdentifier: DESCRIPTOR.identifier,
	libraryPath: '/analyzers/fixture.so', libraryBytes: 10, librarySha256: 'd'.repeat(64),
	identity: Object.freeze({ dev: 1, ino: 2 }), descriptor: DESCRIPTOR,
});

const HELPER_GRANT = Object.freeze({
	binaryPath: GRANT.libraryPath, binaryBytes: GRANT.libraryBytes, binarySha256: GRANT.librarySha256,
	format: 'vamp', stableId: GRANT.analyzerIdentifier, identity: GRANT.identity,
	persistentPort: Object.freeze({
		portContractVersion: 1, transport: 'message-port', purpose: 'plugin-analyzer-rpc',
		streamId: 'a'.repeat(40), generation: 1, maximumMessageBytes: 16 * 1_024 * 1_024,
		maximumInFlightMessages: 8,
	}),
});

const RESOURCE_POLICY = Object.freeze({
	maximumInputBytes: 16 * 1_024 * 1_024, maximumJobDurationMs: 60_000,
	maximumRssBytes: 512 * 1_024 * 1_024, allowNetwork: false,
	allowChildProcesses: false, allowOutputFiles: false,
});

class FakePort extends EventEmitter {
	peer: FakePort | null = null;
	closed = false;
	start(): void {}
	postMessage(message: unknown, _transfer: readonly unknown[] = []): void {
		if (this.closed || !this.peer || this.peer.closed) return;
		queueMicrotask(() => this.peer?.emit('message', { data: message }));
	}
	close(): void { this.closed = true; }
}

function channel() {
	const port1 = new FakePort(), port2 = new FakePort();
	port1.peer = port2; port2.peer = port1;
	return { port1, port2 };
}

function nextMessage(port: FakePort): Promise<Record<string, unknown>> {
	return new Promise((resolve) => port.once('message', ({ data }) => resolve(data as Record<string, unknown>)));
}

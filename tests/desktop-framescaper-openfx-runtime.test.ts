/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { HelperChannel, HelperJobRequest } from '../desktop/helper-supervisor.ts';
import type {
	HelperOfxHostJobGrant,
	HelperOfxScanJobGrant,
} from '../desktop/helper-contract.ts';
import {
	startFramescaperOpenFxRuntime,
	validateFramescaperOpenFxHelperProcessConfig,
} from '../desktop/framescaper-openfx-runtime.ts';
import { createOfxHostInvocationV1 } from '../src/common/editor/native-ofx-host-contract.ts';

const SCANNER = Buffer.from('synthetic-ofx-scanner');
const RUNTIME_HOST = Buffer.from('synthetic-ofx-runtime-host');
const SCANNER_SHA = digest(SCANNER);
const RUNTIME_SHA = digest(RUNTIME_HOST);
const PLUGIN_SHA = 'ab'.repeat(32);
const BYTES = new Uint8Array([1, 2, 3, 4]);
const BYTES_SHA = digest(BYTES);

test('an empty pending-external manifest creates no OpenFX manager or process', async () => {
	let spawns = 0;
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(),
		payloadPorts: ports(manifest(false)),
		spawnHelper: () => { spawns += 1; throw new Error('must remain unreachable'); },
	});
	assert.equal(runtime.available(), false);
	assert.equal(runtime.manager, null);
	assert.match(runtime.reason ?? '', /pending-external/iu);
	assert.equal(spawns, 0);
	assert.equal(runtime.dispose(), true);
});

test('a built payload without reviewed isolation and real plug-in evidence creates no manager', async () => {
	let spawns = 0;
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(),
		payloadPorts: ports(manifest(true, false)),
		spawnHelper: () => { spawns += 1; throw new Error('must remain unreachable'); },
	});
	assert.equal(runtime.available(), false);
	assert.equal(runtime.selfTestPassed(), false);
	assert.equal(runtime.manager, null);
	assert.match(runtime.reason ?? '', /production-readiness-unattested/iu);
	assert.equal(spawns, 0);
});

test('scanner processes are single-use and runtime utility processes are partitioned by fingerprint', async () => {
	const spawns: Array<Readonly<{ mode: string; fingerprint: string | null }>> = [];
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(),
		payloadPorts: ports(manifest(true)),
		mintJobId: (() => {
			let index = 0;
			return () => (++index).toString(16).padStart(40, '0');
		})(),
		spawnHelper: (_descriptor, mode, fingerprint) => {
			spawns.push({ mode, fingerprint });
			return new Channel(mode === 'scanner' ? 'ofx-scan' : 'ofx-host');
		},
	});
	assert.equal(runtime.available(), true);
	assert.ok(runtime.manager);
	await runtime.manager!.scan(scanRequest());
	await runtime.manager!.scan(scanRequest());

	const first = invocation('first', PLUGIN_SHA);
	await runtime.manager!.host(first, hostRequest(first));
	const second = invocation('second', PLUGIN_SHA);
	await runtime.manager!.host(second, hostRequest(second));
	const other = invocation('other', 'cd'.repeat(32));
	await runtime.manager!.host(other, hostRequest(other));

	assert.deepEqual(spawns, [
		{ mode: 'scanner', fingerprint: null },
		{ mode: 'scanner', fingerprint: null },
		{ mode: 'runtime', fingerprint: first.pluginFingerprint },
		{ mode: 'runtime', fingerprint: other.pluginFingerprint },
	]);
	assert.equal(runtime.manager!.snapshot().runtimes.length, 2);
	assert.equal(runtime.dispose(), true);
	assert.equal(runtime.available(), false);
});

test('composition refuses a grant that swaps either selected host executable', async () => {
	let spawns = 0;
	const runtime = await startFramescaperOpenFxRuntime({
		location: location(), payloadPorts: ports(manifest(true)),
		spawnHelper: (_descriptor, mode) => {
			spawns += 1;
			return new Channel(mode === 'scanner' ? 'ofx-scan' : 'ofx-host');
		},
	});
	const scan = scanRequest();
	await assert.rejects(runtime.manager!.scan({
		...scan,
		grant: { ...scan.grant, executable: { ...scan.grant.executable, sha256: 'ef'.repeat(32) } },
	}), /authenticated scanner payload/iu);
	const invoke = invocation('host', PLUGIN_SHA);
	const request = hostRequest(invoke);
	await assert.rejects(runtime.manager!.host(invoke, {
		...request,
		grant: { ...request.grant, executable: { ...request.grant.executable, path: '/runtime/swapped' } },
	}), /authenticated runtime-host payload/iu);
	assert.equal(spawns, 0);
	runtime.dispose();
});

test('the utility-process config is closed and binds scanner versus runtime fingerprint modes', () => {
	const descriptor = {
		target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
		openfxVersion: '1.5.1', openfxCommit: 'ab77951',
		scanner: {
			path: '/runtime/scanner', byteLength: SCANNER.byteLength, sha256: SCANNER_SHA,
			identity: { dev: 7, ino: 19 },
		},
		runtimeHost: {
			path: '/runtime/host', byteLength: RUNTIME_HOST.byteLength, sha256: RUNTIME_SHA,
			identity: { dev: 7, ino: 20 },
		},
	};
	assert.equal(validateFramescaperOpenFxHelperProcessConfig({
		descriptor, mode: 'scanner', pluginFingerprint: null,
	}).mode, 'scanner');
	assert.equal(validateFramescaperOpenFxHelperProcessConfig({
		descriptor, mode: 'runtime', pluginFingerprint: `net.example.Blur@${PLUGIN_SHA}`,
	}).pluginFingerprint, `net.example.Blur@${PLUGIN_SHA}`);
	assert.throws(() => validateFramescaperOpenFxHelperProcessConfig({
		descriptor, mode: 'runtime', pluginFingerprint: null,
	}), /fingerprint/iu);
	assert.throws(() => validateFramescaperOpenFxHelperProcessConfig({
		descriptor, mode: 'scanner', pluginFingerprint: null, executablePath: '/forged',
	}), /closed shape/iu);
});

class Channel implements HelperChannel {
	readonly #kind: 'ofx-scan' | 'ofx-host';
	#message: ((message: unknown) => void) | null = null;
	#exit: ((code: number | null) => void) | null = null;

	constructor(kind: 'ofx-scan' | 'ofx-host') { this.#kind = kind; }

	postMessage(message: unknown): void {
		const record = message as Readonly<Record<string, unknown>>;
		if (record.type !== 'job') return;
		const grant = record.grant as Readonly<Record<string, unknown>>;
		const binding = (this.#kind === 'ofx-scan'
			? (grant as unknown as HelperOfxScanJobGrant).descriptor
			: (grant as unknown as HelperOfxHostJobGrant).output.frame) as
			Readonly<{ streamId: string }>;
		const completion = {
			streamId: binding.streamId, byteLength: BYTES.byteLength, sha256: BYTES_SHA,
		};
		queueMicrotask(() => this.#message?.({
			contractVersion: 1, type: 'result', jobId: record.jobId,
			result: this.#kind === 'ofx-scan'
				? { descriptor: completion } : { output: completion },
		}));
	}

	onMessage(listener: (message: unknown) => void): void {
		this.#message = listener;
		queueMicrotask(() => listener({ contractVersion: 1, type: 'hello', kinds: [this.#kind] }));
	}

	onExit(listener: (code: number | null) => void): void { this.#exit = listener; }

	kill(): void { this.#exit = null; }
}

function scanRequest(): HelperJobRequest<'ofx-scan'> {
	const descriptor = outputReservation('ef'.repeat(20), null);
	return {
		kind: 'ofx-scan',
		grant: {
			executable: executable('ofx-scanner', '/application/native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-scanner', SCANNER.byteLength, SCANNER_SHA),
			pluginBinary: executable('ofx-plugin', '/plugins/example.ofx', 32_768, PLUGIN_SHA),
			descriptor, scratch: scratch(),
		},
		dataPlaneTransfers: [{ streamId: descriptor.streamId, port: transferPort() }],
	};
}

function hostRequest(value: ReturnType<typeof invocation>): HelperJobRequest<'ofx-host'> {
	const plan = binding('host-to-helper', '12'.repeat(20));
	const input = binding('host-to-helper', '34'.repeat(20));
	const output = outputReservation('ef'.repeat(20), BYTES.byteLength);
	return {
		kind: 'ofx-host',
		grant: {
			executable: executable('ofx-host', '/application/native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-runtime-host', RUNTIME_HOST.byteLength, RUNTIME_SHA),
			pluginBinary: executable('ofx-plugin', '/plugins/example.ofx', 32_768, value.pluginBinarySha256),
			invocation: value, plan,
			inputs: [{
				name: 'Source', sourceRef: 'source-1', pixelFormat: 'rgba8',
				width: 1, height: 1, rowBytes: 4, frame: input,
			}],
			output: {
				pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4, frame: output,
			},
			scratch: scratch(),
		},
		dataPlaneTransfers: [plan, input, output].map((stream) => ({
			streamId: stream.streamId, port: transferPort(),
		})),
	};
}

function invocation(id: string, pluginSha: string) {
	return createOfxHostInvocationV1({
		invocationId: id, unifiedPlanVersion: 12, unifiedPlanSha256: BYTES_SHA,
		nodeId: 'openfx-node', instanceId: 'instance-1', pluginId: 'net.example.Blur',
		pluginBinarySha256: pluginSha, context: 'filter', action: 'render',
		stateSha256: '12'.repeat(32), inputFrameStreamIds: ['34'.repeat(20)],
		outputFrameStreamId: 'ef'.repeat(20), requestedBackend: 'cpu', abortSignalId: `abort-${id}`,
	});
}

function executable(
	role: 'ofx-scanner' | 'ofx-host' | 'ofx-plugin',
	path: string,
	bytes: number,
	sha256: string,
) {
	return { role, path, bytes, sha256, identity: { dev: 7, ino: 19 } };
}

function binding(direction: 'host-to-helper' | 'helper-to-host', streamId: string) {
	return {
		dataPlaneVersion: 1 as const, transport: 'message-port' as const, streamId, direction,
		byteLength: BYTES.byteLength, sha256: BYTES_SHA,
		maximumChunkBytes: BYTES.byteLength, maximumInFlightChunks: 1,
	};
}

function outputReservation<const Length extends number | null>(
	streamId: string,
	exactByteLength: Length,
) {
	return {
		dataPlaneVersion: 1 as const, transport: 'message-port' as const, streamId,
		direction: 'helper-to-host' as const, exactByteLength,
		maximumByteLength: exactByteLength ?? 4_096,
		maximumChunkBytes: exactByteLength ?? 4_096, maximumInFlightChunks: 1,
	};
}

function scratch() {
	return {
		rootPath: '/scratch/ofx', rootIdentity: { dev: 7, ino: 21 },
		reservationId: '78'.repeat(20), maximumBytes: 8_192,
	};
}

function transferPort() {
	return { postMessage() {}, close() {} };
}

function location() {
	return {
		applicationRoot: '/application', packaged: false, resourcesPath: '/unused',
		platform: 'linux', arch: 'x64',
	};
}

function ports(value: unknown) {
	return {
		readFile: async (path: string) => {
			if (path.endsWith('manifest.json')) return Buffer.from(JSON.stringify(value));
			return path.includes('scanner') ? SCANNER : RUNTIME_HOST;
		},
		stat: async (path: string) => ({
			isFile: () => true, isSymbolicLink: () => false,
			size: path.includes('scanner') ? SCANNER.byteLength : RUNTIME_HOST.byteLength,
			dev: 7, ino: 19,
		}),
	};
}

function manifest(built: boolean, attested = true) {
	const scannerPayload = {
		path: 'native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-scanner',
		byteLength: SCANNER.byteLength, sha256: SCANNER_SHA,
	};
	const runtimeHostPayload = {
		path: 'native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-runtime-host',
		byteLength: RUNTIME_HOST.byteLength, sha256: RUNTIME_SHA,
	};
	const targets = [
		['linux-x64', 'linux-x64'], ['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
		['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
	].map(([id, runtime], index) => ({
		id, runtime, status: index === 0 && built ? 'built' : 'pending-external',
		blockedBy: index === 0 && built ? null : 'No qualified synthetic OpenFX payload exists.',
		payload: index === 0 && built ? { scannerPayload, runtimeHostPayload } : null,
		productionReadiness: index === 0 && built && attested ? {
			schemaVersion: 1,
			status: 'reviewed',
			target: 'linux-x64',
			scannerSha256: scannerPayload.sha256,
			runtimeHostSha256: runtimeHostPayload.sha256,
			osIsolationAttested: true,
			realThirdPartyExecutionAttested: true,
			reviewedAt: '2026-08-22',
			reviewer: 'synthetic-test-reviewer',
			evidenceSha256: '34'.repeat(32),
		} : null,
	}));
	return {
		schemaVersion: 1, id: 'framescaper-openfx-host-1.0.0',
		sourceManifestPath: 'native/framescaper-openfx-host/source-manifest.json',
		openfx: { version: '1.5.1', commit: 'ab77951', sha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5' },
		runtimePrefix: 'native/framescaper-openfx-host',
		payloads: built ? [{ id: 'linux-x64', runtime: 'linux-x64', scannerPayload, runtimeHostPayload }] : [],
		targets,
	};
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

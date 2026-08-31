/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import type { FramescaperOpenFxHostDescriptor } from '../desktop/framescaper-openfx-host-payload.ts';
import type { HelperOfxHostJobGrant } from '../desktop/helper-contract.ts';
import {
	assertOpenFxHostOutput,
	createOpenFxHostProcessFailure,
	createOpenFxV12CancellationFrame,
	createOpenFxHelperJobRunner,
	openFxHostProcessArguments,
	selfTestFramescaperOpenFxHelper,
	type OpenFxHostProcessAuthority,
	type OpenFxHostProcessInvocation,
} from '../desktop/openfx-helper-job.ts';
import {
	receiveHelperDataPlaneReservedFile,
	sendHelperDataPlaneFile,
} from '../desktop/helper-data-plane-io.ts';
import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';
import type {
	HelperDataPlaneOutputReservation,
} from '../desktop/helper-data-plane-output-reservation.ts';
import { createOfxHostInvocationV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

test('the scanner runner authenticates both executables and publishes only exact descriptor bytes', async (context) => {
	const fixture = await createFixture(context);
	const descriptorBytes = scannerDescriptorBytes(fixture.plugin.sha256);
	const descriptorBinding = outputReservation('ef'.repeat(20), null, 64 * 1024);
	const channel = new MessageChannel();
	const invocations: OpenFxHostProcessInvocation[] = [];
	const authorities: OpenFxHostProcessAuthority[] = [];
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor,
		mode: 'scanner',
		pluginFingerprint: null,
		invokeHost: (invocation, authority) => {
			invocations.push(invocation);
			authorities.push(authority);
			return processHandle(Promise.resolve({
				exitCode: 0, stdout: String(descriptorBytes), stderr: '',
			}));
		},
	});
	const outputPath = join(fixture.root, 'descriptor.json');
	const receive = receiveHelperDataPlaneReservedFile({
		reservation: descriptorBinding,
		port: channel.port2 as unknown as HelperDataPlaneIoPort, path: outputPath,
	});
	const job = runner.run({
		kind: 'ofx-scan',
		grant: {
			executable: executable('ofx-scanner', fixture.descriptor.scanner),
			pluginBinary: executable('ofx-plugin', fixture.plugin),
			descriptor: descriptorBinding,
			scratch: fixture.scratch,
		},
		ports: [channel.port1 as unknown as HelperDataPlaneIoPort],
	});
	assert.deepEqual(await job.completion, { descriptor: await receive });
	assert.equal(String(await readFile(outputPath)), String(descriptorBytes));
	assert.deepEqual(invocations, [{
		executablePath: fixture.descriptor.scanner.path,
		arguments: [
			'--scan', join(fixture.scratch.rootPath, fixture.scratch.reservationId, 'plugin-binary.ofx'),
			'--sha256', fixture.plugin.sha256,
		],
	}]);
	assert.equal(authorities[0]!.plugin?.path,
		join(fixture.scratch.rootPath, fixture.scratch.reservationId, 'plugin-binary.ofx'));
	assert.equal(authorities[0]!.plugin?.kind, 'file');
	assert.deepEqual(authorities[0]!.readOnly, []);
	assert.deepEqual(authorities[0]!.writeOnly, []);
});

test('a per-fingerprint runner refuses a grant for a sibling plug-in before invoking native code', async (context) => {
	const fixture = await createFixture(context);
	let invocations = 0;
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor,
		mode: 'runtime',
		pluginFingerprint: `net.example.Blur@${fixture.plugin.sha256}`,
		invokeHost: () => {
			invocations += 1;
			return processHandle(Promise.reject(new Error('unreachable')));
		},
	});
	assert.throws(() => runner.run({
		kind: 'ofx-host',
		grant: {
			executable: executable('ofx-host', fixture.descriptor.runtimeHost),
			pluginBinary: executable('ofx-plugin', fixture.plugin),
			invocation: {
				pluginFingerprint: `net.example.Other@${fixture.plugin.sha256}`,
			} as never,
		} as never,
		ports: [],
	}), /fingerprint/iu);
	assert.equal(invocations, 0);
});

test('scanner results are fenced when the held plug-in path is replaced during execution', async (context) => {
	const fixture = await createFixture(context);
	const descriptorBytes = scannerDescriptorBytes(fixture.plugin.sha256);
	const descriptor = outputReservation('ed'.repeat(20), null, 64 * 1024);
	const invoked = deferred<void>();
	const processResult = deferred<Readonly<{ exitCode: number; stdout: string; stderr: string }>>();
	const channel = new MessageChannel();
	context.after(() => { channel.port1.close(); channel.port2.close(); });
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor, mode: 'scanner', pluginFingerprint: null,
		invokeHost: () => {
			invoked.resolve();
			return processHandle(processResult.promise);
		},
	});
	const job = runner.run({
		kind: 'ofx-scan',
		grant: {
			executable: executable('ofx-scanner', fixture.descriptor.scanner),
			pluginBinary: executable('ofx-plugin', fixture.plugin), descriptor,
			scratch: fixture.scratch,
		},
		ports: [channel.port1 as unknown as HelperDataPlaneIoPort],
	});
	await invoked.promise;
	const displaced = join(fixture.root, 'example-original.ofx');
	await rename(fixture.plugin.path, displaced);
	await writeFile(fixture.plugin.path, 'replacement plug-in');
	processResult.resolve({ exitCode: 0, stdout: String(descriptorBytes), stderr: '' });
	await assert.rejects(job.completion, /authenticated identity, length, or digest/iu);
	assert.equal(String(await readFile(fixture.plugin.path)), 'replacement plug-in');
});

test('scanner cleanup refuses a replacement scratch reservation identity', async (context) => {
	const fixture = await createFixture(context);
	const descriptorBytes = scannerDescriptorBytes(fixture.plugin.sha256);
	const descriptor = outputReservation('ec'.repeat(20), null, 64 * 1024);
	const invoked = deferred<void>();
	const processResult = deferred<Readonly<{ exitCode: number; stdout: string; stderr: string }>>();
	const channel = new MessageChannel();
	context.after(() => { channel.port1.close(); channel.port2.close(); });
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor, mode: 'scanner', pluginFingerprint: null,
		invokeHost: () => {
			invoked.resolve();
			return processHandle(processResult.promise);
		},
	});
	const job = runner.run({
		kind: 'ofx-scan',
		grant: {
			executable: executable('ofx-scanner', fixture.descriptor.scanner),
			pluginBinary: executable('ofx-plugin', fixture.plugin), descriptor,
			scratch: fixture.scratch,
		},
		ports: [channel.port1 as unknown as HelperDataPlaneIoPort],
	});
	await invoked.promise;
	const reservation = join(fixture.scratch.rootPath, fixture.scratch.reservationId);
	const displaced = join(fixture.scratch.rootPath, 'displaced-reservation');
	await rename(reservation, displaced);
	await mkdir(reservation);
	await writeFile(join(reservation, 'replacement-owner'), 'preserve');
	processResult.resolve({ exitCode: 0, stdout: String(descriptorBytes), stderr: '' });
	await assert.rejects(job.completion, /directory no longer|cleanup refused/iu);
	assert.equal(String(await readFile(join(reservation, 'replacement-owner'))), 'preserve');
});

test('runtime self-test results are fenced when its held executable path is replaced', async (context) => {
	const fixture = await createFixture(context);
	const invoked = deferred<void>();
	const processResult = deferred<Readonly<{ exitCode: number; stdout: string; stderr: string }>>();
	const running = selfTestFramescaperOpenFxHelper(
		fixture.descriptor, 'runtime', () => {
			invoked.resolve();
			return processHandle(processResult.promise);
		},
	);
	await invoked.promise;
	const displaced = join(fixture.root, 'runtime-original');
	await rename(fixture.descriptor.runtimeHost.path, displaced);
	await writeFile(fixture.descriptor.runtimeHost.path, 'replacement runtime');
	processResult.resolve({
		exitCode: 0,
		stdout: JSON.stringify({
			contractVersion: 1, mode: 'per-binary-fingerprint-runtime',
			openfx: '1.5.1', commit: 'ab77951', ok: true, contractFixture: false,
			networkSuiteExposed: false, arbitraryFilesystemSuiteExposed: false,
			vendorTopLevelWindowsExposed: false,
		}),
		stderr: '',
	});
	await assert.rejects(running, /authenticated identity, length, or digest/iu);
	assert.equal(String(await readFile(fixture.descriptor.runtimeHost.path)), 'replacement runtime');
});

test('a spooled OpenFX input replaced while the runtime runs cannot publish a result', async (context) => {
	const fixture = await createFixture(context);
	const raw = structuredClone(unifiedExactPlanFixture(12));
	const effect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!effect || !('state' in effect)) {
		throw new Error('The V12 OpenFX fixture node is unavailable.');
	}
	effect.state.pluginId = 'net.example.Blur';
	effect.state.binarySha256 = fixture.plugin.sha256;
	effect.state.context = 'filter';
	effect.state.attachment.kind = 'filter';
	const plan = createUnifiedExactRenderPlan(raw);
	const fingerprint = fingerprintNativeMediaPlan(plan);
	const planBytes = Buffer.from(fingerprint.canonical);
	const inputBytes = Buffer.from([9, 8, 7, 6]);
	const outputBytes = Buffer.from([9, 8, 7, 128]);
	const planBinding = binding('host-to-helper', '11'.repeat(20), planBytes);
	const inputBinding = binding('host-to-helper', '22'.repeat(20), inputBytes);
	const outputBinding = outputReservation('33'.repeat(20), outputBytes.byteLength);
	const invocation = createOfxHostInvocationV1({
		invocationId: 'input-replacement', unifiedPlanVersion: 12,
		unifiedPlanSha256: fingerprint.sha256, nodeId: effect.nodeId,
		instanceId: effect.state.instanceId, pluginId: effect.state.pluginId,
		pluginBinarySha256: effect.state.binarySha256, context: 'filter', action: 'render',
		stateSha256: fingerprintNativeMediaPlan(effect.state).sha256,
		inputFrameStreamIds: [inputBinding.streamId], outputFrameStreamId: outputBinding.streamId,
		outputOrdinal: 3,
		requestedBackend: 'cpu', abortSignalId: 'abort-input-replacement',
	});
	const planPath = join(fixture.root, 'plan-v12.json');
	const inputPath = join(fixture.root, 'input-v12.rgba');
	await Promise.all([writeFile(planPath, planBytes), writeFile(inputPath, inputBytes)]);
	const planChannel = new MessageChannel();
	const inputChannel = new MessageChannel();
	const outputChannel = new MessageChannel();
	context.after(() => {
		for (const channel of [planChannel, inputChannel, outputChannel]) {
			channel.port1.close(); channel.port2.close();
		}
	});
	const runtimeInvoked = deferred<Readonly<{
		grantPath: string; authority: OpenFxHostProcessAuthority;
	}>>();
	const finishRuntime = deferred<void>();
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor, mode: 'runtime',
		pluginFingerprint: invocation.pluginFingerprint,
		invokeHost: (nativeInvocation, authority) => {
			if (nativeInvocation.arguments[0] === '--scan') {
				return processHandle(Promise.resolve({
					exitCode: 0, stderr: '',
					stdout: String(scannerDescriptorBytes(fixture.plugin.sha256)),
				}));
			}
			const grantPath = nativeInvocation.arguments[1]!;
			runtimeInvoked.resolve({ grantPath, authority });
			return processHandle(finishRuntime.promise.then(async () => {
				const nativeGrant = JSON.parse(String(await readFile(grantPath))) as {
					output: { path: string };
				};
				await writeFile(nativeGrant.output.path, outputBytes, { flag: 'wx' });
				return {
					exitCode: 0, stderr: '', stdout: JSON.stringify({
						accepted: true, requestedBackend: 'cpu', backend: 'cpu',
						retriedOnCpu: false, reportsDegradation: false,
						gpuContextSetup: false, gpuContextReleased: false,
						outputStreamId: outputBinding.streamId,
						outputByteLength: outputBytes.byteLength,
						outputSha256: digest(outputBytes), outputWidth: 1,
						outputHeight: 1, outputRowBytes: 4,
					}),
				};
			}));
		},
	});
	const job = runner.run({
		kind: 'ofx-host',
		grant: {
			executable: executable('ofx-host', fixture.descriptor.runtimeHost),
			pluginBinary: executable('ofx-plugin', fixture.plugin), invocation,
			plan: planBinding,
			inputs: [{
				name: 'Source', sourceRef: 'source-1', pixelFormat: 'rgba8',
				width: 1, height: 1, rowBytes: 4, frame: inputBinding,
			}],
			output: {
				pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4,
				frame: outputBinding,
			},
			scratch: { ...fixture.scratch, maximumBytes: 1024 * 1024 },
		},
		ports: [planChannel.port1, inputChannel.port1, outputChannel.port1]
			.map((port) => port as unknown as HelperDataPlaneIoPort),
	});
	const transfers = Promise.all([
		sendHelperDataPlaneFile({
			binding: planBinding, port: planChannel.port2 as unknown as HelperDataPlaneIoPort,
			path: planPath,
		}),
		sendHelperDataPlaneFile({
			binding: inputBinding, port: inputChannel.port2 as unknown as HelperDataPlaneIoPort,
			path: inputPath,
		}),
	]);
	const { grantPath, authority } = await runtimeInvoked.promise;
	assert.equal(authority.plugin?.kind, 'file');
	assert.deepEqual(authority.readOnly.map(({ path }) => path.split('/').at(-1)), [
		'canonical-plan.json', 'input-00.rgba', 'v12-host-grant.json',
	]);
	assert.deepEqual(authority.writeOnly.map(({ path, kind }) => ({
		name: path.split('/').at(-1), kind,
	})), [{ name: 'native-output', kind: 'directory' }]);
	const nativeGrant = JSON.parse(String(await readFile(grantPath))) as {
		inputs: Array<{ path: string }>;
	};
	const stagedInput = nativeGrant.inputs[0]!.path;
	await rename(stagedInput, `${stagedInput}.displaced`);
	await writeFile(stagedInput, Buffer.from([1, 2, 3, 4]));
	finishRuntime.resolve();
	await assert.rejects(Promise.all([job.completion, transfers]), /authenticated identity, length, or digest/iu);
});

test('runtime output admits exact CPU reporting and rejects hidden GPU degradation', () => {
	const bytes = Buffer.from([1, 2, 3, 4]);
	const inspected = { byteLength: bytes.byteLength, sha256: digest(bytes) };
	const grant = {
		invocation: { requestedBackend: 'cpu' },
		output: {
			frame: { streamId: '90'.repeat(20), exactByteLength: bytes.byteLength },
			width: 1, height: 1, rowBytes: 4,
		},
	} as unknown as HelperOfxHostJobGrant;
	const exact = {
		accepted: true, requestedBackend: 'cpu', backend: 'cpu',
		retriedOnCpu: false, reportsDegradation: false,
		gpuContextSetup: false, gpuContextReleased: false,
		outputStreamId: '90'.repeat(20), outputByteLength: bytes.byteLength,
		outputSha256: inspected.sha256, outputWidth: 1, outputHeight: 1, outputRowBytes: 4,
	};
	assert.doesNotThrow(() => assertOpenFxHostOutput(JSON.stringify(exact), grant, inspected));
	assert.throws(() => assertOpenFxHostOutput(JSON.stringify({
		...exact, requestedBackend: 'cuda', backend: 'cpu',
		retriedOnCpu: true, reportsDegradation: true,
	}), { ...grant, invocation: { requestedBackend: 'cuda' } } as never, inspected), /backend/iu);
});

test('native runtime failures expose only the closed retryable GPU error codes', () => {
	for (const [nativeCode, wireCode] of [
		['unsupported-backend', 'OFX_UNSUPPORTED_BACKEND'],
		['gpu-execution-failed', 'OFX_GPU_EXECUTION_FAILED'],
	] as const) {
		const failure = createOpenFxHostProcessFailure({
			exitCode: 65,
			stdout: '',
			stderr: `${JSON.stringify({ error: nativeCode, message: 'GPU failed exactly.' })}\n`,
			isolationChecksPassed: false,
		}, 'runtime host');
		assert.equal(failure.name, 'OfxRetryableGpuError');
		assert.equal((failure as Error & { code?: string }).code, wireCode);
		assert.equal(failure.message, 'GPU failed exactly.');
	}
	for (const [stderr, label] of [
		[`${JSON.stringify({ error: 'authentication', message: 'denied' })}\n`, 'runtime host'],
		[`${JSON.stringify({ error: 'unsupported-backend', message: 'denied', extra: true })}\n`, 'runtime host'],
		['{"error":"authentication","error":"unsupported-backend","message":"denied"}\n', 'runtime host'],
		[`${JSON.stringify({ error: 'unsupported-backend', message: 'denied' })}\n`, 'scanner'],
		['not-json', 'runtime host'],
	] as const) {
		const failure = createOpenFxHostProcessFailure({
			exitCode: 65, stdout: '', stderr, isolationChecksPassed: false,
		}, label);
		assert.equal((failure as Error & { code?: string }).code, undefined);
		assert.match(failure.message, /failed with code 65/iu);
	}
});

test('native scanner and runtime arguments are closed and shell-free', () => {
	assert.deepEqual(openFxHostProcessArguments({
		executablePath: '/runtime/scanner',
		arguments: ['--scan', '/plugins/example.ofx', '--sha256', 'ab'.repeat(32)],
	}), ['--scan', '/plugins/example.ofx', '--sha256', 'ab'.repeat(32)]);
	assert.throws(() => openFxHostProcessArguments({
		executablePath: '/runtime/scanner', arguments: ['--unknown'],
	}), /closed OpenFX host invocation/iu);
	const cancellationFrame = createOpenFxV12CancellationFrame({
		invocationId: 'invocation-1', abortSignalId: 'abort-1',
	});
	const v12 = {
		executablePath: '/runtime/host',
		arguments: ['--invoke-v12-grant', '/scratch/grant.json', '--grant-sha256', 'ab'.repeat(32)],
	};
	assert.deepEqual(openFxHostProcessArguments({ ...v12, cancellationFrame }), v12.arguments);
	assert.deepEqual(openFxHostProcessArguments({ executablePath: '/runtime/host',
		arguments: ['--interact-v1-grant', '/scratch/interact.json', '--grant-sha256', 'ab'.repeat(32)],
	}), ['--interact-v1-grant', '/scratch/interact.json', '--grant-sha256', 'ab'.repeat(32)]);
	assert.throws(() => openFxHostProcessArguments(v12), /cancellation frame/iu);
	assert.throws(() => openFxHostProcessArguments({
		...v12, cancellationFrame: cancellationFrame.replace('abort-1', 'abort-2') + 'trailing',
	}), /cancellation frame/iu);
});

test('utility self-tests return a verified result only after direct isolation checks', async (context) => {
	const fixture = await createFixture(context);
	for (const mode of ['scanner', 'runtime'] as const) {
		const identity = {
			contractVersion: 1,
			mode: mode === 'scanner' ? 'short-lived-scanner' : 'per-binary-fingerprint-runtime',
			openfx: '1.5.1',
			commit: 'ab77951',
			ok: true,
			networkSuiteExposed: false,
			arbitraryFilesystemSuiteExposed: false,
			vendorTopLevelWindowsExposed: false,
		};
		const invoke = (selfTest: Readonly<Record<string, unknown>>, isolationChecksPassed: boolean) => () => processHandle(
			Promise.resolve({ exitCode: 0, stdout: JSON.stringify(selfTest), stderr: '' }),
			isolationChecksPassed,
		);
		await assert.rejects(selfTestFramescaperOpenFxHelper(
			fixture.descriptor, mode, invoke({
				...identity, contractFixture: false,
			}, false),
		), /isolation checks.*verified result/iu);
		await assert.rejects(selfTestFramescaperOpenFxHelper(
			fixture.descriptor, mode, invoke({
				...identity, contractFixture: true,
			}, true),
		), /verified result/iu);
		assert.deepEqual(await selfTestFramescaperOpenFxHelper(
			fixture.descriptor, mode, invoke({
				...identity, contractFixture: false,
			}, true),
		), { status: 'verified-result', isolationChecksPassed: true, mode });
	}
});

async function createFixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-openfx-runner-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const scannerPath = join(root, 'framescaper-ofx-scanner');
	const runtimePath = join(root, 'framescaper-ofx-runtime-host');
	const pluginPath = join(root, 'example.ofx');
	const scratchPath = join(root, 'scratch');
	await Promise.all([
		writeFile(scannerPath, 'scanner'), writeFile(runtimePath, 'runtime'),
		writeFile(pluginPath, 'plugin'), mkdir(scratchPath),
	]);
	const [scanner, runtimeHost, plugin, scratch] = await Promise.all([
		executableDescriptor(scannerPath), executableDescriptor(runtimePath),
		executableDescriptor(pluginPath), stat(scratchPath),
	]);
	const descriptor: FramescaperOpenFxHostDescriptor = {
		target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
		openfxVersion: '1.5.1', openfxCommit: 'ab77951', scanner, runtimeHost,
		isolation: {
			launcher: scanner, sandboxProfile: scanner, brokerPolicy: scanner, runtimeLibraries: [],
		},
		supportedGpuBackends: ['opengl', 'opencl', 'cuda'],
	};
	return {
		root, descriptor, plugin,
		scratch: {
			rootPath: scratchPath, rootIdentity: { dev: scratch.dev, ino: scratch.ino },
			reservationId: '78'.repeat(20), maximumBytes: 1024 * 1024,
		},
	};
}

async function executableDescriptor(path: string) {
	const [bytes, details] = await Promise.all([readFile(path), stat(path)]);
	return {
		path, byteLength: bytes.byteLength, sha256: digest(bytes),
		identity: { dev: details.dev, ino: details.ino },
	};
}

function executable(
	role: 'ofx-scanner' | 'ofx-host' | 'ofx-plugin',
	descriptor: Readonly<{
		path: string; byteLength: number; sha256: string;
		identity: Readonly<{ dev: number; ino: number }>;
	}>,
) {
	return {
		role, path: descriptor.path, bytes: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	};
}

function binding(
	direction: 'host-to-helper' | 'helper-to-host',
	streamId: string,
	bytes: Uint8Array,
) {
	return {
		dataPlaneVersion: 1 as const, transport: 'message-port' as const,
		streamId, direction, byteLength: bytes.byteLength, sha256: digest(bytes),
		maximumChunkBytes: Math.max(1, bytes.byteLength), maximumInFlightChunks: 1,
	};
}

function outputReservation<const Length extends number | null>(
	streamId: string,
	exactByteLength: Length,
	maximumByteLength = exactByteLength ?? 64 * 1024,
): HelperDataPlaneOutputReservation & Readonly<{ exactByteLength: Length }> {
	return {
		dataPlaneVersion: 1, transport: 'message-port', streamId,
		direction: 'helper-to-host', exactByteLength, maximumByteLength,
		maximumChunkBytes: Math.min(maximumByteLength, 16 * 1024 * 1024),
		maximumInFlightChunks: 1,
	};
}

function processHandle(completion: Promise<Readonly<{
	exitCode: number; stdout: string; stderr: string;
}>>, isolationChecksPassed = true) {
	return {
		completion: completion.then((result) => ({ ...result, isolationChecksPassed })),
		cancel: async () => undefined,
	};
}

function scannerDescriptorBytes(binarySha256: string): Buffer {
	return Buffer.from(JSON.stringify({
		pluginId: 'net.example.Blur', vendor: 'net.example.Blur',
		version: { major: 1, minor: 0 }, bundleIdentity: `sha256:${binarySha256}`,
		binarySha256, architectureDirectory: 'Linux-x86-64',
		supportedContexts: ['filter'], parameters: [], components: ['RGBA'],
		pixelDepths: ['byte'], threading: 'fully-safe',
		renderBackends: ['cpu'],
		requestedSuites: ['OfxImageEffectSuite', 'OfxPropertySuite', 'OfxParameterSuite'],
	}));
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

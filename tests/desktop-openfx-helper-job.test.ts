/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import type { FramescaperOpenFxHostDescriptor } from '../desktop/framescaper-openfx-host-payload.ts';
import {
	createOpenFxV12CancellationFrame,
	createOpenFxHelperJobRunner,
	openFxHostProcessArguments,
	selfTestFramescaperOpenFxHelper,
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
	const descriptorBytes = Buffer.from(JSON.stringify({
		contractVersion: 1, mode: 'short-lived-scanner', binarySha256: fixture.plugin.sha256,
		plugins: [{ id: 'net.example.Blur', api: 'OfxImageEffectPluginAPI', apiVersion: 1, major: 1, minor: 0 }],
	}));
	const descriptorBinding = outputReservation('ef'.repeat(20), null, 64 * 1024);
	const channel = new MessageChannel();
	const invocations: OpenFxHostProcessInvocation[] = [];
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor,
		mode: 'scanner',
		pluginFingerprint: null,
		invokeHost: (invocation) => {
			invocations.push(invocation);
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
		arguments: ['--scan', fixture.plugin.path, '--sha256', fixture.plugin.sha256],
	}]);
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
	const descriptorBytes = Buffer.from(JSON.stringify({
		contractVersion: 1, mode: 'short-lived-scanner', binarySha256: fixture.plugin.sha256,
		plugins: [{ id: 'net.example.Blur' }],
	}));
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
	const descriptorBytes = Buffer.from(JSON.stringify({
		contractVersion: 1, mode: 'short-lived-scanner', binarySha256: fixture.plugin.sha256,
		plugins: [{ id: 'net.example.Blur' }],
	}));
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
			osIsolationAttested: true, thirdPartyExecutionEnabled: true,
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
	const runtimeInvoked = deferred<Readonly<{ grantPath: string }>>();
	const finishRuntime = deferred<void>();
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor, mode: 'runtime',
		pluginFingerprint: invocation.pluginFingerprint,
		invokeHost: (nativeInvocation) => {
			if (nativeInvocation.arguments[0] === '--scan') {
				return processHandle(Promise.resolve({
					exitCode: 0, stderr: '', stdout: JSON.stringify({
						contractVersion: 1, mode: 'short-lived-scanner',
						binarySha256: fixture.plugin.sha256,
						plugins: [{ id: 'net.example.Blur' }],
					}),
				}));
			}
			const grantPath = nativeInvocation.arguments[1]!;
			runtimeInvoked.resolve({ grantPath });
			return processHandle(finishRuntime.promise.then(async () => {
				const nativeGrant = JSON.parse(String(await readFile(grantPath))) as {
					output: { path: string };
				};
				await writeFile(nativeGrant.output.path, outputBytes, { flag: 'wx' });
				return {
					exitCode: 0, stderr: '', stdout: JSON.stringify({
						accepted: true, outputStreamId: outputBinding.streamId,
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
	const { grantPath } = await runtimeInvoked.promise;
	const nativeGrant = JSON.parse(String(await readFile(grantPath))) as {
		inputs: Array<{ path: string }>;
	};
	const stagedInput = nativeGrant.inputs[0]!.path;
	await rename(stagedInput, `${stagedInput}.displaced`);
	await writeFile(stagedInput, Buffer.from([1, 2, 3, 4]));
	finishRuntime.resolve();
	await assert.rejects(Promise.all([job.completion, transfers]), /authenticated identity, length, or digest/iu);
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
	assert.throws(() => openFxHostProcessArguments(v12), /cancellation frame/iu);
	assert.throws(() => openFxHostProcessArguments({
		...v12, cancellationFrame: cancellationFrame.replace('abort-1', 'abort-2') + 'trailing',
	}), /cancellation frame/iu);
});

test('utility self-tests require production isolation and real third-party execution', async (context) => {
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
		const invoke = (selfTest: Readonly<Record<string, unknown>>) => () => processHandle(
			Promise.resolve({ exitCode: 0, stdout: JSON.stringify(selfTest), stderr: '' }),
		);
		await assert.rejects(selfTestFramescaperOpenFxHelper(
			fixture.descriptor, mode, invoke({
				...identity, contractFixture: false,
				osIsolationAttested: false, thirdPartyExecutionEnabled: false,
			}),
		), /production isolation.*third-party execution/iu);
		await assert.rejects(selfTestFramescaperOpenFxHelper(
			fixture.descriptor, mode, invoke({
				...identity, contractFixture: true,
				osIsolationAttested: true, thirdPartyExecutionEnabled: true,
			}),
		), /production isolation.*third-party execution/iu);
		await selfTestFramescaperOpenFxHelper(
			fixture.descriptor, mode, invoke({
				...identity, contractFixture: false,
				osIsolationAttested: true, thirdPartyExecutionEnabled: true,
			}),
		);
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
	};
	return {
		root, descriptor, plugin,
		scratch: {
			rootPath: scratchPath, rootIdentity: { dev: scratch.dev, ino: scratch.ino },
			reservationId: '78'.repeat(20), maximumBytes: 64 * 1024,
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
}>>) {
	return { completion, cancel: async () => undefined };
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

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Filesystem/data-plane adapter around the closed OpenFX scanner and V12/V14 runtime host. */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
	FramescaperOpenFxExecutableDescriptor,
	FramescaperOpenFxHostDescriptor,
} from './framescaper-openfx-host-payload.ts';
import type { FramescaperOpenFxHelperMode } from './framescaper-openfx-runtime.ts';
import {
	receiveHelperDataPlaneFile,
	sendHelperDataPlaneReservedFile,
	type HelperDataPlaneIoPort,
} from './helper-data-plane-io.ts';
import {
	type HelperExecutableGrant,
	type HelperOfxScanJobGrant,
	validateHelperJobGrant,
} from './helper-contract.ts';
import type {
	HelperOfxHostJobGrantV1OrV2,
	HelperOfxRenderHostJobGrantV1OrV2,
} from './helper-native-ofx-host-grant-v2.ts';
import { isHelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
import { runOpenFxInteractHelperJobV1 } from './openfx-helper-interact-job.ts';
import { NativeMediaHelperFilesystem } from './native-media-helper-filesystem.ts';
import type {
	OpenFxHelperJobHandle,
	OpenFxHelperJobRequest,
	OpenFxHelperJobRunnerPort,
} from './openfx-helper-worker.ts';
import {
	createOpenFxV12CancellationFrame,
	type OpenFxHostProcessAuthority,
	type OpenFxHostProcessHandle,
	type OpenFxHostProcessInvoker,
	type OpenFxHostProcessResult,
} from './openfx-host-process-contract.ts';
export {
	createOpenFxV12CancellationFrame,
	openFxHostProcessArguments,
	type OpenFxHostProcessAuthority,
	type OpenFxHostProcessHandle,
	type OpenFxHostProcessInvocation,
	type OpenFxHostProcessResult,
} from './openfx-host-process-contract.ts';
import {
	stageOpenFxPluginBinary,
	type StagedOpenFxPlugin,
} from './openfx-helper-plugin-staging.ts';
import { canonicalOpenFxV12NativeGrant } from './openfx-helper-v12-native-grant.ts';
import { stageOpenFxVideoTimingAssetsV1 } from './openfx-helper-video-timing-staging.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import { assertOfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';
import { parseOfxRetryableNativeGpuErrorV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import { assertUnifiedExactRenderPlanWithDeferredTimingReferences,
} from '../src/common/editor/unified-exact-render-plan.ts';

export const OPENFX_HOST_CONTROL_MAXIMUM_BYTES = 64 * 1024;

export interface OpenFxHelperJobRunnerOptions {
	readonly descriptor: FramescaperOpenFxHostDescriptor;
	readonly mode: FramescaperOpenFxHelperMode;
	readonly pluginFingerprint: string | null;
	readonly invokeHost: OpenFxHostProcessInvoker;
}

export class OpenFxHelperJobRunner implements OpenFxHelperJobRunnerPort {
	readonly #descriptor: FramescaperOpenFxHostDescriptor;
	readonly #mode: FramescaperOpenFxHelperMode;
	readonly #pluginFingerprint: string | null;
	readonly #invokeHost: NonNullable<OpenFxHelperJobRunnerOptions['invokeHost']>;

	constructor(options: OpenFxHelperJobRunnerOptions) {
		if (!options || (options.mode !== 'scanner' && options.mode !== 'runtime')
			|| (options.mode === 'scanner' && options.pluginFingerprint !== null)
			|| (options.mode === 'runtime' && !validFingerprint(options.pluginFingerprint))
			|| typeof options.invokeHost !== 'function') {
			throw new TypeError('An OpenFX job runner requires one exact scanner or runtime identity.');
		}
		this.#descriptor = options.descriptor;
		this.#mode = options.mode;
		this.#pluginFingerprint = options.pluginFingerprint;
		this.#invokeHost = options.invokeHost;
	}

	run(request: OpenFxHelperJobRequest): OpenFxHelperJobHandle {
		const expectedKind = this.#mode === 'scanner' ? 'ofx-scan' : 'ofx-host';
		if (request.kind !== expectedKind) {
			throw new Error(`An OpenFX ${this.#mode} runner cannot execute ${request.kind}.`);
		}
		if (request.kind === 'ofx-host') {
			const host = request.grant as HelperOfxHostJobGrantV1OrV2;
			const fingerprint = isHelperOfxInteractJobGrantV1(host)
				? host.pluginFingerprint : host.invocation.pluginFingerprint;
			if (fingerprint !== this.#pluginFingerprint) {
				throw new Error('An OpenFX runtime job crossed its authenticated plug-in fingerprint boundary.');
			}
		}
		const grant = validateHelperJobGrant(request.kind, request.grant);
		const hostGrant = request.kind === 'ofx-host'
			? grant as HelperOfxHostJobGrantV1OrV2 : null;
		const ports = admittedPorts(request.ports, request.kind === 'ofx-scan' ? 1
			: isHelperOfxInteractJobGrantV1(hostGrant) ? 0
				: 2 + (hostGrant!.videoTimingAssets?.length ?? 0) + hostGrant!.inputs.length);
		const abort = new AbortController();
		let process: OpenFxHostProcessHandle | null = null;
		const completion = (request.kind === 'ofx-scan'
			? this.#scan(grant as HelperOfxScanJobGrant, ports[0]!, abort.signal, (value) => {
				process = value;
			})
			: isHelperOfxInteractJobGrantV1(hostGrant)
				? runOpenFxInteractHelperJobV1({
					descriptor: this.#descriptor, grant: hostGrant, signal: abort.signal,
					invokeHost: this.#invokeHost, setProcess: (value) => { process = value; },
				})
				: this.#host(hostGrant as HelperOfxRenderHostJobGrantV1OrV2, ports, abort.signal, (value) => {
				process = value;
			}));
		return Object.freeze({
			completion,
			cancel: async () => {
				abort.abort();
				await process?.cancel().catch(() => undefined);
				await completion.catch(() => undefined);
			},
		});
	}

	async #scan(
		grant: HelperOfxScanJobGrant,
		port: HelperDataPlaneIoPort,
		signal: AbortSignal,
		setProcess: (value: OpenFxHostProcessHandle) => void,
	): Promise<Readonly<{ descriptor: Readonly<{ streamId: string; byteLength: number; sha256: string }> }>> {
		assertExecutableGrant(grant.executable, this.#descriptor.scanner, 'scanner');
		const filesystem = new NativeMediaHelperFilesystem();
		let settled = false;
		try {
			await Promise.all([
				authenticateDescriptor(filesystem, this.#descriptor.scanner),
				authenticateGrant(filesystem, grant.pluginBinary),
				filesystem.authenticateDirectory({
					path: grant.scratch.rootPath, identity: grant.scratch.rootIdentity,
				}),
			]);
			signal.throwIfAborted();
			if (grant.pluginBinary.bytes + grant.descriptor.maximumByteLength > grant.scratch.maximumBytes) {
				throw new Error('The OpenFX scan descriptor exceeds its exact scratch grant.');
			}
			const reservation = join(grant.scratch.rootPath, grant.scratch.reservationId);
			await filesystem.createReservation(reservation);
			const plugin = await stageOpenFxPluginBinary(
				filesystem, reservation, grant.pluginBinary, signal,
			);
			const pluginGrant = await filePathGrant(plugin.path);
			const outputPath = join(reservation, 'descriptor.json');
			await filesystem.expectOutput({
				path: outputPath, maximumBytes: grant.descriptor.maximumByteLength,
				insideReservation: true,
			});
			await filesystem.revalidate();
			const process = this.#invokeHost({
				executablePath: this.#descriptor.scanner.path,
				arguments: ['--scan', plugin.path, '--sha256', grant.pluginBinary.sha256],
			}, authority(pluginGrant, plugin));
			setProcess(process);
			const result = await successfulResult(process.completion, 'scanner');
			await plugin.revalidate();
			await filesystem.revalidate();
			assertScannerDescriptor(result.stdout, grant.pluginBinary.sha256);
			await writeFile(outputPath, result.stdout, { flag: 'wx', mode: 0o600 });
			const inspected = await filesystem.inspectOutput();
			await filesystem.revalidate();
			const descriptor = await sendHelperDataPlaneReservedFile({
				reservation: grant.descriptor,
				completion: {
					streamId: grant.descriptor.streamId,
					byteLength: inspected.byteLength,
					sha256: inspected.sha256,
				},
				port, path: outputPath, signal,
			});
			await filesystem.finish({ retainOutput: false });
			settled = true;
			return Object.freeze({ descriptor });
		} finally {
			if (!settled) await filesystem.abort();
		}
	}

	async #host(
		grant: HelperOfxRenderHostJobGrantV1OrV2,
		ports: readonly HelperDataPlaneIoPort[],
		signal: AbortSignal,
		setProcess: (value: OpenFxHostProcessHandle) => void,
	): Promise<Readonly<{ output: Readonly<{ streamId: string; byteLength: number; sha256: string }> }>> {
		assertExecutableGrant(grant.executable, this.#descriptor.runtimeHost, 'runtime host');
		if (grant.invocation.pluginFingerprint !== this.#pluginFingerprint) {
			throw new Error('The OpenFX runtime invocation changed its binary fingerprint.');
		}
		const filesystem = new NativeMediaHelperFilesystem();
		let settled = false;
		try {
			await Promise.all([
				authenticateDescriptor(filesystem, this.#descriptor.runtimeHost),
				authenticateDescriptor(filesystem, this.#descriptor.scanner),
				authenticateGrant(filesystem, grant.pluginBinary),
				filesystem.authenticateDirectory({
					path: grant.scratch.rootPath, identity: grant.scratch.rootIdentity,
				}),
			]);
			signal.throwIfAborted();
			const demand = grant.pluginBinary.bytes + grant.plan.byteLength + grant.output.frame.maximumByteLength
				+ (grant.videoTimingAssets ?? []).reduce((total, asset) => total + asset.binding.byteLength, 0)
				+ grant.inputs.reduce((total, input) => total + input.frame.byteLength, 0);
			if (demand > grant.scratch.maximumBytes) {
				throw new Error('The OpenFX host inputs exceed their exact scratch grant.');
			}
			const reservation = join(grant.scratch.rootPath, grant.scratch.reservationId);
			await filesystem.createReservation(reservation);
			const plugin = await stageOpenFxPluginBinary(
				filesystem, reservation, grant.pluginBinary, signal,
			);
			const pluginGrant = await filePathGrant(plugin.path);
			const planPath = join(reservation, 'canonical-plan.json');
			await receiveHelperDataPlaneFile({ binding: grant.plan, port: ports[0]!, path: planPath, signal });
			await assertCanonicalOpenFxPlan(planPath, grant.plan.sha256, grant.invocation.unifiedPlanVersion);
			await filesystem.authenticateFile({
				path: planPath, byteLength: grant.plan.byteLength, sha256: grant.plan.sha256,
			});
			const timingAssets = await stageOpenFxVideoTimingAssetsV1({
				grants: grant.videoTimingAssets ?? [], ports, firstPortIndex: 1,
				reservation, filesystem, signal,
			});
			signal.throwIfAborted();
			const inputPaths: string[] = [];
			const inputPortOffset = 1 + timingAssets.length;
			for (const [index, input] of grant.inputs.entries()) {
				const path = join(reservation, `input-${String(index).padStart(2, '0')}.rgba`);
				await receiveHelperDataPlaneFile({
					binding: input.frame, port: ports[inputPortOffset + index]!, path, signal,
				});
				await filesystem.authenticateFile({
					path, byteLength: input.frame.byteLength, sha256: input.frame.sha256,
				});
				inputPaths.push(path);
			}
			const pluginIndex = await this.#pluginIndex(
				grant, plugin, pluginGrant, signal, setProcess,
			);
			await filesystem.revalidate();
			signal.throwIfAborted();
			const outputRoot = join(reservation, 'native-output');
			await mkdir(outputRoot, { recursive: false, mode: 0o700 });
			await filesystem.authenticateDirectory({ path: outputRoot });
			const outputGrant = await directoryPathGrant(outputRoot);
			const outputPath = join(outputRoot, 'output.rgba');
			await filesystem.expectOutput({
				path: outputPath, maximumBytes: grant.output.frame.maximumByteLength,
				insideReservation: true,
			});
			const canonicalGrant = canonicalOpenFxV12NativeGrant({
				grant, pluginPath: plugin.path, pluginIndex, planPath, timingAssets, inputPaths, outputPath,
				qualifiedBackends: Object.freeze([
					'cpu', ...this.#descriptor.productionReadiness.qualifiedGpuBackends,
				]),
				maximumControlBytes: OPENFX_HOST_CONTROL_MAXIMUM_BYTES,
			});
			if (demand + Buffer.byteLength(canonicalGrant) > grant.scratch.maximumBytes) {
				throw new Error('The canonical OpenFX V12 grant exceeds its exact scratch authority.');
			}
			const grantPath = join(reservation, 'v12-host-grant.json');
			await writeFile(grantPath, canonicalGrant, { flag: 'wx', mode: 0o600 });
			const grantSha256 = sha256(Buffer.from(canonicalGrant));
			await filesystem.authenticateFile({
				path: grantPath, byteLength: Buffer.byteLength(canonicalGrant), sha256: grantSha256,
			});
			const readOnly = await Promise.all([
				planPath, ...timingAssets.map(({ path }) => path), ...inputPaths, grantPath,
			].map(filePathGrant));
			await filesystem.revalidate();
			signal.throwIfAborted();
			const process = this.#invokeHost({
				executablePath: this.#descriptor.runtimeHost.path,
				arguments: ['--invoke-v12-grant', grantPath, '--grant-sha256', grantSha256],
				cancellationFrame: createOpenFxV12CancellationFrame(grant.invocation),
			}, authority(pluginGrant, plugin, readOnly, [outputGrant]));
			setProcess(process);
			const result = await successfulResult(process.completion, 'runtime host');
			signal.throwIfAborted();
			await plugin.revalidate();
			await filesystem.revalidate();
			if (!sameNames(await readdir(outputRoot), ['output.rgba'])) {
				throw new Error('The OpenFX runtime created an unadmitted sibling output.');
			}
			const inspected = await filesystem.inspectOutput();
			assertOpenFxHostOutput(result.stdout, grant, inspected);
			await filesystem.revalidate();
			const output = await sendHelperDataPlaneReservedFile({
				reservation: grant.output.frame,
				completion: {
					streamId: grant.output.frame.streamId,
					byteLength: inspected.byteLength,
					sha256: inspected.sha256,
				},
				port: ports.at(-1)!, path: outputPath, signal,
			});
			await filesystem.finish({ retainOutput: false });
			settled = true;
			return Object.freeze({ output });
		} finally {
			if (!settled) await filesystem.abort();
		}
	}

	async #pluginIndex(
		grant: HelperOfxRenderHostJobGrantV1OrV2,
		plugin: StagedOpenFxPlugin,
		pluginGrant: Awaited<ReturnType<typeof filePathGrant>>,
		signal: AbortSignal,
		setProcess: (value: OpenFxHostProcessHandle) => void,
	): Promise<number> {
		signal.throwIfAborted();
		const process = this.#invokeHost({
			executablePath: this.#descriptor.scanner.path,
			arguments: ['--scan', plugin.path, '--sha256', grant.pluginBinary.sha256],
		}, authority(pluginGrant, plugin));
		setProcess(process);
		const result = await successfulResult(process.completion, 'scanner');
		signal.throwIfAborted();
		return scannerPluginIndex(result.stdout, grant.pluginBinary.sha256, grant.invocation.pluginId);
	}
}

export function createOpenFxHelperJobRunner(
	options: OpenFxHelperJobRunnerOptions,
): OpenFxHelperJobRunner {
	return new OpenFxHelperJobRunner(options);
}

export async function selfTestFramescaperOpenFxHelper(
	descriptor: FramescaperOpenFxHostDescriptor,
	mode: FramescaperOpenFxHelperMode,
	invokeHost: OpenFxHostProcessInvoker,
): Promise<void> {
	const executable = mode === 'scanner' ? descriptor.scanner : descriptor.runtimeHost;
	const filesystem = new NativeMediaHelperFilesystem();
	let settled = false;
	try {
		await authenticateDescriptor(filesystem, executable);
		const result = await successfulResult(invokeHost({
			executablePath: executable.path, arguments: ['--self-test'],
		}, authority(null)).completion, mode);
		const value = jsonRecord(result.stdout, 'OpenFX self-test');
		const expectedMode = mode === 'scanner' ? 'short-lived-scanner' : 'per-binary-fingerprint-runtime';
		if (value.contractVersion !== 1 || value.mode !== expectedMode
			|| value.openfx !== '1.5.1' || value.commit !== 'ab77951' || value.ok !== true) {
			throw new Error('The authenticated OpenFX payload failed its closed self-test.');
		}
		if (value.contractFixture !== false || value.osIsolationAttested !== true
			|| value.thirdPartyExecutionEnabled !== true || value.networkSuiteExposed !== false
			|| value.arbitraryFilesystemSuiteExposed !== false
			|| value.vendorTopLevelWindowsExposed !== false) {
			throw new Error(
				'The OpenFX payload lacks production isolation and real third-party execution readiness.',
			);
		}
		await filesystem.finish({ retainOutput: false });
		settled = true;
	} finally {
		if (!settled) await filesystem.abort();
	}
}

function admittedPorts(
	value: readonly HelperDataPlaneIoPort[],
	expected: number,
): readonly HelperDataPlaneIoPort[] {
	if (!Array.isArray(value) || value.length !== expected) {
		throw new TypeError('An OpenFX job did not receive every exact transferred MessagePort.');
	}
	const unique = new Set<HelperDataPlaneIoPort>();
	for (const port of value) {
		if (!port || typeof port.postMessage !== 'function' || typeof port.on !== 'function'
			|| typeof port.close !== 'function' || unique.has(port)) {
			throw new TypeError('An OpenFX job received an invalid or repeated transferred MessagePort.');
		}
		unique.add(port);
	}
	return Object.freeze([...value]);
}

export function assertExecutableGrant(
	grant: HelperExecutableGrant,
	descriptor: FramescaperOpenFxExecutableDescriptor,
	label: string,
): void {
	if (grant.path !== descriptor.path || grant.bytes !== descriptor.byteLength
		|| grant.sha256 !== descriptor.sha256 || grant.identity.dev !== descriptor.identity.dev
		|| grant.identity.ino !== descriptor.identity.ino) {
		throw new Error(`The OpenFX ${label} grant does not match its authenticated payload.`);
	}
}

export async function authenticateDescriptor(
	filesystem: NativeMediaHelperFilesystem,
	descriptor: FramescaperOpenFxExecutableDescriptor,
): Promise<void> {
	await filesystem.authenticateFile({
		path: descriptor.path, byteLength: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	});
}

export async function authenticateGrant(
	filesystem: NativeMediaHelperFilesystem,
	grant: HelperExecutableGrant,
): Promise<void> {
	await filesystem.authenticateFile({
		path: grant.path, byteLength: grant.bytes, sha256: grant.sha256, identity: grant.identity,
	});
}

async function assertCanonicalOpenFxPlan(
	path: string,
	expectedSha256: string,
	expectedVersion: 12 | 14,
): Promise<void> {
	const bytes = await readFile(path);
	let plan: unknown;
	try { plan = JSON.parse(String(bytes)) as unknown; }
	catch { throw new Error('The helper-spooled OpenFX plan is not JSON.'); }
	assertUnifiedExactRenderPlanWithDeferredTimingReferences(plan);
	const fingerprint = fingerprintNativeMediaPlan(plan);
	if (plan.version !== expectedVersion || ![12, 14].includes(plan.version)
		|| fingerprint.sha256 !== expectedSha256
		|| Buffer.from(canonicalizeNativeMediaPlan(plan)).compare(bytes) !== 0) {
		throw new Error('The helper-spooled OpenFX plan is not its exact dispatched version.');
	}
}

function assertScannerDescriptor(stdout: string, binarySha256: string): void {
	void scannerPluginIndex(stdout, binarySha256, null);
}

export function scannerPluginIndex(stdout: string, binarySha256: string, pluginId: string | null): number {
	let value: unknown;
	try { value = JSON.parse(stdout) as unknown; }
	catch { throw new Error('The OpenFX scanner returned an unauthenticated descriptor.'); }
	try { assertOfxPluginDescriptorV1(value); }
	catch { throw new Error('The OpenFX scanner returned an unauthenticated descriptor.'); }
	if (value.binarySha256 !== binarySha256) {
		throw new Error('The OpenFX scanner returned an unauthenticated descriptor.');
	}
	if (pluginId === null) return 0;
	if (value.pluginId !== pluginId) {
		throw new Error('The OpenFX scanner did not identify one exact plug-in entry.');
	}
	return 0;
}

export function assertOpenFxHostOutput(
	stdout: string,
	grant: HelperOfxRenderHostJobGrantV1OrV2,
	inspected: Readonly<{ byteLength: number; sha256: string }>,
): void {
	const value = jsonRecord(stdout, 'OpenFX runtime output');
	if (value.accepted !== true || value.planVersion !== grant.invocation.unifiedPlanVersion
		|| value.outputStreamId !== grant.output.frame.streamId
		|| value.requestedBackend !== grant.invocation.requestedBackend
		|| value.backend !== grant.invocation.requestedBackend
		|| value.retriedOnCpu !== false || value.reportsDegradation !== false
		|| value.gpuContextSetup !== (grant.invocation.requestedBackend !== 'cpu')
		|| value.gpuContextReleased !== (grant.invocation.requestedBackend !== 'cpu')
		|| value.outputByteLength !== grant.output.frame.exactByteLength
		|| value.outputByteLength !== inspected.byteLength
		|| value.outputSha256 !== inspected.sha256
		|| value.outputWidth !== grant.output.width
		|| value.outputHeight !== grant.output.height
		|| value.outputRowBytes !== grant.output.rowBytes
		|| Object.hasOwn(value, 'outputRgbaHex')) {
		throw new Error('The OpenFX runtime output does not match its exact backend and stream authority.');
	}
}

export async function successfulResult(
	completion: Promise<OpenFxHostProcessResult>,
	label: string,
): Promise<OpenFxHostProcessResult> {
	const result = await completion;
	if (Buffer.byteLength(result.stdout) > OPENFX_HOST_CONTROL_MAXIMUM_BYTES
		|| Buffer.byteLength(result.stderr) > OPENFX_HOST_CONTROL_MAXIMUM_BYTES) {
		throw new Error('The OpenFX host exceeded its 64 KiB control-output bound.');
	}
	if (result.exitCode !== 0) {
		throw createOpenFxHostProcessFailure(result, label);
	}
	return result;
}

export function createOpenFxHostProcessFailure(result: OpenFxHostProcessResult, label: string): Error {
	return (label === 'runtime host' && parseOfxRetryableNativeGpuErrorV1(result.stderr))
		|| new Error(`The OpenFX ${label} process failed with code ${String(result.exitCode)}.`);
}

function jsonRecord(text: string, label: string): Record<string, unknown> {
	let value: unknown;
	try { value = JSON.parse(text) as unknown; }
	catch { throw new Error(`The ${label} is not JSON.`); }
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`The ${label} is not a record.`);
	}
	return value as Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function validFingerprint(value: unknown): value is string {
	return typeof value === 'string'
		&& /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}@[a-f\d]{64}$/u.test(value);
}

export async function filePathGrant(path: string) {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink()
		|| !Number.isSafeInteger(details.dev) || details.dev < 0
		|| !Number.isSafeInteger(details.ino) || details.ino < 0) {
		throw new Error('An OpenFX child file grant is not one exact regular file.');
	}
	return Object.freeze({
		path, kind: 'file' as const,
		identity: Object.freeze({ dev: details.dev, ino: details.ino }),
	});
}

async function directoryPathGrant(path: string) {
	const details = await lstat(path);
	if (!details.isDirectory() || details.isSymbolicLink()
		|| !Number.isSafeInteger(details.dev) || details.dev < 0
		|| !Number.isSafeInteger(details.ino) || details.ino < 0) {
		throw new Error('An OpenFX child directory grant is not one exact directory.');
	}
	return Object.freeze({
		path, kind: 'directory' as const,
		identity: Object.freeze({ dev: details.dev, ino: details.ino }),
	});
}

export function authority(
	plugin: Awaited<ReturnType<typeof filePathGrant>> | null,
	staged: StagedOpenFxPlugin | null = null,
	readOnly: readonly Awaited<ReturnType<typeof filePathGrant>>[] = [],
	writeOnly: readonly Awaited<ReturnType<typeof directoryPathGrant>>[] = [],
): OpenFxHostProcessAuthority {
	return Object.freeze({
		plugin,
		pluginResources: staged?.resources ?? Object.freeze([]),
		pluginRuntime: staged?.runtimeClosure ?? Object.freeze([]),
		readOnly: Object.freeze([...readOnly]),
		writeOnly: Object.freeze([...writeOnly]),
	});
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

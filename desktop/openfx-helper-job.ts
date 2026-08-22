/* SPDX-License-Identifier: AGPL-3.0-only */

/** Filesystem/data-plane adapter around the closed OpenFX scanner and V12 runtime-host CLIs. */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
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
	type HelperOfxHostJobGrant,
	type HelperOfxScanJobGrant,
	validateHelperJobGrant,
} from './helper-contract.ts';
import { NativeMediaHelperFilesystem } from './native-media-helper-filesystem.ts';
import type {
	OpenFxHelperJobHandle,
	OpenFxHelperJobRequest,
	OpenFxHelperJobRunnerPort,
} from './openfx-helper-worker.ts';
import { stageOpenFxPluginBinary } from './openfx-helper-plugin-staging.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { assertOfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';
import { parseOfxRetryableNativeGpuErrorV1 } from '../src/common/editor/native-ofx-host-contract.ts';

export const OPENFX_HOST_CONTROL_MAXIMUM_BYTES = 64 * 1024;

export interface OpenFxHostProcessInvocation {
	readonly executablePath: string;
	readonly arguments: readonly string[];
	/** Exact one-shot frame written before force-termination of a V12 render. */
	readonly cancellationFrame?: string;
}

export interface OpenFxHostProcessResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface OpenFxHostProcessHandle {
	readonly completion: Promise<OpenFxHostProcessResult>;
	cancel(): Promise<void>;
}

export interface OpenFxHelperJobRunnerOptions {
	readonly descriptor: FramescaperOpenFxHostDescriptor;
	readonly mode: FramescaperOpenFxHelperMode;
	readonly pluginFingerprint: string | null;
	readonly invokeHost?: (invocation: OpenFxHostProcessInvocation) => OpenFxHostProcessHandle;
}

export class OpenFxHelperJobRunner implements OpenFxHelperJobRunnerPort {
	readonly #descriptor: FramescaperOpenFxHostDescriptor;
	readonly #mode: FramescaperOpenFxHelperMode;
	readonly #pluginFingerprint: string | null;
	readonly #invokeHost: NonNullable<OpenFxHelperJobRunnerOptions['invokeHost']>;

	constructor(options: OpenFxHelperJobRunnerOptions) {
		if (!options || (options.mode !== 'scanner' && options.mode !== 'runtime')
			|| (options.mode === 'scanner' && options.pluginFingerprint !== null)
			|| (options.mode === 'runtime' && !validFingerprint(options.pluginFingerprint))) {
			throw new TypeError('An OpenFX job runner requires one exact scanner or runtime identity.');
		}
		this.#descriptor = options.descriptor;
		this.#mode = options.mode;
		this.#pluginFingerprint = options.pluginFingerprint;
		this.#invokeHost = options.invokeHost ?? invokeClosedOpenFxHost;
	}

	run(request: OpenFxHelperJobRequest): OpenFxHelperJobHandle {
		const expectedKind = this.#mode === 'scanner' ? 'ofx-scan' : 'ofx-host';
		if (request.kind !== expectedKind) {
			throw new Error(`An OpenFX ${this.#mode} runner cannot execute ${request.kind}.`);
		}
		if (request.kind === 'ofx-host') {
			const fingerprint = (request.grant as HelperOfxHostJobGrant).invocation?.pluginFingerprint;
			if (fingerprint !== this.#pluginFingerprint) {
				throw new Error('An OpenFX runtime job crossed its authenticated plug-in fingerprint boundary.');
			}
		}
		const grant = validateHelperJobGrant(request.kind, request.grant);
		const ports = admittedPorts(request.ports, request.kind === 'ofx-scan'
			? 1 : 2 + (grant as HelperOfxHostJobGrant).inputs.length);
		const abort = new AbortController();
		let process: OpenFxHostProcessHandle | null = null;
		const completion = (request.kind === 'ofx-scan'
			? this.#scan(grant as HelperOfxScanJobGrant, ports[0]!, abort.signal, (value) => {
				process = value;
			})
			: this.#host(grant as HelperOfxHostJobGrant, ports, abort.signal, (value) => {
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
			const pluginPath = await stageOpenFxPluginBinary(
				filesystem, reservation, grant.pluginBinary, signal,
			);
			const outputPath = join(reservation, 'descriptor.json');
			await filesystem.expectOutput({
				path: outputPath, maximumBytes: grant.descriptor.maximumByteLength,
				insideReservation: true,
			});
			const process = this.#invokeHost({
				executablePath: this.#descriptor.scanner.path,
				arguments: ['--scan', pluginPath, '--sha256', grant.pluginBinary.sha256],
			});
			setProcess(process);
			const result = await successfulResult(process.completion, 'scanner');
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
		grant: HelperOfxHostJobGrant,
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
				+ grant.inputs.reduce((total, input) => total + input.frame.byteLength, 0);
			if (demand > grant.scratch.maximumBytes) {
				throw new Error('The OpenFX host inputs exceed their exact scratch grant.');
			}
			const reservation = join(grant.scratch.rootPath, grant.scratch.reservationId);
			await filesystem.createReservation(reservation);
			const pluginPath = await stageOpenFxPluginBinary(
				filesystem, reservation, grant.pluginBinary, signal,
			);
			const planPath = join(reservation, 'canonical-plan.json');
			await receiveHelperDataPlaneFile({ binding: grant.plan, port: ports[0]!, path: planPath, signal });
			await assertCanonicalV12Plan(planPath, grant.plan.sha256);
			await filesystem.authenticateFile({
				path: planPath, byteLength: grant.plan.byteLength, sha256: grant.plan.sha256,
			});
			signal.throwIfAborted();
			const inputPaths: string[] = [];
			for (const [index, input] of grant.inputs.entries()) {
				const path = join(reservation, `input-${String(index).padStart(2, '0')}.rgba`);
				await receiveHelperDataPlaneFile({
					binding: input.frame, port: ports[index + 1]!, path, signal,
				});
				await filesystem.authenticateFile({
					path, byteLength: input.frame.byteLength, sha256: input.frame.sha256,
				});
				inputPaths.push(path);
			}
			const pluginIndex = await this.#pluginIndex(grant, pluginPath, signal, setProcess);
			await filesystem.revalidate();
			signal.throwIfAborted();
			const outputPath = join(reservation, 'output.rgba');
			await filesystem.expectOutput({
				path: outputPath, maximumBytes: grant.output.frame.maximumByteLength,
				insideReservation: true,
			});
			const grantDocument = {
				schemaVersion: 1,
				pluginBinary: {
					path: pluginPath,
					sha256: grant.pluginBinary.sha256,
					pluginIndex,
				},
				invocation: grant.invocation,
				plan: { path: planPath, byteLength: grant.plan.byteLength, sha256: grant.plan.sha256 },
				inputs: grant.inputs.map((input, index) => ({
					name: input.name,
					sourceRef: input.sourceRef,
					streamId: input.frame.streamId,
					path: inputPaths[index]!,
					pixelFormat: input.pixelFormat,
					width: input.width,
					height: input.height,
					rowBytes: input.rowBytes,
					byteLength: input.frame.byteLength,
					sha256: input.frame.sha256,
				})),
				output: {
					streamId: grant.output.frame.streamId,
					path: outputPath,
					pixelFormat: grant.output.pixelFormat,
					width: grant.output.width,
					height: grant.output.height,
					rowBytes: grant.output.rowBytes,
					byteLength: grant.output.frame.exactByteLength,
				},
			};
			const canonicalGrant = canonicalizeNativeMediaPlan(grantDocument);
			if (Buffer.byteLength(canonicalGrant) > OPENFX_HOST_CONTROL_MAXIMUM_BYTES) {
				throw new Error('The canonical OpenFX V12 native grant exceeds 64 KiB.');
			}
			if (demand + Buffer.byteLength(canonicalGrant) > grant.scratch.maximumBytes) {
				throw new Error('The canonical OpenFX V12 grant exceeds its exact scratch authority.');
			}
			const grantPath = join(reservation, 'v12-host-grant.json');
			await writeFile(grantPath, canonicalGrant, { flag: 'wx', mode: 0o600 });
			signal.throwIfAborted();
			const grantSha256 = sha256(Buffer.from(canonicalGrant));
			const process = this.#invokeHost({
				executablePath: this.#descriptor.runtimeHost.path,
				arguments: ['--invoke-v12-grant', grantPath, '--grant-sha256', grantSha256],
				cancellationFrame: createOpenFxV12CancellationFrame(grant.invocation),
			});
			setProcess(process);
			const result = await successfulResult(process.completion, 'runtime host');
			signal.throwIfAborted();
			await filesystem.revalidate();
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
		grant: HelperOfxHostJobGrant,
		pluginPath: string,
		signal: AbortSignal,
		setProcess: (value: OpenFxHostProcessHandle) => void,
	): Promise<number> {
		signal.throwIfAborted();
		const process = this.#invokeHost({
			executablePath: this.#descriptor.scanner.path,
			arguments: ['--scan', pluginPath, '--sha256', grant.pluginBinary.sha256],
		});
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

export function openFxHostProcessArguments(
	invocation: OpenFxHostProcessInvocation,
): readonly string[] {
	const args = [...invocation.arguments];
	const scan = args.length === 4 && args[0] === '--scan' && args[2] === '--sha256';
	const invoke = args.length === 4 && args[0] === '--invoke-v12-grant'
		&& args[2] === '--grant-sha256';
	const selfTest = args.length === 1 && args[0] === '--self-test';
	if (!scan && !invoke && !selfTest) throw new TypeError('A closed OpenFX host invocation is required.');
	if ((invoke && !validOpenFxV12CancellationFrame(invocation.cancellationFrame))
		|| (!invoke && invocation.cancellationFrame !== undefined)) {
		throw new TypeError('A V12 runtime invocation requires one exact bounded cancellation frame.');
	}
	return Object.freeze(args);
}

export function createOpenFxV12CancellationFrame(
	invocation: Readonly<{ invocationId: string; abortSignalId: string }>,
): string {
	const frame = `${canonicalizeNativeMediaPlan({
		schemaVersion: 1,
		type: 'cancel',
		invocationId: invocation.invocationId,
		abortSignalId: invocation.abortSignalId,
	})}\n`;
	if (!validOpenFxV12CancellationFrame(frame)) {
		throw new TypeError('An OpenFX cancellation frame exceeds its closed one-shot domain.');
	}
	return frame;
}

export function invokeClosedOpenFxHost(
	invocation: OpenFxHostProcessInvocation,
): OpenFxHostProcessHandle {
	const arguments_ = openFxHostProcessArguments(invocation);
	const cancellationFrame = invocation.cancellationFrame;
	const child = spawn(invocation.executablePath, arguments_, {
		stdio: [cancellationFrame === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
		shell: false, windowsHide: true,
	});
	let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	let oversized = false;
	let settled = false;
	const stdoutPipe = child.stdout;
	const stderrPipe = child.stderr;
	if (stdoutPipe === null || stderrPipe === null) {
		child.kill();
		throw new Error('The OpenFX host did not provide its closed control pipes.');
	}
	const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer): Buffer<ArrayBufferLike> => {
		const value = Buffer.concat([current, chunk]);
		if (value.byteLength > OPENFX_HOST_CONTROL_MAXIMUM_BYTES) {
			oversized = true;
			child.kill();
		}
		return value;
	};
	stdoutPipe.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
	stderrPipe.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
	const completion = new Promise<OpenFxHostProcessResult>((resolve, reject) => {
		child.once('error', (error) => { settled = true; reject(error); });
		child.once('exit', (code, signal) => {
			settled = true;
			if (oversized) return reject(new Error('The OpenFX host exceeded its 64 KiB control-output bound.'));
			if (signal !== null) return reject(new Error(`The OpenFX host exited on signal ${signal}.`));
			resolve(Object.freeze({ exitCode: code ?? 1, stdout: String(stdout), stderr: String(stderr) }));
		});
	});
	return Object.freeze({
		completion,
		cancel: async () => {
			if (!settled && cancellationFrame !== undefined && child.stdin !== null) {
				child.stdin.on('error', () => undefined);
				child.stdin.end(cancellationFrame);
				await Promise.race([
					completion.then(() => undefined, () => undefined),
					new Promise<void>((resolveGrace) => setTimeout(resolveGrace, 250)),
				]);
			}
			if (!settled && child.exitCode === null && child.signalCode === null) child.kill();
			await completion.catch(() => undefined);
		},
	});
}

function validOpenFxV12CancellationFrame(value: unknown): value is string {
	if (typeof value !== 'string' || Buffer.byteLength(value) > 4_096 || !value.endsWith('\n')) return false;
	try {
		const parsed = JSON.parse(value.slice(0, -1)) as unknown;
		return canonicalizeNativeMediaPlan(parsed) === value.slice(0, -1)
			&& !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			&& Object.keys(parsed).join(',') === 'schemaVersion,type,invocationId,abortSignalId'
			&& (parsed as Record<string, unknown>).schemaVersion === 1
			&& (parsed as Record<string, unknown>).type === 'cancel';
	} catch { return false; }
}

export async function selfTestFramescaperOpenFxHelper(
	descriptor: FramescaperOpenFxHostDescriptor,
	mode: FramescaperOpenFxHelperMode,
	invokeHost: (invocation: OpenFxHostProcessInvocation) => OpenFxHostProcessHandle = invokeClosedOpenFxHost,
): Promise<void> {
	const executable = mode === 'scanner' ? descriptor.scanner : descriptor.runtimeHost;
	const filesystem = new NativeMediaHelperFilesystem();
	let settled = false;
	try {
		await authenticateDescriptor(filesystem, executable);
		const result = await successfulResult(invokeHost({
			executablePath: executable.path, arguments: ['--self-test'],
		}).completion, mode);
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

function assertExecutableGrant(
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

async function authenticateDescriptor(
	filesystem: NativeMediaHelperFilesystem,
	descriptor: FramescaperOpenFxExecutableDescriptor,
): Promise<void> {
	await filesystem.authenticateFile({
		path: descriptor.path, byteLength: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	});
}

async function authenticateGrant(
	filesystem: NativeMediaHelperFilesystem,
	grant: HelperExecutableGrant,
): Promise<void> {
	await filesystem.authenticateFile({
		path: grant.path, byteLength: grant.bytes, sha256: grant.sha256, identity: grant.identity,
	});
}

async function assertCanonicalV12Plan(path: string, expectedSha256: string): Promise<void> {
	const bytes = await readFile(path);
	let plan: unknown;
	try { plan = JSON.parse(String(bytes)) as unknown; }
	catch { throw new Error('The helper-spooled OpenFX plan is not JSON.'); }
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	if (envelope.planVersion !== 12 || envelope.fingerprint !== expectedSha256
		|| Buffer.from(canonicalizeNativeMediaPlan(envelope.plan)).compare(bytes) !== 0) {
		throw new Error('The helper-spooled OpenFX plan is not exact canonical V12.');
	}
}

function assertScannerDescriptor(stdout: string, binarySha256: string): void {
	void scannerPluginIndex(stdout, binarySha256, null);
}

function scannerPluginIndex(stdout: string, binarySha256: string, pluginId: string | null): number {
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
	grant: HelperOfxHostJobGrant,
	inspected: Readonly<{ byteLength: number; sha256: string }>,
): void {
	const value = jsonRecord(stdout, 'OpenFX runtime output');
	if (value.accepted !== true || value.outputStreamId !== grant.output.frame.streamId
		|| value.requestedBackend !== grant.invocation.requestedBackend
		|| value.backend !== grant.invocation.requestedBackend
		|| value.retriedOnCpu !== false || value.reportsDegradation !== false
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

async function successfulResult(
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

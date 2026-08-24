/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact filesystem/data-plane adapter around the closed Framescaper media-host CLI. */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	canonicalizeNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	createNativeMediaPlanEnvelopeV1,
} from '../src/common/editor/native-media-plan-envelope.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import type { FramescaperMediaHostDescriptor } from './framescaper-media-host-payload.ts';
import type { HelperDataPlaneBinding } from './helper-data-plane.ts';
import type { HelperDataPlaneInputReservation } from './helper-data-plane-input-reservation.ts';
import type { HelperDataPlaneOutputReservation } from './helper-data-plane-output-reservation.ts';
import {
	receiveHelperDataPlaneInputStream,
	receiveHelperDataPlaneFile,
	sendHelperDataPlaneFile,
	sendHelperDataPlaneReservedFile,
	type HelperDataPlaneByteSink,
	type HelperDataPlaneIoPort,
} from './helper-data-plane-io.ts';
import {
	type HelperJobGrant,
	type HelperMediaDecodeJobGrant,
	type HelperMediaEncodeJobGrant,
	type HelperMediaImageSequenceDecodeGrant,
	type HelperMediaProxyJobGrant,
	type HelperNativeInputGrant,
	validateHelperJobGrant,
} from './helper-contract.ts';
import type { NativeMediaHelperPoolJobKind } from './native-media-helper-pool.ts';
import {
	parseNativeMediaHostControl,
	type NativeMediaHostDecodeControl,
	type NativeMediaHostProxyControl,
} from './native-media-host-result.ts';
import { NativeMediaHelperFilesystem } from './native-media-helper-filesystem.ts';
import type { HelperNativeMediaEncodeBackend } from './helper-native-media-backend.ts';
import {
	inspectNativeMediaHelperOutput,
	prepareNativeMediaHelperOutput,
} from './native-media-helper-output.ts';

import {
	NATIVE_MEDIA_HOST_CONTROL_MAXIMUM_BYTES,
} from './native-media-host-process.ts';
import { createIsolatedNativeMediaHostProcessInvoker } from './native-media-isolated-host-process.ts';
export {
	nativeMediaHostArguments, NATIVE_MEDIA_HOST_CONTROL_MAXIMUM_BYTES,
} from './native-media-host-process.ts';
export const NATIVE_MEDIA_PROXY_RECIPE_ID = 'framescaper-native-prores-proxy-mov-v1';

export interface NativeMediaHostSourceInvocation {
	readonly path: string | null;
	readonly sha256: string | null;
	readonly byteLength: number;
	readonly role: 'original' | 'evaluated-rgba-frame-pack' | 'staged-audio-mix'
		| 'image-sequence-pack' | 'image-sequence-inventory';
	readonly liveInput?: HelperDataPlaneInputReservation;
}

export interface NativeMediaHostVideoTimingInvocation {
	readonly path: string;
	readonly sha256: string;
	readonly byteLength: number;
}

export interface NativeMediaHostInvocation {
	readonly executablePath: string;
	readonly operation: NativeMediaHelperPoolJobKind;
	readonly plan: Readonly<{ path: string; sha256: string }> | null;
	readonly sources: readonly NativeMediaHostSourceInvocation[];
	readonly videoTimingAssets: readonly NativeMediaHostVideoTimingInvocation[];
	readonly backend: HelperNativeMediaEncodeBackend;
	readonly maximumOutputBytes: number;
	readonly scratchPath: string | null;
	readonly decodeOutputPath: string | null;
	readonly destinationRoot: string | null;
	readonly temporaryOutputPath: string | null;
	readonly proxyRecipe: Readonly<{
		readonly id: typeof NATIVE_MEDIA_PROXY_RECIPE_ID;
		readonly width: number;
		readonly height: number;
	}> | null;
	readonly imageSequence: HelperMediaImageSequenceDecodeGrant | null;
}

export interface NativeMediaHostProcessResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface NativeMediaHostProcessHandle {
	readonly completion: Promise<NativeMediaHostProcessResult>;
	readonly inputs?: readonly Readonly<{
		readonly role: NativeMediaHostSourceInvocation['role'];
		readonly sink: HelperDataPlaneByteSink;
	}>[];
	cancel(): Promise<void>;
}

export interface NativeMediaHelperJobHandle {
	readonly completion: Promise<unknown>;
	cancel(): Promise<void>;
}

export interface NativeMediaHelperJobRequest {
	readonly kind: NativeMediaHelperPoolJobKind;
	readonly grant: HelperJobGrant<NativeMediaHelperPoolJobKind>;
	readonly ports: readonly HelperDataPlaneIoPort[];
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number | null) => void;
}

/** A closed host refusal that survives the helper wire through its `code`. */
export class NativeMediaHostOperationError extends Error {
	readonly code: string;
	readonly exitCode: number;
	constructor(code: string, exitCode: number, kind: NativeMediaHelperPoolJobKind) {
		super(`The native media host ${kind} operation failed with code ${String(exitCode)} (${code}).`);
		this.name = 'NativeMediaHostOperationError';
		this.code = code;
		this.exitCode = exitCode;
	}
}

export interface NativeMediaHelperJobRunnerOptions {
	readonly descriptor: FramescaperMediaHostDescriptor;
	readonly invokeHost?: (invocation: NativeMediaHostInvocation) => NativeMediaHostProcessHandle;
}

export class NativeMediaHelperJobRunner {
	readonly #descriptor: FramescaperMediaHostDescriptor;
	readonly #invokeHost: NonNullable<NativeMediaHelperJobRunnerOptions['invokeHost']>;

	constructor(options: NativeMediaHelperJobRunnerOptions) {
		this.#descriptor = options.descriptor;
		this.#invokeHost = options.invokeHost ?? createIsolatedNativeMediaHostProcessInvoker(options.descriptor);
	}

	run(request: NativeMediaHelperJobRequest): NativeMediaHelperJobHandle {
		const grant = validateHelperJobGrant(request.kind, request.grant);
		const bindings = jobBindings(request.kind, grant);
		const ports = admittedPorts(request.ports, bindings.length);
		const abort = new AbortController();
		const relayAbort = (): void => abort.abort(request.signal?.reason);
		if (request.signal?.aborted) relayAbort();
		else request.signal?.addEventListener('abort', relayAbort, { once: true });
		let host: NativeMediaHostProcessHandle | null = null;
		const completion = this.#execute(request.kind, grant, ports, abort.signal, (value) => {
			host = value;
		}, request.onProgress).finally(() => {
			request.signal?.removeEventListener('abort', relayAbort);
		});
		return Object.freeze({
			completion,
			cancel: async () => {
				abort.abort();
				await host?.cancel().catch(() => undefined);
				await completion.catch(() => undefined);
			},
		});
	}

	async #execute(
		kind: NativeMediaHelperPoolJobKind,
		grant: HelperJobGrant<NativeMediaHelperPoolJobKind>,
		ports: readonly HelperDataPlaneIoPort[],
		signal: AbortSignal,
		setHost: (handle: NativeMediaHostProcessHandle) => void,
		onProgress: ((value: number | null) => void) | undefined,
	): Promise<unknown> {
		const filesystem = new NativeMediaHelperFilesystem();
		try {
			await filesystem.authenticateFile({
				path: this.#descriptor.path,
				byteLength: this.#descriptor.byteLength,
				sha256: this.#descriptor.sha256,
				identity: this.#descriptor.identity,
			});
			if (kind === 'probe-video-source') {
				const probe = grant as HelperJobGrant<'probe-video-source'>;
				const source = await filesystem.authenticateFile({
					path: probe.mediaPath, byteLength: probe.mediaBytes, identity: probe.identity,
				});
				const handle = this.#invokeHost(invocation({
					descriptor: this.#descriptor, kind, plan: null,
					sources: [{
						path: probe.mediaPath, sha256: source.sha256,
						byteLength: probe.mediaBytes, role: 'original',
					}],
					maximumOutputBytes: 0,
				}));
				setHost(handle);
				const result = await successfulResult(handle.completion, kind);
				const control = parseNativeMediaHostControl(kind, result.stdout);
				await filesystem.finish({ retainOutput: false });
				return control;
			}
			const nativeGrant = grant as HelperMediaDecodeJobGrant | HelperMediaEncodeJobGrant | HelperMediaProxyJobGrant;
			assertExecutableGrant(nativeGrant, this.#descriptor);
			await filesystem.authenticateDirectory({
				path: nativeGrant.scratch.rootPath, identity: nativeGrant.scratch.rootIdentity,
			});
			const inputs = kind === 'media-proxy'
				? [(nativeGrant as HelperMediaProxyJobGrant).source]
				: (nativeGrant as HelperMediaDecodeJobGrant).sources;
			const sources: Array<NativeMediaHostSourceInvocation | null> = await Promise.all(
				inputs.map(async (source) => {
					if (source.type === 'stream') return 'authentication' in source.binding
						? Object.freeze({
							path: null, sha256: null, byteLength: source.binding.byteLength,
							role: source.role, liveInput: source.binding,
						}) : null;
					await filesystem.authenticateFile({
						path: source.path, byteLength: source.bytes,
						sha256: source.sha256, identity: source.identity,
					});
					return Object.freeze({
						path: source.path, sha256: source.sha256,
						byteLength: source.bytes, role: source.role,
					});
				}),
			);
			const videoTimingAssets: NativeMediaHostVideoTimingInvocation[] = [];
			for (const asset of nativeGrant.videoTimingAssets ?? []) {
				await filesystem.authenticateFile({
					path: asset.path, byteLength: asset.bytes,
					sha256: asset.sha256, identity: asset.identity,
				});
				videoTimingAssets.push(Object.freeze({
					path: asset.path, sha256: asset.sha256, byteLength: asset.bytes,
				}));
			}
			const demand = scratchDemand(kind, nativeGrant);
			if (demand > nativeGrant.scratch.maximumBytes) {
				throw new Error('The native media job exceeds its exact scratch grant.');
			}
			const reservationPath = join(nativeGrant.scratch.rootPath, nativeGrant.scratch.reservationId);
			await filesystem.createReservation(reservationPath);
			const planPath = join(reservationPath, 'canonical-plan.json');
			await receiveHelperDataPlaneFile({
				binding: nativeGrant.plan, port: ports[0]!, path: planPath, signal,
			});
			await assertCanonicalPlan(planPath, nativeGrant.plan.sha256);
			let portIndex = 1;
			const livePorts: HelperDataPlaneIoPort[] = [];
			for (const [index, source] of inputs.entries()) {
				if (source.type === 'stream') {
					if ('authentication' in source.binding) {
						livePorts.push(ports[portIndex]!); portIndex += 1; continue;
					}
					const sourcePath = join(reservationPath, `source-${String(index).padStart(6, '0')}.bin`);
					await receiveHelperDataPlaneFile({
						binding: source.binding, port: ports[portIndex]!, path: sourcePath, signal,
					});
					portIndex += 1;
					sources[index] = Object.freeze({
						path: sourcePath, sha256: source.binding.sha256,
						byteLength: source.binding.byteLength, role: source.role,
					});
				}
			}
			if (sources.some((source) => source === null)) {
				throw new Error('A native media source stream was not authenticated.');
			}
			onProgress?.(0);
			let maximumOutputBytes: number;
			let decodeOutputPath: string | null = null;
			let destinationRoot: string | null = null;
			let temporaryOutputPath: string | null = null;
			if (kind === 'media-decode') {
				const output = (nativeGrant as HelperMediaDecodeJobGrant).output;
				maximumOutputBytes = 'byteLength' in output
					? output.byteLength : output.maximumByteLength;
				decodeOutputPath = join(reservationPath, 'decoded-output.bin');
				await filesystem.expectOutput({
					path: decodeOutputPath, maximumBytes: maximumOutputBytes, insideReservation: true,
				});
			} else {
				const output = (nativeGrant as HelperMediaEncodeJobGrant | HelperMediaProxyJobGrant).output;
				const preparedOutput = await prepareNativeMediaHelperOutput(filesystem, output);
				({ maximumOutputBytes, destinationRoot, temporaryOutputPath } = preparedOutput);
			}
			const hostInvocation = invocation({
				descriptor: this.#descriptor,
				kind,
				plan: { path: planPath, sha256: nativeGrant.plan.sha256 },
				sources: sources as NativeMediaHostSourceInvocation[],
				videoTimingAssets,
				backend: kind === 'media-encode' || kind === 'media-render'
					? (nativeGrant as HelperMediaEncodeJobGrant).backend : 'native-cpu',
				maximumOutputBytes,
				scratchPath: reservationPath,
				decodeOutputPath,
				destinationRoot,
				temporaryOutputPath,
				proxyRecipe: kind === 'media-proxy'
					? (nativeGrant as HelperMediaProxyJobGrant).proxyRecipe : null,
				imageSequence: kind === 'media-decode'
					? ((nativeGrant as HelperMediaDecodeJobGrant).imageSequence ?? null) : null,
			});
			const handle = this.#invokeHost(hostInvocation);
			setHost(handle);
			const liveSources = hostInvocation.sources.filter((source): source is NativeMediaHostSourceInvocation &
				Readonly<{ liveInput: HelperDataPlaneInputReservation }> => source.liveInput !== undefined);
			let completed: NativeMediaHostProcessResult;
			if (liveSources.length === 0) completed = await successfulResult(handle.completion, kind);
			else {
				const mounted = exactLiveHostInputs(liveSources, livePorts, handle.inputs);
				const liveAbort = new AbortController();
				const relayLiveAbort = (): void => liveAbort.abort(signal.reason);
				if (signal.aborted) relayLiveAbort();
				else signal.addEventListener('abort', relayLiveAbort, { once: true });
				const receiving = mounted.map(({ source, port, sink }) => receiveHelperDataPlaneInputStream({
					reservation: source.liveInput, port, sink, signal: liveAbort.signal,
				}));
				try {
					[completed] = await Promise.all([
						successfulResult(handle.completion, kind),
						...receiving,
					]);
				} catch (error) {
					liveAbort.abort(error);
					await handle.cancel().catch(() => undefined);
					await Promise.allSettled(receiving);
					throw error;
				} finally { signal.removeEventListener('abort', relayLiveAbort); }
			}
			const hostResult = parseNativeMediaHostControl(kind, completed.stdout);
			signal.throwIfAborted();
			if (kind === 'media-decode') {
				const inspected = await filesystem.inspectOutput();
				const decodeGrant = nativeGrant as HelperMediaDecodeJobGrant;
				const output = decodeGrant.output;
				assertOutputControl(hostResult as NativeMediaHostDecodeControl, inspected);
				let result;
				if (decodeGrant.imageSequence === undefined) {
					if (!('byteLength' in output) || inspected.byteLength !== output.byteLength
						|| inspected.sha256 !== output.sha256) {
						throw new Error('The decoded media output does not match its exact data-plane binding.');
					}
					result = await sendHelperDataPlaneFile({
						binding: output, port: ports.at(-1)!, path: decodeOutputPath!, signal,
					});
				} else {
					if (!('maximumByteLength' in output)) {
						throw new Error('Image-sequence decode lost its bounded output reservation.');
					}
					result = await sendHelperDataPlaneReservedFile({
						reservation: output,
						completion: { streamId: output.streamId, ...inspected },
						port: ports.at(-1)!, path: decodeOutputPath!, signal,
					});
				}
				await filesystem.finish({ retainOutput: false });
				onProgress?.(1);
				return Object.freeze({ output: result });
			}
			const publicationOutput = (nativeGrant as HelperMediaEncodeJobGrant | HelperMediaProxyJobGrant).output;
			const inspected = await inspectNativeMediaHelperOutput(
				filesystem, publicationOutput,
				hostResult as Parameters<typeof inspectNativeMediaHelperOutput>[2],
			);
			if (kind === 'media-proxy') {
				const control = hostResult as NativeMediaHostProxyControl;
				const recipe = (nativeGrant as HelperMediaProxyJobGrant).proxyRecipe;
				if (control.width !== recipe.width || control.height !== recipe.height) {
					throw new Error('The native media proxy result does not match its exact granted geometry.');
				}
			}
			await filesystem.finish({ retainOutput: true });
			onProgress?.(1);
			return Object.freeze({ output: inspected });
		} catch (error) {
			try { await filesystem.abort(); }
			catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					`${errorMessage(error)} Native media cleanup also refused drifted authority.`,
				);
			}
			throw error;
		}
	}
}

function exactLiveHostInputs(
	sources: readonly (NativeMediaHostSourceInvocation & Readonly<{
		readonly liveInput: HelperDataPlaneInputReservation;
	}>)[],
	ports: readonly HelperDataPlaneIoPort[],
	inputs: NativeMediaHostProcessHandle['inputs'],
): readonly Readonly<{
	readonly source: typeof sources[number];
	readonly port: HelperDataPlaneIoPort;
	readonly sink: HelperDataPlaneByteSink;
}>[] {
	if (!inputs || inputs.length !== sources.length || ports.length !== sources.length) {
		throw new Error('The native media host did not mount every granted live input sink.');
	}
	return Object.freeze(sources.map((source, index) => {
		const input = inputs[index]; const port = ports[index];
		if (!input || !port || input.role !== source.role || !input.sink
			|| typeof input.sink.write !== 'function' || typeof input.sink.complete !== 'function'
			|| typeof input.sink.abort !== 'function') {
			throw new Error('The native media host changed its live input role or sink authority.');
		}
		return Object.freeze({ source, port, sink: input.sink });
	}));
}

export function createNativeMediaHelperJobRunner(
	options: NativeMediaHelperJobRunnerOptions,
): NativeMediaHelperJobRunner {
	return new NativeMediaHelperJobRunner(options);
}

interface InvocationParts {
	readonly descriptor: FramescaperMediaHostDescriptor;
	readonly kind: NativeMediaHelperPoolJobKind;
	readonly plan: NativeMediaHostInvocation['plan'];
	readonly sources: readonly NativeMediaHostSourceInvocation[];
	readonly videoTimingAssets?: readonly NativeMediaHostVideoTimingInvocation[];
	readonly maximumOutputBytes: number;
	readonly scratchPath?: string | null;
	readonly decodeOutputPath?: string | null;
	readonly destinationRoot?: string | null;
	readonly temporaryOutputPath?: string | null;
	readonly proxyRecipe?: NativeMediaHostInvocation['proxyRecipe'];
	readonly imageSequence?: NativeMediaHostInvocation['imageSequence'];
	readonly backend?: HelperNativeMediaEncodeBackend;
}

function invocation(parts: InvocationParts): NativeMediaHostInvocation {
	return Object.freeze({
		executablePath: parts.descriptor.path,
		operation: parts.kind,
		plan: parts.plan,
		sources: Object.freeze([...parts.sources]),
		videoTimingAssets: Object.freeze([...(parts.videoTimingAssets ?? [])]),
		backend: parts.backend ?? 'native-cpu',
		maximumOutputBytes: parts.maximumOutputBytes,
		scratchPath: parts.scratchPath ?? null,
		decodeOutputPath: parts.decodeOutputPath ?? null,
		destinationRoot: parts.destinationRoot ?? null,
		temporaryOutputPath: parts.temporaryOutputPath ?? null,
		proxyRecipe: parts.proxyRecipe ?? null,
		imageSequence: parts.imageSequence ?? null,
	});
}

function jobBindings(
	kind: NativeMediaHelperPoolJobKind,
	grant: HelperJobGrant<NativeMediaHelperPoolJobKind>,
): readonly (
	HelperDataPlaneBinding | HelperDataPlaneInputReservation | HelperDataPlaneOutputReservation
)[] {
	if (kind === 'probe-video-source') return Object.freeze([]);
	if (kind === 'media-proxy') {
		const value = grant as HelperMediaProxyJobGrant;
		return Object.freeze([value.plan, ...streamBindings([value.source])]);
	}
	const value = grant as HelperMediaDecodeJobGrant;
	return Object.freeze([
		value.plan,
		...streamBindings(value.sources),
		...(kind === 'media-decode' ? [value.output] : []),
	]);
}

function streamBindings(inputs: readonly HelperNativeInputGrant[]): readonly (
	HelperDataPlaneBinding | HelperDataPlaneInputReservation
)[] {
	return inputs.flatMap((input) => input.type === 'stream' ? [input.binding] : []);
}

function admittedPorts(
	value: readonly HelperDataPlaneIoPort[],
	expected: number,
): readonly HelperDataPlaneIoPort[] {
	if (!Array.isArray(value) || value.length !== expected) {
		throw new TypeError('A native media job did not receive every exact transferred MessagePort.');
	}
	const unique = new Set<HelperDataPlaneIoPort>();
	for (const port of value) {
		if (!port || typeof port !== 'object' || typeof port.postMessage !== 'function'
			|| typeof port.on !== 'function' || typeof port.close !== 'function' || unique.has(port)) {
			throw new TypeError('A native media job received an invalid or repeated transferred MessagePort.');
		}
		unique.add(port);
	}
	return Object.freeze([...value]);
}

function scratchDemand(
	kind: Exclude<NativeMediaHelperPoolJobKind, 'probe-video-source'>,
	grant: HelperMediaDecodeJobGrant | HelperMediaEncodeJobGrant | HelperMediaProxyJobGrant,
): number {
	const inputs = kind === 'media-proxy'
		? [(grant as HelperMediaProxyJobGrant).source]
		: (grant as HelperMediaDecodeJobGrant).sources;
	return grant.plan.byteLength
		+ inputs.reduce((total, input) => total + (input.type === 'stream'
			&& !('authentication' in input.binding) ? input.binding.byteLength : 0), 0)
		+ (kind === 'media-decode' ? decodeOutputMaximum(
			(grant as HelperMediaDecodeJobGrant).output,
		) : 0);
}

function decodeOutputMaximum(output: HelperMediaDecodeJobGrant['output']): number {
	return 'byteLength' in output ? output.byteLength : output.maximumByteLength;
}

function assertExecutableGrant(
	grant: HelperMediaDecodeJobGrant | HelperMediaEncodeJobGrant | HelperMediaProxyJobGrant,
	descriptor: FramescaperMediaHostDescriptor,
): void {
	const executable = grant.executable;
	if (executable.path !== descriptor.path || executable.bytes !== descriptor.byteLength
		|| executable.sha256 !== descriptor.sha256 || executable.identity.dev !== descriptor.identity.dev
		|| executable.identity.ino !== descriptor.identity.ino) {
		throw new Error('The media job executable grant does not match the authenticated host payload.');
	}
}

async function assertCanonicalPlan(path: string, fingerprint: string): Promise<void> {
	const bytes = await readFile(path);
	let plan: unknown;
	try { plan = JSON.parse(String(bytes)) as unknown; }
	catch { throw new Error('The helper-spooled native media plan is not JSON.'); }
	const version = (plan as Readonly<{ version?: unknown }> | null)?.version;
	const envelope = version === 13 || version === 14
		? createNativeMediaPlanEnvelopeV2(plan)
		: createNativeMediaPlanEnvelopeV1(plan);
	if (Buffer.from(canonicalizeNativeMediaPlan(envelope.plan)).compare(bytes) !== 0
		|| envelope.fingerprint !== fingerprint) {
		throw new Error('The helper-spooled native media plan is not its exact canonical fingerprint.');
	}
}

async function successfulResult(
	completion: Promise<NativeMediaHostProcessResult>,
	kind: NativeMediaHelperPoolJobKind,
): Promise<NativeMediaHostProcessResult> {
	const result = await completion;
	if (Buffer.byteLength(result.stdout) > NATIVE_MEDIA_HOST_CONTROL_MAXIMUM_BYTES
		|| Buffer.byteLength(result.stderr) > NATIVE_MEDIA_HOST_CONTROL_MAXIMUM_BYTES) {
		throw new Error('The native media host exceeded its 64 KiB control-output bound.');
	}
	if (result.exitCode !== 0) {
		throw new NativeMediaHostOperationError(
			hostFailureCode(result.stdout, result.exitCode), result.exitCode, kind,
		);
	}
	return result;
}

function hostFailureCode(stdout: string, exitCode: number): string {
	try {
		const value = JSON.parse(stdout) as Readonly<{ readonly error?: unknown }>;
		if (typeof value?.error === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value.error)) {
			return value.error;
		}
	} catch { /* A malformed host refusal stays fatal and retains only its exit identity. */ }
	return `native-host-exit-${String(exitCode)}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function assertOutputControl(
	control: Readonly<{ byteLength: number; sha256: string }>,
	inspected: Readonly<{ byteLength: number; sha256: string }>,
): void {
	if (control.byteLength !== inspected.byteLength || control.sha256 !== inspected.sha256) {
		throw new Error('The native media host control result does not match the independently inspected output.');
	}
}

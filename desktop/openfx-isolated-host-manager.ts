/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Main-owned OpenFX process isolation. Scanners are single-use and runtime
 * helpers are partitioned by the authenticated plug-in binary fingerprint.
 * No renderer-facing value contains an executable or plug-in path.
 */

import {
	validateHelperJobGrant,
	validateHelperJobResult,
	type HelperOfxScanJobGrant,
	type HelperOfxScanJobResult,
	type HelperStreamOutputJobResult,
	type HelperOfxInteractJobResultV1,
} from './helper-contract.ts';
import type {
	HelperOfxHostJobGrantV1OrV2,
	HelperOfxRenderHostJobGrantV1OrV2,
} from './helper-native-ofx-host-grant-v2.ts';
import { isHelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
import type {
	HelperJobRequest,
	HelperSupervisorSnapshot,
} from './helper-supervisor.ts';
import {
	assertOfxHostInvocationV1,
	isOfxRetryableGpuError,
	type OfxHostInvocationV1,
	type OfxRenderBackendV1,
} from '../src/common/editor/native-ofx-host-contract.ts';
import {
	assertOfxHostInvocationV2,
	type OfxHostInvocationV2,
} from '../src/common/editor/native-ofx-host-contract-v2.ts';
import { canonicalizeNativeMediaSummaryValue } from '../src/common/editor/native-media-plan-canonical-form.ts';

const MAXIMUM_RUNTIME_PROCESSES = 128;

export interface OfxIsolatedWorkerPort {
	runJob<Kind extends 'ofx-scan' | 'ofx-host'>(
		request: HelperJobRequest<Kind>,
	): Promise<unknown>;
	snapshot(): HelperSupervisorSnapshot;
	clearQuarantine(): void;
	dispose(): void;
}

export interface OfxIsolatedHostManagerOptions {
	readonly createScanner: () => OfxIsolatedWorkerPort;
	readonly createRuntime: (pluginFingerprint: string) => OfxIsolatedWorkerPort;
	readonly maximumRuntimeProcesses?: number;
}

export interface OfxIsolatedRuntimeSnapshot {
	readonly pluginFingerprint: string;
	readonly state: HelperSupervisorSnapshot['state'];
	readonly quarantined: boolean;
	readonly degradedBackends: readonly OfxRenderBackendV1[];
}

export interface OfxIsolatedHostManagerSnapshot {
	readonly runtimes: readonly OfxIsolatedRuntimeSnapshot[];
	readonly disposed: boolean;
}

export interface OfxCpuAttempt {
	readonly invocation: OfxHostInvocationV1 | OfxHostInvocationV2;
	readonly request: Omit<HelperJobRequest<'ofx-host'>, 'grant'> & Readonly<{
		grant: HelperOfxRenderHostJobGrantV1OrV2;
	}>;
}

export interface OfxRenderWithCpuFallbackRequest extends OfxCpuAttempt {
	readonly createCpuAttempt: () => OfxCpuAttempt;
}

export interface OfxRenderWithCpuFallbackResult {
	readonly backend: OfxRenderBackendV1;
	readonly retriedOnCpu: boolean;
	readonly reportsDegradation: boolean;
	readonly result: HelperStreamOutputJobResult;
}

export class OfxIsolatedHostManager {
	readonly #createScanner: OfxIsolatedHostManagerOptions['createScanner'];
	readonly #createRuntime: OfxIsolatedHostManagerOptions['createRuntime'];
	readonly #maximumRuntimeProcesses: number;
	readonly #runtimes = new Map<string, OfxIsolatedWorkerPort>();
	readonly #degradedBackends = new Map<string, Set<OfxRenderBackendV1>>();
	#disposed = false;

	constructor(options: OfxIsolatedHostManagerOptions) {
		if (!options || typeof options.createScanner !== 'function'
			|| typeof options.createRuntime !== 'function') {
			throw new TypeError('OpenFX isolation requires scanner and runtime factories.');
		}
		const maximum = options.maximumRuntimeProcesses ?? MAXIMUM_RUNTIME_PROCESSES;
		if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAXIMUM_RUNTIME_PROCESSES) {
			throw new RangeError('OpenFX isolation admits between one and 128 runtime processes.');
		}
		this.#createScanner = options.createScanner;
		this.#createRuntime = options.createRuntime;
		this.#maximumRuntimeProcesses = maximum;
	}

	async scan(request: HelperJobRequest<'ofx-scan'>): Promise<HelperOfxScanJobResult> {
		this.#assertActive();
		const grant = validateHelperJobGrant('ofx-scan', request.grant) as HelperOfxScanJobGrant;
		const scanner = this.#createScanner();
		try {
			const result = await scanner.runJob({ ...request, kind: 'ofx-scan', grant });
			return validateHelperJobResult('ofx-scan', result, grant);
		} finally {
			scanner.dispose();
		}
	}

	async host(
		invocation: OfxHostInvocationV1 | OfxHostInvocationV2,
		request: HelperJobRequest<'ofx-host'>,
	): Promise<HelperStreamOutputJobResult> {
		this.#assertActive();
		assertOfxHostInvocationV1OrV2(invocation);
		const grant = validateHelperJobGrant('ofx-host', request.grant) as HelperOfxHostJobGrantV1OrV2;
		if (isHelperOfxInteractJobGrantV1(grant)) {
			throw new Error('A frame invocation cannot cross into the OpenFX Interact host variant.');
		}
		if (grant.pluginBinary.sha256 !== invocation.pluginBinarySha256) {
			throw new Error('The OpenFX runtime grant binary digest does not match its invocation fingerprint.');
		}
		if (canonicalizeNativeMediaSummaryValue(grant.invocation)
			!== canonicalizeNativeMediaSummaryValue(invocation)) {
			throw new Error('The OpenFX runtime grant does not carry the exact admitted invocation.');
		}
		const worker = this.#runtime(invocation.pluginFingerprint);
		const result = await worker.runJob({ ...request, kind: 'ofx-host', grant });
		const admitted = validateHelperJobResult('ofx-host', result, grant);
		if (!('output' in admitted)) throw new Error('An OpenFX frame host returned an Interact result.');
		return admitted;
	}

	async interact(
		pluginFingerprint: string,
		request: HelperJobRequest<'ofx-host'>,
		onRuntimeFailure?: (error: unknown) => void,
	): Promise<HelperOfxInteractJobResultV1> {
		this.#assertActive();
		const grant = validateHelperJobGrant('ofx-host', request.grant) as HelperOfxHostJobGrantV1OrV2;
		if (!isHelperOfxInteractJobGrantV1(grant) || grant.pluginFingerprint !== pluginFingerprint) {
			throw new Error('An OpenFX Interact job does not bind its isolated binary fingerprint.');
		}
		const worker = this.#runtime(pluginFingerprint);
		let result: unknown;
		try { result = await worker.runJob({ ...request, kind: 'ofx-host', grant }); }
		catch (error) {
			if (!request.signal?.aborted) onRuntimeFailure?.(error);
			throw error;
		}
		try {
			const admitted = validateHelperJobResult('ofx-host', result, grant);
			if (!('interact' in admitted)) throw new Error('An OpenFX Interact host returned a frame result.');
			return admitted;
		} catch (error) {
			onRuntimeFailure?.(error);
			throw error;
		}
	}

	async renderWithCpuFallback(
		request: OfxRenderWithCpuFallbackRequest,
	): Promise<OfxRenderWithCpuFallbackResult> {
		assertOfxHostInvocationV1OrV2(request.invocation);
		if (request.invocation.requestedBackend !== 'cpu'
			&& this.backendDegraded(
				request.invocation.pluginFingerprint, request.invocation.requestedBackend,
			)) {
			return this.#cpuFallback(request);
		}
		try {
			const result = await this.host(request.invocation, request.request);
			return Object.freeze({
				backend: request.invocation.requestedBackend,
				retriedOnCpu: false,
				reportsDegradation: false,
				result,
			});
		} catch (error) {
			if (request.request.signal?.aborted
				|| request.invocation.requestedBackend === 'cpu'
				|| !isOfxRetryableGpuError(error)) throw error;
			this.#degraded(request.invocation.pluginFingerprint)
				.add(request.invocation.requestedBackend);
			return this.#cpuFallback(request);
		}
	}

	backendDegraded(pluginFingerprint: string, backend: OfxRenderBackendV1): boolean {
		return backend !== 'cpu' && this.#degradedBackends.get(pluginFingerprint)?.has(backend) === true;
	}

	clearQuarantine(pluginFingerprint: string): void {
		this.#assertActive();
		this.#runtimes.get(pluginFingerprint)?.clearQuarantine();
		this.#degradedBackends.delete(pluginFingerprint);
	}

	release(pluginFingerprint: string): void {
		const runtime = this.#runtimes.get(pluginFingerprint);
		if (!runtime) return;
		this.#runtimes.delete(pluginFingerprint);
		this.#degradedBackends.delete(pluginFingerprint);
		runtime.dispose();
	}

	snapshot(): OfxIsolatedHostManagerSnapshot {
		return Object.freeze({
			runtimes: Object.freeze([...this.#runtimes.entries()]
				.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
				.map(([pluginFingerprint, runtime]) => {
					const state = runtime.snapshot();
					return Object.freeze({
						pluginFingerprint,
						state: state.state,
						quarantined: state.quarantined,
						degradedBackends: Object.freeze([
							...(this.#degradedBackends.get(pluginFingerprint) ?? []),
						].sort()),
					});
				})),
			disposed: this.#disposed,
		});
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const runtime of this.#runtimes.values()) runtime.dispose();
		this.#runtimes.clear();
		this.#degradedBackends.clear();
	}

	async #cpuFallback(
		request: OfxRenderWithCpuFallbackRequest,
	): Promise<OfxRenderWithCpuFallbackResult> {
		const cpu = request.createCpuAttempt();
		assertOfxHostInvocationV1OrV2(cpu.invocation);
		if (cpu.invocation.schemaVersion !== request.invocation.schemaVersion) {
			throw new Error('An OpenFX CPU fallback cannot cross invocation schema versions.');
		}
		if (cpu.invocation.requestedBackend !== 'cpu'
			|| cpu.invocation.pluginFingerprint !== request.invocation.pluginFingerprint) {
			throw new Error('An OpenFX GPU fallback must retry CPU for the identical binary fingerprint.');
		}
		const result = await this.host(cpu.invocation, cpu.request);
		return Object.freeze({
			backend: 'cpu' as const, retriedOnCpu: true, reportsDegradation: true, result,
		});
	}

	#degraded(pluginFingerprint: string): Set<OfxRenderBackendV1> {
		const current = this.#degradedBackends.get(pluginFingerprint);
		if (current) return current;
		const created = new Set<OfxRenderBackendV1>();
		this.#degradedBackends.set(pluginFingerprint, created);
		return created;
	}

	#runtime(pluginFingerprint: string): OfxIsolatedWorkerPort {
		const current = this.#runtimes.get(pluginFingerprint);
		if (current) return current;
		if (this.#runtimes.size >= this.#maximumRuntimeProcesses) {
			throw new RangeError('The OpenFX per-fingerprint runtime process ceiling is reached.');
		}
		const created = this.#createRuntime(pluginFingerprint);
		this.#runtimes.set(pluginFingerprint, created);
		return created;
	}

	#assertActive(): void {
		if (this.#disposed) throw new Error('The OpenFX isolated host manager is disposed.');
	}
}

function assertOfxHostInvocationV1OrV2(
	value: unknown,
): asserts value is OfxHostInvocationV1 | OfxHostInvocationV2 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An isolated OpenFX invocation must be an object.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('An isolated OpenFX invocation requires a schemaVersion data field.');
	}
	if (descriptor.value === 1) return assertOfxHostInvocationV1(value);
	if (descriptor.value === 2) return assertOfxHostInvocationV2(value);
	throw new RangeError('An isolated OpenFX invocation schema version is unsupported.');
}

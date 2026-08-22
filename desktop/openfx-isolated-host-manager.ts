/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Main-owned OpenFX process isolation. Scanners are single-use and runtime
 * helpers are partitioned by the authenticated plug-in binary fingerprint.
 * No renderer-facing value contains an executable or plug-in path.
 */

import {
	validateHelperJobGrant,
	validateHelperJobResult,
	type HelperOfxHostJobGrant,
	type HelperOfxScanJobGrant,
	type HelperOfxScanJobResult,
	type HelperStreamOutputJobResult,
} from './helper-contract.ts';
import type {
	HelperJobRequest,
	HelperSupervisorSnapshot,
} from './helper-supervisor.ts';
import {
	assertOfxHostInvocationV1,
	type OfxHostInvocationV1,
	type OfxRenderBackendV1,
} from '../src/common/editor/native-ofx-host-contract.ts';
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
}

export interface OfxIsolatedHostManagerSnapshot {
	readonly runtimes: readonly OfxIsolatedRuntimeSnapshot[];
	readonly disposed: boolean;
}

export interface OfxCpuAttempt {
	readonly invocation: OfxHostInvocationV1;
	readonly request: HelperJobRequest<'ofx-host'>;
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
		invocation: OfxHostInvocationV1,
		request: HelperJobRequest<'ofx-host'>,
	): Promise<HelperStreamOutputJobResult> {
		this.#assertActive();
		assertOfxHostInvocationV1(invocation);
		const grant = validateHelperJobGrant('ofx-host', request.grant) as HelperOfxHostJobGrant;
		if (grant.pluginBinary.sha256 !== invocation.pluginBinarySha256) {
			throw new Error('The OpenFX runtime grant binary digest does not match its invocation fingerprint.');
		}
		if (canonicalizeNativeMediaSummaryValue(grant.invocation)
			!== canonicalizeNativeMediaSummaryValue(invocation)) {
			throw new Error('The OpenFX runtime grant does not carry the exact admitted invocation.');
		}
		const worker = this.#runtime(invocation.pluginFingerprint);
		const result = await worker.runJob({ ...request, kind: 'ofx-host', grant });
		return validateHelperJobResult('ofx-host', result, grant);
	}

	async renderWithCpuFallback(
		request: OfxRenderWithCpuFallbackRequest,
	): Promise<OfxRenderWithCpuFallbackResult> {
		assertOfxHostInvocationV1(request.invocation);
		try {
			const result = await this.host(request.invocation, request.request);
			return Object.freeze({
				backend: request.invocation.requestedBackend,
				retriedOnCpu: false,
				reportsDegradation: false,
				result,
			});
		} catch (error) {
			if (request.request.signal?.aborted || request.invocation.requestedBackend === 'cpu') throw error;
			const cpu = request.createCpuAttempt();
			assertOfxHostInvocationV1(cpu.invocation);
			if (cpu.invocation.requestedBackend !== 'cpu'
				|| cpu.invocation.pluginFingerprint !== request.invocation.pluginFingerprint) {
				throw new Error('An OpenFX GPU fallback must retry CPU for the identical binary fingerprint.');
			}
			const result = await this.host(cpu.invocation, cpu.request);
			return Object.freeze({
				backend: 'cpu' as const,
				retriedOnCpu: true,
				reportsDegradation: true,
				result,
			});
		}
	}

	clearQuarantine(pluginFingerprint: string): void {
		this.#assertActive();
		this.#runtimes.get(pluginFingerprint)?.clearQuarantine();
	}

	release(pluginFingerprint: string): void {
		const runtime = this.#runtimes.get(pluginFingerprint);
		if (!runtime) return;
		this.#runtimes.delete(pluginFingerprint);
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

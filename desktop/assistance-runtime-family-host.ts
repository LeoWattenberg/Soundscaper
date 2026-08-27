/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy, family-isolated utility-process routing for optional Milestone 7 inference. */

import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	type AssistanceRuntimeFamilyAvailability,
	type AssistanceRuntimeFamilyDescriptor,
	type AssistanceRuntimeFamilyId,
} from './assistance-runtime-family-manifest.ts';
import {
	AssistanceRuntimeFamilyTaskContractError,
	validateAssistanceRuntimeFamilyJobRequestV1,
	type AssistanceRuntimeFamilyAdmittedJob,
	type AssistanceRuntimeFamilyJobRequestV1,
} from './assistance-runtime-family-job-contract.ts';
import {
	ASSISTANCE_POWER_HOLD_BUDGET_MS,
	awaitAssistancePowerAdmission,
	type AssistancePowerEtiquettePort,
	type AssistancePowerHoldReason,
} from './assistance-power-etiquette-v1.ts';
import { HelperCrashLedger } from './helper-supervision-state.ts';

export const ASSISTANCE_RUNTIME_FAMILY_CANCELLATION_BUDGET_MS = 2_000;
export {
	ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
	ASSISTANCE_RUNTIME_FAMILY_TASKS,
	validateAssistanceRuntimeFamilyJobRequestV1,
} from './assistance-runtime-family-job-contract.ts';
export type {
	AssistanceRuntimeFamilyAdmittedJob,
	AssistanceRuntimeFamilyJobRequestV1,
	AssistanceRuntimeFamilyTask,
} from './assistance-runtime-family-job-contract.ts';

export interface AssistanceRuntimeFamilyProcessWorker {
	readonly completion: Promise<unknown>;
	/** Resolves only after the per-job native worker has terminated. */
	terminate(): Promise<void>;
}

export interface AssistanceRuntimeFamilyProcess {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly runtimeVersion: string;
	startWorker(
		job: AssistanceRuntimeFamilyAdmittedJob,
		options: Readonly<{ readonly onProgress?: (value: number) => void }>,
	): AssistanceRuntimeFamilyProcessWorker;
	onExit(listener: (code: number | null) => void): void;
	sampleRss(): number | null;
	/** Resolves only after the utility process has terminated. */
	terminate(): Promise<void>;
}

export interface AssistanceRuntimeFamilyRunOptions {
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number) => void;
	readonly onPowerHold?: (reason: AssistancePowerHoldReason) => void;
}

export interface AssistanceRuntimeFamilyRouterOptions {
	readonly availability: (
		familyId: AssistanceRuntimeFamilyId,
	) => Promise<AssistanceRuntimeFamilyAvailability>;
	readonly spawns: Readonly<Record<AssistanceRuntimeFamilyId, (
		descriptor: AssistanceRuntimeFamilyDescriptor,
	) => AssistanceRuntimeFamilyProcess | Promise<AssistanceRuntimeFamilyProcess>>>;
	readonly totalMemoryBytes: () => number;
	readonly availableMemoryBytes: () => number;
	readonly cancellationBudgetMs?: number;
	readonly rssPollIntervalMs?: number;
	/** Optional inference is background work, so it waits for mains power and a cool machine. */
	readonly powerEtiquette?: AssistancePowerEtiquettePort;
	readonly powerHoldBudgetMs?: number;
	readonly quarantineCrashLimit?: number;
	readonly quarantineWindowMs?: number;
	readonly now?: () => number;
	readonly setTimeoutImpl?: typeof setTimeout;
	readonly clearTimeoutImpl?: typeof clearTimeout;
	readonly setIntervalImpl?: typeof setInterval;
	readonly clearIntervalImpl?: typeof clearInterval;
}

export type AssistanceRuntimeFamilyErrorCode =
	| 'invalid-request'
	| 'unsupported-task'
	| 'unsupported-platform'
	| 'manifest-missing'
	| 'manifest-invalid'
	| 'payload-pending-external'
	| 'payload-missing'
	| 'payload-digest-mismatch'
	| 'insufficient-memory'
	| 'power-deferred'
	| 'quarantined'
	| 'busy'
	| 'cancelled'
	| 'cancellation-timeout'
	| 'runtime-exit'
	| 'worker-error'
	| 'malformed-message'
	| 'resource-violation'
	| 'disposed';

export class AssistanceRuntimeFamilyError extends Error {
	readonly code: AssistanceRuntimeFamilyErrorCode;
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly jobId: string | null;

	constructor(
		code: AssistanceRuntimeFamilyErrorCode,
		familyId: AssistanceRuntimeFamilyId,
		message: string,
		jobId: string | null = null,
	) {
		super(message);
		this.name = 'AssistanceRuntimeFamilyError';
		this.code = code;
		this.familyId = familyId;
		this.jobId = jobId;
	}
}

export interface AssistanceRuntimeFamilySnapshot {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly state: 'idle' | 'starting' | 'ready' | 'busy' | 'quarantined' | 'disposed';
	readonly processSpawned: boolean;
	readonly recentCrashes: number;
	readonly quarantined: boolean;
}

interface ActiveJob {
	readonly request: AssistanceRuntimeFamilyJobRequestV1;
	readonly process: AssistanceRuntimeFamilyProcess;
	readonly worker: AssistanceRuntimeFamilyProcessWorker;
	readonly signal?: AbortSignal;
	readonly abortListener?: () => void;
	resolve(value: unknown): void;
	reject(error: Error): void;
	settled: boolean;
	cancelling: boolean;
	durationTimer: ReturnType<typeof setTimeout> | null;
	rssTimer: ReturnType<typeof setInterval> | null;
}

interface FamilySlot {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly crashes: HelperCrashLedger;
	process: AssistanceRuntimeFamilyProcess | null;
	starting: Promise<AssistanceRuntimeFamilyProcess> | null;
	reserved: boolean;
	active: ActiveJob | null;
}

export function createAssistanceRuntimeFamilyRouter(options: AssistanceRuntimeFamilyRouterOptions) {
	assertOptions(options);
	const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
	const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
	const setIntervalImpl = options.setIntervalImpl ?? setInterval;
	const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
	const cancellationBudgetMs = boundedOption(
		options.cancellationBudgetMs,
		ASSISTANCE_RUNTIME_FAMILY_CANCELLATION_BUDGET_MS,
		ASSISTANCE_RUNTIME_FAMILY_CANCELLATION_BUDGET_MS,
		'cancellation budget',
	);
	const rssPollIntervalMs = boundedOption(options.rssPollIntervalMs, 100, 10_000, 'RSS interval');
	const powerHoldBudgetMs = boundedOption(
		options.powerHoldBudgetMs, ASSISTANCE_POWER_HOLD_BUDGET_MS, 600_000, 'power hold budget',
	);
	const expectedTerminations = new WeakSet<object>();
	let disposed = false;
	let reservedMemoryBytes = 0;
	const familyIds = Object.keys(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS) as AssistanceRuntimeFamilyId[];
	const slots = Object.fromEntries(familyIds.map((familyId) => [familyId, {
		familyId,
		crashes: new HelperCrashLedger({
			crashLimit: options.quarantineCrashLimit ?? 3,
			windowMs: options.quarantineWindowMs ?? 60_000,
			now: options.now ?? (() => Date.now()),
		}),
		process: null, starting: null, reserved: false, active: null,
	} satisfies FamilySlot])) as Record<AssistanceRuntimeFamilyId, FamilySlot>;

	function run(value: unknown, runOptions: AssistanceRuntimeFamilyRunOptions = {}): Promise<unknown> {
		let request: AssistanceRuntimeFamilyJobRequestV1;
		try {
			request = validateAssistanceRuntimeFamilyJobRequestV1(value);
		} catch (error) {
			if (error instanceof AssistanceRuntimeFamilyTaskContractError) {
				return Promise.reject(new AssistanceRuntimeFamilyError(
					'unsupported-task', error.familyId, error.message, error.jobId,
				));
			}
			return Promise.reject(error instanceof AssistanceRuntimeFamilyError ? error
				: new AssistanceRuntimeFamilyError('invalid-request', inferredFamily(value),
					errorMessage(error), inferredJobId(value)));
		}
		const slot = slots[request.familyId];
		if (disposed) return Promise.reject(failure('disposed', request, 'The runtime-family router is disposed.'));
		if (slot.crashes.quarantined) {
			return Promise.reject(failure('quarantined', request,
				`${request.familyId} is quarantined after repeated process crashes.`));
		}
		if (slot.reserved || slot.active) {
			return Promise.reject(failure('busy', request, `${request.familyId} already has an active job.`));
		}
		if (runOptions.signal?.aborted) {
			return Promise.reject(failure('cancelled', request, 'The runtime-family job was cancelled.'));
		}
		slot.reserved = true;
		return admitAndRun(slot, request, runOptions).finally(() => {
			slot.reserved = false;
		});
	}

	async function admitAndRun(
		slot: FamilySlot,
		request: AssistanceRuntimeFamilyJobRequestV1,
		runOptions: AssistanceRuntimeFamilyRunOptions,
	): Promise<unknown> {
		await admitPower(request, runOptions);
		assertMemoryAdmission(request);
		reservedMemoryBytes += request.maximumRssBytes;
		try {
			const process = await ensureProcess(slot, request);
			if (runOptions.signal?.aborted) {
				throw failure('cancelled', request, 'The runtime-family job was cancelled.');
			}
			const admitted = Object.freeze({ ...request, descriptor: descriptorFor(slot, process) });
			const worker = process.startWorker(admitted, {
				onProgress: runOptions.onProgress === undefined ? undefined : (value) => {
					if (!Number.isFinite(value) || value < 0 || value > 1) {
						void protocolViolation(slot, process, request);
						return;
					}
					runOptions.onProgress?.(value);
				},
			});
			if (!worker || typeof worker.terminate !== 'function'
				|| !(worker.completion instanceof Promise)) {
				throw new TypeError('The runtime-family process returned no terminateable worker.');
			}
			return await new Promise<unknown>((resolve, reject) => {
				const abortListener = runOptions.signal === undefined ? undefined
					: () => { void cancelActive(slot); };
				const active: ActiveJob = {
					request, process, worker, signal: runOptions.signal, abortListener,
					resolve, reject, settled: false, cancelling: false,
					durationTimer: null, rssTimer: null,
				};
				slot.active = active;
				runOptions.signal?.addEventListener('abort', abortListener!, { once: true });
				active.durationTimer = setTimeoutImpl(() => {
					void resourceViolation(slot, active, 'The runtime-family job exceeded its admitted duration.');
				}, request.maximumDurationMs);
				active.rssTimer = setIntervalImpl(() => {
					let rss: number | null;
					try { rss = process.sampleRss(); }
					catch {
						void resourceViolation(slot, active,
							'The runtime-family process RSS could not be sampled.');
						return;
					}
					if (rss !== null && (!Number.isSafeInteger(rss) || rss < 0
						|| rss > request.maximumRssBytes)) {
						void resourceViolation(slot, active,
							'The runtime-family process exceeded its admitted resident-set limit.');
					}
				}, rssPollIntervalMs);
				void worker.completion.then(
					(value) => { if (!active.cancelling) settle(slot, active, null, value); },
					(error: unknown) => {
						if (!active.cancelling) settle(slot, active,
							failure('worker-error', request, errorMessage(error)));
					},
				);
				if (runOptions.signal?.aborted) abortListener?.();
			});
		} catch (error) {
			throw error instanceof AssistanceRuntimeFamilyError ? error : failure('worker-error', request,
				`The ${request.familyId} worker could not start: ${errorMessage(error)}`);
		} finally {
			reservedMemoryBytes -= request.maximumRssBytes;
		}
	}

	/**
	 * Holds new work while the machine runs on battery or reports serious thermal
	 * pressure. The hold is bounded, and it never touches a job already running:
	 * a transient condition delays admission, a sustained one reports it.
	 */
	async function admitPower(
		request: AssistanceRuntimeFamilyJobRequestV1,
		runOptions: AssistanceRuntimeFamilyRunOptions,
	): Promise<void> {
		const port = options.powerEtiquette;
		if (port === undefined) return;
		const outcome = await awaitAssistancePowerAdmission({
			port,
			holdBudgetMs: powerHoldBudgetMs,
			...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
			...(runOptions.onPowerHold === undefined ? {} : { onHold: runOptions.onPowerHold }),
			setTimeoutImpl, clearTimeoutImpl,
		});
		if (outcome.outcome === 'admitted') return;
		if (outcome.outcome === 'cancelled') {
			throw failure('cancelled', request, 'The runtime-family job was cancelled.');
		}
		throw failure('power-deferred', request,
			`${request.familyId} deferred its job: ${outcome.detail}`);
	}

	const descriptors = new WeakMap<object, AssistanceRuntimeFamilyDescriptor>();

	async function ensureProcess(
		slot: FamilySlot,
		request: AssistanceRuntimeFamilyJobRequestV1,
	): Promise<AssistanceRuntimeFamilyProcess> {
		if (slot.process) return slot.process;
		if (slot.starting) return slot.starting;
		const starting = (async () => {
			let availability: AssistanceRuntimeFamilyAvailability;
			try { availability = await options.availability(slot.familyId); }
			catch (error) {
				throw failure('manifest-invalid', request,
					`The runtime-family payload could not be resolved: ${errorMessage(error)}`);
			}
			if (availability.status === 'unavailable') {
				throw new AssistanceRuntimeFamilyError(
					availability.reason === 'insufficient-system-memory'
						? 'insufficient-memory' : availability.reason,
					slot.familyId, availability.detail, request.jobId,
				);
			}
			if (availability.descriptor.familyId !== slot.familyId
				|| availability.descriptor.executionProvider !== 'cpu') {
				throw failure('manifest-invalid', request,
					'The runtime-family availability returned a foreign or non-CPU descriptor.');
			}
			let process: AssistanceRuntimeFamilyProcess;
			try { process = await options.spawns[slot.familyId](availability.descriptor); }
			catch (error) {
				throw failure('worker-error', request,
					`The ${slot.familyId} utility process could not start: ${errorMessage(error)}`);
			}
			if (!process || typeof process.startWorker !== 'function'
				|| typeof process.onExit !== 'function' || typeof process.sampleRss !== 'function'
				|| typeof process.terminate !== 'function') {
				throw failure('worker-error', request,
					'The runtime-family spawn returned no supervised utility process.');
			}
			if (process.familyId !== slot.familyId
				|| process.runtimeVersion !== availability.descriptor.runtimeVersion) {
				expectedTerminations.add(process);
				try { await process.terminate(); } catch { /* Identity failure remains authoritative. */ }
				throw failure('worker-error', request,
					'The runtime-family utility process reported a foreign family or version.');
			}
			descriptors.set(process, availability.descriptor);
			slot.process = process;
			process.onExit((code) => handleExit(slot, process, code));
			if (disposed) {
				expectedTerminations.add(process);
				await process.terminate();
				throw failure('disposed', request, 'The runtime-family router was disposed during spawn.');
			}
			if (slot.process !== process) {
				throw failure('runtime-exit', request,
					`${slot.familyId} exited during utility-process admission.`);
			}
			return process;
		})();
		slot.starting = starting;
		try { return await starting; }
		finally { if (slot.starting === starting) slot.starting = null; }
	}

	function descriptorFor(
		slot: FamilySlot,
		process: AssistanceRuntimeFamilyProcess,
	): AssistanceRuntimeFamilyDescriptor {
		const descriptor = descriptors.get(process);
		if (!descriptor || descriptor.familyId !== slot.familyId) {
			throw new Error('The runtime-family process lost its authenticated descriptor.');
		}
		return descriptor;
	}

	function assertMemoryAdmission(request: AssistanceRuntimeFamilyJobRequestV1): void {
		const total = options.totalMemoryBytes();
		const available = options.availableMemoryBytes();
		const floor = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[request.familyId].minimumSystemMemoryBytes;
		if (!Number.isSafeInteger(total) || total < 1 || total < floor
			|| !Number.isSafeInteger(available)
			|| available - reservedMemoryBytes < request.maximumRssBytes) {
			throw failure('insufficient-memory', request,
				`${request.familyId} failed system or available-memory admission.`);
		}
	}

	function handleExit(
		slot: FamilySlot,
		process: AssistanceRuntimeFamilyProcess,
		code: number | null,
	): void {
		if (expectedTerminations.delete(process)) return;
		if (slot.process === process) slot.process = null;
		const active = slot.active;
		if (active?.process === process) {
			if (active.cancelling) {
				settle(slot, active, failure('cancellation-timeout', active.request,
					`${slot.familyId} exited while its worker cancellation was being contained.`));
				return;
			}
			slot.crashes.record();
			settle(slot, active, failure('runtime-exit', active.request,
				`${slot.familyId} exited unexpectedly with code ${String(code)}.`));
			return;
		}
		slot.crashes.record();
	}

	async function cancelActive(slot: FamilySlot): Promise<void> {
		const active = slot.active;
		if (!active || active.settled || active.cancelling) return;
		active.cancelling = true;
		let deadline: ReturnType<typeof setTimeout> | null = null;
		let containment: Promise<boolean> | null = null;
		const containProcess = (): Promise<boolean> => {
			containment ??= terminateProcess(slot, active.process);
			return containment;
		};
		const timedOut = new Promise<'timeout'>((resolve) => {
			deadline = setTimeoutImpl(() => { resolve('timeout'); }, cancellationBudgetMs);
		});
		const workerStopped = Promise.resolve().then(() => active.worker.terminate()).then(
			() => 'worker' as const,
			async () => await containProcess() ? 'process' as const : 'timeout' as const,
		);
		const outcome = await Promise.race([workerStopped, timedOut]);
		if (deadline) clearTimeoutImpl(deadline);
		if (active.settled) return;
		if (outcome === 'timeout') {
			void containProcess();
			settle(slot, active, failure('cancellation-timeout', active.request,
				'The runtime-family worker missed its cancellation deadline and its process kill was issued.'));
			return;
		}
		settle(slot, active, failure('cancelled', active.request,
			'The runtime-family job was cancelled after worker termination.'));
	}

	async function resourceViolation(slot: FamilySlot, active: ActiveJob, message: string): Promise<void> {
		if (active.settled) return;
		active.cancelling = true;
		slot.crashes.record();
		await terminateProcess(slot, active.process);
		settle(slot, active, failure('resource-violation', active.request, message));
	}

	async function protocolViolation(
		slot: FamilySlot,
		process: AssistanceRuntimeFamilyProcess,
		request: AssistanceRuntimeFamilyJobRequestV1,
	): Promise<void> {
		const active = slot.active;
		if (!active || active.process !== process || active.settled) return;
		active.cancelling = true;
		slot.crashes.record();
		await terminateProcess(slot, process);
		settle(slot, active, failure('malformed-message', request,
			'The runtime-family worker published invalid progress.'));
	}

	async function terminateProcess(
		slot: FamilySlot,
		process: AssistanceRuntimeFamilyProcess,
	): Promise<boolean> {
		expectedTerminations.add(process);
		if (slot.process === process) slot.process = null;
		try { await process.terminate(); return true; }
		catch { return false; }
	}

	function settle(slot: FamilySlot, active: ActiveJob, error: Error | null, value?: unknown): void {
		if (active.settled) return;
		active.settled = true;
		if (active.durationTimer) clearTimeoutImpl(active.durationTimer);
		if (active.rssTimer) clearIntervalImpl(active.rssTimer);
		active.signal?.removeEventListener('abort', active.abortListener!);
		if (slot.active === active) slot.active = null;
		if (error) active.reject(error); else active.resolve(value);
	}

	function snapshot(familyId: AssistanceRuntimeFamilyId): AssistanceRuntimeFamilySnapshot {
		const slot = slots[familyId];
		const quarantined = slot.crashes.quarantined;
		return Object.freeze({
			familyId,
			state: disposed ? 'disposed' : quarantined ? 'quarantined' : slot.active ? 'busy'
				: slot.starting ? 'starting' : slot.process ? 'ready' : 'idle',
			processSpawned: slot.process !== null,
			recentCrashes: slot.crashes.recentCount,
			quarantined,
		});
	}

	function clearQuarantine(familyId: AssistanceRuntimeFamilyId): void {
		if (!Object.hasOwn(slots, familyId)) throw new TypeError('The runtime-family id is invalid.');
		slots[familyId].crashes.clear();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const slot of Object.values(slots)) {
			const active = slot.active;
			if (active) settle(slot, active,
				failure('disposed', active.request, 'The runtime-family router is disposed.'));
			const process = slot.process;
			if (process) void terminateProcess(slot, process);
		}
	}

	return Object.freeze({ run, snapshot, clearQuarantine, dispose });
}

function failure(
	code: AssistanceRuntimeFamilyErrorCode,
	request: AssistanceRuntimeFamilyJobRequestV1,
	message: string,
): AssistanceRuntimeFamilyError {
	return new AssistanceRuntimeFamilyError(code, request.familyId, message, request.jobId);
}

function assertOptions(options: AssistanceRuntimeFamilyRouterOptions): void {
	if (!options || typeof options.availability !== 'function'
		|| typeof options.totalMemoryBytes !== 'function' || typeof options.availableMemoryBytes !== 'function') {
		throw new TypeError('The runtime-family router options are incomplete.');
	}
	const port = options.powerEtiquette;
	if (port !== undefined
		&& (!port || typeof port.observe !== 'function' || typeof port.subscribe !== 'function')) {
		throw new TypeError('The runtime-family router power etiquette port is invalid.');
	}
	for (const familyId of Object.keys(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS) as AssistanceRuntimeFamilyId[]) {
		if (typeof options.spawns?.[familyId] !== 'function') {
			throw new TypeError(`The runtime-family router has no isolated ${familyId} spawn.`);
		}
	}
}

function boundedOption(value: number | undefined, fallback: number, maximum: number, label: string): number {
	const admitted = value ?? fallback;
	if (!Number.isSafeInteger(admitted) || admitted < 1 || admitted > maximum) {
		throw new RangeError(`The runtime-family ${label} is invalid.`);
	}
	return admitted;
}

function inferredFamily(value: unknown): AssistanceRuntimeFamilyId {
	return plainRecord(value) && typeof value.familyId === 'string'
		&& Object.hasOwn(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS, value.familyId)
		? value.familyId as AssistanceRuntimeFamilyId : 'onnxruntime-node';
}

function inferredJobId(value: unknown): string | null {
	return plainRecord(value) && typeof value.jobId === 'string' ? value.jobId : null;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

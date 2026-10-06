/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSelectionEffectWorkerService, type SelectionEffectWorkerServiceRuntime,
	type SelectionEffectWorkerRequest, type SelectionEffectWorkerResult, type EffectWorkerRunOptions } from './selection-effect-worker-service.ts';
import { WorkerRequestCancelledError } from '../../../worker-protocol.ts';

export interface IndependentSelectionEffectOptions extends EffectWorkerRunOptions {
	readonly assertCurrent?: () => void;
}

/** One ordinary lane plus one privately owned lane; neither may supersede the other's job. */
export function createBoundedSelectionEffectWorkerService(runtime: SelectionEffectWorkerServiceRuntime) {
	const primary = createSelectionEffectWorkerService(runtime);
	let secondary: ReturnType<typeof createSelectionEffectWorkerService> | null = null;
	let batch: AbortController | null = null;
	let ordinary: AbortController | null = null;
	function cancelBatch(reason: Error): void {
		batch?.abort(reason); batch = null; ordinary?.abort(reason); ordinary = null;
		primary.cancelWorkers(reason); secondary?.cancelWorkers(reason);
	}
	const runSelectionEffectWorker: typeof primary.runSelectionEffectWorker = (request, options = {}) => {
		if (batch) cancelBatch(new WorkerRequestCancelledError()); else ordinary?.abort(new WorkerRequestCancelledError());
		const owner = new AbortController(); ordinary = owner;
		const forwardAbort = (): void => owner.abort(options.signal?.reason);
		options.signal?.addEventListener('abort', forwardAbort, { once: true }); if (options.signal?.aborted) forwardAbort();
		// The signal fences a resumed WASM preflight; the race releases UI ownership before that shared load completes.
		return racePendingOwner(primary.runSelectionEffectWorker(request, { ...options, signal: owner.signal }), owner.signal).finally(() => {
			options.signal?.removeEventListener('abort', forwardAbort);
			if (ordinary === owner) ordinary = null;
		});
	};
	async function runIndependentSelectionEffects(requests: readonly SelectionEffectWorkerRequest[],
		options: IndependentSelectionEffectOptions = {}): Promise<SelectionEffectWorkerResult[]> {
		if (!requests.length) return [];
		if (batch || ordinary) cancelBatch(new WorkerRequestCancelledError());
		const owner = new AbortController(); batch = owner;
		const abort = (): void => owner.abort(options.signal?.reason);
		options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
		const assertCurrent = (): void => {
			if (owner.signal.aborted) throw owner.signal.reason;
			options.assertCurrent?.();
		};
		const workersAvailable = runtime.workerAvailable ? runtime.workerAvailable() : typeof Worker === 'function';
		if (requests.length > 1 && workersAvailable) secondary ||= createSelectionEffectWorkerService({ ...runtime,
			state: { audacityEffectWorker: null, spectralWorker: null } });
		const lanes = requests.length > 1 && workersAvailable ? [primary, secondary!] : [primary];
		const results = new Array<SelectionEffectWorkerResult>(requests.length);
		let next = 0;
		let primaryFailure: unknown; let failed = false;
		try {
			await racePendingOwner(Promise.all(lanes.map(async (lane) => {
				try {
					for (;;) {
						assertCurrent(); const index = next++; if (index >= requests.length) break;
						results[index] = await lane.runSelectionEffectWorker(requests[index]!, { ...options, signal: owner.signal });
						assertCurrent();
					}
				} catch (error) {
					if (!failed) { failed = true; primaryFailure = error; owner.abort(error); }
				}
			})), owner.signal);
			if (failed) throw primaryFailure;
			assertCurrent(); return results;
		} finally {
			options.signal?.removeEventListener('abort', abort);
			if (batch === owner && (failed || owner.signal.aborted)) { primary.cancelWorkers(); secondary?.cancelWorkers(); }
			if (batch === owner) batch = null;
		}
	}
	return Object.freeze({ runSelectionEffectWorker, runIndependentSelectionEffects,
		runSpectralEditWorker: primary.runSpectralEditWorker,
		cancelWorkers(reason: Error = new WorkerRequestCancelledError()) { cancelBatch(reason); },
	});
}

/** Cancel this request immediately; leave the shared loader alive and fence its later continuation with the same signal. */
function racePendingOwner<Value>(pending: Promise<Value>, signal: AbortSignal): Promise<Value> {
	let cancelPending: () => void = () => undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		cancelPending = () => reject(signal.reason instanceof Error ? signal.reason : new WorkerRequestCancelledError());
		signal.addEventListener('abort', cancelPending, { once: true }); if (signal.aborted) cancelPending();
	});
	return Promise.race([pending, aborted]).finally(() => { signal.removeEventListener('abort', cancelPending); });
}

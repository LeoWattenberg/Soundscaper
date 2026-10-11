/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionSavedFileDiscovery, normalizeMotionSavedFileWatch, type MotionSavedFileCapabilities, type MotionSavedFileWatch } from './motion-saved-file-contract.ts';
import { MotionSavedFilePostPublicationError, receiveMotionSavedFileSnapshot, type MotionSavedFileReceipt, type MotionSavedFileReceiverOptions } from './motion-saved-file-source.ts';
export interface MotionSavedFileConnectionState {
	readonly status: 'disconnected' | 'connecting' | 'connected' | 'unavailable' | 'error' | 'disconnecting';
	readonly name: string | null; readonly receipt: MotionSavedFileReceipt | null; readonly error: unknown;
}
export interface MotionSavedFileConnectionOptions extends Pick<MotionSavedFileReceiverOptions, 'receive' | 'compositionId'> {
	readonly files: MotionSavedFileCapabilities; readonly pollIntervalMs?: number;
	onState?(state: MotionSavedFileConnectionState): void;
	onReceived?(receipt: MotionSavedFileReceipt): void;
}
/** Controller-owned lifetime: opening/closing its opt-in dialog does not own the connection. */
export function createMotionSavedFileConnection(options: MotionSavedFileConnectionOptions) {
	const interval = options.pollIntervalMs ?? 1000;
	if (!Number.isSafeInteger(interval) || interval < 250 || interval > 60000) throw new RangeError('Motion saved-file polling interval must be 250–60000 milliseconds.');
	let state: MotionSavedFileConnectionState = Object.freeze({ status: 'disconnected', name: null, receipt: null, error: null });
	let watch: MotionSavedFileWatch | null = null, abort: AbortController | null = null, generation = 0, disposed = false, blocked = false;
	let selecting: Promise<void> | null = null, flight: Promise<void> | null = null, stopping: Promise<void> | null = null, timer: ReturnType<typeof setTimeout> | null = null;
	let interruptionFailure: unknown = null;
	function update(status: MotionSavedFileConnectionState['status'], error: unknown = null, receipt = state.receipt): void {
		state = Object.freeze({ status, name: watch?.name ?? null, receipt, error }); options.onState?.(state);
	}
	function clearTimer(): void { if (timer !== null) clearTimeout(timer); timer = null; }
	function schedule(): void {
		clearTimer(); if (!watch || disposed || blocked || stopping || abort?.signal.aborted) return;
		timer = setTimeout(() => { timer = null; void refresh(); }, interval);
	}
	async function refresh(): Promise<void> {
		if (flight) return flight; if (!watch || !abort || abort.signal.aborted || disposed || blocked) return;
		clearTimer(); const selected = watch, signal = abort.signal;
		flight = (async () => {
			try {
				const discovery = normalizeMotionSavedFileDiscovery(await options.files.poll({ watchId: selected.watchId, afterGeneration: generation }));
				const next = discovery.state === 'snapshot' ? discovery.snapshot.generation : discovery.generation;
				if (next < generation) {
					const error = new Error('Motion saved-file discovery moved backwards.');
					if (discovery.state === 'snapshot') try { await options.files.release({ token: discovery.snapshot.token }); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Stale Motion discovery cleanup failed.', { cause: cleanup }); }
					throw error;
				}
				generation = next;
				if (discovery.state !== 'snapshot') { if (!signal.aborted && discovery.state === 'unavailable') update('unavailable'); return; }
				const receipt = await receiveMotionSavedFileSnapshot(options.files, discovery.snapshot, { compositionId: options.compositionId, receive: options.receive, signal });
				update(signal.aborted ? 'disconnecting' : 'connected', null, receipt); options.onReceived?.(receipt);
			} catch (error) {
				if (signal.aborted && error instanceof DOMException && error.name === 'AbortError') return;
				if (signal.aborted) interruptionFailure = error;
				if (error instanceof MotionSavedFilePostPublicationError) { blocked = true; update('error', error, error.receipt); options.onReceived?.(error.receipt); }
				else { if (error instanceof AggregateError) blocked = true; update('error', error); }
			}
		})();
		try { await flight; } finally { flight = null; schedule(); }
	}
	async function connect(): Promise<void> {
		if (disposed) throw new Error('Motion saved-file connection is disposed.');
		if (watch || selecting || stopping) throw new Error('Disconnect the current Motion saved file before selecting another.');
		abort = new AbortController(); generation = 0; blocked = false; interruptionFailure = null; update('connecting');
		selecting = (async () => {
			try {
				const selected = await options.files.select(); if (selected === null) { if (!stopping) update('disconnected'); return; }
				watch = normalizeMotionSavedFileWatch(selected); if (abort!.signal.aborted) return;
				update('connected'); await refresh();
			} catch (error) { update('error', error); throw error; }
		})();
		try { await selecting; } finally { selecting = null; schedule(); }
	}
	async function disconnect(): Promise<void> {
		if (stopping) return stopping; clearTimer(); abort?.abort(); update('disconnecting');
		stopping = (async () => {
			const failures: unknown[] = [];
			try { await selecting; } catch (error) { failures.push(error); }
			try { await flight; } catch (error) { failures.push(error); }
			if (interruptionFailure !== null) { failures.push(interruptionFailure); interruptionFailure = null; }
			if (watch) try { await options.files.cancel({ watchId: watch.watchId }); watch = null; } catch (error) { failures.push(error); }
			if (failures.length) { const error = failures.length === 1 ? failures[0] : new AggregateError(failures, 'Motion saved-file cancellation and cleanup failed.'); update('error', error); throw error; }
			abort = null; update('disconnected');
		})();
		try { await stopping; } finally { stopping = null; }
	}
	return Object.freeze({ connect, refresh, disconnect, state: () => state, async dispose() { disposed = true; await disconnect(); } });
}
export type MotionSavedFileConnection = ReturnType<typeof createMotionSavedFileConnection>;

/* SPDX-License-Identifier: AGPL-3.0-only */
import { pendingMotionDeliveryCleanup } from '../common/editor/motion-delivery-cleanup.ts';
import type { FramescaperSuccessorNativeReceipt } from './editor-successor-native-delivery-contract.ts';
export interface FramescaperNativeDeliveryState {
	readonly working: boolean; readonly cleanupRequired: boolean; readonly cancelled: boolean;
	readonly failure: unknown; readonly receipt: FramescaperSuccessorNativeReceipt | null;
}
/** A menu dialog owns the exact failed native capability until physical cleanup succeeds. */
export function createFramescaperNativeDeliverySession() {
	let state: FramescaperNativeDeliveryState = Object.freeze({ working: false, cleanupRequired: false, cancelled: false, failure: null, receipt: null });
	let pending: Promise<void> | null = null, abort: AbortController | null = null, primaryFailure: unknown = null, disposed = false, closing = false;
	const listeners = new Set<() => void>();
	const publish = (next: FramescaperNativeDeliveryState) => { state = Object.freeze(next); for (const listener of listeners) { try { listener(); } catch { /* Presentation cannot release native ownership. */ } } };
	const cancel = () => abort?.abort(new DOMException('Frame native delivery cancelled.', 'AbortError'));
	return {
		snapshot: () => state,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		canClose: () => pending === null && !state.cleanupRequired && !closing,
		cancel,
		async run(operation: (signal: AbortSignal) => Promise<FramescaperSuccessorNativeReceipt | null>): Promise<void> {
			if (disposed || closing) throw new Error('Frame native delivery session is closed.');
			if (pending || state.cleanupRequired) throw new Error('Complete the active Frame native output and its cleanup before starting another export.');
			const controller = new AbortController(); abort = controller; primaryFailure = null;
			publish({ working: true, cleanupRequired: false, cancelled: false, failure: null, receipt: null });
			pending = (async () => {
				await Promise.resolve();
				try {
					const receipt = await operation(controller.signal);
					// An authenticated successful commit owns publication even if cancellation arrived while awaiting its receipt.
					state = { ...state, receipt, cancelled: receipt === null };
				} catch (failure) {
					primaryFailure = failure;
					const cleanupRequired = pendingMotionDeliveryCleanup(failure).length > 0;
					const cancelled = !cleanupRequired && failure instanceof DOMException && failure.name === 'AbortError';
					state = { ...state, cleanupRequired, cancelled, failure: cancelled ? null : failure };
				} finally { pending = null; abort = null; publish({ ...state, working: false }); }
			})();
			await pending;
		},
		async retryCleanup(): Promise<void> {
			if (pending) { await pending; return; }
			const capabilities = pendingMotionDeliveryCleanup(primaryFailure);
			if (!capabilities.length) return;
			publish({ ...state, working: true });
			pending = (async () => {
				try {
					const results = await Promise.allSettled(capabilities.map(value => value.retryCleanup()));
					const failures = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected').map(value => value.reason as unknown);
					state = { ...state, cleanupRequired: pendingMotionDeliveryCleanup(primaryFailure).length > 0,
						failure: failures.length ? new AggregateError([primaryFailure, ...failures], 'Frame native output cleanup remains incomplete.') : primaryFailure };
				} finally { pending = null; publish({ ...state, working: false }); }
			})();
			await pending;
		},
		async dispose(): Promise<void> {
			closing = true;
			try {
				cancel(); await pending;
				if (state.cleanupRequired) throw new AggregateError([state.failure], 'Frame native output cleanup must succeed before closing its owner.');
				disposed = true;
			} finally { closing = false; }
		},
	};
}

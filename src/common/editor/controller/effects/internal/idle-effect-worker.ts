/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EffectWorkerLike } from './selection-effect-worker-service.ts';

/** At most one completed worker per effect family survives for thirty seconds. */
export function createIdleEffectWorkerSlot(enabled: boolean) {
	let retained: EffectWorkerLike | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	function clear(): void {
		clearTimeout(timer);
		timer = undefined;
		retained?.terminate();
		retained = null;
	}
	return Object.freeze({
		clear,
		acquire(factory: () => EffectWorkerLike): EffectWorkerLike {
			clearTimeout(timer);
			timer = undefined;
			const worker = retained ?? factory();
			retained = null;
			return worker;
		},
		release(worker: EffectWorkerLike, success: boolean): void {
			if (!enabled || !success) { worker.terminate(); return; }
			clear();
			retained = worker;
			// Any idle worker failure invalidates its cached module/FFT state.
			worker.onerror = clear;
			worker.onmessageerror = clear;
			timer = setTimeout(clear, 30_000);
			if (typeof timer === 'object' && 'unref' in timer) (timer as unknown as { unref(): void }).unref();
		},
	});
}

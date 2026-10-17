/* SPDX-License-Identifier: AGPL-3.0-only */
import { MotionDeliveryCleanupFailure } from '../common/editor/motion-delivery-cleanup.ts';
/** Closing the cancelled, memory-only ZIP can repeat the exact abort reason. Other failures remain intact. */
export function normalizeMotionscaperAeRenderFailure(error: unknown, signal: AbortSignal): unknown {
	const reason: unknown = signal.reason;
	if (!signal.aborted || !(reason instanceof DOMException) || reason.name !== 'AbortError') return error;
	const pending: unknown[] = [error], seen = new Set<unknown>(); let count = 0;
	while (pending.length) {
		const item = pending.pop(); if (++count > 64) return error;
		if (item === reason) continue;
		if (!(item instanceof AggregateError) || item instanceof MotionDeliveryCleanupFailure || seen.has(item)) return error;
		seen.add(item); const children: unknown = Object.getOwnPropertyDescriptor(item, 'errors')?.value;
		if (!Array.isArray(children) || !children.length || children.length > 64) return error;
		pending.push(...children as unknown[]);
	}
	return reason;
}

/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionNativeFrameWriter } from '../common/editor/motion-native-frame-carrier-v1.ts';
import type { MotionRenderPlan, MotionRenderSink } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { MOTION_DELIVERY_METHODS, type MotionDesktopDelivery, type MotionDesktopDeliveryReceipt } from './desktop-delivery-contract.ts';

export function motionscaperDesktopDelivery(value: unknown = globalThis): MotionDesktopDelivery | null {
	const global = value as { scapeDesktop?: { v1?: { motionDelivery?: unknown } } } | null;
	const delivery = global?.scapeDesktop?.v1?.motionDelivery;
	if (!delivery || typeof delivery !== 'object') return null;
	if (!MOTION_DELIVERY_METHODS.every(method => typeof (delivery as Record<string, unknown>)[method] === 'function')) throw new TypeError('Motionscaper desktop delivery bridge is incomplete.');
	return delivery as MotionDesktopDelivery;
}
/** Float frames cross only a bounded capability; publication happens after the native atomic replacement. */
export async function createMotionscaperDesktopProresSink(delivery: MotionDesktopDelivery, options: {
	readonly plan: MotionRenderPlan; readonly suggestedName: string; readonly signal?: AbortSignal;
}): Promise<MotionRenderSink<MotionDesktopDeliveryReceipt> | null> {
	options.signal?.throwIfAborted();
	const selected = await delivery.begin({ plan: options.plan, suggestedName: options.suggestedName });
	if (!selected) return null;
	let offset = 0; let terminal = false; let cancelling: Promise<void> | null = null;
	const cancel = async () => {
		if (terminal) return;
		cancelling ??= delivery.cancel({ token: selected.token }); await cancelling;
	};
	const onAbort = () => { void cancel().catch(() => undefined); };
	options.signal?.addEventListener('abort', onAbort, { once: true });
	const cleanup = () => { terminal = true; options.signal?.removeEventListener('abort', onAbort); };
	if (options.signal?.aborted) { try { await cancel(); } finally { cleanup(); } options.signal.throwIfAborted(); }
	const stream = new WritableStream<Uint8Array>({
		async write(bytes) {
			if (terminal) throw new Error('Motionscaper native export is closed.'); options.signal?.throwIfAborted();
			await delivery.write({ token: selected.token, offset, bytes }); offset += bytes.byteLength;
		}, abort: cancel,
	});
	try {
		const writer = await createMotionNativeFrameWriter(options.plan, stream, options.signal);
		return {
			async write(frame, signal) { signal?.throwIfAborted(); await writer.write(frame.index, frame.surface); },
			async finish(signal) {
				signal?.addEventListener('abort', onAbort, { once: true });
				try {
					signal?.throwIfAborted(); options.signal?.throwIfAborted();
					const receipt = await writer.finish(); signal?.throwIfAborted(); options.signal?.throwIfAborted();
					const output = await delivery.commit({ token: selected.token, byteLength: receipt.byteLength, sha256: receipt.sha256 });
					cleanup(); return output;
				} catch (error) { await cancel().catch(() => undefined); cleanup(); throw error; }
				finally { signal?.removeEventListener('abort', onAbort); }
			},
			async abort(reason) { try { await writer.abort(reason); await cancel(); } finally { cleanup(); } },
		};
	} catch (error) { try { await cancel(); } finally { cleanup(); } throw error; }
}

/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionDesktopDeliverySink } from '../common/editor/motion-desktop-delivery-sink.ts';
import type { MotionRenderSink } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { MOTION_DELIVERY_METHODS, type MotionDesktopDelivery, type MotionDesktopDeliveryReceipt } from './desktop-delivery-contract.ts';

export function motionscaperDesktopDelivery(value: unknown = globalThis): MotionDesktopDelivery | null {
	const global = value as { scapeDesktop?: { v1?: { motionDelivery?: unknown } } } | null;
	const delivery = global?.scapeDesktop?.v1?.motionDelivery;
	if (!delivery || typeof delivery !== 'object') return null;
	if (!MOTION_DELIVERY_METHODS.every(method => typeof (delivery as Record<string, unknown>)[method] === 'function')) throw new TypeError('Motionscaper desktop delivery bridge is incomplete.');
	return delivery as MotionDesktopDelivery;
}
/** The product pipeline supplies full evaluated frames; the shared carrier owns bounded native writes. */
export async function createMotionscaperDesktopProresSink(delivery: MotionDesktopDelivery, options: Parameters<typeof createMotionDesktopDeliverySink>[1]): Promise<MotionRenderSink<MotionDesktopDeliveryReceipt> | null> {
	const sink = await createMotionDesktopDeliverySink(delivery, options);
	return sink ? { ...sink, write: (frame, signal) => sink.write(frame.index, frame.surface, signal) } : null;
}

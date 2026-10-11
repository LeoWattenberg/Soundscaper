/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_DELIVERY_METHODS, type MotionDesktopDelivery } from '../common/editor/motion-desktop-delivery-contract.ts';
import { createMotionDesktopDeliverySink } from '../common/editor/motion-desktop-delivery-sink.ts';
import { motionSurfaceFromRgba8 } from '../common/editor/motion-surface.ts';
import { framescaperSuccessorNativeCarrierPlan, framescaperSuccessorNativePlan, type FramescaperSuccessorNativeDelivery, type FramescaperSuccessorNativePlan, type FramescaperSuccessorNativeReceipt } from './editor-successor-native-delivery-contract.ts';
export function framescaperSuccessorNativeDelivery(value: unknown = globalThis): FramescaperSuccessorNativeDelivery | null {
	const bridge = (value as { framescaperSuccessorDesktop?: { v1?: { delivery?: unknown } } } | null)?.framescaperSuccessorDesktop?.v1?.delivery;
	if (!bridge || typeof bridge !== 'object') return null;
	if (!MOTION_DELIVERY_METHODS.every(key => typeof Reflect.get(bridge, key) === 'function')) throw new TypeError('Framescaper successor native delivery capability is incomplete.');
	return bridge as FramescaperSuccessorNativeDelivery;
}
export async function createFramescaperSuccessorNativeSink(delivery: FramescaperSuccessorNativeDelivery, options: Omit<Parameters<typeof createMotionDesktopDeliverySink>[1], 'plan'> & { readonly plan: FramescaperSuccessorNativePlan; readonly inputEncoding: 'srgb' | 'rec709' }) {
	if (options.inputEncoding !== 'srgb' && options.inputEncoding !== 'rec709') throw new TypeError('Frame native delivery requires an explicit finishing transfer.');
	const plan = framescaperSuccessorNativePlan(options.plan); const carrier = framescaperSuccessorNativeCarrierPlan(plan);
	let published: FramescaperSuccessorNativeReceipt | null = null;
	const adapter: MotionDesktopDelivery = {
		getProfile: () => delivery.getProfile(), begin: request => delivery.begin({ ...request, plan }), write: request => delivery.write(request), cancel: request => delivery.cancel(request),
		async commit(request) {
			const receipt = await delivery.commit(request);
			if (receipt.identity.projectId !== plan.identity.projectId || receipt.identity.revisionDigest !== plan.identity.revisionDigest || receipt.identity.sequenceId !== plan.identity.sequenceId
				|| receipt.frameCount !== plan.frameCount) throw new Error('Native receipt differs from the pinned Frame sequence.');
			published = receipt; return { ...receipt, identity: carrier.identity };
		},
	};
	const sink = await createMotionDesktopDeliverySink(adapter, { ...options, plan: carrier }); if (!sink) return null;
	return { audio: sink.audio, abort: sink.abort,
		async writeRgba(index: number, rgba: Uint8Array, signal?: AbortSignal) {
			signal?.throwIfAborted(); const surface = motionSurfaceFromRgba8(plan.width, plan.height, rgba, options.inputEncoding);
			try { await sink.write(index, surface, signal); } finally { surface.pixels.fill(0); }
		},
		async finish(signal?: AbortSignal): Promise<FramescaperSuccessorNativeReceipt> {
			await sink.finish(signal); if (!published) throw new Error('Native Frame delivery returned no receipt.'); return published;
		},
	};
}

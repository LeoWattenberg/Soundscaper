/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionNativeFrameWriter } from '../common/editor/motion-native-frame-carrier-v1.ts';
import { createMotionNativePcmWriter, motionNativePcmPlan, type MotionNativePcmOptions } from '../common/editor/motion-native-pcm-carrier-v1.ts';
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
	readonly plan: MotionRenderPlan; readonly suggestedName: string; readonly signal?: AbortSignal; readonly audio?: MotionNativePcmOptions;
}): Promise<MotionRenderSink<MotionDesktopDeliveryReceipt> | null> {
	options.signal?.throwIfAborted();
	const pcmPlan = options.audio ? motionNativePcmPlan(options.plan, options.audio) : null;
	const selected = await delivery.begin({ plan: options.plan, suggestedName: options.suggestedName, ...(options.audio ? { audio: options.audio } : {}) });
	if (!selected) return null;
	let offset = 0; let terminal = false; let cancelling: Promise<void> | null = null;
	const cancel = async () => {
		if (terminal) return;
		cancelling ??= delivery.cancel({ token: selected.token });
		try { await cancelling; } catch (error) { cancelling = null; throw error; }
	};
	const onAbort = () => { void cancel().catch(() => undefined); };
	options.signal?.addEventListener('abort', onAbort, { once: true });
	const cleanup = () => { terminal = true; options.signal?.removeEventListener('abort', onAbort); };
	const fail = async (primary: unknown): Promise<never> => {
		try { await cancel(); } catch (failure) { throw new AggregateError([primary, failure], 'Motionscaper native delivery failed and cancellation failed.', { cause: failure }); }
		cleanup(); throw primary;
	};
	if (options.signal?.aborted) { try { await cancel(); } finally { cleanup(); } options.signal.throwIfAborted(); }
	const stream = new WritableStream<Uint8Array>({
		async write(bytes) {
			if (terminal) throw new Error('Motionscaper native export is closed.'); options.signal?.throwIfAborted();
			await delivery.write({ token: selected.token, offset, bytes }); offset += bytes.byteLength;
		}, abort: cancel,
	});
	try {
		// Shutter/lens intent is evaluated before delivery; the v1 wire only carries final float pictures.
		const { identity, width, height, frameRate, firstFrame, frameCount } = options.plan;
		const writer = await createMotionNativeFrameWriter({ identity, width, height, frameRate, firstFrame, frameCount }, stream, options.signal);
		let audioOffset = 0;
		const audio = pcmPlan ? await createMotionNativePcmWriter(pcmPlan, new WritableStream<Uint8Array>({
			async write(bytes) { if (terminal) throw new Error('Motionscaper native export is closed.'); options.signal?.throwIfAborted(); await delivery.write({ token: selected.token, offset: audioOffset, bytes, stream: 'audio' }); audioOffset += bytes.length; }, abort: cancel,
		}), options.signal) : null;
		return {
			...(audio && pcmPlan ? { audio: { sampleRate: pcmPlan.sampleRate, channels: pcmPlan.channels, async write(block, signal) { signal?.throwIfAborted(); await audio.write(block); } } } satisfies Pick<MotionRenderSink<unknown>, 'audio'> : {}),
			async write(frame, signal) { signal?.throwIfAborted(); await writer.write(frame.index, frame.surface); },
			async finish(signal) {
				signal?.addEventListener('abort', onAbort, { once: true });
				try {
					signal?.throwIfAborted(); options.signal?.throwIfAborted();
					const receipt = await writer.finish(); const audioReceipt = await audio?.finish(); signal?.throwIfAborted(); options.signal?.throwIfAborted();
					const output = await delivery.commit({ token: selected.token, byteLength: receipt.byteLength, sha256: receipt.sha256, ...(audioReceipt ? { audio: audioReceipt } : {}) });
					cleanup(); return output;
				} catch (error) { return fail(error); }
				finally { signal?.removeEventListener('abort', onAbort); }
			},
			async abort(reason) {
				const failures: unknown[] = [];
				for (const release of [() => writer.abort(reason), () => audio?.abort(reason), cancel]) { try { await release(); } catch (error) { failures.push(error); } }
				if (failures.length) throw new AggregateError(failures, 'Motionscaper native export cleanup failed.'); cleanup();
			},
		};
	} catch (error) { return fail(error); }
}

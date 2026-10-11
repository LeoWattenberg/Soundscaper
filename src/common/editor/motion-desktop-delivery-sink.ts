/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionNativeFrameWriter } from './motion-native-frame-carrier-v1.ts';
import { createMotionNativePcmWriter, motionNativePcmPlan, type MotionNativePcmOptions } from './motion-native-pcm-carrier-v1.ts';
import type { MotionAudioMixBlock } from './motion-audio-contract.ts';
/** The immutable digest identifies carrier samples; editor revision counters are not serialized. */
export type MotionNativePcmBlock = Omit<MotionAudioMixBlock, 'revision'>;
import type { MotionSurface } from './motion-surface.ts';
import type { MotionRenderPlan, MotionRenderSink } from './controller/export/motion-render-pipeline.ts';
import type { MotionDesktopDelivery, MotionDesktopDeliveryReceipt } from './motion-desktop-delivery-contract.ts';
import { MotionDeliveryCleanupFailure } from './motion-delivery-cleanup.ts';
export interface MotionDesktopDeliverySink extends Omit<MotionRenderSink<MotionDesktopDeliveryReceipt>, 'write' | 'audio'> {
	readonly audio?: Readonly<{ sampleRate: number; channels: 1 | 2; write(block: MotionNativePcmBlock, signal?: AbortSignal): Promise<void> }>;
	write(index: number, surface: MotionSurface, signal?: AbortSignal): Promise<void>;
}
/** Float frames cross only a bounded capability; publication happens after the native atomic replacement. */
export async function createMotionDesktopDeliverySink(delivery: MotionDesktopDelivery, options: {
	readonly plan: MotionRenderPlan; readonly suggestedName: string; readonly signal?: AbortSignal; readonly audio?: MotionNativePcmOptions;
}): Promise<MotionDesktopDeliverySink | null> {
	options.signal?.throwIfAborted();
	const pcmPlan = options.audio ? motionNativePcmPlan(options.plan, options.audio) : null;
	const selected = await delivery.begin({ plan: options.plan, suggestedName: options.suggestedName, ...(options.audio ? { audio: options.audio } : {}) });
	if (!selected) return null;
	let offset = 0; let terminal = false; let cancelling: Promise<void> | null = null; let cleanupFailure: MotionDeliveryCleanupFailure | null = null;
	const cancel = async () => {
		if (terminal) return;
		cancelling ??= delivery.cancel({ token: selected.token });
		try { await cancelling; } catch (error) { cancelling = null; throw error; }
	};
	const onAbort = () => { void cancel().catch(() => undefined); };
	options.signal?.addEventListener('abort', onAbort, { once: true });
	const cleanup = () => { terminal = true; cleanupFailure?.completeCleanup(); options.signal?.removeEventListener('abort', onAbort); };
	const retainCleanup = (errors: readonly unknown[], message: string) => {
		cleanupFailure ??= new MotionDeliveryCleanupFailure(errors, message, async () => { await cancel(); cleanup(); });
		return cleanupFailure;
	};
	const fail = async (primary: unknown): Promise<never> => {
		try { await cancel(); } catch (failure) { throw retainCleanup([primary, failure], 'Motionscaper native delivery failed and cancellation failed.'); }
		cleanup(); throw primary;
	};
	if (options.signal?.aborted) return fail(options.signal.reason);
	const stream = new WritableStream<Uint8Array>({
		async write(bytes) {
			if (terminal) throw new Error('Motionscaper native export is closed.'); options.signal?.throwIfAborted();
			await delivery.write({ token: selected.token, offset, bytes }); offset += bytes.byteLength;
		}, abort: cancel,
	});
	try {
		const { identity, width, height, frameRate, firstFrame, frameCount } = options.plan;
		const writer = await createMotionNativeFrameWriter({ identity, width, height, frameRate, firstFrame, frameCount }, stream, options.signal);
		let audioOffset = 0;
		const audio = pcmPlan ? await createMotionNativePcmWriter(pcmPlan, new WritableStream<Uint8Array>({
			async write(bytes) { if (terminal) throw new Error('Motionscaper native export is closed.'); options.signal?.throwIfAborted(); await delivery.write({ token: selected.token, offset: audioOffset, bytes, stream: 'audio' }); audioOffset += bytes.length; }, abort: cancel,
		}), options.signal) : null;
		return {
			...(audio && pcmPlan ? { audio: { sampleRate: pcmPlan.sampleRate, channels: pcmPlan.channels, async write(block, signal) { signal?.throwIfAborted(); // The pinned carrier writer authenticates digest, sequence, geometry and samples; it never reads the editor-only revision counter.
				await audio.write(block as MotionAudioMixBlock); } } } satisfies Pick<MotionDesktopDeliverySink, 'audio'> : {}),
			async write(index, surface, signal) { signal?.throwIfAborted(); await writer.write(index, surface); },
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
				for (const release of [() => writer.abort(reason), () => audio?.abort(reason)]) { try { await release(); } catch (error) { failures.push(error); } }
				try { await cancel(); } catch (error) { failures.push(error); throw retainCleanup(failures, 'Motionscaper native export cleanup failed.'); }
				cleanup(); if (failures.length) throw new AggregateError(failures, 'Motionscaper native export cleanup failed.');
			},
		};
	} catch (error) { return fail(error); }
}

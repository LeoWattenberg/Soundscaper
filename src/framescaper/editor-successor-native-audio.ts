/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionNativePcmPlan } from '../common/editor/motion-native-pcm-carrier-v1.ts';
import { applyMediaChannelMapping } from '../common/editor/media-export.js';
import type { ProductNativeRenderInputOperation } from '../common/editor/controller/composition/product-native-render-input-authority.ts';
import type { MotionDesktopDeliverySink } from '../common/editor/motion-desktop-delivery-sink.ts';
import { framescaperSuccessorNativeCarrierPlan, type FramescaperSuccessorNativePlan } from './editor-successor-native-delivery-contract.ts';
/** Use the committed Frame mix, with bounded stereo blocks and silence in the enclosing final frame's tail. */
export async function streamFramescaperSuccessorNativeAudio(options: {
	readonly operation: ProductNativeRenderInputOperation; readonly project: Readonly<Record<string, unknown>>;
	readonly plan: FramescaperSuccessorNativePlan; readonly audio: NonNullable<MotionDesktopDeliverySink['audio']>;
	readonly signal: AbortSignal; readonly assertCurrent: () => void;
}): Promise<void> {
	const { operation, audio, signal, assertCurrent } = options;
	if (!operation.renderAudioToSink) throw new Error('This controller cannot stream its exact Frame audio mix.');
	const pcm = motionNativePcmPlan(framescaperSuccessorNativeCarrierPlan(options.plan), { sampleRate: audio.sampleRate, channels: audio.channels });
	if (pcm.channels !== 2 || pcm.firstFrame !== 0) throw new Error('Successor native delivery currently requires the full sequence with stereo audio.');
	let written = 0;
	const result = await operation.renderAudioToSink(options.project, { startFrame: 0, endFrame: pcm.sampleCount, includeTail: false,
		outputFrames: pcm.sampleCount, preRollFrames: 0, sampleRate: pcm.sampleRate, chunkFrames: 4096 }, async (channels, metadata) => {
		assertCurrent(); signal.throwIfAborted();
		const frames = channels[0]?.length ?? 0;
		if (frames < 1 || frames > 4096 || channels.some(channel => channel.length !== frames) || metadata.sampleRate !== pcm.sampleRate
			|| metadata.frameOffset !== written || metadata.frames !== undefined && metadata.frames !== frames || written + frames > pcm.sampleCount) throw new Error('Frame PCM geometry differs from its bounded native plan.');
		const stereo = applyMediaChannelMapping([...channels], 'stereo'); const interleaved = new Float32Array(frames * 2);
		try {
			for (let frame = 0; frame < frames; frame++) { interleaved[frame * 2] = stereo[0]![frame]!; interleaved[frame * 2 + 1] = stereo[1]![frame]!; }
			await audio.write({ ...pcm.identity, startSample: { num: written, den: 1 }, sampleRate: pcm.sampleRate, channels: 2, sampleCount: frames, interleaved }, signal);
			written += frames; assertCurrent(); signal.throwIfAborted();
		} finally { interleaved.fill(0); }
	});
	assertCurrent(); signal.throwIfAborted();
	if (written !== pcm.sampleCount || result.sampleRate !== pcm.sampleRate || result.frameCount !== pcm.sampleCount) throw new Error('Frame native PCM render did not complete its exact sample range.');
}

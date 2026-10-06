/* SPDX-License-Identifier: AGPL-3.0-only */
import { isDesktopMainAudioCodecRuntime } from '../../../../desktop-main-audio-codec-runtime-marker.ts';
import type { DesktopAudioCodecRuntime } from '../../../../desktop-audio-codec-runtime.ts';
import type { DesktopPcmStreamProducer } from '../../../../desktop-audio-pcm-stream.ts';
import { createRealtimeExportPcmTransform, type RealtimeExportPcmTransform } from '../realtime-export-pcm-transform.ts';
import { directPcmRenderQueueOptions } from '../direct/direct-pcm-export.ts';
import { encodeDirectCompressedPcmStream, type DirectCompressedDestination } from '../direct/direct-compressed-export.ts';
import { setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
import type { ExportRenderSources } from './audio-export-render-orchestration.ts';
import type { AudioEncodingProgressRange } from './audio-export-progress.ts';
import type { RealtimeEncodedExportRuntime } from './audio-realtime-encoded-export.ts';

type RuntimeValue = RealtimeEncodedExportRuntime[string];

/** Share the established mix, mapping and resampling authority without a WAV carrier. */
export async function tryRenderRealtimeDesktopPcmExport(runtime: RealtimeEncodedExportRuntime,
	snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: AbortSignal,
	renderSources: ExportRenderSources, renderTarget: RuntimeValue,
	destination: DirectCompressedDestination | null, assertCurrent: () => void,
	encodingProgressRange: AudioEncodingProgressRange,
) {
	if (!isDesktopMainAudioCodecRuntime(runtime.ffmpeg) || plan.format === 'flac') return null;
	const ffmpeg = runtime.ffmpeg as Partial<DesktopAudioCodecRuntime>;
	if (typeof ffmpeg.preparePcmStream !== 'function') return null;
	const fence = { current: assertCurrent };
	const assertReady = () => { runtime.throwIfAborted(signal); fence.current(); };
	const prepared = await ffmpeg.preparePcmStream({ frameCount: plan.outputFrames,
		channelCount: plan.channelCount, sampleRate: plan.sampleRate }, plan.format, {
		...plan.encoding, inputChannelCount: plan.channelCount, channelCount: plan.channelCount,
		channelMapping: 'preserve', sampleRate: plan.sampleRate,
		bitDepth: plan.encoding.bitDepth || (plan.format === 'wavpack' ? settings.bitDepth : 24),
		applyDither: plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none',
		signal, assertCurrent: assertReady, confirmFileSizeWarning: runtime.options?.confirmFileSizeWarning,
		onProgress: (value: number) => { runtime.taskProgress?.updateActive?.(value); },
	});
	assertReady();
	if (!prepared) return null;
	const producePcm: DesktopPcmStreamProducer = async (write) => {
		assertReady();
		const renderSampleRate = runtime.normalizeProjectSampleRate(snapshot.sampleRate) as number;
		let renderedSampleRate = renderSampleRate;
		let outputTransform: RealtimeExportPcmTransform | null = null;
		let renderEngine: RuntimeValue = null;
		const failures: unknown[] = [];
		try {
			renderEngine = runtime.createCacheAwareRenderEngine();
			if (renderSources.chunkSources === null) renderEngine.loadProject(snapshot, renderSources.sourceMap);
			else renderEngine.loadProject(snapshot, renderSources.sourceMap, { chunkSources: renderSources.chunkSources });
			await renderEngine.renderMixRealtime({
				preferBoundedOffline: true, ...renderTarget,
				startFrame: plan.range.startFrame, endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
				sampleRate: renderSampleRate, preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
				...directPcmRenderQueueOptions(Number(snapshot.masterChannels || 2), 'WAV'),
				suspendForBackpressure: false, ...runtime.withRenderProgress({}), signal,
				async onChunk(channels: readonly Float32Array[], metadata: Readonly<{ sampleRate?: number }> = {}) {
					assertReady(); renderedSampleRate = metadata.sampleRate || renderedSampleRate;
					outputTransform ||= createRealtimeExportPcmTransform({
						inputChannelCount: channels.length, inputSampleRate: renderedSampleRate,
						outputChannelCount: plan.channelCount, outputSampleRate: plan.sampleRate,
						channelMapping: plan.channelMapping, applyChannelMapping: runtime.applyMediaChannelMapping,
						createResampler: runtime.createStreamingWindowedSincResampler,
					});
					const converted = outputTransform.push(channels);
					if (converted[0]?.length) await write(converted);
					assertReady();
				},
			});
			if (!outputTransform) throw new Error('Realtime export produced no PCM chunks.');
			const final = (outputTransform as RealtimeExportPcmTransform).finish(plan.outputFrames);
			if (final[0]?.length) await write(final);
			assertReady();
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'encoding');
			runtime.taskProgress?.setActivePhase?.(runtime.copy.encoding, { ...encodingProgressRange, value: 0 }, { key: 'encoding' });
		} catch (error) { failures.push(error); }
		finally { if (renderEngine) { try { await renderEngine.dispose(); } catch (error) { failures.push(error); } } }
		if (failures.length > 1) throw new AggregateError(failures, 'Realtime native PCM rendering and cleanup failed.', { cause: failures[0] });
		if (failures.length) throw failures[0];
	};
	if (destination) return await encodeDirectCompressedPcmStream({ destination, plan, signal, assertCurrent,
		async encodeToSink(sink, assertActive) {
			fence.current = assertActive;
			return await prepared.encodeToSink(producePcm, sink);
		},
	});
	return await prepared.encode(producePcm);
}

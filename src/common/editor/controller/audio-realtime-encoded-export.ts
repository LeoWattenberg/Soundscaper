/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The realtime-engine half of audio export: render the mix as it plays, and
 * encode what comes out of it.
 *
 * This is the path taken when an export cannot be rendered faster than realtime
 * — a project reaching live inputs or native plug-ins — so it streams into a
 * staged file and hands that to the direct destination or the encoder. It reads
 * as one long procedure because it is one: a single pass whose cleanup has to
 * account for a sink, a render engine, and an owned output that may each exist
 * or not when it fails.
 */

import {
	createRealtimeExportPcmTransform, type RealtimeExportPcmTransform,
} from './realtime-export-pcm-transform.ts';
import { directPcmContainerLabel } from './direct-export-dispatch.ts';
import {
	createDirectPcmEncoder, directPcmRenderQueueOptions, type DirectPcmDestination,
} from './direct-pcm-export.ts';
import {
	encodeDirectCompressedStagedFile, type DirectCompressedDestination,
} from './direct-compressed-export.ts';
import type { ExportRenderSources } from './audio-export-render-orchestration.ts';

export interface RealtimeEncodedExportRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}
type RuntimeValue = RealtimeEncodedExportRuntime[string];

/** Bind the realtime encoded render to one export service's runtime. */
export function createRealtimeEncodedAudioExport(runtime: RealtimeEncodedExportRuntime) {
	const {
		applyMediaChannelMapping, copy, createAiffStreamEncoder, createCacheAwareRenderEngine,
		createStableId, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createWavStreamEncoder, ffmpeg, normalizeProjectSampleRate,
		prepareCommittedTimePitchCaches, setStatus, throwIfAborted, withRenderProgress,
	} = runtime;
	return async function renderRealtimeEncoded(
	snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue,
	renderSources: ExportRenderSources,
	renderTarget: RuntimeValue,
	directDestination: DirectPcmDestination | null = null,
	directCompressedDestination: DirectCompressedDestination | null = null,
	assertDirectCurrent: () => void = () => undefined,
) {
	throwIfAborted(signal);
	assertDirectCurrent();
	if (renderSources.prepareTimePitchCaches) await prepareCommittedTimePitchCaches(snapshot, signal);
	throwIfAborted(signal);
	assertDirectCurrent();
	const renderSampleRate = normalizeProjectSampleRate(snapshot.sampleRate);
	const nativeAiff = plan.format === 'aiff';
	const nativeWav = plan.format === 'wav' || plan.format === 'bwf' || plan.format === 'bw64';
	const nativePcm = nativeWav || nativeAiff;
	const containerLabel = directPcmContainerLabel(plan.format);
	const broadcast = plan.format === 'bwf' || plan.format === 'bw64';
	const sink = directDestination
		? null
		: await createTemporaryFileSink(`audio-editor-${createStableId('render')}.${nativeAiff ? 'aiff' : 'wav'}`, copy);
	const outputTransform: { current: RealtimeExportPcmTransform | null } = { current: null };
	let stagedWrite = Promise.resolve();
	let renderedSampleRate = renderSampleRate;
	let directCompressedHandoff = false;
	let renderEngine: RuntimeValue = null;
	let ownedOutput: RuntimeValue = null;
	const failures: unknown[] = [];
	try {
		if (sink && !sink.persistent
			&& (plan.outputFileBytesPerRender ?? plan.outputBytesPerRender) > 96 * 1024 ** 2) {
			throw new Error(copy.realtimeStorageRequired);
		}
		const bitDepth = plan.encoding.bitDepth || (plan.format === 'flac' || plan.format === 'wavpack' ? settings.bitDepth : 24);
		const stagingFloat = !nativePcm && plan.format !== 'flac';
		const encoderOptions = {
			container: nativeWav ? plan.container : undefined,
			sampleRate: plan.sampleRate,
			channelCount: plan.channelCount,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: nativePcm ? plan.encoding.floatingPoint : stagingFloat,
			sampleFormat: nativePcm ? plan.encoding.sampleFormat : undefined,
			dither: stagingFloat ? 'none' : plan.ditherMode,
			metadata: nativePcm ? plan.metadata : undefined,
			markers: nativePcm ? plan.markers : undefined,
			ixml: nativePcm ? plan.ixml : undefined,
			cart: broadcast ? plan.cart : undefined,
			bext: broadcast ? plan.bext : undefined,
			preDataChunks: nativeWav ? plan.preDataChunks : undefined,
			trailingChunks: nativeWav ? plan.trailingChunks : undefined,
		};
		const directEncoder = directDestination
			? await createDirectPcmEncoder(directDestination, nativeAiff ? createAiffStreamEncoder : createWavStreamEncoder, encoderOptions, containerLabel)
			: null;
		throwIfAborted(signal);
		assertDirectCurrent();
		const encoder = directEncoder ? null : (nativeAiff
			? createAiffStreamEncoder({
				...encoderOptions,
				collect: false,
				onChunk: (chunk: RuntimeValue) => { stagedWrite = Promise.resolve(sink.write(chunk)); },
			})
			: createWavStreamEncoder({
				...encoderOptions,
				collect: false,
				onChunk: (chunk: RuntimeValue) => { stagedWrite = Promise.resolve(sink.write(chunk)); },
			}));
		if (encoder) await stagedWrite;
		renderEngine = createCacheAwareRenderEngine();
		if (renderSources.chunkSources === null) renderEngine.loadProject(snapshot, renderSources.sourceMap);
		else renderEngine.loadProject(snapshot, renderSources.sourceMap, {
			chunkSources: renderSources.chunkSources,
		});
		await renderEngine.renderMixRealtime({
			...renderTarget,
			startFrame: plan.range.startFrame,
			endFrame: plan.range.endFrame,
			includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
			sampleRate: renderSampleRate,
			preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
			...(directDestination ? directPcmRenderQueueOptions(Number(snapshot.masterChannels || 2), containerLabel) : {}),
			...withRenderProgress({}),
			signal,
			onChunk: (channels: RuntimeValue, metadata: RuntimeValue = {}) => {
				renderedSampleRate = metadata.sampleRate || renderedSampleRate;
				outputTransform.current ||= createRealtimeExportPcmTransform({
					inputChannelCount: channels.length, inputSampleRate: renderedSampleRate,
					outputChannelCount: plan.channelCount, outputSampleRate: plan.sampleRate,
					channelMapping: plan.channelMapping, applyChannelMapping: applyMediaChannelMapping,
					createResampler: createStreamingWindowedSincResampler, optimizeSelectionUpmix: Boolean(directEncoder),
				});
				const outputChannels = outputTransform.current.push(channels);
				if (!outputChannels[0]?.length) return undefined;
				if (directEncoder) return directEncoder.write(outputChannels);
				encoder.write(outputChannels);
				return stagedWrite;
			},
		});
		if (!outputTransform.current) throw new Error('Realtime export produced no PCM chunks.');
		const finalChannels = outputTransform.current.finish(plan.outputFrames);
		if (finalChannels[0]?.length && directEncoder) await directEncoder.write(finalChannels);
		else if (finalChannels[0]?.length) encoder.write(finalChannels);
		if (directEncoder) {
			const byteLength = await directEncoder.finalize();
			ownedOutput = { blob: null, bytes: null, byteLength, mimeType: plan.mimeType, directDestination };
		} else {
			encoder.finalize();
			await stagedWrite;
			const stagingFile = await sink.close(nativeAiff ? 'audio/aiff' : 'audio/wav');
			if (nativePcm) {
				ownedOutput = { blob: stagingFile, bytes: null, mimeType: plan.mimeType, cleanup: () => sink.remove() };
			} else {
				setStatus(copy.encoding);
				const transcodeSettings = {
					...plan.encoding,
					// The realtime PCM transform has already mapped into final staging geometry.
					inputChannelCount: plan.channelCount,
					channelCount: plan.channelCount,
					channelMapping: 'preserve',
					bitDepth,
					sampleRate: plan.sampleRate,
					applyDither: plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none' && plan.format !== 'flac',
					signal,
				};
				if (directCompressedDestination) {
					directCompressedHandoff = true;
					ownedOutput = await encodeDirectCompressedStagedFile({
						destination: directCompressedDestination, plan, stagedFile: stagingFile, ffmpeg, signal,
						encodingSettings: transcodeSettings, assertCurrent: assertDirectCurrent,
						cleanupStagedFile: () => sink.remove(), abortStagedFile: () => sink.abort(),
					});
				} else {
					ownedOutput = await ffmpeg.encodeFile(stagingFile, plan.format, transcodeSettings);
					await sink.remove();
				}
			}
		}
	} catch (error) {
		failures.push(error);
		if (sink && !directCompressedHandoff) {
			try { await sink.abort(); } catch (cleanupError) { failures.push(cleanupError); }
		}
	} finally {
		if (renderEngine) {
			try { await renderEngine.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		}
	}
	if (failures.length) {
		if (typeof ownedOutput?.cleanup === 'function') {
			try { await ownedOutput.cleanup(); } catch (cleanupError) { failures.push(cleanupError); }
		}
		if (failures.length === 1) throw failures[0];
		throw new AggregateError(failures, 'Realtime audio export and resource cleanup failed.');
	}
	if (!ownedOutput || typeof ownedOutput !== 'object') {
		throw new Error('Realtime audio export produced no encoded output.');
	}
	return ownedOutput;
}
}

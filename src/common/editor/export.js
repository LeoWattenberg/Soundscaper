import { projectEffectTailFrames } from './effects.js';
import { createBwfExportMetadata, projectBextMetadata } from './broadcast-wave-project.ts';
import { cartForDeliveryRange } from './cart-delivery-range.ts';
import { inspectPreservedAdmRiffChunks, sameBextMetadata } from './adm-riff-passthrough.ts';
import { createBw64AdmExport, resolveBw64Adm } from './export-bw64-adm.js';
import {
	AUDIO_EDITOR_MASTER_CHANNELS,
	AUDIO_EDITOR_SAMPLE_RATE,
	aggregateStereoMinutes,
	projectDurationFrames,
	normalizeFrameRange,
} from './project.js';
import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import {
	canonicalMediaExportFormat,
	getMediaExportFormat,
	normalizeMediaExportSettings,
} from './media-export.js';
import { inspectAiffLayout } from './aiff.js';
import { inspectWavLayout } from './wav.js';
import { createStemArchivePlan } from './controller/export/stem-archive.ts';
import { EBU_R128_MAXIMUM_CHANNELS } from './ebu-r128.js';
import { resolveAdmEbuChannelWeights } from './loudness-channel-layout.ts';
import { createRiffAnnotationExport } from './timeline-annotation-riff-interchange.ts';
import { resolveBinauralDelivery } from './binaural-delivery.ts';
import { resolveExportChapters } from './export-chapters.ts';
import { assertEmbeddedChapterRequest, createEmbeddedChapterEncoding } from './export-embedded-chapter-encoding.ts';
import { resolveExportClips } from './export-clip-boundaries.ts';
import { resolveMasteringSequenceExport } from './mastering-sequence-export.ts';
import { cartForMasteringSequence } from './mastering-sequence-cart.ts';
import {
	assertSoundscaperEffectChannelSafety,
	deliversMasterMix,
	resolveExportLoudnessNormalization,
	selectExportOfflineRenderAdmission,
	estimateExportPlanSourceWorkingSetBytes,
} from './export-plan-admission.js';
import { inheritTrackFolderMediaStateProjectionV12 } from './track-folder-media-runtime.ts';
import { scaleSampleFrame } from './timeline-time.ts';

export const FAST_RENDER_THRESHOLDS = Object.freeze({
	mobile: { outputBytes: 96 * 1024 ** 2, totalBytes: 320 * 1024 ** 2 },
	desktop: { outputBytes: 384 * 1024 ** 2, totalBytes: 1024 * 1024 ** 2 },
});

/**
 * One delivered file. Chapters and clips state their own render span and size.
 *
 * @typedef {Object} AudioExportPlanOutput
 * @property {string} kind
 * @property {string} fileName
 * @property {string | null} trackId
 * @property {string} [clipId]
 * @property {boolean} [includeMaster]
 * @property {boolean} [respectMuteSolo]
 * @property {{startFrame: number, endFrame: number, durationFrames: number}} [range]
 * @property {number} [outputFrames]
 * @property {number | null} [outputFileBytes]
 * @property {import('./broadcast-wave.ts').BextMetadata} [bext]
 * @property {import('./cart-metadata.ts').CartMetadata | null} [cart]
 */

/**
 * @typedef {Object} AudioExportPlan
 * @property {import('./cart-metadata.ts').CartMetadata | null} cart
 * @property {'mix' | 'stems' | 'chapters' | 'clips'} mode
 * @property {import('./media-export.js').MediaExportFormatId} format
 * @property {number} sampleRate
 * @property {number} channelCount
 * @property {number} outputFrames
 * @property {number} outputBytesPerRender
 * @property {number|null} outputFileBytesPerRender
 * @property {number} requiredTemporaryBytes
 * @property {ReturnType<typeof normalizeMediaExportSettings>} encoding
 * @property {Readonly<Record<string, string>>} metadata
 * @property {{ strategy: 'offline' | 'realtime-stream', fast: boolean, reason: 'output-memory'|'total-memory'|'offline-render-output-memory'|null, offlineRenderAdmission?: import('./export-render-admission.ts').ExportOfflineRenderStrategyAdmission }} render
 * @property {AudioExportPlanOutput[]} outputs
 * @property {import('./controller/export/stem-archive.ts').StemArchivePlan|null} archive
 * @property {import('./broadcast-wave.ts').BextMetadata} [bext]
 * @property {'bw64'} [container]
 * @property {{ mode: 'authored'|'passthrough', metadata: import('./adm-project-metadata.ts').AdmProjectMetadata, channelCount: number, channelOrder: readonly string[], preDataChunks: Uint8Array|readonly Uint8Array[]|undefined, trailingChunks: Uint8Array|readonly Uint8Array[]|undefined }} [adm]
 * @property {Uint8Array|readonly Uint8Array[]} [preDataChunks]
 * @property {Uint8Array|readonly Uint8Array[]} [trailingChunks]
 * @property {readonly import('./riff-markers.ts').RiffMarker[]} markers
 * @property {import('./timeline-annotation-interchange-report.ts').TimelineAnnotationInterchangeReport} markerInterchangeReport
 * @property {import('./loudness-normalization.ts').LoudnessNormalizationTarget|null} loudnessNormalization
 * @property {readonly number[]} [loudnessChannelWeights]
 * @property {import('./binaural-delivery.ts').BinauralDeliveryPlan} [binaural]
 * @property {import('./mastering-sequence-delivery.ts').MasteringSequenceDeliveryPlan} [masteringSequence]
 * @property {{startFrame: number, endFrame: number, durationFrames: number}} range
 * @property {number} tailFrames
 */

export function estimatePcmBytes(frameCount, channelCount = AUDIO_EDITOR_MASTER_CHANNELS, bytesPerSample = 4) {
	if (!Number.isSafeInteger(frameCount) || frameCount < 0) throw new RangeError('PCM frame count must be a non-negative integer.');
	if (!Number.isSafeInteger(channelCount) || channelCount <= 0) throw new RangeError('PCM channel count must be positive.');
	if (!Number.isSafeInteger(bytesPerSample) || bytesPerSample <= 0) throw new RangeError('PCM bytes per sample must be positive.');
	const bytesPerFrame = multiplySafeIntegers(channelCount, bytesPerSample, 'PCM byte size');
	return multiplySafeIntegers(frameCount, bytesPerFrame, 'PCM byte size');
}

export function estimateProjectPcmBytes(project) {
	return project.sources
		.filter((source) => source.kind !== 'video')
		.reduce((bytes, source) => bytes + estimatePcmBytes(source.frameCount, source.channelCount), 0);
}

export function chooseRenderStrategy(options = {}) {
	const thresholds = options.mobile ? FAST_RENDER_THRESHOLDS.mobile : FAST_RENDER_THRESHOLDS.desktop;
	const outputBytes = Number(options.outputBytes) || 0;
	const livePcmBytes = Number(options.livePcmBytes) || 0;
	const totalBytes = outputBytes + livePcmBytes;
	const hasOfflineRenderAdmission = options.offlineRenderAdmission !== undefined;
	const offlineRenderAdmission = hasOfflineRenderAdmission ? options.offlineRenderAdmission : null;
	// Context output and cropped PCM can coexist with all scheduled sources.
	const renderOutputBytes = Math.max(outputBytes, Number(offlineRenderAdmission?.peakUsefulBinaryBytes) || 0);
	const withinLegacyThresholds = outputBytes <= thresholds.outputBytes
		&& livePcmBytes + renderOutputBytes <= thresholds.totalBytes;
	const fast = withinLegacyThresholds && offlineRenderAdmission?.admitted !== false;
	return {
		strategy: fast ? 'offline' : 'realtime-stream',
		fast,
		outputBytes,
		livePcmBytes,
		totalBytes,
		thresholds,
		reason: fast
			? null
			: !withinLegacyThresholds
				? outputBytes > thresholds.outputBytes ? 'output-memory' : 'total-memory'
				: 'offline-render-output-memory',
		...(hasOfflineRenderAdmission ? { offlineRenderAdmission } : {}),
	};
}

/**
 * The binaural delivery this plan carries, or none.
 *
 * The refusals are stated as refusals rather than quietly downgraded: a request
 * this cannot honour is an error at plan time, where the operator can still
 * change it, and never a delivery that silently came out as something else.
 */
function resolveBinauralBw64Delivery(project, options, format, mode) {
	const { plan, refusal } = resolveBinauralDelivery(
		options.adm !== undefined ? options.adm : project.metadata?.adm,
		{ binaural: options.binaural, mode, format },
	);
	if (plan) return plan;
	if (refusal === null || refusal === 'not-requested') return null;
	throw new Error(`A binaural delivery is not available: ${refusal}.`);
}

export function sanitizeExportName(value, fallback = 'audio-project') {
	const normalized = String(value || '')
		.normalize('NFKD')
		.replace(/[aouAOU]\u0308/g, (letter) => letter.normalize('NFC'))
		.replace(/([a-zA-Z])[\u0300-\u036f]+/g, '$1')
		.normalize('NFC')
		.replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-_.]+|[-_.]+$/g, '')
		.slice(0, 96);
	return normalized || fallback;
}

export function createExportFileName(project, options = {}) {
	const extension = options.extension || exportExtension(options.format || 'wav');
	if (options.mode === 'stem' || options.mode === 'chapter' || options.mode === 'clip') {
		const index = Number(options.trackIndex ?? 0) + 1;
		const fallback = options.mode === 'stem' ? 'track' : options.mode;
		return `${String(index).padStart(2, '0')}-${sanitizeExportName(options.trackName, fallback)}.${extension}`;
	}
	const date = isoDate(options.date);
	return `${sanitizeExportName(project.title)}-mix-${date}.${extension}`;
}

/** @returns {AudioExportPlan} */
export function createExportPlan(project, options = {}) {
	const runtimeProject = inheritTrackFolderMediaStateProjectionV12(project, projectForRuntimeConsumers(project));
	const mode = options.mode || 'mix';
	if (mode !== 'mix' && mode !== 'stems' && mode !== 'chapters' && mode !== 'clips') {
		throw new RangeError('Export mode must be mix, stems, chapters, or clips.');
	}
	const format = canonicalMediaExportFormat(options.format || 'wav');
	assertEmbeddedChapterRequest(format, options);
	if (format === 'bw64' && mode !== 'mix') throw new RangeError('BW64 / ADM export is mix-only.');
	const bw64Adm = format === 'bw64' ? resolveBw64Adm(runtimeProject, options) : null;
	const binaural = resolveBinauralBw64Delivery(runtimeProject, options, format, mode);
	let encoding = normalizeMediaExportSettings(format, {
		...options,
		sampleRate: options.sampleRate ?? runtimeProject.sampleRate ?? AUDIO_EDITOR_SAMPLE_RATE,
		inputChannelCount: bw64Adm?.channelCount
			?? options.inputChannelCount ?? runtimeProject.masterChannels ?? AUDIO_EDITOR_MASTER_CHANNELS,
		...(bw64Adm ? { channelMapping: 'preserve' } : {}),
		// A binaural delivery is two channels whatever the programme was, and the
		// renderer places the sources itself, so no mapping precedes it.
		...(binaural ? { channelCount: 2, channelMapping: 'preserve', inputChannelCount: 2 } : {}),
	});
	const preservedRiffChunks = bw64Adm?.metadata.mode === 'passthrough'
		? inspectPreservedAdmRiffChunks(bw64Adm.metadata)
		: null;
	if (preservedRiffChunks?.id3 && Object.keys(encoding.metadata).length > 0) {
		throw new Error('ADM passthrough with a preserved RIFF ID3 chunk cannot add replacement ID3 metadata.');
	}
	if (preservedRiffChunks?.info && Object.keys(encoding.metadata).length > 0) {
		throw new Error('ADM passthrough with preserved RIFF INFO cannot add replacement INFO metadata.');
	}
	const sampleRate = encoding.sampleRate;
	const requestedRange = resolveExportRange(runtimeProject, options.range || 'project');
	const spans = mode === 'chapters'
		? resolveExportChapters(runtimeProject, requestedRange, options.chapterSource ?? 'labels')
		: mode === 'clips' ? resolveExportClips(runtimeProject, requestedRange) : null;
	const range = spans
		? normalizeFrameRange(Math.min(...spans.map((span) => span.startFrame)), Math.max(...spans.map((span) => span.endFrame)), 'export spans')
		: requestedRange;
	const masteringSequence = resolveMasteringSequenceExport(runtimeProject, {
		masteringSequenceId: options.masteringSequenceId ?? null,
		mode,
		outputSampleRate: sampleRate,
		admMetadata: bw64Adm?.metadata ?? null,
	});
	const markerExport = createRiffAnnotationExport(runtimeProject, {
		range,
		outputSampleRate: sampleRate,
		// Each span has its own timeline, so shared cues would describe other files.
		...(spans
			? { markerSource: 'none' }
			: options.markerSource == null ? {} : { markerSource: options.markerSource }),
		...(options.markerTrackId == null ? {} : { markerTrackId: options.markerTrackId }),
		preservedRiffMarkers: preservedRiffChunks?.markers === true,
		masteringSequenceCues: masteringSequence !== null,
	});
	let markers = masteringSequence ? masteringSequence.cues : markerExport.markers;
	let ixml = runtimeProject.metadata?.ixml ?? null;
	const cartMetadata = (deliveryRange) => cartForDeliveryRange(
		runtimeProject.metadata?.cart, deliveryRange, runtimeProject.sampleRate, sampleRate,
	);
	let cart = format === 'bwf' || format === 'bw64'
		? masteringSequence
			? cartForMasteringSequence(runtimeProject.metadata?.cart, masteringSequence.plan, runtimeProject.sampleRate, sampleRate)
			: cartMetadata(range) : null;
	// The TimeReference states where the delivered audio sits on the project's
	// timeline, so it is derived per delivered span, not once for the whole plan.
	const bwfMetadata = (rangeStartFrame) => createBwfExportMetadata(runtimeProject, {
		bext: options.bext, rangeStartFrame, outputSampleRate: sampleRate,
		bitDepth: encoding.bitDepth, channelCount: encoding.channelCount, productName: options.productName,
	});
	let bext = format === 'bwf' || format === 'bw64' ? bwfMetadata(range.startFrame) : null;
	if (preservedRiffChunks?.bext) {
		if (options.measureLoudness === true) {
			throw new Error('ADM passthrough with preserved BEXT cannot replace its loudness metadata.');
		}
		if (options.bext != null && !sameBextMetadata(options.bext, projectBextMetadata(runtimeProject))) {
			throw new Error('ADM passthrough with preserved BEXT cannot add replacement BEXT metadata.');
		}
		bext = null;
		const encodingWithoutBext = { ...encoding };
		delete encodingWithoutBext.bext;
		encoding = Object.freeze(encodingWithoutBext);
	}
	if (preservedRiffChunks?.ixml) ixml = null;
	if (preservedRiffChunks?.cart) cart = null;
	if (bext) encoding = Object.freeze({ ...encoding, bext });
	// Sequences, chapters and clips deliver their authored extents without tails.
	const tailFrames = masteringSequence || spans
		? 0
		: determineTailFrames(runtimeProject, mode, options.includeTail !== false);
	const outputFrameCount = (durationFrames) => scaleSampleFrame(
		durationFrames, runtimeProject.sampleRate, sampleRate, 'enclosingEnd',
	);
	const rangeOutputFrames = outputFrameCount(range.durationFrames);
	const tailOutputFrames = outputFrameCount(tailFrames);
	const spanOutputFrames = spans
		? spans.map((span) => outputFrameCount(span.durationFrames))
		: null;
	// Spans render sequentially, so one render holds only the longest output.
	const outputFrames = masteringSequence
		? masteringSequence.outputFrames
		: spanOutputFrames
			? Math.max(...spanOutputFrames)
			: rangeOutputFrames + tailOutputFrames;
	encoding = createEmbeddedChapterEncoding(encoding, runtimeProject, options, range, { rangeOutputFrames, deliveryOutputFrames: outputFrames });
	const adm = bw64Adm ? createBw64AdmExport(runtimeProject, bw64Adm, {
		range,
		outputFrames,
		encoding,
	}) : null;
	const outputBytes = estimatePcmBytes(outputFrames, encoding.channelCount);
	// Spans share encoding settings but each file has its own container size.
	const layoutForFrames = (totalFrames) => (format === 'aiff'
		? inspectAiffLayout({
			sampleRate, channelCount: encoding.channelCount, totalFrames,
			sampleFormat: encoding.sampleFormat, metadata: encoding.metadata, markers,
		})
		: format === 'wav' || format === 'bwf' || format === 'bw64'
			? inspectWavLayout({
				container: adm ? 'bw64' : 'auto',
				sampleRate,
				channelCount: encoding.channelCount,
				totalFrames,
				bitDepth: encoding.bitDepth,
				float: encoding.floatingPoint,
				metadata: encoding.metadata,
				markers,
				ixml,
				cart,
				bext,
				preDataChunks: adm?.preDataChunks,
				trailingChunks: adm?.trailingChunks,
			})
			: null);
	const outputLayout = layoutForFrames(outputFrames);
	const outputs = spans
		? spans.map((span, spanIndex) => ({
			kind: mode === 'clips' ? 'clip' : 'chapter',
			fileName: createExportFileName(runtimeProject, {
				format, extension: encoding.extension, mode: mode === 'clips' ? 'clip' : 'chapter',
				trackIndex: spanIndex, trackName: span.name,
			}),
			trackId: 'trackId' in span ? span.trackId : null,
			...(mode === 'clips' ? { clipId: 'clipId' in span ? span.clipId : undefined } : {}),
			includeMaster: mode !== 'clips',
			respectMuteSolo: mode !== 'clips',
			range: Object.freeze({
				startFrame: span.startFrame,
				endFrame: span.endFrame,
				durationFrames: span.durationFrames,
			}),
			outputFrames: spanOutputFrames[spanIndex],
			outputFileBytes: layoutForFrames(spanOutputFrames[spanIndex])?.byteLength ?? null,
			// Where this file, rather than the whole delivery, sits on the timeline.
			...(bext ? { bext: bwfMetadata(span.startFrame) } : {}),
			...(cart ? { cart: cartMetadata(span) } : {}),
		}))
		: mode === 'mix'
			? [{
				kind: 'mix',
				fileName: createExportFileName(runtimeProject, { format, extension: encoding.extension, date: options.date }),
				trackId: null,
				includeMaster: true,
				respectMuteSolo: true,
			}]
			: runtimeProject.tracks.filter((track) => track.type !== 'label' && track.type !== 'video').map((track, trackIndex) => ({
				kind: 'stem',
				fileName: createExportFileName(runtimeProject, { format, extension: encoding.extension, mode: 'stem', trackIndex, trackName: track.name }),
				trackId: track.id,
				includeMaster: false,
				respectMuteSolo: false,
			}));
	assertSoundscaperEffectChannelSafety(runtimeProject, mode, outputs);
	const renderStrategyOptions = {
		mobile: Boolean(options.mobile),
		outputBytes,
		livePcmBytes: options.livePcmBytes ?? estimateExportPlanSourceWorkingSetBytes(runtimeProject, mode, outputs,
			masteringSequence
				? masteringSequence.plan.segments.map((segment) => ({ startFrame: segment.sourceStartFrame, endFrame: segment.sourceEndFrame }))
				: spans || [range])
			// Sequence assembly retains its rendered regions beside the complete
			// delivery, at the render width before the encoder's channel mapping.
			+ (masteringSequence ? estimatePcmBytes(outputFrames, runtimeProject.masterChannels) * 2 : 0),
	};
	const legacyRender = chooseRenderStrategy(renderStrategyOptions);
	const render = legacyRender.strategy === 'offline'
		? chooseRenderStrategy({
			...renderStrategyOptions,
			offlineRenderAdmission: selectExportOfflineRenderAdmission({
				project: runtimeProject,
				mode,
				outputs,
				range,
				chapters: spans,
				renderRanges: masteringSequence?.plan.segments.map((segment) => ({
					startFrame: segment.sourceStartFrame,
					durationFrames: segment.sourceEndFrame - segment.sourceStartFrame,
				})),
				tailFrames,
				channelCount: adm?.channelCount,
			}),
		})
		: legacyRender;
	if (masteringSequence && render.strategy !== 'offline') {
		// The delivered timeline is assembled from several renders, which a stream
		// that encodes one contiguous range as it renders cannot produce. Refusing
		// is the honest outcome: the alternative writes the project's own timeline
		// under a name that promised the sequence's.
		throw new Error('Mastering sequence delivery requires the offline render; this delivery is too large for it.');
	}
	if (binaural && render.strategy !== 'offline') {
		// The renderer holds a delay line per source per ear; a stream that hands
		// out one chunk at a time and re-encodes on fallback would restart it.
		throw new Error('A binaural delivery requires the offline render.');
	}
	const loudnessNormalization = resolveExportLoudnessNormalization(options, {
		mode,
		admMetadata: bw64Adm?.metadata ?? null,
		renderStrategy: render.strategy,
	});
	// Channel semantics belong to the mix even when its container does not carry
	// ADM. Preserve them on the exact plan only while the delivery preserves the
	// authored channel order; a stem or a remap no longer has those bed roles.
	const measuresLoudness = loudnessNormalization !== null
		|| ((format === 'bwf' || format === 'bw64') && options.measureLoudness === true);
	// PCM delivery supports wider immersive programmes, but the maintained meter
	// has no admitted semantics beyond this width. Refuse at plan time rather
	// than rendering the whole programme and failing during encoding.
	if (measuresLoudness && encoding.channelCount > EBU_R128_MAXIMUM_CHANNELS) {
		throw new RangeError(
			`Loudness analysis supports at most ${EBU_R128_MAXIMUM_CHANNELS} delivered channels; downmix this delivery or turn off loudness measurement and normalization.`,
		);
	}
	const loudnessChannelWeights = measuresLoudness && mode === 'mix'
		&& encoding.channelMapping.mode === 'preserve'
		? resolveAdmEbuChannelWeights(runtimeProject.metadata?.adm, encoding.channelCount)
		: null;
	const fallbackTemporaryBytes = spans
		? spans.reduce(
			(bytes, span, spanIndex) => bytes
				+ estimatePcmBytes(spanOutputFrames[spanIndex], encoding.channelCount),
			0,
		)
		: multiplySafeIntegers(outputBytes, outputs.length, 'Temporary export size');
	const archive = mode !== 'mix'
		? createStemArchivePlan(
			`${sanitizeExportName(runtimeProject.title)}-${mode}-${isoDate(options.date)}`,
			outputs.map((output) => ({
				fileName: output.fileName,
				expectedByteLength: spans
					? output.outputFileBytes
					: outputLayout?.byteLength ?? null,
			})),
			fallbackTemporaryBytes,
		)
		: null;
	const requiredTemporaryBytes = archive?.requiredTemporaryBytes
		?? (mode === 'mix' && outputLayout
			? outputLayout.byteLength
			: fallbackTemporaryBytes);

	return {
		mode,
		format,
		mimeType: encoding.mimeType,
		sampleRate,
		channelCount: encoding.channelCount,
		channelMapping: encoding.channelMapping,
		encoding,
		dither: encoding.dither !== 'none',
		ditherMode: encoding.dither,
		metadata: encoding.metadata,
		markers,
		markerInterchangeReport: markerExport.report,
		ixml,
		cart,
		...(bext ? { bext } : {}),
		...(adm ? {
			container: 'bw64',
			adm,
			preDataChunks: adm.preDataChunks,
			trailingChunks: adm.trailingChunks,
		} : {}),
		loudnessNormalization,
		...(loudnessChannelWeights ? { loudnessChannelWeights } : {}),
		...(binaural ? { binaural } : {}),
		...(masteringSequence ? { masteringSequence: masteringSequence.plan } : {}),
		range: masteringSequence ? masteringSequence.sourceRange : range,
		tailFrames,
		outputFrames,
		outputBytesPerRender: outputBytes,
		// Spans differ in length; each output and archive entry states its own size.
		outputFileBytesPerRender: spans ? null : outputLayout?.byteLength ?? null,
		requiredTemporaryBytes,
		render,
		outputs,
		archive,
		aggregateStereoMinutes: aggregateStereoMinutes(runtimeProject),
	};
}

function multiplySafeIntegers(left, right, name) {
	if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0
		|| (right !== 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right))) {
		throw new RangeError(`${name} exceeds JavaScript's safe integer range.`);
	}
	return left * right;
}

function resolveExportRange(project, requestedRange) {
	if (requestedRange === 'project') return normalizeFrameRange(0, projectDurationFrames(project), 'export range');
	if (requestedRange === 'selection') {
		return normalizeFrameRange(project.selection.startFrame, project.selection.endFrame, 'export selection');
	}
	if (requestedRange === 'loop') {
		if (!project.loop?.enabled) throw new RangeError('The project loop is not enabled.');
		return normalizeFrameRange(project.loop.startFrame, project.loop.endFrame, 'export loop');
	}
	if (requestedRange && typeof requestedRange === 'object') {
		return normalizeFrameRange(requestedRange.startFrame, requestedRange.endFrame, 'export range');
	}
	throw new RangeError('Export range must be project, selection, or an explicit frame range.');
}

function determineTailFrames(project, mode, includeTail) {
	if (!includeTail) return 0;
	return projectEffectTailFrames(project, {
		includeMaster: deliversMasterMix(mode),
		maximumSeconds: 10,
	});
}

function exportExtension(format) {
	const descriptor = getMediaExportFormat(format);
	if (!descriptor.extension) throw new RangeError('Custom FFmpeg exports require an output extension.');
	return descriptor.extension;
}

function isoDate(value = new Date()) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid export date is required.');
	return date.toISOString().slice(0, 10);
}

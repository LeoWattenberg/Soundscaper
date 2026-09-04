import { projectEffectTailFrames } from './effects.js';
import { createBwfExportMetadata, projectBextMetadata } from './broadcast-wave-project.ts';
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
import { createStemArchivePlan } from './controller/stem-archive.ts';
import { EBU_R128_MAXIMUM_CHANNELS } from './ebu-r128.js';
import { resolveAdmEbuChannelWeights } from './loudness-channel-layout.ts';
import { createRiffAnnotationExport } from './timeline-annotation-riff-interchange.ts';
import { resolveBinauralDelivery } from './binaural-delivery.ts';
import { resolveExportChapters } from './export-chapters.ts';
import { resolveMasteringSequenceExport } from './mastering-sequence-export.ts';
import {
	assertSoundscaperEffectChannelSafety,
	deliversMasterMix,
	longestChapterRange,
	resolveExportLoudnessNormalization,
	selectExportOfflineRenderAdmission,
} from './export-plan-admission.js';
import { scaleSampleFrame } from './timeline-time.ts';

export const EXPORT_FORMAT_DEFAULTS = Object.freeze({
	wav: { bitDepth: 24 },
	bwf: { bitDepth: 24 },
	bw64: { bitDepth: 24 },
	aiff: { bitDepth: 24 },
	flac: { bitDepth: 24, compressionLevel: 5 },
	mp3: { bitRateMode: 'preset', bitRatePreset: 2, vbrQuality: 2, bitRate: 192, averageBitRate: 192 },
	'ogg-vorbis': { quality: 5 },
	opus: { bitRate: 160, vbrMode: 'on' },
	wavpack: { bitDepth: 24, compressionLevel: 2 },
	mp2: { bitRate: 256 },
	'aac-m4a': { bitRate: 192 },
	'custom-ffmpeg': {},
});

export const FAST_RENDER_THRESHOLDS = Object.freeze({
	mobile: { outputBytes: 96 * 1024 ** 2, totalBytes: 320 * 1024 ** 2 },
	desktop: { outputBytes: 384 * 1024 ** 2, totalBytes: 1024 * 1024 ** 2 },
});

/**
 * One file a plan delivers. A chapter output also states the span it holds and
 * what that span renders to, because a chapter is rendered on its own rather
 * than as a slice of the plan's range; a mix or stem output takes both from the
 * plan itself and leaves them absent.
 *
 * @typedef {Object} AudioExportPlanOutput
 * @property {string} kind
 * @property {string} fileName
 * @property {string | null} trackId
 * @property {boolean} [includeMaster]
 * @property {boolean} [respectMuteSolo]
 * @property {{startFrame: number, endFrame: number, durationFrames: number}} [range]
 * @property {number} [outputFrames]
 * @property {number | null} [outputFileBytes]
 * @property {import('./broadcast-wave.ts').BextMetadata} [bext]
 */

/**
 * @typedef {Object} AudioExportPlan
 * @property {'mix' | 'stems' | 'chapters'} mode
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
 * @property {import('./controller/stem-archive.ts').StemArchivePlan|null} archive
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
	const withinLegacyThresholds = outputBytes <= thresholds.outputBytes && totalBytes <= thresholds.totalBytes;
	const hasOfflineRenderAdmission = options.offlineRenderAdmission !== undefined;
	const offlineRenderAdmission = hasOfflineRenderAdmission ? options.offlineRenderAdmission : null;
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
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-_.]+|[-_.]+$/g, '')
		.slice(0, 96);
	return normalized || fallback;
}

export function createExportFileName(project, options = {}) {
	const extension = options.extension || exportExtension(options.format || 'wav');
	if (options.mode === 'stem' || options.mode === 'chapter') {
		const index = Number(options.trackIndex ?? 0) + 1;
		const fallback = options.mode === 'chapter' ? 'chapter' : 'track';
		return `${String(index).padStart(2, '0')}-${sanitizeExportName(options.trackName, fallback)}.${extension}`;
	}
	const date = isoDate(options.date);
	return `${sanitizeExportName(project.title)}-mix-${date}.${extension}`;
}

/** @returns {AudioExportPlan} */
export function createExportPlan(project, options = {}) {
	const runtimeProject = projectForRuntimeConsumers(project);
	const mode = options.mode || 'mix';
	if (mode !== 'mix' && mode !== 'stems' && mode !== 'chapters') {
		throw new RangeError('Export mode must be mix, stems, or chapters.');
	}
	const format = canonicalMediaExportFormat(options.format || 'wav');
	if (format === 'bw64' && mode !== 'mix') throw new RangeError('BW64 / ADM export is mix-only.');
	assertSoundscaperEffectChannelSafety(runtimeProject, mode);
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
	// A chapter delivery reads the labels inside the requested range and writes
	// one file per chapter; the range the rest of the plan describes is then the
	// span those chapters actually cover, not the range they were selected from.
	const chapters = mode === 'chapters' ? resolveExportChapters(runtimeProject, requestedRange) : null;
	const range = chapters
		? normalizeFrameRange(chapters[0].startFrame, chapters[chapters.length - 1].endFrame, 'export chapters')
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
		// The labels are the split, so writing them into every chapter as cues
		// would describe boundaries the file no longer crosses.
		...(chapters
			? { markerSource: 'none' }
			: options.markerSource == null ? {} : { markerSource: options.markerSource }),
		...(options.markerTrackId == null ? {} : { markerTrackId: options.markerTrackId }),
		preservedRiffMarkers: preservedRiffChunks?.markers === true,
		masteringSequenceCues: masteringSequence !== null,
	});
	let markers = masteringSequence ? masteringSequence.cues : markerExport.markers;
	let ixml = runtimeProject.metadata?.ixml ?? null;
	let cart = format === 'bwf' || format === 'bw64' ? runtimeProject.metadata?.cart ?? null : null;
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
	// A sequence delivers exactly the regions it names: audio past the last one is
	// audio the sequence did not ask for, so there is no tail to add.
	// A chapter delivers exactly the span its label names, the way a sequence
	// delivers exactly the regions it names: a tail would spill the end of one
	// chapter into the audio the next chapter already starts with.
	const tailFrames = masteringSequence || chapters
		? 0
		: determineTailFrames(runtimeProject, mode, options.includeTail !== false);
	const outputFrameCount = (durationFrames) => scaleSampleFrame(
		durationFrames, runtimeProject.sampleRate, sampleRate, 'enclosingEnd',
	);
	const rangeOutputFrames = outputFrameCount(range.durationFrames);
	const tailOutputFrames = outputFrameCount(tailFrames);
	const chapterOutputFrames = chapters
		? chapters.map((chapter) => outputFrameCount(chapter.durationFrames))
		: null;
	// The plan states one render's size, and chapters render one at a time, so
	// the longest chapter is what the memory estimates and the render strategy
	// have to hold — not the whole span the chapters were cut from.
	const outputFrames = masteringSequence
		? masteringSequence.outputFrames
		: chapterOutputFrames
			? Math.max(...chapterOutputFrames)
			: rangeOutputFrames + tailOutputFrames;
	const adm = bw64Adm ? createBw64AdmExport(runtimeProject, bw64Adm, {
		range,
		outputFrames,
		encoding,
	}) : null;
	const outputBytes = estimatePcmBytes(outputFrames, encoding.channelCount);
	// Each delivered file's container layout, which chapters need per file: they
	// share every encoding decision and differ only in how many frames they hold.
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
	const outputs = chapters
		? chapters.map((chapter, chapterIndex) => ({
			kind: 'chapter',
			fileName: createExportFileName(runtimeProject, {
				format, extension: encoding.extension, mode: 'chapter',
				trackIndex: chapterIndex, trackName: chapter.name,
			}),
			trackId: null,
			includeMaster: true,
			respectMuteSolo: true,
			// The span this file holds, so the render reads the chapter rather
			// than the whole delivery the plan's own range describes.
			range: Object.freeze({
				startFrame: chapter.startFrame,
				endFrame: chapter.endFrame,
				durationFrames: chapter.durationFrames,
			}),
			outputFrames: chapterOutputFrames[chapterIndex],
			outputFileBytes: layoutForFrames(chapterOutputFrames[chapterIndex])?.byteLength ?? null,
			// Where this file, rather than the whole delivery, sits on the timeline.
			...(bext ? { bext: bwfMetadata(chapter.startFrame) } : {}),
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
	const renderStrategyOptions = {
		mobile: Boolean(options.mobile),
		outputBytes,
		livePcmBytes: options.livePcmBytes ?? estimateProjectPcmBytes(runtimeProject),
	};
	const legacyRender = chooseRenderStrategy(renderStrategyOptions);
	const render = legacyRender.strategy === 'offline'
		? chooseRenderStrategy({
			...renderStrategyOptions,
			offlineRenderAdmission: selectExportOfflineRenderAdmission({
				project: runtimeProject,
				mode,
				outputs,
				range: masteringSequence
					? { startFrame: masteringSequence.sourceRange.startFrame, durationFrames: masteringSequence.longestRenderFrames }
					: chapters
						? longestChapterRange(chapters)
						: range,
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
	const fallbackTemporaryBytes = chapters
		? chapters.reduce(
			(bytes, chapter, chapterIndex) => bytes
				+ estimatePcmBytes(chapterOutputFrames[chapterIndex], encoding.channelCount),
			0,
		)
		: multiplySafeIntegers(outputBytes, outputs.length, 'Temporary export size');
	const archive = mode === 'stems' || mode === 'chapters'
		? createStemArchivePlan(
			`${sanitizeExportName(runtimeProject.title)}-${mode}-${isoDate(options.date)}`,
			outputs.map((output) => ({
				fileName: output.fileName,
				expectedByteLength: chapters
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
		// Chapters differ in length, so there is no one delivered file size; each
		// output states its own, and the archive plan carries them as entries.
		outputFileBytesPerRender: chapters ? null : outputLayout?.byteLength ?? null,
		requiredTemporaryBytes,
		render,
		outputs,
		archive,
		aggregateStereoMinutes: aggregateStereoMinutes(runtimeProject),
	};
}

/** Every mode but stems delivers the master mix, whole or in named spans. */
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

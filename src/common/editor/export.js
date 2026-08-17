import { projectEffectTailFrames } from './effects.js';
import { createBwfExportMetadata, projectBextMetadata } from './broadcast-wave-project.ts';
import {
	inspectPreservedAdmRiffChunks,
	sameBextMetadata,
	splitAdmRiffChunkSequence,
	validateAdmPassthroughPayload,
	validateAdmRiffChunkSequence,
} from './adm-riff-passthrough.ts';
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
import {
	createAdmChna,
	createRiffAxmlChunk,
	createRiffChnaChunk,
} from './adm-metadata.ts';
import { decodeWavOpaqueRiffChunk } from './wav-opaque-chunks.ts';
import { normalizeLoudnessNormalizationTarget } from './loudness-normalization.ts';
import { findUnsafeAdmRenderEffects } from './adm-render-safety.ts';
import { createRiffAnnotationExport } from './timeline-annotation-riff-interchange.ts';
import { planExportOfflineRenderStrategyAdmission } from './export-render-admission.ts';
import {
	isNeutralAdmSignalPath,
	resolveExactAdmPassthroughTimelineSource,
} from './adm-passthrough-project.ts';
import {
	admBedChannelCount,
	admBedChannelOrder,
	evaluateAdmPassthroughEligibility,
	normalizeAdmProjectMetadata,
	validateAdmAuthoredRouting,
} from './adm-project-metadata.ts';

export const EXPORT_FORMAT_DEFAULTS = Object.freeze({
	wav: { bitDepth: 24 },
	bwf: { bitDepth: 24 },
	bw64: { bitDepth: 24 },
	aiff: { bitDepth: 24 },
	flac: { bitDepth: 24, compressionLevel: 5 },
	mp3: { bitRate: 192 },
	'ogg-vorbis': { quality: 5 },
	opus: { bitRate: 160 },
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
 * @typedef {Object} AudioExportPlan
 * @property {'mix' | 'stems'} mode
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
 * @property {Array<{kind: string, fileName: string, trackId: string | null}>} outputs
 * @property {import('./controller/stem-archive.ts').StemArchivePlan|null} archive
 * @property {import('./broadcast-wave.ts').BextMetadata} [bext]
 * @property {'bw64'} [container]
 * @property {{ mode: 'authored'|'passthrough', metadata: import('./adm-project-metadata.ts').AdmProjectMetadata, channelCount: number, channelOrder: readonly string[], preDataChunks: Uint8Array|readonly Uint8Array[]|undefined, trailingChunks: Uint8Array|readonly Uint8Array[]|undefined }} [adm]
 * @property {Uint8Array|readonly Uint8Array[]} [preDataChunks]
 * @property {Uint8Array|readonly Uint8Array[]} [trailingChunks]
 * @property {readonly import('./riff-markers.ts').RiffMarker[]} markers
 * @property {import('./timeline-annotation-interchange-report.ts').TimelineAnnotationInterchangeReport} markerInterchangeReport
 * @property {import('./loudness-normalization.ts').LoudnessNormalizationTarget|null} loudnessNormalization
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

export function sanitizeExportName(value, fallback = 'audio-project') {
	const normalized = String(value || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-_.]+|[-_.]+$/g, '')
		.slice(0, 96);
	return normalized || fallback;
}

export function createExportFileName(project, options = {}) {
	const extension = options.extension || exportExtension(options.format || 'wav');
	if (options.mode === 'stem') {
		const index = Number(options.trackIndex ?? 0) + 1;
		return `${String(index).padStart(2, '0')}-${sanitizeExportName(options.trackName, 'track')}.${extension}`;
	}
	const date = isoDate(options.date);
	return `${sanitizeExportName(project.title)}-mix-${date}.${extension}`;
}

/** @returns {AudioExportPlan} */
export function createExportPlan(project, options = {}) {
	const runtimeProject = projectForRuntimeConsumers(project);
	const mode = options.mode || 'mix';
	if (mode !== 'mix' && mode !== 'stems') throw new RangeError('Export mode must be mix or stems.');
	const format = canonicalMediaExportFormat(options.format || 'wav');
	if (format === 'bw64' && mode !== 'mix') throw new RangeError('BW64 / ADM export is mix-only.');
	const bw64Adm = format === 'bw64' ? resolveBw64Adm(runtimeProject, options) : null;
	let encoding = normalizeMediaExportSettings(format, {
		...options,
		sampleRate: options.sampleRate ?? runtimeProject.sampleRate ?? AUDIO_EDITOR_SAMPLE_RATE,
		inputChannelCount: bw64Adm?.channelCount
			?? options.inputChannelCount ?? runtimeProject.masterChannels ?? AUDIO_EDITOR_MASTER_CHANNELS,
		...(bw64Adm ? { channelMapping: 'preserve' } : {}),
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
	const range = resolveExportRange(runtimeProject, options.range || 'project');
	const markerExport = createRiffAnnotationExport(runtimeProject, {
		range,
		outputSampleRate: sampleRate,
		...(options.markerSource == null ? {} : { markerSource: options.markerSource }),
		...(options.markerTrackId == null ? {} : { markerTrackId: options.markerTrackId }),
		preservedRiffMarkers: preservedRiffChunks?.markers === true,
	});
	let markers = markerExport.markers;
	let ixml = runtimeProject.metadata?.ixml ?? null;
	let cart = format === 'bwf' || format === 'bw64' ? runtimeProject.metadata?.cart ?? null : null;
	let bext = format === 'bwf' || format === 'bw64'
		? createBwfExportMetadata(runtimeProject, {
			bext: options.bext,
			rangeStartFrame: range.startFrame,
			outputSampleRate: sampleRate,
			bitDepth: encoding.bitDepth,
			channelCount: encoding.channelCount,
			productName: options.productName,
		})
		: null;
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
	const tailFrames = determineTailFrames(runtimeProject, mode, options.includeTail !== false);
	const rangeOutputFrames = Math.ceil(range.durationFrames * sampleRate / runtimeProject.sampleRate);
	const tailOutputFrames = Math.ceil(tailFrames * sampleRate / runtimeProject.sampleRate);
	const outputFrames = rangeOutputFrames + tailOutputFrames;
	const adm = bw64Adm ? createBw64AdmExport(runtimeProject, bw64Adm, {
		range,
		outputFrames,
		encoding,
	}) : null;
	const outputBytes = estimatePcmBytes(outputFrames, encoding.channelCount);
	const outputLayout = format === 'aiff'
		? inspectAiffLayout({
			sampleRate, channelCount: encoding.channelCount, totalFrames: outputFrames,
			sampleFormat: encoding.sampleFormat, metadata: encoding.metadata,
		})
		: format === 'wav' || format === 'bwf' || format === 'bw64'
			? inspectWavLayout({
				container: adm ? 'bw64' : 'auto',
				sampleRate,
				channelCount: encoding.channelCount,
				totalFrames: outputFrames,
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
			: null;
	const outputs = mode === 'mix'
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
				range,
				tailFrames,
				channelCount: adm?.channelCount,
			}),
		})
		: legacyRender;
	const loudnessNormalization = resolveExportLoudnessNormalization(options, {
		mode,
		admMetadata: bw64Adm?.metadata ?? null,
		renderStrategy: render.strategy,
	});
	const fallbackTemporaryBytes = multiplySafeIntegers(outputBytes, outputs.length, 'Temporary export size');
	const archive = mode === 'stems'
		? createStemArchivePlan(
			`${sanitizeExportName(runtimeProject.title)}-stems-${isoDate(options.date)}`,
			outputs.map((output) => ({
				fileName: output.fileName,
				expectedByteLength: outputLayout?.byteLength ?? null,
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
		range,
		tailFrames,
		outputFrames,
		outputBytesPerRender: outputBytes,
		outputFileBytesPerRender: outputLayout?.byteLength ?? null,
		requiredTemporaryBytes,
		render,
		outputs,
		archive,
		aggregateStereoMinutes: aggregateStereoMinutes(runtimeProject),
	};
}

/**
 * Resolve the delivery's loudness target, refusing every case where a gain
 * cannot be applied honestly.
 *
 * Normalization is a **plan step**: the target is decided here, from the plan,
 * so no encoder ever receives a loudness flag and no format can normalize
 * differently from another. The failure this guards against is not a crash but
 * a file that looks normalized and is not, so each case below is a typed
 * refusal rather than a quietly un-normalized delivery.
 */
function resolveExportLoudnessNormalization(options, { mode, admMetadata, renderStrategy }) {
	const target = normalizeLoudnessNormalizationTarget(options.loudnessNormalization);
	if (!target) return null;
	if (mode !== 'mix') {
		// Normalizing stems independently moves them relative to each other, so
		// their sum stops being the normalized mix. Applying the mix's gain to
		// every stem instead needs the mix rendered as well, which is the render
		// topology change this slice stops at.
		throw new Error('Loudness normalization is mix-only; normalized stems would no longer sum to the normalized mix.');
	}
	if (admMetadata?.mode === 'passthrough') {
		throw new Error('ADM passthrough preserves the source bytes and cannot be loudness-normalized.');
	}
	if (renderStrategy === 'realtime-stream') {
		// The gain is decided from a measurement of the whole delivery, which a
		// stream that encodes as it renders has no opportunity to take.
		throw new Error('Loudness normalization requires the offline render; a realtime stream cannot measure the delivery before writing it.');
	}
	return target;
}

function selectExportOfflineRenderAdmission({
	project, mode, outputs, range, tailFrames, channelCount,
}) {
	const common = {
		project,
		rangeStartFrame: range.startFrame,
		requestedRenderFrames: Math.max(1, range.durationFrames + tailFrames),
		...(channelCount == null ? {} : { channelCount }),
	};
	const targets = mode === 'mix'
		? [{ trackId: null, includeMaster: true }]
		: outputs.map(({ trackId }) => ({ trackId, includeMaster: false }));
	return targets.reduce((selected, target) => {
		const candidate = planExportOfflineRenderStrategyAdmission({ ...common, ...target });
		return selected == null || candidate.peakUsefulBinaryBytes > selected.peakUsefulBinaryBytes
			? candidate
			: selected;
	}, null);
}

function resolveBw64Adm(project, options) {
	const transient = options.adm !== undefined;
	const requestedMetadata = transient ? options.adm : project.metadata?.adm;
	const metadata = requestedMetadata == null ? null : normalizeAdmProjectMetadata(requestedMetadata);
	if (!metadata) throw new Error('BW64 export requires ADM metadata.');
	if (options.channelMapping != null && options.channelMapping !== 'preserve') {
		throw new Error('BW64 / ADM export requires the preserve channel mapping and ADM channel order.');
	}
	const channelCount = metadata.mode === 'authored'
		? admBedChannelCount(metadata.bed.layout)
		: metadata.geometry.channelCount;
	const masterChannels = Number(options.inputChannelCount ?? project.masterChannels ?? AUDIO_EDITOR_MASTER_CHANNELS);
	if ((metadata.mode === 'passthrough' || !transient) && masterChannels !== channelCount) {
		throw new Error(`The ${channelCount}-channel ADM bed does not match the ${masterChannels}-channel project master.`);
	}
	if (metadata.mode === 'authored') {
		const issues = validateAdmAuthoredRouting(metadata, {
			...project,
			masterChannels: transient ? channelCount : masterChannels,
		});
		if (issues.length) throw new Error(`ADM routing is incomplete: ${issues.map(({ message }) => message).join(' ')}`);
		const unsafeEffects = findUnsafeAdmRenderEffects(project, channelCount);
		if (unsafeEffects.length) {
			throw new Error(`ADM export cannot use effects that change terminal channel width: ${unsafeEffects
				.map(({ effectType, scope, targetId }) => `${effectType} on ${scope}${targetId ? ` ${targetId}` : ''}`)
				.join(', ')}.`);
		}
		return Object.freeze({
			metadata,
			channelCount,
			channelOrder: admBedChannelOrder(metadata.bed.layout),
		});
	}
	const channelOrder = validateAdmPassthroughPayload(metadata);
	validateAdmRiffChunkSequence(metadata);
	return Object.freeze({
		metadata,
		channelCount,
		channelOrder,
	});
}

function createBw64AdmExport(project, resolved, { range, outputFrames, encoding }) {
	const { metadata, channelCount, channelOrder } = resolved;
	if (encoding.channelCount !== channelCount) {
		throw new Error('BW64 output channel count does not match its ADM bed.');
	}
	let preDataChunks;
	let trailingChunks;
	if (metadata.mode === 'authored') {
		preDataChunks = createRiffChnaChunk(createAdmChna({ layout: metadata.bed.layout }));
		trailingChunks = createRiffAxmlChunk({
			programmeName: metadata.programme.name,
			contentName: metadata.content.name,
			programmeLanguage: metadata.programme.language,
			contentLanguage: metadata.content.language,
			bedName: metadata.bed.name,
			layout: metadata.bed.layout,
		});
	} else {
		if (encoding.dither !== 'none') throw new Error('ADM passthrough export requires dither to be disabled.');
		if (!isNeutralAdmSignalPath(project)) {
			throw new Error('ADM passthrough requires a neutral project signal path.');
		}
		const source = resolveExactAdmPassthroughTimelineSource(
			project,
			metadata.geometry.frameCount,
		);
		if (!source) {
			throw new Error('ADM passthrough requires one exact full-source timeline clip and track path.');
		}
		if (source.storageKey !== metadata.source.storageKey || source.mimeType !== metadata.source.mimeType) {
			throw new Error('ADM passthrough is not eligible: source-changed.');
		}
		const outputEligibility = evaluateAdmPassthroughEligibility(metadata, {
			projectRevision: project.revision,
			sourceId: source?.id ?? '',
			sampleRate: encoding.sampleRate,
			channelCount: encoding.channelCount,
			frameCount: outputFrames,
			bitDepth: encoding.bitDepth,
			float: encoding.floatingPoint,
			startFrame: range.startFrame,
			endFrame: range.endFrame,
		});
		if (!outputEligibility.eligible) {
			throw new Error(`ADM passthrough is not eligible: ${outputEligibility.reason}.`);
		}
		const sourceEligibility = evaluateAdmPassthroughEligibility(metadata, {
			projectRevision: project.revision,
			sourceId: source?.id ?? '',
			sampleRate: source?.sampleRate ?? 0,
			channelCount: source?.channelCount ?? 0,
			frameCount: source?.frameCount ?? 0,
			bitDepth: metadata.geometry.bitDepth,
			float: metadata.geometry.float,
			startFrame: range.startFrame,
			endFrame: range.endFrame,
		});
		if (!sourceEligibility.eligible) {
			throw new Error(`ADM passthrough is not eligible: ${sourceEligibility.reason}.`);
		}
		if (metadata.riffChunkSequence?.length) {
			const sequence = splitAdmRiffChunkSequence(metadata);
			preDataChunks = compactRiffChunks(sequence.preDataChunks);
			trailingChunks = compactRiffChunks(sequence.trailingChunks);
		} else {
			const opaqueBefore = (metadata.opaqueRiffChunks ?? [])
				.filter(({ placement }) => placement === 'before-data')
				.map(decodeWavOpaqueRiffChunk);
			const chnaChunk = metadata.chna.rawBase64
				? createRiffChunk('chna', decodeBase64(metadata.chna.rawBase64))
				: undefined;
			preDataChunks = compactRiffChunks([...opaqueBefore, ...(chnaChunk ? [chnaChunk] : [])]);
			const payloads = [
				metadata.payload,
				...(metadata.auxiliaryPayloads ?? []),
				...(metadata.serialPayload ? [metadata.serialPayload] : []),
			];
			const chunks = payloads.map((payload) => createRiffChunk(
				payload.kind,
				payload.kind === 'axml'
					? decodeBase64(payload.rawBase64)
					: decodeBase64(payload.base64),
			));
			const opaqueAfter = (metadata.opaqueRiffChunks ?? [])
				.filter(({ placement }) => placement === 'after-data')
				.map(decodeWavOpaqueRiffChunk);
			trailingChunks = compactRiffChunks([...chunks, ...opaqueAfter]);
		}
	}
	return Object.freeze({
		mode: metadata.mode,
		metadata,
		channelCount,
		channelOrder,
		preDataChunks,
		trailingChunks,
	});
}

function compactRiffChunks(chunks) {
	if (chunks.length === 0) return undefined;
	return chunks.length === 1 ? chunks[0] : Object.freeze(chunks);
}

function decodeBase64(value) {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function createRiffChunk(id, payload) {
	if (!/^[\x20-\x7e]{4}$/u.test(id)) throw new RangeError('ADM RIFF chunk ID must contain four ASCII characters.');
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	chunk.set(Uint8Array.from(id, (character) => character.charCodeAt(0)));
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
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
		includeMaster: mode === 'mix',
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

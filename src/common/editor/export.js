import { projectEffectTailFrames } from './effects.js';
import { createBwfExportMetadata } from './broadcast-wave-project.ts';
import {
	AUDIO_EDITOR_MASTER_CHANNELS,
	AUDIO_EDITOR_SAMPLE_RATE,
	aggregateStereoMinutes,
	projectDurationFrames,
	normalizeFrameRange,
} from './project.js';
import {
	canonicalMediaExportFormat,
	getMediaExportFormat,
	normalizeMediaExportSettings,
} from './media-export.js';
import { inspectWavLayout } from './wav.js';
import { createStemArchivePlan } from './controller/stem-archive.ts';
import {
	createAdmChna,
	createRiffAxmlChunk,
	createRiffChnaChunk,
	inspectAdmAxml,
	parseChnaPayload,
	validateAdmCommonDefinitionChna,
	validateAdmChnaConsistency,
} from './adm-metadata.ts';
import { inspectBxmlAdmPayload } from './wav-adm-import.ts';
import { validateAdmSxmlPayload } from './adm-sxml.ts';
import { decodeWavOpaqueRiffChunk } from './wav-opaque-chunks.ts';
import { findUnsafeAdmRenderEffects } from './adm-render-safety.ts';
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
 * @property {{ strategy: 'offline' | 'realtime-stream', fast: boolean }} render
 * @property {Array<{kind: string, fileName: string, trackId: string | null}>} outputs
 * @property {import('./controller/stem-archive.ts').StemArchivePlan|null} archive
 * @property {import('./broadcast-wave.ts').BextMetadata} [bext]
 * @property {'bw64'} [container]
 * @property {{ mode: 'authored'|'passthrough', metadata: import('./adm-project-metadata.ts').AdmProjectMetadata, channelCount: number, channelOrder: readonly string[], preDataChunks: Uint8Array|readonly Uint8Array[]|undefined, trailingChunks: Uint8Array|readonly Uint8Array[] }} [adm]
 * @property {Uint8Array|readonly Uint8Array[]} [preDataChunks]
 * @property {Uint8Array|readonly Uint8Array[]} [trailingChunks]
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
	const fast = outputBytes <= thresholds.outputBytes && totalBytes <= thresholds.totalBytes;
	return {
		strategy: fast ? 'offline' : 'realtime-stream',
		fast,
		outputBytes,
		livePcmBytes,
		totalBytes,
		thresholds,
		reason: fast ? null : outputBytes > thresholds.outputBytes ? 'output-memory' : 'total-memory',
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
	const mode = options.mode || 'mix';
	if (mode !== 'mix' && mode !== 'stems') throw new RangeError('Export mode must be mix or stems.');
	const format = canonicalMediaExportFormat(options.format || 'wav');
	if (format === 'bw64' && mode !== 'mix') throw new RangeError('BW64 / ADM export is mix-only.');
	const bw64Adm = format === 'bw64' ? resolveBw64Adm(project, options) : null;
	let encoding = normalizeMediaExportSettings(format, {
		...options,
		sampleRate: options.sampleRate ?? project.sampleRate ?? AUDIO_EDITOR_SAMPLE_RATE,
		inputChannelCount: bw64Adm?.channelCount
			?? options.inputChannelCount ?? project.masterChannels ?? AUDIO_EDITOR_MASTER_CHANNELS,
		...(bw64Adm ? { channelMapping: 'preserve' } : {}),
	});
	const sampleRate = encoding.sampleRate;
	const range = resolveExportRange(project, options.range || 'project');
	const markers = createExportMarkers(project, range, sampleRate, options.markerTrackId);
	const bext = format === 'bwf' || format === 'bw64'
		? createBwfExportMetadata(project, {
			bext: options.bext,
			rangeStartFrame: range.startFrame,
			outputSampleRate: sampleRate,
			bitDepth: encoding.bitDepth,
			channelCount: encoding.channelCount,
			productName: options.productName,
		})
		: null;
	if (bext) encoding = Object.freeze({ ...encoding, bext });
	const tailFrames = determineTailFrames(project, mode, options.includeTail !== false);
	const rangeOutputFrames = Math.ceil(range.durationFrames * sampleRate / project.sampleRate);
	const tailOutputFrames = Math.ceil(tailFrames * sampleRate / project.sampleRate);
	const outputFrames = rangeOutputFrames + tailOutputFrames;
	const adm = bw64Adm ? createBw64AdmExport(project, bw64Adm, {
		range,
		outputFrames,
		encoding,
	}) : null;
	const outputBytes = estimatePcmBytes(outputFrames, encoding.channelCount);
	const outputLayout = format === 'wav' || format === 'bwf' || format === 'bw64'
		? inspectWavLayout({
			container: adm ? 'bw64' : 'auto',
			sampleRate,
			channelCount: encoding.channelCount,
			totalFrames: outputFrames,
			bitDepth: encoding.bitDepth,
			float: encoding.floatingPoint,
			metadata: encoding.metadata,
			markers,
			ixml: project.metadata?.ixml ?? null,
			cart: format === 'bwf' || format === 'bw64' ? project.metadata?.cart ?? null : null,
			bext,
			preDataChunks: adm?.preDataChunks,
			trailingChunks: adm?.trailingChunks,
		})
		: null;
	const render = chooseRenderStrategy({
		mobile: Boolean(options.mobile),
		outputBytes,
		livePcmBytes: options.livePcmBytes ?? estimateProjectPcmBytes(project),
	});
	const outputs = mode === 'mix'
		? [{
			kind: 'mix',
			fileName: createExportFileName(project, { format, extension: encoding.extension, date: options.date }),
			trackId: null,
			includeMaster: true,
			respectMuteSolo: true,
		}]
		: project.tracks.filter((track) => track.type !== 'label' && track.type !== 'video').map((track, trackIndex) => ({
			kind: 'stem',
			fileName: createExportFileName(project, { format, extension: encoding.extension, mode: 'stem', trackIndex, trackName: track.name }),
			trackId: track.id,
			includeMaster: false,
			respectMuteSolo: false,
		}));
	const fallbackTemporaryBytes = multiplySafeIntegers(outputBytes, outputs.length, 'Temporary export size');
	const archive = mode === 'stems'
		? createStemArchivePlan(
			`${sanitizeExportName(project.title)}-stems-${isoDate(options.date)}`,
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
		ixml: project.metadata?.ixml ?? null,
		cart: format === 'bwf' || format === 'bw64' ? project.metadata?.cart ?? null : null,
		...(bext ? { bext } : {}),
		...(adm ? {
			container: 'bw64',
			adm,
			preDataChunks: adm.preDataChunks,
			trailingChunks: adm.trailingChunks,
		} : {}),
		range,
		tailFrames,
		outputFrames,
		outputBytesPerRender: outputBytes,
		outputFileBytesPerRender: outputLayout?.byteLength ?? null,
		requiredTemporaryBytes,
		render,
		outputs,
		archive,
		aggregateStereoMinutes: aggregateStereoMinutes(project),
	};
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
			throw new Error(`ADM multichannel export cannot use stereo-only effects: ${unsafeEffects
				.map(({ effectType, scope, targetId }) => `${effectType} on ${scope}${targetId ? ` ${targetId}` : ''}`)
				.join(', ')}.`);
		}
		return Object.freeze({
			metadata,
			channelCount,
			channelOrder: admBedChannelOrder(metadata.bed.layout),
		});
	}
	const reparsedChna = validateAdmPassthroughPayload(metadata);
	return Object.freeze({
		metadata,
		channelCount,
		channelOrder: admChnaChannelOrder(reparsedChna),
	});
}

function admChnaChannelOrder(chna) {
	if (!chna) return Object.freeze([]);
	const channelOrder = Array.from({ length: chna.numTracks }, () => '');
	for (const { trackIndex, trackRef } of chna.entries) {
		if (!channelOrder[trackIndex - 1]) channelOrder[trackIndex - 1] = trackRef;
	}
	return Object.freeze(channelOrder);
}

function validateAdmPassthroughPayload(metadata) {
	if (metadata.serialPayload) {
		validateAdmSxmlPayload(decodeBase64(metadata.serialPayload.base64));
	}
	const rawChna = metadata.chna.rawBase64
		? parseChnaPayload(decodeBase64(metadata.chna.rawBase64))
		: null;
	if (rawChna && rawChna.numTracks !== metadata.geometry.channelCount) {
		throw new Error('Persisted ADM CHNA track count does not match its source geometry.');
	}
	if (Boolean(rawChna) !== (metadata.chna.entries.length > 0)) {
		throw new Error('Persisted ADM CHNA bytes and normalized entries disagree.');
	}
	if (rawChna && !sameAdmChnaEntries(rawChna.entries, metadata.chna.entries)) {
		throw new Error('Persisted ADM CHNA bytes and normalized entries disagree.');
	}
	const staticPayloads = [
		...(metadata.payload.kind === 'sxml' ? [] : [metadata.payload]),
		...(metadata.auxiliaryPayloads ?? []),
	];
	const classifiedStatic = staticPayloads.map((payload) => {
		const bytes = decodeBase64(payload.kind === 'axml' ? payload.rawBase64 : payload.base64);
		return {
			payload,
			empty: payload.kind === 'axml' && bytes.byteLength === 0,
			document: payload.kind === 'axml'
				? bytes.byteLength === 0 ? null : inspectAdmAxml(bytes)
				: inspectBxmlAdmPayload(bytes),
		};
	});
	const documentedStatic = classifiedStatic.filter(({ document }) => document);
	if (documentedStatic.length > 1) throw new Error('Persisted AXML and BXML both carry static ADM.');
	const carrier = documentedStatic[0] ?? classifiedStatic.find(({ empty }) => empty);
	if (metadata.payload.kind === 'sxml') {
		if (carrier) throw new Error('Persisted ADM payload selection disagrees with its static XML chunks.');
		validateAdmSxmlPayload(decodeBase64(metadata.payload.base64));
		return rawChna;
	}
	if (!rawChna) throw new Error('Static ADM passthrough requires CHNA metadata.');
	if (!carrier || carrier.payload !== metadata.payload) {
		throw new Error('Persisted ADM payload selection disagrees with its static XML chunks.');
	}
	if (carrier.empty) {
		validateAdmCommonDefinitionChna(rawChna, metadata.geometry.channelCount);
		return rawChna;
	}
	validateAdmChnaConsistency(carrier.document, rawChna, metadata.geometry.channelCount);
	return rawChna;
}

function sameAdmChnaEntries(rawEntries, normalizedEntries) {
	return rawEntries.length === normalizedEntries.length && rawEntries.every((raw, index) => {
		const normalized = normalizedEntries[index];
		return normalized
			&& raw.trackIndex === normalized.trackIndex
			&& equalAdmId(raw.uid, normalized.audioTrackUid)
			&& equalAdmId(raw.trackRef, normalized.audioTrackFormatIdRef)
			&& equalAdmId(raw.packRef, normalized.audioPackFormatIdRef);
	});
}

function equalAdmId(left, right) {
	return String(left).toUpperCase() === String(right).toUpperCase();
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

function createExportMarkers(project, range, outputSampleRate, requestedTrackId) {
	const tracks = project.tracks.filter((track) => track.type === 'label');
	const track = requestedTrackId == null
		? tracks[0]
		: tracks.find((candidate) => candidate.id === requestedTrackId);
	if (!track) return Object.freeze([]);
	const scale = outputSampleRate / project.sampleRate;
	return Object.freeze(track.labels.flatMap((label, index) => {
		if (label.endFrame < range.startFrame || label.startFrame >= range.endFrame) return [];
		const start = Math.max(label.startFrame, range.startFrame);
		const end = Math.min(label.endFrame, range.endFrame);
		const sampleOffset = Math.round((start - range.startFrame) * scale);
		const sampleLength = Math.max(0, Math.round((end - start) * scale));
		return [{ id: index + 1, sampleOffset, sampleLength, label: label.title, note: String(label.opaqueExtensions?.note || '') }];
	}));
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

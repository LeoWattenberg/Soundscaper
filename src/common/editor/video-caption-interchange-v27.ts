/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	VideoCaptionCueV1,
	VideoCaptionSpeakerV1,
	VideoCaptionStyleV1,
	VideoCaptionTrackV1,
} from './video-caption-track-v27.ts';
import {
	assertCaptionOutputBytes,
	captionLoss,
	decodeCaptionInput,
	frameToMilliseconds,
	freezeCaptionLosses,
	interchangeError,
	resolveCaptionInterchangeFormat,
	resolveCaptionInterchangeLimits,
	resolveCaptionSampleRate,
	timeUnitsToFrame,
	type VideoCaptionExportOptionsV1,
	type VideoCaptionExportResultV1,
	type VideoCaptionImportOptionsV1,
	type VideoCaptionImportResultV1,
	type VideoCaptionInterchangeLimitsV1,
	type VideoCaptionInterchangeLossV1,
	type VideoCaptionTrackNormalizerV1,
} from './video-caption-interchange-contract-v27.ts';
import { exportImscCaptionTrackV1, importImscCaptionTrackV1 } from './video-caption-imsc-v27.ts';

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SRT_TIMING = /^(\d+):([0-5]\d):([0-5]\d),(\d{3}) --> (\d+):([0-5]\d):([0-5]\d),(\d{3})$/u;
const VTT_TIMING = /^(?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3}) --> (?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3})(.*)$/u;
const PASSIVE_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
});

interface TimedCueSource {
	readonly identifier: string | null;
	readonly startMilliseconds: bigint;
	readonly endMilliseconds: bigint;
	readonly text: string;
	readonly align: VideoCaptionStyleV1['textAlign'] | null;
}

interface TextImportState {
	readonly options: VideoCaptionImportOptionsV1;
	readonly sampleRate: number;
	readonly limits: Readonly<VideoCaptionInterchangeLimitsV1>;
	readonly losses: VideoCaptionInterchangeLossV1[];
	readonly styles: VideoCaptionStyleV1[];
	readonly speakers: VideoCaptionSpeakerV1[];
	readonly styleIds: Map<string, string>;
	readonly speakerIds: Map<string, string>;
	readonly cueIds: Set<string>;
}

export function importCaptionInterchangeV1(
	input: unknown,
	options: VideoCaptionImportOptionsV1,
	normalize: VideoCaptionTrackNormalizerV1,
): VideoCaptionImportResultV1 {
	const format = resolveCaptionInterchangeFormat(options?.format);
	const sampleRate = resolveCaptionSampleRate(options?.sampleRate);
	const limits = resolveCaptionInterchangeLimits(options?.limits);
	const text = decodeCaptionInput(input, limits);
	if (format === 'imsc1.1') {
		return importImscCaptionTrackV1(text, { ...options, format, sampleRate }, limits, normalize);
	}
	const losses: VideoCaptionInterchangeLossV1[] = [];
	const state: TextImportState = {
		options,
		sampleRate,
		limits,
		losses,
		styles: [],
		speakers: [],
		styleIds: new Map(),
		speakerIds: new Map(),
		cueIds: new Set(),
	};
	const sources = format === 'srt' ? parseSrt(text, limits) : parseWebVtt(text, limits);
	const cues = sources.map((source, index) => materializeTextCue(source, index, format, state));
	const track = normalize({
		schemaVersion: 1,
		id: options.trackId,
		sequenceId: options.sequenceId,
		name: options.trackName,
		language: options.language,
		styles: state.styles,
		regions: [],
		speakers: state.speakers,
		cues,
	});
	return Object.freeze({ format, track, losses: freezeCaptionLosses(losses) });
}

export function exportCaptionInterchangeV1(
	track: VideoCaptionTrackV1,
	options: VideoCaptionExportOptionsV1,
): VideoCaptionExportResultV1 {
	const format = resolveCaptionInterchangeFormat(options?.format);
	const sampleRate = resolveCaptionSampleRate(options?.sampleRate);
	if (format === 'imsc1.1') return exportImscCaptionTrackV1(track, sampleRate);
	const losses: VideoCaptionInterchangeLossV1[] = [captionLoss(
		'track-metadata-omitted',
		'track.metadata',
		`${format === 'srt' ? 'SRT' : 'WebVTT'} does not carry the caption track identity, sequence binding, name, or language.`,
		{ id: track.id, sequenceId: track.sequenceId, name: track.name, language: track.language },
	)];
	reportUnreferencedDefinitions(track, format, losses);
	const blocks = track.cues.map((cue, index) => format === 'srt'
		? exportSrtCue(cue, index, sampleRate, losses)
		: exportWebVttCue(cue, track, sampleRate, losses));
	const text = format === 'srt'
		? `${blocks.join('\n\n')}${blocks.length > 0 ? '\n' : ''}`
		: `WEBVTT\n\n${blocks.join('\n\n')}${blocks.length > 0 ? '\n' : ''}`;
	assertCaptionOutputBytes(text);
	return Object.freeze({
		format,
		mediaType: format === 'srt' ? 'application/x-subrip' : 'text/vtt',
		text,
		losses: freezeCaptionLosses(losses),
	});
}

function reportUnreferencedDefinitions(
	track: VideoCaptionTrackV1,
	format: 'srt' | 'webvtt',
	losses: VideoCaptionInterchangeLossV1[],
): void {
	const styleIds = new Set(track.cues.map((cue) => cue.styleId));
	const regionIds = new Set(track.cues.map((cue) => cue.regionId));
	const speakerIds = new Set(track.cues.map((cue) => cue.speakerId));
	for (const style of track.styles) {
		if (!styleIds.has(style.id)) losses.push(captionLoss('style-omitted', `styles.${style.id}`, `${format === 'srt' ? 'SRT' : 'WebVTT'} omits an unreferenced caption style.`, { id: style.id }));
	}
	for (const region of track.regions) {
		if (!regionIds.has(region.id)) losses.push(captionLoss('region-omitted', `regions.${region.id}`, `${format === 'srt' ? 'SRT' : 'WebVTT'} omits an unreferenced caption region.`, { id: region.id }));
	}
	for (const speaker of track.speakers) {
		if (!speakerIds.has(speaker.id)) losses.push(captionLoss('speaker-omitted', `speakers.${speaker.id}`, `${format === 'srt' ? 'SRT' : 'WebVTT'} omits an unreferenced caption speaker.`, { id: speaker.id }));
	}
}

function parseSrt(text: string, limits: Readonly<VideoCaptionInterchangeLimitsV1>): TimedCueSource[] {
	const blocks = subtitleBlocks(text);
	assertCueCount(blocks.length, limits);
	return blocks.map((block, index) => {
		const lines = block.split('\n');
		let timingIndex = 0;
		if (!SRT_TIMING.test(lines[0] ?? '')) {
			if (!/^\d+$/u.test(lines[0] ?? '')) throw interchangeError(`SRT cue ${index + 1} has no numeric sequence.`, 'INVALID_CUE');
			timingIndex = 1;
		}
		const match = (lines[timingIndex] ?? '').match(SRT_TIMING);
		if (!match) throw interchangeError(`SRT cue ${index + 1} has malformed timing.`, 'INVALID_TIMING');
		const body = lines.slice(timingIndex + 1).join('\n');
		if (body.length === 0) throw interchangeError(`SRT cue ${index + 1} has no text.`, 'INVALID_CUE');
		return Object.freeze({
			identifier: null,
			startMilliseconds: clockParts(match, 1),
			endMilliseconds: clockParts(match, 5),
			text: body,
			align: null,
		});
	});
}

function parseWebVtt(text: string, limits: Readonly<VideoCaptionInterchangeLimitsV1>): TimedCueSource[] {
	const lines = text.split('\n');
	if (lines[0] !== 'WEBVTT') throw interchangeError('WebVTT input must begin with an exact WEBVTT header.', 'INVALID_HEADER');
	const blocks = subtitleBlocks(lines.slice(1).join('\n'));
	assertCueCount(blocks.length, limits);
	return blocks.map((block, index) => {
		const cueLines = block.split('\n');
		if (/^(?:NOTE|REGION|STYLE)(?:\s|$)/u.test(cueLines[0] ?? '')) {
			throw interchangeError('The maintained WebVTT subset does not accept global scriptable or styling blocks.', 'ACTIVE_CONTENT');
		}
		let identifier: string | null = null;
		let timingIndex = 0;
		if (!VTT_TIMING.test(cueLines[0] ?? '')) {
			identifier = cueLines[0] ?? null;
			timingIndex = 1;
		}
		const match = (cueLines[timingIndex] ?? '').match(VTT_TIMING);
		if (!match) throw interchangeError(`WebVTT cue ${index + 1} has malformed timing.`, 'INVALID_TIMING');
		const body = cueLines.slice(timingIndex + 1).join('\n');
		if (body.length === 0) throw interchangeError(`WebVTT cue ${index + 1} has no text.`, 'INVALID_CUE');
		return Object.freeze({
			identifier,
			startMilliseconds: vttClockParts(match, 1),
			endMilliseconds: vttClockParts(match, 5),
			text: body,
			align: parseVttSettings(match[9] ?? ''),
		});
	});
}

function materializeTextCue(
	source: TimedCueSource,
	index: number,
	format: 'srt' | 'webvtt',
	state: TextImportState,
): VideoCaptionCueV1 {
	const preferred = format === 'webvtt' ? source.identifier : null;
	const id = uniqueCueId(preferred, index, state);
	const start = timeUnitsToFrame(source.startMilliseconds, 1_000n, state.sampleRate);
	const end = timeUnitsToFrame(source.endMilliseconds, 1_000n, state.sampleRate);
	if (source.endMilliseconds <= source.startMilliseconds || end.frame <= start.frame) {
		throw interchangeError(`Caption cue ${id} must end after it starts.`, 'INVALID_TIMING');
	}
	if (!start.exact) state.losses.push(timingLoss(id, 'startFrame', source.startMilliseconds, start.frame));
	if (!end.exact) state.losses.push(timingLoss(id, 'endFrame', source.endMilliseconds, end.frame));
	const markup = format === 'webvtt' ? parseVttCueMarkup(source.text) : parseSrtCueMarkup(source.text);
	const styleId = markup.bold || markup.italic || markup.underline || source.align !== null
		? textStyleId(markup, source.align, state)
		: null;
	const speakerId = markup.speaker === null ? null : textSpeakerId(markup.speaker, state);
	return Object.freeze({
		schemaVersion: 1 as const,
		id,
		startFrame: start.frame,
		endFrame: end.frame,
		text: markup.text,
		styleId,
		regionId: null,
		speakerId,
		words: Object.freeze([]),
	});
}

function exportSrtCue(
	cue: VideoCaptionCueV1,
	index: number,
	sampleRate: number,
	losses: VideoCaptionInterchangeLossV1[],
): string {
	losses.push(captionLoss('cue-identity-omitted', `cues.${cue.id}.id`, 'SRT uses a numeric cue sequence.', { id: cue.id }));
	const timing = exportMillisecondTiming(cue, sampleRate, 'srt', losses);
	if (cue.styleId !== null) losses.push(captionLoss('style-omitted', `cues.${cue.id}.styleId`, 'SRT cannot preserve the caption style.', { id: cue.styleId }));
	if (cue.regionId !== null) losses.push(captionLoss('region-omitted', `cues.${cue.id}.regionId`, 'SRT cannot preserve the caption region.', { id: cue.regionId }));
	if (cue.speakerId !== null) losses.push(captionLoss('speaker-omitted', `cues.${cue.id}.speakerId`, 'SRT cannot preserve the caption speaker.', { id: cue.speakerId }));
	if (cue.words.length > 0) losses.push(captionLoss('word-timing-omitted', `cues.${cue.id}.words`, 'SRT cannot preserve word timing.', { count: cue.words.length }));
	// SRT is plain text with no entity syntax; cue bodies export verbatim. A
	// blank line terminates an SRT block, so blank, leading, and trailing cue
	// lines are the one unrepresentable structure — dropped and reported.
	const printable = cue.text.split('\n').filter((line) => line.trim().length > 0);
	const body = printable.length > 0 ? printable.join('\n') : ' ';
	if (body !== cue.text) {
		losses.push(captionLoss('text-lines-normalized', `cues.${cue.id}.text`, 'SRT cannot preserve leading, trailing, or blank caption lines.', {}));
	}
	return `${index + 1}\n${timing}\n${body}`;
}

function exportWebVttCue(
	cue: VideoCaptionCueV1,
	track: VideoCaptionTrackV1,
	sampleRate: number,
	losses: VideoCaptionInterchangeLossV1[],
): string {
	const style = cue.styleId === null ? null : track.styles.find((candidate) => candidate.id === cue.styleId) ?? null;
	const speaker = cue.speakerId === null ? null : track.speakers.find((candidate) => candidate.id === cue.speakerId) ?? null;
	const settings = style === null ? '' : ` align:${style.textAlign}`;
	const timing = exportMillisecondTiming(cue, sampleRate, 'webvtt', losses) + settings;
	let body = escapePassiveText(cue.text);
	if (style !== null) {
		losses.push(captionLoss('style-properties-omitted', `cues.${cue.id}.styleId`, 'WebVTT preserves emphasis and alignment but not the complete caption style.', { id: style.id }));
		if (style.textDecoration === 'underline') body = `<u>${body}</u>`;
		if (style.fontStyle === 'italic') body = `<i>${body}</i>`;
		if (style.fontWeight === 'bold') body = `<b>${body}</b>`;
	}
	if (cue.regionId !== null) losses.push(captionLoss('region-omitted', `cues.${cue.id}.regionId`, 'The maintained WebVTT subset does not approximate safe-area regions.', { id: cue.regionId }));
	if (speaker !== null && !/[\r\n]/u.test(speaker.name)) {
		losses.push(captionLoss('speaker-identity-omitted', `cues.${cue.id}.speakerId`, 'WebVTT voice spans preserve the speaker name but not its stable identity.', { id: speaker.id }));
		body = `<v ${escapePassiveText(speaker.name)}>${body}`;
	} else if (speaker !== null) {
		losses.push(captionLoss('speaker-omitted', `cues.${cue.id}.speakerId`, 'WebVTT voice annotations cannot preserve a multi-line speaker name.', { id: speaker.id }));
	}
	if (cue.words.length > 0) losses.push(captionLoss('word-timing-omitted', `cues.${cue.id}.words`, 'WebVTT cannot preserve exact sample-frame word timing.', { count: cue.words.length }));
	return `${cue.id}\n${timing}\n${body}`;
}

function exportMillisecondTiming(
	cue: VideoCaptionCueV1,
	sampleRate: number,
	format: 'srt' | 'webvtt',
	losses: VideoCaptionInterchangeLossV1[],
): string {
	const start = frameToMilliseconds(cue.startFrame, sampleRate);
	const end = frameToMilliseconds(cue.endFrame, sampleRate);
	let endMilliseconds = end.milliseconds;
	if (endMilliseconds <= start.milliseconds) endMilliseconds = start.milliseconds + 1;
	if (!start.exact) losses.push(exportTimingLoss(cue, 'startFrame', start.milliseconds));
	if (!end.exact || endMilliseconds !== end.milliseconds) losses.push(exportTimingLoss(cue, 'endFrame', endMilliseconds));
	return `${formatMilliseconds(start.milliseconds, format)} --> ${formatMilliseconds(endMilliseconds, format)}`;
}

/**
 * SRT cue bodies are plain text: there is no entity syntax, so ampersands
 * stay literal. The one styling shape the strict subset accepts is a
 * whole-body b/i/u wrapper — common in real-world files — which maps to a
 * caption style exactly as the WebVTT importer maps it; any remaining markup
 * refuses rather than rendering as caption text.
 */
function parseSrtCueMarkup(value: string): {
	text: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	speaker: string | null;
} {
	let content = value;
	let bold = false;
	let italic = false;
	let underline = false;
	for (;;) {
		const tag = content.match(/^<(b|i|u)>/u)?.[1];
		if (!tag || !content.endsWith(`</${tag}>`)) break;
		if (tag === 'b') bold = true;
		if (tag === 'i') italic = true;
		if (tag === 'u') underline = true;
		content = content.slice(3, -(tag.length + 3));
	}
	// Anything tag-shaped — an angle bracket opening a letter tag — stays
	// outside the passive subset; a bare angle bracket is literal text.
	if (/<\/?[a-z]/iu.test(content)) {
		throw interchangeError('Caption cue markup is outside the passive maintained subset.', 'ACTIVE_CONTENT');
	}
	return { text: content, bold, italic, underline, speaker: null };
}

function parseVttCueMarkup(value: string): {
	text: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	speaker: string | null;
} {
	let content = value;
	let speaker: string | null = null;
	const voice = content.match(/^<v ([^<>]+)>/u);
	if (voice) {
		speaker = decodePassiveText(voice[1] ?? '');
		content = content.slice(voice[0].length);
	}
	let bold = false;
	let italic = false;
	let underline = false;
	for (;;) {
		const tag = content.match(/^<(b|i|u)>/u)?.[1];
		if (!tag || !content.endsWith(`</${tag}>`)) break;
		if (tag === 'b') bold = true;
		if (tag === 'i') italic = true;
		if (tag === 'u') underline = true;
		content = content.slice(3, -(tag.length + 3));
	}
	return { text: decodePassiveText(content), bold, italic, underline, speaker };
}

function textStyleId(
	markup: { bold: boolean; italic: boolean; underline: boolean },
	align: VideoCaptionStyleV1['textAlign'] | null,
	state: TextImportState,
): string {
	const signature = `${Number(markup.bold)}${Number(markup.italic)}${Number(markup.underline)}:${align ?? 'center'}`;
	const existing = state.styleIds.get(signature);
	if (existing) return existing;
	const id = `style-${state.styles.length + 1}`;
	state.styleIds.set(signature, id);
	state.styles.push(Object.freeze({
		schemaVersion: 1,
		id,
		fontFamily: 'soundscaper-sans',
		fontSizePercent: 5,
		foregroundColor: '#ffffffff',
		backgroundColor: '#000000cc',
		fontWeight: markup.bold ? 'bold' : 'normal',
		fontStyle: markup.italic ? 'italic' : 'normal',
		textDecoration: markup.underline ? 'underline' : 'none',
		textAlign: align ?? 'center',
	}));
	state.losses.push(captionLoss('style-properties-defaulted', `styles.${id}`, 'The source carries only WebVTT emphasis/alignment; remaining style properties use bounded defaults.'));
	return id;
}

function textSpeakerId(name: string, state: TextImportState): string {
	const existing = state.speakerIds.get(name);
	if (existing) return existing;
	const id = `speaker-${state.speakers.length + 1}`;
	state.speakerIds.set(name, id);
	state.speakers.push(Object.freeze({ schemaVersion: 1, id, name }));
	return id;
}

function uniqueCueId(preferred: string | null, index: number, state: TextImportState): string {
	if (preferred !== null && STABLE_ID.test(preferred) && !state.cueIds.has(preferred)) {
		state.cueIds.add(preferred);
		return preferred;
	}
	let suffix = index + 1;
	while (state.cueIds.has(`cue-${suffix}`)) suffix += 1;
	const id = `cue-${suffix}`;
	state.cueIds.add(id);
	if (preferred !== null) state.losses.push(captionLoss('cue-identity-normalized', `cues.${index}.id`, 'A WebVTT cue identifier was not a unique stable ID.', { source: preferred, id }));
	return id;
}

function parseVttSettings(value: string): VideoCaptionStyleV1['textAlign'] | null {
	const tokens = value.trim() === '' ? [] : value.trim().split(/[ \t]+/u);
	let align: VideoCaptionStyleV1['textAlign'] | null = null;
	for (const token of tokens) {
		const match = token.match(/^align:(start|center|end)$/u);
		if (!match || align !== null) throw interchangeError(`Unsupported WebVTT cue setting: ${token}.`, 'UNSUPPORTED_CONSTRUCT');
		align = match[1] as VideoCaptionStyleV1['textAlign'];
	}
	return align;
}

function subtitleBlocks(text: string): string[] {
	const trimmed = text.replace(/^\n+/u, '').replace(/\n+$/u, '');
	return trimmed === '' ? [] : trimmed.split(/\n{2,}/u);
}

function assertCueCount(count: number, limits: Readonly<VideoCaptionInterchangeLimitsV1>): void {
	if (count > limits.maximumCues) throw interchangeError('Caption sidecar exceeds its cue-count limit.', 'CUE_LIMIT', { maximum: limits.maximumCues, observed: count });
}

function clockParts(match: RegExpMatchArray, offset: number): bigint {
	return ((BigInt(match[offset] ?? 0) * 60n + BigInt(match[offset + 1] ?? 0)) * 60n
		+ BigInt(match[offset + 2] ?? 0)) * 1_000n + BigInt(match[offset + 3] ?? 0);
}

function vttClockParts(match: RegExpMatchArray, offset: number): bigint {
	return ((BigInt(match[offset] || 0) * 60n + BigInt(match[offset + 1] ?? 0)) * 60n
		+ BigInt(match[offset + 2] ?? 0)) * 1_000n + BigInt(match[offset + 3] ?? 0);
}

function formatMilliseconds(value: number, format: 'srt' | 'webvtt'): string {
	const milliseconds = value % 1_000;
	const totalSeconds = Math.floor(value / 1_000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	const separator = format === 'srt' ? ',' : '.';
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(milliseconds).padStart(3, '0')}`;
}

function timingLoss(id: string, field: 'startFrame' | 'endFrame', milliseconds: bigint, frame: number): VideoCaptionInterchangeLossV1 {
	return captionLoss('timing-quantized', `cues.${id}.${field}`, 'The sidecar millisecond is not an exact sample-frame boundary.', { milliseconds: milliseconds.toString(), frame });
}

function exportTimingLoss(cue: VideoCaptionCueV1, field: 'startFrame' | 'endFrame', milliseconds: number): VideoCaptionInterchangeLossV1 {
	return captionLoss('timing-quantized', `cues.${cue.id}.${field}`, 'The sample frame is not exactly representable by the sidecar millisecond clock.', { frame: cue[field], milliseconds });
}

function escapePassiveText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '&#10;');
}

function decodePassiveText(value: string): string {
	if (/[<>]/u.test(value)) throw interchangeError('Caption cue markup is outside the passive maintained subset.', 'ACTIVE_CONTENT');
	let invalid = false;
	const decoded = value.replace(/&(?:#(\d+)|#x([a-f0-9]+)|(amp|lt|gt|quot|apos));/giu, (_entity, decimal: string, hexadecimal: string, named: string) => {
		if (decimal) return passiveCodePoint(decimal, 10);
		if (hexadecimal) return passiveCodePoint(hexadecimal, 16);
		return PASSIVE_ENTITIES[named.toLowerCase()] ?? '';
	});
	if (/&(?:#|[A-Za-z])/u.test(decoded)) invalid = true;
	if (invalid) throw interchangeError('Caption cue contains an unsupported entity.', 'ACTIVE_CONTENT');
	return decoded;
}

function passiveCodePoint(value: string, radix: number): string {
	const codePoint = Number.parseInt(value, radix);
	if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff
		|| (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
		throw interchangeError('Caption cue contains an invalid numeric entity.', 'ACTIVE_CONTENT');
	}
	return String.fromCodePoint(codePoint);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit, inert caption state for Framescaper V27. */

import { compareCodeUnits } from './code-unit-order.ts';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	exportCaptionInterchangeV1,
	importCaptionInterchangeV1,
} from './video-caption-interchange-v27.ts';
import type {
	VideoCaptionExportOptionsV1,
	VideoCaptionExportResultV1,
	VideoCaptionImportOptionsV1,
	VideoCaptionImportResultV1,
} from './video-caption-interchange-contract-v27.ts';

export {
	VIDEO_CAPTION_INTERCHANGE_FORMATS_V1,
	VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1,
	VideoCaptionInterchangeError,
} from './video-caption-interchange-contract-v27.ts';
export type {
	VideoCaptionExportOptionsV1,
	VideoCaptionExportResultV1,
	VideoCaptionImportOptionsV1,
	VideoCaptionImportResultV1,
	VideoCaptionInterchangeFormatV1,
	VideoCaptionInterchangeLimitsV1,
	VideoCaptionInterchangeLossCodeV1,
	VideoCaptionInterchangeLossV1,
} from './video-caption-interchange-contract-v27.ts';

export const VIDEO_CAPTION_TRACK_LIMITS_V1 = Object.freeze({
	maximumStyles: 256,
	maximumRegions: 256,
	maximumSpeakers: 1_024,
	maximumCues: 100_000,
	maximumWordsPerCue: 512,
	maximumTextLength: 16_384,
});

export interface VideoCaptionStyleV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly fontFamily: 'soundscaper-sans' | 'soundscaper-serif' | 'soundscaper-mono';
	readonly fontSizePercent: number;
	readonly foregroundColor: string;
	readonly backgroundColor: string;
	readonly fontWeight: 'normal' | 'bold';
	readonly fontStyle: 'normal' | 'italic';
	readonly textDecoration: 'none' | 'underline';
	readonly textAlign: 'start' | 'center' | 'end';
}

export interface VideoCaptionRegionV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly xPercent: number;
	readonly yPercent: number;
	readonly widthPercent: number;
	readonly heightPercent: number;
	readonly displayAlign: 'before' | 'center' | 'after';
}

export interface VideoCaptionSpeakerV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly name: string;
}

export interface VideoCaptionWordV1 {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly text: string;
}

export interface VideoCaptionCueV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly text: string;
	readonly styleId: string | null;
	readonly regionId: string | null;
	readonly speakerId: string | null;
	readonly words: readonly VideoCaptionWordV1[];
}

export interface VideoCaptionTrackV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly sequenceId: string;
	readonly name: string;
	readonly language: string;
	readonly styles: readonly VideoCaptionStyleV1[];
	readonly regions: readonly VideoCaptionRegionV1[];
	readonly speakers: readonly VideoCaptionSpeakerV1[];
	readonly cues: readonly VideoCaptionCueV1[];
}

const TRACK_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'sequenceId', 'name', 'language', 'styles', 'regions', 'speakers', 'cues',
]);
const STYLE_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'fontFamily', 'fontSizePercent', 'foregroundColor',
	'backgroundColor', 'fontWeight', 'fontStyle', 'textDecoration', 'textAlign',
]);
const REGION_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'xPercent', 'yPercent', 'widthPercent', 'heightPercent',
	'displayAlign',
]);
const SPEAKER_FIELDS = Object.freeze(['schemaVersion', 'id', 'name']);
const CUE_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'startFrame', 'endFrame', 'text', 'styleId', 'regionId',
	'speakerId', 'words',
]);
const WORD_FIELDS = Object.freeze(['startFrame', 'endFrame', 'text']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,8}$/u;
const COLOR = /^#[a-f0-9]{8}$/u;
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeVideoCaptionTrackV1(value: unknown): VideoCaptionTrackV1 {
	const name = 'video caption track';
	const record = readClosedDomainRecord(value, name, TRACK_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	const styles = collection(
		field(record, 'styles', name), 'caption styles', VIDEO_CAPTION_TRACK_LIMITS_V1.maximumStyles,
		normalizeStyle,
	);
	const regions = collection(
		field(record, 'regions', name), 'caption regions', VIDEO_CAPTION_TRACK_LIMITS_V1.maximumRegions,
		normalizeRegion,
	);
	const speakers = collection(
		field(record, 'speakers', name), 'caption speakers', VIDEO_CAPTION_TRACK_LIMITS_V1.maximumSpeakers,
		normalizeSpeaker,
	);
	const cues = collection(
		field(record, 'cues', name), 'caption cues', VIDEO_CAPTION_TRACK_LIMITS_V1.maximumCues,
		normalizeCue,
	).sort((left, right) => left.startFrame - right.startFrame
		|| left.endFrame - right.endFrame || compareCodeUnits(left.id, right.id));
	assertReferences(cues, styles, regions, speakers);
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'caption track ID'),
		sequenceId: stableId(field(record, 'sequenceId', name), 'caption track sequence ID'),
		name: safeText(field(record, 'name', name), 'caption track name', 512, false),
		language: language(field(record, 'language', name)),
		styles: Object.freeze(styles),
		regions: Object.freeze(regions),
		speakers: Object.freeze(speakers),
		cues: Object.freeze(cues),
	});
}

export function importVideoCaptionTrackV1(
	input: unknown,
	options: VideoCaptionImportOptionsV1,
): VideoCaptionImportResultV1 {
	return importCaptionInterchangeV1(input, options, normalizeVideoCaptionTrackV1);
}

/** Serialize a caption sidecar only; V27 intentionally exposes no burn-in or mux adapter. */
export function exportVideoCaptionTrackV1(
	value: unknown,
	options: VideoCaptionExportOptionsV1,
): VideoCaptionExportResultV1 {
	return exportCaptionInterchangeV1(normalizeVideoCaptionTrackV1(value), options);
}

function normalizeStyle(value: unknown): VideoCaptionStyleV1 {
	const name = 'video caption style';
	const record = readClosedDomainRecord(value, name, STYLE_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'caption style ID'),
		fontFamily: oneOf(field(record, 'fontFamily', name), [
			'soundscaper-sans', 'soundscaper-serif', 'soundscaper-mono',
		] as const, 'caption font family'),
		fontSizePercent: bounded(field(record, 'fontSizePercent', name), 0.5, 20, 'caption font size'),
		foregroundColor: color(field(record, 'foregroundColor', name), 'caption foreground color'),
		backgroundColor: color(field(record, 'backgroundColor', name), 'caption background color'),
		fontWeight: oneOf(field(record, 'fontWeight', name), ['normal', 'bold'] as const, 'caption font weight'),
		fontStyle: oneOf(field(record, 'fontStyle', name), ['normal', 'italic'] as const, 'caption font style'),
		textDecoration: oneOf(field(record, 'textDecoration', name), ['none', 'underline'] as const, 'caption text decoration'),
		textAlign: oneOf(field(record, 'textAlign', name), ['start', 'center', 'end'] as const, 'caption text alignment'),
	});
}

function normalizeRegion(value: unknown): VideoCaptionRegionV1 {
	const name = 'video caption region';
	const record = readClosedDomainRecord(value, name, REGION_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	const xPercent = bounded(field(record, 'xPercent', name), 0, 100, 'caption region x');
	const yPercent = bounded(field(record, 'yPercent', name), 0, 100, 'caption region y');
	const widthPercent = bounded(field(record, 'widthPercent', name), 0.1, 100, 'caption region width');
	const heightPercent = bounded(field(record, 'heightPercent', name), 0.1, 100, 'caption region height');
	if (xPercent + widthPercent > 100 || yPercent + heightPercent > 100) {
		throw new RangeError('The caption region must fit within the safe-area-relative canvas.');
	}
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'caption region ID'),
		xPercent,
		yPercent,
		widthPercent,
		heightPercent,
		displayAlign: oneOf(field(record, 'displayAlign', name), ['before', 'center', 'after'] as const, 'caption region display alignment'),
	});
}

function normalizeSpeaker(value: unknown): VideoCaptionSpeakerV1 {
	const name = 'video caption speaker';
	const record = readClosedDomainRecord(value, name, SPEAKER_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'caption speaker ID'),
		name: safeText(field(record, 'name', name), 'caption speaker name', 512, false),
	});
}

function normalizeCue(value: unknown): VideoCaptionCueV1 {
	const name = 'video caption cue';
	const record = readClosedDomainRecord(value, name, CUE_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	const startFrame = frame(field(record, 'startFrame', name), 'caption cue start frame');
	const endFrame = frame(field(record, 'endFrame', name), 'caption cue end frame');
	if (endFrame <= startFrame) throw new RangeError('Caption cue timing must end after it starts.');
	const words = collection(
		field(record, 'words', name), 'caption cue words',
		VIDEO_CAPTION_TRACK_LIMITS_V1.maximumWordsPerCue,
		normalizeWord,
	).sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	let previousEnd = startFrame;
	for (const word of words) {
		if (word.startFrame < startFrame || word.endFrame > endFrame || word.startFrame < previousEnd) {
			throw new RangeError('Every caption word must be ordered and within its cue timing.');
		}
		previousEnd = word.endFrame;
	}
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'caption cue ID'),
		startFrame,
		endFrame,
		text: safeText(field(record, 'text', name), 'caption cue text', VIDEO_CAPTION_TRACK_LIMITS_V1.maximumTextLength, false),
		styleId: optionalId(field(record, 'styleId', name), 'caption cue style ID'),
		regionId: optionalId(field(record, 'regionId', name), 'caption cue region ID'),
		speakerId: optionalId(field(record, 'speakerId', name), 'caption cue speaker ID'),
		words: Object.freeze(words),
	});
}

function normalizeWord(value: unknown): VideoCaptionWordV1 {
	const name = 'video caption word';
	const record = readClosedDomainRecord(value, name, WORD_FIELDS);
	const startFrame = frame(field(record, 'startFrame', name), 'caption word start frame');
	const endFrame = frame(field(record, 'endFrame', name), 'caption word end frame');
	if (endFrame <= startFrame) throw new RangeError('Caption word timing must end after it starts.');
	return Object.freeze({
		startFrame,
		endFrame,
		text: safeText(field(record, 'text', name), 'caption word text', 512, false),
	});
}

function assertReferences(
	cues: readonly VideoCaptionCueV1[],
	styles: readonly VideoCaptionStyleV1[],
	regions: readonly VideoCaptionRegionV1[],
	speakers: readonly VideoCaptionSpeakerV1[],
): void {
	const styleIds = new Set(styles.map((style) => style.id));
	const regionIds = new Set(regions.map((region) => region.id));
	const speakerIds = new Set(speakers.map((speaker) => speaker.id));
	for (const cue of cues) {
		if (cue.styleId !== null && !styleIds.has(cue.styleId)) {
			throw new ReferenceError(`Caption cue ${cue.id} references unknown style ${cue.styleId}.`);
		}
		if (cue.regionId !== null && !regionIds.has(cue.regionId)) {
			throw new ReferenceError(`Caption cue ${cue.id} references unknown region ${cue.regionId}.`);
		}
		if (cue.speakerId !== null && !speakerIds.has(cue.speakerId)) {
			throw new ReferenceError(`Caption cue ${cue.id} references unknown speaker ${cue.speakerId}.`);
		}
	}
}

function collection<Item extends Readonly<object>>(
	value: unknown,
	name: string,
	maximum: number,
	normalize: (value: unknown) => Item,
): Item[] {
	const array = readClosedDomainArray(value, name, 0, maximum);
	const identities = new Set<string>();
	return array.map((item) => {
		const result = normalize(item);
		const identity = 'id' in result ? result.id : undefined;
		if (typeof identity === 'string') {
			if (identities.has(identity)) throw new RangeError(`${name} identity ${identity} is duplicated.`);
			identities.add(identity);
		}
		return result;
	});
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function exact<const Value extends string | number>(value: unknown, expected: Value, name: string): Value {
	if (value !== expected) throw new RangeError(`${name} is unsupported.`);
	return expected;
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, name: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${name} is unsupported.`);
	return value as Values[number];
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function optionalId(value: unknown, name: string): string | null {
	return value === null ? null : stableId(value, name);
}

function language(value: unknown): string {
	if (typeof value !== 'string' || !LANGUAGE.test(value)) {
		throw new TypeError('Caption track language must be a bounded BCP 47 language tag.');
	}
	return value;
}

function color(value: unknown, name: string): string {
	if (typeof value !== 'string' || !COLOR.test(value)) throw new TypeError(`${name} must be #rrggbbaa.`);
	return value;
}

function frame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite bound.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function safeText(value: unknown, name: string, maximum: number, empty: boolean): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be text.`);
	const normalized = value.replace(/\r\n?/gu, '\n');
	if ((!empty && normalized.length === 0) || normalized.length > maximum
		|| UNSAFE_TEXT.test(normalized) || !isWellFormedText(normalized)) {
		throw new RangeError(`${name} is empty, unsafe, or outside its bound.`);
	}
	return normalized;
}

function isWellFormedText(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
	}
	return true;
}

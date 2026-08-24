/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed successful-control schemas emitted by the Framescaper media host. */

import {
	normalizeVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import type { NativeMediaHelperPoolJobKind } from './native-media-helper-pool.ts';

interface NativeMediaHostOutputControl {
	readonly contractVersion: 1;
	readonly operation: 'media-decode' | 'media-encode' | 'media-render' | 'media-proxy';
	readonly byteLength: number;
	readonly sha256: string;
}

export interface NativeMediaHostProbeControl {
	readonly contractVersion: 1;
	readonly operation: 'probe-video-source';
	readonly format: string;
	readonly durationTimeBase: number;
	readonly videoStreams: number;
	readonly audioStreams: number;
	readonly width: number;
	readonly height: number;
	readonly characteristics: VideoSourceCharacteristicsV25;
}

export interface NativeMediaHostDecodeControl extends NativeMediaHostOutputControl {
	readonly operation: 'media-decode';
	readonly framePack: 'framescaper-rgba-frame-pack-v1';
	readonly frameCount: number;
	readonly width: number;
	readonly height: number;
	readonly sourcePackVersion?: 1;
	readonly profile?: 'decode-png-sequence' | 'decode-tiff-sequence' | 'decode-openexr-sequence';
	readonly exportAuthority?: 'image-sequence-source-pack';
}

export interface NativeMediaHostEncodeControl extends NativeMediaHostOutputControl {
	readonly operation: 'media-encode';
}

export interface NativeMediaHostRenderControl extends NativeMediaHostOutputControl {
	readonly operation: 'media-render';
}

export interface NativeMediaHostSequenceControl {
	readonly contractVersion: 1;
	readonly operation: 'media-encode' | 'media-render';
	readonly profileId: 'encode-png-sequence' | 'encode-tiff-sequence' | 'encode-openexr-sequence';
	readonly frameCount: number;
	readonly byteLength: number;
	readonly manifestSha256: string;
	readonly publication: 'temporary-directory';
}

export interface NativeMediaHostProxyControl extends NativeMediaHostOutputControl {
	readonly operation: 'media-proxy';
	readonly container: 'mov';
	readonly codec: 'prores_ks';
	readonly profile: 'proxy';
	readonly width: number;
	readonly height: number;
	readonly exportAuthority: 'original';
}

export type NativeMediaHostControl =
	| NativeMediaHostProbeControl
	| NativeMediaHostDecodeControl
	| NativeMediaHostEncodeControl
	| NativeMediaHostRenderControl
	| NativeMediaHostSequenceControl
	| NativeMediaHostProxyControl;

const PROBE_KEYS = Object.freeze([
	'contractVersion', 'operation', 'format', 'durationTimeBase',
	'videoStreams', 'audioStreams', 'width', 'height', 'characteristics',
]);
const DECODE_KEYS = Object.freeze([
	'contractVersion', 'operation', 'framePack', 'frameCount',
	'width', 'height', 'byteLength', 'sha256',
]);
const IMAGE_SEQUENCE_DECODE_KEYS = Object.freeze([
	...DECODE_KEYS, 'sourcePackVersion', 'profile', 'exportAuthority',
]);
const OUTPUT_KEYS = Object.freeze(['contractVersion', 'operation', 'byteLength', 'sha256']);
const SEQUENCE_KEYS = Object.freeze([
	'contractVersion', 'operation', 'profileId', 'frameCount',
	'byteLength', 'manifestSha256', 'publication',
]);
const PROXY_KEYS = Object.freeze([
	'contractVersion', 'operation', 'container', 'codec', 'profile',
	'width', 'height', 'exportAuthority', 'byteLength', 'sha256',
]);
const CHARACTERISTIC_KEYS = Object.freeze([
	'backend', 'codedWidth', 'codedHeight', 'rotationDegrees', 'pixelAspectRatio', 'fieldOrder',
	'hasAlpha', 'videoCodec', 'colour', 'audioStreams', 'extractedAudioStreamIndex', 'startTimecode',
	'bitDepth', 'pixelFormat', 'chromaFormat', 'alphaMode', 'alphaInterpretation',
]);
const COLOUR_KEYS = Object.freeze([
	'primaries', 'transfer', 'matrix', 'range', 'masteringDisplay', 'contentLight',
]);
const AUDIO_STREAM_KEYS = Object.freeze(['index', 'codec', 'channelCount', 'sampleRate', 'language']);
const MASTERING_KEYS = Object.freeze([
	'redPrimary', 'greenPrimary', 'bluePrimary', 'whitePoint', 'minimumLuminance', 'maximumLuminance',
]);
const START_TIMECODE_KEYS = Object.freeze(['negative', 'hours', 'minutes', 'seconds', 'frames', 'dropFrame']);
const SHA256 = /^[a-f\d]{64}$/u;

export function parseNativeMediaHostControl(
	kind: NativeMediaHelperPoolJobKind,
	stdout: string,
): NativeMediaHostControl {
	const record = parsedRecord(stdout);
	if (kind === 'probe-video-source') return probe(record);
	if (kind === 'media-decode') return decode(record);
	if (kind === 'media-proxy') return proxy(record);
	return record.publication === 'temporary-directory' ? sequence(record, kind) : output(record, kind);
}

function sequence(
	record: Record<string, unknown>,
	kind: 'media-encode' | 'media-render',
): NativeMediaHostSequenceControl {
	exactKeys(record, SEQUENCE_KEYS);
	common(record, kind);
	if (!['encode-png-sequence', 'encode-tiff-sequence', 'encode-openexr-sequence']
		.includes(String(record.profileId)) || record.publication !== 'temporary-directory') invalid();
	return Object.freeze({
		contractVersion: 1, operation: kind,
		profileId: record.profileId as NativeMediaHostSequenceControl['profileId'],
		frameCount: positiveInteger(record.frameCount), byteLength: positiveInteger(record.byteLength),
		manifestSha256: digest(record.manifestSha256), publication: 'temporary-directory',
	});
}

function probe(record: Record<string, unknown>): NativeMediaHostProbeControl {
	exactKeys(record, PROBE_KEYS);
	common(record, 'probe-video-source');
	if (typeof record.format !== 'string' || record.format.length === 0
		|| new TextEncoder().encode(record.format).byteLength > 1_024) invalid();
	assertExactProfessionalCharacteristics(record.characteristics);
	let characteristics: VideoSourceCharacteristicsV25;
	try { characteristics = normalizeVideoSourceCharacteristicsV25(record.characteristics); }
	catch { return invalid(); }
	const videoStreams = nonNegativeInteger(record.videoStreams);
	const audioStreams = nonNegativeInteger(record.audioStreams);
	const width = positiveInteger(record.width);
	const height = positiveInteger(record.height);
	if (videoStreams === 0
		|| (characteristics.codedWidth !== null && characteristics.codedWidth !== width)
		|| (characteristics.codedHeight !== null && characteristics.codedHeight !== height)
		|| (characteristics.audioStreams !== null
			&& characteristics.audioStreams.length !== audioStreams)) invalid();
	return Object.freeze({
		contractVersion: 1, operation: 'probe-video-source', format: record.format,
		durationTimeBase: safeInteger(record.durationTimeBase),
		videoStreams, audioStreams, width, height,
		characteristics,
	});
}

function assertExactProfessionalCharacteristics(value: unknown): void {
	const characteristics = nestedRecord(value);
	exactKeys(characteristics, CHARACTERISTIC_KEYS);
	optionalExactRecord(characteristics.pixelAspectRatio, ['num', 'den']);
	const colour = nestedRecord(characteristics.colour);
	exactKeys(colour, COLOUR_KEYS);
	if (colour.masteringDisplay !== null) {
		const mastering = nestedRecord(colour.masteringDisplay);
		exactKeys(mastering, MASTERING_KEYS);
		for (const key of ['redPrimary', 'greenPrimary', 'bluePrimary', 'whitePoint']) {
			const chromaticity = nestedRecord(mastering[key]);
			exactKeys(chromaticity, ['x', 'y']);
			optionalExactRecord(chromaticity.x, ['num', 'den'], false);
			optionalExactRecord(chromaticity.y, ['num', 'den'], false);
		}
		optionalExactRecord(mastering.minimumLuminance, ['num', 'den'], false);
		optionalExactRecord(mastering.maximumLuminance, ['num', 'den'], false);
	}
	optionalExactRecord(colour.contentLight, [
		'maximumContentLightLevel', 'maximumFrameAverageLightLevel',
	]);
	if (characteristics.audioStreams !== null) {
		if (!Array.isArray(characteristics.audioStreams)) invalid();
		for (const stream of characteristics.audioStreams) exactKeys(nestedRecord(stream), AUDIO_STREAM_KEYS);
	}
	optionalExactRecord(characteristics.startTimecode, START_TIMECODE_KEYS);
}

function optionalExactRecord(
	value: unknown,
	keys: readonly string[],
	optional = true,
): void {
	if (optional && value === null) return;
	exactKeys(nestedRecord(value), keys);
}

function nestedRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) invalid();
	return value as Record<string, unknown>;
}

function decode(record: Record<string, unknown>): NativeMediaHostDecodeControl {
	const imageSequence = Object.hasOwn(record, 'sourcePackVersion');
	exactKeys(record, imageSequence ? IMAGE_SEQUENCE_DECODE_KEYS : DECODE_KEYS);
	common(record, 'media-decode');
	if (record.framePack !== 'framescaper-rgba-frame-pack-v1') invalid();
	if (imageSequence && (record.sourcePackVersion !== 1
		|| !['decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence']
			.includes(String(record.profile))
		|| record.exportAuthority !== 'image-sequence-source-pack')) invalid();
	return Object.freeze({
		contractVersion: 1, operation: 'media-decode', framePack: record.framePack,
		frameCount: nonNegativeInteger(record.frameCount),
		width: positiveInteger(record.width), height: positiveInteger(record.height),
		byteLength: nonNegativeInteger(record.byteLength), sha256: digest(record.sha256),
		...(imageSequence ? {
			sourcePackVersion: 1 as const,
			profile: record.profile as NonNullable<NativeMediaHostDecodeControl['profile']>,
			exportAuthority: 'image-sequence-source-pack' as const,
		} : {}),
	});
}

function output(
	record: Record<string, unknown>,
	kind: 'media-encode' | 'media-render',
): NativeMediaHostEncodeControl | NativeMediaHostRenderControl {
	exactKeys(record, OUTPUT_KEYS);
	common(record, kind);
	return Object.freeze({
		contractVersion: 1, operation: kind,
		byteLength: nonNegativeInteger(record.byteLength), sha256: digest(record.sha256),
	});
}

function proxy(record: Record<string, unknown>): NativeMediaHostProxyControl {
	exactKeys(record, PROXY_KEYS);
	common(record, 'media-proxy');
	if (record.container !== 'mov' || record.codec !== 'prores_ks'
		|| record.profile !== 'proxy' || record.exportAuthority !== 'original') invalid();
	return Object.freeze({
		contractVersion: 1, operation: 'media-proxy', container: 'mov',
		codec: 'prores_ks', profile: 'proxy', exportAuthority: 'original',
		width: positiveInteger(record.width), height: positiveInteger(record.height),
		byteLength: nonNegativeInteger(record.byteLength), sha256: digest(record.sha256),
	});
}

function parsedRecord(stdout: string): Record<string, unknown> {
	let parsed: unknown;
	try { parsed = JSON.parse(stdout) as unknown; }
	catch { return invalid(); }
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || ArrayBuffer.isView(parsed)) {
		return invalid();
	}
	return parsed as Record<string, unknown>;
}

function common(record: Record<string, unknown>, operation: NativeMediaHelperPoolJobKind): void {
	if (record.contractVersion !== 1 || record.operation !== operation) invalid();
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
	const keys = Object.keys(record);
	if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) invalid();
}

function safeInteger(value: unknown): number {
	if (!Number.isSafeInteger(value)) return invalid();
	return Number(value);
}

function nonNegativeInteger(value: unknown): number {
	const admitted = safeInteger(value);
	if (admitted < 0) return invalid();
	return admitted;
}

function positiveInteger(value: unknown): number {
	const admitted = nonNegativeInteger(value);
	if (admitted === 0) return invalid();
	return admitted;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) return invalid();
	return value;
}

function invalid(): never {
	throw new Error('The native media host returned a malformed or non-canonical control result.');
}

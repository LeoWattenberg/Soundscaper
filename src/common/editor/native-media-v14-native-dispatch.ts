/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Closed FFmpeg 9.0.1 dispatch owned by the selected V14 native media tier.
 *
 * Inventory rows are deliberately separate from runtime dispatch. A profile is
 * executable only when it has one row here, its policy rows are cleared, and
 * the authenticated payload self-test finds the exact named components. A
 * hardware row always names a hardware encoder; absence returns `null` and
 * lets the caller perform its one identical native-CPU retry.
 */

import type {
	NativeMediaHardwareBackend,
	NativeMediaPlatform,
} from './native-media-backend-policy.ts';
import {
	NATIVE_MEDIA_V14_VIDEO_DECODE_PROFILE_IDS,
	NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS,
} from './native-media-v14-support.ts';

export type NativeMediaV14DecodeProfileId =
	(typeof NATIVE_MEDIA_V14_VIDEO_DECODE_PROFILE_IDS)[number];
export type NativeMediaV14EncodeProfileId =
	(typeof NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS)[number];
export type NativeMediaV14ProfileId = NativeMediaV14DecodeProfileId | NativeMediaV14EncodeProfileId;

export interface NativeMediaV14DecodeDispatchV1 {
	readonly id: NativeMediaV14DecodeProfileId;
	readonly operation: 'decode';
	readonly decoder: string;
	readonly parsers: readonly string[];
	readonly demuxers: readonly string[];
	readonly imageSequence: boolean;
}

export interface NativeMediaV14EncodeDispatchV1 {
	readonly id: NativeMediaV14EncodeProfileId;
	readonly operation: 'encode';
	readonly muxer: string;
	readonly encoder: string;
	readonly pixelFormat: string;
	readonly codecProfile: string | null;
	readonly audioEncoder: 'aac' | 'libopus' | 'pcm_s16le' | 'flac' | null;
	readonly preservesHdrMetadata: boolean;
	readonly supportsAlpha: boolean;
	readonly imageSequence: boolean;
	readonly atomicPublication: 'single-file-rename' | 'exclusive-frame-directory-rename';
}

export type NativeMediaV14NativeProfileDispatchV1 =
	| NativeMediaV14DecodeDispatchV1 | NativeMediaV14EncodeDispatchV1;

export interface NativeMediaV14HardwareEncodeDispatchV1 {
	readonly hardware: true;
	readonly platform: NativeMediaPlatform;
	readonly backend: NativeMediaHardwareBackend;
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly encoder: string;
	readonly deviceType: 'd3d11va' | 'videotoolbox' | 'vaapi' | 'qsv' | 'cuda' | 'vulkan';
	readonly uploadPixelFormat: 'nv12' | 'p010le' | 'yuv422p10le';
	readonly hardwareFrames: boolean;
}

const decode = (
	id: NativeMediaV14DecodeProfileId,
	decoder: string,
	parsers: readonly string[],
	demuxers: readonly string[],
	imageSequence = false,
): NativeMediaV14DecodeDispatchV1 => Object.freeze({
	id, operation: 'decode', decoder,
	parsers: Object.freeze([...parsers]), demuxers: Object.freeze([...demuxers]), imageSequence,
});

const encode = (
	id: NativeMediaV14EncodeProfileId,
	input: Omit<NativeMediaV14EncodeDispatchV1, 'id' | 'operation' | 'atomicPublication'>,
): NativeMediaV14EncodeDispatchV1 => Object.freeze({
	id, operation: 'encode', ...input,
	atomicPublication: input.imageSequence
		? 'exclusive-frame-directory-rename' : 'single-file-rename',
});

const DECODERS: readonly NativeMediaV14DecodeDispatchV1[] = Object.freeze([
	decode('decode-h264', 'h264', ['h264'], ['mov', 'matroska', 'mpegts']),
	decode('decode-hevc', 'hevc', ['hevc'], ['mov', 'matroska', 'mpegts']),
	decode('decode-vp9', 'vp9', ['vp9'], ['matroska']),
	decode('decode-av1', 'av1', ['av1'], ['mov', 'matroska']),
	decode('decode-prores', 'prores', [], ['mov']),
	decode('decode-dnxhr', 'dnxhd', [], ['mxf']),
	decode('decode-png-sequence', 'png', ['png'], [], true),
	decode('decode-tiff-sequence', 'tiff', [], [], true),
	decode('decode-openexr-sequence', 'exr', [], [], true),
]);

const ENCODERS: readonly NativeMediaV14EncodeDispatchV1[] = Object.freeze([
	encode('encode-mp4-h264', {
		muxer: 'mp4', encoder: 'libx264', pixelFormat: 'yuv420p', codecProfile: null,
		audioEncoder: 'aac', preservesHdrMetadata: false, supportsAlpha: false, imageSequence: false,
	}),
	encode('encode-hevc-main10-hdr10', {
		muxer: 'mp4', encoder: 'libx265', pixelFormat: 'yuv420p10le', codecProfile: 'main10',
		audioEncoder: 'aac', preservesHdrMetadata: true, supportsAlpha: false, imageSequence: false,
	}),
	encode('encode-hevc-main10-sdr', {
		muxer: 'mp4', encoder: 'libx265', pixelFormat: 'yuv420p10le', codecProfile: 'main10',
		audioEncoder: 'aac', preservesHdrMetadata: false, supportsAlpha: false, imageSequence: false,
	}),
	encode('encode-webm-vp9', {
		muxer: 'webm', encoder: 'libvpx-vp9', pixelFormat: 'yuv420p', codecProfile: null,
		audioEncoder: 'libopus', preservesHdrMetadata: false, supportsAlpha: false, imageSequence: false,
	}),
	encode('encode-mov-prores-proxy', {
		muxer: 'mov', encoder: 'prores_ks', pixelFormat: 'yuv422p10le', codecProfile: 'proxy',
		audioEncoder: 'pcm_s16le', preservesHdrMetadata: true, supportsAlpha: false, imageSequence: false,
	}),
	encode('encode-mov-prores-422-hq', {
		muxer: 'mov', encoder: 'prores_ks', pixelFormat: 'yuv422p10le', codecProfile: 'hq',
		audioEncoder: 'pcm_s16le', preservesHdrMetadata: true, supportsAlpha: false, imageSequence: false,
	}),
	encode('encode-mov-prores-4444', {
		muxer: 'mov', encoder: 'prores_ks', pixelFormat: 'yuva444p10le', codecProfile: '4444',
		audioEncoder: 'pcm_s16le', preservesHdrMetadata: true, supportsAlpha: true, imageSequence: false,
	}),
	encode('encode-mxf-dnxhr-hqx', {
		muxer: 'mxf', encoder: 'dnxhd', pixelFormat: 'yuv422p10le', codecProfile: 'dnxhr_hqx',
		audioEncoder: 'pcm_s16le', preservesHdrMetadata: true, supportsAlpha: false, imageSequence: false,
	}),
	encode('encode-matroska-ffv1', {
		muxer: 'matroska', encoder: 'ffv1', pixelFormat: 'gbrap16le', codecProfile: 'level3',
		audioEncoder: 'flac', preservesHdrMetadata: true, supportsAlpha: true, imageSequence: false,
	}),
	encode('encode-png-sequence', {
		muxer: 'image2', encoder: 'png', pixelFormat: 'rgba64be', codecProfile: null,
		audioEncoder: null, preservesHdrMetadata: false, supportsAlpha: true, imageSequence: true,
	}),
	encode('encode-tiff-sequence', {
		muxer: 'image2', encoder: 'tiff', pixelFormat: 'rgba64le', codecProfile: null,
		audioEncoder: null, preservesHdrMetadata: false, supportsAlpha: true, imageSequence: true,
	}),
	encode('encode-openexr-sequence', {
		muxer: 'image2', encoder: 'exr', pixelFormat: 'gbrapf32le', codecProfile: null,
		audioEncoder: null, preservesHdrMetadata: false, supportsAlpha: true, imageSequence: true,
	}),
]);

export const NATIVE_MEDIA_V14_NATIVE_PROFILE_DISPATCH:
	readonly NativeMediaV14NativeProfileDispatchV1[] = Object.freeze([...DECODERS, ...ENCODERS]);

const HARDWARE_ENCODERS: readonly NativeMediaV14HardwareEncodeDispatchV1[] = Object.freeze([
	...hardwareRows('win32', 'media-foundation', 'd3d11va', false, [
		['encode-mp4-h264', 'h264_mf', 'nv12'],
		['encode-hevc-main10-hdr10', 'hevc_mf', 'p010le'],
		['encode-hevc-main10-sdr', 'hevc_mf', 'p010le'],
	]),
	...hardwareRows('win32', 'qsv', 'qsv', true, longGop('qsv')),
	...hardwareRows('win32', 'nvenc', 'cuda', true, avcHevc('nvenc')),
	...hardwareRows('win32', 'amf', 'd3d11va', true, avcHevc('amf')),
	...hardwareRows('darwin', 'videotoolbox', 'videotoolbox', false, [
		['encode-mp4-h264', 'h264_videotoolbox', 'nv12'],
		['encode-hevc-main10-hdr10', 'hevc_videotoolbox', 'p010le'],
		['encode-hevc-main10-sdr', 'hevc_videotoolbox', 'p010le'],
		['encode-mov-prores-proxy', 'prores_videotoolbox', 'yuv422p10le'],
		['encode-mov-prores-422-hq', 'prores_videotoolbox', 'yuv422p10le'],
	]),
	...hardwareRows('linux', 'vaapi', 'vaapi', true, longGop('vaapi')),
	...hardwareRows('linux', 'qsv', 'qsv', true, longGop('qsv')),
	...hardwareRows('linux', 'nvenc', 'cuda', true, avcHevc('nvenc')),
	...hardwareRows('linux', 'amf', 'vulkan', true, avcHevc('amf')),
]);

type HardwareTuple = readonly [
	NativeMediaV14EncodeProfileId, string,
	NativeMediaV14HardwareEncodeDispatchV1['uploadPixelFormat'],
];

function avcHevc(suffix: 'nvenc' | 'amf'): readonly HardwareTuple[] {
	return Object.freeze([
		['encode-mp4-h264', `h264_${suffix}`, 'nv12'],
		['encode-hevc-main10-hdr10', `hevc_${suffix}`, 'p010le'],
		['encode-hevc-main10-sdr', `hevc_${suffix}`, 'p010le'],
	]);
}

function longGop(suffix: 'qsv' | 'vaapi'): readonly HardwareTuple[] {
	return Object.freeze([
		...avcHevc(suffix as 'nvenc').map(([profile, _encoder, pixel]) => (
			[profile, `${profile === 'encode-mp4-h264' ? 'h264' : 'hevc'}_${suffix}`, pixel] as const
		)),
		['encode-webm-vp9', `vp9_${suffix}`, 'nv12'],
	]);
}

function hardwareRows(
	platform: NativeMediaPlatform,
	backend: NativeMediaHardwareBackend,
	deviceType: NativeMediaV14HardwareEncodeDispatchV1['deviceType'],
	hardwareFrames: boolean,
	tuples: readonly HardwareTuple[],
): readonly NativeMediaV14HardwareEncodeDispatchV1[] {
	return tuples.map(([profileId, encoder, uploadPixelFormat]) => Object.freeze({
		hardware: true as const, platform, backend, profileId,
		encoder, deviceType, uploadPixelFormat, hardwareFrames,
	}));
}

export function nativeMediaV14DecodeDispatch(
	profileId: NativeMediaV14DecodeProfileId,
): NativeMediaV14DecodeDispatchV1 {
	const row = DECODERS.find(({ id }) => id === profileId);
	if (!row) throw new RangeError(`Unknown selected V14 decode profile ${String(profileId)}.`);
	return row;
}

export function nativeMediaV14EncodeDispatch(
	profileId: NativeMediaV14EncodeProfileId,
): NativeMediaV14EncodeDispatchV1 {
	const row = ENCODERS.find(({ id }) => id === profileId);
	if (!row) throw new RangeError(`Unknown selected V14 encode profile ${String(profileId)}.`);
	return row;
}

export function nativeMediaV14HardwareEncodeDispatch(input: Readonly<{
	readonly platform: NativeMediaPlatform;
	readonly backend: NativeMediaHardwareBackend;
	readonly profileId: NativeMediaV14EncodeProfileId;
}>): NativeMediaV14HardwareEncodeDispatchV1 | null {
	return HARDWARE_ENCODERS.find((row) => row.platform === input.platform
		&& row.backend === input.backend && row.profileId === input.profileId) ?? null;
}

export function createNativeMediaV14CpuRetry<SemanticPlan>(input: Readonly<{
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly backend: string;
	readonly planFingerprint: string;
	readonly semanticPlan: SemanticPlan;
}>): Readonly<{
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly backend: 'native-cpu';
	readonly planFingerprint: string;
	readonly semanticPlan: SemanticPlan;
	readonly degradedBackend: string;
	readonly attempt: 2;
}> {
	if (input.backend === 'native-cpu' || input.backend === 'web-core') {
		throw new RangeError('Selected V14 CPU retry requires one failed hardware attempt.');
	}
	if (!/^[a-f0-9]{64}$/u.test(input.planFingerprint)) {
		throw new TypeError('Selected V14 CPU retry requires its exact plan fingerprint.');
	}
	return Object.freeze({
		profileId: input.profileId, backend: 'native-cpu', planFingerprint: input.planFingerprint,
		semanticPlan: input.semanticPlan, degradedBackend: input.backend, attempt: 2,
	});
}

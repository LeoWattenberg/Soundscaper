/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The delivery targets this product names, and what each one is allowed to do.
 *
 * Three of these execute in the browser. The rest execute through the native
 * desktop tier when its authenticated payload is present. Licensing state is
 * reported separately and never hides an implemented route.
 *
 * Each preset names the production licensing rows that apply to distribution.
 * Those rows never hide an implemented target or disable build, test, package,
 * or execution; exact machine executors perform their own payload, platform,
 * containment, consent, and capacity validation.
 */

import { VIDEO_EXPORT_FORMATS } from './video-export.js';
import type { NativeMediaV14EncodeProfileId } from './native-media-v14-native-dispatch.ts';
import {
	DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1,
	PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1,
} from './platform-image-sequence-companion-audio.ts';
import { PLATFORM_DELIVERY_LICENSING_SNAPSHOT } from './platform-delivery-licensing.ts';

export interface PlatformWebVideoPlanExecution {
	readonly kind: 'web-video-plan';
	readonly planOptions: Readonly<Record<string, unknown>>;
}

export interface PlatformNativeMediaV15Execution {
	readonly kind: 'native-media-v15';
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly hardwarePolicy: 'native-cpu' | 'hardware-first-identical-cpu-retry';
	readonly captionPolicy: Readonly<{
		readonly muxCodec: 'mov_text' | null;
		readonly burnIn: 'supported-opaque' | 'supported-alpha-composite' | 'refused-preserve-alpha';
	}>;
	readonly companionAudio: Readonly<{
		readonly required: true;
		readonly allowedFormatIds: typeof PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1;
		readonly defaultChoice: typeof DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1;
	}> | null;
}

export type PlatformDeliveryExecution =
	| PlatformWebVideoPlanExecution
	| PlatformNativeMediaV15Execution;

export interface PlatformDeliveryPreset {
	readonly id: string;
	readonly label: string;
	/** What the delivery is, in the terms a user picks it by. */
	readonly summary: string;
	/** Licensing rows relevant when this preset is distributed. */
	readonly licensingRowIds: readonly string[];
	/** Where a route with no matching executor goes; null when this preset is the floor. */
	readonly fallbackPresetId: string | null;
	/** The executor and exact profile/options this target selects. */
	readonly execution: PlatformDeliveryExecution;
}

export interface PlatformDeliveryPresetAvailability {
	readonly presetId: string;
	readonly available: boolean;
	readonly status: 'implemented';
	readonly licensingStatus: 'not-required' | 'cleared' | 'pending';
	readonly licensingRowIds: readonly string[];
	readonly pendingLicensingRowIds: readonly string[];
}

const H264 = Object.freeze({ format: 'mp4', quality: 'balanced' });
const NATIVE_FFMPEG = 'codec-native-ffmpeg-current-set';
const MOV_TEXT_CAPTIONS = Object.freeze({
	muxCodec: 'mov_text' as const, burnIn: 'supported-opaque' as const,
});
const ALPHA_CAPTIONS = Object.freeze({
	muxCodec: 'mov_text' as const, burnIn: 'refused-preserve-alpha' as const,
});
const IMAGE_SEQUENCE_AUDIO = Object.freeze({
	required: true as const,
	allowedFormatIds: PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1,
	defaultChoice: DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1,
});

function webExecution(planOptions: Readonly<Record<string, unknown>>): PlatformWebVideoPlanExecution {
	return Object.freeze({ kind: 'web-video-plan' as const, planOptions });
}

function nativeExecution(
	profileId: NativeMediaV14EncodeProfileId,
	options: Readonly<{
		readonly hardware?: true;
		readonly alpha?: true;
		readonly imageSequence?: true;
	}> = {},
): PlatformNativeMediaV15Execution {
	return Object.freeze({
		kind: 'native-media-v15' as const,
		profileId,
		hardwarePolicy: options.hardware
			? 'hardware-first-identical-cpu-retry' as const : 'native-cpu' as const,
		captionPolicy: options.imageSequence
			? Object.freeze({ muxCodec: null, burnIn: 'supported-alpha-composite' as const })
			: options.alpha ? ALPHA_CAPTIONS : MOV_TEXT_CAPTIONS,
		companionAudio: options.imageSequence ? IMAGE_SEQUENCE_AUDIO : null,
	});
}

export const PLATFORM_DELIVERY_PRESETS: readonly PlatformDeliveryPreset[] = Object.freeze([
	Object.freeze({
		id: 'web-1080p',
		label: 'Web 1080p',
		summary: 'MP4, H.264, 1920x1080, stereo.',
		licensingRowIds: Object.freeze([]),
		fallbackPresetId: null,
		execution: webExecution(Object.freeze({
			...H264,
			canvas: Object.freeze({ size: Object.freeze({ width: 1_920, height: 1_080 }) }),
		})),
	}),
	Object.freeze({
		id: 'web-vertical-1080',
		label: 'Vertical 1080x1920',
		summary: 'MP4, H.264, 9:16, cropped to fill.',
		licensingRowIds: Object.freeze([]),
		fallbackPresetId: 'web-1080p',
		execution: webExecution(Object.freeze({
			...H264,
			canvas: Object.freeze({
				size: Object.freeze({ width: 1_080, height: 1_920 }),
				fit: 'cover',
			}),
		})),
	}),
	Object.freeze({
		id: 'web-vp9-1080p',
		label: 'Web 1080p (WebM)',
		summary: 'WebM, VP9, 1920x1080, stereo.',
		licensingRowIds: Object.freeze([]),
		fallbackPresetId: 'web-1080p',
		execution: webExecution(Object.freeze({
			format: 'webm',
			quality: 'balanced',
			canvas: Object.freeze({ size: Object.freeze({ width: 1_920, height: 1_080 }) }),
		})),
	}),
	Object.freeze({
		id: 'native-uhd-hdr10',
		label: '4K HDR10',
		summary: '3840x2160, 10-bit HEVC, HDR10 transfer.',
		licensingRowIds: Object.freeze([
			'codec-encode-hevc-mp4-main10-hdr10', NATIVE_FFMPEG,
		]),
		fallbackPresetId: 'web-1080p',
		execution: nativeExecution('encode-hevc-main10-hdr10'),
	}),
	Object.freeze({
		id: 'native-10-bit-sdr',
		label: '10-bit SDR',
		summary: '1920x1080, 10-bit, for grading headroom without HDR.',
		licensingRowIds: Object.freeze([
			'codec-encode-hevc-mp4-main10-sdr', NATIVE_FFMPEG,
		]),
		fallbackPresetId: 'web-1080p',
		execution: nativeExecution('encode-hevc-main10-sdr'),
	}),
	Object.freeze({
		id: 'native-hardware-h264',
		label: 'Hardware H.264',
		summary: 'The same delivery as Web 1080p, encoded by the machine’s own hardware.',
		licensingRowIds: Object.freeze(['codec-hardware-acceleration']),
		fallbackPresetId: 'web-1080p',
		execution: nativeExecution('encode-mp4-h264', { hardware: true }),
	}),
	Object.freeze({
		id: 'native-mezzanine-prores',
		label: 'Mezzanine (ProRes 422)',
		summary: 'MOV, ProRes 422, for handing on to another edit rather than to a viewer.',
		licensingRowIds: Object.freeze([
			'codec-encode-prores-mov-422-hq', NATIVE_FFMPEG,
		]),
		fallbackPresetId: 'web-1080p',
		execution: nativeExecution('encode-mov-prores-422-hq'),
	}),
	Object.freeze({
		id: 'native-alpha-mezzanine',
		label: 'Mezzanine with alpha',
		summary: 'MOV, 4:4:4 with a preserved alpha channel, for compositing downstream.',
		licensingRowIds: Object.freeze([
			'codec-encode-prores-mov-4444', NATIVE_FFMPEG,
		]),
		fallbackPresetId: 'native-mezzanine-prores',
		execution: nativeExecution('encode-mov-prores-4444', { alpha: true }),
	}),
	Object.freeze({
		id: 'native-image-sequence-png',
		label: 'PNG image sequence',
		summary: 'One lossless still per frame, numbered, with the audio delivered beside it.',
		licensingRowIds: Object.freeze([
			'codec-encode-png-image-sequence', NATIVE_FFMPEG,
		]),
		fallbackPresetId: 'web-1080p',
		execution: nativeExecution('encode-png-sequence', { imageSequence: true }),
	}),
]);

const PRESETS_BY_ID: ReadonlyMap<string, PlatformDeliveryPreset> = new Map(
	PLATFORM_DELIVERY_PRESETS.map((preset) => [preset.id, preset]),
);

export function findPlatformDeliveryPreset(id: unknown): PlatformDeliveryPreset | null {
	return typeof id === 'string' ? PRESETS_BY_ID.get(id) ?? null : null;
}

/**
 * Whether the catalog implements this preset, with licensing state reported
 * independently from runtime availability.
 */
export function resolvePlatformDeliveryAvailability(
	preset: PlatformDeliveryPreset,
	licensingMatrix: unknown = PLATFORM_DELIVERY_LICENSING_SNAPSHOT,
): PlatformDeliveryPresetAvailability {
	const known = findPlatformDeliveryPreset(preset?.id);
	if (!known || known !== preset) {
		throw new TypeError('A platform delivery preset from the catalog is required.');
	}
	const pending: string[] = [];
	for (const rowId of preset.licensingRowIds) {
		const row = findLicensingRow(licensingMatrix, rowId);
		const rowStatus = typeof row?.status === 'string' ? row.status : 'unknown';
		if (rowStatus === 'implemented' || rowStatus === 'shipped' || rowStatus === 'cleared') continue;
		pending.push(rowId);
	}
	return Object.freeze({
		presetId: preset.id,
		available: true,
		status: 'implemented' as const,
		licensingStatus: preset.licensingRowIds.length === 0
			? 'not-required' as const : pending.length === 0 ? 'cleared' as const : 'pending' as const,
		licensingRowIds: preset.licensingRowIds,
		pendingLicensingRowIds: Object.freeze(pending),
	});
}

/**
 * The browser-video plan options this preset means, or null when this preset is
 * owned by a different executor. Native targets return null here because their
 * exact queue execution is exposed by `resolvePlatformDeliveryExecution`, not
 * because licensing work is pending.
 */
export function resolvePlatformDeliveryPlanOptions(
	preset: PlatformDeliveryPreset,
	licensingMatrix: unknown = PLATFORM_DELIVERY_LICENSING_SNAPSHOT,
): Readonly<Record<string, unknown>> | null {
	resolvePlatformDeliveryAvailability(preset, licensingMatrix);
	if (preset.execution.kind !== 'web-video-plan') return null;
	const format = preset.execution.planOptions.format;
	if (typeof format !== 'string' || !Object.hasOwn(VIDEO_EXPORT_FORMATS, format)) {
		throw new RangeError(`Platform delivery preset ${preset.id} names a format this build does not ship.`);
	}
	return preset.execution.planOptions;
}

/** Resolve the implemented executor; its runtime validates the current machine. */
export function resolvePlatformDeliveryExecution(
	preset: PlatformDeliveryPreset,
	licensingMatrix: unknown = PLATFORM_DELIVERY_LICENSING_SNAPSHOT,
): PlatformDeliveryExecution | null {
	resolvePlatformDeliveryAvailability(preset, licensingMatrix);
	return preset.execution;
}

function findLicensingRow(matrix: unknown, rowId: string): Record<string, unknown> | null {
	if (!matrix || typeof matrix !== 'object') return null;
	for (const value of Object.values(matrix as Record<string, unknown>)) {
		if (!Array.isArray(value)) continue;
		for (const row of value) {
			if (row && typeof row === 'object' && (row as Record<string, unknown>).id === rowId) {
				return row as Record<string, unknown>;
			}
		}
	}
	return null;
}

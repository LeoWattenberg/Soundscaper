/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected V14 native-media inventory. Presence is not policy clearance. */

import {
	resolveNativeMediaBackendPlan,
	type NativeMediaBackendPlanV1,
	type NativeMediaOperation,
	type NativeMediaPlatform,
} from './native-media-backend-policy.ts';
import type { NativeMediaCapabilitySnapshotV1 } from './native-media-capability-snapshot.ts';
import {
	NATIVE_MEDIA_PROFESSIONAL_PROFILES,
	type NativeMediaProfileV1,
} from './native-media-professional-profiles.ts';

export const NATIVE_MEDIA_V14_LOCAL_PROTOCOLS = Object.freeze(['file'] as const);

export const NATIVE_MEDIA_V14_VIDEO_DECODE_PROFILE_IDS = Object.freeze([
	'decode-h264', 'decode-hevc', 'decode-vp9', 'decode-av1',
	'decode-prores', 'decode-dnxhr', 'decode-png-sequence',
	'decode-tiff-sequence', 'decode-openexr-sequence',
] as const);

export const NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS = Object.freeze([
	'encode-mp4-h264', 'encode-hevc-main10-hdr10', 'encode-hevc-main10-sdr',
	'encode-webm-vp9', 'encode-mov-prores-proxy', 'encode-mov-prores-422-hq',
	'encode-mov-prores-4444', 'encode-mxf-dnxhr-hqx', 'encode-matroska-ffv1',
	'encode-png-sequence', 'encode-tiff-sequence', 'encode-openexr-sequence',
] as const);

export const NATIVE_MEDIA_V14_AUDIO_PROFILES = Object.freeze([
	Object.freeze({ id: 'encode-aac', codec: 'aac', containers: Object.freeze(['mp4', 'mov']) }),
	Object.freeze({ id: 'encode-opus', codec: 'libopus', containers: Object.freeze(['webm', 'matroska']) }),
	Object.freeze({ id: 'encode-pcm', codec: 'pcm_s16le', containers: Object.freeze(['wav', 'mov']) }),
] as const);

export type NativeMediaV14BaselineHardwareBackend =
	| 'd3d11va' | 'media-foundation' | 'videotoolbox' | 'vaapi';
export type NativeMediaV14OfxGpuBackend = 'opengl' | 'metal';

export interface NativeMediaV14PlatformAcceleration {
	readonly decode: NativeMediaV14BaselineHardwareBackend;
	readonly encode: NativeMediaV14BaselineHardwareBackend;
	readonly ofxGpu: readonly NativeMediaV14OfxGpuBackend[];
}

/** One OS baseline attempt only; vendor-specific drivers are never implicit. */
export const NATIVE_MEDIA_V14_PLATFORM_ACCELERATION: Readonly<Record<
	NativeMediaPlatform, NativeMediaV14PlatformAcceleration
>> = Object.freeze({
	win32: Object.freeze({
		decode: 'd3d11va', encode: 'media-foundation', ofxGpu: Object.freeze(['opengl'] as const),
	}),
	darwin: Object.freeze({
		decode: 'videotoolbox', encode: 'videotoolbox', ofxGpu: Object.freeze(['metal', 'opengl'] as const),
	}),
	linux: Object.freeze({
		decode: 'vaapi', encode: 'vaapi', ofxGpu: Object.freeze(['opengl'] as const),
	}),
});

export const NATIVE_MEDIA_V14_VENDOR_SPECIFIC_BACKENDS = Object.freeze([
	'qsv', 'nvdec', 'nvenc', 'amf', 'cuda', 'opencl',
] as const);

export interface NativeMediaV14SupportInventory {
	readonly planVersion: 14;
	readonly protocols: typeof NATIVE_MEDIA_V14_LOCAL_PROTOCOLS;
	readonly videoDecode: readonly NativeMediaProfileV1[];
	readonly videoEncode: readonly NativeMediaProfileV1[];
	readonly audioEncode: typeof NATIVE_MEDIA_V14_AUDIO_PROFILES;
	readonly acceleration: typeof NATIVE_MEDIA_V14_PLATFORM_ACCELERATION;
	readonly vendorSpecificBackends: typeof NATIVE_MEDIA_V14_VENDOR_SPECIFIC_BACKENDS;
}

export function createNativeMediaV14SupportInventory(): NativeMediaV14SupportInventory {
	const profiles = new Map(NATIVE_MEDIA_PROFESSIONAL_PROFILES.map((profile) => [profile.id, profile]));
	const select = (ids: readonly string[], operation: NativeMediaOperation): readonly NativeMediaProfileV1[] => (
		Object.freeze(ids.map((id) => {
			const profile = profiles.get(id);
			if (!profile || profile.operation !== operation) {
				throw new Error(`Selected V14 ${operation} profile ${id} is absent from the professional baseline.`);
			}
			return profile;
		}))
	);
	return Object.freeze({
		planVersion: 14,
		protocols: NATIVE_MEDIA_V14_LOCAL_PROTOCOLS,
		videoDecode: select(NATIVE_MEDIA_V14_VIDEO_DECODE_PROFILE_IDS, 'decode'),
		videoEncode: select(NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS, 'encode'),
		audioEncode: NATIVE_MEDIA_V14_AUDIO_PROFILES,
		acceleration: NATIVE_MEDIA_V14_PLATFORM_ACCELERATION,
		vendorSpecificBackends: NATIVE_MEDIA_V14_VENDOR_SPECIFIC_BACKENDS,
	});
}

/**
 * Resolve the selected fallback chain. The wider historical backend registry
 * remains custody-only; V14 asks for exactly its OS baseline candidate.
 */
export function resolveNativeMediaV14BackendPlan(input: Readonly<{
	readonly platform: NativeMediaPlatform;
	readonly operation: NativeMediaOperation;
	readonly snapshot: NativeMediaCapabilitySnapshotV1;
}>): NativeMediaBackendPlanV1 {
	const backend = NATIVE_MEDIA_V14_PLATFORM_ACCELERATION[input.platform][input.operation];
	const plan = resolveNativeMediaBackendPlan({
		platform: input.platform,
		operation: input.operation,
		snapshot: input.snapshot,
		preferredBackends: [backend],
	});
	if (plan.attempts.length > 2 || plan.attempts.some((value, index) => (
		index === 0 && value !== backend && value !== 'native-cpu'
	))) throw new Error('Selected V14 backend resolution escaped its OS baseline.');
	return plan;
}

export function nativeMediaV14OfxGpuBackends(
	platform: NativeMediaPlatform,
): readonly NativeMediaV14OfxGpuBackend[] {
	return NATIVE_MEDIA_V14_PLATFORM_ACCELERATION[platform].ofxGpu;
}

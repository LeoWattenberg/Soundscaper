/* SPDX-License-Identifier: AGPL-3.0-only */

import policy from '../../../config/ffmpeg-runtime-publication-policy.json';

export const FFMPEG_RUNTIME_PUBLIC_ORIGIN = policy.publicOrigin;
export const FFMPEG_RUNTIME_PUBLIC_PREFIX = policy.publicPrefix;
export const FFMPEG_RUNTIME_RELEASE_SEGMENT = policy.releaseSegment;
export const FFMPEG_RUNTIME_FILES = Object.freeze(policy.runtimeFiles.map((file) => Object.freeze({ ...file })));
export const FFMPEG_RUNTIME_POINTER_URL =
	`${policy.publicOrigin}/${policy.publicPrefix}/${policy.pointer.name}`;

export function ffmpegRuntimeReleaseBaseUrl(releaseId: string): string {
	if (!/^[a-f\d]{64}$/u.test(releaseId)) throw new TypeError('FFmpeg runtime release ID is invalid.');
	return `${policy.publicOrigin}/${policy.publicPrefix}/${policy.releaseSegment}/${releaseId}`;
}

export function builtFfmpegRuntimeReleaseBaseUrl(): string | null {
	return null;
}

export function preferredFfmpegRuntimeFallbackBaseUrl(
	fallbackBaseUrl: string,
	productionBaseUrl: string | null = builtFfmpegRuntimeReleaseBaseUrl(),
): string {
	const selected = productionBaseUrl ?? fallbackBaseUrl;
	const normalized = String(selected).replace(/\/+$/u, '');
	if (!normalized) throw new TypeError('FFmpeg core fallback URL is required.');
	return normalized;
}

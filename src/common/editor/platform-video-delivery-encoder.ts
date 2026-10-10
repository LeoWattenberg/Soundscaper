/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertDesktopVideoExportAvailable,
	desktopVideoExportCapabilityNotice,
	resolveDesktopVideoExportCapabilities,
	type DesktopVideoExportCapabilities,
	type DesktopVideoExportFileService,
} from './desktop-video-export-capability.ts';
import {
	BrowserVideoEncoderUnavailableError,
	resolveVideoDeliveryEncoderTier,
	VIDEO_DELIVERY_FFMPEG_ENCODER,
	type VideoDeliveryEncoderDecision,
	type VideoDeliveryEncoderTierRequest,
} from './video-delivery-encoder-tier.ts';

/** Probe the requested delivery before choosing a desktop host fallback. */
export async function resolvePlatformVideoDeliveryEncoder(
	fileService: DesktopVideoExportFileService | null | undefined,
	request: VideoDeliveryEncoderTierRequest,
): Promise<VideoDeliveryEncoderDecision> {
	if (fileService?.isDesktop !== true) return resolveVideoDeliveryEncoderTier(request);
	try {
		return await resolveVideoDeliveryEncoderTier({ ...request, hardwareAcceleration: 'prefer-hardware' });
	} catch (error) {
		if (!(error instanceof BrowserVideoEncoderUnavailableError)) throw error;
	}
	try {
		return await resolveVideoDeliveryEncoderTier(request);
	} catch (error) {
		if (!(error instanceof BrowserVideoEncoderUnavailableError)) throw error;
		await assertDesktopVideoExportAvailable(fileService, request.format);
		return Object.freeze({ ...VIDEO_DELIVERY_FFMPEG_ENCODER, reason: error.message });
	}
}

/** Format discovery is provisional; export admission probes the exact plan and audio geometry. */
export async function resolveDesktopRendererVideoExportCapabilities(
	fileService: DesktopVideoExportFileService,
): Promise<DesktopVideoExportCapabilities> {
	const host = await resolveDesktopVideoExportCapabilities(fileService);
	const formats = { ...host.formats };
	for (const format of ['mp4', 'webm'] as const) {
		try {
			await resolveVideoDeliveryEncoderTier({
				format, canvas: { width: 640, height: 360, frameRate: { num: 30, den: 1 } },
				quality: 'balanced', eligible: true,
			});
			formats[format] = Object.freeze({ available: true, provider: 'webcodecs', reason: null });
		} catch (error) {
			if (!(error instanceof BrowserVideoEncoderUnavailableError)) throw error;
		}
	}
	return Object.freeze({
		schemaVersion: 1, formats: Object.freeze(formats),
		notice: desktopVideoExportCapabilityNotice(formats),
	});
}

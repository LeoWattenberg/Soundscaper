/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one place the video export request's format prefix is written down.
 *
 * A video delivery is named twice: the export dialog and its request spell it
 * `video-mp4`, and the plan spells it `mp4`, because a single preset list holds
 * both audio and video formats and only the prefixed spelling distinguishes
 * them. The prefix is therefore not decoration — it is what the export router
 * reads to decide whether a request is a video delivery at all.
 *
 * That rule had been restated at each site that needed it: the dialog's format
 * list, the router's `startsWith`, the video service's strip, and the preset
 * translation. A delivery target then supplied a bare plan format straight into
 * a request, the prefix went missing, and the router sent every targeted
 * delivery down the audio path, where an unknown format falls back to WAV. One
 * function per direction, used by every site, is what stops that recurring.
 */

const VIDEO_EXPORT_REQUEST_FORMAT_PREFIX = 'video-';

/** Whether a request's stated format names a video delivery. */
export function isVideoExportRequestFormat(value: unknown): boolean {
	return String(value ?? '').startsWith(VIDEO_EXPORT_REQUEST_FORMAT_PREFIX);
}

/** The request spelling of a plan format: `mp4` becomes `video-mp4`. */
export function videoExportRequestFormat(planFormat: unknown): string {
	const format = String(planFormat ?? '');
	return isVideoExportRequestFormat(format)
		? format
		: `${VIDEO_EXPORT_REQUEST_FORMAT_PREFIX}${format}`;
}

/** The plan spelling of a request format: `video-mp4` becomes `mp4`. */
export function videoExportPlanFormat(requestFormat: unknown): string {
	const format = String(requestFormat ?? '');
	return isVideoExportRequestFormat(format)
		? format.slice(VIDEO_EXPORT_REQUEST_FORMAT_PREFIX.length)
		: format;
}

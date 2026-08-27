/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact desktop video capability fixture shared by tests outside the desktop tree. */
export function availableDesktopVideoExportCapabilities() {
	return Object.freeze({
		schemaVersion: 1,
		formats: Object.freeze({
			mp4: Object.freeze({ available: true, provider: 'external-ffmpeg', reason: null }),
			webm: Object.freeze({ available: true, provider: 'external-ffmpeg', reason: null }),
		}),
	});
}

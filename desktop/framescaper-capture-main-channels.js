/* SPDX-License-Identifier: AGPL-3.0-only */

/** Framescaper-only, pathless capture control plane. Media remains in Chromium. */
export const FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS = Object.freeze({
	status: 'framescaper:capture:v1:status',
	listSources: 'framescaper:capture:v1:sources:list',
	grant: 'framescaper:capture:v1:grant',
	teardown: 'framescaper:capture:v1:teardown',
});

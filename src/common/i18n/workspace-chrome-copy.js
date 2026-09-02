/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['panelMenu', 'Panel menu', 'Bedienfeldmenü'],
	['timecode', 'Timecode', 'Timecode'],
	['snapInterval', 'Snap interval', 'Rasterintervall'],
]);

export const WORKSPACE_CHROME_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});

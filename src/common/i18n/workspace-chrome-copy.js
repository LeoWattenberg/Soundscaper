/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['arrangePanel', 'Arrange panel', 'Bedienfeld anordnen'],
	['arrangeBefore', 'Before', 'Davor'],
	['arrangeTab', 'As tab', 'Als Registerkarte'],
	['arrangeAfter', 'After', 'Danach'],
	['panelMenu', 'Panel menu', 'Bedienfeldmenü'],
	['timecode', 'Timecode', 'Timecode'],
	['snapInterval', 'Snap interval', 'Rasterintervall'],
	['layout', 'Layout', 'Layout'],
	['layoutAuto', 'Automatic', 'Automatisch'],
	['layoutCompact', 'Compact (menus and track headers in drawers)', 'Kompakt (Menüs und Spurköpfe in Schubladen)'],
	['layoutDesktop', 'Desktop', 'Desktop'],
	['chromeMenu', 'Menu', 'Menü'],
	['chromeMenuClose', 'Close menu', 'Menü schließen'],
]);

export const WORKSPACE_CHROME_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});

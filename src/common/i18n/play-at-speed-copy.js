/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for Audacity's Play-at-speed transport and its pitch behaviour.
 *
 * The row grows whenever the transport gains a way to hold pitch while the rate
 * changes, which is a per-mode string. It lives behind its own seam for the same
 * reason the MP3 bit-rate and Opus VBR rows do: the main catalog sits at a
 * maintainability ceiling that such a string should not push up.
 */
const PLAY_AT_SPEED_COPY_ENTRIES = Object.freeze([
	['playAtSpeed', 'Play at speed', 'Mit Geschwindigkeit abspielen'],
	['cancelPlayAtSpeed', 'Cancel play at speed', 'Wiedergabe mit Geschwindigkeit abbrechen'],
	['pausePlayAtSpeed', 'Pause play at speed', 'Wiedergabe mit Geschwindigkeit pausieren'],
	['playbackSpeed', 'Playback speed', 'Wiedergabegeschwindigkeit'],
	['playAtSpeedPreservePitch', 'Preserve pitch', 'Tonhöhe beibehalten'],
	['playAtSpeedMode', 'Play-at-speed pitch behavior', 'Tonhöhe bei „Mit Geschwindigkeit abspielen“'],
	['playAtSpeedNaive', 'Change speed and pitch', 'Geschwindigkeit und Tonhöhe ändern'],
	['playAtSpeedStaffPad', 'Preserve pitch with StaffPad', 'Tonhöhe mit StaffPad beibehalten'],
	['playAtSpeedPreparing', 'Preparing StaffPad playback.', 'Wiedergabe mit StaffPad wird vorbereitet.'],
	['playAtSpeedPlaying', 'Playing at {rate}×.', 'Wiedergabe mit {rate}×.'],
]);

export const PLAY_AT_SPEED_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(PLAY_AT_SPEED_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(PLAY_AT_SPEED_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});

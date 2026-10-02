/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeCodeFormat } from '@soundscaper/design-system/TimeCode';

export type AudioEditorTimeDisplayFormat = Exclude<TimeCodeFormat, 'Hz'>;

const TIME_DISPLAY_FORMATS = new Set<AudioEditorTimeDisplayFormat>([
	'dd:hh:mm:ss', 'hh:mm:ss', 'hh:mm:ss+hundredths', 'hh:mm:ss+milliseconds',
	'hh:mm:ss+samples', 'hh:mm:ss+frames', 'samples', 'seconds', 'seconds+milliseconds',
	'film-frames', 'hh:mm:ss+cdda-frames', 'cdda-frames', 'hh:mm:ss+ntsc-frames',
	'hh:mm:ss+ntsc-drop-frames', 'ntsc-frames', 'hh:mm:ss+pal-frames', 'pal-frames', 'beats:bars',
]);

/** Null follows the active product or sequence clock until the user picks a format. */
export function normalizeAudioEditorTimeDisplayFormat(value: unknown): AudioEditorTimeDisplayFormat | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || !TIME_DISPLAY_FORMATS.has(value as AudioEditorTimeDisplayFormat)) {
		throw new RangeError('workspace.timeDisplayFormat must be a timecode format.');
	}
	return value as AudioEditorTimeDisplayFormat;
}

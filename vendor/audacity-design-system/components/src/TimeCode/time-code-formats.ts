export type TimeCodeFormat =
	| 'dd:hh:mm:ss'
	| 'hh:mm:ss'
	| 'hh:mm:ss+hundredths'
	| 'hh:mm:ss+milliseconds'
	| 'hh:mm:ss+samples'
	| 'hh:mm:ss+frames'
	| 'samples'
	| 'seconds'
	| 'seconds+milliseconds'
	| 'film-frames'
	| 'hh:mm:ss+cdda-frames'
	| 'cdda-frames'
	| 'hh:mm:ss+ntsc-frames'
	| 'hh:mm:ss+ntsc-drop-frames'
	| 'ntsc-frames'
	| 'hh:mm:ss+pal-frames'
	| 'pal-frames'
	| 'beats:bars'
	| 'Hz';

export type TimeCodeFormatDomain = 'time' | 'frequency';

export interface TimeCodeFormatOption {
	readonly format: TimeCodeFormat;
	readonly label: string;
	readonly group?: 'Video frames' | 'CD frames';
}

const TIME_FORMAT_OPTIONS: readonly TimeCodeFormatOption[] = Object.freeze([
	{ format: 'dd:hh:mm:ss', label: 'dd:hh:mm:ss' },
	{ format: 'hh:mm:ss', label: 'hh:mm:ss' },
	{ format: 'hh:mm:ss+hundredths', label: 'hh:mm:ss + hundredths' },
	{ format: 'hh:mm:ss+milliseconds', label: 'hh:mm:ss + milliseconds' },
	{ format: 'hh:mm:ss+samples', label: 'hh:mm:ss + samples' },
	{ format: 'hh:mm:ss+frames', group: 'Video frames', label: 'hh:mm:ss + frames (24fps)' },
	{ format: 'samples', label: 'samples' },
	{ format: 'seconds', label: 'seconds' },
	{ format: 'seconds+milliseconds', label: 'seconds + milliseconds' },
	{ format: 'film-frames', group: 'Video frames', label: 'film frames (24fps)' },
	{ format: 'hh:mm:ss+ntsc-frames', group: 'Video frames', label: 'hh:mm:ss + NTSC frames (29.97 fps)' },
	{ format: 'hh:mm:ss+ntsc-drop-frames', group: 'Video frames', label: 'hh:mm:ss + NTSC drop frames (29.97 fps)' },
	{ format: 'ntsc-frames', group: 'Video frames', label: 'NTSC frames (29.97 fps)' },
	{ format: 'hh:mm:ss+pal-frames', group: 'Video frames', label: 'hh:mm:ss + PAL frames (25 fps)' },
	{ format: 'pal-frames', group: 'Video frames', label: 'PAL frames (25 fps)' },
	{ format: 'hh:mm:ss+cdda-frames', group: 'CD frames', label: 'hh:mm:ss + CDDA frames (75 fps)' },
	{ format: 'cdda-frames', group: 'CD frames', label: 'CDDA frames (75 fps)' },
	{ format: 'beats:bars', label: 'beats:bars' },
]);
const FREQUENCY_FORMAT_OPTIONS: readonly TimeCodeFormatOption[] = Object.freeze([
	{ format: 'Hz', label: 'Hz' },
]);

export function timeCodeFormatOptionsForDomain(
	domain: TimeCodeFormatDomain,
	frameRate = 24,
): readonly TimeCodeFormatOption[] {
	if (domain === 'frequency') return FREQUENCY_FORMAT_OPTIONS;
	return TIME_FORMAT_OPTIONS.map((option) => ({
		...option, label: option.label.replace('24fps', `${frameRate}fps`),
	}));
}

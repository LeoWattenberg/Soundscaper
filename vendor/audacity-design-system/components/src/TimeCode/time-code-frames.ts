import type { TimeCodeFormat } from './time-code-formats';

export interface TimeCodeFrameFormat {
	readonly rate: number;
	readonly nominalRate: number;
	readonly drop: boolean;
	readonly total: boolean;
}

export function timeCodeFrameFormat(format: TimeCodeFormat, frameRate: number): TimeCodeFrameFormat | null {
	let rate: number;
	switch (format) {
		case 'hh:mm:ss+frames': case 'film-frames': rate = frameRate; break;
		case 'hh:mm:ss+cdda-frames': case 'cdda-frames': rate = 75; break;
		case 'hh:mm:ss+pal-frames': case 'pal-frames': rate = 25; break;
		case 'hh:mm:ss+ntsc-frames': case 'hh:mm:ss+ntsc-drop-frames': case 'ntsc-frames':
			rate = 30_000 / 1_001; break;
		default: return null;
	}
	return {
		rate,
		nominalRate: Math.ceil(rate),
		drop: format === 'hh:mm:ss+ntsc-drop-frames',
		total: !format.startsWith('hh:mm:ss+'),
	};
}

export function timeCodeFrameCount(seconds: number, rate: number, sampleRate?: number): number {
	const frames = seconds * rate;
	// Recover exact frame boundaries after a seconds round trip without rounding
	// positions that are still inside the previous frame up to the next frame.
	// A snapped frame can also land up to half an audio sample before its ideal time.
	const sampleRounding = sampleRate && sampleRate > 0 ? rate / (2 * sampleRate) : 0;
	return Math.floor(frames + sampleRounding + Number.EPSILON * Math.max(1, Math.abs(frames)) * 4);
}

export function timeCodeLabelledFrameCount(count: number, format: TimeCodeFrameFormat): number {
	if (!format.drop) return count;
	// NTSC drop-frame omits labels 00 and 01 at each minute except every tenth.
	const blocks = Math.floor(count / 17_982);
	const remainder = count % 17_982;
	const minutes = Math.max(0, Math.floor((remainder - 2) / 1_798));
	return count + 18 * blocks + 2 * minutes;
}

export function timeCodeFrameSeconds(units: readonly number[], format: TimeCodeFrameFormat): number {
	if (format.total) return units.reduce((sum, value) => sum * 1_000 + value, 0) / format.rate;
	const [hours = 0, minutes = 0, seconds = 0, frames = 0] = units;
	let labelled = (hours * 3_600 + minutes * 60 + seconds) * format.nominalRate + frames;
	if (format.drop) {
		const totalMinutes = Math.floor(labelled / (format.nominalRate * 60));
		// A digit edit may name an omitted label; advance to the first real frame.
		if (totalMinutes % 10 !== 0 && labelled % (format.nominalRate * 60) < 2) {
			labelled = totalMinutes * format.nominalRate * 60 + 2;
		}
		labelled -= 2 * (totalMinutes - Math.floor(totalMinutes / 10));
	}
	return labelled / format.rate;
}

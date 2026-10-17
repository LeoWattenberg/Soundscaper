import type { TimeCodeFormat } from './time-code-formats';

/** Free text semantics ported from Audacity design system 20ce5547. */
export function parseTimeText(text: string, format: TimeCodeFormat, sampleRate = 44100): number | null {
	const input = text.trim().toLowerCase().replace(/,/gu, '.').replace(/\s+/gu, '');
	if (!input) return null;
	let seconds: number;
	if (/^[+]?(\d+\.?\d*|\.\d+)$/u.test(input)) {
		seconds = Number(input) / (format === 'samples' ? sampleRate : 1);
	} else {
		const units = /^(?:(\d+\.?\d*)d)?(?:(\d+\.?\d*)h)?(?:(\d+\.?\d*)m)?(?:(\d+\.?\d*)s)?$/u.exec(input);
		if (units && units.slice(1).some(value => value !== undefined)) {
			seconds = Number(units[1] ?? 0) * 86400 + Number(units[2] ?? 0) * 3600 + Number(units[3] ?? 0) * 60 + Number(units[4] ?? 0);
		} else if (/^(\d+:)*(\d+\.?\d*|\.\d+)$/u.test(input)) {
			const parts = input.split(':').map(Number);
			if (parts.length > 4) return null;
			const weights = [1, 60, 3600, 86400];
			seconds = parts.reverse().reduce((sum, part, index) => sum + part * weights[index], 0);
		} else return null;
	}
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

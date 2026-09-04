/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * WCAG 2.1 relative luminance and contrast over the design system's colour
 * tokens. Every token is an opaque sRGB hex literal, so no compositing against
 * a backdrop is needed and the ratio is exact.
 */

const AA_TEXT_CONTRAST = 4.5;

function channelLuminance(channel: number): number {
	const value = channel / 255;
	return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function parseHexColor(color: string): readonly [number, number, number] | null {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(String(color).trim());
	if (!match) return null;
	const digits = match[1]!.length === 3
		? match[1]!.split('').map((digit) => `${digit}${digit}`)
		: [match[1]!.slice(0, 2), match[1]!.slice(2, 4), match[1]!.slice(4, 6)];
	return digits.map((pair) => Number.parseInt(pair, 16)) as unknown as readonly [number, number, number];
}

/** Relative luminance of an opaque sRGB hex colour, or null if it is not one. */
export function relativeLuminance(color: string): number | null {
	const channels = parseHexColor(color);
	if (!channels) return null;
	const [red, green, blue] = channels;
	return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

/** WCAG contrast ratio between two opaque colours, from 1 to 21; 0 when either is unreadable. */
export function wcagContrastRatio(foreground: string, background: string): number {
	const first = relativeLuminance(foreground);
	const second = relativeLuminance(background);
	if (first === null || second === null) return 0;
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Pick the first candidate text colour that clears AA on a fill, or, if none
 * does, the one that comes closest.
 *
 * A theme names one text token for body copy and another for the inverse
 * ground, and which of the two lands on a given control depends on how light
 * that control is painted — not on whether the theme is called dark. Choosing
 * by measurement keeps the answer right when a token is retuned upstream.
 */
export function readableTextColor(background: string, candidates: readonly string[]): string {
	let best = candidates[0] ?? '';
	let bestRatio = -1;
	for (const candidate of candidates) {
		const ratio = wcagContrastRatio(candidate, background);
		if (ratio > bestRatio) {
			best = candidate;
			bestRatio = ratio;
		}
		if (bestRatio >= AA_TEXT_CONTRAST) break;
	}
	return best;
}

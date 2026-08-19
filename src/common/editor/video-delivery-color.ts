/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The colours a video delivery may state.
 *
 * The grammar lived only in the FFmpeg argument builder, so a background colour
 * a delivery could not actually render was accepted by the plan and refused when
 * the arguments were assembled — after the audio mix had been rendered and
 * staged. An option is validated where it is stated, so the plan owns the
 * grammar and the adapter owns the spelling.
 */

/** `#rrggbb`, `#rrggbbaa`, and the `0x` form FFmpeg writes natively. */
const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;
const FFMPEG_HEX_COLOR = /^0x[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;
/** A named colour, optionally with an alpha suffix from 0 through 1. */
const NAMED_COLOR = /^[a-z][a-z0-9_-]*(?:@(?:0(?:\.\d+)?|1(?:\.0+)?))?$/iu;

export function isVideoDeliveryColor(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	return HEX_COLOR.test(value) || FFMPEG_HEX_COLOR.test(value) || NAMED_COLOR.test(value);
}

/**
 * The colour exactly as stated, or a refusal naming the field.
 *
 * Nothing is trimmed or case-folded: a plan states what it was given so two
 * deliveries that differ only in spelling remain distinguishable, and the
 * adapter converts when it writes its arguments.
 */
export function normalizeVideoDeliveryColor(value: unknown, name: string): string {
	if (!isVideoDeliveryColor(value)) {
		throw new TypeError(
			`${name} must be #rrggbb, #rrggbbaa, 0xrrggbb, or a colour name with an optional @alpha.`,
		);
	}
	return value;
}

export interface VideoDeliveryColorChannels {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
	readonly alpha: number;
}

/**
 * The colour as channels a renderer can clear to, or null for a name only
 * FFmpeg knows.
 *
 * The composed graph hands its background to FFmpeg, which resolves names from
 * its own palette. The keyed path clears a WebGL target itself and has no such
 * palette, so it resolves the hex spellings — which is what the dialog's colour
 * control produces — and states plainly that it cannot resolve the rest.
 */
export function videoDeliveryColorChannels(value: unknown): VideoDeliveryColorChannels | null {
	if (typeof value !== 'string') return null;
	const hex = value.startsWith('0x') || value.startsWith('0X')
		? value.slice(2)
		: value.startsWith('#') ? value.slice(1) : null;
	if (hex === null || (hex.length !== 6 && hex.length !== 8) || !/^[0-9a-f]+$/iu.test(hex)) return null;
	const channel = (index: number): number => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255;
	return Object.freeze({
		red: channel(0),
		green: channel(1),
		blue: channel(2),
		alpha: hex.length === 8 ? channel(3) : 1,
	});
}

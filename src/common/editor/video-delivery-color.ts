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

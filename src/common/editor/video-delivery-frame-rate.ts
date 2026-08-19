/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The delivery frame rates a dialog offers, and what each one means exactly.
 *
 * `29.97` is a name, not a number: the rate it names is 30000/1001, and the
 * decimal is 0.0001% away from it. Passing the truncated spelling through the
 * rational approximator produced 2997/100 — a rate no broadcast delivery uses,
 * in the milestone whose encode tier exists precisely to keep the exact
 * rational across an elementary-stream boundary. So the well-known spellings
 * resolve to their rationals here, and everything else is the number it says.
 *
 * The same table reads back the other way, so a preset carrying 30000/1001
 * shows the operator `29.97` rather than 29.97002997002997.
 */

export interface VideoDeliveryFrameRateChoice {
	/** What the operator sees and types. */
	readonly label: string;
	/** What the plan is given: a rational for the 1001-denominator rates. */
	readonly rate: number | Readonly<{ num: number; den: number }>;
}

const ntsc = (num: number): Readonly<{ num: number; den: number }> => Object.freeze({ num, den: 1_001 });

export const VIDEO_DELIVERY_FRAME_RATE_CHOICES: readonly VideoDeliveryFrameRateChoice[] = Object.freeze([
	Object.freeze({ label: '23.976', rate: ntsc(24_000) }),
	Object.freeze({ label: '24', rate: 24 }),
	Object.freeze({ label: '25', rate: 25 }),
	Object.freeze({ label: '29.97', rate: ntsc(30_000) }),
	Object.freeze({ label: '30', rate: 30 }),
	Object.freeze({ label: '47.952', rate: ntsc(48_000) }),
	Object.freeze({ label: '48', rate: 48 }),
	Object.freeze({ label: '50', rate: 50 }),
	Object.freeze({ label: '59.94', rate: ntsc(60_000) }),
	Object.freeze({ label: '60', rate: 60 }),
]);

/**
 * The rate a dialog's stated frame rate means.
 *
 * A spelling this product offers resolves to the rate it names; anything else
 * is the number the operator typed, which the plan builder validates as it
 * always did.
 */
export function resolveVideoDeliveryFrameRate(
	value: unknown,
): number | Readonly<{ num: number; den: number }> | null {
	const text = String(value ?? '').trim();
	if (!text) return null;
	const choice = VIDEO_DELIVERY_FRAME_RATE_CHOICES.find(({ label }) => label === text);
	if (choice) return choice.rate;
	const numeric = Number(text);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/** The spelling a stated rate is shown as, so a preset round-trips readably. */
export function videoDeliveryFrameRateLabel(value: unknown): string {
	if (value && typeof value === 'object') {
		const { num, den } = value as Readonly<{ num?: unknown; den?: unknown }>;
		const choice = VIDEO_DELIVERY_FRAME_RATE_CHOICES.find(({ rate }) => (
			typeof rate === 'object' && rate.num === num && rate.den === den
		));
		if (choice) return choice.label;
		return String(Number(num) / Number(den));
	}
	return String(value ?? '');
}

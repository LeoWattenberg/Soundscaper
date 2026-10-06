/* SPDX-License-Identifier: AGPL-3.0-only */

export const MINIMUM_CLIP_RESAMPLE_RATE = 8_000;
export const MAXIMUM_CLIP_RESAMPLE_RATE = 384_000;

export function parseClipResampleRate(draft: string): number | null {
	if (!draft.trim()) return null;
	const value = Number(draft);
	return Number.isSafeInteger(value) && value >= MINIMUM_CLIP_RESAMPLE_RATE
		&& value <= MAXIMUM_CLIP_RESAMPLE_RATE ? value : null;
}

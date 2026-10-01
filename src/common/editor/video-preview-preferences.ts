/* SPDX-License-Identifier: AGPL-3.0-only */

export type VideoPreviewResolution = 'full' | 'half' | 'quarter';

/** Persist preview quality independently of the document's export resolution. */
export function normalizeVideoPreviewResolution(value?: unknown): VideoPreviewResolution {
	if (value === undefined) return 'full';
	if (value === 'full' || value === 'half' || value === 'quarter') return value;
	throw new RangeError('view.videoPreviewResolution must be full, half or quarter.');
}

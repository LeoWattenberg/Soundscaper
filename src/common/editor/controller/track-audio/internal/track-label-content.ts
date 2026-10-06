/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { ControllerTrack } from '../track-domain-types.ts';

export interface TrackLabelContent {
	readonly trackId: string;
	readonly labelId: string;
	readonly start: number;
	readonly end: number;
}

/** Label regions and points belong to the same timing block as the track's clips. */
export function trackLabelContent(track: ControllerTrack): readonly TrackLabelContent[] {
	if (track.type !== 'label' || !Array.isArray(track.labels)) return [];
	return track.labels.map((value: unknown) => {
		if (!value || typeof value !== 'object') throw new TypeError('Expected label content.');
		const label = value as Readonly<Record<string, unknown>>;
		if (typeof label.id !== 'string' || !Number.isSafeInteger(label.startFrame)
			|| !Number.isSafeInteger(label.endFrame) || Number(label.startFrame) < 0
			|| Number(label.endFrame) < Number(label.startFrame)) throw new RangeError('Invalid label extent.');
		return { trackId: track.id, labelId: label.id, start: Number(label.startFrame), end: Number(label.endFrame) };
	});
}

export function moveTrackLabelContent(
	labels: readonly TrackLabelContent[],
	delta: number,
): Extract<AudioEditorCommand, { readonly type: 'label/update' }>[] {
	return labels.map(label => {
		const startFrame = label.start + delta;
		const endFrame = label.end + delta;
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
			|| startFrame < 0 || endFrame < startFrame) throw new RangeError('Invalid aligned label extent.');
		return { type: 'label/update', trackId: label.trackId, labelId: label.labelId,
			changes: { startFrame, endFrame } };
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTimelineViewportClipIndex } from '../../design-system-adapters/timeline-viewport-index.ts';

interface LabelInterval {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

/** Region spans and point flags retain input order and active editing ownership. */
export function createLabelViewportIndex<Label extends LabelInterval>(labels: readonly Label[]) {
	const wrappers = labels.map((label) => ({
		id: label.id, label, sourceId: '', sourceStartFrame: 0,
		timelineStartFrame: label.startFrame,
		durationFrames: Math.max(1, label.endFrame - label.startFrame),
	}));
	const index = createTimelineViewportClipIndex(wrappers);
	const labelById = new Map(labels.map((label) => [label.id, label]));
	const ordinalById = new Map(labels.map((label, ordinal) => [label.id, ordinal]));
	return {
		query(startFrame: number, endFrame: number, flagAllowanceFrames: number, retainedIds: readonly (string | null)[]) {
			const found = new Map(index.query(Math.max(0, startFrame - flagAllowanceFrames), endFrame + flagAllowanceFrames)
				.map(({ label }) => [label.id, label]));
			for (const id of retainedIds) {
				const label = id === null ? undefined : labelById.get(id);
				if (label) found.set(label.id, label);
			}
			return [...found.values()].sort((left, right) => ordinalById.get(left.id)! - ordinalById.get(right.id)!);
		},
	};
}

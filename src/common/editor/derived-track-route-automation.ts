/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from './automation-lane-v21.ts';
import type { AudioEditorCommand } from './commands/protocol.ts';

export interface DerivedTrackRouteCopy {
	readonly sourceEdgeId: string;
	readonly targetEdgeId: string;
}

/** Route IDs, unlike strip IDs, belong to the derived graph's actual edges. */
export function copyDerivedTrackRouteAutomation(
	project: Readonly<Record<string, unknown>>,
	staged: Readonly<Record<string, unknown>>,
	copies: readonly DerivedTrackRouteCopy[],
	createId: (prefix: string) => string,
): readonly AudioEditorCommand[] {
	if (!Array.isArray(project.automationLanes)) return [];
	const existing = new Set((Array.isArray(staged.automationLanes) ? staged.automationLanes : [])
		.map((value: unknown) => normalizeAutomationLaneV21(value))
		.flatMap(lane => lane.address.kind === 'edge' ? [lane.address.edgeId] : []));
	const commands: AudioEditorCommand[] = [];
	for (const value of project.automationLanes as readonly unknown[]) {
		const original = normalizeAutomationLaneV21(value);
		if (original.address.kind !== 'edge') continue;
		for (const copy of copies) {
			if (copy.sourceEdgeId !== original.address.edgeId || existing.has(copy.targetEdgeId)) continue;
			const restore = copy.sourceEdgeId === copy.targetEdgeId;
			const lane = normalizeAutomationLaneV21({ ...original,
				id: restore ? original.id : createId('automation-lane'),
				address: { ...original.address, edgeId: copy.targetEdgeId },
				points: original.points.map(point => ({ ...point,
					id: restore ? point.id : createId('automation-point') })),
			});
			existing.add(copy.targetEdgeId);
			commands.push({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane: { ...lane } });
		}
	}
	return commands;
}

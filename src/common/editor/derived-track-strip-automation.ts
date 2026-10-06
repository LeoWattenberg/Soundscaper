/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from './automation-lane-v21.ts';
import type { AudioEditorCommand } from './commands/protocol.ts';

/** A lifted clip retains its track's authored strip values at the same timeline positions. */
export function copyDerivedTrackStripAutomation(
	project: object,
	sourceTrackId: string,
	targetTrackId: string,
	createId: (prefix: string) => string,
	resetPan = false,
): readonly AudioEditorCommand[] {
	if (!('automationLanes' in project) || !Array.isArray(project.automationLanes)) return [];
	return project.automationLanes.flatMap((value: unknown): AudioEditorCommand[] => {
		const original = normalizeAutomationLaneV21(value);
		if (original.address.kind !== 'strip' || original.address.strip.kind !== 'track'
			|| original.address.strip.id !== sourceTrackId) return [];
		if (resetPan && original.address.parameterId === 'pan') return [];
		const restore = sourceTrackId === targetTrackId;
		const lane = normalizeAutomationLaneV21({
			...original,
			id: restore ? original.id : createId('automation-lane'),
			address: { ...original.address, strip: { kind: 'track', id: targetTrackId } },
			points: original.points.map(point => ({ ...point, id: restore ? point.id : createId('automation-point') })),
		});
		return [{ type: 'automation-lane/set', laneId: lane.id, expected: null, lane: { ...lane } }];
	});
}

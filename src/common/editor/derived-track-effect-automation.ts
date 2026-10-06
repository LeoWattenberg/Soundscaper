/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from './automation-lane-v21.ts';
import type { AudioEditorCommand } from './commands/protocol.ts';

/** Copy authored processor curves to the processors retained by a derived track. */
export function copyDerivedTrackEffectAutomation(
	project: object,
	sourceTrackId: string,
	targetTrackId: string,
	effectIds: ReadonlyMap<string, string>,
	createId: (prefix: string) => string,
): readonly AudioEditorCommand[] {
	if (!('automationLanes' in project) || !Array.isArray(project.automationLanes)) return [];
	return project.automationLanes.flatMap((value: unknown): AudioEditorCommand[] => {
		const original = normalizeAutomationLaneV21(value);
		const address = original.address;
		if (address.kind !== 'effect' || address.strip.kind !== 'track'
			|| address.strip.id !== sourceTrackId) return [];
		const effectId = effectIds.get(address.effectId);
		if (!effectId) return [];
		const restore = sourceTrackId === targetTrackId && effectId === address.effectId;
		const lane = normalizeAutomationLaneV21({
			...original,
			id: restore ? original.id : createId('automation-lane'),
			address: { ...address, strip: { kind: 'track', id: targetTrackId }, effectId },
			points: original.points.map(point => ({ ...point, id: restore ? point.id : createId('automation-point') })),
		});
		return [{ type: 'automation-lane/set', laneId: lane.id, expected: null, lane: { ...lane } }];
	});
}

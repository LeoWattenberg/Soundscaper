/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../automation-lane-v21.ts';
import { isSoundscaperProductionProjectSchema } from '../project-schema-version.ts';
import {
	compileAutomationLaneEventsV21,
	scheduleAutomationLaneV21,
	type ScheduleAutomationLaneOptionsV21,
} from './automation-lane-scheduler-v21.ts';
import type {
	ScheduledParameterEvent,
	ScheduledParameterRegistry,
} from './scheduled-parameter-registry.ts';
import type { EngineProject } from './types.ts';

export interface ScheduledProjectAutomationLaneV21 {
	readonly laneId: string;
	readonly events: readonly ScheduledParameterEvent[];
}

/** Schedule one complete graph window after preflighting every lane target and event bound. */
export function scheduleProjectAutomationLanesV21(
	project: EngineProject,
	registry: Pick<ScheduledParameterRegistry, 'get' | 'getSuspendedParameter'>,
	options: ScheduleAutomationLaneOptionsV21,
): readonly ScheduledProjectAutomationLaneV21[] {
	if (!isSoundscaperProductionProjectSchema(project.schemaVersion)) return Object.freeze([]);
	if (!Array.isArray(project.automationLanes)) {
		throw new TypeError('A V21 project requires an automationLanes array.');
	}
	const lanes = project.automationLanes.map((value) => normalizeAutomationLaneV21(value));
	const activeLanes = [];
	for (const lane of lanes) {
		const target = registry.get(lane.address);
		const descriptor = target?.descriptor ?? registry.getSuspendedParameter(lane.address);
		if (!descriptor) throw new ReferenceError(`Automation lane ${lane.id} has no active graph target.`);
		compileAutomationLaneEventsV21(lane, {
			fromFrame: options.fromFrame,
			toFrame: options.toFrame,
			sampleRate: options.sampleRate,
			tempoMap: options.tempoMap,
			descriptor,
			maximumEvents: options.maximumEvents,
		});
		if (target) activeLanes.push(lane);
	}
	return Object.freeze(activeLanes.map((lane) => Object.freeze({
		laneId: lane.id,
		events: scheduleAutomationLaneV21(lane, registry, options),
	})));
}

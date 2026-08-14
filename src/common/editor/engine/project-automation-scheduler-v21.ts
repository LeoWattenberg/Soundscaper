/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../automation-lane-v21.ts';
import { SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION } from '../project-schema-version.ts';
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
	registry: Pick<ScheduledParameterRegistry, 'get'>,
	options: ScheduleAutomationLaneOptionsV21,
): readonly ScheduledProjectAutomationLaneV21[] {
	if (project.schemaVersion !== SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION) return Object.freeze([]);
	if (!Array.isArray(project.automationLanes)) {
		throw new TypeError('A V21 project requires an automationLanes array.');
	}
	const lanes = project.automationLanes.map((value) => normalizeAutomationLaneV21(value));
	for (const lane of lanes) {
		const target = registry.get(lane.address);
		if (!target) throw new ReferenceError(`Automation lane ${lane.id} has no active graph target.`);
		compileAutomationLaneEventsV21(lane, {
			fromFrame: options.fromFrame,
			toFrame: options.toFrame,
			sampleRate: options.sampleRate,
			tempoMap: options.tempoMap,
			descriptor: target.descriptor,
			maximumEvents: options.maximumEvents,
		});
	}
	return Object.freeze(lanes.map((lane) => Object.freeze({
		laneId: lane.id,
		events: scheduleAutomationLaneV21(lane, registry, options),
	})));
}

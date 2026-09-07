/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorTimelineDurationFrames as currentEditorTimelineDurationFrames,
	projectDurationFrames as currentProjectDurationFrames,
} from '../project.js';

type ProjectMetricInput = Parameters<typeof currentProjectDurationFrames>[0];

export interface ControllerProjectRuntimeMetrics {
	readonly projectDurationFrames: (project: unknown) => number;
	readonly editorTimelineDurationFrames: (
		project: unknown,
		sampleRate?: number,
	) => number;
}

/** Keep shared view metrics behind the same selected transient runtime boundary. */
export function createControllerProjectRuntimeMetrics(
	runtime: Readonly<{ projectForRuntimeConsumers(project: unknown): unknown }>,
): Readonly<ControllerProjectRuntimeMetrics> {
	return Object.freeze({
		projectDurationFrames: (project: unknown) => currentProjectDurationFrames(
			runtime.projectForRuntimeConsumers(project) as unknown as ProjectMetricInput,
		),
		editorTimelineDurationFrames: (project: unknown, sampleRate?: number) => (
			currentEditorTimelineDurationFrames(
				runtime.projectForRuntimeConsumers(project) as unknown as ProjectMetricInput,
				sampleRate,
			)
		),
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorTimelineDurationFrames as currentEditorTimelineDurationFrames,
	projectDurationFrames as currentProjectDurationFrames,
} from '../project.js';
import type { ControllerProjectRuntime, ControllerRuntimeProject } from './project-runtime.ts';

type ProjectMetricInput = Parameters<typeof currentProjectDurationFrames>[0];

export interface ControllerProjectRuntimeMetrics {
	readonly projectDurationFrames: (project: ControllerRuntimeProject) => number;
	readonly editorTimelineDurationFrames: (
		project: ControllerRuntimeProject,
		sampleRate?: number,
	) => number;
}

/** Keep shared view metrics behind the same selected transient runtime boundary. */
export function createControllerProjectRuntimeMetrics(
	runtime: Pick<ControllerProjectRuntime, 'projectForRuntimeConsumers'>,
): Readonly<ControllerProjectRuntimeMetrics> {
	return Object.freeze({
		projectDurationFrames: (project: ControllerRuntimeProject) => currentProjectDurationFrames(
			runtime.projectForRuntimeConsumers(project) as unknown as ProjectMetricInput,
		),
		editorTimelineDurationFrames: (project: ControllerRuntimeProject, sampleRate?: number) => (
			currentEditorTimelineDurationFrames(
				runtime.projectForRuntimeConsumers(project) as unknown as ProjectMetricInput,
				sampleRate,
			)
		),
	});
}

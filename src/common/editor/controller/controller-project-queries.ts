/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectForRuntimeConsumers } from '../project-current-runtime.ts';
import type { RuntimeClipProject } from '../runtime-clip-projection.ts';
import { normalizeEditorExportSettings } from './export-settings.ts';
import type { EffectSelection } from './effect-selection-service.ts';

type ProjectRecord = Readonly<Record<string, unknown>>;

export interface ControllerProjectQueryDependencies {
	readonly getProject: () => ProjectRecord | null;
	readonly projectSampleRate: () => number;
}

/** Resolve command coordinates only after a document has been activated. */
export function createCommandProjectReader<Project extends object, Projection>(
	getProject: () => Project | null,
	projectForCommandConsumers: (project: Project) => Projection,
): () => NonNullable<Projection> {
	return () => {
		const project = getProject();
		if (!project) throw new Error('Clip editing requires an open project.');
		const projection = projectForCommandConsumers(project);
		if (projection == null) throw new TypeError('The project runtime did not produce a command projection.');
		return projection;
	};
}

/** Product command hooks retain their fields; controller readers always get resolved timing. */
export function createResolvedCommandProjectReader<Project extends object, Projection extends RuntimeClipProject>(
	getProject: () => Project | null,
	projectForCommandConsumers: (project: Project) => Projection,
) {
	const readProjection = createCommandProjectReader(getProject, projectForCommandConsumers);
	return readResolvedCommandProject;

	function readResolvedCommandProject() {
		const projection = readProjection();
		return projectForRuntimeConsumers(projection);
	}
}

/** Read only admitted selection fields; opaque documents remain unchanged. */
export function createControllerProjectQueries(dependencies: ControllerProjectQueryDependencies) {
	return Object.freeze({
		activeSelection(): (EffectSelection & ProjectRecord) | null {
			const selection = dependencies.getProject()?.selection;
			return isActiveSelection(selection) ? selection : null;
		},
		normalizeExportSettings(value: unknown = {}) {
			const metadata = dependencies.getProject()?.metadata;
			return normalizeEditorExportSettings(
				isRecord(value) ? value : {}, dependencies.projectSampleRate(),
				isRecord(metadata) ? metadata.tags || {} : {},
			);
		},
	});
}

function isActiveSelection(value: unknown): value is EffectSelection & ProjectRecord {
	if (!isRecord(value)
		|| typeof value.startFrame !== 'number' || !Number.isSafeInteger(value.startFrame) || value.startFrame < 0
		|| typeof value.endFrame !== 'number' || !Number.isSafeInteger(value.endFrame) || value.endFrame <= value.startFrame) return false;
	for (const ids of [value.trackIds, value.clipIds]) {
		if (ids !== undefined && (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string'))) return false;
	}
	const range = value.frequencyRange;
	return range == null || (isRecord(range)
		&& typeof range.minimumFrequency === 'number' && Number.isFinite(range.minimumFrequency) && range.minimumFrequency >= 0
		&& typeof range.maximumFrequency === 'number' && Number.isFinite(range.maximumFrequency)
		&& range.maximumFrequency >= range.minimumFrequency);
}

function isRecord(value: unknown): value is ProjectRecord {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

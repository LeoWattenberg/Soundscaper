/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEditorExportSettings } from './export-settings.ts';
import type { EffectSelection } from './effect-selection-service.ts';

type ProjectRecord = Readonly<Record<string, unknown>>;

export interface ControllerProjectQueryDependencies {
	readonly getProject: () => ProjectRecord | null;
	readonly projectSampleRate: () => number;
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

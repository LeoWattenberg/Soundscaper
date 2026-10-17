/* SPDX-License-Identifier: AGPL-3.0-only */

import { freezeProjectFeatureReportMetadata } from './project-feature-report-metadata.ts';
import { createSessionRetentionIndex } from './session-retention-index.ts';
import { clone, createHistory, validateProject } from './session-history.js';

export function normalizeTab(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A project tab is required.');
	const project = validateProject(value.project || value.history?.present, 'tab project');
	if (value.projectId != null && value.projectId !== project.id) {
		throw new RangeError('Project tab ID does not match its project history.');
	}
	const history = createHistory(project, value.history);
	const retentionIndex = createSessionRetentionIndex(history);
	const normalizedProject = history.present;
	const readOnly = Boolean(value.readOnly);
	return {
		projectId: normalizedProject.id,
		history,
		historyToken: Object.freeze({}),
		retentionIndex, sourceIds: retentionIndex.getSourceIds(),
		readOnly,
		readOnlyReason: readOnly ? String(value.readOnlyReason || 'read-only') : null,
		lockMethod: value.lockMethod == null ? null : String(value.lockMethod),
		dirty: Boolean(value.dirty),
		metadata: freezeProjectFeatureReportMetadata(clone(value.metadata || {})),
	};
}

export function countsFor(tabs, clipboard, collectSources) {
	const counts = new Map();
	const add = (sourceId) => counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
	for (const tab of tabs) {
		for (const sourceId of tab.sourceIds) add(sourceId);
	}
	for (const sourceId of collectSources(clipboard)) add(sourceId);
	return counts;
}

export function countsObject(counts) {
	return Object.fromEntries([...counts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

export function releasedBetween(before, after) {
	return [...before]
		.filter(([sourceId, count]) => count > 0 && !after.has(sourceId))
		.map(([sourceId]) => sourceId)
		.sort();
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from './history.js';

export function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

export function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

export function positiveInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return value;
}

export function nonNegativeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value;
}

export function validateProject(project, name = 'project') {
	if (!project || typeof project !== 'object') throw new TypeError(`A ${name} is required.`);
	positiveInteger(project.schemaVersion, `${name}.schemaVersion`);
	nonEmptyString(project.id, `${name}.id`);
	nonEmptyString(project.title, `${name}.title`);
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError(`${name} sources, clips, and tracks must be arrays.`);
	}
	return project;
}

export function normalizeProject(project, name = 'project') {
	return clone(validateProject(project, name));
}

export function createHistory(project, history) {
	if (!history) {
		return {
			limit: AUDIO_EDITOR_HISTORY_LIMIT,
			present: normalizeProject(project),
			undoStack: [],
			redoStack: [],
		};
	}
	if (!history || typeof history !== 'object') throw new TypeError('Project history is required.');
	positiveInteger(history.limit, 'history.limit');
	if (!Array.isArray(history.undoStack) || !Array.isArray(history.redoStack)) {
		throw new TypeError('Project history stacks must be arrays.');
	}
	const normalized = clone(history);
	const present = validateProject(normalized.present, 'history.present');
	if (present.id !== project.id) throw new RangeError('Project history must belong to the open project.');
	const normalizeEntry = (entry, name) => {
		if (!entry || typeof entry !== 'object') throw new TypeError(`${name} must be a history entry.`);
		const snapshot = validateProject(entry.project, `${name}.project`);
		if (snapshot.id !== project.id) throw new RangeError(`${name} belongs to another project.`);
		return entry;
	};
	return {
		...normalized,
		limit: normalized.limit,
		present,
		undoStack: normalized.undoStack.map((entry, index) => normalizeEntry(entry, `history.undoStack[${index}]`)),
		redoStack: normalized.redoStack.map((entry, index) => normalizeEntry(entry, `history.redoStack[${index}]`)),
	};
}

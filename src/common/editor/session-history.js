/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from './history.js';
import { editorHistoryProjects } from './retention.js';

/** @template Value @param {Value} value @returns {Value} */
export function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

/** Return only detached retention identifiers, never projects or history nodes. */
export function collectHistoryRetentionRoots(histories) {
	const clipIds = new Set();
	const assistanceSourceIds = new Set();
	for (const history of histories) for (const project of editorHistoryProjects(history)) {
		for (const clip of project.clips || []) clipIds.add(clip.id);
		for (const clip of Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : []) {
			clipIds.add(clip.id);
		}
		for (const asset of project.assistanceAssets || []) {
			if (typeof asset.sourceId === 'string' && asset.sourceId) assistanceSourceIds.add(asset.sourceId);
		}
	}
	return { clipIds, assistanceSourceIds };
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
	return normalizedHistory(project, history, true);
}

/**
 * Reuse controller-owned plain data after making every reachable node immutable.
 * A previously admitted node can be shared by later histories without walking
 * its descendants again. Exotic mutable values retain the ordinary clone path.
 */
export function adoptImmutableHistory(project, history, knownImmutable) {
	const normalized = normalizedHistory(project, history, false);
	if (normalized.present.schemaVersion !== project.schemaVersion) return normalized;
	const candidates = freezeCandidates(history, knownImmutable);
	if (!candidates) return null;
	try {
		for (const node of candidates) {
			Object.freeze(node);
			knownImmutable.add(node);
		}
	} catch {
		return null;
	}
	return normalized;
}

function freezeCandidates(value, knownImmutable) {
	const candidates = [];
	const visited = new WeakSet();
	const visiting = new WeakSet();
	const visit = (node) => {
		if (typeof node === 'function') return false;
		if (!node || typeof node !== 'object' || knownImmutable.has(node)) return true;
		if (visiting.has(node)) return false;
		if (visited.has(node)) return true;
		const prototype = Object.getPrototypeOf(node);
		if (Array.isArray(node) ? prototype !== Array.prototype
			: prototype !== Object.prototype && prototype !== null) return false;
		visiting.add(node);
		for (const key of Reflect.ownKeys(node)) {
			if (typeof key !== 'string') return false;
			const descriptor = Object.getOwnPropertyDescriptor(node, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || !visit(descriptor.value)) return false;
		}
		visiting.delete(node);
		visited.add(node);
		candidates.push(node);
		return true;
	};
	return visit(value) ? candidates : null;
}

function normalizedHistory(project, history, copy) {
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
	const normalized = copy ? clone(history) : history;
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

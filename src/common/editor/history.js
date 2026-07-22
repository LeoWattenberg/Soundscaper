import { applyEditorCommand } from './commands.js';
import { cloneProject, validateAudioEditorProject } from './project.js';

export const AUDIO_EDITOR_HISTORY_LIMIT = 200;

/**
 * @typedef {Object} AudioEditorHistory
 * @property {number} limit
 * @property {Object} present
 * @property {Array<{project: Object, command: Object}>} undoStack
 * @property {Array<{project: Object, command: Object}>} redoStack
 */

/** @returns {AudioEditorHistory} */
export function createEditorHistory(project, options = {}) {
	validateAudioEditorProject(project);
	const limit = options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT;
	if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('History limit must be a positive integer.');
	return {
		limit,
		present: cloneProject(project),
		undoStack: [],
		redoStack: [],
	};
}

export function executeEditorCommand(history, command, options = {}) {
	const nextProject = applyEditorCommand(history.present, command, options);
	return {
		...history,
		present: nextProject,
		undoStack: [...history.undoStack, { project: history.present, command }].slice(-history.limit),
		redoStack: [],
	};
}

export function undoEditorCommand(history, options = {}) {
	if (!history.undoStack.length) return history;
	const entry = history.undoStack[history.undoStack.length - 1];
	const restored = restoreSnapshot(entry.project, history.present, options.now);
	return {
		...history,
		present: restored,
		undoStack: history.undoStack.slice(0, -1),
		redoStack: [...history.redoStack, { project: history.present, command: entry.command }].slice(-history.limit),
	};
}

export function redoEditorCommand(history, options = {}) {
	if (!history.redoStack.length) return history;
	const entry = history.redoStack[history.redoStack.length - 1];
	const restored = restoreSnapshot(entry.project, history.present, options.now);
	return {
		...history,
		present: restored,
		undoStack: [...history.undoStack, { project: history.present, command: entry.command }].slice(-history.limit),
		redoStack: history.redoStack.slice(0, -1),
	};
}

export function clearEditorHistory(history) {
	return { ...history, undoStack: [], redoStack: [] };
}

export function canUndo(history) {
	return history.undoStack.length > 0;
}

export function canRedo(history) {
	return history.redoStack.length > 0;
}

function restoreSnapshot(snapshot, current, now = new Date()) {
	const restored = cloneProject(snapshot);
	restored.revision = current.revision + 1;
	restored.updatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
	validateAudioEditorProject(restored);
	return restored;
}

import { applyEditorCommand } from './commands.js';
import { snapshotInertEditorCommand } from './commands/editor-command-snapshot.ts';
import { cloneProject, validateAudioEditorProject } from './project.js';

export const AUDIO_EDITOR_HISTORY_LIMIT = 200;

/**
 * @typedef {Object} AudioEditorHistory
 * @property {number} limit
 * @property {Object} present
 * @property {Array<{project: Object, command: Object}>} undoStack
 * @property {Array<{project: Object, command: Object}>} redoStack
 * @property {number} dropped how many entries the limit has pushed off the
 *   bottom of the undo stack over this history's life, so a macro depth stays a
 *   position in the whole sequence of commits rather than an index into a stack
 *   that shifts underneath it
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
		dropped: 0,
	};
}

export function executeEditorCommand(history, command, options = {}) {
	const nextProject = applyEditorCommand(history.present, command, options);
	const pushed = [...history.undoStack, {
		project: history.present,
		command: snapshotInertEditorCommand(command),
	}];
	const undoStack = pushed.slice(-history.limit);
	return {
		...history,
		present: nextProject,
		undoStack,
		redoStack: [],
		dropped: droppedCount(history) + (pushed.length - undoStack.length),
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
		redoStack: [...history.redoStack, {
			project: history.present,
			command: snapshotInertEditorCommand(entry.command),
		}].slice(-history.limit),
		dropped: droppedCount(history),
	};
}

export function redoEditorCommand(history, options = {}) {
	if (!history.redoStack.length) return history;
	const entry = history.redoStack[history.redoStack.length - 1];
	const restored = restoreSnapshot(entry.project, history.present, options.now);
	const pushed = [...history.undoStack, {
		project: history.present,
		command: snapshotInertEditorCommand(entry.command),
	}];
	const undoStack = pushed.slice(-history.limit);
	return {
		...history,
		present: restored,
		undoStack,
		redoStack: history.redoStack.slice(0, -1),
		dropped: droppedCount(history) + (pushed.length - undoStack.length),
	};
}

/**
 * Fold everything committed since a depth into one entry.
 *
 * A macro is one action to the person who ran it, so it has to be one undo. It
 * cannot be planned as a single command up front: an effect step writes audio
 * asynchronously and only then knows what it produced. So the steps commit
 * normally and the range they added is replaced here by one entry holding the
 * project as it stood before the macro began — which is exactly what undo
 * restores, because undo restores a whole snapshot rather than inverting
 * commands.
 *
 * The depth is where the macro started, counted in commits rather than slots.
 * Entries below it are the user's own history and are never touched. A macro on
 * a full stack pushes the entries below it off the bottom as it runs, so the
 * depth is turned back into an index by taking those dropped entries off it —
 * without that correction the opening entry would be looked up at a slot that
 * now holds a mid-macro snapshot, or past the end of the stack entirely.
 */
export function collapseEditorHistory(history, depth, command) {
	const undoDepth = boundedDepth(history, depth);
	if (history.undoStack.length <= undoDepth) return history;
	const opening = history.undoStack[undoDepth];
	return {
		...history,
		undoStack: [...history.undoStack.slice(0, undoDepth), {
			project: opening.project,
			command: snapshotInertEditorCommand(command),
		}].slice(-history.limit),
		redoStack: [],
		dropped: droppedCount(history),
	};
}

/**
 * Put the project back as it stood at a depth and drop what was committed since.
 *
 * Audacity rolls a failed macro back and removes the entry it opened with, so a
 * macro that fails half way leaves nothing behind. The restored project takes a
 * fresh revision the way undo does, so anything holding a revision sees the
 * change rather than silently keeping stale state.
 */
export function rollbackEditorHistory(history, depth, options = {}) {
	const undoDepth = boundedDepth(history, depth);
	if (history.undoStack.length <= undoDepth) return history;
	const opening = history.undoStack[undoDepth];
	return {
		...history,
		present: restoreSnapshot(opening.project, history.present, options.now),
		undoStack: history.undoStack.slice(0, undoDepth),
		redoStack: [],
		dropped: droppedCount(history),
	};
}

/**
 * Turn the depth a macro opened at into an index into the stack as it stands now.
 *
 * The depth counts commits, not slots: a macro's own steps push the entries
 * below it off the bottom once the history is full, so an index captured when
 * the macro began would name a mid-macro snapshot — or, on a stack that was
 * already full, name nothing at all and settle the macro into a no-op. Taking
 * the entries the limit has dropped since then back off keeps it naming the
 * entry the macro opened with. A macro longer than the whole limit has pushed
 * that entry off the end too, and clamps to the oldest one left.
 */
function boundedDepth(history, depth) {
	const undoDepth = Number(depth);
	if (!Number.isInteger(undoDepth) || undoDepth < 0) {
		throw new RangeError('A history depth must be a non-negative integer.');
	}
	const index = undoDepth - droppedCount(history);
	return Math.min(Math.max(index, 0), history.undoStack.length);
}

/** A history written before the count existed simply has not dropped anything yet. */
function droppedCount(history) {
	const value = Number(history.dropped ?? 0);
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('A history dropped count must be a non-negative safe integer.');
	}
	return value;
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

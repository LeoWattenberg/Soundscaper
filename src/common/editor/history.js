import { applyEditorCommand } from './commands.js';
import { snapshotInertEditorCommand } from './commands/editor-command-snapshot.ts';
import {
	collapseEditorProjectHistory,
	createEditorProjectHistory,
	executeEditorProjectCommand,
	redoEditorProjectCommand,
	rollbackEditorProjectHistory,
	undoEditorProjectCommand,
} from './project-history-mechanics.ts';
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

/**
 * The shared editor document, read by the mechanics every product's history uses.
 *
 * Two readings are this history's own. A stored history is taken as given rather
 * than validated on every command, because the document validates itself as each
 * command applies and as each snapshot is restored; and the outgoing document
 * becomes an entry without being copied, because nothing here mutates a project
 * in place.
 */
const AUDIO_EDITOR_REVISION = {
	label: 'Audio editor',
	tracksDropped: true,
	validatesHistory: false,
	snapshotPushedProject: false,
	validateProject: (project) => { validateAudioEditorProject(project); },
	cloneProject: (project) => cloneProject(project),
	snapshotCommand: (command) => snapshotInertEditorCommand(command),
	applyCommand: (project, command, options) => applyEditorCommand(project, command, options),
};

/** Keep whatever else a caller has hung on the history, and its identity when nothing moved. */
function merged(history, next) {
	return next === history ? history : { ...history, ...next };
}

/** @returns {AudioEditorHistory} */
export function createEditorHistory(project, options = {}) {
	return createEditorProjectHistory(project, AUDIO_EDITOR_REVISION, AUDIO_EDITOR_HISTORY_LIMIT, options);
}

export function executeEditorCommand(history, command, options = {}) {
	return merged(history, executeEditorProjectCommand(history, command, AUDIO_EDITOR_REVISION, options));
}

export function undoEditorCommand(history, options = {}) {
	return merged(history, undoEditorProjectCommand(history, AUDIO_EDITOR_REVISION, options));
}

export function redoEditorCommand(history, options = {}) {
	return merged(history, redoEditorProjectCommand(history, AUDIO_EDITOR_REVISION, options));
}

/**
 * Fold everything committed since a depth into one entry.
 *
 * A macro is one action to the person who ran it, so it has to be one undo. It
 * cannot be planned as a single command up front: an effect step writes audio
 * asynchronously and only then knows what it produced. So the steps commit
 * normally and the range they added is replaced by one entry holding the project
 * as it stood before the macro began — which is exactly what undo restores,
 * because undo restores a whole snapshot rather than inverting commands.
 *
 * The depth is where the macro started, counted in commits rather than slots, so
 * a macro that pushes the entries below it off the bounded stack still names the
 * entry it opened with. The correction lives in the shared mechanics.
 */
export function collapseEditorHistory(history, depth, command) {
	return merged(history, collapseEditorProjectHistory(history, depth, command, AUDIO_EDITOR_REVISION));
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
	return merged(history, rollbackEditorProjectHistory(history, depth, AUDIO_EDITOR_REVISION, options));
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

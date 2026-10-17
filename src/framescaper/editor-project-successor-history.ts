/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { assertBoundedJsonStructureV1 } from '../common/editor/bounded-json-structure-v1.ts';
import { createEditorProjectHistory, cloneEditorProjectHistory, executeEditorProjectCommand, undoEditorProjectCommand, redoEditorProjectCommand, type EditorProjectHistoryRevision, type EditorProjectHistoryState } from '../common/editor/project-history-mechanics.ts';
import { freezeMotionValue } from '../common/editor/motion-values.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { applyFramescaperSuccessorCommand, snapshotFramescaperSuccessorCommand, type FramescaperSuccessorCommand } from './editor-project-successor-commands.ts';
import type { FramescaperProjectCommandOptions } from './editor-project-commands.ts';
export interface FramescaperSuccessorHistoryEntry { readonly project: FramescaperSuccessorProject; readonly command: FramescaperSuccessorCommand }
export interface FramescaperSuccessorHistory {
	readonly limit: number; readonly present: FramescaperSuccessorProject;
	readonly undoStack: readonly FramescaperSuccessorHistoryEntry[]; readonly redoStack: readonly FramescaperSuccessorHistoryEntry[];
}
const REVISION: EditorProjectHistoryRevision<FramescaperSuccessorCommand, FramescaperProjectCommandOptions> = {
	label: 'Framescaper successor', shape: 'closed', maximumLimit: AUDIO_EDITOR_HISTORY_LIMIT,
	admitStructure: (value) => assertBoundedJsonStructureV1(value, { maximumDepth: 128, maximumNodes: 2_000_000, maximumStringBytes: 128 * 1024 * 1024 }),
	validateProject: (value) => { normalizeFramescaperSuccessorProject(value); },
	cloneProject: (value) => structuredClone(normalizeFramescaperSuccessorProject(value)),
	snapshotCommand: snapshotFramescaperSuccessorCommand,
	applyCommand: (project, command, options) => applyFramescaperSuccessorCommand(project, command, options),
};
function result(value: EditorProjectHistoryState<FramescaperSuccessorCommand>): FramescaperSuccessorHistory {
	return freezeMotionValue(value) as unknown as FramescaperSuccessorHistory;
}
/** Closed bounded JSON intent, suitable for the atomic owner/link repository. */
export function normalizeFramescaperSuccessorHistory(value: unknown): FramescaperSuccessorHistory { return result(cloneEditorProjectHistory(value, REVISION)); }
export function createFramescaperSuccessorHistory(project: unknown, options: Readonly<{ limit?: number }> = {}): FramescaperSuccessorHistory { return result(createEditorProjectHistory(project, REVISION, AUDIO_EDITOR_HISTORY_LIMIT, options)); }
export function executeFramescaperSuccessorHistory(history: unknown, command: unknown, options: FramescaperProjectCommandOptions = {}): FramescaperSuccessorHistory { return result(executeEditorProjectCommand(history, command, REVISION, options)); }
export function undoFramescaperSuccessorHistory(history: unknown, options: FramescaperProjectCommandOptions = {}): FramescaperSuccessorHistory { return result(undoEditorProjectCommand(history, REVISION, options)); }
export function redoFramescaperSuccessorHistory(history: unknown, options: FramescaperProjectCommandOptions = {}): FramescaperSuccessorHistory { return result(redoEditorProjectCommand(history, REVISION, options)); }

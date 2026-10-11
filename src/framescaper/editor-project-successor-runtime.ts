/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { ControllerRuntimeHistory } from '../common/editor/controller/document/project-runtime.ts';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import { createEditorProjectRuntimeSelection } from './editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { FRAMESCAPER_SUCCESSOR_RUNTIME_PROFILE } from './editor-project-successor-runtime-profile.ts';
import { FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE, assertFramescaperSuccessorLine, migrateFramescaperSuccessorProject, normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { framescaperSuccessorBaselineProject, applyFramescaperSuccessorCommand } from './editor-project-successor-commands.ts';
import { executeFramescaperSuccessorHistory, undoFramescaperSuccessorHistory, redoFramescaperSuccessorHistory } from './editor-project-successor-history.ts';
import { createFramescaperSuccessorHistoryCustody } from './editor-project-successor-history-custody.ts';
import { createFramescaperSuccessorSessionAuthority } from './editor-project-successor-session.ts';
import type { FramescaperProjectOptions } from './editor-project.ts';
import type { FramescaperProjectCommandOptions } from './editor-project-commands.ts';
import { framescaperSuccessorOpaqueProject, framescaperSuccessorOpaqueHistory } from './editor-project-successor-opaque.ts';
import { createStableId } from '../common/editor/stable-id.js';
/** Exact v2 ownership wraps the existing timeline engine through explicit transient v1 projections. */
export function createFramescaperSuccessorRuntime(options: Readonly<{ line: unknown }>) {
	assertFramescaperSuccessorLine(options.line); const baseline = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const custody = createFramescaperSuccessorHistoryCustody(); const session = createFramescaperSuccessorSessionAuthority(custody.remember);
	// Ephemeral view identities cannot collide with authored owners or acquire their write fences.
	const opaquePrefix = `${createStableId('opaque-session')}:`;
	const openOpaqueProject = (value: unknown) => {
		const opaque = framescaperSuccessorOpaqueProject(value); if (!opaque) throw new TypeError('Opaque session admission requires a foreign or future document.');
		return Object.freeze({ ...opaque, id: `${opaquePrefix}${createStableId('archive')}` });
	};
	const consumer = (value: unknown) => framescaperSuccessorOpaqueProject(value) ?? framescaperSuccessorBaselineProject(value);
	const projectForCommandConsumers = (value: unknown) => baseline.projectForCommandConsumers(consumer(value));
	return Object.freeze({
		assistanceAssetCommands: true, profile: FRAMESCAPER_SUCCESSOR_RUNTIME_PROFILE, storageProfile: FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE,
		openOpaqueProject,
		compatibility: Object.freeze({ evaluate: (value: unknown) => baseline.compatibility.evaluate(consumer(value)) }),
		createProject: (value: FramescaperProjectOptions = {}) => { session.assertEditable(); return migrateFramescaperSuccessorProject(baseline.createProject(value)); },
		cloneProject: (value: unknown) => framescaperSuccessorOpaqueProject(value) ?? custody.cloneProject(value), historyForSnapshot: custody.historyForSnapshot, retainStoredHistory: custody.retainStoredHistory,
		// Successor custody retains unused ordinary sources as well as linked companions. Cache cleanup cannot rewrite authored inventory.
		compactProjectSourceMetadata: (value: unknown, _compact: Readonly<{ preserveSourceIds: Iterable<string> }>) => custody.cloneProject(value),
		validateProject: (value: unknown): value is FramescaperSuccessorProject => { try { normalizeFramescaperSuccessorProject(value); return true; } catch { return false; } },
		loadProject(value: unknown) {
			const identity = classifyProjectSchemaIdentity(value, 'framescaper', 'successor');
			if (identity.disposition === 'legacy') throw new Error('Migrate the original Framescaper archive before opening it in the successor editor.');
			if (identity.disposition !== 'current') return Object.freeze({ project: openOpaqueProject(value), readOnly: true, intrinsicReadOnly: true, reason: identity.disposition === 'foreign' ? 'foreign-family' : 'newer-schema' });
			return Object.freeze({ project: custody.cloneProject(value), readOnly: false, intrinsicReadOnly: false, reason: null });
		},
		projectForCommandConsumers,
		projectForRuntimeConsumers: (value: unknown) => baseline.projectForRuntimeConsumers(consumer(value)),
		projectForEditClipboardConsumers: (value: unknown) => baseline.projectForEditClipboardConsumers(framescaperSuccessorBaselineProject(value)),
		prepareEditClipboardDescriptor: (value: unknown, clipboard: AudioEditorClipboard) => baseline.prepareEditClipboardDescriptor(framescaperSuccessorBaselineProject(value), clipboard),
		prepareEditDuplicateCommand: (value: unknown, clipboard: AudioEditorClipboard, command: AudioEditorCommand, createId: (prefix?: string) => string) => baseline.prepareEditDuplicateCommand(framescaperSuccessorBaselineProject(value), clipboard, command, createId),
		createEditSessionClipboard: (value: unknown, clipboard: AudioEditorClipboard) => baseline.createEditSessionClipboard(framescaperSuccessorBaselineProject(value), clipboard),
		prepareEditClipboardPasteCommand: (value: unknown, clipboard: unknown, command: AudioEditorCommand, createId: (prefix?: string) => string) => baseline.prepareEditClipboardPasteCommand(framescaperSuccessorBaselineProject(value), clipboard, command, createId),
		createHistory: (value: unknown) => framescaperSuccessorOpaqueHistory(value) ?? custody.createHistory(value),
		executeCommand: (history: unknown, command: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return custody.remember(executeFramescaperSuccessorHistory(history, command, moment)); },
		applyCommand: (value: unknown, command: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return applyFramescaperSuccessorCommand(value, command, moment); },
		undo: (history: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return custody.remember(undoFramescaperSuccessorHistory(history, moment)); },
		redo: (history: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return custody.remember(redoFramescaperSuccessorHistory(history, moment)); },
		canUndo: (history: ControllerRuntimeHistory) => history.undoStack.length > 0,
		canRedo: (history: ControllerRuntimeHistory) => history.redoStack.length > 0,
		createSessionController: session.createSessionController, beginPublication: session.beginPublication,
		acquireProjectLock: async (projectId: string, value: Readonly<{ force?: boolean }> = {}) => projectId.startsWith(opaquePrefix)
			? { projectId, readOnly: true, method: 'opaque-archive', retryAt: null, release() {} }
			: acquireProjectLock(projectId, { ...value, projectStorageProfile: FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE }),
	});
}

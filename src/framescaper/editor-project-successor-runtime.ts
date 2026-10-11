/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { ControllerRuntimeHistory } from '../common/editor/controller/document/project-runtime.ts';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import { createOpaqueProjectConsumer } from '../common/editor/project-opaque-consumer.ts';
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
/** Exact v2 ownership wraps the existing timeline engine through explicit transient v1 projections. */
export function createFramescaperSuccessorRuntime(options: Readonly<{ line: unknown }>) {
	assertFramescaperSuccessorLine(options.line); const baseline = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const custody = createFramescaperSuccessorHistoryCustody(); const session = createFramescaperSuccessorSessionAuthority(custody.remember);
	const projectForCommandConsumers = (value: unknown) => baseline.projectForCommandConsumers(framescaperSuccessorBaselineProject(value));
	return Object.freeze({
		assistanceAssetCommands: true, profile: FRAMESCAPER_SUCCESSOR_RUNTIME_PROFILE, storageProfile: FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE,
		compatibility: Object.freeze({ evaluate: (value: unknown) => baseline.compatibility.evaluate(framescaperSuccessorBaselineProject(value)) }),
		createProject: (value: FramescaperProjectOptions = {}) => { session.assertEditable(); return migrateFramescaperSuccessorProject(baseline.createProject(value)); },
		cloneProject: custody.cloneProject, historyForSnapshot: custody.historyForSnapshot, retainStoredHistory: custody.retainStoredHistory,
		compactProjectSourceMetadata: (value: unknown, compact: Readonly<{ preserveSourceIds: Iterable<string> }>) => {
			const project = normalizeFramescaperSuccessorProject(value);
			const preserveSourceIds = new Set([...compact.preserveSourceIds, ...project.compositionLinks.flatMap(({ sourceId, audioSourceId }) => audioSourceId ? [sourceId, audioSourceId] : [sourceId])]);
			const applied = baseline.compactProjectSourceMetadata(framescaperSuccessorBaselineProject(project), { preserveSourceIds });
			return custody.retainCompactedSnapshot(value, normalizeFramescaperSuccessorProject({ ...applied, schemaVersion: 2, compositionLinks: project.compositionLinks }));
		},
		validateProject: (value: unknown): value is FramescaperSuccessorProject => { try { normalizeFramescaperSuccessorProject(value); return true; } catch { return false; } },
		loadProject(value: unknown) {
			const identity = classifyProjectSchemaIdentity(value, 'framescaper', 'successor');
			if (identity.disposition === 'legacy') throw new Error('Migrate the original Framescaper archive before opening it in the successor editor.');
			if (identity.disposition !== 'current') return Object.freeze({ project: createOpaqueProjectConsumer(value, identity.identity), readOnly: true, intrinsicReadOnly: true, reason: identity.disposition === 'foreign' ? 'foreign-family' : 'newer-schema' });
			return Object.freeze({ project: custody.cloneProject(value), readOnly: false, intrinsicReadOnly: false, reason: null });
		},
		projectForCommandConsumers,
		projectForRuntimeConsumers: (value: unknown) => baseline.projectForRuntimeConsumers(framescaperSuccessorBaselineProject(value)),
		projectForEditClipboardConsumers: (value: unknown) => baseline.projectForEditClipboardConsumers(framescaperSuccessorBaselineProject(value)),
		prepareEditClipboardDescriptor: (value: unknown, clipboard: AudioEditorClipboard) => baseline.prepareEditClipboardDescriptor(framescaperSuccessorBaselineProject(value), clipboard),
		prepareEditDuplicateCommand: (value: unknown, clipboard: AudioEditorClipboard, command: AudioEditorCommand, createId: (prefix?: string) => string) => baseline.prepareEditDuplicateCommand(framescaperSuccessorBaselineProject(value), clipboard, command, createId),
		createEditSessionClipboard: (value: unknown, clipboard: AudioEditorClipboard) => baseline.createEditSessionClipboard(framescaperSuccessorBaselineProject(value), clipboard),
		prepareEditClipboardPasteCommand: (value: unknown, clipboard: unknown, command: AudioEditorCommand, createId: (prefix?: string) => string) => baseline.prepareEditClipboardPasteCommand(framescaperSuccessorBaselineProject(value), clipboard, command, createId),
		createHistory: custody.createHistory,
		executeCommand: (history: unknown, command: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return custody.remember(executeFramescaperSuccessorHistory(history, command, moment)); },
		applyCommand: (value: unknown, command: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return applyFramescaperSuccessorCommand(value, command, moment); },
		undo: (history: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return custody.remember(undoFramescaperSuccessorHistory(history, moment)); },
		redo: (history: unknown, moment: FramescaperProjectCommandOptions = {}) => { session.assertEditable(); return custody.remember(redoFramescaperSuccessorHistory(history, moment)); },
		canUndo: (history: ControllerRuntimeHistory) => history.undoStack.length > 0,
		canRedo: (history: ControllerRuntimeHistory) => history.redoStack.length > 0,
		createSessionController: session.createSessionController, beginPublication: session.beginPublication,
		acquireProjectLock: (projectId: string, value: Readonly<{ force?: boolean }> = {}) => acquireProjectLock(projectId, { ...value, projectStorageProfile: FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE }),
	});
}

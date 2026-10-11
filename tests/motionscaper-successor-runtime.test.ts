/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE, FRAMESCAPER_SUCCESSOR_RUNTIME_PROFILE } from '../src/framescaper/editor-project-successor-runtime-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import { resolveControllerProjectRuntime } from '../src/common/editor/controller/document/project-runtime.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperSuccessorHistory } from '../src/framescaper/editor-project-successor-history.ts';

test('successor queued snapshots retain their exact history across later edits and durable reopen', () => {
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	let history = runtime.createHistory(runtime.createProject({ id: 'queued' }));
	history = runtime.executeCommand(history, { type: 'project/rename', title: 'Queued' });
	const queued = runtime.cloneProject(history.present);
	history = runtime.executeCommand(history, { type: 'project/rename', title: 'Later' });
	assert.equal(runtime.historyForSnapshot(queued).present.title, 'Queued'); assert.equal(runtime.historyForSnapshot(queued).undoStack.length, 1);
	const reopened = runtime.retainStoredHistory(structuredClone(history));
	assert.deepEqual(runtime.createHistory(reopened), history); assert.equal(runtime.historyForSnapshot(reopened).present.title, 'Later');
	const loaded = runtime.loadProject(reopened); assert.deepEqual(runtime.createHistory(loaded.project), history);
	const session = runtime.createSessionController(); session.openProject(reopened, { history });
	const captured = session.captureProjectHistory(reopened.id); assert.deepEqual(runtime.historyForSnapshot(runtime.cloneProject(captured.history.present)), history);
	assert.deepEqual(runtime.historyForSnapshot(runtime.compactProjectSourceMetadata(captured.history.present, { preserveSourceIds: [] })), history);
	assert.throws(() => runtime.historyForSnapshot({ ...queued, title: 'Unauthenticated candidate' }), /history|snapshot/iu);
});

test('successor runtime is explicitly selected and keeps canonical v2 separate from baseline consumers and media storage', () => {
	assert.throws(() => createFramescaperSuccessorRuntime({ line: 'baseline' }), /successor/iu);
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' }); const admitted = resolveControllerProjectRuntime(runtime);
	const project = runtime.createProject({ title: 'Successor' }); assert.equal(project.schemaVersion, 2); assert.deepEqual(project.compositionLinks, []);
	assert.equal(admitted.cloneProject(project).schemaVersion, 2); assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 1);
	assert.throws(() => runtime.loadProject(createFramescaperProject()), /migrat/iu);
	assert.equal(runtime.loadProject({ ...project, schemaVersion: 3 }).intrinsicReadOnly, true);
	const names = editorProjectStorageProfileNames(FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE); assert.equal(names.databaseName, 'kw-media-framescaper-editor-v2-media'); assert.match(names.opfsDirectoryName, /v2-media/u);
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(editorProjectRuntimeProfileDefinition(FRAMESCAPER_SUCCESSOR_RUNTIME_PROFILE).prerequisite); assert.equal(prerequisite.projectSchemaVersion, 2); assert.notEqual(prerequisite.storageProfile, FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE);
});
test('successor publication fence blocks timeline mutation until atomic adoption and stale session capture is refused', () => {
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' }); const session = runtime.createSessionController(); const project = runtime.createProject({ title: 'Frame' });
	const history = createFramescaperSuccessorHistory(project); session.openProject(project, { history });
	const captured = session.captureProjectHistory(project.id); const next = runtime.executeCommand(history, { type: 'project/rename', title: 'Published' });
	const fence = runtime.beginPublication(session, project.id, captured.token); assert.throws(() => runtime.executeCommand(history, { type: 'project/rename', title: 'Racing edit' }), /publication/iu);
	assert.throws(() => runtime.undo(next), /publication/iu); assert.throws(() => session.updateProject(project.id, next.present), /publication/iu);
	assert.throws(() => session.closeProject(project.id, { force: true }), /reserved|publication/iu);
	fence.acceptHistory(next); fence.release();
	assert.equal(session.getProjectHistory(project.id).present.title, 'Published'); assert.throws(() => session.assertProjectHistoryToken(project.id, captured.token), /changed|stale|history/iu);
	assert.equal(runtime.executeCommand(next, { type: 'project/rename', title: 'Later' }).present.title, 'Later');
	session.dispose();
});

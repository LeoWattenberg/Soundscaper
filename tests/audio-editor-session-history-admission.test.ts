/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSessionHistoryAdmission } from '../src/common/editor/controller/document/session-history-admission.ts';
import { resolveControllerProjectRuntime } from '../src/common/editor/controller/document/project-runtime.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';

const runtime = resolveControllerProjectRuntime();
const admitProject = (value: unknown) => runtime.createHistory(value).present;

void test('session capture admits every history document and preserves its ownership token', () => {
	const session = createAudioEditorSessionController();
	const initial = runtime.createProject({ id: 'session-project' });
	const history = runtime.executeCommand(runtime.createHistory(initial), { type: 'project/rename', title: 'Renamed' });
	session.openProject(history.present, { history });
	const admitted = bindSessionHistoryAdmission(session, admitProject);
	const capture = admitted.captureProjectHistory(initial.id);
	const title: string = capture.history.present.title;
	assert.equal(title, 'Renamed');
	assert.equal(capture.history.undoStack[0]?.project.title, initial.title);
	assert.equal(capture.token, session.captureProjectHistory(initial.id).token);
	assert.deepEqual(capture.history, history);
	assert.equal(admitted.beginProjectActivation, session.beginProjectActivation);
});

void test('session capture refuses a minimally shaped but invalid document', () => {
	const session = createAudioEditorSessionController();
	session.openProject({ id: 'invalid', title: 'Invalid', schemaVersion: 17, sources: [], clips: [], tracks: [] });
	const admitted = bindSessionHistoryAdmission(session, admitProject);
	assert.throws(() => admitted.captureProjectHistory('invalid'), /project.revision/u);
});

void test('a forged history entry cannot escape the requested project identity', () => {
	const project = runtime.createProject({ id: 'current' });
	const other = runtime.createProject({ id: 'other' });
	const session = { captureProjectHistory: (_id: string) => ({ token: {}, history: {
		limit: 200, present: project, undoStack: [{ project: other }], redoStack: [],
	} }) };
	const admitted = bindSessionHistoryAdmission(session, admitProject);
	assert.throws(() => admitted.captureProjectHistory('current'), /another project/u);
});

void test('opaque history documents are admitted without traversing their domain bodies', () => {
	const future = { id: 'future', schemaVersion: 999, title: 'Future',
		get tracks(): never { throw new Error('Opaque domain read'); },
	};
	const session = { captureProjectHistory: (_id: string) => ({ token: {}, history: {
		limit: 200, present: future, undoStack: [], redoStack: [],
	} }) };
	const capture = bindSessionHistoryAdmission(session, admitProject).captureProjectHistory('future');
	assert.equal(capture.history.present.schemaVersion, 999);
	assert.deepEqual(capture.history.present.tracks, []);
});

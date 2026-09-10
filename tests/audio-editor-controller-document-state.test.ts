/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerDocumentState, createControllerDocumentCheckpoints } from '../src/common/editor/controller/document/document-state.ts';

interface Project { readonly id: string; readonly revision: number }
interface History { readonly present: Project; readonly undoStack: readonly Project[] }

test('project and history share one owner across commit, replacement, and disposal', () => {
	const owner = createControllerDocumentState<Project, History>();
	const first = { id: 'first', revision: 0 };
	const next = { id: 'first', revision: 1 };
	assert.equal(owner.project, null);
	owner.history = { present: first, undoStack: [] };
	assert.equal(owner.project, first);
	owner.project = next;
	assert.equal(owner.history?.present, next);
	assert.equal(owner.project, next);
	owner.history = { present: { id: 'second', revision: 0 }, undoStack: [first] };
	assert.equal(owner.project?.id, 'second');
	owner.project = null;
	assert.equal(owner.history, null);
	assert.equal(owner.project, null);
});

test('a project cannot be installed without history and owners never share state', () => {
	const first = createControllerDocumentState<Project, History>();
	const second = createControllerDocumentState<Project, History>();
	assert.throws(() => { first.project = { id: 'first', revision: 0 }; }, /history/u);
	first.history = { present: { id: 'first', revision: 0 }, undoStack: [] };
	assert.equal(second.history, null);
	const installed = first.project;
	first.project = installed;
	assert.equal(first.history?.present.id, 'first');
});

test('document checkpoints restore their exact history and reject foreign or closed owners', () => {
	const owner = createControllerDocumentState<Project, History>();
	const checkpoints = createControllerDocumentCheckpoints(owner);
	assert.throws(() => checkpoints.captureActiveDocument(), /open project/);
	const history = { present: { id: 'first', revision: 0 }, undoStack: [] };
	owner.history = history;
	const checkpoint = checkpoints.captureActiveDocument();
	owner.project = { id: 'first', revision: 1 };
	checkpoints.restoreActiveDocument(checkpoint);
	assert.equal(owner.history, history);
	assert.equal(owner.project, checkpoint.project);
	assert.throws(() => checkpoints.restoreActiveDocument({ ...checkpoint }), /checkpoint/);
	owner.project = { id: 'second', revision: 0 };
	assert.throws(() => checkpoints.restoreActiveDocument(checkpoint), /project changed/);
	owner.history = null;
	assert.throws(() => checkpoints.restoreActiveDocument(checkpoint), /project changed/);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createControllerDocumentScope } from '../src/common/editor/controller/document/controller-document-scope.ts';
import { createControllerDocumentState } from '../src/common/editor/controller/document/document-state.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

interface Project {
	readonly id: string;
	readonly revision: number;
}

interface History {
	readonly present: Project;
	readonly undo: readonly Project[];
}

test('the writable document scope preserves the history-backed document authority', () => {
	const initial = Object.freeze({ id: 'project-a', revision: 1 });
	const replacement = Object.freeze({ id: 'project-a', revision: 2 });
	const state = createControllerDocumentState<Project, History>();
	state.history = Object.freeze({ present: initial, undo: [] });
	const generation = new EditorProjectGeneration();
	generation.activate(initial.id);
	const scope = createControllerDocumentScope(state, generation);

	assert.equal(scope.get(), initial);
	assert.equal(scope.requireCurrent(), initial);
	scope.set(replacement);
	assert.equal(scope.get(), replacement);
	assert.equal(state.history?.present, replacement);
	assert.deepEqual(state.history?.undo, []);
	assert.equal(Object.isFrozen(scope), true);
});

test('the writable document scope retains absent-document and history installation failures', () => {
	const state = createControllerDocumentState<Project, History>();
	const generation = new EditorProjectGeneration();
	const scope = createControllerDocumentScope(state, generation);

	assert.throws(() => scope.requireCurrent(), /The document services require an open project/u);
	assert.throws(() => scope.captureCurrent(), /The document services require an open project/u);
	assert.throws(
		() => scope.set({ id: 'project-a', revision: 1 }),
		/An active project requires an installed history/u,
	);
});

test('the writable document scope captures, invalidates, and rejects stale project tokens', () => {
	const projectA = Object.freeze({ id: 'project-a', revision: 1 });
	const projectB = Object.freeze({ id: 'project-b', revision: 1 });
	const state = createControllerDocumentState<Project, History>();
	state.history = Object.freeze({ present: projectA, undo: [] });
	const generation = new EditorProjectGeneration();
	generation.activate(projectA.id);
	const scope = createControllerDocumentScope(state, generation);
	const token = scope.captureCurrent();

	assert.doesNotThrow(() => scope.assertCurrent(token));
	state.history = Object.freeze({ present: projectB, undo: [] });
	assert.throws(() => scope.assertCurrent(token), (error: unknown) => (
		error instanceof Error
		&& error.name === 'AbortError'
		&& 'code' in error
		&& error.code === 'PROJECT_CHANGED'
	));
	assert.throws(() => scope.captureCurrent(), (error: unknown) => (
		error instanceof Error && error.name === 'AbortError'
	));

	generation.activate(projectB.id);
	const current = scope.captureCurrent();
	generation.invalidate();
	assert.throws(() => scope.assertCurrent(current), (error: unknown) => (
		error instanceof Error && error.name === 'AbortError'
	));
});

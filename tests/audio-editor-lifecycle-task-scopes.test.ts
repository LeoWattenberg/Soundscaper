/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	EDITOR_PROJECT_TASK_SCOPE,
	EditorControllerLifetime,
	EditorDisposedError,
} from '../src/common/editor/controller/lifecycle.ts';
import { createFixture, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('cancelling a scope aborts every task carrying it and leaves the rest running', () => {
	const lifetime = new EditorControllerLifetime();
	const scoped = lifetime.startTask('export', { scope: EDITOR_PROJECT_TASK_SCOPE });
	const alsoScoped = lifetime.startTask('sample-edit', { scope: EDITOR_PROJECT_TASK_SCOPE });
	const otherScope = lifetime.startTask('device-probe', { scope: 'device' });
	const unscoped = lifetime.startTask('analysis');

	lifetime.cancelScope(EDITOR_PROJECT_TASK_SCOPE);

	assert.equal(scoped.signal.aborted, true);
	assert.equal(alsoScoped.signal.aborted, true);
	assert.equal(otherScope.signal.aborted, false);
	assert.equal(unscoped.signal.aborted, false);
	assert.throws(() => scoped.assertCurrent(), { name: 'AbortError' });
	assert.doesNotThrow(() => unscoped.assertCurrent());
});

test('a cancelled scope releases its names so the next task starts clean', () => {
	const lifetime = new EditorControllerLifetime();
	const first = lifetime.startTask('export', { scope: EDITOR_PROJECT_TASK_SCOPE });
	lifetime.cancelScope(EDITOR_PROJECT_TASK_SCOPE, new Error('The project changed.'));
	assert.equal(first.signal.reason instanceof Error && first.signal.reason.message, 'The project changed.');

	const second = lifetime.startTask('export', { scope: EDITOR_PROJECT_TASK_SCOPE });

	assert.equal(second.signal.aborted, false);
	assert.doesNotThrow(() => second.assertCurrent());
	lifetime.cancelScope('other-scope');
	assert.equal(second.signal.aborted, false);
});

test('a task handle cancels itself through the registry', () => {
	const lifetime = new EditorControllerLifetime();
	const task = lifetime.startTask('export', { scope: EDITOR_PROJECT_TASK_SCOPE });

	task.abort();

	assert.equal(task.signal.aborted, true);
	const replacement = lifetime.startTask('export', { scope: EDITOR_PROJECT_TASK_SCOPE });
	assert.equal(replacement.signal.aborted, false);
});

test('disposal cancels tasks in every scope', () => {
	const lifetime = new EditorControllerLifetime();
	const scoped = lifetime.startTask('export', { scope: EDITOR_PROJECT_TASK_SCOPE });
	const otherScope = lifetime.startTask('device-probe', { scope: 'device' });
	const unscoped = lifetime.startTask('analysis');

	assert.equal(lifetime.beginDisposal(), true);

	assert.equal(scoped.signal.aborted, true);
	assert.equal(otherScope.signal.aborted, true);
	assert.equal(unscoped.signal.aborted, true);
	assert.ok(scoped.signal.reason instanceof EditorDisposedError);
});

test('a project switch cancels every project-scoped task without naming it', async () => {
	const fixture = createFixture();
	const scoped = fixture.lifetime.startTask('feature-that-nobody-listed', {
		scope: EDITOR_PROJECT_TASK_SCOPE,
	});
	const unscoped = fixture.lifetime.startTask('feature-outside-the-project-scope');

	await fixture.service.switchProject(project('next-project'));

	assert.equal(scoped.signal.aborted, true);
	assert.equal(unscoped.signal.aborted, false);
});

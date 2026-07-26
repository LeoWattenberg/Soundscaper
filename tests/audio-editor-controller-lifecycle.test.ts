import test from 'node:test';
import assert from 'node:assert/strict';

import {
	EDITOR_DISPOSED_CODE,
	EditorControllerLifetime,
	EditorDisposedError,
	EditorProjectChangedError,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';

test('controller lifetime is terminal and invalidates captured work', async () => {
	const lifetime = new EditorControllerLifetime();
	const token = lifetime.capture();
	assert.equal(lifetime.phase, 'booting');

	assert.equal(lifetime.beginDisposal(), true);
	assert.equal(lifetime.phase, 'disposing');
	assert.equal(lifetime.signal.aborted, true);
	assert.throws(() => lifetime.assertActive(token), (error: unknown) => (
		error instanceof EditorDisposedError && error.code === EDITOR_DISPOSED_CODE
	));

	lifetime.finishDisposal();
	assert.equal(lifetime.phase, 'disposed');
	assert.equal(lifetime.beginDisposal(), false);
	assert.throws(() => lifetime.markReady(), { code: EDITOR_DISPOSED_CODE });
});

test('named task scopes replace older work without letting it publish', () => {
	const lifetime = new EditorControllerLifetime();
	const first = lifetime.startTask('analysis');
	const second = lifetime.startTask('analysis');

	assert.equal(first.signal.aborted, true);
	assert.throws(() => first.assertCurrent(), { name: 'AbortError' });
	assert.doesNotThrow(() => second.assertCurrent());
	first.finish();
	assert.doesNotThrow(() => second.assertCurrent());
	second.finish();
});

test('guard rejects a late completion after disposal', async () => {
	const lifetime = new EditorControllerLifetime();
	const token = lifetime.capture();
	let resolve!: (value: string) => void;
	const pending = new Promise<string>((next) => { resolve = next; });
	const guarded = lifetime.guard(pending, token);

	lifetime.beginDisposal();
	resolve('late');

	await assert.rejects(guarded, { code: EDITOR_DISPOSED_CODE });
});

test('project generations invalidate late work without disposing the controller lifetime', () => {
	const projects = new EditorProjectGeneration();
	const first = projects.activate('project-a');
	projects.assertCurrent(first);
	projects.invalidate();
	assert.throws(() => projects.assertCurrent(first), EditorProjectChangedError);
	const second = projects.activate('project-b');
	assert.equal(second.projectId, 'project-b');
	assert.throws(() => projects.capture('project-a'), (error: unknown) => (
		error instanceof EditorProjectChangedError
		&& error.code === 'PROJECT_CHANGED'
		&& error.name === 'AbortError'
	));
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindProjectAdministrationActions, type ProjectAdministrationCaptureGuard } from '../src/common/editor/controller/document/project-admin-action-binding.ts';

type Administration = Parameters<typeof bindProjectAdministrationActions>[0];

function fixture() {
	const calls: unknown[] = [];
	let project: { id: string } | null = { id: 'active' };
	let capture: ProjectAdministrationCaptureGuard | null = null;
	const service: Administration = {
		async prepareProjectHandoff(expected) { calls.push(['handoff', expected]); return { projectId: 'active', revision: 1 }; },
		assertProjectHandoffAllowed() { calls.push('assert-handoff'); },
		async closeProjectTab(id, options) { calls.push(['close', id, options]); return { closed: true }; },
		async deleteProject() { calls.push('delete'); },
		async clearLocalData() { calls.push('clear'); },
	};
	const actions = bindProjectAdministrationActions(service, () => project, () => capture);
	return { actions, calls, setProject(value: typeof project) { project = value; },
		setCapture(value: typeof capture) { capture = value; } };
}

void test('administration binding reads the current capture owner and preserves its rejection', async () => {
	const f = fixture();
	const failure = new Error('Capture owns this project.');
	const rejected: string[] = [];
	const refuse = (id: string) => { rejected.push(id); throw failure; };
	f.setCapture({ assertOriginHandoffAllowed: refuse, assertOriginCloseAllowed: refuse,
		assertOriginDeleteAllowed: refuse, originSnapshot: () => ({ origin: { projectId: 'recording-origin' } }) });
	await assert.rejects(f.actions.prepareProjectHandoff(), error => error === failure);
	assert.throws(() => f.actions.assertProjectHandoffAllowed(), error => error === failure);
	await assert.rejects(f.actions.closeProjectTab('inactive'), error => error === failure);
	await assert.rejects(f.actions.deleteProject(), error => error === failure);
	await assert.rejects(f.actions.clearLocalData(), error => error === failure);
	assert.deepEqual(rejected, ['active', 'active', 'inactive', 'active', 'recording-origin']);
	assert.deepEqual(f.calls, []);
	f.setCapture(null);
	await f.actions.deleteProject();
	assert.deepEqual(f.calls, ['delete']);
});

void test('administration binding forwards defaults and handoff expectations without changing identity', async () => {
	const f = fixture();
	const expected = { projectId: 'active', revision: 1 };
	await f.actions.prepareProjectHandoff(expected);
	f.actions.assertProjectHandoffAllowed();
	f.setProject({ id: 'next' });
	await f.actions.closeProjectTab(undefined, { discard: true });
	f.setProject(null);
	await f.actions.clearLocalData();
	assert.deepEqual(f.calls, [['handoff', expected], 'assert-handoff', ['close', 'next', { discard: true }], 'clear']);
	assert.equal(Object.isFrozen(f.actions), true);
});

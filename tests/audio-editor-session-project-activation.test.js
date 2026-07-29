/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorProjectV2 } from '../src/common/editor/project-v2.js';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';

const NOW = '2026-07-29T10:00:00.000Z';

test('a captured project history is detached and survives metadata-only updates', () => {
	const first = project('first-project');
	const second = project('second-project');
	const controller = createAudioEditorSessionController();
	controller.openProject(first);
	controller.openProject(second, { activate: false });

	const capture = controller.captureProjectHistory(second.id);
	capture.history.present.title = 'Mutated capture';
	controller.updateProjectMetadata(second.id, { selectedTrackId: 'track-two' });

	assert.equal(controller.getProject(second.id).title, second.title);
	assert.equal(controller.assertProjectHistoryToken(second.id, capture.token), true);
	assert.equal(controller.switchProject(second.id, { expectedHistoryToken: capture.token }), true);
	assert.equal(controller.getSnapshot().activeProjectId, second.id);
	assert.equal(Object.hasOwn(controller.serialize().tabs[1], 'historyToken'), false);
});

test('every private history replacement invalidates a captured activation token', () => {
	const first = project('first-project');
	const second = project('second-project');
	const controller = createAudioEditorSessionController();
	controller.openProject(first);
	controller.openProject(second, { activate: false });

	const beforeProjectUpdate = controller.captureProjectHistory(second.id);
	controller.updateProject(second.id, (value) => ({ ...value, title: 'Same revision replacement' }));
	assert.equal(controller.getProject(second.id).revision, second.revision);
	assertStale(() => controller.assertProjectHistoryToken(second.id, beforeProjectUpdate.token));
	assertStale(() => controller.switchProject(second.id, {
		expectedHistoryToken: beforeProjectUpdate.token,
	}));
	assert.equal(controller.getSnapshot().activeProjectId, first.id);

	const beforeHistoryUpdate = controller.captureProjectHistory(second.id);
	controller.updateProjectHistory(second.id, controller.getProjectHistory(second.id));
	assertStale(() => controller.assertProjectHistoryToken(second.id, beforeHistoryUpdate.token));
	assert.equal(controller.getSnapshot().activeProjectId, first.id);
});

test('closing and reopening invalidates captures and requireAbsent never activates an existing tab', () => {
	const first = project('first-project');
	const second = project('second-project');
	const controller = createAudioEditorSessionController();
	controller.openProject(first);
	controller.openProject(second, { activate: false });
	const capture = controller.captureProjectHistory(second.id);

	controller.closeProject(second.id, { force: true });
	controller.openProject(second, { activate: false });

	assertStale(() => controller.assertProjectHistoryToken(second.id, capture.token));
	assertStale(() => controller.switchProject(second.id, { expectedHistoryToken: capture.token }));
	assertStale(() => controller.openProject(second, { requireAbsent: true }));
	assert.equal(controller.getSnapshot().activeProjectId, first.id);
	assert.equal(controller.switchProject(second.id, {
		expectedHistoryToken: controller.captureProjectHistory(second.id).token,
	}), true);
});

test('an existing-project activation reservation blocks replacement until its matching switch publishes', () => {
	const first = project('first-project');
	const second = project('second-project');
	const controller = createAudioEditorSessionController();
	controller.openProject(first);
	controller.openProject(second, { activate: false });
	const capture = controller.captureProjectHistory(second.id);
	const activation = controller.beginProjectActivation(second.id, {
		expectedHistoryToken: capture.token,
	});

	assert.equal(Object.isFrozen(activation), true);
	assert.equal(Object.isFrozen(activation.token), true);
	assertActivationBlocked(() => controller.beginProjectActivation('another-project', { requireAbsent: true }));
	assertActivationBlocked(() => controller.updateProject(second.id, (value) => ({
		...value,
		title: 'Same revision replacement',
	})));
	assertActivationBlocked(() => controller.updateProjectHistory(second.id, controller.getProjectHistory(second.id)));
	assertActivationBlocked(() => controller.closeProject(second.id, { force: true }));
	assertActivationBlocked(() => controller.closeProject(first.id, { force: true }));
	assert.equal(controller.getSnapshot().activeProjectId, first.id);
	assertActivationBlocked(() => controller.openProject(second));
	assertActivationBlocked(() => controller.switchProject(second.id));
	assertActivationBlocked(() => controller.openProject(project('activating-project')));
	const background = project('background-project');
	controller.openProject(background, { activate: false });
	assert.equal(controller.getSnapshot().activeProjectId, first.id);
	controller.updateProjectMetadata(second.id, { selectedTrackId: 'allowed' });
	controller.setProjectReadOnly(second.id, { readOnly: false });

	assert.equal(controller.switchProject(second.id, { activationToken: activation.token }), true);
	assert.equal(controller.getSnapshot().activeProjectId, second.id);
	assert.equal(controller.getProject(second.id).title, second.title);
	assert.equal(activation.release(), true);
	assert.equal(activation.release(), false);
	controller.updateProject(second.id, (value) => ({ ...value, title: 'After release' }));
	assert.equal(controller.getProject(second.id).title, 'After release');
});

test('an absent-project activation reservation admits only its matching open and remains held through publication', () => {
	const controller = createAudioEditorSessionController();
	controller.openProject(project('first-project'));
	const next = project('reserved-project');
	const activation = controller.beginProjectActivation(next.id, { requireAbsent: true });

	assertActivationBlocked(() => controller.openProject(next, { activate: false }));
	controller.openProject(next, { activate: false, activationToken: activation.token });
	assertActivationBlocked(() => controller.updateProject(next.id, (value) => ({ ...value, title: 'Blocked' })));
	assertActivationBlocked(() => controller.closeProject(next.id, { force: true }));
	assertActivationBlocked(() => controller.openProject(next, { activationToken: activation.token }));
	assert.equal(controller.getSnapshot().activeProjectId, 'first-project');

	assert.equal(activation.release(), true);
	assert.equal(controller.closeProject(next.id, { force: true }).closed, true);
	controller.openProject(next, { activate: false });
	assert.equal(controller.getProject(next.id).title, next.title);
	const disposalReservation = controller.beginProjectActivation('after-dispose', { requireAbsent: true });
	controller.dispose();
	assert.equal(disposalReservation.release(), false);
});

test('a reservation remains held while switch publication invokes re-entrant subscribers', () => {
	const first = project('first-project');
	const second = project('second-project');
	const controller = createAudioEditorSessionController();
	controller.openProject(first);
	controller.openProject(second, { activate: false });
	const capture = controller.captureProjectHistory(second.id);
	const activation = controller.beginProjectActivation(second.id, {
		expectedHistoryToken: capture.token,
	});
	const third = project('third-project');
	controller.openProject(third, { activate: false });
	const blockedOperations = [];
	const unsubscribe = controller.subscribe(() => {
		for (const operation of [
			() => controller.updateProject(second.id, (value) => ({ ...value, title: 'Re-entrant replacement' })),
			() => controller.switchProject(third.id),
			() => controller.openProject(project('re-entrant-project')),
		]) {
			try {
				operation();
			} catch (error) {
				blockedOperations.push(error);
			}
		}
	});

	assert.equal(controller.switchProject(second.id, { activationToken: activation.token }), true);
	assert.equal(blockedOperations.length, 3);
	assert.equal(blockedOperations.every((error) => (
		error instanceof DOMException && error.name === 'AbortError'
	)), true);
	assert.equal(controller.getSnapshot().activeProjectId, second.id);
	assert.equal(controller.getProject(second.id).title, second.title);
	assert.throws(() => controller.getProject('re-entrant-project'), ReferenceError);
	assert.equal(controller.assertProjectHistoryToken(second.id, capture.token), true);
	unsubscribe();
	assert.equal(activation.release(), true);
});

test('a blocked re-entrant subscriber cannot abort authorized activation publication', () => {
	const first = project('first-project');
	const second = project('second-project');
	const controller = createAudioEditorSessionController();
	controller.openProject(first);
	controller.openProject(second, { activate: false });
	const capture = controller.captureProjectHistory(second.id);
	const activation = controller.beginProjectActivation(second.id, {
		expectedHistoryToken: capture.token,
	});
	let observedActiveProjectId = null;
	controller.subscribe(() => {
		controller.updateProject(second.id, (value) => ({ ...value, title: 'Blocked' }));
	});
	controller.subscribe((snapshot) => {
		observedActiveProjectId = snapshot.activeProjectId;
	});

	assert.equal(controller.switchProject(second.id, { activationToken: activation.token }), true);
	assert.equal(observedActiveProjectId, second.id);
	assert.equal(controller.getSnapshot().activeProjectId, second.id);
	assert.equal(controller.getProject(second.id).title, second.title);
	assert.equal(controller.assertProjectHistoryToken(second.id, capture.token), true);
	assert.equal(activation.release(), true);
});

function project(id) {
	return createAudioEditorProjectV2({ id, title: id, now: NOW });
}

function assertStale(operation) {
	assert.throws(operation, (error) => (
		error instanceof DOMException
		&& error.name === 'AbortError'
		&& /history changed/iu.test(error.message)
	));
}

function assertActivationBlocked(operation) {
	assert.throws(operation, (error) => (
		error instanceof DOMException
		&& error.name === 'AbortError'
		&& /reserved for activation/iu.test(error.message)
	));
}

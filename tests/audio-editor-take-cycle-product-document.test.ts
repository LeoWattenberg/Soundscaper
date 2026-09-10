/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSessionHistoryAdmission } from '../src/common/editor/controller/document/session-history-admission.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createTakeCycleCurrentProjectPublicationService, type TakeCyclePublicationHistory } from
	'../src/common/editor/controller/recording/internal/take-cycle/take-cycle-current-project-publication-service.ts';

void test('take publication retains the actual product family and one history authority', async () => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const base = runtime.createProject({ id: 'product-cycle', title: 'Before', now: '2026-09-08T00:00:00.000Z' });
	const command = { type: 'project/rename' as const, title: 'Recorded' };
	const target = runtime.applyCommand(base, command, { now: base.updatedAt });
	let history: TakeCyclePublicationHistory = runtime.createHistory(base);
	const session = bindSessionHistoryAdmission(runtime.createSessionController(), runtime.cloneProject);
	session.openProject(base, { history, dirty: false });
	const service = createTakeCycleCurrentProjectPublicationService({
		session, applyProjectCommand: runtime.applyCommand,
		getActiveProject: () => history.present, getActiveHistory: () => history,
		setActiveHistory: (value) => { history = value; },
		setActiveProject: (value) => { assert.equal(value, history.present); },
		isActiveProject: (id) => history.present.id === id,
		synchronizeProject: (value) => { assert.equal(value, history.present); },
	});
	await service.publish({ base, target, command, reason: 'finalize' });
	assert.equal(history.present.schemaFamily, 'soundscaper');
	assert.equal(history.present.schemaVersion, 1);
	assert.equal(history.present.title, 'Recorded');
	assert.equal(history.undoStack.length, 1);
});

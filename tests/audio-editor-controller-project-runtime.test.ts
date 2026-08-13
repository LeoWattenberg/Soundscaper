/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveControllerProjectRuntime,
} from '../src/common/editor/controller/project-runtime.ts';
import {
	createControllerProjectRuntimeMetrics,
} from '../src/common/editor/controller/project-runtime-metrics.ts';
import { createEditorProjectRuntimeV18Selection } from '../src/framescaper/editor-project-runtime-v18-selection.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';

test('controller runtime keeps the current V17 owner as the exact default', () => {
	const runtime = resolveControllerProjectRuntime();
	const project = runtime.createProject({
		id: 'default-runtime', title: 'Default runtime', now: '2026-08-13T12:00:00.000Z',
	});
	assert.equal(project.schemaVersion, 17);
	assert.equal(runtime.migrateProject(project).project.schemaVersion, 17);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 17);
});

test('controller runtime snapshots V18 authority with the planner-safe command projection', () => {
	const selected = createEditorProjectRuntimeV18Selection(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	const runtime = resolveControllerProjectRuntime(selected);
	const project = runtime.createProject({
		id: 'selected-runtime', title: 'Selected runtime', now: '2026-08-13T12:00:00.000Z',
	});
	const history = runtime.createHistory(project);
	assert.equal(project.schemaVersion, 18);
	assert.equal(runtime.executeCommand(history, {
		type: 'project/rename', title: 'Commanded',
	}).present.title, 'Commanded');
	assert.equal(runtime.applyCommand(project, {
		type: 'project/rename', title: 'Applied',
	}).title, 'Applied');
	assert.equal(runtime.cloneProject(project).schemaVersion, 18);
	assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 17);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 17);
	const metrics = createControllerProjectRuntimeMetrics(runtime);
	assert.equal(metrics.projectDurationFrames(project), 0);
	assert.equal(metrics.editorTimelineDurationFrames(project), Number(project.sampleRate) * 30);
});

test('controller runtime refuses partial callback collections', () => {
	assert.throws(() => resolveControllerProjectRuntime({}), /complete.*runtime|createProject/iu);
	assert.throws(() => resolveControllerProjectRuntime({
		createProject: () => ({}),
	}), /complete.*runtime|cloneProject/iu);
});

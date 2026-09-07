/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveControllerProjectRuntime,
} from '../src/common/editor/controller/project-runtime.ts';
import {
	createControllerProjectRuntimeMetrics,
} from '../src/common/editor/controller/project-runtime-metrics.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';

test('controller runtime keeps the current V17 owner as the exact default', () => {
	const runtime = resolveControllerProjectRuntime();
	assert.equal(runtime.assistanceAssetCommands, false);
	const project = runtime.createProject({
		id: 'default-runtime', title: 'Default runtime', now: '2026-08-13T12:00:00.000Z',
	});
	assert.equal(project.schemaVersion, 17);
	const title: string = project.title;
	assert.equal(title, 'Default runtime');
	assert.equal(runtime.projectForRuntimeConsumers, projectForRuntimeConsumers);
	assert.equal(runtime.loadProject(project).project.schemaVersion, 17);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 17);
});

test('default runtime admits future history as an inert view and refuses edits', () => {
	const runtime = resolveControllerProjectRuntime();
	const stored = { id: 'future', schemaVersion: 999, title: 'Future project',
		get tracks(): never { throw new Error('Opaque tracks were read'); },
	};
	const history = runtime.createHistory(stored);
	assert.equal(history.present.id, 'future');
	assert.equal(history.present.schemaVersion, 999);
	assert.deepEqual(history.present.tracks, []);
	assert.deepEqual(history.present.sources, []);
	assert.equal(runtime.canUndo(history), false);
	assert.throws(() => runtime.applyCommand(history.present, { type: 'project/rename', title: 'Changed' }));
});

test('controller runtime snapshots Framescaper v1 authority with baseline project admission', () => {
	const selected = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const runtime = resolveControllerProjectRuntime(selected);
	assert.equal(runtime.assistanceAssetCommands, true);
	const project = runtime.createProject({
		id: 'selected-runtime', title: 'Selected runtime', now: '2026-08-13T12:00:00.000Z',
	});
	const family: 'framescaper' = project.schemaFamily;
	assert.equal(family, 'framescaper');
	const history = runtime.createHistory(project);
	assert.equal(project.schemaFamily, 'framescaper');
	assert.equal(project.schemaVersion, 1);
	assert.equal(runtime.loadProject(project).project.schemaVersion, 1);
	assert.equal(runtime.executeCommand(history, {
		type: 'project/rename', title: 'Commanded',
	}).present.title, 'Commanded');
	assert.equal(runtime.applyCommand(project, {
		type: 'project/rename', title: 'Applied',
	}).title, 'Applied');
	assert.equal(runtime.cloneProject(project).schemaVersion, 1);
	assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 1);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 1);
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

test('runtime admission preserves selected method results without publishing unrelated host fields', () => {
	const selected = {
		...resolveControllerProjectRuntime(),
		createProject: () => ({ id: 'typed-project', schemaVersion: 17, title: 'Typed project' }),
		hostSecret: 'outside the runtime contract',
	};
	const runtime = resolveControllerProjectRuntime(selected);
	const title: string = runtime.createProject().title;
	assert.equal(title, 'Typed project');
	assert.equal(runtime.createProject, selected.createProject);
	assert.equal(Object.hasOwn(runtime, 'hostSecret'), false);
	assert.equal(Object.isFrozen(runtime), true);
});

void test('a dynamically retrieved host does not acquire the default runtime result model', () => {
	const host = { runtime: { ...resolveControllerProjectRuntime(),
		createProject: () => ({ id: 'dynamic', schemaVersion: 17, title: 123 }),
	} };
	// Reflect.get mirrors an unchecked JavaScript host: only no-argument admission
	// establishes the default owner; a dynamic input must keep the compatibility port.
	const selected: import('../src/common/editor/controller/project-runtime.ts').ControllerProjectRuntime =
		resolveControllerProjectRuntime(Reflect.get(host, String('runtime')));
	assert.equal(selected.createProject().title, 123);
});

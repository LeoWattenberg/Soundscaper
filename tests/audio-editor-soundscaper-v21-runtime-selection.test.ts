/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveControllerProjectRuntime } from '../src/common/editor/controller/project-runtime.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	createSoundscaperProjectRuntimeV21Selection,
} from '../src/soundscaper/editor-project-runtime-v21-selection.ts';
import {
	SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE,
} from '../src/soundscaper/editor-project-storage-profile-v21.ts';

test('selects a complete exact-V21 controller runtime and isolated storage namespace', () => {
	const selection = createSoundscaperProjectRuntimeV21Selection();
	const resolved = resolveControllerProjectRuntime(selection);
	assert.equal(resolved.createProject, selection.createProject);
	assert.equal(resolved.applyCommand, selection.applyCommand);
	assert.deepEqual(editorProjectStorageProfileNames(SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE), {
		databaseName: 'kw-media-soundscaper-editor-v21',
		opfsDirectoryName: 'soundscaper-editor-v21-sources',
		opfsWorkerName: 'soundscaper-editor-v21-opfs-storage',
		projectLockPrefix: 'kw-media-soundscaper-editor-v21-lock:',
	});
	const project = selection.createProject({ now: '2026-08-14T12:00:00.000Z' });
	assert.equal(project.schemaVersion, 21);
	assert.equal(selection.validateProject(project), true);
	assert.equal(selection.canUndo(selection.createHistory(project)), false);
});

test('keeps complete V21 authority in runtime and command coordinate projections', () => {
	const selection = createSoundscaperProjectRuntimeV21Selection();
	const project = selection.createProject({
		now: '2026-08-14T12:00:00.000Z',
		automationLanes: [{
			id: 'master-gain',
			address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1 }], segments: [],
		}],
	});
	const runtime = selection.projectForRuntimeConsumers(project);
	assert.equal(runtime.schemaVersion, 21);
	assert.deepEqual(runtime.automationLanes, project.automationLanes);
	assert.deepEqual(runtime.mixer, project.mixer);
	assert.equal(runtime.runtimeProjectionVersion, 2);
	const command = selection.projectForCommandConsumers(project);
	assert.equal(command.schemaVersion, 21);
	assert.deepEqual(command.automationLanes, project.automationLanes);
	assert.deepEqual(command.mixer, project.mixer);
	assert.equal(Object.hasOwn(command.master as object, 'envelope'), false);
	assert.equal(Object.hasOwn(command.mixer as object, 'routes'), false);
	assert.equal(command.runtimeProjectionVersion, 2);
});

test('session admission is exact V21 and prior schemas require re-import', () => {
	const selection = createSoundscaperProjectRuntimeV21Selection();
	const project = selection.createProject({ now: '2026-08-14T12:00:00.000Z' });
	const session = selection.createSessionController();
	const opened = session.openProject(project);
	assert.equal(opened.opened, true);
	assert.equal(session.getSnapshot().tabs[0]?.history.present.schemaVersion, 21);
	assert.throws(() => selection.migrateProject({ ...structuredClone(project), schemaVersion: 17 }), /re-import|V21/iu);
	const future = selection.migrateProject({ ...structuredClone(project), schemaVersion: 22 });
	assert.equal(future.readOnly, true);
	assert.equal(future.intrinsicReadOnly, true);
});

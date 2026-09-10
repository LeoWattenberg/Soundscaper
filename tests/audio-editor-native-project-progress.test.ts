/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createEditorTaskProgressCoordinator } from
	'../src/common/editor/controller/shared/task-progress.ts';
import { createFixture, nativeFile, project } from './helpers/native-project-service-fixture.ts';

test('Audacity open maps validation and decode into distinct progress phases', async () => {
	const published: Array<Readonly<{ value: number | null }> | null> = [];
	const taskProgress = createEditorTaskProgressCoordinator({
		onChange: (progress) => { published.push(progress); },
	});
	const fixture = createFixture({
		taskProgress,
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async (_nativeId, _file, options) => {
				options.onProgress?.({ value: 1 });
				return { readOnly: false, validation: { issues: [] } };
			},
			decode: async (_nativeId, options) => {
				options.onProgress?.({ value: 0.1 });
				options.onProgress?.({ value: 0.5 });
				return { project: project('imported'), sources: [] };
			},
			writeSnapshot: async () => ({}),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1) }),
			inspect: async () => ({}),
			delete: async () => undefined,
		}),
	});
	const task = taskProgress.begin('project-io', 'Importing', 0);

	await createNativeProjectService(fixture.runtime).openAup4(nativeFile('project.aup4', 10));

	assert.equal(published.some((progress) => progress?.value != null
		&& progress.value > 0.3 && progress.value < 1), true);
	task.finish();
});

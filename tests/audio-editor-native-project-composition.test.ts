/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectComposition } from '../src/common/editor/controller/document/native-project-composition.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';
import { createFixture, nativeFile } from './helpers/native-project-service-fixture.ts';

test('native project composition retains the injected archive client and disposes it once', async () => {
	let initializations = 0;
	let disposals = 0;
	const fixture = createFixture();
	const environment = { opfs: false };
	const client = {
		...fixture.runtime.createAup4Client({}),
		initialize: async () => { initializations += 1; return environment; },
		dispose: () => { disposals += 1; },
	};
	const taskProgress = createEditorTaskProgressCoordinator();
	const service = createNativeProjectComposition({
		...fixture.runtime, currentProjectSchemaFamily: 'soundscaper', initialAup4Client: client, taskProgress,
		copy: { ...fixture.runtime.copy, projectSaving: 'Saving' },
	});
	assert.equal(initializations, 0);
	assert.equal(await service.getAup4Client(), client);
	assert.equal(await service.getAup4Client(), client);
	assert.equal(initializations, 1);
	await service.dispose();
	await service.dispose();
	assert.equal(disposals, 1);
});


test('failed native file admission settles its foreground progress task', async () => {
	const fixture = createFixture();
	const kinds: unknown[] = [];
	const taskProgress = createEditorTaskProgressCoordinator({ onChange: value => { kinds.push(value?.kind ?? null); } });
	const service = createNativeProjectComposition({
		...fixture.runtime, currentProjectSchemaFamily: 'soundscaper', taskProgress, copy: { ...fixture.runtime.copy, projectSaving: 'Saving' },
	});
	await assert.rejects(service.openScape(nativeFile('invalid.txt')), /Choose a Scape project file/u);
	assert.equal(kinds[0], 'project-io');
	assert.equal(kinds.at(-1), null);
	assert.equal(taskProgress.getSnapshot(), null);
	await service.dispose();
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectComposition } from '../src/common/editor/controller/native-project-composition.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/task-progress.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFixture, project as fixtureProject } from './helpers/native-project-service-fixture.ts';
import { rewriteScapeProjectDocument } from './helpers/scape-archive-rewrite.js';

for (const currentProjectSchemaFamily of ['soundscaper', 'framescaper'] as const) {
	void test(`default ${currentProjectSchemaFamily} archive copy binds its family and preserves opaque bytes`, async (context) => {
		const schemaVersion = currentProjectSchemaFamily === 'soundscaper' ? 2 : 1;
		const store = createProjectStore({ indexedDB: null, databaseName: `copy-composition-${crypto.randomUUID()}` });
		context.after(async () => { await store.close(); });
		const project = { ...createCurrentAudioEditorProject(), schemaFamily: 'soundscaper', schemaVersion: 1 };
		const exported = await exportScapeProject(project, store);
		assert.ok(exported.blob);
		const archive = await rewriteScapeProjectDocument(exported.blob, (document: { schemaVersion: number }) => {
			document.schemaVersion = schemaVersion;
		});
		const file = new File([archive], 'future.sscape');
		const saved: Blob[] = [];
		const fixture = createFixture({ importScapeProject: async () => ({
			project: { ...fixtureProject(), schemaVersion }, readOnly: true, manifest: {},
		}) });
		const service = createNativeProjectComposition({
			...fixture.runtime,
			copyFutureScapeArchive: undefined,
			currentProjectSchemaFamily,
			projectFileExtension: currentProjectSchemaFamily === 'soundscaper' ? '.sscape' : '.fscape',
			taskProgress: createEditorTaskProgressCoordinator(),
			copy: { ...fixture.runtime.copy, projectSaving: 'Saving' },
			fileService: { ...fixture.runtime.fileService, saveFile: async (request) => {
				saved.push(request.blob);
				return { size: request.blob.size };
			} },
		});
		context.after(async () => { await service.dispose(); });
		await service.openScape(file);
		fixture.state.readOnly = true;
		await service.saveScape({ saveCopy: true });
		assert.equal(saved.length, 1);
		assert.deepEqual(await saved[0]!.arrayBuffer(), await archive.arrayBuffer());
	});
}

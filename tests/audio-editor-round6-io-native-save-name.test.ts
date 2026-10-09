/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';

for (const title of ['東京での録音', '東京での録音'.repeat(12)]) {
	test(`native Save preserves a valid ${Buffer.byteLength(title + '.fscape')} byte project filename`, async (context) => {
		const store = createProjectStore({ indexedDB: null, databaseName: `save-name-${crypto.randomUUID()}` });
		context.after(async () => { await store.close(); });
		const project = createFramescaperProject(undefined, { title });
		const exported = await exportScapeProject(project, store);
		assert.ok(exported.blob);
		const native = await nativeSidecarFixture('ordinary.srt', '', { saveName: 'choice.fscape', saveSuggestedName: true });
		context.after(native.close);
		const service = createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch });
		const name = `${title}.fscape`;
		assert.ok(Buffer.byteLength(name) <= 255, 'the final filesystem filename is valid');
		const saved = await service.saveFile({ purpose: 'project', suggestedName: name, blob: exported.blob });
		assert.equal(saved.fileName, name);
		assert.equal(native.saveChoices.length, 1);
		assert.ok(JSON.stringify(native.saveChoices).includes(name), 'the actual native default is preserved');
		assert.deepEqual(await native.savedBytes(), Buffer.from(await exported.blob.arrayBuffer()));
	});
}

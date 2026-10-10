/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeOriginalImportFixture } from './helpers/native-original-import-fixture.ts';
import { createOriginalOverwriteActions } from '../src/common/editor/controller/export/internal/overwrite-original-action.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createDesktopOriginalImportRecorder, resetDesktopOriginal } from '../src/common/editor/desktop-overwrite-original.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('removing the only imported clip during native overwrite preparation retires its unused save target', async () => {
	const state = {};
	let project = { id: 'project', sources: [] as object[], clips: [] as object[] };
	const file = new File([new Uint8Array(encodeWav([new Float32Array(4)], { sampleRate: 48_000, bitDepth: 16 })).buffer], 'Dialogue.wav');
	const native = await nativeOriginalImportFixture(file, { maximumTargets: 1, holdPreparationAt: 1 });
	const selections = await native.bridge.chooseFiles({ purpose: 'audio' });
	assert.ok(Array.isArray(selections));
	const selected = selections[0] as { originalFile: { id: string; name: string } };
	registerDesktopOriginalFile(file, selected.originalFile);
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = { ...project, sources: [{ id: 'source', kind: 'audio', channelCount: 1 }], clips: [{}] };
	})(file);
	const fileService = createAudioEditorFileService({ bridge: native.bridge });
	let exports = 0;
	const actions = createOriginalOverwriteActions({ state, getProject: () => project, fileService,
		handleExportAction: () => { exports += 1; } });
	try {
		const pending = actions.overwriteOriginal();
		while (!native.prepared.length) await new Promise<void>((resolve) => { setImmediate(resolve); });
		project = { ...project, clips: [] };
		native.completePreparation();
		await pending;
		assert.equal(exports, 0);
		assert.doesNotThrow(() => native.reserveNextTarget(),
			'the abandoned overwrite must leave the bounded native save capacity available');
	} finally {
		await native.close();
		resetDesktopOriginal(state);
	}
});

test('the real preload and main save target release retain owner fencing and idempotent cleanup', async () => {
	const file = new File([new Uint8Array(encodeWav([new Float32Array(4)], { sampleRate: 48_000, bitDepth: 16 })).buffer], 'Dialogue.wav');
	const native = await nativeOriginalImportFixture(file, { maximumTargets: 1 });
	try {
		const selected = await native.bridge.chooseFiles({ purpose: 'audio' });
		assert.ok(Array.isArray(selected));
		const original = selected[0] as { originalFile: { id: string } };
		const prepared = await native.bridge.prepareOriginalOverwrite(original.originalFile.id) as { id: string };
		const release = native.bridge.releaseSaveTarget; assert.ok(release);
		await assert.rejects(native.invoke('soundscaper:v1:save:release-target', prepared.id, true), /owner/iu);
		assert.throws(() => native.reserveNextTarget(), /capacity/iu, 'a foreign renderer cannot release the owner target');
		assert.equal(await release(prepared.id), true);
		assert.equal(await release(prepared.id), false);
		assert.doesNotThrow(() => native.reserveNextTarget());
	} finally { await native.close(); }
});

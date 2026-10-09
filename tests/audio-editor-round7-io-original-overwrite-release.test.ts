/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SaveTargetStore } from '../desktop/save-targets.js';
import { createOriginalOverwriteActions } from '../src/common/editor/controller/export/internal/overwrite-original-action.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createDesktopOriginalImportRecorder, resetDesktopOriginal } from '../src/common/editor/desktop-overwrite-original.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('removing the only imported clip during native overwrite preparation retires its unused save target', async () => {
	const owner = {};
	const targets = new SaveTargetStore({ maximumTargets: 1 });
	const state = {};
	let project = { id: 'project', sources: [] as object[], clips: [] as object[] };
	const file = new File([new Uint8Array(encodeWav([new Float32Array(4)], { sampleRate: 48_000, bitDepth: 16 })).buffer], 'Dialogue.wav');
	registerDesktopOriginalFile(file, { id: 'a'.repeat(48), name: file.name });
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = { ...project, sources: [{ id: 'source', kind: 'audio', channelCount: 1 }], clips: [{}] };
	})(file);
	let completePreparation!: () => void;
	const fileService = createAudioEditorFileService({ bridge: {
		prepareOriginalOverwrite: async () => {
			const target = targets.registerPath('/ordinary/Dialogue.wav', { owner });
			await new Promise<void>((resolve) => { completePreparation = resolve; });
			return target;
		},
		releaseSaveTarget: async (id: string) => targets.release(id, { owner }),
	} });
	let exports = 0;
	const actions = createOriginalOverwriteActions({ state, getProject: () => project, fileService,
		handleExportAction: () => { exports += 1; } });
	try {
		const pending = actions.overwriteOriginal();
		project = { ...project, clips: [] };
		completePreparation();
		await pending;
		assert.equal(exports, 0);
		assert.doesNotThrow(() => targets.registerPath('/ordinary/Next mix.wav', { owner }),
			'the abandoned overwrite must leave the bounded native save capacity available');
	} finally {
		targets.dispose();
		resetDesktopOriginal(state);
	}
});

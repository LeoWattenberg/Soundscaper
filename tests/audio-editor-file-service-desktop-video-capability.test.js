/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('file service exposes only a dedicated desktop video execution capability bridge', async () => {
	const explicit = { schemaVersion: 1, formats: {} };
	const desktop = createAudioEditorFileService({
		bridge: { async getDesktopVideoExportCapabilities() { return explicit; } },
	});
	const browser = createAudioEditorFileService({ bridge: null });

	assert.strictEqual(await desktop.getDesktopVideoExportCapabilities(), explicit);
	assert.equal(browser.getDesktopVideoExportCapabilities(), null);
});

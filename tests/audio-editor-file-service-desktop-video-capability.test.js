/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('file service exposes only dedicated desktop video capability and session bridges', async () => {
	const explicit = { schemaVersion: 1, formats: {} };
	const requests = [];
	const desktop = createAudioEditorFileService({
		bridge: {
			async getDesktopVideoExportCapabilities() { return explicit; },
			beginDesktopVideoCodecOperation(value) { requests.push(['begin', value]); return { operationId: 'id' }; },
			writeDesktopVideoCodecInput(value) { requests.push(['write', value]); return { offset: 1 }; },
			closeDesktopVideoCodecInput(value) { requests.push(['close', value]); return { offset: 1 }; },
			executeDesktopVideoCodecOperation(value) { requests.push(['execute', value]); return { exitCode: 0 }; },
			statDesktopVideoCodecOutput(value) { requests.push(['stat', value]); return { byteLength: 1 }; },
			readDesktopVideoCodecOutput(value) { requests.push(['read', value]); return Uint8Array.of(1); },
			deleteDesktopVideoCodecOperation(value) { requests.push(['delete', value]); return true; },
			cancelDesktopVideoCodecOperation(value) { requests.push(['cancel', value]); return true; },
		},
	});
	const browser = createAudioEditorFileService({ bridge: null });
	const request = { operationId: 'id' };

	assert.strictEqual(await desktop.getDesktopVideoExportCapabilities(), explicit);
	assert.deepEqual(await desktop.beginDesktopVideoCodecOperation(request), { operationId: 'id' });
	assert.deepEqual(await desktop.writeDesktopVideoCodecInput(request), { offset: 1 });
	assert.deepEqual(await desktop.closeDesktopVideoCodecInput(request), { offset: 1 });
	assert.deepEqual(await desktop.executeDesktopVideoCodecOperation(request), { exitCode: 0 });
	assert.deepEqual(await desktop.statDesktopVideoCodecOutput(request), { byteLength: 1 });
	assert.deepEqual(await desktop.readDesktopVideoCodecOutput(request), Uint8Array.of(1));
	assert.equal(await desktop.deleteDesktopVideoCodecOperation(request), true);
	assert.equal(await desktop.cancelDesktopVideoCodecOperation('id'), true);
	assert.deepEqual(requests.map(([name]) => name), [
		'begin', 'write', 'close', 'execute', 'stat', 'read', 'delete', 'cancel',
	]);
	assert.equal(browser.getDesktopVideoExportCapabilities(), null);
	assert.equal(browser.beginDesktopVideoCodecOperation(request), null);
	assert.equal(browser.cancelDesktopVideoCodecOperation('id'), null);
});

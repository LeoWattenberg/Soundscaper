/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import {
	bootEditor, chooseDropdown, clipByName, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const namespace of ['cart', 'ixml']) {
	test(`a normal broadcast WAV with ${namespace} metadata imports and retains its production notes`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const clipName = `studio-take-${namespace}`;
		const buffer = encodeWav([new Float32Array(48_000)], {
			sampleRate: 48_000, bitDepth: 16, bext: { description: 'Radio continuity take' },
			[namespace]: namespace === 'cart'
				? { title: 'Radio continuity take', postTimers: [{ usage: 'SEC1', value: 24_000 }] }
				: { project: 'Radio series', scene: 'Studio A', take: '12', note: 'Keep the complete take.' },
		});
		await importFiles(editor, [{
			name: `${clipName}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(buffer),
		}]);
		await expect(clipByName(editor, `${clipName}.wav`)).toBeVisible({ timeout: 20_000 });
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		const bytes = await readDownloadBytes(page, link);
		expect(new TextDecoder().decode(bytes)).toContain(namespace === 'cart'
			? 'Radio continuity take' : '<PROJECT>Radio series</PROJECT>');
		if (namespace === 'ixml') expect(new TextDecoder().decode(bytes)).toContain('Keep the complete take.');
	});
}

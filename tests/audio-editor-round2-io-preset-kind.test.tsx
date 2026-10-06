/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import type { ReactTestElement } from './helpers/react-test-dom.ts';

test('a selected audio preset loses its reset/export authority when the dialog changes to video', async () => {
	const fixture = await mountedExportDialog({ video: true, presets: [validateDeliveryPreset({ schemaVersion: 1, id: 'wav', label: 'My WAV', kind: 'audio', format: 'wav', settings: { sampleRate: 48_000, sampleFormat: 'int24' } })] });
	try {
		const banner = fixture.dom.one('[data-delivery-presets]');
		await fixture.click(button(banner, 'Preset'));
		const body = document.body as unknown as ReactTestElement;
		const option = body.querySelectorAll('[role="option"]').find(option => option.textContent === 'My WAV (custom)');
		assert.ok(option);
		await fixture.click(option);
		assert.match(banner.textContent, /My WAV/u);
		await fixture.chooseFormat('MP4 video');
		assert.match(banner.textContent, /No preset/u);
		assert.equal(button(banner, 'Reset preset').getAttribute('disabled'), '', 'a hidden audio preset cannot restore the video fields');
		await fixture.click(button(banner, 'More options'));
		const exportItem = body.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'Export preset');
		assert.ok(exportItem);
		assert.equal(exportItem.getAttribute('aria-disabled'), 'true', 'a displayed empty selection cannot export an old audio preset');
	} finally { await fixture.unmount(); }
});

function button(root: ReactTestElement, label: string): ReactTestElement {
	const found = root.querySelectorAll('button').find(element => element.getAttribute('aria-label') === label);
	assert.ok(found, `Missing ${label}`);
	return found;
}

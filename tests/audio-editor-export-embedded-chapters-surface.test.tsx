/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';

test('embedded chapters are opt-in for supported mixed files and hidden for other deliveries', async () => {
	const fixture = await mountedExportDialog();
	try {
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.chooseFormat('MP3');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-checked'), 'false');
		await fixture.click(fixture.chapterCheckbox());
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.embedLabelChapters, true);
		await fixture.chooseFormat('AAC / M4A');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-checked'), 'true');
		await fixture.chooseOutput(ENGLISH_COPY.exportOutputStems);
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.startExport();
		assert.equal(Object.hasOwn(fixture.requests[1] ?? {}, 'embedLabelChapters'), false);
		await fixture.chooseOutput(ENGLISH_COPY.exportOutputClips);
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.startExport();
		assert.equal(Object.hasOwn(fixture.requests[2] ?? {}, 'embedLabelChapters'), false);
		await fixture.chooseOutput(ENGLISH_COPY.entireProject);
		await fixture.chooseFormat('WAV');
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.startExport();
		assert.equal(Object.hasOwn(fixture.requests[3] ?? {}, 'embedLabelChapters'), false);
	} finally {
		await fixture.unmount();
	}
});

test('embedded chapters explain when the project needs a label', async () => {
	const fixture = await mountedExportDialog({ labels: [] });
	try {
		await fixture.chooseFormat('MP3');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
		assert.equal(fixture.dom.one('[data-export-chapters-hint]').textContent, ENGLISH_COPY.embedLabelChaptersNoLabels);
	} finally {
		await fixture.unmount();
	}
});

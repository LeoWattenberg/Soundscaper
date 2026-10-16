/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { readWithReference, referenceItems } from '../helpers/interchange-reference.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const overlap of [false, true]) test(`EDL reports ordinary ${overlap ? 'overlapping' : 'sequential'} camera cuts truthfully`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('Camera.webm'));
	const card = editor.getByRole('listitem', { name: 'Project bin: Camera', exact: true });
	await expect(card).toBeVisible();
	const add = card.getByRole('button', { name: /Add to timeline/u });
	await add.click();
	const clips = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clips).toHaveCount(1);
	await clips.first().press('Enter');
	if (overlap) await seekFramescaperTimecode(page, editor, '00:00:00:10');
	else await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
	await add.click();
	await expect(clips).toHaveCount(2);
	const rows = await clips.evaluateAll(elements => elements.map(element => element.closest('[data-track-row]')?.getAttribute('data-track-id')));
	expect(new Set(rows).size).toBe(1);
	const boxes = await clips.evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })));
	expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
	if (overlap) expect(boxes[1].x).toBeLessThan(boxes[0].x + boxes[0].width);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export edit list (EDL)']);
	const download = await downloading;
	let text;
	try {
		const path = await download.path();
		expect(path).not.toBeNull();
		text = await readFile(path, 'utf8');
	} finally { await download.delete(); }
	expect(text.split('\n').filter(line => /^\d{3}\s/u.test(line))).toHaveLength(2);
	if (overlap) expect(() => readWithReference(text, 'cmx_3600', { rate: 30 }, '.edl')).toThrow(/Overlapping record in value/u);
	else expect(referenceItems(readWithReference(text, 'cmx_3600', { rate: 30 }, '.edl')).filter(item => item.schema === 'Clip')).toHaveLength(2);
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).toBeVisible();
	if (overlap) await expect(report.locator('[data-severity="warning"]')).toContainText(/overlapping.*cut/iu);
	else await expect(report).not.toContainText(/overlapping.*cut/iu);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { readWithReference } from '../helpers/interchange-reference.ts';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker } from './audio-editor-test-helpers.js';

for (const overlap of [false, true]) test(`FCPXML preserves ordinary ${overlap ? 'overlapping' : 'sequential'} bin additions`, async ({ page }, testInfo) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(toneA);
	const add = editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u });
	await add.click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	if (!overlap) await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
	await add.click();
	const clips = clipByName(editor, toneA.name);
	await expect(clips).toHaveCount(2);
	const rows = await clips.evaluateAll(elements => elements.map(element => element.closest('[data-track-row]')?.getAttribute('data-track-id')));
	expect(new Set(rows).size).toBe(1);
	const boxes = await clips.evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })));
	if (overlap) expect(boxes[1].x).toBeCloseTo(boxes[0].x, 1);
	else expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
	const downloaded = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export FCPXML']);
	const download = await downloaded;
	const path = await download.path();
	expect(path).not.toBeNull();
	const text = await readFile(path, 'utf8');
	const timelines = readWithReference(text, 'fcpx_xml', {}, '.fcpxml');
	const tracks = timelines[0].tracks;
	const items = tracks.flatMap(track => track.items).filter(item => item.schema === 'Clip');
	expect(items).toHaveLength(2);
	expect(items.map(item => item.startValue / item.startRate)).toEqual([0, 0]);
	expect(items.map(item => item.durationValue / item.durationRate)).toEqual([.8, .8]);
	const duration = Math.max(...tracks.map(track => track.items.reduce((seconds, item) => seconds + item.durationValue / item.durationRate, 0)));
	await testInfo.attach('delivered-fcpxml', { body: Buffer.from(text), contentType: 'application/xml' });
	await testInfo.attach('ordinary-timing-reference', { body: Buffer.from(JSON.stringify({ rows, boxes, tracks, duration })), contentType: 'application/json' });
	expect(duration).toBe(overlap ? .8 : 1.6);
});

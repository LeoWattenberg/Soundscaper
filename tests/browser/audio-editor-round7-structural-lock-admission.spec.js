/* SPDX-License-Identifier: AGPL-3.0-only */

import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	getMenuItem, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const operation of ['sort', 'align']) test(`global track ${operation} retains its unlocked control and suspends a locked target`, async ({ page }) => {
	const failures = [];
	page.on('pageerror', error => failures.push(error.message));
	const editor = await bootEditor(page, '/embed/en/');
	for (const name of ['Zulu', 'Alpha']) {
		await importFiles(editor, [createWavFixture({ name: `${name}.wav`, frequency: 440, duration: .2 })]);
	}
	const recording = clipByName(editor, 'Zulu.wav');
	const track = recording.locator('xpath=ancestor::div[@data-track-row][1]');
	const path = operation === 'sort'
		? [ENGLISH_COPY.sortTracks, ENGLISH_COPY.sortByName]
		: ['Align content', 'Align start to zero'];
	const ordinal = name => clipByName(editor, `${name}.wav`)
		.locator('xpath=ancestor::div[@data-track-row][1]').evaluate(element => (
			Array.from(element.closest('[data-audio-editor]').querySelectorAll('[data-track-row]')).indexOf(element)
		));
	const position = () => recording.locator('.clip-display').evaluate(element => element.getBoundingClientRect().x);
	await recording.locator('.clip-header').click();
	const original = await position();
	if (operation === 'align') {
		await recording.focus();
		await recording.press('Control+ArrowRight');
		await expect.poll(position).toBeGreaterThan(original + 8);
	}
	await chooseNestedCommandAction(page, editor, 'Tracks', path);
	if (operation === 'sort') {
		await expect.poll(async () => (await ordinal('Alpha')) < (await ordinal('Zulu'))).toBe(true);
	} else await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	if (operation === 'sort') {
		await expect.poll(async () => (await ordinal('Zulu')) < (await ordinal('Alpha'))).toBe(true);
	} else await expect.poll(position).toBeGreaterThan(original + 8);
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await expect(recording.getByRole('slider', { name: 'Looped clip length' })).toBeDisabled();
	await recording.locator('.clip-header').click();
	const menu = await openNestedCommandMenu(page, editor, 'Tracks', [path[0]]);
	const command = getMenuItem(menu, path[1]);
	if (await command.getAttribute('aria-disabled') === 'false') {
		await command.click();
		await expect.poll(() => failures.some(message => message.includes('Structural operation refused for locked track'))).toBe(true);
		if (operation === 'sort') {
			await expect.poll(async () => (await ordinal('Zulu')) < (await ordinal('Alpha'))).toBe(true);
		} else await expect.poll(position).toBeGreaterThan(original + 8);
		await openNestedCommandMenu(page, editor, 'Tracks', [path[0]]);
	}
	await expect(command).toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await chooseNestedCommandAction(page, editor, 'Tracks', path);
	if (operation === 'sort') {
		await expect.poll(async () => (await ordinal('Alpha')) < (await ordinal('Zulu'))).toBe(true);
	} else await expect.poll(position).toBe(original);
	await expect(failures).toEqual([]);
});

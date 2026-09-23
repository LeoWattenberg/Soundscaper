/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

import { captionLabels, expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../src/common/i18n/community-translations-copy.ts';
import { resolveCatalog } from '../../src/common/i18n/runtime.js';

const en = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;
const de = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.de;

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
		value: undefined, configurable: true,
	}));
});

async function openTranslator(page, editor) {
	await chooseCommandAction(page, editor, 'Help', en.menu);
	const surface = page.getByRole('dialog', { name: en.title, exact: true });
	await expect(surface.getByRole('textbox', { name: en.source, exact: true })).toBeVisible();
	return surface;
}

async function selectMessage(surface, key, copy = en) {
	await surface.getByRole('searchbox', { name: copy.search, exact: true }).fill(key);
	await surface.getByRole('listbox', { name: new RegExp(`^${copy.messages} \\(`, 'u') }).selectOption(key);
	await expect(surface.getByRole('textbox', { name: copy.key, exact: true })).toHaveValue(key);
}

test('picking Audio setup selects its own message and marks identical labels as alternatives', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1100 });
	const editor = await bootEditor(page, '/embed/en/');
	const surface = await openTranslator(page, editor);
	await selectMessage(surface, 'shortcutCategoryAudioSetup');
	const setup = editor.getByRole('button', { name: 'Audio setup', exact: true });
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await setup.getByText('Audio setup', { exact: true }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('audioDevices');
	const candidates = surface.getByRole('group', { name: en.candidates, exact: true });
	const target = candidates.getByRole('button', { name: /^audioDevices \(text\) —/u });
	const alternative = candidates.getByRole('button', { name: /^shortcutCategoryAudioSetup \(text\) —/u });
	await expect(target).toHaveAttribute('aria-pressed', 'true');
	await expect(alternative).toHaveAttribute('aria-pressed', 'false');
	await expect(target.getByText(en.clicked, { exact: true })).toBeVisible();
	await expect(setup).toHaveCSS('outline-style', 'solid');
	await expect(setup).toHaveAttribute('aria-expanded', 'false');
	await alternative.click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('shortcutCategoryAudioSetup');
	await expect(alternative).toHaveAttribute('aria-pressed', 'true');
	await expect(target).toHaveAttribute('aria-pressed', 'false');
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await setup.getByText('Audio setup', { exact: true }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('audioDevices');
	await surface.getByRole('button', { name: en.close, exact: true }).click();
	await expect(setup).toHaveCSS('outline-style', 'none');
});

test('picking a shortcut heading selects its category among identical toolbar labels', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1100 });
	const editor = await bootEditor(page, '/embed/en/');
	const surface = await openTranslator(page, editor);
	await selectMessage(surface, 'transportToolbar');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await surface.getByRole('button', { name: en.moveLeft, exact: true }).click();
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await preferences.getByRole('heading', { name: 'Transport toolbar', exact: true }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('shortcutCategoryTransportToolbar');
	const candidates = surface.getByRole('group', { name: en.candidates, exact: true });
	await expect(candidates.getByRole('button', { name: /^shortcutCategoryTransportToolbar \(text\) —/u })).toHaveAttribute('aria-pressed', 'true');
	await expect(candidates.getByRole('button', { name: /^transportToolbar \(text\) —/u })).toHaveAttribute('aria-pressed', 'false');
});

test('menu-only drafts preview, survive reopening and export without project data or interrupting playback', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1100 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	await expect(page.getByRole('dialog', { name: en.title, exact: true })).toHaveCount(0);
	let surface = await openTranslator(page, editor);
	await expect(surface.getByRole('combobox', { name: en.language, exact: true })).toHaveValue('de');
	await expect(surface.getByRole('combobox', { name: en.language, exact: true }).getByRole('option', { name: 'English (UK)', exact: true })).toHaveAttribute('value', 'en-GB');
	await selectMessage(surface, 'play');
	await expect(surface.getByText(en.owner, { exact: true })).toBeVisible();
	await expect(surface.getByText('editor', { exact: true })).toBeVisible();
	await expect(surface.getByText(en.originAudacity, { exact: true })).toBeVisible();
	await surface.getByRole('textbox', { name: en.translation, exact: true }).fill('Probe play');
	await surface.getByRole('button', { name: en.save, exact: true }).click();
	const jsonDownload = page.waitForEvent('download');
	await surface.getByRole('button', { name: en.export, exact: true }).click();
	const json = JSON.parse(new TextDecoder().decode(await downloadBytes(await jsonDownload)));
	expect(json.entries).toHaveLength(1);
	expect(json.entries[0].key).toBe('play');
	expect(json.entries[0].translation).toBe('Probe play');
	expect(JSON.stringify(json)).not.toContain(longTone.name);
	await surface.getByRole('checkbox', { name: en.preview, exact: true }).check();
	surface = page.getByRole('dialog', { name: de.title, exact: true });
	await expect(editor.getByRole('button', { name: 'Probe play', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Probe play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await surface.getByRole('checkbox', { name: de.preview, exact: true }).uncheck();
	surface = page.getByRole('dialog', { name: en.title, exact: true });
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(clipByName(editor, longTone.name)).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await surface.getByRole('button', { name: en.close, exact: true }).click();
	surface = await openTranslator(page, editor);
	await selectMessage(surface, 'play');
	await expect(surface.getByRole('textbox', { name: en.translation, exact: true })).toHaveValue('Probe play');
});

test('picking offers ambiguous labels and accessible attributes while keeping an existing dialog open', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1100 });
	const editor = await bootEditor(page, '/embed/en/');
	const surface = await openTranslator(page, editor);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await surface.getByRole('button', { name: en.moveLeft, exact: true }).click();
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await preferences.getByRole('button', { name: 'Close', exact: true }).first().click();
	await expect(preferences).toBeVisible();
	await expect(surface.getByRole('group', { name: en.candidates, exact: true })).toBeVisible();
	await surface.getByRole('button', { name: /^close \(aria-label\) —/u }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('close');
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(surface.getByRole('button', { name: en.pick, exact: true })).toHaveAttribute('aria-pressed', 'false');
	await expect(preferences).toBeVisible();
	await surface.getByRole('searchbox', { name: en.search, exact: true }).focus();
	await page.keyboard.press('Tab');
	await expect(surface.getByRole('combobox', { name: en.filter, exact: true })).toBeFocused();
	await preferences.getByRole('button', { name: 'Close', exact: true }).first().click();
	await surface.getByRole('button', { name: en.moveRight, exact: true }).click();
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const candidates = surface.getByRole('group', { name: en.candidates, exact: true });
	if (await candidates.isVisible()) await candidates.getByRole('button', { name: /^play \(aria-label\) —/u }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('play');
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await surface.getByRole('button', { name: en.moveLeft, exact: true }).click();
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await editor.getByRole('combobox', { name: 'Search commands and media', exact: true }).click();
	await surface.getByRole('button', { name: /^editorSearchPlaceholder \(placeholder\) —/u }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('editorSearchPlaceholder');
	await surface.getByRole('button', { name: en.moveRight, exact: true }).click();
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await editor.getByRole('status').filter({ hasText: 'Editor ready.' }).click();
	await surface.getByRole('button', { name: /^ready \(title\) —/u }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('ready');
});

test('PO kits retain their baseline and notices, and stale JSON imports remain reviewable', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const surface = await openTranslator(page, editor);
	const download = page.waitForEvent('download');
	await surface.getByRole('button', { name: en.po, exact: true }).click();
	const files = unzipSync(await downloadBytes(await download));
	expect(Object.keys(files)).toEqual(expect.arrayContaining(['messages.pot', 'messages.po', 'manifest.json', 'NOTICE.md', 'LICENSE.txt']));
	expect(strFromU8(files['messages.pot'])).toContain('msgctxt "play"\nmsgid "Play"\nmsgstr ""');
	expect(strFromU8(files['messages.po'])).toContain('msgctxt "play"');
	const manifest = JSON.parse(strFromU8(files['manifest.json']));
	const contribution = { version: 1, locale: 'de', snapshotId: manifest.snapshotId, entries: [{
		...manifest.entries.play, source: 'Old play wording', translation: 'Alte Wiedergabe',
	}] };
	await surface.getByLabel(en.import, { exact: true }).setInputFiles({
		name: 'stale-translations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(contribution)),
	});
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('play');
	await expect(surface.getByRole('alert')).toContainText(en.stale);
	await surface.getByRole('checkbox', { name: en.preview, exact: true }).check();
	await expect(editor.getByRole('button', { name: 'Alte Wiedergabe', exact: true })).toHaveCount(0);
});

test('RTL target preview restores the route presentation on close', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const surface = await openTranslator(page, editor);
	await surface.getByRole('combobox', { name: en.language, exact: true }).selectOption('ar');
	await expect(surface.getByRole('textbox', { name: en.source, exact: true })).toBeVisible();
	await surface.getByRole('checkbox', { name: en.preview, exact: true }).check();
	await expect(editor).toHaveCSS('direction', 'rtl');
	const arabicCatalog = JSON.parse(readFileSync(new URL('../../src/common/i18n/translations/ar.json', import.meta.url), 'utf8'));
	const arabic = await resolveCatalog('ar', { translationLoaders: { ar: async () => arabicCatalog } });
	const previewSurface = page.getByRole('dialog', { name: arabic['ui.communityTranslations.title'], exact: true });
	await previewSurface.getByRole('button', { name: arabic['ui.communityTranslations.close'], exact: true }).click();
	await expect(editor).toHaveCSS('direction', 'ltr');
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('preview updates an already displayed controller status and reset restores it', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const original = await editor.getByRole('status').filter({ hasText: 'Editor ready.' }).textContent();
	let surface = await openTranslator(page, editor);
	await selectMessage(surface, 'ready');
	await surface.getByRole('textbox', { name: en.translation, exact: true }).fill('Bereit im Test.');
	await surface.getByRole('button', { name: en.save, exact: true }).click();
	await surface.getByRole('checkbox', { name: en.preview, exact: true }).check();
	await expect(editor.getByText('Bereit im Test.', { exact: true })).toBeVisible();
	surface = page.getByRole('dialog', { name: de.title, exact: true });
	await surface.getByRole('button', { name: de.close, exact: true }).click();
	await expect(editor.getByRole('status').filter({ hasText: 'Editor ready.' })).toHaveText(original);
});

test('the picker preserves interpolation keys and preview formats the existing message parameters', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [captionLabels]);
	await expect(editor.getByRole('status').filter({ hasText: 'Imported 2 label(s).' })).toBeVisible();
	let surface = await openTranslator(page, editor);
	await surface.getByRole('button', { name: en.pick, exact: true }).click();
	await editor.getByRole('status').filter({ hasText: 'Imported 2 label(s).' }).click();
	await surface.getByRole('button', { name: /^labelsImported \(title\) —/u }).click();
	await expect(surface.getByRole('textbox', { name: en.key, exact: true })).toHaveValue('labelsImported');
	await expect(surface.getByRole('textbox', { name: en.source, exact: true })).toHaveValue('Imported {count} label(s).');
	await surface.getByRole('textbox', { name: en.translation, exact: true }).fill('Importiert: {count} Beschriftung(en).');
	await surface.getByRole('button', { name: en.save, exact: true }).click();
	await surface.getByRole('checkbox', { name: en.preview, exact: true }).check();
	await expect(editor.getByRole('status').filter({ hasText: 'Importiert: 2 Beschriftung(en).' })).toBeVisible();
	surface = page.getByRole('dialog', { name: de.title, exact: true });
	await surface.getByRole('button', { name: de.close, exact: true }).click();
	await expect(editor.getByRole('status').filter({ hasText: 'Imported 2 label(s).' })).toBeVisible();
});

test('Framescaper exposes the same opt-in language editor and restores its video menus after preview', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect(editor).toHaveAttribute('data-product', 'framescaper');
	await expect(page.getByRole('dialog', { name: en.title, exact: true })).toHaveCount(0);
	let surface = await openTranslator(page, editor);
	await selectMessage(surface, 'play');
	await surface.getByRole('textbox', { name: en.translation, exact: true }).fill('Video Probe play');
	await surface.getByRole('button', { name: en.save, exact: true }).click();
	await surface.getByRole('checkbox', { name: en.preview, exact: true }).check();
	await expect(editor.getByRole('button', { name: 'Video Probe play', exact: true })).toBeVisible();
	surface = page.getByRole('dialog', { name: de.title, exact: true });
	await surface.getByRole('button', { name: de.close, exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Help', 'About Framescaper');
	await expect(page.getByRole('dialog', { name: 'About Framescaper', exact: true })).toBeVisible();
});

test('an asynchronous file import retains draft edits saved while the file is reading', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const surface = await openTranslator(page, editor);
	const kitDownload = page.waitForEvent('download');
	await surface.getByRole('button', { name: en.po, exact: true }).click();
	const files = unzipSync(await downloadBytes(await kitDownload));
	const manifest = JSON.parse(strFromU8(files['manifest.json']));
	const contribution = { version: 1, locale: 'de', snapshotId: manifest.snapshotId,
		entries: [{ ...manifest.entries.ready, translation: 'Bereit nach Dateiimport.' }] };
	await page.evaluate(() => {
		const original = File.prototype.text;
		File.prototype.text = function () {
			if (this.name !== 'delayed-translations.json') return original.call(this);
			return new Promise((resolve, reject) => {
				globalThis.releaseTranslationImport = async () => {
					File.prototype.text = original;
					try { resolve(await original.call(this)); } catch (error) { reject(error); }
				};
			});
		};
	});
	await surface.getByLabel(en.import, { exact: true }).setInputFiles({
		name: 'delayed-translations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(contribution)),
	});
	await page.waitForFunction(() => typeof globalThis.releaseTranslationImport === 'function');
	await selectMessage(surface, 'stop');
	await surface.getByRole('textbox', { name: en.translation, exact: true }).fill('Stop from my newer draft');
	await surface.getByRole('button', { name: en.save, exact: true }).click();
	await page.evaluate(async () => { await globalThis.releaseTranslationImport(); });
	await expect(surface.getByRole('status').filter({ hasText: '2 changes; 0 need review.' })).toBeVisible();
	const jsonDownload = page.waitForEvent('download');
	await surface.getByRole('button', { name: en.export, exact: true }).click();
	const json = JSON.parse(new TextDecoder().decode(await downloadBytes(await jsonDownload)));
	expect(json.entries.map(({ key }) => key).sort()).toEqual(['ready', 'stop']);
	expect(json.entries.find(({ key }) => key === 'stop').translation).toBe('Stop from my newer draft');
});

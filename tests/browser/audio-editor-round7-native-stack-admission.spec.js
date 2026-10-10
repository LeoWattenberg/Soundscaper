/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, importFiles, openEffectsForTrack, openEffectStackMenu } from './audio-editor-test-helpers.js';
import { installNativePluginParameterHost } from './helpers/native-plugin-parameter-host.js';

test('native hosted stacks suspend unsupported copying while ordinary effect stacks still paste', async ({ page }) => {
	const nativeDialog = await openHostedStack(page);
	await nativeDialog.getByRole('button', { name: 'Close', exact: true }).first().click();
	await expect(nativeDialog).toBeHidden();
	const editor = page.locator('[data-audio-editor]');
	let panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'master', 'Invert');
	let menu = await openEffectStackMenu(panel, 'master');
	await expect(menu.getByRole('menuitem', { name: 'Copy effects', exact: true })).toHaveAttribute('aria-disabled', 'false');
	await menu.getByRole('menuitem', { name: 'Copy effects', exact: true }).click();
	panel = await openEffectsForTrack(editor, 0);
	menu = await openEffectStackMenu(panel, 'track');
	await menu.getByRole('menuitem', { name: 'Paste effects', exact: true }).click();
	await expect(panel.locator('.effect-slot__name-text')).toHaveText(['Invert', 'Invert']);
	panel = await openEffectsForTrack(editor, 1);
	menu = await openEffectStackMenu(panel, 'track');
	const copy = menu.getByRole('menuitem', { name: 'Copy effects', exact: true });
	if (await copy.getAttribute('aria-disabled') === 'false') {
		await copy.click();
		menu = await openEffectStackMenu(panel, 'track');
		await menu.getByRole('menuitem', { name: 'Paste effects', exact: true }).click();
		await expect(panel.getByRole('alert')).toContainText('Unsupported audio effect: native-plugin');
	}
	await expect(menu.getByRole('menuitem', { name: 'Copy effects', exact: true })).toHaveAttribute('aria-disabled', 'true');
});

test('native hosted stacks suspend unsupported macro export while ordinary effect macros still download', async ({ page }) => {
	const nativeDialog = await openHostedStack(page);
	await nativeDialog.getByRole('button', { name: 'Close', exact: true }).first().click();
	await expect(nativeDialog).toBeHidden();
	const editor = page.locator('[data-audio-editor]');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'master', 'Invert');
	let menu = await openEffectStackMenu(panel, 'master');
	await menu.getByRole('menuitem', { name: 'Export as macro', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativeStackSavedMacros)).toEqual(['Invert:\n']);
	menu = await openEffectStackMenu(panel, 'track');
	const macro = menu.getByRole('menuitem', { name: 'Export as macro', exact: true });
	if (await macro.getAttribute('aria-disabled') === 'false') {
		await macro.click();
		await expect(panel.getByRole('alert')).toContainText('Unsupported macro effect: native-plugin');
	}
	await expect(macro).toHaveAttribute('aria-disabled', 'true');
});

async function openHostedStack(page) {
	await installNativePluginParameterHost(page);
	await page.addInitScript(() => {
		const saved = [];
		let bytes = [];
		Object.defineProperty(globalThis, '__nativeStackSavedMacros', { configurable: true, value: saved });
		const bridge = globalThis.soundscaperDesktop.v1;
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
			...bridge,
			chooseSaveTarget: async ({ suggestedName }) => ({ id: 'macro-target', name: suggestedName }),
			beginWrite: async () => { bytes = []; return { writeId: 'macro-write', chunkSize: 1024 }; },
			writeChunk: async ({ offset, bytes: chunk }) => { bytes.push(...chunk); return { nextOffset: offset + chunk.length }; },
			finishWrite: async () => { saved.push(new TextDecoder().decode(Uint8Array.from(bytes))); return { byteLength: bytes.length }; },
		} } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'recording.wav', duration: 1, channelCount: 2 })]);
	await chooseCommandAction(page, editor, 'Effect', 'Audio Plugins');
	const dialog = page.getByRole('dialog', { name: 'Audio Plugins', exact: true });
	await dialog.getByRole('button', { name: 'Test Gain', exact: true }).click();
	await dialog.locator('[data-native-plugin-instantiate="gain-install"]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBe(1);
	return dialog;
}

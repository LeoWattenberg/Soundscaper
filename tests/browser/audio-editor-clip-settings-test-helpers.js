/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

export async function openClipMediaSettings(properties) {
	// Linked audio/video selections retain the native media drawer so their
	// picture fields and link stay owned by the existing inspector adapter.
	const drawer = properties.locator('[data-clip-properties-drawer="media"]');
	if (await drawer.count()) {
		if (await drawer.getAttribute('open') === null) await drawer.locator('summary').click();
		await expect(drawer).toHaveAttribute('open', '');
		return drawer;
	}
	await properties.getByRole('button', { name: 'Media settings', exact: true }).click();
	const menu = properties.page().getByRole('menu', { name: 'Media settings', exact: true });
	await expect(menu).toBeVisible();
	return menu;
}

export async function chooseClipMediaSetting(properties, label) {
	const menu = await openClipMediaSettings(properties);
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		await menu.getByRole('button', { name: label, exact: true }).click();
		return;
	}
	await menu.getByRole('menuitem', { name: label, exact: true })
		.or(menu.getByRole('menuitemcheckbox', { name: label, exact: true })).click();
	await expect(menu).toBeHidden();
}

export async function chooseClipPitchUnit(properties, label) {
	const menu = await openClipMediaSettings(properties);
	const units = menu.getByRole('menuitem', { name: /^Pitch unit(?:\s|$)/u });
	await units.focus();
	await units.press('ArrowRight');
	await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
	await expect(menu).toBeHidden();
}

export async function expectClipMediaSettingChecked(properties, label, checked) {
	const menu = await openClipMediaSettings(properties);
	await expect(menu.getByRole('menuitemcheckbox', { name: label, exact: true })).toHaveAttribute('aria-checked', String(checked));
	await closeClipMediaSettings(menu);
}

export async function expectClipSampleRate(properties, rate) {
	const menu = await openClipMediaSettings(properties);
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		const fact = menu.locator('[data-clip-source-fact="sampleRate"]');
		await expect(fact.locator('.audio-editor-field__value')).toHaveText(String(rate));
		await expect(fact.locator('input')).toHaveCount(0);
		await closeClipMediaSettings(menu);
		return;
	}
	const fact = menu.getByRole('menuitem', { name: new RegExp(`^Sample rate \\(Hz\\):\\s*${rate}$`, 'u') });
	await expect(fact).toBeVisible();
	await expect(fact).toBeDisabled();
	await closeClipMediaSettings(menu);
}

export async function readClipSampleRate(properties) {
	const menu = await openClipMediaSettings(properties);
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		const fact = menu.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value');
		await expect(fact).toBeVisible();
		const rate = Number(await fact.innerText());
		await closeClipMediaSettings(menu);
		return rate;
	}
	const fact = menu.getByRole('menuitem', { name: /^Sample rate \(Hz\):/u });
	await expect(fact).toBeDisabled();
	const match = (await fact.innerText()).match(/:\s*(\d+)$/u);
	expect(match).toBeTruthy();
	const rate = Number(match[1]);
	await closeClipMediaSettings(menu);
	return rate;
}

async function closeClipMediaSettings(menu) {
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		await menu.locator('summary').click();
		await expect(menu).not.toHaveAttribute('open');
		return;
	}
	await menu.press('Escape');
	await expect(menu).toBeHidden();
}

export async function openClipGainDialog(properties) {
	await chooseClipMediaSetting(properties, 'Clip gain (dB)');
	const dialog = properties.page().getByRole('dialog', { name: 'Clip gain (dB)', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

export async function setClipGain(properties, db) {
	const dialog = await openClipGainDialog(properties);
	await dialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true }).fill(String(db));
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden();
}

export async function readClipGain(properties) {
	const dialog = await openClipGainDialog(properties);
	const db = Number(await dialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true }).inputValue());
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	return db;
}

export async function expectClipGain(properties, db) {
	await expect.poll(() => readClipGain(properties)).toBe(db);
}

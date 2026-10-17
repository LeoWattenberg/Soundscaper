/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

export async function openClipMediaSettings(properties) {
	await properties.getByRole('button', { name: 'Media settings', exact: true }).click();
	const menu = properties.page().getByRole('menu', { name: 'Media settings', exact: true });
	await expect(menu).toBeVisible();
	return menu;
}

export async function chooseClipMediaSetting(properties, label) {
	const menu = await openClipMediaSettings(properties);
	await menu.getByRole('menuitem', { name: label, exact: true }).click();
	await expect(menu).toBeHidden();
}

export async function expectClipSampleRate(properties, rate) {
	const menu = await openClipMediaSettings(properties);
	const fact = menu.getByRole('menuitem', { name: new RegExp(`^Sample rate \\(Hz\\):\\s*${rate}$`, 'u') });
	await expect(fact).toBeVisible();
	await expect(fact).toBeDisabled();
	await closeClipMediaSettings(menu);
}

export async function readClipSampleRate(properties) {
	const menu = await openClipMediaSettings(properties);
	const fact = menu.getByRole('menuitem', { name: /^Sample rate \(Hz\):/u });
	await expect(fact).toBeDisabled();
	const match = (await fact.innerText()).match(/:\s*(\d+)$/u);
	expect(match).toBeTruthy();
	const rate = Number(match[1]);
	await closeClipMediaSettings(menu);
	return rate;
}

async function closeClipMediaSettings(menu) {
	await menu.press('Escape');
	await expect(menu).toBeHidden();
}

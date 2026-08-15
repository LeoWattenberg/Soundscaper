/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

/**
 * Audio rows label the overflow trigger from the design system and video rows from
 * product copy, so accept either name rather than assume one row type.
 */
export const TRACK_MENU_TRIGGER = /^(?:Track menu|Track options|Spuroptionen|Spurmenü)$/u;

/**
 * Drive a per-track command from the track control panel's overflow menu, which is where
 * track-scoped commands live rather than the application menubar. Pass a nested path to
 * reach a submenu such as Move track, Display, or Sample rate.
 */
export async function chooseTrackMenuAction(page, editor, trackRow, path) {
	const steps = Array.isArray(path) ? path : [path];
	const row = trackRow ?? editor.locator('[data-track-row]').first();
	await row.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
	let menu = page.locator('.audio-editor-track-menu');
	await expect(menu).toBeVisible();
	for (const [index, step] of steps.entries()) {
		const item = menu.getByRole('menuitem', { name: new RegExp(`^${escapeMenuLabel(step)}(?:\\s|$)`, 'u') }).first();
		if (index === steps.length - 1) {
			await item.click();
			return;
		}
		await expect(item).toBeEnabled();
		await item.focus();
		await page.keyboard.press('ArrowRight');
		menu = item.getByRole('menu');
		await expect(menu).toBeVisible();
	}
}

function escapeMenuLabel(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

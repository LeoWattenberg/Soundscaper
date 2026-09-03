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
 * reach a submenu such as Move track or Display.
 */
export async function chooseTrackMenuAction(page, editor, trackRow, path) {
	await (await openTrackMenuPath(page, editor, trackRow, path)).click();
}

async function openTrackMenuPath(page, editor, trackRow, path) {
	const steps = Array.isArray(path) ? path : [path];
	const row = trackRow ?? editor.locator('[data-track-row]').first();
	await row.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
	let menu = page.locator('.audio-editor-track-menu');
	await expect(menu).toBeVisible();
	let item = trackMenuItem(menu, steps[0]);
	for (const step of steps.slice(1)) {
		await expect(item).toBeEnabled();
		await item.focus();
		await page.keyboard.press('ArrowRight');
		menu = item.getByRole('menu');
		await expect(menu).toBeVisible();
		item = trackMenuItem(menu, step);
	}
	return item;
}

function trackMenuItem(menu, label) {
	return menu
		.getByRole('menuitem', { name: new RegExp(`^${escapeMenuLabel(label)}(?:\\s|$)`, 'u') })
		.first();
}

function escapeMenuLabel(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

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
	await (await openTrackMenuPath(page, editor, trackRow, path)).click();
}

/**
 * Take a track menu command only where it would change something, and report whether it
 * ran. A checked item restates state the track already carries - a sample rate the device
 * clock already decoded to - and commits nothing, so a caller that asserts a history entry
 * has to tell the two apart rather than read the no-op as a lost command.
 */
export async function chooseUncheckedTrackMenuAction(page, editor, trackRow, path) {
	const item = await openTrackMenuPath(page, editor, trackRow, path);
	if (await item.locator('> .context-menu-item-content > .context-menu-item-checkmark > *').count() === 0) {
		await item.click();
		return true;
	}
	// The first Escape closes the submenu the path opened, the second the track menu.
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(page.locator('.audio-editor-track-menu')).toBeHidden();
	return false;
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

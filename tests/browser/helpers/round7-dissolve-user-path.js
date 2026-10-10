/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { EDITOR_ENGLISH_COPY } from '../../../src/common/i18n/editor-copy-inventory.ts';
import {
	bootEditor, chooseNestedCommandAction, clickClipInterior, closeWorkspacePanel,
	importFiles, openClipProperties,
} from '../audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from '../fixtures/deterministic-av-media.js';

export async function openDissolve(page, editor, clip) {
	await clip.focus();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', [
		EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoTransitions'],
		EDITOR_ENGLISH_COPY['ui.framescaperMenus.addDissolveTransition'],
	]);
	return page.getByRole('dialog', { name: 'Dissolve Transition', exact: true });
}

export async function closeDissolve(page, dialog) {
	await page.mouse.move(1, 1);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
}

export async function ordinaryCameraPair(page) {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('round7-adjacent-camera.webm')]);
	const cameras = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(cameras).toHaveCount(1);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, cameras.first(), 0.5);
	await split.click();
	await expect(cameras).toHaveCount(2);
	const ids = await cameras.evaluateAll(clips => clips.map(clip => clip.getAttribute('data-clip-id')));
	expect(ids.every(Boolean)).toBe(true);
	const outgoing = editor.locator(`[data-clip-id="${ids[0]}"][role="group"]`);
	const incoming = editor.locator(`[data-clip-id="${ids[1]}"][role="group"]`);
	// Both public scenarios first prove that the normal adjacent pair can apply
	// and remove a real transition before changing the candidate geometry.
	const dialog = await openDissolve(page, editor, outgoing);
	await expect(dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true }).locator('option')).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Apply dissolve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Remove dissolve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.');
	await closeDissolve(page, dialog);
	return { editor, outgoing, incoming };
}

async function clipSampleField(page, editor, clip, field) {
	const properties = await openClipProperties(page, editor, clip);
	const drawer = properties.locator('[data-clip-properties-drawer="media"]');
	// Its compact bottom dock clips the tall vertical summary. Use the real
	// painted top strip rather than auto-scrolling its unpainted center.
	if (!await drawer.evaluate(element => element.open)) await drawer.locator('summary').click({ position: { x: 16, y: 4 } });
	const group = properties.locator(`[data-clip-field="${field}"] .timecode`);
	const digits = group.locator('.timecode-digit');
	if (await digits.count() !== 12) {
		await group.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	}
	await expect(digits).toHaveCount(12);
	return { properties, group, digits };
}

export async function readClipSamples(page, editor, clip, field) {
	const { digits } = await clipSampleField(page, editor, clip, field);
	const value = Number((await digits.allTextContents()).join(''));
	await closeWorkspacePanel(editor, 'clip-properties');
	return value;
}

export async function setClipSamples(page, editor, clip, field, value) {
	const { digits, group } = await clipSampleField(page, editor, clip, field);
	await digits.first().click();
	await page.keyboard.type(String(value).padStart(12, '0'));
	await page.keyboard.press('Enter');
	// Read the visible published display after leaving its draft owner. No
	// actions ever target the hidden internal direct-entry input.
	await group.locator('.timecode__format-button').focus();
	await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(value);
	await closeWorkspacePanel(editor, 'clip-properties');
	expect(await readClipSamples(page, editor, clip, field)).toBe(value);
}

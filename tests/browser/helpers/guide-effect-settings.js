/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { chooseDropdown, commitInput } from '../audio-editor-test-helpers.js';

/** Apply a guide effect setting using the control the reader can operate. */
export async function applyGuideEffectSetting(page, dialog, setting) {
	if ('value' in setting) {
		if (setting.expand) {
			const disclosure = dialog.locator('details').filter({
				has: page.locator('summary').filter({ hasText: setting.label }),
			});
			await expect(disclosure).toHaveCount(1);
			if (await disclosure.getAttribute('open') === null) {
				await disclosure.locator('summary').click();
			}
			await commitAndVerify(disclosure.getByRole('textbox', { name: setting.label, exact: true }), setting.value);
			return;
		}

		const group = settingGroup(dialog, setting.label);
		const groupedInput = group.getByRole('textbox').or(group.getByRole('spinbutton'))
			.or(group.locator('textarea, [data-timecode-direct-entry]'));
		if (await groupedInput.count()) {
			await commitAndVerify(groupedInput.first(), setting.value);
			return;
		}

		const graphicBand = dialog.locator('.audio-editor-graphic-eq').getByRole('slider', { name: setting.label, exact: true });
		if (await graphicBand.count() === 1) {
			await setRangeByKeyboard(graphicBand, setting.value);
			await expect(graphicBand).toHaveAttribute('aria-valuenow', setting.value);
			return;
		}

		const labelled = dialog.getByLabel(setting.label, { exact: true }).and(dialog.locator('input, textarea'));
		if (await labelled.count()) {
			await commitAndVerify(labelled.first(), setting.value);
			return;
		}

		throw new Error(`Could not find an editable effect setting labelled ${setting.label}.`);
	}

	if ('option' in setting) {
		const group = settingGroup(dialog, setting.label);
		if (await group.count()) {
			await chooseDropdown(page, group.first(), setting.option);
			return;
		}
		const labelled = dialog.getByLabel(setting.label, { exact: true });
		await chooseDropdown(page, labelled, setting.option);
		return;
	}

	const checkbox = dialog.getByRole('checkbox', { name: setting.label, exact: true });
	await checkbox.setChecked(setting.checked);
	if (setting.checked) await expect(checkbox).toBeChecked();
	else await expect(checkbox).not.toBeChecked();
}

async function commitAndVerify(control, value) {
	await commitInput(control, value);
	await expect(control).toHaveValue(value);
}

function settingGroup(dialog, label) {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return dialog.getByRole('group', { name: new RegExp(`^${escaped}(?: \\([^)]*\\))?$`, 'u') });
}

async function setRangeByKeyboard(slider, rawValue) {
	const value = Number(rawValue);
	if (!Number.isFinite(value)) throw new TypeError('A graphical EQ gain must be a finite number.');
	const minimum = Number(await slider.getAttribute('aria-valuemin'));
	const maximum = Number(await slider.getAttribute('aria-valuemax'));
	const step = Number(await slider.getAttribute('step')) || Number(await slider.getAttribute('aria-valuestep')) || 1;
	if (value < minimum || value > maximum) throw new RangeError(`Graphical EQ gain must be from ${minimum} to ${maximum} dB.`);
	await slider.focus();
	const current = Number(await slider.getAttribute('aria-valuenow'));
	const steps = Math.round((value - current) / step);
	if (Math.abs(current + steps * step - value) > 1e-8) {
		throw new RangeError(`Graphical EQ gain ${String(value)} dB is not reachable by its ${String(step)} dB keyboard step.`);
	}
	const key = steps < 0 ? 'ArrowDown' : 'ArrowUp';
	for (let index = 0; index < Math.abs(steps); index += 1) await slider.press(key);
}

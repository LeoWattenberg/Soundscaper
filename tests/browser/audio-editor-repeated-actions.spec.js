/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	longTone,
	monoTone,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	addRackEffect,
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	closeDialog,
	collectClientErrors,
	commitInput,
	importFiles,
	openEffectsForTrack,
	projectTimelineSourceNames,
	registerAudioEditorHooks,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';

async function activateProject(editor, tab, projectId) {
	await tab.click();
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await waitForProjectActivation(editor);
}

async function createProject(editor, previousProjectId) {
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(previousProjectId);
	await waitForProjectActivation(editor);
	return editor.getAttribute('data-project-id');
}

async function playPausePlay(editor) {
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const frame = async () => Number(await playhead.getAttribute('aria-valuenow'));
	const startFrame = await frame();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(frame).toBeGreaterThan(startFrame);
	await editor.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await editor.page().waitForTimeout(100);
	const pausedFrame = await frame();
	await editor.page().waitForTimeout(100);
	expect(await frame()).toBe(pausedFrame);

	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(frame).toBeGreaterThan(pausedFrame);
	await editor.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	return frame();
}

async function addConfiguredDelay(page, panel, values) {
	await addRackEffect(page, panel, 'track', 'Feedback delay');
	const host = page.locator('[data-effects-window-host]').last();
	const dialog = host.getByRole('dialog', { name: 'Feedback delay', exact: true });
	const effectId = await host.getAttribute('data-effect-window');
	expect(effectId).not.toBeNull();
	for (const [parameter, value] of Object.entries(values)) {
		await commitInput(dialog.locator(`[data-effect-param="${parameter}"] input`), value);
	}
	return effectId;
}

async function expectConfiguredDelay(page, panel, index, effectId, values) {
	const copies = panel.locator('[data-effect-rack]')
		.getByRole('group', { name: 'Feedback delay', exact: true });
	await copies.nth(index).getByRole('button', { name: 'Select effect', exact: true }).click();
	const host = page.locator('[data-effects-window-host]').last();
	await expect(host).toHaveAttribute('data-effect-window', effectId);
	const dialog = host.getByRole('dialog', { name: 'Feedback delay', exact: true });
	for (const [parameter, value] of Object.entries(values)) {
		await expect(dialog.locator(`[data-effect-param="${parameter}"] input`)).toHaveValue(value);
	}
	await closeDialog(dialog);
}

async function expectTimelineSourceNames(page, editor, projectId, names) {
	await expect(editor.locator('[data-save-state]')).toHaveAttribute(
		'data-state',
		'saved',
		{ timeout: 20_000 },
	);
	await expect.poll(() => projectTimelineSourceNames(page, projectId)).toEqual(names);
}

async function applyEffectChain(page, editor, projectId, trackName) {
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const effect of ['Invert', 'Reverse']) {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', effect]);
		await expect(editor.locator('[data-status]')).toHaveText(
			'Applied the Audacity effect.',
			{ timeout: 20_000 },
		);
		await expectTimelineSourceNames(page, editor, projectId, [`${trackName} — ${effect}.wav`]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
	}
}

async function undoEffectChain(page, editor, projectId, original, trackName) {
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expectTimelineSourceNames(page, editor, projectId, [`${trackName} — Invert.wav`]);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expectTimelineSourceNames(page, editor, projectId, [original.name]);
}

test.describe('repeated editor actions', () => {
	test.describe.configure({ timeout: 90_000 });
	registerAudioEditorHooks();

	test('plays again after pausing in each of two project tabs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const firstProjectId = await editor.getAttribute('data-project-id');
		expect(firstProjectId).not.toBeNull();
		await importFiles(editor, [longTone]);
		await playPausePlay(editor);

		const secondProjectId = await createProject(editor, firstProjectId);
		expect(secondProjectId).not.toBe(firstProjectId);
		await importFiles(editor, [longTone]);
		await playPausePlay(editor);

		const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
		await activateProject(editor, tabs.nth(0), firstProjectId);
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		const resumedFromFrame = Number(await playhead.getAttribute('aria-valuenow'));
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
			.toBeGreaterThan(resumedFromFrame);
		await editor.getByRole('button', { name: 'Pause', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('keeps two active copies of the same realtime effect independent', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openEffectsForTrack(editor, 1);
		const windows = page.locator('[data-effects-window-host]');
		const firstValues = { time: '0.125', feedback: '0.2', mix: '0.3' };
		const secondValues = { time: '0.5', feedback: '0.6', mix: '0.7' };
		const firstId = await addConfiguredDelay(page, panel, firstValues);
		const secondId = await addConfiguredDelay(page, panel, secondValues);
		await expect(windows).toHaveCount(2);
		const copies = panel.locator('[data-effect-rack]')
			.getByRole('group', { name: 'Feedback delay', exact: true });
		await expect(copies).toHaveCount(2);
		await copies.nth(0).getByRole('button', { name: 'Select effect', exact: true }).click();
		await expect(windows).toHaveCount(2);
		const first = page.locator(`[data-effect-window="${firstId}"]`)
			.getByRole('dialog', { name: 'Feedback delay', exact: true });
		for (const [parameter, value] of Object.entries(firstValues)) {
			await expect(first.locator(`[data-effect-param="${parameter}"] input`)).toHaveValue(value);
		}
		const second = page.locator(`[data-effect-window="${secondId}"]`)
			.getByRole('dialog', { name: 'Feedback delay', exact: true });
		for (const [parameter, value] of Object.entries(secondValues)) {
			await expect(second.locator(`[data-effect-param="${parameter}"] input`)).toHaveValue(value);
		}
		const [header, secondBounds, firstMixBounds] = await Promise.all([
			second.locator('.dialog-header').boundingBox(),
			second.boundingBox(),
			first.locator('[data-effect-param="mix"] input').boundingBox(),
		]);
		expect(header).not.toBeNull();
		expect(secondBounds).not.toBeNull();
		expect(firstMixBounds).not.toBeNull();
		const leftPosition = firstMixBounds.x - secondBounds.width - 16;
		const targetX = leftPosition >= 0
			? leftPosition
			: firstMixBounds.x + firstMixBounds.width + 16;
		await page.mouse.move(header.x + 24, header.y + header.height / 2);
		await page.mouse.down();
		await page.mouse.move(header.x + 24 + targetX - secondBounds.x, header.y + header.height / 2 + 32, { steps: 4 });
		await page.mouse.up();
		await commitInput(first.locator('[data-effect-param="mix"] input'), '0.35');
		await expect(first.locator('[data-effect-param="mix"] input')).toHaveValue('0.35');
		await expect(second.locator('[data-effect-param="mix"] input')).toHaveValue('0.7');
		firstValues.mix = '0.35';
		await closeDialog(second);
		await expect(windows).toHaveCount(1);
		const remaining = page.locator(`[data-effect-window="${firstId}"]`)
			.getByRole('dialog', { name: 'Feedback delay', exact: true });
		for (const [parameter, value] of Object.entries(firstValues)) {
			await expect(remaining.locator(`[data-effect-param="${parameter}"] input`)).toHaveValue(value);
		}
		await closeDialog(remaining);
		expect(errors).toEqual([]);
	});

	test('keeps duplicate realtime effects independent across project tabs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const firstProjectId = await editor.getAttribute('data-project-id');
		expect(firstProjectId).not.toBeNull();
		await importFiles(editor, [toneA]);
		let panel = await openEffectsForTrack(editor, 1);
		const firstValues = [
			{ time: '0.1', feedback: '0.2', mix: '0.3' },
			{ time: '0.4', feedback: '0.5', mix: '0.6' },
		];
		const firstIds = [];
		for (const values of firstValues) firstIds.push(await addConfiguredDelay(page, panel, values));
		await expect(page.locator('[data-effects-window-host]')).toHaveCount(2);

		const secondProjectId = await createProject(editor, firstProjectId);
		expect(secondProjectId).not.toBe(firstProjectId);
		await expect(page.locator('[data-effects-window-host]')).toHaveCount(0);
		await importFiles(editor, [toneB]);
		panel = await openEffectsForTrack(editor, 1);
		const secondValues = [
			{ time: '0.7', feedback: '0.2', mix: '0.4' },
			{ time: '0.9', feedback: '0.3', mix: '0.8' },
		];
		const secondIds = [];
		for (const values of secondValues) secondIds.push(await addConfiguredDelay(page, panel, values));
		await expect(page.locator('[data-effects-window-host]')).toHaveCount(2);

		const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
		await activateProject(editor, tabs.nth(0), firstProjectId);
		await expect(page.locator('[data-effects-window-host]')).toHaveCount(0);
		panel = await openEffectsForTrack(editor, 1);
		await expect(panel.locator('[data-effect-rack]')
			.getByRole('group', { name: 'Feedback delay', exact: true })).toHaveCount(2);
		for (let index = 0; index < firstValues.length; index += 1) {
			await expectConfiguredDelay(page, panel, index, firstIds[index], firstValues[index]);
		}

		await activateProject(editor, tabs.nth(1), secondProjectId);
		await expect(page.locator('[data-effects-window-host]')).toHaveCount(0);
		panel = await openEffectsForTrack(editor, 1);
		await expect(panel.locator('[data-effect-rack]')
			.getByRole('group', { name: 'Feedback delay', exact: true })).toHaveCount(2);
		for (let index = 0; index < secondValues.length; index += 1) {
			await expectConfiguredDelay(page, panel, index, secondIds[index], secondValues[index]);
		}
		expect(errors).toEqual([]);
	});

	test('keeps repeated imports independent across project tabs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const firstProjectId = await editor.getAttribute('data-project-id');
		expect(firstProjectId).not.toBeNull();

		await importFiles(editor, [toneA]);
		await importFiles(editor, [toneA]);
		await expect(clipByName(editor, toneA.name)).toHaveCount(2);

		const secondProjectId = await createProject(editor, firstProjectId);
		expect(secondProjectId).not.toBe(firstProjectId);
		await importFiles(editor, [toneA]);
		await importFiles(editor, [monoTone]);
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);

		const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
		await activateProject(editor, tabs.nth(0), firstProjectId);
		await expect(clipByName(editor, toneA.name)).toHaveCount(2);
		await expect(clipByName(editor, monoTone.name)).toHaveCount(0);
		await activateProject(editor, tabs.nth(1), secondProjectId);
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('keeps sequential destructive effect histories independent across project tabs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const firstProjectId = await editor.getAttribute('data-project-id');
		expect(firstProjectId).not.toBeNull();
		await importFiles(editor, [toneA]);
		await expectTimelineSourceNames(page, editor, firstProjectId, [toneA.name]);
		await applyEffectChain(page, editor, firstProjectId, 'browser-tone-a');

		const secondProjectId = await createProject(editor, firstProjectId);
		expect(secondProjectId).not.toBe(firstProjectId);
		await importFiles(editor, [toneB]);
		await expectTimelineSourceNames(page, editor, secondProjectId, [toneB.name]);
		await applyEffectChain(page, editor, secondProjectId, 'browser-tone-b');

		const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
		await activateProject(editor, tabs.nth(0), firstProjectId);
		await expectTimelineSourceNames(page, editor, firstProjectId, ['browser-tone-a — Reverse.wav']);
		await undoEffectChain(page, editor, firstProjectId, toneA, 'browser-tone-a');
		await activateProject(editor, tabs.nth(1), secondProjectId);
		await expectTimelineSourceNames(page, editor, secondProjectId, ['browser-tone-b — Reverse.wav']);
		await undoEffectChain(page, editor, secondProjectId, toneB, 'browser-tone-b');
		expect(errors).toEqual([]);
	});
});

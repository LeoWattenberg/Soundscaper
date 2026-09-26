/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/nightly-packaged-electron.js';
import {
	firstLaunchSetupSeedValue,
	firstLaunchSetupStorageKey,
} from '../../src/common/editor/ui/first-launch-setup.ts';

const PACKAGED_RUNTIME = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS === '1';
const PACKAGED_PLATFORM = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM;
const WORKSPACE_SETUP = Object.freeze({
	key: firstLaunchSetupStorageKey('soundscaper'),
	value: firstLaunchSetupSeedValue(),
});

test.describe('packaged Soundscaper display audio', () => {
	test.skip(!PACKAGED_RUNTIME, 'Runs only from the packaged Electron collection.');

	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.metadata.productId !== 'soundscaper', 'Soundscaper owns audio recording.');
		test.skip(PACKAGED_PLATFORM !== 'win32', 'Electron loopback capture is supported on Windows.');
		await page.evaluate(({ key, value }) => localStorage.setItem(key, value), WORKSPACE_SETUP);
		const editor = page.locator('[data-audio-editor]');
		await expect(editor).toBeVisible();
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(page.getByRole('progressbar', { name: 'Loading project', exact: true })).toHaveCount(0);
		await dismissWorkspaceOnboarding(page);
		if (!await editor.getAttribute('data-project-id')) {
			await editor.getByRole('button', { name: 'New project', exact: true }).click();
		}
		await expect(editor).not.toHaveAttribute('data-project-id', '');
	});

	test('records Windows loopback audio selected through Audio setup', async ({ page }) => {
		const editor = page.locator('[data-audio-editor]');
		const initialClipCount = Number(await editor.getAttribute('data-clip-count'));
		await startAudibleLoopbackTone(page);
		try {
			await openAudioSetup(editor);
			const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
			await setup.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('display');
			// The native display-capture boundary requires the editor window to own
			// focus; the nightly runner's progress window can retain foreground focus.
			await page.bringToFront();
			await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
			await setup.getByRole('button', { name: 'Choose display source', exact: true }).click();
			await expect(setup.getByRole('button', {
				name: 'Choose a different display source',
				exact: true,
			})).toBeVisible();
			await setup.getByRole('radio', { name: 'Stereo', exact: true }).check();
			await page.keyboard.press('Escape');

			const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
			await record.click();
			await expect(record).toHaveAttribute('aria-pressed', 'true');
			await expect.poll(async () => Number(await editor
				.getByRole('meter', { name: 'Input level', exact: true })
				.getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(-50);
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
			await expect(editor).toHaveAttribute('data-clip-count', String(initialClipCount + 1));
		} finally {
			const stop = editor.getByRole('button', { name: 'Stop', exact: true });
			if (await stop.isEnabled().catch(() => false)) await stop.click().catch(() => undefined);
			await releaseOpenInputs(editor);
			await stopAudibleLoopbackTone(page);
		}
	});
});

async function dismissWorkspaceOnboarding(page) {
	const onboarding = page.getByRole('dialog', { name: 'Getting started', exact: true });
	if (!await onboarding.isVisible().catch(() => false)) return;
	await onboarding.getByRole('button', { name: 'Soundscaper', exact: true }).click();
	await expect(onboarding).toHaveCount(0);
}

async function openAudioSetup(editor) {
	await editor.locator('[data-action-bar]')
		.getByRole('button', { name: 'Audio setup', exact: true }).click();
	await expect(editor.getByRole('dialog', { name: 'Audio setup', exact: true })).toBeVisible();
}

async function releaseOpenInputs(editor) {
	let setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	if (!await setup.isVisible().catch(() => false)) {
		await editor.getByRole('button', { name: 'Audio setup', exact: true }).click().catch(() => undefined);
		setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	}
	if (!await setup.isVisible().catch(() => false)) return;
	const release = setup.getByRole('button', { name: 'Disable microphones', exact: true });
	if (await release.isVisible().catch(() => false)) await release.click().catch(() => undefined);
	await setup.press('Escape').catch(() => undefined);
}

async function startAudibleLoopbackTone(page) {
	await page.evaluate(async () => {
		const context = new AudioContext({ sampleRate: 48_000 });
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		oscillator.frequency.value = 523.25;
		gain.gain.value = 0.25;
		oscillator.connect(gain).connect(context.destination);
		oscillator.start();
		await context.resume();
		globalThis.__packagedLoopbackTone = { context, oscillator };
	});
}

async function stopAudibleLoopbackTone(page) {
	await page.evaluate(async () => {
		const tone = globalThis.__packagedLoopbackTone;
		if (!tone) return;
		tone.oscillator.stop();
		await tone.context.close();
		delete globalThis.__packagedLoopbackTone;
	}).catch(() => undefined);
}

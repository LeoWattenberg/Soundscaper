/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Model Manager keyboard removal keeps focus on Install or the surviving filtered search', async ({ page }) => {
	await page.addInitScript(() => {
		let installed = true;
		const model = () => ({ modelId: 'deepfilternet3', version: '3.0.0', task: 'speech-enhancement',
			availability: installed ? 'installed' : 'installable', downloadBytes: 4096,
			installedBytes: installed ? 4096 : null, attributionRequired: false });
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			setLocale: async () => undefined,
			onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [model()] }),
			installAssistanceModel: async () => { installed = true; return model(); },
			cancelAssistanceModelInstall: async (modelId) => ({ contractVersion: 1, modelId, outcome: 'not-active' }),
			installPreseededAssistanceModel: async () => null,
			reconcileAssistanceModels: async () => ({ installedModelIds: installed ? ['deepfilternet3'] : [],
				incompleteModelIds: [], rejected: [] }),
			collectAssistanceModelGarbage: async () => ({ reclaimedBlobBytes: 0, discardedManifestCount: 0,
				discardedPartialCount: 0, discardedPartialBytes: 0, reclaimedBytes: 0 }),
			listAssistanceModelNotices: async () => [],
			relocateAssistanceModels: async () => null,
			removeAssistanceModel: async () => { installed = false; return 4096; },
			onAssistanceInstallProgress: () => () => undefined,
		} } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Model Manager');
	const manager = page.getByRole('dialog', { name: 'Model Manager', exact: true });
	const remove = manager.getByRole('button', { name: 'Remove', exact: true });
	await remove.focus();
	await remove.press('Enter');
	const install = manager.getByRole('button', { name: 'Install', exact: true });
	await expect(install).toBeFocused();
	await install.press('Enter');
	await expect(remove).toBeEnabled();
	await manager.getByRole('button', { name: 'Availability', exact: true }).click();
	await page.getByRole('option', { name: 'Installed', exact: true }).click();
	await remove.focus();
	await remove.press('Enter');
	await expect(manager.locator('[data-local-model-id]')).toHaveCount(0);
	await expect(manager.getByRole('textbox', { name: 'Search models', exact: true })).toBeFocused();
});

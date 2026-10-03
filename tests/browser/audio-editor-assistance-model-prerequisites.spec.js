/* SPDX-License-Identifier: AGPL-3.0-only */

import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';

const AUDIO = createWavFixture({
	name: 'assistance-model-prerequisites.wav',
	frequency: 330,
	duration: 1,
	channelCount: 1,
});

test.describe('AI effect model prerequisites', () => {
	registerAudioEditorHooks();

	test('shows cancellable progress while checking models without loading inference', async ({ page }) => {
		const { editor, errors } = await bootFixture(page, { holdList: true });
		await openAssistanceTask(page, editor, 'Enhance Dialogue');
		const loading = page.locator('[data-assistance-loading]');
		await expect(loading.getByRole('progressbar')).toBeVisible();
		await expect.poll(() => fixtureSnapshot(page)).toMatchObject({
			listCalls: 1, modelCalls: 0, createJobCalls: 0, installCalls: [],
		});
		await loading.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(loading).toBeHidden();
		await page.evaluate(() => globalThis.__assistancePrerequisiteFixture.releaseList());
		await expect(page.locator('[data-assistance-model-prerequisites]')).toHaveCount(0);
		await expect(page.locator('[data-local-assistance]')).toHaveCount(0);
		expect(await fixtureSnapshot(page)).toMatchObject({ modelCalls: 0, createJobCalls: 0 });
		expect(errors).toEqual([]);
	});

	test('lists the required model and disk size before runtime activation and cancels', async ({ page }) => {
		const { editor, errors } = await bootFixture(page);
		await openAssistanceTask(page, editor, 'Enhance Dialogue');
		const prerequisite = page.locator('[data-assistance-model-prerequisites]');
		await expect(prerequisite).toContainText(
			'Enhance Dialogue requires a model to be downloaded before it can be executed:',
		);
		await expect(prerequisite).toContainText('DeepFilterNet 3');
		await expect(prerequisite).toContainText('4 KiB');
		await expect(prerequisite).not.toContainText('Parakeet');
		await expect(prerequisite).not.toContainText('Alternative enhancer');
		await expect(prerequisite.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
		await expect(prerequisite.getByRole('button', {
			name: 'Open Model Manager', exact: true,
		})).toBeVisible();
		await expect(prerequisite.getByRole('button', { name: 'Download all', exact: true })).toBeVisible();
		expect(await fixtureSnapshot(page)).toMatchObject({
			modelCalls: 0, createJobCalls: 0, installCalls: [],
		});
		await prerequisite.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(prerequisite).toBeHidden();
		await expect(page.locator('[data-local-assistance]')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('opens Model Manager from the prerequisite without loading inference', async ({ page }) => {
		const { editor, errors } = await bootFixture(page);
		await openAssistanceTask(page, editor, 'Enhance Dialogue');
		const prerequisite = page.locator('[data-assistance-model-prerequisites]');
		await prerequisite.getByRole('button', { name: 'Open Model Manager', exact: true }).click();
		const manager = page.getByRole('dialog', { name: 'Model Manager', exact: true });
		await expect(manager).toBeVisible();
		await expect(manager.getByRole('row', { name: /DeepFilterNet 3/u })).toBeVisible();
		await expect(manager.getByRole('row', { name: /Parakeet/u })).toHaveCount(0);
		expect(await fixtureSnapshot(page)).toMatchObject({ modelCalls: 0, createJobCalls: 0 });
		await manager.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(manager).toBeHidden();
		await expect(prerequisite).toBeVisible();
		expect(await fixtureSnapshot(page)).toMatchObject({ modelCalls: 0, installCalls: [] });
		await prerequisite.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('downloads only the task models with progress before opening the effect', async ({ page }) => {
		const { editor, errors } = await bootFixture(page, { holdInstall: true });
		await openAssistanceTask(page, editor, 'Clean Filler & Silence');
		const prerequisite = page.locator('[data-assistance-model-prerequisites]');
		await expect(prerequisite).toContainText('Silero Voice Activity Detection');
		await expect(prerequisite).toContainText('8 KiB');
		await expect(prerequisite).toContainText('Parakeet TDT 0.6B v3');
		await expect(prerequisite).toContainText('16 KiB');
		await expect(prerequisite).not.toContainText('DeepFilterNet');
		await prerequisite.getByRole('button', { name: 'Download all', exact: true }).click();
		await expect(prerequisite.getByRole('progressbar').first()).toBeVisible();
		await expect.poll(() => fixtureSnapshot(page).then(({ installCalls }) => installCalls.length)).toBe(1);
		expect(await fixtureSnapshot(page)).toMatchObject({ modelCalls: 0, createJobCalls: 0 });
		await page.evaluate(() => globalThis.__assistancePrerequisiteFixture.releaseInstall());
		await expect.poll(() => fixtureSnapshot(page).then(({ installCalls }) => installCalls.length)).toBe(2);
		expect(await fixtureSnapshot(page)).toMatchObject({ modelCalls: 0, createJobCalls: 0 });
		await page.evaluate(() => globalThis.__assistancePrerequisiteFixture.releaseInstall());
		await expect(prerequisite).toBeHidden();
		const assistance = page.getByRole('dialog', { name: 'Clean Filler & Silence', exact: true });
		await expect(assistance.getByRole('button', { name: 'Run locally', exact: true })).toBeVisible();
		await expect.poll(() => fixtureSnapshot(page).then(({ modelCalls }) => modelCalls)).toBeGreaterThan(0);
		const { installCalls } = await fixtureSnapshot(page);
		expect(installCalls.slice().sort()).toEqual(['parakeet-tdt-0.6b-v3', 'silero-vad-v6']);
		expect(errors).toEqual([]);
	});

	test('bypasses the prerequisite for an installed model and shows runtime loading progress', async ({ page }) => {
		const { editor, errors } = await bootFixture(page, {
			installed: ['deepfilternet3'], holdModels: true,
		});
		await openAssistanceTask(page, editor, 'Enhance Dialogue');
		await expect.poll(() => fixtureSnapshot(page).then(({ modelCalls }) => modelCalls)).toBeGreaterThan(0);
		await expect(page.locator('[data-assistance-model-prerequisites]')).toHaveCount(0);
		await expect(page.getByRole('progressbar').first()).toBeVisible();
		expect(await fixtureSnapshot(page)).toMatchObject({ installCalls: [], createJobCalls: 0 });
		await page.evaluate(() => globalThis.__assistancePrerequisiteFixture.releaseModels());
		const assistance = page.getByRole('dialog', { name: 'Enhance Dialogue', exact: true });
		await expect(assistance.getByRole('button', { name: 'Run locally', exact: true })).toBeVisible();
		await expect(assistance.getByText('Required models are installed.', { exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
});

async function bootFixture(page, options = {}) {
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installFixture(page, options);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/en/');
	await importFiles(editor, [AUDIO], { timeout: 30_000 });
	const clip = clipByName(editor, AUDIO.name).first();
	await expect(clip).toBeVisible();
	await clip.focus();
	await page.keyboard.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	return { editor, errors };
}

async function fixtureSnapshot(page) {
	return page.evaluate(() => {
		const { listCalls, modelCalls, createJobCalls, installCalls } =
			globalThis.__assistancePrerequisiteFixture;
		return { listCalls, modelCalls, createJobCalls, installCalls: [...installCalls] };
	});
}

async function installFixture(page, options) {
	await page.addInitScript(({ installed = [], holdList = false, holdModels = false,
		holdInstall = false }) => {
		const installedIds = new Set([...installed, 'panns-cnn10', 'alternative-enhancer']);
		const definitions = [
			['deepfilternet3', '3.0.0', 'speech-enhancement', 4_096],
			['silero-vad-v6', '6.2.1', 'voice-activity-detection', 8_192],
			['parakeet-tdt-0.6b-v3', '3.0.0', 'speech-recognition', 16_384],
			['panns-cnn10', '1.0.0', 'audio-tagging', 32_768],
			['alternative-enhancer', '1.0.0', 'speech-enhancement', 65_536],
			['unsupported-enhancer', '1.0.0', 'speech-enhancement', 131_072],
		];
		const state = {
			listCalls: 0, modelCalls: 0, createJobCalls: 0, installCalls: [],
			releaseList: () => undefined,
			releaseModels: () => undefined,
			releaseInstall: () => undefined,
		};
		const listGate = holdList
			? new Promise((resolve) => { state.releaseList = resolve; }) : Promise.resolve();
		const modelsGate = holdModels
			? new Promise((resolve) => { state.releaseModels = resolve; }) : Promise.resolve();
		const installListeners = new Set();
		const modelRecord = ([modelId, version, task, downloadBytes]) => ({
			modelId, version, task, downloadBytes,
			availability: installedIds.has(modelId) ? 'installed'
				: modelId === 'unsupported-enhancer' ? 'unsupported-platform' : 'installable',
			installedBytes: installedIds.has(modelId) ? downloadBytes : null,
			attributionRequired: true,
		});
		const status = () => ({
			runtimeAvailable: true, runtimeReason: null,
			models: definitions.map(modelRecord),
		});
		const runtimeModels = () => definitions.filter(([id]) => installedIds.has(id))
			.map(([modelId, version, task]) => ({
				modelId, version, task, artifactSha256s: ['11'.repeat(32)],
			}));
		const createJob = async () => {
			state.createJobCalls += 1;
			return { contractVersion: 1, jobId: '22'.repeat(20) };
		};
		const unused = async () => { throw new Error('Inference is not used by the model prerequisite fixture.'); };
		const workflow = {
			createJob, run: unused,
			cancel: async (jobId) => ({ contractVersion: 1, jobId, outcome: 'not-active' }),
			onProgress: () => () => undefined,
			custody: { stageInput: unused, reserveOutput: unused, bindProducer: unused,
				release: async () => true },
			readOutput: unused,
		};
		const localAssistance = {
			models: async () => {
				state.modelCalls += 1;
				await modelsGate;
				return runtimeModels();
			},
			createJob, stageInput: unused, reserveOutput: unused, run: unused,
			cancel: async (jobId) => ({ contractVersion: 1, jobId, outcome: 'not-active' }),
			readOutput: unused, release: async () => true, onProgress: () => () => undefined,
			workflow,
		};
		const bridge = {
			getEnvironment: async () => null, signalReady: async () => undefined,
			setLocale: async () => undefined, onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined, onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			readNativeTierControls: async () => ({ probeHelperEnabled: false,
				probeHelperQuarantined: false, audioHelperEnabled: false,
				audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false }),
			applyNativeTierControl: unused,
			listAssistanceModels: async () => {
				state.listCalls += 1;
				await listGate;
				return status();
			},
			installAssistanceModel: async (modelId) => {
				state.installCalls.push(modelId);
				const definition = definitions.find(([id]) => id === modelId);
				if (!definition) throw new Error('An unknown fixture model was requested.');
				for (const listener of installListeners) listener({
					modelId, fileName: 'model.onnx', completedBytes: definition[3] / 2,
					totalBytes: definition[3],
				});
				if (holdInstall) await new Promise((resolve) => { state.releaseInstall = resolve; });
				installedIds.add(modelId);
				return modelRecord(definition);
			},
			cancelAssistanceModelInstall: async (modelId) => ({
				contractVersion: 1, modelId, outcome: 'not-active',
			}),
			installPreseededAssistanceModel: async () => null,
			reconcileAssistanceModels: async () => ({ installedModelIds: [...installedIds],
				incompleteModelIds: [], rejected: [] }),
			collectAssistanceModelGarbage: async () => ({ reclaimedBlobBytes: 0,
				discardedManifestCount: 0, discardedPartialCount: 0, discardedPartialBytes: 0,
				reclaimedBytes: 0 }),
			listAssistanceModelNotices: async () => [], relocateAssistanceModels: async () => null,
			removeAssistanceModel: async () => 0,
			onAssistanceInstallProgress: (listener) => {
				installListeners.add(listener);
				return () => installListeners.delete(listener);
			},
			localAssistance,
		};
		Object.defineProperty(globalThis, '__assistancePrerequisiteFixture', {
			configurable: true, value: state,
		});
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true, value: { v1: bridge },
		});
	}, options);
}

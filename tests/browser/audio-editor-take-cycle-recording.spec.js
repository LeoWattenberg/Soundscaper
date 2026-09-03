import { expect, longTone, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	collectClientErrors,
	getMenuItem,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = SOUNDSCAPER_DATABASE_NAME;
const RAW_SPOOL_PREFIX = 'raw-pcm-spool-registry-v1:';
const RECOVERY_ENVELOPE_PREFIX = 'take-cycle-recovery-envelope-v1:';

test.describe('Soundscaper routed take-cycle recording', () => {
	registerAudioEditorHooks();

	test('records ordered passes and explicitly recovers or discards after abrupt browser restarts', async ({ browserName, baseURL }) => {
		test.skip(browserName !== 'chromium', 'The restart witness requires one persistent Chromium profile.');
		test.setTimeout(180_000);
		const userDataDir = await mkdtemp(join(tmpdir(), 'soundscaper-cycle-browser-'));
		let context = await launchCycleContext(userDataDir, baseURL);
		let page = context.pages()[0] ?? await context.newPage();
		try {
			const initialErrors = collectClientErrors(page);
			let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
		await chooseCommandAction(page, editor, 'Select', 'Select none');

		await startTakeCycle(page, editor);
		await expect.poll(() => rawCaptureState(page)).toMatchObject({ count: 1, hasPcm: true });
		await page.waitForTimeout(200);
		await stopTakeCycle(editor);
		await expect.poll(() => durableCycleState(page), {
			message: 'ordinary cycle capture settles its durable roots',
			timeout: 30_000,
		}).toMatchObject({
			recoveryCount: 0,
			rawSpoolCount: 0,
			takeGroupCount: 1,
		});
		const settled = await durableCycleState(page);
		expect(settled.laneCount).toBeGreaterThanOrEqual(1);
		expect(settled.takeCount).toBe(settled.laneCount);
		expect(settled.takeSourceCount).toBe(settled.laneCount);
		expect(settled.missingTakeSources).toEqual([]);

		await startTakeCycle(page, editor);
		await expect.poll(() => rawCaptureState(page)).toMatchObject({ count: 1, hasPcm: true });
		await context.browser()?.close();
		context = await launchCycleContext(userDataDir, baseURL);
		const recoveredPage = context.pages()[0] ?? await context.newPage();
		const recoveredErrors = collectClientErrors(recoveredPage);
		editor = await bootRecoveryEditor(recoveredPage);
		let dialog = recoveredPage.getByRole('dialog', { name: 'Interrupted take recording', exact: true });
		await expect(dialog.getByRole('button', { name: 'Recover takes', exact: true })).toBeFocused();
		await expect(dialog).toContainText(/Generation \d+ contains 1 unsettled recording lane/u);
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(recoveredPage, '[data-take-cycle-recovery-dialog]');
		await recoveredPage.emulateMedia({ forcedColors: 'active' });
		await expect(dialog.getByRole('button', { name: 'Recover takes', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Recover takes', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 30_000 });
		await expect.poll(() => durableCycleState(recoveredPage), {
			message: 'explicit cycle recovery settles its durable roots',
			timeout: 30_000,
		}).toMatchObject({
			recoveryCount: 0,
			rawSpoolCount: 0,
			takeGroupCount: 1,
		});
		const afterRecovery = await durableCycleState(recoveredPage);
		expect(afterRecovery.laneCount).toBeGreaterThan(settled.laneCount);
		expect(afterRecovery.takeCount).toBe(afterRecovery.laneCount);
		expect(afterRecovery.missingTakeSources).toEqual([]);
		await recoveredPage.emulateMedia({ forcedColors: 'none' });

		await startTakeCycle(recoveredPage, editor);
		await expect.poll(() => rawCaptureState(recoveredPage)).toMatchObject({ count: 1, hasPcm: true });
		await context.browser()?.close();
		context = await launchCycleContext(userDataDir, baseURL);
		const discardedPage = context.pages()[0] ?? await context.newPage();
		const discardedErrors = collectClientErrors(discardedPage);
		editor = await bootRecoveryEditor(discardedPage);
		dialog = discardedPage.getByRole('dialog', { name: 'Interrupted take recording', exact: true });
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(dialog).toBeHidden();

		const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
		await expect(record).toBeDisabled();
		const recordOptions = editor.getByRole('button', { name: 'Record options', exact: true });
		await expect(recordOptions).toBeEnabled();
		await recordOptions.click();
		const menu = discardedPage.getByRole('menu', { name: 'Record options', exact: true });
		await expect(menu.getByRole('menuitem', { name: 'Resolve interrupted take recording', exact: true })).toBeEnabled();
		for (const label of [
			'Enable microphones',
			'Monitor input',
			'Recording offset',
			'Enable lead-in time',
			'Set up timed recording',
			'Sound-activated recording',
		]) {
			await expect(getMenuItem(menu, label)).toBeDisabled();
		}
		const disabledRecordItems = menu.locator('[role="menuitem"][aria-disabled="true"]');
		await expect(disabledRecordItems.filter({ hasText: 'Record onto the active track' })).toHaveCount(1);
		await expect(disabledRecordItems.filter({ hasText: 'Record new track' })).toHaveCount(1);
		await menu.getByRole('menuitem', { name: 'Resolve interrupted take recording', exact: true }).focus();
		await discardedPage.keyboard.press('Enter');
		dialog = discardedPage.getByRole('dialog', { name: 'Interrupted take recording', exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Discard takes', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 30_000 });
		await expect.poll(() => durableCycleState(discardedPage), {
			message: 'explicit cycle discard settles its durable roots',
			timeout: 30_000,
		}).toMatchObject({
			recoveryCount: 0,
			rawSpoolCount: 0,
			laneCount: afterRecovery.laneCount,
			takeCount: afterRecovery.takeCount,
		});
		const afterDiscard = await durableCycleState(discardedPage);
		expect(afterDiscard.takeSourceIds).toEqual(afterRecovery.takeSourceIds);
		expect(afterDiscard.missingTakeSources).toEqual([]);
			expect(initialErrors).toEqual([]);
			expect(recoveredErrors).toEqual([]);
			expect(discardedErrors).toEqual([]);
		} finally {
			await context.close().catch(() => undefined);
			await rm(userDataDir, { force: true, recursive: true });
		}
	});
});

async function startTakeCycle(page, editor) {
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Record options', exact: true });
	const start = menu.getByRole('menuitem', { name: 'Record loop into takes', exact: true });
	await expect(start).toBeEnabled();
	await start.focus();
	await page.keyboard.press('Enter');
	if (await editor.locator('[data-status]').getAttribute('data-state') === 'error') {
		throw new Error(await editor.locator('[data-status]').textContent() ?? 'Cycle recording failed.');
	}
	await expect(editor.getByRole('button', { name: 'Record onto the active track', exact: true }))
		.toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
}

async function stopTakeCycle(editor) {
	const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
	if (await editor.locator('[data-status]').getAttribute('data-state') === 'error') {
		throw new Error(await editor.locator('[data-status]').textContent() ?? 'Cycle recording finalization failed.');
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
}

async function bootRecoveryEditor(page) {
	await page.goto('/embed/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(page.getByRole('dialog', { name: 'Interrupted take recording', exact: true }))
		.toBeVisible({ timeout: 30_000 });
	return editor;
}

async function launchCycleContext(userDataDir, baseURL) {
	const context = await chromium.launchPersistentContext(userDataDir, {
		baseURL,
		headless: true,
		serviceWorkers: 'block',
	});
	await installCycleBrowserPorts(context);
	await serveCanonicalTranslations(context);
	return context;
}

async function serveCanonicalTranslations(context) {
	await context.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));
}

async function installCycleBrowserPorts(context) {
	await context.addInitScript(() => {
		const storage = navigator.storage ?? {};
		Object.defineProperty(storage, 'estimate', {
			configurable: true,
			value: () => Promise.resolve({ usage: 1024 ** 2, quota: 2 * 1024 ** 3 }),
		});
		Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });

		const streams = [];
		Object.defineProperty(globalThis, '__takeCycleStreams', { configurable: true, value: streams });
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				async getUserMedia() {
					const context = new AudioContext({ sampleRate: 48_000 });
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					const destination = context.createMediaStreamDestination();
					oscillator.frequency.value = 440;
					gain.gain.value = 0.1;
					oscillator.connect(gain).connect(destination);
					oscillator.start();
					await context.resume();
					const [track] = destination.stream.getAudioTracks();
					const getSettings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', {
						configurable: true,
						value: () => ({ ...getSettings(), channelCount: 1, sampleRate: 48_000, latency: 0 }),
					});
					streams.push({ context, oscillator, stream: destination.stream });
					return destination.stream;
				},
			},
		});
	});
}

async function rawCaptureState(page) {
	const state = await durableCycleState(page);
	return {
		count: state.rawSpoolCount,
		hasPcm: state.rawSpools.some(({ frameCount, chunkCount }) => frameCount > 0 && chunkCount > 0),
	};
}

async function durableCycleState(page) {
	return page.evaluate(async ({ databaseName, envelopePrefix, spoolPrefix }) => {
		const database = await new Promise((resolve, reject) => {
			const open = indexedDB.open(databaseName);
			open.onerror = () => reject(open.error);
			open.onsuccess = () => resolve(open.result);
		});
		const readAll = (storeName) => new Promise((resolve, reject) => {
			const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		try {
			const [projects, analysis, sources] = await Promise.all([
				readAll('projects'), readAll('analysis'), readAll('sources'),
			]);
			const project = projects[0] ?? null;
			const groups = project?.takeGroups ?? [];
			const takes = groups.flatMap((group) => group.takes ?? []);
			const sourceIds = new Set(sources.map((source) => source.id));
			const rawSpools = analysis
				.filter((row) => row.key?.startsWith(spoolPrefix))
				.flatMap((row) => row.value?.records ?? []);
			return {
				recoveryCount: analysis.filter((row) => row.key?.startsWith(envelopePrefix)).length,
				rawSpoolCount: rawSpools.length,
				rawSpools,
				takeGroupCount: groups.length,
				laneCount: groups.reduce((count, group) => count + (group.laneOrder?.length ?? 0), 0),
				takeCount: takes.length,
				takeSourceCount: new Set(takes.map((take) => take.sourceId)).size,
				takeSourceIds: [...new Set(takes.map((take) => take.sourceId))].sort(),
				missingTakeSources: takes.map((take) => take.sourceId).filter((sourceId) => !sourceIds.has(sourceId)),
			};
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		envelopePrefix: RECOVERY_ENVELOPE_PREFIX,
		spoolPrefix: RAW_SPOOL_PREFIX,
	});
}

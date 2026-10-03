import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { packagedRuntimeAudioArguments } from './helpers/packaged-runtime-audio-fixture.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

const DATABASE_NAME = SOUNDSCAPER_DATABASE_NAME;
const RAW_SPOOL_PREFIX = 'raw-pcm-spool-registry-v1:';
const RECOVERY_ENVELOPE_PREFIX = 'take-cycle-recovery-envelope-v1:';

test.describe('Soundscaper routed take-cycle recording', () => {
	registerAudioEditorHooks();

	test('records ordered passes and explicitly recovers or discards after abrupt browser restarts', async ({ browserName, baseURL }) => {
		test.skip(browserName !== 'chromium', 'The restart witness requires one persistent Chromium profile.');
		test.setTimeout(180_000);
		const userDataDir = await mkdtemp(join(tmpdir(), 'soundscaper-cycle-browser-'));
		const inputPaths = await prepareCycleInputs(userDataDir, [330, 660, 990]);
		let context = await launchCycleContext(userDataDir, baseURL, inputPaths[0]);
		let page = context.pages()[0] ?? await context.newPage();
		try {
			const initialErrors = collectClientErrors(page);
			let editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [toneA]);
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
			await chooseCommandAction(page, editor, 'Select', 'Select none');

			await startTakeCycle(page, editor);
			await expect.poll(() => rawCaptureState(page)).toMatchObject({ count: 1, hasPcm: true });
			await expect.poll(async () => (await rawCaptureState(page)).frameCount).toBeGreaterThanOrEqual(48_000);
			await stopTakeCycle(page, editor);
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

			await context.close();
			context = await launchCycleContext(userDataDir, baseURL, inputPaths[1]);
			page = context.pages()[0] ?? await context.newPage();
			const interruptedErrors = collectClientErrors(page);
			editor = await bootEditor(page, '/embed/en/');

			await startTakeCycle(page, editor);
			await expect.poll(() => rawCaptureState(page)).toMatchObject({ count: 1, hasPcm: true });
			await expect.poll(async () => (await rawCaptureState(page)).frameCount).toBeGreaterThanOrEqual(48_000);
			await context.browser()?.close();
			context = await launchCycleContext(userDataDir, baseURL, inputPaths[2]);
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
			const recoveredSourceIds = afterRecovery.takeSourceIds.filter((sourceId) => (
				!settled.takeSourceIds.includes(sourceId)
			));
			expect(recoveredSourceIds.length).toBeGreaterThan(0);
			const recoveredTake = afterRecovery.takes.find(({ sourceId, startSample, endSample }) => (
				recoveredSourceIds.includes(sourceId)
				&& startSample === afterRecovery.takeGroupStartSample
				&& endSample === afterRecovery.takeGroupEndSample
			));
			expect(recoveredTake).toBeTruthy();
			expect(recoveredTake.endSample - recoveredTake.startSample).toBe(38_400);
			await recoveredPage.emulateMedia({ forcedColors: 'none' });

			await startTakeCycle(recoveredPage, editor);
			await expect.poll(() => rawCaptureState(recoveredPage)).toMatchObject({ count: 1, hasPcm: true });
			await context.browser()?.close();
			context = await launchCycleContext(userDataDir, baseURL, inputPaths[2]);
			const discardedPage = context.pages()[0] ?? await context.newPage();
			const discardedErrors = collectClientErrors(discardedPage);
			await disableNativeSavePicker(discardedPage);
			editor = await bootRecoveryEditor(discardedPage);
			dialog = discardedPage.getByRole('dialog', { name: 'Interrupted take recording', exact: true });
			await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
			await expect(dialog).toBeHidden();

			const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
			await expect(record).toBeDisabled();
			const recordOptions = editor.getByRole('button', { name: 'Record options', exact: true });
			await expect(recordOptions).toBeEnabled();
			await recordOptions.click();
			const menu = discardedPage.getByRole('dialog', { name: 'Record options', exact: true });
			await expect(menu.getByRole('button', { name: 'Resolve interrupted take recording', exact: true })).toBeEnabled();
			for (const label of [
				'Record to new track',
				'Timed recording',
				'Sound-activated recording',
			]) {
				await expect(menu.getByRole('button', { name: label, exact: true })).toBeDisabled();
			}
			await expect(menu.getByRole('checkbox', { name: 'Lead-in time' })).toBeDisabled();
			await expect(menu.getByRole('checkbox', { name: 'Monitor input' })).toBeDisabled();
			await expect(menu.getByRole('button', { name: 'Sound activation' })).toBeDisabled();
			await expect(menu.getByRole('button', { name: 'Record loop into takes' })).toBeDisabled();
			await menu.getByRole('button', { name: 'Resolve interrupted take recording', exact: true }).focus();
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

			const recoveredAudio = await exportRecoveredTake(discardedPage, editor, recoveredTake);
			expect(recoveredAudio.sampleRate).toBe(48_000);
			expect(recoveredAudio.frameCount).toBe(38_400);
			expect(recoveredAudio.probeFrameCount).toBeGreaterThan(4_800);
			expect(recoveredAudio.rms).toBeGreaterThan(0.02);
			expect(Math.abs(recoveredAudio.frequency - 660)).toBeLessThan(3);
			expect(initialErrors).toEqual([]);
			expect(interruptedErrors).toEqual([]);
			expect(recoveredErrors).toEqual([]);
			expect(discardedErrors).toEqual([]);
		} finally {
			await context.close().catch(() => undefined);
			await rm(userDataDir, { force: true, recursive: true });
		}
	});

	test('settles an active take cycle when its routed input ends', async ({ browserName, baseURL }) => {
		test.skip(browserName !== 'chromium', 'The routed input fixture uses a persistent Chromium profile.');
		test.setTimeout(90_000);
		const userDataDir = await mkdtemp(join(tmpdir(), 'soundscaper-cycle-interruption-'));
		const [inputPath] = await prepareCycleInputs(userDataDir, [440]);
		const context = await launchCycleContext(userDataDir, baseURL, inputPath);
		const page = context.pages()[0] ?? await context.newPage();
		try {
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [toneA]);
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
			await chooseCommandAction(page, editor, 'Select', 'Select none');

			await startTakeCycle(page, editor);
			await expect.poll(() => rawCaptureState(page)).toMatchObject({ count: 1, hasPcm: true });
			await page.evaluate(() => {
				const active = globalThis.__takeCycleStreams.at(-1);
				if (!active) throw new Error('The routed take-cycle input was not acquired.');
				for (const track of active.stream.getAudioTracks()) {
					track.stop();
					// Calling stop() on a locally owned MediaStreamTrack does not
					// dispatch `ended`; a device disconnection does.
					track.dispatchEvent(new Event('ended'));
				}
			});

			const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
			await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
			const errorToast = page.locator('[data-editor-toast="workspace-status-error"]');
			await expect(errorToast).toBeVisible();
			await expect(errorToast).toContainText(/ended|interrupted|stopped/u);
			await expect.poll(() => durableCycleState(page), {
				message: 'input interruption discards the partial lane and settles its durable roots',
				timeout: 30_000,
			}).toMatchObject({ recoveryCount: 0, rawSpoolCount: 0 });
		} finally {
			await context.close().catch(() => undefined);
			await rm(userDataDir, { force: true, recursive: true });
		}
	});
});

async function startTakeCycle(page, editor) {
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	const menu = page.getByRole('dialog', { name: 'Record options', exact: true });
	const start = menu.getByRole('button', { name: 'Record loop into takes', exact: true });
	await expect(start).toBeEnabled();
	await start.click();
	const errorToast = page.locator('[data-editor-toast="workspace-status-error"]');
	if (await errorToast.isVisible()) {
		throw new Error(await errorToast.textContent() ?? 'Cycle recording failed.');
	}
	try {
		await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button'))
			.toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
	} catch (error) {
		if (await errorToast.isVisible()) {
			const message = await errorToast.textContent();
			if (message) throw new Error(message, { cause: error });
		}
		throw error;
	}
}

async function stopTakeCycle(page, editor) {
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
	const errorToast = page.locator('[data-editor-toast="workspace-status-error"]');
	if (await errorToast.isVisible()) {
		throw new Error(await errorToast.textContent() ?? 'Cycle recording finalization failed.');
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

async function launchCycleContext(userDataDir, baseURL, inputPath) {
	const context = await chromium.launchPersistentContext(userDataDir, {
		args: [...packagedRuntimeAudioArguments(inputPath), '--use-fake-ui-for-media-stream'],
		baseURL,
		headless: true,
		permissions: ['microphone'],
		serviceWorkers: 'block',
	});
	await installCycleBrowserPorts(context);
	return context;
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
		const mediaDevices = navigator.mediaDevices;
		const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
		Object.defineProperty(mediaDevices, 'getUserMedia', {
			configurable: true,
			async value(...args) {
				const stream = await getUserMedia(...args);
				streams.push({ stream });
				return stream;
			},
		});
	});
}

async function prepareCycleInputs(directory, frequencies) {
	return Promise.all(frequencies.map(async (frequency) => {
		const path = join(directory, `cycle-input-${String(frequency)}.wav`);
		await writeFile(path, createWavFixture({
			name: `cycle-input-${String(frequency)}.wav`,
			frequency,
			duration: 5,
			channelCount: 1,
			channelAmplitudes: [0.1],
		}).buffer);
		return path;
	}));
}

async function rawCaptureState(page) {
	const state = await durableCycleState(page);
	return {
		count: state.rawSpoolCount,
		frameCount: Math.max(0, ...state.rawSpools.map(({ frameCount }) => frameCount)),
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
			const takes = groups.flatMap((group) => (group.takes ?? []).map((take) => ({
				...take, trackId: group.trackId,
			})));
			const sourceIds = new Set(sources.map((source) => source.id));
			const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
			const rawSpools = analysis
				.filter((row) => row.key?.startsWith(spoolPrefix))
				.flatMap((row) => row.value?.records ?? []);
			return {
				recoveryCount: analysis.filter((row) => row.key?.startsWith(envelopePrefix)).length,
				rawSpoolCount: rawSpools.length,
				rawSpools,
				takeGroupCount: groups.length,
				takeGroupStartSample: groups[0]?.startSample ?? null,
				takeGroupEndSample: groups[0]?.endSample ?? null,
				laneCount: groups.reduce((count, group) => count + (group.laneOrder?.length ?? 0), 0),
				takeCount: takes.length,
				takeSourceCount: new Set(takes.map((take) => take.sourceId)).size,
				takeSourceIds: [...new Set(takes.map((take) => take.sourceId))].sort(),
				takes: takes.map((take, laneIndex) => ({
					id: take.id,
					trackId: take.trackId,
					laneIndex,
					laneId: take.laneId,
					sourceId: take.sourceId,
					sourceName: sourceNames.get(take.sourceId),
					startSample: take.startSample,
					endSample: take.endSample,
				})),
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

async function exportRecoveredTake(page, editor, take) {
	const original = clipByName(editor, toneA.name);
	const track = editor.locator(`[data-track-row][data-track-id="${take.trackId}"]`);
	await chooseTrackMenuAction(page, editor, track, 'Take lanes and comps');
	const comp = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	await expect(comp).toBeVisible();
	const recoveredLane = comp.locator('.audio-editor-take-comp__lanes > [role="listitem"]')
		.nth(take.laneIndex);
	const select = recoveredLane.getByRole('button', {
		name: `Select ${take.sourceName}`,
		exact: true,
	});
	await select.click();
	await expect(select).toHaveAttribute('aria-pressed', 'true');
	await comp.getByRole('button', { name: 'Promote for full group', exact: true }).click();
	await expect(comp.getByRole('table', { name: 'Comp regions', exact: true })
		.getByText(take.id, { exact: true })).toBeVisible();

	await comp.getByRole('button', { name: 'Flatten comp', exact: true }).click();
	await expect(comp.locator('[data-take-comp-empty]')).toBeVisible({ timeout: 30_000 });
	await comp.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(comp).toBeHidden();

	await original.locator('.clip-header').click();
	await editor.getByRole('region', { name: 'Timeline', exact: true }).first().press('Delete');
	await expect(original).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 30_000,
	});

	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 30_000 });
	const downloadPromise = page.waitForEvent('download');
	await link.click();
	const bytes = await downloadBytes(await downloadPromise);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(dialog).toBeHidden();
	return decodeToneWindow(page, bytes, take);
}

async function decodeToneWindow(page, bytes, take) {
	return page.evaluate(async ({ values, startSample, endSample }) => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(Uint8Array.from(values).buffer);
			const margin = Math.round(audio.sampleRate * 0.05);
			const start = startSample + margin;
			const end = Math.min(endSample - margin, start + Math.round(audio.sampleRate * 0.5));
			if (end <= start) throw new Error('Recovered take has no stable decoded probe window.');
			let samples = audio.getChannelData(0);
			let energy = windowEnergy(samples, start, end);
			for (let channel = 1; channel < audio.numberOfChannels; channel += 1) {
				const candidate = audio.getChannelData(channel);
				const candidateEnergy = windowEnergy(candidate, start, end);
				if (candidateEnergy > energy) {
					samples = candidate;
					energy = candidateEnergy;
				}
			}
			const crossings = [];
			for (let frame = start; frame < end; frame += 1) {
				if (frame > start && samples[frame - 1] <= 0 && samples[frame] > 0) crossings.push(frame);
			}
			if (crossings.length < 3) throw new Error('Recovered take decoded without a measurable tone.');
			const periods = crossings.slice(1).map((frame, index) => frame - crossings[index]);
			const meanPeriod = periods.reduce((sum, period) => sum + period, 0) / periods.length;
			return {
				sampleRate: audio.sampleRate,
				frameCount: audio.length,
				probeFrameCount: end - start,
				rms: Math.sqrt(energy / (end - start)),
				frequency: audio.sampleRate / meanPeriod,
			};
		} finally {
			await context.close();
		}

		function windowEnergy(samples, start, end) {
			let energy = 0;
			for (let frame = start; frame < end; frame += 1) energy += samples[frame] ** 2;
			return energy;
		}
	}, {
		values: Array.from(bytes),
		startSample: take.startSample,
		endSample: take.endSample,
	});
}

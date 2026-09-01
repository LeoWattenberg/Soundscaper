/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	createShortSoakTone,
	createStreamedSoakTone,
	runDecodedMediaProbe,
} from './soundscaper-soak-media.mjs';
import { createForeignScapeCustodyFixture } from './soundscaper-soak-scape-custody.mjs';

export function createSoundscaperSoakWorkflowDriver({ page, target, outputDirectory, restartRuntime = null }) {
	if (!page || typeof page.locator !== 'function' || !['browser', 'desktop'].includes(target)) {
		throw new TypeError('Soak-debug workflows require a Playwright page and runtime target.');
	}
	const outputRoot = resolve(outputDirectory ?? '.');
	let activePage = page;
	return Object.freeze({ execute });

	async function execute(operationId, options = {}) {
		const variant = Number.isSafeInteger(options.variant) && options.variant >= 0 ? options.variant : 0;
		const signal = abortSignal(options.signal);
		const operations = {
			'media-import': () => importTone(activePage, variant),
			'edit-history': () => editUndoRedo(activePage),
			'simulated-record-playback': () => recordAndPlay(activePage),
			'autosave-reload': () => autosaveAndReload(activePage, target, restartPage),
			'interrupted-take-recovery': () => interruptedTakeRecovery(activePage, restartPage),
			'wav-render': () => renderWav(activePage, target, outputRoot),
			'foreign-project-custody': () => foreignProjectCustody(
				activePage, target, outputRoot, variant, restartPage,
			),
			'decoded-media-probe': () => runDecodedMediaProbe(activePage),
			'streamed-playback-diagnostics': () => streamedPlaybackDiagnostics(
				activePage, variant, restartPage,
			),
			'desktop-persistent-delivery-recovery': () => persistentDeliveryRecovery(
				activePage, target, variant, restartPage,
			),
		};
		const operation = operations[operationId];
		if (!operation) throw new RangeError(`Unsupported soak-debug operation ${String(operationId)}.`);
		return abortableOperation(operation, signal);
	}

	async function restartPage(options = {}) {
		if (target === 'browser') {
			await activePage.reload({ waitUntil: 'domcontentloaded' });
			return activePage;
		}
		if (typeof restartRuntime !== 'function') {
			throw new Error('Packaged soak-debug persistence requires a restartable runtime.');
		}
		activePage = await restartRuntime(options);
		return activePage;
	}
}

function abortSignal(value) {
	if (value == null) return null;
	if (typeof value !== 'object' || typeof value.aborted !== 'boolean'
		|| typeof value.addEventListener !== 'function' || typeof value.removeEventListener !== 'function') {
		throw new TypeError('A soak-debug operation signal must be an AbortSignal.');
	}
	return value;
}

function abortableOperation(operation, signal) {
	if (!signal) return operation();
	if (signal.aborted) return Promise.reject(abortReason(signal));
	return new Promise((resolvePromise, reject) => {
		let settled = false;
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			callback(value);
		};
		const abort = () => finish(reject, abortReason(signal));
		signal.addEventListener('abort', abort, { once: true });
		Promise.resolve().then(operation).then(
			(value) => finish(resolvePromise, value),
			(error) => finish(reject, error),
		);
	});
}

function abortReason(signal) {
	return signal.reason instanceof Error
		? signal.reason : new Error('The soak-debug operation was aborted.');
}

async function importTone(page, variant) {
	const editor = await waitForEditor(page);
	const before = Number(await editor.getAttribute('data-clip-count'));
	await closeProjectBin(editor);
	await editor.locator('[data-import-input]').setInputFiles(createShortSoakTone(variant));
	await waitForStatus(editor);
	await waitForAttributeNumber(editor, 'data-clip-count', (value) => value > before);
	return {};
}

async function editUndoRedo(page) {
	const editor = await waitForEditor(page);
	const before = Number(await editor.getAttribute('data-track-count'));
	await chooseNestedMenu(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await waitForAttributeNumber(editor, 'data-track-count', (value) => value === before + 1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await waitForAttributeNumber(editor, 'data-track-count', (value) => value === before);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await waitForAttributeNumber(editor, 'data-track-count', (value) => value === before + 1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await waitForAttributeNumber(editor, 'data-track-count', (value) => value === before);
	return {};
}

async function recordAndPlay(page) {
	const editor = await waitForEditor(page);
	const before = Number(await editor.getAttribute('data-clip-count'));
	const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
	await record.click();
	await record.waitFor({ state: 'visible' });
	await page.waitForTimeout(400);
	await record.click();
	await waitForAttributeNumber(editor, 'data-clip-count', (value) => value > before);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await page.waitForTimeout(300);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await waitForAttributeNumber(editor, 'data-clip-count', (value) => value === before);
	return {};
}

async function autosaveAndReload(page, target, restartPage) {
	let editor = await waitForEditor(page);
	const projectId = await editor.getAttribute('data-project-id');
	const trackCount = await editor.getAttribute('data-track-count');
	const clipCount = await editor.getAttribute('data-clip-count');
	await waitForSaved(editor);
	if (target === 'browser') page = await restartPage({ abrupt: false });
	else {
		if (!projectId) throw new Error('Desktop project reopen requires its persisted identity.');
		const projectName = `Soak autosave ${projectId.slice(-8)}`;
		await renameProject(page, editor, projectName);
		await waitForSaved(editor);
		await chooseMenu(page, editor, 'File', 'Close project');
		await waitForAttributeChange(editor, 'data-project-id', projectId, 30_000);
		await chooseMenu(page, editor, 'File', 'Local projects');
		const projects = page.getByRole('dialog', { name: 'Local projects', exact: true });
		await projects.getByRole('button', {
			name: new RegExp(`^${escapeRegExp(projectName)}(?:\\s|$)`, 'u'),
		}).click();
		await waitForAttribute(editor, 'data-project-id', projectId, 30_000);
	}
	editor = await waitForEditor(page);
	const reopenedTrackCount = await editor.getAttribute('data-track-count');
	const reopenedClipCount = await editor.getAttribute('data-clip-count');
	if (reopenedTrackCount !== trackCount || reopenedClipCount !== clipCount) {
		throw new Error(`The autosaved project changed across reload (tracks ${String(trackCount)} to ${String(reopenedTrackCount)}, clips ${String(clipCount)} to ${String(reopenedClipCount)}).`);
	}
	return {};
}

async function interruptedTakeRecovery(page, restartPage) {
	let editor = await waitForEditor(page);
	const previousProjectId = await editor.getAttribute('data-project-id');
	await chooseMenu(page, editor, 'File', 'Close project');
	await waitForAttributeChange(editor, 'data-project-id', previousProjectId, 30_000);
	editor = await waitForEditor(page);
	await importTone(page, 1);
	await chooseMenu(page, editor, 'Select', 'Select all');
	await chooseNestedMenu(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await chooseMenu(page, editor, 'Select', 'Select none');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Record options', exact: true });
	const start = menu.getByRole('menuitem', { name: 'Record loop into takes', exact: true });
	await start.waitFor({ state: 'visible' });
	await start.press('Enter');
	const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
	await waitForAttribute(record, 'aria-pressed', 'true', 20_000);
	await page.waitForTimeout(500);
	page = await restartPage({ abrupt: true });
	editor = await waitForEditorBound(page);
	const recovery = page.getByRole('dialog', { name: 'Interrupted take recording', exact: true });
	await recovery.waitFor({ state: 'visible', timeout: 30_000 });
	await recovery.getByRole('button', { name: 'Recover takes', exact: true }).click();
	await recovery.waitFor({ state: 'hidden', timeout: 30_000 });
	const recoveredRecord = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
	if (!await recoveredRecord.isEnabled()) {
		throw new Error('Interrupted-take recovery did not restore the recording controls.');
	}
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	const recoveredMenu = page.getByRole('menu', { name: 'Record options', exact: true });
	if (await recoveredMenu.getByRole('menuitem', { name: 'Resolve interrupted take recording', exact: true })
		.isVisible().catch(() => false)) {
		throw new Error('Interrupted-take recovery left its recovery journal unresolved.');
	}
	await page.keyboard.press('Escape');
	return {};
}

async function renderWav(page, target, outputDirectory) {
	const editor = await waitForEditor(page);
	const before = target === 'desktop' ? await outputNames(outputDirectory) : null;
	await chooseMenu(page, editor, 'File', 'Export audio');
	const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
	await dialog.waitFor({ state: 'visible' });
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Start export', exact: true }).click();
	let signature;
	if (target === 'browser') {
		const link = dialog.locator('[data-export-download]');
		await link.waitFor({ state: 'visible', timeout: 60_000 });
		signature = await link.evaluate(async (node) => {
			const bytes = new Uint8Array(await (await fetch(node.href)).arrayBuffer());
			return new TextDecoder().decode(bytes.subarray(0, 4));
		});
	} else {
		const path = await waitForOutput(outputDirectory, before, '.wav', 60_000);
		signature = (await readFile(path)).subarray(0, 4).toString('ascii');
	}
	if (signature !== 'RIFF') throw new Error('The rendered WAV did not have a RIFF header.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return {};
}

async function foreignProjectCustody(page, target, outputDirectory, variant, restartPage) {
	let editor = await waitForEditor(page);
	const originalProjectId = await editor.getAttribute('data-project-id');
	if (!originalProjectId) throw new Error('Foreign-project custody requires an open project.');
	const source = await exportProject(page, editor, target, outputDirectory);
	const foreign = await createForeignScapeCustodyFixture(source, variant);
	await editor.locator('[data-aup4-input]').setInputFiles({
		name: `framescaper-custody-${String(variant >>> 0)}.fscape`,
		mimeType: 'application/vnd.soundscaper.scape+zip', buffer: foreign.archive,
	});
	await waitForAttribute(editor, 'data-project-id', foreign.projectId, 30_000);
	await waitForAttribute(editor, 'data-edit-block-reason', 'read-only', 30_000);
	if (Number(await editor.getAttribute('data-clip-count')) !== 0) {
		throw new Error('The foreign project was not held opaquely.');
	}
	const returned = await exportProject(page, editor, target, outputDirectory);
	if (!Buffer.from(returned).equals(foreign.archive)) {
		throw new Error('The read-only foreign project changed during custody.');
	}
	await chooseMenu(page, editor, 'File', 'Close project');
	editor = await waitForEditorBound(page);
	await waitForAttribute(editor, 'data-project-id', originalProjectId, 30_000);
	await waitForAttributeAbsent(editor, 'data-edit-block-reason', 30_000);
	await waitForSaved(editor);
	await restartPage({ abrupt: true });
	return {};
}

async function streamedPlaybackDiagnostics(page, variant, restartPage) {
	let editor = await waitForEditor(page);
	const previousProjectId = await editor.getAttribute('data-project-id');
	await chooseMenu(page, editor, 'File', 'Close project');
	await waitForAttributeChange(editor, 'data-project-id', previousProjectId, 30_000);
	editor = await waitForEditor(page);
	const before = Number(await editor.getAttribute('data-clip-count'));
	await closeProjectBin(editor);
	await editor.locator('[data-import-input]').setInputFiles(createStreamedSoakTone(variant));
	await waitForStatus(editor);
	await waitForAttributeNumber(editor, 'data-clip-count', (value) => value > before);
	await waitForSaved(editor, 180_000);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await page.waitForTimeout(1_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await chooseMenu(page, editor, 'Help', 'Diagnostics');
	const dialog = page.getByRole('dialog', { name: 'Local Diagnostics', exact: true });
	await dialog.waitFor({ state: 'visible' });
	await dialog.getByRole('button', { name: 'Generate local diagnostic report', exact: true }).click();
	const streaming = dialog.locator('[data-local-diagnostics-streaming]');
	await streaming.waitFor({ state: 'visible' });
	const streamedPlaybackObserved = await streaming.getAttribute('data-streamed-playback-observed') === 'true';
	const streamUnderrunFrames = Number(await streaming.getAttribute('data-stream-underrun-frames'));
	if (!streamedPlaybackObserved || !Number.isSafeInteger(streamUnderrunFrames) || streamUnderrunFrames < 0) {
		throw new Error('Local Diagnostics did not observe the real streamed-playback workflow.');
	}
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await restartPage({ abrupt: true });
	return { streamUnderrunFrames, streamedPlaybackObserved };
}

async function persistentDeliveryRecovery(page, target, variant, restartPage) {
	if (target !== 'desktop') throw new Error('Persistent delivery is a packaged-desktop workflow.');
	let editor = await waitForEditor(page);
	const projectId = await editor.getAttribute('data-project-id');
	if (!projectId) throw new Error('Persistent delivery requires its persisted project identity.');
	await renameProject(page, editor, `Soak delivery ${projectId.slice(-8)}`);
	await waitForSaved(editor);
	const presetName = `Soak WAV ${String(variant >>> 0)}`;
	await chooseMenu(page, editor, 'File', 'Export audio');
	const exportDialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
	await exportDialog.waitFor({ state: 'visible' });
	await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
	await exportDialog.locator('[data-delivery-preset-name]').fill(presetName);
	await exportDialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await exportDialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseMenu(page, editor, 'File', 'Delivery queue');
	let queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
	await queue.waitFor({ state: 'visible' });
	await queue.getByRole('button', { name: 'Choose destination', exact: true }).click();
	await queue.locator('[data-delivery-batch-preset]').filter({ hasText: presetName })
		.getByRole('checkbox').check();
	const existing = await queue.locator('[data-delivery-queue-job]').evaluateAll((rows) => (
		rows.map((row) => row.getAttribute('data-delivery-queue-job'))
	));
	await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
	const job = await waitForNewQueueJob(queue, new Set(existing), 30_000);
	await waitForQueueState(job, 'completed', 180_000);
	const jobId = await job.getAttribute('data-delivery-queue-job');
	if (!jobId) throw new Error('Persistent delivery produced no durable job identifier.');
	await queue.getByRole('button', { name: 'Close', exact: true }).click();
	page = await restartPage({ abrupt: false });
	editor = await waitForEditor(page);
	await chooseMenu(page, editor, 'File', 'Delivery queue');
	queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
	const recovered = queue.locator(`[data-delivery-queue-job="${escapeCss(jobId)}"]`);
	await recovered.waitFor({ state: 'visible', timeout: 30_000 });
	await waitForQueueState(recovered, 'completed', 30_000);
	await queue.getByRole('button', { name: 'Close', exact: true }).click();
	return {};
}

async function renameProject(page, editor, projectName) {
	await chooseMenu(page, editor, 'File', 'Rename project');
	const renameDialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await renameDialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(projectName);
	await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await waitForText(editor.locator('[data-project-name]'), projectName, 30_000);
}

async function exportProject(page, editor, target, outputDirectory) {
	if (target === 'browser') {
		const downloading = page.waitForEvent('download');
		await chooseMenu(page, editor, 'File', 'Export project file');
		const download = await downloading;
		const path = await download.path();
		if (!path) throw new Error('The browser did not retain exported Scape bytes.');
		const bytes = await readFile(path);
		await download.delete();
		return bytes;
	}
	const before = await outputNames(outputDirectory);
	await chooseMenu(page, editor, 'File', 'Export project file');
	return readFile(await waitForOutput(outputDirectory, before, '.sscape', 60_000));
}

async function waitForNewQueueJob(dialog, existing, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const rows = dialog.locator('[data-delivery-queue-job]');
		for (let index = 0; index < await rows.count(); index += 1) {
			const row = rows.nth(index);
			if (!existing.has(await row.getAttribute('data-delivery-queue-job'))) return row;
		}
		await dialog.page().waitForTimeout(100);
	}
	throw new Error('Persistent delivery did not create a queue job.');
}

async function waitForQueueState(job, wanted, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const state = await job.locator('[data-delivery-queue-state]').getAttribute('data-delivery-queue-state');
		if (state === wanted) return;
		if (['failed', 'cancelled', 'needs-authorization'].includes(state)) {
			throw new Error(`Persistent delivery entered ${String(state)} instead of ${wanted}.`);
		}
		await job.page().waitForTimeout(250);
	}
	throw new Error(`Persistent delivery did not reach ${wanted}.`);
}

async function outputNames(directory) {
	return new Set(await readdir(directory).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error)));
}

async function waitForOutput(directory, before, extension, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		for (const name of await readdir(directory)) {
			if (!before.has(name) && name.toLowerCase().endsWith(extension)) {
				const path = resolve(directory, name);
				if ((await stat(path)).size > 0) return path;
			}
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Desktop output ${extension} was not written.`);
}

async function closeProjectBin(editor) {
	const panel = editor.locator('[data-workspace-panel="project-bin"]');
	if (await panel.isVisible().catch(() => false)) {
		await panel.locator('.kw-audio-editor__workspace-panel-close').click();
		await panel.waitFor({ state: 'hidden' });
	}
}

async function waitForEditor(page) {
	const editor = await waitForEditorBound(page);
	await waitForAttributePresent(editor, 'data-project-id', 30_000);
	return editor;
}

async function waitForEditorBound(page) {
	const editor = page.locator('[data-audio-editor]');
	await editor.waitFor({ state: 'visible', timeout: 30_000 });
	await waitForAttribute(editor, 'data-audio-editor-bound', 'true', 30_000);
	return editor;
}

async function waitForStatus(editor) {
	const status = editor.locator('[data-status]');
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const state = await status.getAttribute('data-state');
		if (state === 'success' || state === 'info') return;
		if (state === 'error') throw new Error(await status.textContent() ?? 'The editor reported an error.');
		await editor.page().waitForTimeout(50);
	}
	throw new Error('The editor did not become ready.');
}

async function waitForSaved(editor, timeout = 30_000) {
	await waitForAttribute(editor.locator('[data-save-state]'), 'data-state', 'saved', timeout);
}

async function waitForAttribute(locator, attribute, value, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await locator.getAttribute(attribute) === value) return;
		await locator.page().waitForTimeout(50);
	}
	throw new Error(`${attribute} did not reach ${value}.`);
}

async function waitForAttributePresent(locator, attribute, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await locator.getAttribute(attribute)) return;
		await locator.page().waitForTimeout(50);
	}
	throw new Error(`${attribute} did not become available.`);
}

async function waitForAttributeChange(locator, attribute, value, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await locator.getAttribute(attribute) !== value) return;
		await locator.page().waitForTimeout(50);
	}
	throw new Error(`${attribute} did not change from ${value}.`);
}

async function waitForAttributeAbsent(locator, attribute, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await locator.getAttribute(attribute) === null) return;
		await locator.page().waitForTimeout(50);
	}
	throw new Error(`${attribute} did not clear.`);
}

async function waitForAttributeNumber(editor, attribute, predicate) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const value = Number(await editor.getAttribute(attribute));
		if (predicate(value)) return;
		await editor.page().waitForTimeout(50);
	}
	throw new Error(`${attribute} did not reach its expected value.`);
}

async function waitForText(locator, expected, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if ((await locator.textContent())?.trim() === expected) return;
		await locator.page().waitForTimeout(50);
	}
	throw new Error(`Text did not reach ${expected}.`);
}

async function chooseMenu(page, editor, menuName, itemName) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: menuName, exact: true }).click();
	const menu = page.getByRole('menu', { name: menuName, exact: true });
	await menu.waitFor({ state: 'visible' });
	const item = menu.getByRole('menuitem', {
		name: new RegExp(`^${escapeRegExp(itemName)}(?:\\s|$)`, 'u'),
	});
	if (await item.getAttribute('aria-disabled') === 'true') {
		const block = await editor.getAttribute('data-edit-block-reason');
		const save = await editor.locator('[data-save-state]').getAttribute('data-state');
		throw new Error(`${menuName} > ${itemName} is disabled (edit block ${String(block)}, save ${String(save)}).`);
	}
	await item.click();
}

async function chooseNestedMenu(page, editor, menuName, itemNames) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: menuName, exact: true }).click();
	let menu = page.getByRole('menu', { name: menuName, exact: true });
	for (const [index, name] of itemNames.entries()) {
		const item = menu.getByRole('menuitem', { name: new RegExp(`^${escapeRegExp(name)}(?:\\s|$)`, 'u') });
		if (index === itemNames.length - 1) await item.click();
		else { await item.press('ArrowRight'); menu = item.getByRole('menu'); await menu.waitFor({ state: 'visible' }); }
	}
}

async function chooseDropdown(page, group, optionName) {
	await group.getByRole('button').click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function escapeCss(value) {
	return value.replace(/["\\]/gu, '\\$&');
}

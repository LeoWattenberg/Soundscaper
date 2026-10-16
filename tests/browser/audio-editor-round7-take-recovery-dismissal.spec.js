/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { packagedRuntimeAudioArguments } from './helpers/packaged-runtime-audio-fixture.js';

async function recordingRoots(page) {
	return page.evaluate(async databaseName => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const rows = await result(database.transaction('analysis', 'readonly').objectStore('analysis').getAll());
			return {
				envelopes: rows.filter(({ key }) => key.startsWith('take-cycle-recovery-envelope-v1:')).length,
				frames: Math.max(0, ...rows.filter(({ key }) => key.startsWith('raw-pcm-spool-registry-v1:'))
					.flatMap(({ value }) => value.records ?? []).map(({ frameCount }) => frameCount)),
			};
		} finally { database.close(); }
	}, SOUNDSCAPER_DATABASE_NAME);
}

test('a completed interrupted-take decision keeps newer Preferences open after ordinary Close', async ({ browserName, baseURL }) => {
	test.skip(browserName !== 'chromium', 'The ordinary interrupted recording uses a persistent Chromium microphone profile.');
	test.setTimeout(120_000);
	const profile = await mkdtemp(join(tmpdir(), 'soundscaper-r7-recovery-dismissal-'));
	const inputPath = join(profile, 'microphone.wav');
	await writeFile(inputPath, createWavFixture({ name: 'microphone.wav', duration: 3, frequency: 330,
		channelCount: 1, channelAmplitudes: [0.1] }).buffer);
	let context;
	const launch = async () => {
		context = await chromium.launchPersistentContext(profile, { baseURL, headless: true,
			args: [...packagedRuntimeAudioArguments(inputPath), '--use-fake-ui-for-media-stream'],
			permissions: ['microphone'], serviceWorkers: 'block' });
		await context.addInitScript(() => {
			Object.defineProperty(navigator.storage, 'estimate', { configurable: true,
				value: async () => ({ usage: 1024 ** 2, quota: 2 * 1024 ** 3 }) });
		});
		return context.pages()[0] ?? await context.newPage();
	};
	const startInterrupted = async (page, editor) => {
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Record loop into takes', exact: true }).click();
		await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => (await recordingRoots(page)).frames).toBeGreaterThanOrEqual(48_000);
		await context.browser().close();
	};
	const bootRecovery = async page => {
		await page.goto('/embed/en/');
		const editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(page.getByRole('dialog', { name: 'Interrupted take recording', exact: true })).toBeVisible();
		return editor;
	};
	try {
		let page = await launch();
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await startInterrupted(page, editor);
		page = await launch();
		editor = await bootRecovery(page);
		let recovery = page.getByRole('dialog', { name: 'Interrupted take recording', exact: true });
		await recovery.getByRole('button', { name: 'Recover takes', exact: true }).click();
		await expect(recovery).toHaveCount(0);
		await expect.poll(async () => (await recordingRoots(page)).envelopes).toBe(0);
		await startInterrupted(page, editor);
		page = await launch();
		editor = await bootRecovery(page);
		recovery = page.getByRole('dialog', { name: 'Interrupted take recording', exact: true });
		await page.evaluate(async databaseName => {
			window.__round7RecoveryWriteActivity = performance.now();
			const beginTransaction = IDBDatabase.prototype.transaction;
			IDBDatabase.prototype.transaction = function (...args) {
				const transaction = beginTransaction.apply(this, args);
				if (args[1] === 'readwrite') {
					window.__round7RecoveryWriteActivity = performance.now();
					transaction.addEventListener('complete', () => { window.__round7RecoveryWriteActivity = performance.now(); });
					transaction.addEventListener('abort', () => { window.__round7RecoveryWriteActivity = performance.now(); });
				}
				return transaction;
			};
			const database = await new Promise((resolve, reject) => {
				const open = indexedDB.open(databaseName);
				open.onsuccess = () => resolve(open.result);
				open.onerror = () => reject(open.error);
			});
			const transaction = database.transaction('analysis', 'readwrite');
			let held = true;
			window.__round7ReleaseTakeDecision = () => { held = false; };
			const keepAlive = () => {
				const request = transaction.objectStore('analysis').get('__round7_recovery_hold__');
				request.onsuccess = () => { if (held) keepAlive(); };
			};
			transaction.oncomplete = () => database.close();
			transaction.onabort = () => database.close();
			setTimeout(() => { held = false; }, 10_000);
			keepAlive();
		}, SOUNDSCAPER_DATABASE_NAME);
		try {
			await recovery.getByRole('button', { name: 'Discard takes', exact: true }).click();
			await expect(recovery.getByRole('button', { name: 'Discarding takes', exact: true })).toBeDisabled();
			await recovery.getByRole('button', { name: 'Close', exact: true }).last().click();
			await expect(recovery).toHaveCount(0);
			await chooseCommandAction(page, editor, 'Edit', 'Preferences');
			const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
			await expect(preferences).toBeVisible();
			await page.evaluate(() => window.__round7ReleaseTakeDecision());
			await expect.poll(async () => (await recordingRoots(page)).envelopes).toBe(0);
			await expect.poll(() => page.evaluate(() => performance.now() - window.__round7RecoveryWriteActivity)).toBeGreaterThan(250);
			await expect(preferences).toBeVisible();
		} finally { await page.evaluate(() => window.__round7ReleaseTakeDecision?.()); }
	} finally {
		await context?.close().catch(() => undefined);
		await rm(profile, { recursive: true, force: true });
	}
});

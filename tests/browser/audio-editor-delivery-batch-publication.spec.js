/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	chooseFileAction,
	closeDialog,
	collectClientErrors,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('delivery batch publication', () => {
	registerAudioEditorHooks();

	test('reports only published files and retries the member whose first save failed', async ({ page }) => {
		test.setTimeout(120_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const exportDialog = await openExportDialog(page, editor);
		await saveAudioPreset(page, exportDialog, 'WAV master');
		await chooseDropdown(page, exportDialog.getByRole('group', { name: 'Format', exact: true }), 'AIFF');
		await saveAudioPreset(page, exportDialog, 'AIFF master');
		await closeDialog(exportDialog);

		await installFailOnceSaveTarget(page);
		await chooseFileAction(page, editor, 'Delivery queue');
		const queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
		await expect(queue).toBeVisible();
		const formats = queue.getByRole('group', { name: 'Formats', exact: true });
		await formats.getByRole('checkbox', { name: 'WAV master', exact: true }).check();
		await formats.getByRole('checkbox', { name: 'AIFF master', exact: true }).check();
		await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();

		const wav = queue.getByRole('listitem').filter({ hasText: 'project — WAV master' });
		const aiff = queue.getByRole('listitem').filter({ hasText: 'project — AIFF master' });
		await expect(wav).toContainText('Delivered', { timeout: 30_000 });
		await expect(aiff).toContainText('Failed', { timeout: 30_000 });
		await expect(queue.getByText('1 delivered, 1 failed, 0 cancelled, 0 not started.', { exact: true }))
			.toBeVisible();
		const firstPass = await publishedFiles(page);
		expect(firstPass.committed).toHaveLength(1);
		expect(firstPass.committed[0].name).toMatch(/\.wav$/u);
		expect(firstPass.committed[0].signature).toBe('RIFF');
		expect(firstPass.committed[0].byteLength).toBeGreaterThan(1_000);
		expect(firstPass.failed).toEqual([{ name: expect.stringMatching(/\.aiff$/u), aborts: 1 }]);

		await queue.getByRole('button', { name: 'Retry what did not deliver', exact: true }).click();
		await expect(aiff).toContainText('Delivered', { timeout: 30_000 });
		await expect(queue.getByText('2 delivered, 0 failed, 0 cancelled, 0 not started.', { exact: true }))
			.toBeVisible();
		const final = await publishedFiles(page);
		expect(final.committed).toHaveLength(2);
		expect(final.committed.map(({ name }) => name)).toEqual([
			firstPass.committed[0].name,
			expect.stringMatching(/\.aiff$/u),
		]);
		expect(final.committed.map(({ signature }) => signature)).toEqual(['RIFF', 'FORM']);
		expect(final.committed.every(({ byteLength }) => byteLength > 1_000)).toBe(true);
		expect(final.failed).toEqual(firstPass.failed);
		expect(errors).toEqual([]);
	});
});

async function saveAudioPreset(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await prompt.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(prompt).toBeHidden();
	await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText(name);
}

async function installFailOnceSaveTarget(page) {
	await page.evaluate(() => {
		const state = { sessions: [], failAiff: true };
		globalThis.__deliveryBatchFiles = state;
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async ({ suggestedName }) => ({
				name: suggestedName,
				async createWritable() {
					const session = { name: suggestedName, bytes: [], committed: false, aborts: 0 };
					state.sessions.push(session);
					return {
						async write(value) {
							if (state.failAiff && session.name.endsWith('.aiff')) {
								state.failAiff = false;
								throw new Error('One controlled AIFF destination write failure.');
							}
							if (value?.type === 'write') {
								const end = value.position + value.data.byteLength;
								while (session.bytes.length < end) session.bytes.push(0);
								value.data.forEach((byte, index) => { session.bytes[value.position + index] = byte; });
							} else {
								for (const byte of value) session.bytes.push(byte);
							}
						},
						async close() { session.committed = true; },
						async abort() { session.aborts += 1; },
					};
				},
			}),
		});
	});
}

async function publishedFiles(page) {
	return page.evaluate(() => {
		const sessions = globalThis.__deliveryBatchFiles.sessions;
		const summary = (session) => ({
			name: session.name,
			byteLength: session.bytes.length,
			signature: String.fromCharCode(...session.bytes.slice(0, 4)),
		});
		return {
			committed: sessions.filter((session) => session.committed).map(summary),
			failed: sessions.filter((session) => !session.committed).map(({ name, aborts }) => ({ name, aborts })),
		};
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { aup4NativeRichFixture, createAup3Fixture, createWavFixture, expect, test } from '../audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker } from '../audio-editor-test-helpers.js';

const providerOrigin = `http://127.0.0.1:${process.env.SCAPE_AUDIOCITY_PORT || '8091'}`;

test('connects through real OAuth, uploads and searches audio, streams playback, restores and disconnects', async ({ page }) => {
	const externalProviderRequests = [];
	page.context().on('request', request => {
		if (['api.audio.com', 'audio.com', 's3.audio.com', 's3.ustatik.com'].includes(new URL(request.url()).hostname)) externalProviderRequests.push(request.url());
	});
	const { editor, panel } = await connect(page);
	const uploads = panel.locator('[data-audiocom-uploads]');
	await uploads.locator('summary').click();
	const file = createWavFixture({ name: 'validation-tone.wav', frequency: 440, duration: 2, channelCount: 1 });
	await uploads.locator('input[type="file"]').setInputFiles(file);
	await uploads.getByRole('button', { name: /^Publish\s*: validation-tone\.wav$/u }).click();
	const dialog = page.locator('[data-audiocom-publish-dialog]');
	await dialog.locator('[name="title"]').fill('Audiocity validation tone');
	await dialog.locator('[name="visibility"]').selectOption('listed');
	await dialog.locator('[name="rightsConfirmed"]').check();
	const uploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audiocom/uploads' && response.request().method() === 'POST');
	await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
	expect((await uploadResponse).status()).toBe(201);
	await expect(uploads.locator('[data-upload-status="complete"]')).toBeVisible();
	await expect(uploads.getByRole('link', { name: 'Open on Audiocity', exact: true })).toHaveAttribute('href', new RegExp(`^${providerOrigin}/public/audio/`, 'u'));
	await panel.getByRole('searchbox', { name: 'Search Audiocity', exact: true }).fill('Audiocity validation tone');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	const result = panel.locator('[data-audiocom-audio-id]').filter({ hasText: 'Audiocity validation tone' });
	await expect(result).toContainText('0:02');
	const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audiocom/preview');
	await result.getByRole('button', { name: 'Play preview: Audiocity validation tone', exact: true }).click();
	const preview = await previewResponse;
	expect([200, 206]).toContain(preview.status());
	expect(preview.headers()['content-type']).toBe('audio/wav');
	await expect(result.getByRole('button', { name: 'Stop preview: Audiocity validation tone', exact: true })).toBeVisible();
	await result.getByRole('button', { name: 'Stop preview: Audiocity validation tone', exact: true }).click();
	await page.reload();
	await expect(panel.getByText('Connected to Audiocity', { exact: true })).toBeVisible();
	await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'Connect to Audiocity', exact: true })).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	expect(externalProviderRequests).toEqual([]);
});

for (const format of ['aup3', 'aup4']) test(`stores and retrieves a real ${format.toUpperCase()} archive and opens the downloaded project`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const { editor, panel } = await connect(page);
	const bytes = Buffer.from(format === 'aup3' ? await createAup3Fixture() : aup4NativeRichFixture());
	const archives = panel.locator('[data-audiocom-projects]');
	await archives.locator('summary').click();
	await archives.getByLabel('Upload AUP3 or AUP4', { exact: true }).setInputFiles({ name: `validation-${format}.${format}`, mimeType: 'application/octet-stream', buffer: bytes });
	await expect(archives.getByText(`Stored validation-${format}.${format}.`, { exact: true })).toBeVisible();
	const project = archives.locator('[data-audiocom-project-id]').filter({ hasText: `validation-${format}` });
	await expect(project).toContainText(format.toUpperCase());
	const downloadEvent = page.waitForEvent('download');
	await project.getByRole('button', { name: /^Download project/u }).click();
	const download = await downloadEvent;
	expect(download.suggestedFilename()).toBe(`validation-${format}.${format}`);
	const downloaded = await readFile(await download.path());
	expect(hash(downloaded)).toBe(hash(bytes));
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: download.suggestedFilename(), mimeType: 'application/x-audacity-project', buffer: downloaded });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-track-count', format === 'aup3' ? '1' : '2');
	await expect(editor).toHaveAttribute('data-clip-count', format === 'aup3' ? '1' : '5');
});

async function connect(page) {
	const editor = await bootEditor(page, '/embed/en/');
	const panel = editor.locator('[data-workspace-panel="audiocom"]');
	await expect(panel).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	const server = preferences.getByRole('textbox', { name: 'Server URL', exact: true });
	await expect(server).toHaveValue('https://api.audio.com');
	await server.fill(providerOrigin);
	await preferences.getByRole('button', { name: 'Save server', exact: true }).click();
	await expect(preferences.getByRole('button', { name: 'Save server', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
	await expect(panel.getByRole('button', { name: 'Connect to Audiocity', exact: true })).toBeVisible();
	await expect(panel).toContainText(providerOrigin);
	const popupEvent = page.waitForEvent('popup');
	await panel.getByRole('button', { name: 'Connect to Audiocity', exact: true }).click();
	const authorization = await popupEvent;
	await expect(authorization).toHaveURL(new RegExp(`^${providerOrigin}/auth/authorize\\?`, 'u'));
	await authorization.getByLabel('Email', { exact: true }).fill('soundscaper-validation@example.test');
	await authorization.getByLabel('Password', { exact: true }).fill('soundscaper-audiocity-test-only-password');
	await authorization.getByRole('button', { name: 'Allow access', exact: true }).click();
	await expect(panel.getByText('Connected to Audiocity', { exact: true })).toBeVisible();
	return { editor, panel };
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

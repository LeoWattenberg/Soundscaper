import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('local diagnostic reports', () => {
	registerAudioEditorHooks();

	for (const { productId, path } of [
		{ productId: 'soundscaper', path: '/embed/en/' },
		{ productId: 'framescaper', path: '/framescaper/embed/en/' },
	]) {
		test(`${productId} generates and exports an offline privacy-bounded report`, async ({ page }) => {
			const editor = await bootEditor(page, path);
			const postBootRequests = [];
			const observeRequest = (request) => postBootRequests.push(request.url());
			page.on('request', observeRequest);

			await chooseCommandAction(page, editor, 'Help', 'Diagnostics');
			const dialog = editor.getByRole('dialog', { name: 'Local Diagnostics', exact: true });
			await expect(dialog).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			postBootRequests.length = 0;
			await expect(dialog.getByRole('button', {
				name: 'Export local diagnostic report', exact: true,
			})).toHaveCount(0);

			await dialog.getByRole('button', {
				name: 'Generate local diagnostic report', exact: true,
			}).click();
			for (const heading of [
				'Versions', 'Environment', 'Capabilities', 'Recent typed errors',
				'Storage and library', 'Recovery journals',
			]) await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();

			const downloadEvent = page.waitForEvent('download');
			await dialog.getByRole('button', {
				name: 'Export local diagnostic report', exact: true,
			}).click();
			const download = await downloadEvent;
			expect(download.suggestedFilename()).toMatch(
				new RegExp(`^${productId}-diagnostics-\\d{4}-\\d{2}-\\d{2}\\.json$`, 'u'),
			);
			const bytes = await streamBytes(await download.createReadStream());
			expect(bytes.byteLength).toBeLessThanOrEqual(128 * 1024);
			const text = new TextDecoder().decode(bytes);
			const report = JSON.parse(text);
			expect(Object.keys(report)).toEqual([
				'kind', 'schemaVersion', 'generatedAt', 'product', 'versions', 'environment',
				'capabilities', 'errors', 'storage', 'library', 'recovery',
			]);
			expect(report.kind).toBe('soundscaper-local-diagnostics');
			expect(report.schemaVersion).toBe(1);
			expect(report.product).toEqual({ id: productId });
			expect(report.versions.application).toBe('1.0.0-rc.1');
			expect(report.environment.kind).toBe('browser');
			expect(report.errors.recent.length).toBeLessThanOrEqual(32);
			expect(text).not.toMatch(/"(?:title|path|message|stack|transcript|media|sources|clips)"/u);
			expect(postBootRequests).toEqual([]);
			page.off('request', observeRequest);
		});
	}
});

async function streamBytes(stream) {
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return Buffer.concat(chunks);
}

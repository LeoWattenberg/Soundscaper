import initSqlJs from 'sql.js';
import { createAup3Fixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, trackNameText } from './audio-editor-test-helpers.js';

test('opens a checkpointed Audacity 3 project through the File menu', async ({ page }) => {
	await page.addInitScript(() => {
		const NativeWorker = globalThis.Worker;
		globalThis.__audacityImportRequests = [];
		globalThis.Worker = class extends NativeWorker {
			constructor(url, options) { super(url, options); this.audacity = options?.name === 'kw-media-audacity-projects'; }
			postMessage(message, ...options) {
				if (this.audacity) globalThis.__audacityImportRequests.push(message.type);
				super.postMessage(message, ...options);
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const samples = Array.from({ length: 65_536 }, (_, index) => Math.sin(index / 17) * 0.5);
	const blocks = [{ samples }, { samples }, { samples: [0.25] }];
	const bytes = await createAup3Fixture({ tracks: [
		{ name: 'Stereo recording', channel: 0, linked: true, clips: [{ blocks }] },
		{ name: 'Stereo recording', channel: 1, clips: [{ blocks }] },
	] });
	// Native 3.7 projects keep WAL flags even in their checkpointed main file.
	bytes[18] = 2;
	bytes[19] = 2;
	new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(60, 0x03070000);
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({
		name: 'Windows recording.AUP3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes),
	});
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-track-count', '1');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(trackNameText(editor).first()).toHaveText('Stereo recording');
	const requests = await page.evaluate(() => globalThis.__audacityImportRequests);
	expect(requests).toContain('plan-import');
	expect(requests).toContain('read-import-chunk');
	expect(requests.filter((type) => type === 'read-import-chunk')).toHaveLength(4);
	expect(requests).not.toContain('decode');
});

test('keeps a complete import error readable and permits opening another AUP3', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const SQL = await initSqlJs();
	const bytes = await createAup3Fixture({ SQL });
	const database = new SQL.Database(bytes);
	const table = `unsupported_${'project_metadata_'.repeat(12)}end`;
	let invalid;
	try {
		database.run(`CREATE TABLE ${table} (id INTEGER)`);
		invalid = database.export();
	} finally { database.close(); }
	const originalProject = await editor.getAttribute('data-project-id');
	await editor.locator('[data-aup4-input]').setInputFiles({
		name: 'unsupported.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(invalid),
	});
	const status = editor.locator('[data-status]');
	await expect(status).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
	await expect(status).toContainText(`Unexpected SQLite schema object: table ${table}.`);
	await expect(editor).toHaveAttribute('data-project-id', originalProject);
	await expect(status).toHaveCSS('white-space', 'pre-wrap');
	expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	await status.focus();
	await expect(status).toBeFocused();
	await expect(status).toHaveAttribute('title', await status.textContent());
	await editor.locator('[data-aup4-input]').setInputFiles({
		name: 'valid.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes),
	});
	await expect(status).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

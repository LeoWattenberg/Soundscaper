/* SPDX-License-Identifier: AGPL-3.0-only */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';

const routeRoot = '/__motionscaper-retained-archive__';
test('large successor original download verifies temporary storage support, exact bytes and leased cleanup', async ({ page }) => {
	test.setTimeout(60_000);
	const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
	const bundled = await build({ stdin: { resolveDir: repositoryRoot, contents: `
		import { openFramescaperSuccessorDatabase } from './src/framescaper/editor-project-successor-database.ts';
		import { stageFramescaperArchiveCustody, readFramescaperArchiveCustody } from './src/framescaper/editor-project-successor-archive-custody.ts';
		import { FRAMESCAPER_ARCHIVE_STORES } from './src/framescaper/editor-project-successor-archive-record.ts';
		import { transact } from './src/common/editor/storage/indexeddb-backend.ts';
		import { createAudioEditorFileService } from './src/common/editor/file-service.js';
		import { createScapeArchiveByteSource } from './src/common/editor/scape-archive-byte-source.ts';
		import { saveFramescaperRetainedOriginal } from './src/framescaper/editor-project-successor-original-save.ts';
		export async function mount() {
			const bytes = new Uint8Array(17*1024*1024); bytes[0]=27; bytes[bytes.length-1]=43;
			const database = await openFramescaperSuccessorDatabase(indexedDB,'successor');
			const stage = await stageFramescaperArchiveCustody(database,new Blob([bytes]));
			await transact(database,FRAMESCAPER_ARCHIVE_STORES,'readwrite',stores=>stage.publish(stores)); database.close();
			const original = readFramescaperArchiveCustody(stage.reference,stage.reference.sha256,indexedDB); globalThis.archiveReadCount=0;
			const input=createScapeArchiveByteSource({size:original.size,read:request=>{globalThis.archiveReadCount++;return original.read(request);}});
			const button=document.createElement('button'); button.textContent='Download retained original';
			const status=document.createElement('p'); status.setAttribute('role','status');
			button.onclick=()=>{ button.disabled=true; void saveFramescaperRetainedOriginal(input,stage.reference.sha256,'large-original.fscape',createAudioEditorFileService({bridge:null}),new AbortController().signal).then(async retained=>{button.disabled=false; status.textContent='Download published'; await retained?.cleanup(); status.textContent='Cleanup complete';},error=>{status.textContent=String(error);}).catch(error=>{status.textContent=String(error);}); };
			document.body.append(button,status);
		}
	` }, bundle: true, write: false, format: 'esm', target: 'es2022' });
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.route(`**${routeRoot}/**`, async route => {
		if (new URL(route.request().url()).pathname.endsWith('/harness.js')) await route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
		else await route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><script type="module">import {mount} from '${routeRoot}/harness.js';await mount();</script>` });
	});
	await page.goto(`${routeRoot}/`); const button = page.getByRole('button', { name: 'Download retained original' }); await expect(button).toBeEnabled();
	const persistent = await page.evaluate(async () => {
		expectSecureContext();
		function expectSecureContext(): void { if (!isSecureContext) throw new Error('The storage fixture requires a secure context.'); }
		if (typeof navigator.storage?.getDirectory !== 'function') return false;
		const root = await navigator.storage.getDirectory(); const name = 'native-download-capability';
		try { const file = await root.getFileHandle(name, { create: true });
			if (typeof file.createWritable !== 'function') return false;
			const writer = await file.createWritable(); await writer.write(new Uint8Array([19, 37])); await writer.close();
			if ([...new Uint8Array(await (await file.getFile()).arrayBuffer())].join(',') !== '19,37') throw new Error('Native temporary storage changed its test bytes.'); return true;
		} finally { await root.removeEntry(name); }
	});
	if (!persistent) {
		const downloads: string[] = []; const listener = (download: { suggestedFilename(): string }) => downloads.push(download.suggestedFilename()); page.on('download', listener);
		try { await button.click(); await expect(page.getByRole('status')).toContainText('requires streaming file saves or available temporary file storage');
			expect(await page.evaluate(() => (globalThis as unknown as { archiveReadCount: number }).archiveReadCount)).toBe(0); expect(downloads).toEqual([]);
		} finally { page.off('download', listener); }
		return;
	}
	const downloaded = page.waitForEvent('download'); await button.click(); const path = await (await downloaded).path(); expect(path).not.toBeNull();
	const expected = Buffer.alloc(17 * 1024 * 1024); expected[0] = 27; expected[expected.length - 1] = 43;
	const bytes = await readFile(path!); expect(bytes.length).toBe(expected.length); await expect(button).toBeEnabled();
	expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(expected).digest('hex'));
	await expect(page.getByRole('status')).toHaveText('Cleanup complete', { timeout: 35_000 });
	const retained = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); const directory = await root.getDirectoryHandle('audio-editor-exports'); const keys: string[] = []; for await (const key of directory.keys()) keys.push(key); return keys; });
	expect(retained).toEqual([]);
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';

const routeRoot = '/__motionscaper-successor-migration__';

test('successor menu upgrades an archive durably and downloads the retained original after reopen', async ({ page }) => {
	const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
	const bundled = await build({ stdin: { resolveDir: repositoryRoot, contents: `
		import { createFramescaperSuccessorMigrationMenuItems } from './src/common/editor/ui/framescaper-successor-migration-menu.ts';
		import { createFramescaperProject } from './src/framescaper/editor-project.ts';
		import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
		import { sha256 } from '@noble/hashes/sha2.js';
		import { bytesToHex } from '@noble/hashes/utils.js';
		export function mount() {
			const menu = createFramescaperSuccessorMigrationMenuItems('framescaper')[0];
			const button = document.createElement('button'); button.textContent = menu.label;
			button.onclick = () => { void menu.onClick(); }; document.body.append(button);
		}
		export async function original() {
			const text = JSON.stringify(createFramescaperProject(undefined, { id: 'migration-browser', title: 'Browser migration' }));
			const bytes = new TextEncoder().encode(text);
			const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
			await writer.add('project.json', new TextReader(text));
			await writer.add('manifest.json', new TextReader(JSON.stringify({ format: 'scape-project', formatVersion: 1,
				project: { entry: 'project.json', schemaFamily: 'framescaper', schemaVersion: 1, size: bytes.length, sha256: bytesToHex(sha256(bytes)) }, assets: [] })));
			return Array.from(new Uint8Array(await (await writer.close()).arrayBuffer()));
		}
	` }, bundle: true, write: false, format: 'esm', target: 'es2022', define: { __SCAPE_FRAMESCAPER_LINE__: '"successor"' } });
	await page.route(`**${routeRoot}/**`, async (route) => {
		if (new URL(route.request().url()).pathname.endsWith('/harness.js')) {
			await route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
		} else await route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><script type="module">import {mount} from '${routeRoot}/harness.js';mount();</script>` });
	});
	await page.goto(`${routeRoot}/`);
	const original = Buffer.from(await page.evaluate(async (url) => {
		const harness = await import(url) as { original(): Promise<number[]> }; return harness.original();
	}, `${routeRoot}/harness.js`));
	await page.getByRole('button', { name: 'Upgrade archive for Framescaper 1.1 development…' }).click();
	await expect(page.getByRole('status')).toContainText('0 upgraded projects');
	await page.locator('input[type=file]').setInputFiles({ name: 'original.fscape', mimeType: 'application/zip', buffer: original });
	await expect(page.getByRole('status')).toContainText('1 upgraded project');
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.reload();
	await page.getByRole('button', { name: 'Upgrade archive for Framescaper 1.1 development…' }).click();
	await expect(page.getByRole('status')).toContainText('1 upgraded project');
	const downloaded = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download original v1 archive' }).click();
	const path = await (await downloaded).path();
	expect(path).not.toBeNull(); if (path === null) throw new Error('The original archive download is unavailable.');
	expect(await readFile(path)).toEqual(original);
	const upgraded = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download upgraded v2 archive' }).click();
	expect((await upgraded).suggestedFilename()).toBe('Browser migration-v2.fscape');
});

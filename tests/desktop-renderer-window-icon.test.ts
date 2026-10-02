/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { Resvg } from '@resvg/resvg-js';

import { desktopWindowOptions } from '../desktop/window-chrome.mjs';
import { buildRenderer } from '../scripts/desktop-prepare.mjs';
import {
	createSquareOfflineIconSvg,
	generateProductWindowIcon,
} from '../scripts/lib/offline-application-shell.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('desktop window icons contain the canonical selected product raster', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-desktop-window-icons-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const icons = [];
	for (const productId of ['soundscaper', 'framescaper']) {
		const rendererRoot = join(root, productId, 'resources', 'renderer');
		const path = await generateProductWindowIcon({ outputRoot: rendererRoot, repositoryRoot, productId });
		assert.equal(path, desktopWindowOptions({ rendererRoot, productId }).icon);
		const bytes = await readFile(path);
		assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
		assert.equal(bytes.readUInt32BE(16), 512);
		assert.equal(bytes.readUInt32BE(20), 512);
		const sourcePath = join(repositoryRoot, 'public', 'logo', `${productId}.svg`);
		const source = await readFile(sourcePath, 'utf8');
		const expected = new Resvg(createSquareOfflineIconSvg(source, 512, sourcePath), {
			fitTo: { mode: 'width', value: 512 }, font: { loadSystemFonts: false },
		}).render().asPng();
		assert.deepEqual(bytes, expected);
		assert.deepEqual(await readdir(rendererRoot), ['offline-icons']);
		assert.deepEqual(await readdir(join(rendererRoot, 'offline-icons')), [`${productId}-512.png`]);
		icons.push(bytes);
	}
	assert.notDeepEqual(icons[0], icons[1], 'the two products retain their distinct marks');
	await assert.rejects(() => generateProductWindowIcon({ outputRoot: root, repositoryRoot, productId: 'unknown' }),
		/unsupported/u);
});

test('desktop preparation regenerates its window icon after Vite clears the renderer', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-desktop-renderer-icon-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const productId of ['soundscaper', 'framescaper']) {
		const rendererRoot = join(root, productId, 'renderer');
		const icon = desktopWindowOptions({ rendererRoot, productId }).icon;
		const phases: string[] = [];
		await buildRenderer({
			repositoryRoot, rendererRoot, productId,
			environment: { PUBLIC_FFMPEG_CORE_BASE_URL: 'https://example.invalid/runtime/', SCAPE_BUILD_SOURCE_MAPS: '1' },
			runBuild: async (command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) => {
				assert.equal(command, process.execPath);
				assert.deepEqual(args, [join(repositoryRoot, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', rendererRoot]);
				assert.ok(options.env);
				assert.equal(options.env.SCAPE_PRODUCT, productId);
				assert.equal(options.env.SCAPE_DESKTOP_CODEC_RUNTIME, 'main-process');
				assert.equal(options.env.PUBLIC_FFMPEG_CORE_BASE_URL, undefined);
				await rm(rendererRoot, { recursive: true, force: true });
				await mkdir(rendererRoot, { recursive: true });
				await writeFile(join(rendererRoot, 'index.html'), '<!doctype html>');
				phases.push('vite');
			},
			buildSmoke: async (options: { rendererRoot: string; productId: string; sourceMaps?: boolean }) => {
				assert.equal(options.rendererRoot, rendererRoot);
				assert.equal(options.productId, productId);
				assert.equal(options.sourceMaps, true);
				assert.equal((await readFile(icon)).readUInt32BE(16), 512);
				phases.push('smoke');
				return { entryPoint: '', outputPath: '', sourceMapPath: null };
			},
			audit: async () => {
				await readFile(icon); phases.push('audit');
				return { status: 'desktop-codec-composition' as const, inspectedFileCount: 1 };
			},
		});
		assert.deepEqual(phases, ['vite', 'smoke', 'audit']);
	}
});

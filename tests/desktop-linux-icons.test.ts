/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { Resvg } from '@resvg/resvg-js';
import { convertIcon } from 'app-builder-lib/out/util/iconConverter.js';
import type { Configuration } from 'electron-builder';

import { generateDesktopIcon } from '../scripts/desktop-icons.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const expectedSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

test('Linux packages receive every icon size with the selected product artwork', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-linux-icons-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputPath = join(root, 'icons/icon.png');
	const linuxDirectory = join(root, 'icons/linux');
	const productIcons: Buffer[] = [];
	for (const productId of ['soundscaper', 'framescaper']) {
		const sourcePath = join(repositoryRoot, `public/logo/${productId}.svg`);
		assert.equal(await generateDesktopIcon({ sourcePath, outputPath }), outputPath);
		const { icons, isFallback } = await convertIcon({
			sources: [linuxDirectory], fallbackSources: [], roots: [root],
			format: 'set', outDir: join(root, 'converted'),
		});
		assert.equal(isFallback, false, 'the package must use its own icons');
		assert.deepEqual(icons.map(({ size }) => size), expectedSizes);
		const source = await readFile(sourcePath, 'utf8');
		for (const { file, size } of icons) {
			assert.equal(file, join(linuxDirectory, `${size}x${size}.png`));
			const bytes = await readFile(file);
			assert.equal(bytes.readUInt32BE(16), size);
			assert.equal(bytes.readUInt32BE(20), size);
			const expected = new Resvg(source, {
				fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false },
			}).render().asPng();
			assert.deepEqual(bytes, expected, `${productId} ${size}px artwork`);
		}
		const master = await readFile(outputPath);
		assert.deepEqual(await readFile(join(linuxDirectory, '1024x1024.png')), master);
		productIcons.push(master);
	}
	assert.notDeepEqual(productIcons[0], productIcons[1]);
});

test('Debian and AppImage configurations select the Linux icon set', () => {
	const configPath = join(repositoryRoot, 'electron-builder.config.cjs');
	const originalProduct = process.env.SCAPE_PRODUCT;
	try {
		for (const productId of ['soundscaper', 'framescaper']) {
			process.env.SCAPE_PRODUCT = productId;
			delete require.cache[configPath];
			const config = require(configPath) as Configuration;
			assert.deepEqual(config.linux?.target, ['AppImage', 'deb']);
			assert.equal(config.linux?.icon, '.desktop-build/icons/linux');
			assert.equal(config.linux?.executableName, productId);
			assert.equal(config.win?.icon, '.desktop-build/icons/icon.png');
			assert.equal(config.mac?.icon, '.desktop-build/icons/icon.png');
		}
		const nightly = require(join(repositoryRoot, 'electron-builder.nightly-tests.config.cjs')) as Configuration;
		assert.equal(nightly.linux?.icon, '.desktop-build/icons/linux');
	} finally {
		if (originalProduct === undefined) delete process.env.SCAPE_PRODUCT;
		else process.env.SCAPE_PRODUCT = originalProduct;
		delete require.cache[configPath];
	}
});

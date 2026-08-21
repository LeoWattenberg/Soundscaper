/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { packageDesktopNightlyTestProducts } from '../scripts/desktop-nightly-tests-products.mjs';
import {
	createDesktopNightlyTestsPackagedMetricsPlan,
	packagedRuntimeChromiumArguments,
	resolvePackagedProductExecutable,
} from '../scripts/lib/desktop-nightly-tests-packaged-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('packaged-runtime executable resolution is closed over the staged product trees', () => {
	const root = '/opt/Soundscaper Tests/resources/nightly-tests/products';
	assert.equal(resolvePackagedProductExecutable({
		productRoot: root,
		productId: 'soundscaper',
		platform: 'win32',
		arch: 'x64',
	}), join(root, 'soundscaper', 'win-unpacked', 'Soundscaper.exe'));
	assert.equal(resolvePackagedProductExecutable({
		productRoot: root,
		productId: 'framescaper',
		platform: 'linux',
		arch: 'arm64',
	}), join(root, 'framescaper', 'linux-arm64-unpacked', 'framescaper'));
	assert.throws(() => resolvePackagedProductExecutable({
		productRoot: root,
		productId: 'unknown',
		platform: 'linux',
		arch: 'x64',
	}), /product/iu);
});

test('packaged-runtime metrics run through the bundled Playwright driver', () => {
	const plan = createDesktopNightlyTestsPackagedMetricsPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		platform: 'linux',
		arch: 'x64',
		environment: { PATH: '/usr/bin' },
	});

	assert.match(plan.args.at(-1) ?? '', /playwright\.nightly-packaged-metrics\.config\.mjs$/u);
	assert.equal(plan.logFile, '/tmp/Soundscaper-playwright-run/packaged-runtime/console.log');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS, '1');
	assert.equal(
		plan.env.SOUNDSCAPER_PACKAGED_PRODUCT_ROOT,
		'/opt/Soundscaper Tests/resources/nightly-tests/products',
	);
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM, 'linux');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH, 'x64');
	assert.equal(plan.env.GITHUB_ACTIONS, 'false');
});

test('packaged-runtime Chromium arguments admit WebGL on hosted Linux renderers', () => {
	assert.deepEqual(packagedRuntimeChromiumArguments('linux'), [
		'--enable-gpu',
		'--enable-webgl',
		'--ignore-gpu-blocklist',
		'--enable-unsafe-swiftshader',
	]);
	assert.deepEqual(packagedRuntimeChromiumArguments('win32'), [
		'--enable-gpu',
		'--enable-webgl',
		'--ignore-gpu-blocklist',
	]);
});

test('packaged-runtime tests reuse one Electron process per product worker', async () => {
	const source = await readFile(
		resolve(ROOT, 'tests/browser/helpers/nightly-packaged-electron.js'),
		'utf8',
	);

	assert.match(source, /packagedRuntime:\s*\[async \([^]*?workerInfo\) =>/u);
	assert.match(source, /productId = workerInfo\.project\.metadata\.productId/u);
	assert.match(source, /\{ scope: 'worker' \}\]/u);
	assert.match(source, /auto: true/u);
});

test('nightly product staging builds isolated Soundscaper and Framescaper trees', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-products-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputRoot = join(root, 'release/desktop-nightly-products');
	const calls: Array<{ readonly args: readonly string[]; readonly productId: string }> = [];
	await mkdir(join(root, '.desktop-build'), { recursive: true });

	await packageDesktopNightlyTestProducts({
		repositoryRoot: root,
		outputRoot,
		platform: 'linux',
		arch: 'x64',
		run: async (_command: string, args: readonly string[], options: { readonly environment: NodeJS.ProcessEnv }) => {
			const productId = String(options.environment.SCAPE_PRODUCT);
			calls.push({ args, productId });
			if (args.some((value) => value.endsWith('desktop-prepare.mjs'))) {
				await writeFile(join(root, '.desktop-build/stage-manifest.json'), JSON.stringify({ productId }));
				return;
			}
			const outputArgument = args.find((value) => value.startsWith('--config.directories.output='));
			assert.ok(outputArgument);
			const productOutput = outputArgument.slice('--config.directories.output='.length);
			await mkdir(join(productOutput, 'linux-unpacked'), { recursive: true });
			await writeFile(join(productOutput, 'linux-unpacked', productId), 'executable');
		},
	});

	assert.deepEqual(calls.map(({ productId }) => productId), [
		'soundscaper', 'soundscaper', 'framescaper', 'framescaper',
	]);
	for (const productId of ['soundscaper', 'framescaper']) {
		assert.equal(
			JSON.parse(await readFile(join(outputRoot, productId, 'stage-manifest.json'), 'utf8')).productId,
			productId,
		);
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPackage } from '@electron/asar';

import { packageDesktopNightlyTestProducts } from '../scripts/desktop-nightly-tests-products.mjs';
import {
	createDesktopNightlyTestsPackagedMetricsPlan,
	packagedRuntimeChromiumArguments,
	resolvePackagedProductExecutable,
} from '../scripts/lib/desktop-nightly-tests-packaged-runtime.mjs';
import { packagedRuntimeEnvironmentFingerprint } from './browser/helpers/packaged-runtime-environment.js';
import {
	bypassPackagedRuntimeServiceWorker,
	packagedRuntimeProductBaseURL,
	usesPackagedRuntimeDiagnosticPage,
} from './browser/helpers/packaged-runtime-page.js';
import { terminatePackagedRuntime } from './browser/helpers/packaged-runtime-process.js';

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
	const fixedEnvironment = {
		PATH: '/usr/bin',
		SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION: '555.42.02',
		SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DEVICE_ID: '10de:2204',
		SOUNDSCAPER_PACKAGED_RUNTIME_POWER_MODE: 'maximum-performance-ac',
		SOUNDSCAPER_PACKAGED_RUNTIME_DISPLAY_MODE: '1920x1080@60Hz-100pct',
	};
	const plan = createDesktopNightlyTestsPackagedMetricsPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		platform: 'linux',
		arch: 'x64',
		environment: fixedEnvironment,
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
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION, '555.42.02');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DEVICE_ID, '10de:2204');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_POWER_MODE, 'maximum-performance-ac');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_DISPLAY_MODE, '1920x1080@60Hz-100pct');
	assert.equal(plan.env.GITHUB_ACTIONS, 'false');
	assert.equal(plan.env.SOUNDSCAPER_M3_LONGFORM_BENCHMARK, '1');
	assert.equal(plan.env.SOUNDSCAPER_M3_OBSERVED_ENVIRONMENT_ID, 'packaged-runtime-linux-x64');
	assert.equal(plan.env.SOUNDSCAPER_M1_OBSERVED_ENVIRONMENT_ID, 'packaged-runtime-linux-x64');
});

test('packaged-runtime diagnostics do not invent host metadata when none is supplied', () => {
	const plan = createDesktopNightlyTestsPackagedMetricsPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		platform: 'linux',
		arch: 'x64',
		environment: { PATH: '/usr/bin' },
	});

	assert.equal('SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION' in plan.env, false);
	assert.equal('SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DEVICE_ID' in plan.env, false);
	assert.equal('SOUNDSCAPER_PACKAGED_RUNTIME_POWER_MODE' in plan.env, false);
	assert.equal('SOUNDSCAPER_PACKAGED_RUNTIME_DISPLAY_MODE' in plan.env, false);
});

test('packaged-runtime diagnostics allow partial best-effort host metadata', () => {
	const plan = createDesktopNightlyTestsPackagedMetricsPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		platform: 'linux',
		arch: 'x64',
		environment: {
			PATH: '/usr/bin',
			SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION: '555.42.02',
		},
	});
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION, '555.42.02');
	assert.equal('SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DEVICE_ID' in plan.env, false);
});

test('packaged-runtime fingerprints preserve optional and partial host metadata', () => {
	const browser = { version: () => 'Chromium 140' };
	const renderer = { vendor: 'Observed vendor', renderer: 'Observed renderer' };
	const environment = {
		SOUNDSCAPER_PACKAGED_RUNTIME_METRICS: '1',
		SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM: 'win32',
		SOUNDSCAPER_PACKAGED_RUNTIME_ARCH: 'x64',
	};
	assert.deepEqual(packagedRuntimeEnvironmentFingerprint(browser, renderer, environment), {
		browserVersion: 'Chromium 140',
		platform: 'win32',
		architecture: 'x64',
		webglVendor: 'Observed vendor',
		webglRenderer: 'Observed renderer',
		gpuDriverVersion: 'not-recorded-local-correctness',
		gpuDeviceId: 'not-recorded-local-correctness',
		powerMode: 'not-recorded-local-correctness',
		displayMode: 'not-recorded-local-correctness',
	});
	assert.deepEqual(packagedRuntimeEnvironmentFingerprint(browser, renderer, {
		...environment,
		SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION: '32.0.15.6094',
	}), {
		browserVersion: 'Chromium 140',
		platform: 'win32',
		architecture: 'x64',
		webglVendor: 'Observed vendor',
		webglRenderer: 'Observed renderer',
		gpuDriverVersion: '32.0.15.6094',
		gpuDeviceId: 'not-recorded-local-correctness',
		powerMode: 'not-recorded-local-correctness',
		displayMode: 'not-recorded-local-correctness',
	});
});

test('packaged-runtime page routing keeps benchmark documents on each product origin', () => {
	for (const file of [
		'audio-editor-longform-editorial-benchmark.spec.js',
		'audio-editor-video-preview-benchmark.spec.js',
		'audio-editor-m4-production-parity.spec.js',
		'C:\\payload\\tests\\browser\\audio-editor-m4b2-keyframe-parity.spec.js',
	]) assert.equal(usesPackagedRuntimeDiagnosticPage(file), true, file);
	assert.equal(usesPackagedRuntimeDiagnosticPage('desktop-packaged-runtime-smoke.spec.js'), false);

	const environment = {
		SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({
			soundscaper: 'http://127.0.0.1:4101',
			framescaper: 'http://127.0.0.1:4102',
		}),
	};
	assert.equal(packagedRuntimeProductBaseURL('soundscaper', environment), 'http://127.0.0.1:4101/');
	assert.equal(packagedRuntimeProductBaseURL('framescaper', environment), 'http://127.0.0.1:4102/');
	assert.throws(
		() => packagedRuntimeProductBaseURL('framescaper', {}),
		/product origins/iu,
	);
});

test('packaged-runtime diagnostic routes bypass an existing product service worker', async () => {
	const calls: Array<readonly unknown[]> = [];
	const page = {};
	const session = {
		async send(method: string, parameters?: unknown) {
			calls.push(['send', method, parameters]);
		},
		async detach() {
			calls.push(['detach']);
		},
	};
	const context = {
		async newCDPSession(candidate: unknown) {
			calls.push(['session', candidate]);
			return session;
		},
	};

	const release = await bypassPackagedRuntimeServiceWorker(context, page);
	assert.deepEqual(calls, [
		['session', page],
		['send', 'Network.enable', undefined],
		['send', 'Network.setBypassServiceWorker', { bypass: true }],
	]);
	await release();
	assert.deepEqual(calls.at(-1), ['detach']);
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
	assert.match(source, /connectOverCDP\(endpoint,\s*\{\s*timeout:\s*90_000\s*\}\)/u);
	assert.match(source, /Packaged runtime CDP connection failed\./u);
	assert.match(source, /usesPackagedRuntimeDiagnosticPage\(testInfo\.file\)/u);
	assert.match(source, /packagedRuntimeProductBaseURL\(productId/u);
	assert.doesNotMatch(source, /packagedRuntime\.browser\.newContext\(/u);
	assert.match(source, /\{ scope: 'worker' \}\]/u);
	assert.match(source, /auto: true/u);
});

test('packaged-runtime teardown escalates a process that ignores its grace signal', async () => {
	const signals: NodeJS.Signals[] = [];
	const child = Object.assign(new EventEmitter(), {
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill(signal: NodeJS.Signals = 'SIGTERM') {
			signals.push(signal);
			if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null, signal));
			return true;
		},
	});

	await terminatePackagedRuntime(child, 0);
	assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('packaged-runtime teardown rejects when forced containment is never observed', async () => {
	const signals: NodeJS.Signals[] = [];
	const child = Object.assign(new EventEmitter(), {
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill(signal: NodeJS.Signals = 'SIGTERM') {
			signals.push(signal);
			return true;
		},
	});

	await assert.rejects(
		terminatePackagedRuntime(child, 0, 5),
		/forced termination was not observed/u,
	);
	assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('packaged-runtime teardown rejects a refused forced signal', async () => {
	const signals: NodeJS.Signals[] = [];
	const child = Object.assign(new EventEmitter(), {
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill(signal: NodeJS.Signals = 'SIGTERM') {
			signals.push(signal);
			return signal !== 'SIGKILL';
		},
	});

	await assert.rejects(
		terminatePackagedRuntime(child, 0, 5),
		/forced termination signal was refused/u,
	);
	assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('packaged video benchmark seeds exact effects and drives localized controls through stable hooks', async () => {
	const source = await readFile(
		resolve(ROOT, 'tests/browser/audio-editor-video-preview-benchmark.spec.js'),
		'utf8',
	);

	assert.match(source, /createVideoEffect\(type/u);
	assert.match(source, /seedPreviewBenchmarkEffectStack\(page, editor, EFFECT_STACK\)/u);
	assert.match(source, /FRAMESCAPER_DATABASE_NAME/u);
	assert.match(source, /validateFramescaperProject\(/u);
	assert.match(source, /\[data-transport="play"\]/u);
	assert.match(source, /\[data-transport="stop"\]/u);
	assert.match(source, /resetPreviewBenchmarkTrial\(/u);
	assert.match(source, /localStorage\.clear\(\)/u);
	assert.match(source, /sessionStorage\.clear\(\)/u);
	assert.match(source, /indexedDB\.deleteDatabase/u);
	assert.match(source, /root\.removeEntry\(opfsDirectoryName,\s*\{\s*recursive:\s*true\s*\}\)/u);
	assert.match(source, /await cdp\.detach\(\)/u);
	assert.match(source, /ServiceWorkerContainer\.prototype\.register/u);
	assert.match(source, /NotSupportedError/u);
	assert.match(source, /reset-document-presentation-cadence-and-retained-js-heap-v1/u);
	assert.doesNotMatch(source, /runtimeBrowser\.newContext\(/u);
	assert.doesNotMatch(source, /(?:context|runtimeBrowser)\.newPage\(/u);
	assert.match(source, /resolveBrowserProductTestUrl\('\/framescaper\/de\/'\)/u);
	assert.match(source, /new URL\(resolvedProductUrl, runtimeBaseURL\)/u);
	assert.doesNotMatch(source, /name: '(?:Clip properties|Add effect|Play|Stop)'/u);
});

test('nightly product staging builds isolated Soundscaper and Framescaper trees', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-products-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputRoot = join(root, 'release/desktop-nightly-products');
	const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
	const calls: Array<{
		readonly args: readonly string[];
		readonly productId: string;
		readonly sourceMaps: string | undefined;
	}> = [];
	await mkdir(join(root, '.desktop-build'), { recursive: true });

	await packageDesktopNightlyTestProducts({
		repositoryRoot: root,
		outputRoot,
		platform: 'linux',
		arch: 'x64',
		sourceRevision,
		run: async (_command: string, args: readonly string[], options: { readonly environment: NodeJS.ProcessEnv }) => {
			const productId = String(options.environment.SCAPE_PRODUCT);
			calls.push({
				args,
				productId,
				sourceMaps: options.environment.SCAPE_BUILD_SOURCE_MAPS,
			});
			if (args.some((value) => value.endsWith('desktop-prepare.mjs'))) {
				await writeFile(join(root, '.desktop-build/stage-manifest.json'), JSON.stringify({
					productId,
					schemaVersion: 1,
					sourceRevision,
					target: { platform: 'linux', arch: 'x64' },
				}));
				await mkdir(join(root, '.desktop-build/app/desktop'), { recursive: true });
				await mkdir(join(root, '.desktop-build/renderer/assets'), { recursive: true });
				await mkdir(join(root, '.desktop-build/renderer-source-maps'), { recursive: true });
				await writeFile(join(root, '.desktop-build/app/desktop/main.mjs'), `${productId} main`);
				await writeFile(join(root, '.desktop-build/renderer/assets/editor.js'), `${productId} renderer`);
				await writeFile(join(root, '.desktop-build/renderer-source-maps/editor.js.map'), '{}');
				return;
			}
			const outputArgument = args.find((value) => value.startsWith('--config.directories.output='));
			assert.ok(outputArgument);
			const productOutput = outputArgument.slice('--config.directories.output='.length);
			const resources = join(productOutput, 'linux-unpacked', 'resources');
			await mkdir(join(resources, 'renderer/assets'), { recursive: true });
			await writeFile(join(productOutput, 'linux-unpacked', productId), 'executable');
			await writeFile(join(resources, 'renderer/assets/editor.js'), `${productId} renderer`);
			await createPackage(join(root, '.desktop-build/app'), join(resources, 'app.asar'));
		},
	});

	assert.deepEqual(calls.map(({ productId }) => productId), [
		'soundscaper', 'soundscaper', 'framescaper', 'framescaper',
	]);
	assert.ok(calls.every(({ sourceMaps }) => sourceMaps === '1'));
	for (const productId of ['soundscaper', 'framescaper']) {
		assert.equal(
			JSON.parse(await readFile(join(outputRoot, productId, 'stage-manifest.json'), 'utf8')).productId,
			productId,
		);
		assert.deepEqual(
			await readFile(join(outputRoot, `${productId}.asar`)),
			await readFile(join(outputRoot, productId, 'linux-unpacked/resources/app.asar')),
		);
		const coverageEvidence = JSON.parse(await readFile(
			join(outputRoot, productId, 'e2e-coverage/manifest.json'),
			'utf8',
		));
		assert.equal(coverageEvidence.productId, productId);
		assert.deepEqual(
			coverageEvidence.scripts.map(({ packagedPath }: { packagedPath: string }) => packagedPath),
			['app.asar/desktop/main.mjs', 'renderer/assets/editor.js'],
		);
	}
});

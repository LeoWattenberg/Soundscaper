/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	createDesktopNightlyTestsPackagedCoveragePlan,
	preserveDesktopNightlyTestsCoverageEvidence,
	runDesktopNightlyTestsPackagedCoveragePhase,
} from '../scripts/lib/desktop-nightly-tests-packaged-coverage.mjs';

test('packaged coverage plan instruments only the dedicated correctness workload', () => {
	const plan = createDesktopNightlyTestsPackagedCoveragePlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		platform: 'linux',
		arch: 'x64',
		esbuildBinaryPath: '/opt/Soundscaper Tests/resources/nightly-tests/node_modules/@esbuild/linux-x64/bin/esbuild',
		environment: {
			PATH: '/usr/bin',
			SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: '{"soundscaper":"http://127.0.0.1:4101"}',
		},
	});

	assert.match(plan.args.at(-1) ?? '', /playwright\.nightly-packaged-coverage\.config\.mjs$/u);
	assert.equal(plan.logFile, '/tmp/Soundscaper-playwright-run/e2e-coverage/packaged-runtime/console.log');
	assert.equal(plan.env.SCAPE_BROWSER_COVERAGE, '1');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS, '1');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM, 'linux');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH, 'x64');
	assert.equal(
		plan.env.SOUNDSCAPER_PACKAGED_PRODUCT_ROOT,
		'/opt/Soundscaper Tests/resources/nightly-tests/products',
	);
	assert.equal(
		plan.env.ESBUILD_BINARY_PATH,
		'/opt/Soundscaper Tests/resources/nightly-tests/node_modules/@esbuild/linux-x64/bin/esbuild',
	);
	assert.equal(plan.env.SOUNDSCAPER_M3_LONGFORM_BENCHMARK, undefined);
	assert.equal(plan.env.SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK, undefined);
	assert.equal(plan.env.SOUNDSCAPER_M4_PRODUCTION_PARITY, undefined);
	assert.equal(plan.env.SOUNDSCAPER_M4B2_KEYFRAME_PARITY, undefined);
	assert.equal(plan.env.SOUNDSCAPER_SOAK_CAPTURE_PACKAGED_COVERAGE, '1');
	assert.equal(
		plan.env.SOUNDSCAPER_SOAK_PACKAGED_EXECUTABLE,
		'/opt/Soundscaper Tests/resources/nightly-tests/products/soundscaper/linux-unpacked/soundscaper',
	);
	assert.equal(
		plan.env.SOUNDSCAPER_SOAK_PERSISTENT_DELIVERY_EXECUTABLE,
		plan.env.SOUNDSCAPER_SOAK_PACKAGED_EXECUTABLE,
	);
});

test('coverage evidence preservation makes browser and Electron builds portable', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-evidence-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const payloadRoot = join(temporaryRoot, 'payload');
	const runRoot = join(temporaryRoot, 'run');
	for (const [path, contents] of [
		['sites/soundscaper/assets/app.js', 'soundscaper browser\n'],
		['sites/soundscaper-source-maps/assets/app.js.map', '{"sources":[]}\n'],
		['sites/framescaper/assets/app.js', 'framescaper browser\n'],
		['sites/framescaper-source-maps/assets/app.js.map', '{"sources":[]}\n'],
		['products/soundscaper/e2e-coverage/manifest.json', '{"productId":"soundscaper"}\n'],
		['products/framescaper/e2e-coverage/manifest.json', '{"productId":"framescaper"}\n'],
	] as const) {
		const target = join(payloadRoot, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, contents);
	}
	await mkdir(runRoot);

	const evidenceRoot = await preserveDesktopNightlyTestsCoverageEvidence({ payloadRoot, runRoot });
	assert.equal(evidenceRoot, join(runRoot, 'coverage/build-evidence'));
	assert.equal(
		await readFile(join(evidenceRoot, 'browser/soundscaper/site/assets/app.js'), 'utf8'),
		'soundscaper browser\n',
	);
	assert.equal(
		await readFile(join(evidenceRoot, 'browser/framescaper/source-maps/assets/app.js.map'), 'utf8'),
		'{"sources":[]}\n',
	);
	assert.equal(
		await readFile(join(evidenceRoot, 'electron/soundscaper/manifest.json'), 'utf8'),
		'{"productId":"soundscaper"}\n',
	);
	assert.equal(
		await readFile(join(evidenceRoot, 'electron/framescaper/manifest.json'), 'utf8'),
		'{"productId":"framescaper"}\n',
	);
});

test('packaged coverage phase preserves evidence before running Playwright', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-phase-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const payloadRoot = join(temporaryRoot, 'payload');
	const runRoot = join(temporaryRoot, 'run');
	for (const path of [
		'sites/soundscaper/app.js',
		'sites/soundscaper-source-maps/app.js.map',
		'sites/framescaper/app.js',
		'sites/framescaper-source-maps/app.js.map',
		'products/soundscaper/e2e-coverage/manifest.json',
		'products/framescaper/e2e-coverage/manifest.json',
	]) {
		const target = join(payloadRoot, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, '{}\n');
	}
	await mkdir(runRoot);
	let planSeen;
	const result = await runDesktopNightlyTestsPackagedCoveragePhase({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot,
		runRoot,
		platform: 'linux',
		arch: 'x64',
		environment: {},
	}, {
		runPlaywright: async (plan) => {
			planSeen = plan;
			assert.equal(
				await readFile(join(runRoot, 'coverage/build-evidence/browser/soundscaper/site/app.js'), 'utf8'),
				'{}\n',
			);
			return { code: 0, signal: null };
		},
	});

	assert.ok(planSeen);
	assert.deepEqual(result.child, { code: 0, signal: null });
	assert.deepEqual(result.diagnostics, { passed: true });
});

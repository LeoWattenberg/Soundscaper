/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	mkdtemp,
	mkdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

import {
	createDesktopNightlyTestsPlaywrightPlan,
	createDesktopNightlyTestsResultEnvelope,
	createDesktopNightlyTestsRunDirectory,
	mapDesktopNightlyTestsExit,
	resolveDesktopNightlyTestsEsbuildBinary,
	resolveDesktopNightlyTestsOutputRoot,
	runDesktopNightlyTests,
	startDesktopNightlyTestsStaticServer,
	writeDesktopNightlyTestsResultEnvelope,
} from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import type {
	DesktopNightlyTestsPlaywrightPlan,
} from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { rawHttpRequest } from './helpers/raw-http-request.ts';

const PRODUCT = Object.freeze({
	id: 'soundscaper',
	name: 'Soundscaper',
	version: '0.2.0-beta.1',
});
const PACKAGED_ENVIRONMENT = Object.freeze({ PATH: '/usr/bin', SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION: '555.42.02', SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DEVICE_ID: '10de:2204', SOUNDSCAPER_PACKAGED_RUNTIME_POWER_MODE: 'maximum-performance-ac', SOUNDSCAPER_PACKAGED_RUNTIME_DISPLAY_MODE: '1920x1080@60Hz-100pct' });
test('nightly test results resolve beside each portable artifact convention', () => {
	assert.equal(resolveDesktopNightlyTestsOutputRoot({
		platform: 'win32',
		executablePath: String.raw`C:\Users\tester\AppData\Local\Temp\Soundscaper.exe`,
		environment: {
			PORTABLE_EXECUTABLE_DIR: String.raw`D:\Nightly builds`,
			PORTABLE_EXECUTABLE_FILE: String.raw`D:\Nightly builds\Soundscaper-with-tests.exe`,
		},
	}), String.raw`D:\Nightly builds`);
	assert.equal(resolveDesktopNightlyTestsOutputRoot({
		platform: 'win32',
		executablePath: String.raw`C:\Users\tester\AppData\Local\Temp\Soundscaper.exe`,
		environment: {
			PORTABLE_EXECUTABLE_FILE: String.raw`E:\Downloaded tests\Soundscaper-with-tests.exe`,
		},
	}), String.raw`E:\Downloaded tests`);
	assert.equal(resolveDesktopNightlyTestsOutputRoot({
		platform: 'linux',
		executablePath: '/tmp/.mount_soundscaper/usr/bin/soundscaper',
		environment: { APPIMAGE: '/home/tester/Nightlies/Soundscaper-with-tests.AppImage' },
	}), '/home/tester/Nightlies');
	assert.equal(resolveDesktopNightlyTestsOutputRoot({
		platform: 'darwin',
		executablePath: '/Users/tester/Nightlies/Soundscaper Tests.app/Contents/MacOS/Soundscaper Tests',
		environment: {},
	}), '/Users/tester/Nightlies');
	assert.equal(resolveDesktopNightlyTestsOutputRoot({
		platform: 'linux',
		executablePath: '/opt/soundscaper/soundscaper',
		environment: {},
	}), '/opt/soundscaper');
});

test('nightly test output roots reject ambiguous or relative launcher paths', () => {
	assert.throws(() => resolveDesktopNightlyTestsOutputRoot({
		platform: 'win32',
		executablePath: String.raw`C:\Temp\Soundscaper.exe`,
		environment: { PORTABLE_EXECUTABLE_DIR: 'relative' },
	}), /PORTABLE_EXECUTABLE_DIR.*absolute/iu);
	assert.throws(() => resolveDesktopNightlyTestsOutputRoot({
		platform: 'win32',
		executablePath: String.raw`C:\Temp\Soundscaper.exe`,
		environment: { PORTABLE_EXECUTABLE_FILE: 'relative.exe' },
	}), /PORTABLE_EXECUTABLE_FILE.*absolute/iu);
	assert.throws(() => resolveDesktopNightlyTestsOutputRoot({
		platform: 'win32',
		executablePath: String.raw`C:\Temp\Soundscaper.exe`,
		environment: {
			PORTABLE_EXECUTABLE_DIR: String.raw`D:\Nightlies`,
			PORTABLE_EXECUTABLE_FILE: String.raw`E:\Elsewhere\Soundscaper.exe`,
		},
	}), /portable executable.*directory/iu);
	assert.throws(() => resolveDesktopNightlyTestsOutputRoot({
		platform: 'linux',
		executablePath: '/tmp/.mount/soundscaper',
		environment: { APPIMAGE: 'Soundscaper.AppImage' },
	}), /APPIMAGE.*absolute/iu);
	assert.throws(() => resolveDesktopNightlyTestsOutputRoot({
		platform: 'linux',
		executablePath: 'soundscaper',
		environment: {},
	}), /executable path.*absolute/iu);
});

test('nightly test run directories are timestamped, sibling-contained, and collision safe', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-output-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const now = new Date('2026-08-08T12:34:56.789Z');

	const first = await createDesktopNightlyTestsRunDirectory({ outputRoot, productId: 'soundscaper', now });
	const second = await createDesktopNightlyTestsRunDirectory({ outputRoot, productId: 'soundscaper', now });

	assert.equal(dirname(first.runRoot), outputRoot);
	assert.equal(dirname(second.runRoot), outputRoot);
	assert.notEqual(first.runRoot, second.runRoot);
	assert.match(basename(first.runRoot), /^soundscaper-playwright-20260808T123456789Z-[A-Za-z0-9_-]{6}$/u);
	assert.doesNotMatch(basename(first.runRoot), /[:/\\]/u);
	assert.equal(first.paths.result, join(first.runRoot, 'run.json'));
	assert.equal(first.paths.htmlReport, join(first.runRoot, 'playwright-report'));
	assert.equal(first.paths.testResults, join(first.runRoot, 'test-results'));

	const notDirectory = join(outputRoot, 'not-a-directory');
	await writeFile(notDirectory, 'occupied', 'utf8');
	await assert.rejects(
		() => createDesktopNightlyTestsRunDirectory({ outputRoot: notDirectory, productId: 'soundscaper', now }),
		/not a directory/iu,
	);
});

test('the bundled static server serves bounded files and rejects traversal and symlink escape', async (context) => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-server-'));
	context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
	const publicRoot = join(fixtureRoot, 'dist');
	await Promise.all([
		mkdir(join(publicRoot, 'en'), { recursive: true }),
		mkdir(join(publicRoot, 'framescaper/en'), { recursive: true }),
	]);
	await writeFile(join(publicRoot, 'index.html'), '<h1>root</h1>', 'utf8');
	await writeFile(join(publicRoot, 'en/index.html'), '<h1>English</h1>', 'utf8');
	await writeFile(join(publicRoot, 'framescaper/en/index.html'), '<h1>Framescaper English</h1>', 'utf8');
	await writeFile(join(publicRoot, 'app.js'), 'export const ready = true;', 'utf8');
	await writeFile(join(publicRoot, 'worker.wasm'), Uint8Array.of(0, 97, 115, 109));
	const outside = join(fixtureRoot, 'outside.txt');
	await writeFile(outside, 'secret', 'utf8');
	if (process.platform !== 'win32') {
		await symlink(outside, join(publicRoot, 'escape.txt'));
		await mkdir(join(publicRoot, 'embed/en'), { recursive: true });
		await symlink(outside, join(publicRoot, 'embed/en/index.html'));
	}

	const server = await startDesktopNightlyTestsStaticServer({ root: publicRoot });
	context.after(() => server.close());

	const root = await fetch(`${server.baseURL}/`);
	assert.equal(root.status, 200);
	assert.equal(root.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(await root.text(), '<h1>root</h1>');
	const localized = await fetch(`${server.baseURL}/en/`);
	assert.equal(await localized.text(), '<h1>English</h1>');
	const embedded = await fetch(`${server.baseURL}/embed/en/`, {
		headers: { Accept: 'text/html' },
	});
	assert.equal(embedded.status, 200);
	assert.equal(await embedded.text(), '<h1>English</h1>');
	const embeddedWithQuery = await fetch(`${server.baseURL}/embed/en/?project=fixture`, {
		headers: { Accept: 'text/html' },
	});
	assert.equal(embeddedWithQuery.status, 200);
	assert.equal(await embeddedWithQuery.text(), '<h1>English</h1>');
	const framescaperEmbedded = await fetch(`${server.baseURL}/framescaper/embed/en/`, {
		headers: { Accept: 'text/html' },
	});
	assert.equal(framescaperEmbedded.status, 200);
	assert.equal(await framescaperEmbedded.text(), '<h1>Framescaper English</h1>');
	const framescaperHead = await fetch(`${server.baseURL}/framescaper/embed/en/`, {
		method: 'HEAD',
		headers: { Accept: 'text/html' },
	});
	assert.equal(framescaperHead.status, 200);
	assert.equal(framescaperHead.headers.get('content-length'), String(Buffer.byteLength('<h1>Framescaper English</h1>')));
	assert.equal(await framescaperHead.text(), '');
	const script = await fetch(`${server.baseURL}/app.js`);
	assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
	const wasm = await fetch(`${server.baseURL}/worker.wasm`);
	assert.equal(wasm.headers.get('content-type'), 'application/wasm');

	const head = await fetch(`${server.baseURL}/app.js`, { method: 'HEAD' });
	assert.equal(head.status, 200);
	assert.equal(head.headers.get('content-length'), String(Buffer.byteLength('export const ready = true;')));
	assert.equal(await head.text(), '');
	const post = await fetch(`${server.baseURL}/`, { method: 'POST' });
	assert.equal(post.status, 405);
	assert.equal(post.headers.get('allow'), 'GET, HEAD');
	assert.equal((await rawHttpRequest(server.baseURL, '/%2e%2e/outside.txt')).statusCode, 400);
	assert.equal((await rawHttpRequest(server.baseURL, '/%5coutside.txt')).statusCode, 400);
	assert.equal((await rawHttpRequest(server.baseURL, '/%ZZ')).statusCode, 400);
	if (process.platform !== 'win32') assert.equal((await fetch(`${server.baseURL}/escape.txt`)).status, 404);
	assert.equal((await fetch(`${server.baseURL}/missing.txt`)).status, 404);
	assert.equal((await fetch(`${server.baseURL}/embed/en/missing.js`, {
		headers: { Accept: 'text/html' },
	})).status, 404);
	assert.equal((await fetch(`${server.baseURL}/embed/unknown/`, {
		headers: { Accept: 'text/html' },
	})).status, 404);
	assert.equal((await fetch(`${server.baseURL}/embed/en/`, {
		headers: { Accept: 'application/json, text/html;q=0' },
	})).status, 404);
	assert.equal((await rawHttpRequest(server.baseURL, '/embed/en/')).statusCode, 404);
	assert.equal((await fetch(`${server.baseURL}/embed/en/`, {
		headers: { Accept: '*/*' },
	})).status, 404);
	assert.equal((await fetch(`${server.baseURL}/embed/en/`, {
		headers: { Accept: 'application/json' },
	})).status, 404);
});

test('the Playwright plan is closed over the packaged payload and sibling run root', () => {
	const environment = { PATH: '/usr/bin', SECRET_TOKEN: 'preserved-for-child' };
	const plan = createDesktopNightlyTestsPlaywrightPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		environment,
	});

	assert.equal(plan.command, '/opt/Soundscaper Tests/soundscaper-tests');
	assert.deepEqual(plan.args, [
		'/opt/Soundscaper Tests/resources/nightly-tests/node_modules/@playwright/test/cli.js',
		'test',
		'--config',
		'/opt/Soundscaper Tests/resources/nightly-tests/playwright.nightly-tests.config.mjs',
	]);
	assert.equal(plan.cwd, '/opt/Soundscaper Tests/resources/nightly-tests');
	assert.deepEqual(plan.env, {
		...environment,
		ELECTRON_RUN_AS_NODE: '1',
		PLAYWRIGHT_BROWSERS_PATH: '/opt/Soundscaper Tests/resources/nightly-tests/.local-browsers',
		PLAYWRIGHT_HTML_OPEN: 'never',
		SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: 'http://127.0.0.1:45678',
		SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: '/opt/Soundscaper Tests/resources/nightly-tests',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: '/tmp/Soundscaper-playwright-run',
	});
	assert.deepEqual(environment, { PATH: '/usr/bin', SECRET_TOKEN: 'preserved-for-child' });
	assert.equal(plan.logFile, '/tmp/Soundscaper-playwright-run/console.log');
	assert.equal(Object.isFrozen(plan), true);
});

test('the Playwright plan names the staged esbuild binary for the browser specs that bundle', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-esbuild-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	const scopeRoot = join(payloadRoot, 'node_modules/@esbuild');

	assert.equal(await resolveDesktopNightlyTestsEsbuildBinary({ payloadRoot }), null);

	// The Windows ARM64 job stages with x64 Node, so the packaged ARM64 Electron
	// would never find the binary through esbuild's own architecture lookup.
	await mkdir(join(scopeRoot, 'win32-x64'), { recursive: true });
	await writeFile(join(scopeRoot, 'win32-x64/esbuild.exe'), 'binary');
	assert.equal(
		await resolveDesktopNightlyTestsEsbuildBinary({ payloadRoot }),
		join(scopeRoot, 'win32-x64/esbuild.exe'),
	);

	await rm(join(scopeRoot, 'win32-x64'), { recursive: true });
	await mkdir(join(scopeRoot, 'linux-arm64/bin'), { recursive: true });
	await writeFile(join(scopeRoot, 'linux-arm64/bin/esbuild'), 'binary');
	const binary = join(scopeRoot, 'linux-arm64/bin/esbuild');
	assert.equal(await resolveDesktopNightlyTestsEsbuildBinary({ payloadRoot }), binary);

	// A payload staging two binary packages cannot say which one it meant, and a
	// package whose binary is missing is damaged. Both defer to esbuild rather
	// than costing every other spec its run.
	await mkdir(join(scopeRoot, 'darwin-arm64/bin'), { recursive: true });
	await writeFile(join(scopeRoot, 'darwin-arm64/bin/esbuild'), 'binary');
	assert.equal(await resolveDesktopNightlyTestsEsbuildBinary({ payloadRoot }), null);
	await rm(join(scopeRoot, 'darwin-arm64'), { recursive: true });
	await rm(binary);
	assert.equal(await resolveDesktopNightlyTestsEsbuildBinary({ payloadRoot }), null);

	const plan = createDesktopNightlyTestsPlaywrightPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		esbuildBinaryPath: '/opt/Soundscaper Tests/resources/nightly-tests/node_modules/@esbuild/win32-x64/esbuild.exe',
		environment: {},
	});
	assert.equal(
		plan.env.ESBUILD_BINARY_PATH,
		'/opt/Soundscaper Tests/resources/nightly-tests/node_modules/@esbuild/win32-x64/esbuild.exe',
	);
	assert.equal(
		Object.hasOwn(createDesktopNightlyTestsPlaywrightPlan({
			executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
			payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
			runRoot: '/tmp/Soundscaper-playwright-run',
			baseURL: 'http://127.0.0.1:45678',
			environment: {},
		}).env, 'ESBUILD_BINARY_PATH'),
		false,
	);
	assert.throws(() => createDesktopNightlyTestsPlaywrightPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		esbuildBinaryPath: 'node_modules/@esbuild/win32-x64/esbuild.exe',
		environment: {},
	}), /esbuild binary path/u);
});

test('Playwright exit mapping and result envelopes distinguish failures from infrastructure errors', () => {
	assert.deepEqual(mapDesktopNightlyTestsExit({ code: 0, signal: null }), { status: 'passed', exitCode: 0 });
	assert.deepEqual(mapDesktopNightlyTestsExit({ code: 1, signal: null }), { status: 'failed', exitCode: 1 });
	assert.deepEqual(mapDesktopNightlyTestsExit({ code: 2, signal: null }), { status: 'error', exitCode: 2 });
	assert.deepEqual(mapDesktopNightlyTestsExit({ code: null, signal: 'SIGINT' }), {
		status: 'interrupted', exitCode: 130,
	});
	assert.deepEqual(mapDesktopNightlyTestsExit({ code: null, signal: 'SIGTERM' }), {
		status: 'interrupted', exitCode: 143,
	});
	assert.deepEqual(mapDesktopNightlyTestsExit({ code: null, signal: 'SIGKILL' }), {
		status: 'error', exitCode: 2,
	});

	const envelope = createDesktopNightlyTestsResultEnvelope({
		product: PRODUCT,
		platform: 'linux',
		arch: 'x64',
		sourceRevision: 'a'.repeat(40),
		startedAt: new Date('2026-08-08T12:00:00.000Z'),
		finishedAt: new Date('2026-08-08T12:03:00.000Z'),
		status: 'failed',
		exitCode: 1,
		signal: null,
		failure: null,
	});
	assert.deepEqual(envelope, {
		schemaVersion: 2,
		kind: 'soundscaper-desktop-nightly-tests',
		product: PRODUCT,
		runtime: { platform: 'linux', arch: 'x64' },
		sourceRevision: 'a'.repeat(40),
		startedAt: '2026-08-08T12:00:00.000Z',
		finishedAt: '2026-08-08T12:03:00.000Z',
		status: 'failed',
		exitCode: 1,
		signal: null,
		failure: null,
		artifacts: {
			consoleLog: 'console.log',
			htmlReport: 'playwright-report/index.html',
			jsonReport: 'results.json',
			junitReport: 'junit.xml',
			testResults: 'test-results',
			metricsConsoleLog: 'metrics/console.log',
			metricsHtmlReport: 'metrics/playwright-report/index.html',
			metricsJsonReport: 'metrics/results.json',
			metricsJunitReport: 'metrics/junit.xml',
			metricsRaw: 'metrics/raw.json',
			metricsSummary: 'metrics/summary.json',
			metricsTestResults: 'metrics/test-results',
			packagedRuntimeConsoleLog: 'packaged-runtime/console.log',
			packagedRuntimeHtmlReport: 'packaged-runtime/playwright-report/index.html',
			packagedRuntimeJsonReport: 'packaged-runtime/results.json',
			packagedRuntimeJunitReport: 'packaged-runtime/junit.xml',
			packagedRuntimeRaw: 'packaged-runtime/raw.json',
			packagedRuntimeSummary: 'packaged-runtime/summary.json', packagedRuntimeQualification: 'packaged-runtime/qualification.json',
			packagedRuntimeTestResults: 'packaged-runtime/test-results',
		},
	});
	assert.equal(Object.isFrozen(envelope), true);
	assert.equal(Object.isFrozen(envelope.product), true);
	assert.equal(Object.isFrozen(envelope.artifacts), true);
});

test('the injected nightly runtime records terminal results and always closes its server', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-runner-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	let closeCalls = 0;
	const plansSeen: DesktopNightlyTestsPlaywrightPlan[] = [];
	let metricsEvidenceCalls = 0;
	let packagedEvidenceCalls = 0;
	const times = [
		new Date('2026-08-08T13:00:00.000Z'),
		new Date('2026-08-08T13:05:00.000Z'),
	];

	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: PRODUCT,
		platform: 'linux',
		arch: 'x64',
		environment: PACKAGED_ENVIRONMENT,
		sourceRevision: 'b'.repeat(40),
	}, {
		now: () => times.shift() ?? new Date('2026-08-08T13:05:00.000Z'),
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:47777',
			close: async () => { closeCalls += 1; },
		}),
		runPlaywright: async (plan) => {
			plansSeen.push(plan);
			return plansSeen.length === 1
				? { code: 1, signal: null }
				: { code: 0, signal: null };
		},
		writeMetricsEvidence: async ({ playwrightExit, runRoot }) => {
			metricsEvidenceCalls += 1;
			assert.deepEqual(playwrightExit, { code: 0, signal: null });
			assert.ok(runRoot);
			return { passed: true };
		},
		writePackagedMetricsEvidence: async ({ playwrightExit, runRoot }) => {
			packagedEvidenceCalls += 1;
			assert.deepEqual(playwrightExit, { code: 0, signal: null });
			assert.ok(runRoot);
			return { passed: true };
		},
	});

	assert.equal(completed.exitCode, 1);
	assert.equal(completed.outputRoot, outputRoot);
	assert.equal(dirname(completed.runRoot), outputRoot);
	assert.equal(completed.result.status, 'failed');
	assert.equal(completed.result.finishedAt, '2026-08-08T13:05:00.000Z');
	assert.equal(closeCalls, 1);
	assert.equal(metricsEvidenceCalls, 1);
	assert.equal(packagedEvidenceCalls, 1);
	assert.equal(plansSeen.length, 3);
	assert.equal(plansSeen[0]?.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT, completed.runRoot);
	assert.match(plansSeen[1]?.args.at(-1) ?? '', /playwright\.nightly-metrics\.config\.mjs$/u);
	assert.match(plansSeen[2]?.args.at(-1) ?? '', /playwright\.nightly-packaged-metrics\.config\.mjs$/u);
	assert.deepEqual(
		JSON.parse(await readFile(join(completed.runRoot, 'run.json'), 'utf8')),
		completed.result,
	);
});

test('the injected nightly runtime turns server and child errors into an error envelope', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-error-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	let closeCalls = 0;

	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: PRODUCT,
		platform: 'linux',
		arch: 'x64',
		environment: {},
	}, {
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:48888',
			close: async () => { closeCalls += 1; },
		}),
		runPlaywright: async () => { throw new Error('browser process could not start'); },
	});

	assert.equal(completed.exitCode, 2);
	assert.equal(completed.result.status, 'error');
	assert.match(completed.result.failure ?? '', /browser process could not start/iu);
	assert.equal(closeCalls, 1);
	assert.equal(
		JSON.parse(await readFile(join(completed.runRoot, 'run.json'), 'utf8')).status,
		'error',
	);
});

test('terminal result replacement falls back safely when Windows refuses rename-over-existing', async (context) => {
	const runRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-result-'));
	context.after(() => rm(runRoot, { recursive: true, force: true }));
	const running = createDesktopNightlyTestsResultEnvelope({
		product: PRODUCT,
		platform: 'win32',
		arch: 'x64',
		startedAt: new Date('2026-08-08T14:00:00.000Z'),
		status: 'running',
	});
	const passed = createDesktopNightlyTestsResultEnvelope({
		product: PRODUCT,
		platform: 'win32',
		arch: 'x64',
		startedAt: new Date('2026-08-08T14:00:00.000Z'),
		finishedAt: new Date('2026-08-08T14:01:00.000Z'),
		status: 'passed',
		exitCode: 0,
	});
	await writeDesktopNightlyTestsResultEnvelope(runRoot, running);
	let simulatedReplacementFailure = false;
	await writeDesktopNightlyTestsResultEnvelope(runRoot, passed, {
		rename: async (source, target) => {
			if (!simulatedReplacementFailure && target === join(runRoot, 'run.json')) {
				simulatedReplacementFailure = true;
				throw Object.assign(new Error('destination exists'), { code: 'EPERM' });
			}
			await rename(source, target);
		},
	});

	assert.equal(simulatedReplacementFailure, true);
	assert.deepEqual(JSON.parse(await readFile(join(runRoot, 'run.json'), 'utf8')), passed);
	await assert.rejects(() => readFile(join(runRoot, '.run.json.previous'), 'utf8'), /ENOENT/u);
});

test('the default Playwright child runner captures output and reaches a terminal envelope', async (context) => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-child-'));
	context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
	const outputRoot = join(fixtureRoot, 'output');
	const payloadRoot = join(fixtureRoot, 'payload');
	await mkdir(join(payloadRoot, 'node_modules/@playwright/test'), { recursive: true });
	await mkdir(outputRoot);
	await writeFile(join(payloadRoot, 'node_modules/@playwright/test/cli.js'), [
		"console.log('bundled Playwright child reached');",
		"console.error('bundled child diagnostic');",
	].join('\n'), 'utf8');
	const completed = await runDesktopNightlyTests({
		executablePath: process.execPath,
		payloadRoot,
		outputRoot,
		product: PRODUCT,
		platform: process.platform,
		arch: process.arch,
		environment: { ...PACKAGED_ENVIRONMENT, PATH: process.env.PATH },
	}, {
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:49999',
			close: async () => undefined,
		}),
		writeMetricsEvidence: async () => ({ passed: true }),
		writePackagedMetricsEvidence: async () => ({ passed: true }),
	});

	assert.equal(completed.exitCode, 0);
	assert.equal(completed.result.status, 'passed');
	const log = await readFile(join(completed.runRoot, 'console.log'), 'utf8');
	assert.match(log, /bundled Playwright child reached/u);
	assert.match(log, /bundled child diagnostic/u);
});

test('a Playwright child spawn error closes its log and records infrastructure failure', async (context) => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-spawn-error-'));
	context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
	const outputRoot = join(fixtureRoot, 'output');
	const payloadRoot = join(fixtureRoot, 'payload');
	await Promise.all([mkdir(outputRoot), mkdir(payloadRoot)]);

	const completed = await runDesktopNightlyTests({
		executablePath: join(fixtureRoot, 'missing-electron'),
		payloadRoot,
		outputRoot,
		product: PRODUCT,
		platform: process.platform,
		arch: process.arch,
		environment: { PATH: process.env.PATH },
	}, {
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:49998',
			close: async () => undefined,
		}),
		writeMetricsEvidence: async () => ({ passed: true }),
	});

	assert.equal(completed.exitCode, 2);
	assert.equal(completed.result.status, 'error');
	assert.match(completed.result.failure ?? '', /ENOENT|spawn/iu);
	assert.equal(await readFile(join(completed.runRoot, 'console.log'), 'utf8'), '');
});

test('a failed diagnostic metric gate fails an otherwise passing nightly run', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-metric-gate-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	let childCalls = 0;
	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: PRODUCT,
		platform: 'linux',
		arch: 'x64',
		environment: PACKAGED_ENVIRONMENT,
	}, {
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:49997',
			close: async () => undefined,
		}),
		runPlaywright: async () => {
			childCalls += 1;
			return { code: 0, signal: null };
		},
		writeMetricsEvidence: async () => ({ passed: false }),
		writePackagedMetricsEvidence: async () => ({ passed: true }),
	});

	assert.equal(childCalls, 3);
	assert.equal(completed.exitCode, 1);
	assert.equal(completed.result.status, 'failed');
});

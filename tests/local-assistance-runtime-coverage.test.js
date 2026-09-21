/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	awaitLocalAssistanceProcessExit,
	completeLocalAssistanceCoverage,
	localAssistanceCoverageFileUrl,
	prepareLocalAssistanceRuntimeCoverage,
} from './electron/local-assistance-models/runtime-coverage.js';
import {
	collectPackagedExecutableResourceFiles,
	packagedExecutableResourceIdentity,
} from '../scripts/lib/packaged-executable-resource-identity.mjs';
import {
	INSTALL_NAVIGATION_COVERAGE_CHECKPOINT,
	NAVIGATION_COVERAGE_CHECKPOINT_URL,
} from '../scripts/lib/navigation-coverage-checkpoint.mjs';

const SOURCE_REVISION = '1'.repeat(40);
const SESSION_ID = '11111111-2222-4333-8444-555555555555';

test('one local-assistance launch records a private authenticated CDP and Node session', async (context) => {
	const fixture = await coverageFixture(context);
	let reloads = 0;
	const launch = await prepareLocalAssistanceRuntimeCoverage(fixture.options, {
		randomUUID: () => SESSION_ID,
		startTargetCoverage: async () => ({
			reload: async () => { reloads += 1; }, checkpoint: async () => undefined,
			collect: async () => ({
				entries: [v8Entry(fixture.preloadUrl), v8Entry(NAVIGATION_COVERAGE_CHECKPOINT_URL), v8Entry('')],
				sources: new Map([
					[fixture.preloadUrl, fixture.preloadSource],
					[NAVIGATION_COVERAGE_CHECKPOINT_URL, INSTALL_NAVIGATION_COVERAGE_CHECKPOINT],
				]),
				pausedTargetCounts: {}, targetCounts: {}, targetTypes: [],
			}),
		}),
	});
	assert.equal(launch.environment.NODE_V8_COVERAGE, launch.sessionDirectory);
	assert.equal(launch.environment.ELECTRON_RUN_AS_NODE, undefined);
	assert.equal(fixture.options.environment.NODE_V8_COVERAGE, '/tmp/outer-coverage');
	const collector = await launch.start({
		context: { newCDPSession: async () => ({}) }, page: { isClosed: () => false }, mainProcessId: 4312,
	});
	assert.equal(reloads, 1, 'preload is re-executed only after precise coverage starts');
	await collector.collectBeforeClose();
	await writeNodeProfile(launch.sessionDirectory, 4312, 0, [v8Entry(fixture.mainUrl)]);
	await writeNodeProfile(launch.sessionDirectory, 4900, 1, [v8Entry('node:internal/bootstrap')]);
	const manifestPath = await collector.finalizeAfterExit({ code: 0, signal: null });
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	assert.equal(manifest.kind, 'soundscaper-local-assistance-runtime');
	assert.equal(manifest.sessionId, SESSION_ID);
	assert.equal(manifest.mainProcessId, 4312);
	assert.equal(manifest.productId, 'soundscaper');
	assert.equal(manifest.productAppAsar.path, fixture.aliasPath);
	assert.deepEqual(manifest.productAppAsar.beforeLaunch, fixture.archive);
	assert.deepEqual(manifest.productAppAsar.beforeLaunch, manifest.productAppAsar.afterCollection);
	assert.deepEqual(manifest.executableResources.beforeLaunch, fixture.executableResources);
	assert.deepEqual(manifest.executableResources.beforeLaunch,
		manifest.executableResources.afterCollection);
	assert.deepEqual(manifest.nodeProfiles.map(({ fileName }) => fileName), [
		'coverage-4312-1000-0.json', 'coverage-4900-1000-1.json',
	]);
	assert.equal(manifest.cdpProfile.fileName, 'cdp.json');
	for (const record of [manifest.cdpProfile, ...manifest.nodeProfiles]) {
		assert.match(record.sha256, /^[a-f\d]{64}$/u);
		assert.ok(record.byteLength > 0);
	}
	const cdpBytes = await readFile(join(launch.sessionDirectory, 'cdp.json'), 'utf8');
	assert.equal(cdpBytes.includes(fixture.preloadUrl), true);
	assert.equal(cdpBytes.includes(NAVIGATION_COVERAGE_CHECKPOINT_URL), false);
});

test('local-assistance preparation rejects stable alias and Resources detached from build evidence', async (context) => {
	const alias = await coverageFixture(context, 'wrong-alias');
	await writeFile(alias.aliasPath, 'stable but detached archive');
	await assert.rejects(
		prepareLocalAssistanceRuntimeCoverage(alias.options),
		/archive differs from its staged package identity/u,
	);

	const resources = await coverageFixture(context, 'wrong-resources');
	const manifestPath = join(resources.options.productRoot, 'soundscaper/e2e-coverage/manifest.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.executableResources.sha256 = 'f'.repeat(64);
	await writeFile(manifestPath, JSON.stringify(manifest));
	await assert.rejects(
		prepareLocalAssistanceRuntimeCoverage(resources.options),
		/Resources differ from build evidence/u,
	);

	await assert.rejects(
		prepareLocalAssistanceRuntimeCoverage({
			...resources.options,
			productExecutablePath: join(resources.options.productRoot, 'detached/product'),
		}),
		/detached from its canonical staged product/u,
	);
});

test('local-assistance file URLs preserve platform roots and encode spaces', () => {
	assert.equal(localAssistanceCoverageFileUrl('/tmp/Product Alias.asar', 'linux'),
		'file:///tmp/Product%20Alias.asar/');
	assert.equal(localAssistanceCoverageFileUrl('C:\\Nightly Tests\\Soundscaper.asar', 'win32'),
		'file:///C:/Nightly%20Tests/Soundscaper.asar/');
});

test('local-assistance session finalization fails closed on mutation, missing main evidence, and stray files', async (context) => {
	for (const scenario of ['alias-mutation', 'worker-only', 'stray-file']) {
		const fixture = await coverageFixture(context, scenario);
		const launch = await prepareLocalAssistanceRuntimeCoverage(fixture.options, {
			randomUUID: () => scenario === 'alias-mutation'
				? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
				: scenario === 'worker-only'
					? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
					: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
			startTargetCoverage: async () => ({
				reload: async () => undefined, checkpoint: async () => undefined,
				collect: async () => ({ entries: [v8Entry(fixture.preloadUrl)],
					sources: new Map([[fixture.preloadUrl, fixture.preloadSource]]),
					pausedTargetCounts: {}, targetCounts: {}, targetTypes: [] }),
			}),
		});
		const collector = await launch.start({
			context: { newCDPSession: async () => ({}) }, page: { isClosed: () => false }, mainProcessId: 4312,
		});
		await collector.collectBeforeClose();
		if (scenario === 'alias-mutation') {
			await writeFile(fixture.aliasPath, 'mutated archive');
			await writeNodeProfile(launch.sessionDirectory, 4312, 0, []);
		} else if (scenario === 'worker-only') {
			await writeNodeProfile(launch.sessionDirectory, 4312, 1, []);
		} else {
			await writeNodeProfile(launch.sessionDirectory, 4312, 0, []);
			await writeFile(join(launch.sessionDirectory, 'unmanifested.txt'), 'stray');
		}
		await assert.rejects(
			collector.finalizeAfterExit({ code: 0, signal: null }),
			scenario === 'alias-mutation' ? /archive changed/u
				: scenario === 'worker-only' ? /main-process.*thread 0/u : /unexpected coverage entry/u,
		);
	}
});

test('local-assistance process exit requires a clean explicit Electron exit', async () => {
	const clean = new FakeChild(4312);
	const cleanExit = awaitLocalAssistanceProcessExit(clean, { timeoutMs: 100 });
	clean.emit('exit', 0, null);
	assert.deepEqual(await cleanExit, { code: 0, signal: null });

	const failed = new FakeChild(4313);
	const failedExit = awaitLocalAssistanceProcessExit(failed, { timeoutMs: 100 });
	failed.emit('exit', 2, null);
	await assert.rejects(failedExit, /exited with code 2/u);

	const killed = new FakeChild(4314);
	const killedExit = awaitLocalAssistanceProcessExit(killed, { timeoutMs: 100 });
	killed.emit('exit', null, 'SIGTERM');
	await assert.rejects(killedExit, /signal SIGTERM/u);

	const alreadyExited = new FakeChild(4315);
	alreadyExited.exitCode = 0;
	assert.deepEqual(await awaitLocalAssistanceProcessExit(alreadyExited, { timeoutMs: 100 }),
		{ code: 0, signal: null });

	const errored = new FakeChild(4316);
	const errorExit = awaitLocalAssistanceProcessExit(errored, { timeoutMs: 100 });
	errored.emit('error', new Error('spawn failed'));
	await assert.rejects(errorExit, /did not exit cleanly/u);
});

test('local-assistance close collects before page close and finalizes only after clean exit', async () => {
	const child = new FakeChild(4312);
	const order = [];
	const manifest = await completeLocalAssistanceCoverage({
		child,
		collector: {
			collectBeforeClose: async () => { order.push('collect'); },
			finalizeAfterExit: async (exit) => { order.push(`finalize:${String(exit.code)}`); return '/session.json'; },
		},
		closePage: async () => { order.push('close'); child.exitCode = 0; child.emit('exit', 0, null); },
		timeoutMs: 100,
	});
	assert.equal(manifest, '/session.json');
	assert.deepEqual(order, ['collect', 'close', 'finalize:0']);

	const failed = new FakeChild(4313);
	let finalized = false;
	await assert.rejects(completeLocalAssistanceCoverage({
		child: failed,
		collector: { collectBeforeClose: async () => undefined,
			finalizeAfterExit: async () => { finalized = true; } },
		closePage: async () => { failed.exitCode = 2; failed.emit('exit', 2, null); },
		timeoutMs: 100,
	}), /exited with code 2/u);
	assert.equal(finalized, false);
});

test('local-assistance close bounds hung CDP collection and page close', async () => {
	const never = () => new Promise(() => undefined);
	const collecting = new FakeChild(4312);
	let closeCalls = 0;
	await assert.rejects(completeLocalAssistanceCoverage({
		child: collecting,
		collector: { collectBeforeClose: never, finalizeAfterExit: async () => undefined },
		closePage: async () => { closeCalls += 1; },
		timeoutMs: 10,
	}), /CDP collection.*deadline/u);
	assert.equal(closeCalls, 0);

	const closing = new FakeChild(4313);
	await assert.rejects(completeLocalAssistanceCoverage({
		child: closing,
		collector: { collectBeforeClose: async () => undefined, finalizeAfterExit: async () => undefined },
		closePage: never,
		timeoutMs: 10,
	}), /page close and process exit failed/u);
});

test('local-assistance startup bounds a hung CDP session before fixture containment', async (context) => {
	const fixture = await coverageFixture(context, 'hung-cdp-start');
	const launch = await prepareLocalAssistanceRuntimeCoverage(fixture.options);
	await assert.rejects(launch.start({
		context: { newCDPSession: () => new Promise(() => undefined) },
		page: {},
		mainProcessId: 4312,
		timeoutMs: 10,
	}), /CDP startup.*deadline/u);
});

test('local-assistance session inventory rejects directories and symbolic links', async (context) => {
	for (const kind of ['directory', 'symlink']) {
		const fixture = await coverageFixture(context, kind);
		const launch = await prepareLocalAssistanceRuntimeCoverage(
			fixture.options, fakeCoverageDependencies(fixture),
		);
		const collector = await launch.start({
			context: { newCDPSession: async () => ({}) }, page: { isClosed: () => false }, mainProcessId: 4312,
		});
		await collector.collectBeforeClose();
		await writeNodeProfile(launch.sessionDirectory, 4312, 0, []);
		if (kind === 'directory') await mkdir(join(launch.sessionDirectory, 'nested'));
		else await symlink(join(launch.sessionDirectory, 'cdp.json'), join(launch.sessionDirectory, 'alias.json'));
		await assert.rejects(
			collector.finalizeAfterExit({ code: 0, signal: null }),
			/unexpected coverage entry/u,
		);
	}
});

test('local-assistance collector rejects spoofed coverage instrumentation', async (context) => {
	const fixture = await coverageFixture(context, 'spoofed-instrumentation');
	const launch = await prepareLocalAssistanceRuntimeCoverage(fixture.options, {
		startTargetCoverage: async () => ({
			reload: async () => undefined,
			checkpoint: async () => undefined,
			collect: async () => ({
				entries: [v8Entry(fixture.preloadUrl), v8Entry(NAVIGATION_COVERAGE_CHECKPOINT_URL)],
				sources: new Map([
					[fixture.preloadUrl, fixture.preloadSource],
					[NAVIGATION_COVERAGE_CHECKPOINT_URL, 'spoofed checkpoint'],
				]),
				pausedTargetCounts: {}, targetCounts: {}, targetTypes: [],
			}),
		}),
	});
	const collector = await launch.start({
		context: { newCDPSession: async () => ({}) }, page: {}, mainProcessId: 4312,
	});
	await assert.rejects(collector.collectBeforeClose(), /unapproved instrumentation/u);
});

test('real-model fixture wires private coverage before spawn and graceful close after reload', async () => {
	const source = await readFile(new URL(
		'./electron/local-assistance-models/electron-fixture.js', import.meta.url,
	), 'utf8');
	assert.match(source, /environment\.SCAPE_BROWSER_COVERAGE === '1'/u);
	assert.ok(source.indexOf('prepareLocalAssistanceRuntimeCoverage({') < source.indexOf('child = spawn('));
	assert.ok(source.indexOf('coverageLaunch.start({') < source.lastIndexOf('page.waitForFunction('));
	assert.match(source, /completeLocalAssistanceCoverage\(\{[\s\S]*closePage: \(\) => page\.close\(\)/u);
	assert.match(source, /closeBrowserConnection\(browser\)/u);
	assert.match(source, /CONTAINMENT_TIMEOUT_MS/u);
});

async function coverageFixture(context, name = 'baseline') {
	const root = await mkdtemp(join(tmpdir(), `local-assistance-coverage-${name}-`));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runRoot = join(root, 'run');
	const productRoot = join(root, 'payload/products');
	const productDirectory = join(productRoot, 'soundscaper');
	const resourcesPath = join(productDirectory, 'linux-unpacked/resources');
	const productExecutablePath = join(productDirectory, 'linux-unpacked/soundscaper');
	const hostExecutablePath = join(root, 'nightly/soundscaper-nightly-tests');
	const aliasPath = join(productRoot, 'soundscaper.asar');
	const preloadSource = 'globalThis.soundscaperDesktop = { v1: {} };\n';
	await Promise.all([
		mkdir(join(productDirectory, 'e2e-coverage'), { recursive: true }),
		mkdir(join(resourcesPath, 'runtime/vendor'), { recursive: true }),
		mkdir(join(hostExecutablePath, '..'), { recursive: true }),
	]);
	await Promise.all([
		writeFile(aliasPath, 'authenticated soundscaper archive'),
		writeFile(productExecutablePath, 'product executable'),
		writeFile(hostExecutablePath, 'nightly executable'),
		writeFile(join(resourcesPath, 'runtime/vendor/index.js'), 'module.exports = true;\n'),
	]);
	const archive = await fileIdentity(aliasPath);
	const executableResources = packagedExecutableResourceIdentity(
		await collectPackagedExecutableResourceFiles(resourcesPath),
	);
	await writeFile(join(productDirectory, 'e2e-coverage/manifest.json'), JSON.stringify({
		schemaVersion: 3, kind: 'soundscaper-e2e-product-build-evidence', productId: 'soundscaper',
		sourceRevision: SOURCE_REVISION, packageArchive: archive, executableResources,
	}));
	const packageIdentity = Object.freeze({
		productId: 'soundscaper', applicationVersion: '1.0.0', sourceRevision: SOURCE_REVISION,
		target: 'linux-x64', application: { fileName: 'soundscaper.asar', ...archive },
		stageManifest: { fileName: 'stage-manifest.json', byteLength: 1, sha256: '2'.repeat(64) },
	});
	return {
		aliasPath,
		archive,
		executableResources,
		mainUrl: `file://${aliasPath}/desktop/main.mjs`,
		preloadSource,
		preloadUrl: `file://${aliasPath}/desktop/preload.mjs`,
		options: {
			architecture: 'x64', environment: { ELECTRON_RUN_AS_NODE: '1', NODE_V8_COVERAGE: '/tmp/outer-coverage' },
			hostExecutablePath, packageIdentity, platform: 'linux', productExecutablePath,
			productId: 'soundscaper', productRoot, runRoot,
		},
	};
}

async function fileIdentity(path) {
	const bytes = await readFile(path);
	return { byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function writeNodeProfile(directory, pid, threadId, result) {
	await writeFile(join(directory, `coverage-${pid}-1000-${threadId}.json`), JSON.stringify({ result }));
}

function v8Entry(url) {
	return { scriptId: '1', url, functions: [{ functionName: '', isBlockCoverage: true,
		ranges: [{ startOffset: 0, endOffset: 1, count: 1 }] }] };
}

function fakeCoverageDependencies(fixture) {
	return { startTargetCoverage: async () => ({
		reload: async () => undefined,
		checkpoint: async () => undefined,
		collect: async () => ({
			entries: [v8Entry(fixture.preloadUrl)],
			sources: new Map([[fixture.preloadUrl, fixture.preloadSource]]),
			pausedTargetCounts: {}, targetCounts: {}, targetTypes: [],
		}),
	}) };
}

class FakeChild extends EventEmitter {
	exitCode = null;
	signalCode = null;
	constructor(pid) { super(); this.pid = pid; }
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createDesktopNightlyTestsTauriPlan,
	resolveDesktopNightlyTestsTauriPrototype,
	runDesktopNightlyTestsTauriPhase,
	runDesktopNightlyTestsTauriSmokeCLI,
} from '../scripts/lib/desktop-nightly-tests-tauri.mjs';

const REVISION = '1'.repeat(40);

async function fixture(context: { after(callback: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), 'nightly-tauri-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const payloadRoot = join(root, 'payload');
	const runRoot = join(root, 'run');
	await mkdir(join(payloadRoot, 'tauri-prototype'), { recursive: true });
	await mkdir(runRoot);
	const executable = 'tauri-prototype/soundscaper-tauri-prototype';
	const bytes = Buffer.from('native executable fixture');
	await writeFile(join(payloadRoot, executable), bytes);
	const descriptor = { executable, sourceRevision: REVISION,
		target: { platform: 'linux' as const, arch: 'x64' as const },
		byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
	await writeFile(join(payloadRoot, 'stage-manifest.json'), JSON.stringify({ tauriPrototype: descriptor }));
	const options = { payloadRoot, runRoot, platform: 'linux', arch: 'x64', sourceRevision: REVISION,
		environment: { DISPLAY: ':1', PATH: '/usr/bin' } };
	const tauriPrototype = await resolveDesktopNightlyTestsTauriPrototype(options);
	assert.ok(tauriPrototype);
	return { ...options, descriptor, tauriPrototype };
}

function report(overrides: Record<string, unknown> = {}) {
	return { host: 'tauri', platform: 'linux', architecture: 'x86_64', success: true,
		validWave: true, nonSilent: true, renderer: { success: true, editorReady: true,
			importedViaMenu: true, exportedViaMenu: true, nodeExposed: false, errors: [] }, ...overrides };
}

test('legacy nightly payloads have no Tauri phase, while declared payloads bind exact source and target bytes', async (context) => {
	const options = await fixture(context);
	assert.equal(options.tauriPrototype.executablePath, join(options.payloadRoot, options.descriptor.executable));
	for (const override of [
		{ sourceRevision: '2'.repeat(40) }, { platform: 'darwin' }, { arch: 'arm64' },
	]) await assert.rejects(resolveDesktopNightlyTestsTauriPrototype({ ...options, ...override }), /source|target/u);
	await writeFile(join(options.payloadRoot, options.descriptor.executable), Buffer.alloc(options.descriptor.byteLength, 1));
	await assert.rejects(resolveDesktopNightlyTestsTauriPrototype(options), /digest/u);
	await writeFile(join(options.payloadRoot, options.descriptor.executable), 'substituted');
	await assert.rejects(resolveDesktopNightlyTestsTauriPrototype(options), /digest|bytes/u);
	await rm(join(options.payloadRoot, options.descriptor.executable));
	await assert.rejects(resolveDesktopNightlyTestsTauriPrototype(options), /executable/u);
	await writeFile(join(options.payloadRoot, 'stage-manifest.json'), '{}');
	assert.equal(await resolveDesktopNightlyTestsTauriPrototype(options), null);
	await rm(join(options.payloadRoot, 'stage-manifest.json'));
	assert.equal(await resolveDesktopNightlyTestsTauriPrototype(options), null);
});

test('Tauri admission rejects foreign paths and extra descriptor authority', async (context) => {
	const options = await fixture(context);
	for (const descriptor of [
		{ ...options.descriptor, executable: '../foreign' },
		{ ...options.descriptor, unexpected: true },
		{ ...options.descriptor, target: { ...options.descriptor.target, extra: true } },
	]) {
		await writeFile(join(options.payloadRoot, 'stage-manifest.json'), JSON.stringify({ tauriPrototype: descriptor }));
		await assert.rejects(resolveDesktopNightlyTestsTauriPrototype(options), /descriptor|target|executable/u);
	}
});

test('native plans preserve a display and isolate Electron loader settings, or select Xvfb on Linux', async (context) => {
	const options = await fixture(context);
	const environment = { DISPLAY: ':4', PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1',
		APPIMAGE: '/tmp/runner.AppImage', APPDIR: '/tmp/.mount', LD_LIBRARY_PATH: '/tmp/bundled',
		LD_PRELOAD: '/tmp/injected.so', NODE_V8_COVERAGE: '/tmp/outer' };
	const plan = createDesktopNightlyTestsTauriPlan({ ...options, environment });
	assert.equal(plan.command, options.tauriPrototype.executablePath);
	assert.equal(plan.env.DISPLAY, ':4');
	for (const key of ['ELECTRON_RUN_AS_NODE', 'APPIMAGE', 'APPDIR', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'NODE_V8_COVERAGE']) {
		assert.equal(plan.env[key], undefined, key);
	}
	assert.equal(environment.ELECTRON_RUN_AS_NODE, '1');
	assert.deepEqual(plan.args, ['--smoke', '--smoke-report', join(options.runRoot, 'tauri/smoke-report.json')]);
	const headless = createDesktopNightlyTestsTauriPlan({ ...options, environment: {} });
	assert.equal(headless.command, 'xvfb-run');
	assert.deepEqual(headless.args, ['-a', options.tauriPrototype.executablePath, ...plan.args]);
	const wayland = createDesktopNightlyTestsTauriPlan({ ...options, environment: { WAYLAND_DISPLAY: 'wayland-0' } });
	assert.equal(wayland.command, options.tauriPrototype.executablePath);
});

test('native smoke requires fresh successful evidence and reports its one test', async (context) => {
	const options = await fixture(context);
	const progress: unknown[] = [];
	const phase = await runDesktopNightlyTestsTauriPhase(options, {
		onItems: (value) => { progress.push(value); },
		runChild: async (_command, args, settings) => {
			assert.equal(settings.timeout, 120_000);
			assert.equal(settings.outputLimit, 1024 * 1024);
			const path = args.at(-1)!;
			await assert.rejects(readFile(path), { code: 'ENOENT' });
			await writeFile(path, JSON.stringify(report()));
			return { code: 0, stdout: 'native output', stderr: 'native diagnostic' };
		},
	});
	assert.deepEqual(phase.child, { code: 0, signal: null });
	assert.equal(phase.diagnostics.passed, true);
	assert.deepEqual(progress.map((value) => (value as { completed: number }).completed), [0, 1]);
	assert.match(await readFile(join(options.runRoot, 'tauri/console.log'), 'utf8'), /native output.*native diagnostic/su);
	assert.equal((JSON.parse(await readFile(join(options.runRoot, 'tauri/summary.json'), 'utf8')) as { status: string }).status, 'passed');
});

test('failed WAV or renderer assertions cannot pass even when the native child exits zero', async (context) => {
	for (const invalid of [report({ nonSilent: false }), report({ validWave: false }),
		report({ renderer: { success: true, editorReady: true, importedViaMenu: true,
			exportedViaMenu: true, nodeExposed: true, errors: [] } })]) {
		const options = await fixture(context);
		const phase = await runDesktopNightlyTestsTauriPhase(options, {
			runChild: async (_command, args) => {
				await writeFile(args.at(-1)!, JSON.stringify(invalid));
				return { code: 0, stdout: '', stderr: '' };
			},
		});
		assert.equal(phase.diagnostics.passed, false);
	}
});

test('missing, malformed, or foreign reports fail with preserved diagnostic summaries', async (context) => {
	for (const contents of [null, '{broken', JSON.stringify(report({ architecture: 'aarch64' })),
		JSON.stringify(report({ host: 'electron' })), JSON.stringify(report({ platform: 'windows' }))]) {
		const options = await fixture(context);
		await assert.rejects(runDesktopNightlyTestsTauriPhase(options, {
			runChild: async (_command, args) => {
				if (contents !== null) await writeFile(args.at(-1)!, contents);
				return { code: 0, stdout: '', stderr: '' };
			},
		}), /report/u);
		assert.match(await readFile(join(options.runRoot, 'tauri/summary.json'), 'utf8'), /"status": "error"/u);
	}
});

test('native timeout remains an infrastructure error, while interrupt signals stay interrupted', async (context) => {
	const options = await fixture(context);
	await assert.rejects(runDesktopNightlyTestsTauriPhase(options, {
		runChild: () => Promise.reject(new Error('Packaged Tauri smoke child timed out after 120000 milliseconds')),
	}), /timed out/u);
	assert.match(await readFile(join(options.runRoot, 'tauri/summary.json'), 'utf8'), /timed out/u);
	const interrupted = await fixture(context);
	const phase = await runDesktopNightlyTestsTauriPhase(interrupted, {
		runChild: () => Promise.reject(new Error('Packaged Tauri smoke child exited with signal SIGINT')),
	});
	assert.deepEqual(phase.child, { code: null, signal: 'SIGINT' });
	assert.equal(phase.diagnostics.passed, false);
});

test('late parent cancellation cannot turn a completed native report into a passing phase', async (context) => {
	const options = await fixture(context);
	const phase = await runDesktopNightlyTestsTauriPhase(options, {
		runChild: async (_command, args) => {
			await writeFile(args.at(-1)!, JSON.stringify(report()));
			return { code: 0, stdout: '', stderr: '' };
		},
		onItems: (items) => { if (items.completed === 1) process.emit('SIGTERM'); },
	});
	assert.deepEqual(phase.child, { code: null, signal: 'SIGTERM' });
	assert.equal(phase.diagnostics.passed, false);
	assert.match(await readFile(join(options.runRoot, 'tauri/summary.json'), 'utf8'), /"status": "interrupted"/u);
});

test('prepared-payload CLI admits the explicit native architecture and rejects absent payloads', async (context) => {
	const options = await fixture(context);
	const descriptor = { ...options.descriptor, target: { platform: 'linux', arch: 'arm64' } };
	await writeFile(join(options.payloadRoot, 'stage-manifest.json'), JSON.stringify({ tauriPrototype: descriptor }));
	const argv = ['--payload', options.payloadRoot, '--output', options.runRoot,
		'--source-revision', REVISION, '--arch', 'arm64'];
	assert.equal(await runDesktopNightlyTestsTauriSmokeCLI(argv, {
		platform: 'linux', arch: 'x64', runPhase: async (phase) => {
			assert.equal(phase.arch, 'arm64');
			assert.equal(phase.tauriPrototype.target.arch, 'arm64');
			return { child: { code: 0, signal: null }, diagnostics: { passed: true } };
		},
	}), 0);
	await writeFile(join(options.payloadRoot, 'stage-manifest.json'), '{}');
	await assert.rejects(runDesktopNightlyTestsTauriSmokeCLI(argv), /does not contain/u);
});

test('prepared-payload CLI preserves assertion and interrupt failures and rejects ambiguous arguments', async (context) => {
	const options = await fixture(context);
	const argv = ['--payload', options.payloadRoot, '--output', options.runRoot,
		'--source-revision', REVISION, '--arch', 'x64'];
	for (const [child, passed, expected] of [
		[{ code: 0, signal: null }, false, 1],
		[{ code: 2, signal: null }, false, 2],
		[{ code: null, signal: 'SIGTERM' }, false, 143],
	] as const) {
		assert.equal(await runDesktopNightlyTestsTauriSmokeCLI(argv, {
			platform: 'linux', runPhase: async () => ({ child, diagnostics: { passed } }),
		}), expected);
	}
	for (const extra of [['--arch', 'arm64'], ['--unknown', 'value'], ['--dangling']]) {
		await assert.rejects(runDesktopNightlyTestsTauriSmokeCLI([...argv, ...extra]), /arguments/u);
	}
});

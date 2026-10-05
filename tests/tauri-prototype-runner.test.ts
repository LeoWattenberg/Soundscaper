/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createPrototypeEnvironment,
	createPrototypePlan,
	executeCommand,
	parsePrototypeArguments,
	runPrototypePlan,
	runPrototypeSmoke,
} from '../prototypes/tauri/run.mjs';

const root = resolve('/tmp/soundscaper prototype');

test('prototype arguments reject ambiguous commands and accept release builds', () => {
	assert.deepEqual(parsePrototypeArguments(['run', '--release']), { command: 'run', release: true });
	assert.deepEqual(parsePrototypeArguments(['test']), { command: 'test', release: false });
	for (const args of [[], ['deploy'], ['run', 'build'], ['build', '--release', '--release'], ['run', '--unknown']]) {
		assert.throws(() => parsePrototypeArguments(args), /Usage:/u);
	}
});

test('prototype outputs and cargo artifacts stay out of production build directories', () => {
	const plan = createPrototypePlan({ root, command: 'build', release: true, platform: 'win32' });
	assert.equal(plan.rendererDirectory, resolve(root, '.tauri-prototype/renderer'));
	assert.equal(plan.bridgeFile, resolve(root, '.tauri-prototype/bridge.js'));
	assert.equal(plan.executable, resolve(root, '.tauri-prototype/target/release/soundscaper-tauri-prototype.exe'));
	assert.deepEqual(plan.cargoArguments, [
		'build', '--locked', '--features', 'custom-protocol',
		'--manifest-path', resolve(root, 'prototypes/tauri/host/Cargo.toml'),
		'--target-dir', resolve(root, '.tauri-prototype/target'), '--release',
	]);
});

test('prototype renderer always uses the Soundscaper browser composition without mutating the caller environment', () => {
	const inherited = {
		PATH: '/toolchain/bin', SCAPE_PRODUCT: 'framescaper',
		SCAPE_DESKTOP_CODEC_RUNTIME: 'main-process', SCAPE_BUILD_SOURCE_MAPS: '1',
	};
	const environment = createPrototypeEnvironment(inherited);
	assert.equal(environment.PATH, inherited.PATH);
	assert.equal(environment.SCAPE_PRODUCT, 'soundscaper');
	assert.equal(environment.SCAPE_DESKTOP_CODEC_RUNTIME, undefined);
	assert.equal(environment.SCAPE_BUILD_SOURCE_MAPS, undefined);
	assert.equal(inherited.SCAPE_PRODUCT, 'framescaper');
	assert.equal(inherited.SCAPE_DESKTOP_CODEC_RUNTIME, 'main-process');
});

test('missing Cargo stops before bundling the editor and reports the prerequisite', async () => {
	const plan = createPrototypePlan({ root, command: 'build', release: false, platform: 'linux' });
	let built = false;
	await assert.rejects(runPrototypePlan(plan, {
		execute: () => Promise.reject(Object.assign(new Error('spawn cargo ENOENT'), { code: 'ENOENT' })),
		buildFrontend: () => { built = true; return Promise.resolve(); },
	}), /Cargo.*Rust.*PATH/u);
	assert.equal(built, false);
});

test('native run waits for frontend and locked host builds before opening the application', async () => {
	const plan = createPrototypePlan({ root, command: 'run', release: false, platform: 'linux' });
	const events: string[] = [];
	await runPrototypePlan(plan, {
		execute: (command: string, args: string[], options: { cwd: string }) => {
			assert.equal(options.cwd, command === 'cargo' ? resolve(root, 'prototypes/tauri/host') : root);
			events.push(command === 'cargo' ? `cargo:${args[0]}` : 'launch');
			return Promise.resolve();
		},
		buildFrontend: () => { events.push('frontend'); return Promise.resolve(); },
	});
	assert.deepEqual(events, ['cargo:--version', 'frontend', 'cargo:build', 'launch']);
});

test('frontend failure never builds or starts a stale native application', async () => {
	const plan = createPrototypePlan({ root, command: 'run', release: false, platform: 'linux' });
	const events: string[] = [];
	await assert.rejects(runPrototypePlan(plan, {
		execute: (_command: string, args: string[]) => { events.push(args[0]!); return Promise.resolve(); },
		buildFrontend: () => Promise.reject(new Error('renderer build failed')),
	}), /renderer build failed/u);
	assert.deepEqual(events, ['--version']);
});

test('native smoke removes stale evidence and uses a headless display when Linux has none', async () => {
	const temporary = await mkdtemp(resolve(tmpdir(), 'tauri-runner-'));
	try {
		const plan = createPrototypePlan({ root: temporary, command: 'smoke', release: false, platform: 'linux' });
		await mkdir(plan.outputRoot, { recursive: true });
		await writeFile(plan.smokeReport, '{"success":true,"stale":true}');
		await runPrototypeSmoke(plan, async (command, args, options) => {
			assert.equal(command, 'xvfb-run');
			assert.deepEqual(args, ['-a', plan.executable, '--smoke', '--smoke-report', plan.smokeReport]);
			assert.equal(options.timeoutMs, 120_000);
			await assert.rejects(readFile(plan.smokeReport), { code: 'ENOENT' });
			await writeFile(plan.smokeReport, '{"success":true}');
		}, { cwd: temporary, env: {} });
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test('native smoke fails when a successful process provides no passing report', async () => {
	const temporary = await mkdtemp(resolve(tmpdir(), 'tauri-runner-'));
	try {
		const plan = createPrototypePlan({ root: temporary, command: 'smoke', release: false, platform: 'linux' });
		await mkdir(plan.outputRoot, { recursive: true });
		const execution = { cwd: temporary, env: { DISPLAY: ':42' } };
		await assert.rejects(runPrototypeSmoke(plan, () => Promise.resolve(), execution), /valid smoke report/u);
		await assert.rejects(runPrototypeSmoke(plan, async () => {
			await writeFile(plan.smokeReport, '{"success":false,"error":"write failed"}');
		}, execution), /Prototype smoke failed.*write failed/u);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test('native smoke diagnoses a missing virtual display without claiming success', async () => {
	const temporary = await mkdtemp(resolve(tmpdir(), 'tauri-runner-'));
	try {
		const plan = createPrototypePlan({ root: temporary, command: 'smoke', release: false, platform: 'linux' });
		await assert.rejects(runPrototypeSmoke(plan,
			() => Promise.reject(Object.assign(new Error('spawn xvfb-run ENOENT'), { code: 'ENOENT' })),
			{ cwd: temporary, env: {} }), /Headless Linux smoke requires xvfb-run/u);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test('process deadlines terminate a hanging command', { timeout: 5_000 }, async () => {
	await assert.rejects(executeCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
		cwd: tmpdir(), env: process.env, timeoutMs: 150,
	}), /exceeded the 150 ms deadline/u);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runBoundedSmokeChild } from '../scripts/lib/desktop-smoke-child.mjs';
import { runDesktopNightlyTestsTauriPhase } from '../scripts/lib/desktop-nightly-tests-tauri.mjs';

const settings = { cwd: process.cwd(), environment: process.env, outputLimit: 1024,
	timeout: 5_000, label: 'Tauri smoke', errorEvent: 'once' as const };

test('already interrupted native admission cannot spawn, and successful supervision removes abort listeners', async () => {
	const controller = new AbortController();
	const reason = new Error('interrupted before admission');
	controller.abort(reason);
	let spawned = false;
	await assert.rejects(runBoundedSmokeChild('unavailable', [], { ...settings, signal: controller.signal }, {
		spawnChild: () => { spawned = true; throw new Error('must not spawn'); },
	}), (error: unknown) => error === reason);
	assert.equal(spawned, false);
	const success = new AbortController();
	assert.equal((await runBoundedSmokeChild(process.execPath, ['-e', ''], {
		...settings, signal: success.signal,
	})).code, 0);
	assert.equal(getEventListeners(success.signal, 'abort').length, 0);
});

test('native cancellation kills real descendants that ignore their graceful signal', {
	skip: process.platform === 'win32', timeout: 10_000,
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'native-smoke-abort-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const heartbeat = join(root, 'heartbeat');
	const abort = new AbortController();
	const reason = new Error('Packaged Tauri smoke child exited with signal SIGINT');
	const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(process.argv[1],String(Date.now())),10);`;
	const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');spawn(process.execPath,['-e',${JSON.stringify(descendant)},process.argv[1]],{stdio:'ignore'});const ready=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(ready);process.stdout.write('ready');}},10);setInterval(()=>{},1000);`;
	let resolveReady: () => void = () => {};
	const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
	let childPid: number | undefined;
	context.after(() => {
		if (childPid) try { process.kill(-childPid, 'SIGKILL'); } catch { /* Already contained. */ }
	});
	const running = runBoundedSmokeChild(process.execPath, ['-e', script, heartbeat], {
		...settings, signal: abort.signal,
	}, {
		spawnChild: (command, args, options) => {
			const child = spawn(command, args, options);
			childPid = child.pid;
			child.stdout!.once('data', resolveReady);
			return child;
		},
	});
	const rejected = assert.rejects(running, (error: unknown) => error === reason);
	await ready;
	abort.abort(reason);
	await rejected;
	const stopped = await readFile(heartbeat, 'utf8');
	await delay(75);
	assert.equal(await readFile(heartbeat, 'utf8'), stopped);
});

test('native phase forwards parent interruption to its real child and removes signal listeners', {
	skip: process.platform === 'win32', timeout: 10_000,
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'native-phase-interrupt-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'run'));
	const initial = ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal));
	let nativePid: number | undefined;
	context.after(() => {
		if (nativePid) try { process.kill(-nativePid, 'SIGKILL'); } catch { /* Already contained. */ }
	});
	const phase = await runDesktopNightlyTestsTauriPhase({
		payloadRoot: root, runRoot: join(root, 'run'), platform: 'linux', arch: 'x64',
		environment: { DISPLAY: ':1' }, tauriPrototype: {
			executable: 'tauri-prototype/soundscaper-tauri-prototype', executablePath: process.execPath,
			sourceRevision: '1'.repeat(40), target: { platform: 'linux', arch: 'x64' },
			byteLength: 1, sha256: '0'.repeat(64),
		},
	}, {
		runChild: (_command, _args, options) => runBoundedSmokeChild(process.execPath,
			['-e', 'process.stdout.write("ready");setInterval(()=>{},1000);'], {
				...options, environment: process.env,
			}, {
				spawnChild: (command, args, childOptions) => {
					const child = spawn(command, args, childOptions);
					nativePid = child.pid;
					child.stdout!.once('data', () => { process.kill(process.pid, 'SIGINT'); });
					return child;
				},
			}),
	});
	assert.deepEqual(phase.child, { code: null, signal: 'SIGINT' });
	assert.equal(phase.diagnostics.passed, false);
	assert.deepEqual(['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal)), initial);
	assert.match(await readFile(join(root, 'run/tauri/summary.json'), 'utf8'), /"status": "interrupted"/u);
});

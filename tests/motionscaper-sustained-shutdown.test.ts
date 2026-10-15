/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { shutdownMotionSustainedApplication } from '../scripts/performance/motionscaper-sustained-shutdown.ts';
import { readMotionProcessIdentity } from '../scripts/performance/motionscaper-sustained-observation.ts';
import type { MotionProcessIdentity } from '../scripts/performance/motionscaper-sustained-process.ts';

async function alive(identity: MotionProcessIdentity) {
	try { return (await readMotionProcessIdentity(identity.pid)).startTicks === identity.startTicks; }
	catch (error) { if (Reflect.get(error as object, 'code') === 'ENOENT') return false; throw error; }
}
async function gone(identities: readonly MotionProcessIdentity[]) {
	const deadline = performance.now() + 3000;
	while ((await Promise.all(identities.map(alive))).some(Boolean)) {
		if (performance.now() >= deadline) throw new Error('Synthetic shutdown identities remain.'); await delay(5);
	}
}

test('Motion sustained shutdown lets the real owner retire its dependent before signalling residual descendants', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-shutdown-')), readyPath = join(directory, 'ready');
	const source = `const fs=require('node:fs'),{spawn}=require('node:child_process');let retiring=false;const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.once('spawn',()=>fs.writeFileSync(process.argv[1],String(child.pid)));child.once('exit',()=>process.exit(retiring?0:17));process.on('SIGTERM',()=>setTimeout(()=>{retiring=true;child.kill('SIGTERM')},50));setTimeout(()=>{child.kill('SIGKILL');process.exit(19)},10000);`;
	const parent = spawn(process.execPath, ['-e', source, readyPath], { stdio: 'ignore' });
	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { parent.once('error', reject); parent.once('close', (code, signal) => resolve({ code, signal })); });
	let dependent: MotionProcessIdentity | undefined;
	try {
		const owner = await readMotionProcessIdentity(parent.pid!); let childPid = 0;
		const deadline = performance.now() + 3000;
		while (!childPid) {
			try { childPid = Number(await readFile(readyPath, 'utf8')); }
			catch (error) { if (Reflect.get(error as object, 'code') !== 'ENOENT') throw error; }
			if (performance.now() > deadline) throw new Error('Synthetic dependent never started.'); if (!childPid) await delay(5);
		}
		dependent = await readMotionProcessIdentity(childPid);
		const result = await shutdownMotionSustainedApplication({ owner, retained: () => [owner, dependent!], prepare: async () => undefined, closed,
			isAlive: alive, send: (identity, signal) => { process.kill(identity.pid, signal); }, signalUnadmitted: signal => { parent.kill(signal); }, waitGone: gone });
		assert.deepEqual(result.exit, { code: 0, signal: null }); assert.deepEqual(result.errors, []);
		assert.deepEqual(result.signals.map(value => [value.identity?.pid, value.signal]), [[owner.pid, 'SIGTERM']]);
		await gone([owner, dependent]);
	} finally {
		if (dependent && await alive(dependent)) process.kill(dependent.pid, 'SIGKILL'); parent.kill('SIGKILL'); await closed;
		await rm(directory, { recursive: true, force: true });
	}
});

const owner = { pid: 700001, parentPid: 1, startTicks: '101' }, dependent = { pid: 700002, parentPid: owner.pid, startTicks: '102' };
function options(overrides: Partial<Parameters<typeof shutdownMotionSustainedApplication>[0]> = {}): Parameters<typeof shutdownMotionSustainedApplication>[0] {
	return { owner, retained: () => [owner, dependent], prepare: async () => undefined, closed: Promise.resolve({ code: 0, signal: null }),
		isAlive: async () => true, send: () => undefined, signalUnadmitted: () => { throw new Error('Unadmitted authority was not expected.'); }, waitGone: async () => undefined, ...overrides };
}
test('Motion shutdown waits for owner closure before signalling an authenticated residual and excludes a recycled identity', async () => {
	let close!: () => void, requested!: () => void;
	const closed = new Promise<{ code: 0; signal: null }>(resolve => { close = () => resolve({ code: 0, signal: null }); });
	const first = new Promise<void>(resolve => { requested = resolve; }); const sent: number[] = [];
	const recycled = { pid: 700003, parentPid: 1, startTicks: '999' };
	const operation = shutdownMotionSustainedApplication(options({ closed, retained: () => [owner, dependent, recycled],
		isAlive: async identity => identity !== recycled, send: identity => { sent.push(identity.pid); if (identity === owner) requested(); } }));
	await first; assert.deepEqual(sent, [owner.pid]); close();
	const result = await operation; assert.deepEqual(sent, [owner.pid, dependent.pid]); assert.deepEqual(result.errors, []);
	assert.deepEqual(result.signals.map(value => value.phase), ['graceful-owner', 'residual-descendants']);
});
for (const exit of [{ code: null, signal: 'SIGTRAP' }, { code: null, signal: 'SIGKILL' }, { code: 17, signal: null }] as const) {
	test(`Motion shutdown keeps actual ${exit.signal ?? exit.code} parent termination unqualified`, async () => {
		const result = await shutdownMotionSustainedApplication(options({ closed: Promise.resolve(exit) }));
		assert.deepEqual(result.exit, exit); assert.ok(result.errors.some(error => String(error).includes('unqualified exit')));
	});
}
test('Motion shutdown permits original SIGTERM authority and pre-admission ChildProcess cleanup without signalling a foreign PID', async () => {
	const sent: NodeJS.Signals[] = [];
	const result = await shutdownMotionSustainedApplication(options({ owner: undefined, retained: () => [],
		closed: Promise.resolve({ code: null, signal: 'SIGTERM' }), signalUnadmitted: signal => { sent.push(signal); } }));
	assert.deepEqual(sent, ['SIGTERM']); assert.deepEqual(result.errors, []); assert.equal(result.signals[0]?.identity, null);
});
test('Motion shutdown awaits its original ten-second fallback signal operation before returning a receipt', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let requested!: () => void, killEntered!: () => void, releaseKill!: () => void, close!: () => void;
	const first = new Promise<void>(resolve => { requested = resolve; }), entered = new Promise<void>(resolve => { killEntered = resolve; });
	const blocked = new Promise<void>(resolve => { releaseKill = resolve; });
	const closed = new Promise<{ code: null; signal: 'SIGKILL' }>(resolve => { close = () => resolve({ code: null, signal: 'SIGKILL' }); });
	let settled = false;
	const operation = shutdownMotionSustainedApplication(options({ retained: () => [owner], closed, send: async (_identity, signal) => {
		if (signal === 'SIGTERM') requested(); else { killEntered(); await blocked; }
	} })).finally(() => { settled = true; });
	await first; context.mock.timers.tick(9999); await Promise.resolve(); assert.equal(settled, false);
	context.mock.timers.tick(1); await entered; close(); await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
	releaseKill(); const result = await operation;
	assert.ok(result.errors.some(error => String(error).includes('escalation deadline'))); assert.ok(result.errors.some(error => String(error).includes('unqualified exit')));
	assert.equal(result.signals.at(-1)?.signal, 'SIGKILL'); assert.equal(result.signals.at(-1)?.phase, 'deadline');
});
test('Motion shutdown retains observer and residual cleanup failures', async () => {
	const observer = new Error('observer close failed'), residual = new Error('residual survived');
	const result = await shutdownMotionSustainedApplication(options({ prepare: async () => { throw observer; }, waitGone: async () => { throw residual; } }));
	assert.ok(result.errors.includes(observer)); assert.ok(result.errors.includes(residual));
	assert.ok(result.signals.some(value => value.phase === 'remaining-descendants' && value.signal === 'SIGKILL'));
});
test('Motion shutdown journal overflow stays a failure while cleanup continues for every authenticated retained identity', async () => {
	const retained = Array.from({ length: 300 }, (_, index) => ({ pid: 800000 + index, parentPid: owner.pid, startTicks: String(index + 1) }));
	let sent = 0;
	const result = await shutdownMotionSustainedApplication(options({ retained: () => retained, send: () => { sent++; } }));
	assert.equal(sent, 301); assert.equal(result.signals.length, 256); assert.ok(result.errors.some(error => String(error).includes('journal admission exceeded')));
});

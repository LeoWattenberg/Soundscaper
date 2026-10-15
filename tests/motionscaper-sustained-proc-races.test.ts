/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';
import { readMotionProcessIdentity, sampleMotionOwnedProcesses } from '../scripts/performance/motionscaper-sustained-observation.ts';
import { startMotionSustainedSampler } from '../scripts/performance/motionscaper-sustained-sampler.ts';

const root = { pid: 700001, parentPid: 1, startTicks: '101' };
const child = { pid: 700002, parentPid: root.pid, startTicks: '102' };
const foreign = { pid: 700003, parentPid: 1, startTicks: '103' };
const memory = 'Rss: 8 kB\nPss: 4 kB\n';
function stat(identity = root): string {
	const fields = ['S', String(identity.parentPid), String(root.pid), String(root.pid), ...Array<string>(15).fill('0'), identity.startTicks];
	return `${identity.pid} (synthetic process) ${fields.join(' ')}\n`;
}
function procError(code: string): Error { return Object.assign(new Error(`${code}: synthetic /proc read`), { code }); }
function restore(context: TestContext): void { context.mock.restoreAll(); syncBuiltinESMExports(); }
function procFixture(context: TestContext, reader: (path: string) => string, names = [root, child, foreign].map(value => String(value.pid))): void {
	context.mock.method(fs.promises, 'readdir', (path: fs.PathLike) => {
		assert.equal(path, '/proc'); return Promise.resolve(names);
	});
	context.mock.method(fs.promises, 'readFile', (path: fs.PathLike, encoding: unknown) => {
		assert.equal(encoding, 'utf8'); assert.equal(typeof path, 'string');
		return Promise.resolve().then(() => reader(String(path)));
	});
	syncBuiltinESMExports(); context.after(() => restore(context));
}
function normal(path: string): string {
	for (const identity of [root, child, foreign]) {
		if (path === `/proc/${identity.pid}/stat`) return stat(identity);
		if (path === `/proc/${identity.pid}/smaps_rollup`) return memory;
	}
	throw new Error(`Unexpected synthetic read: ${path}`);
}

test('Motion process sampling retains optional accounting from the same owned rollup read', async context => {
	let reads = 0;
	procFixture(context, path => {
		if (path.endsWith('/smaps_rollup')) { reads++; return `${memory}Private_Clean: 1 kB\nPrivate_Dirty: 2 kB\nShared_Clean: 3 kB\nShared_Dirty: 0 kB\nAnonymous: 2 kB\nPss_Anon: 2 kB\nPss_File: 1 kB\nPss_Shmem: 1 kB\n`; }
		return normal(path);
	});
	const sampled = await sampleMotionOwnedProcesses(root, []);
	assert.equal(reads, 2, 'There must still be one rollup read per owned identity.');
	assert.deepEqual(Reflect.get(sampled.processes[0]!, 'details'), {
		privateCleanBytes: { status: 'available', bytes: 1024 }, privateDirtyBytes: { status: 'available', bytes: 2048 },
		sharedCleanBytes: { status: 'available', bytes: 3072 }, sharedDirtyBytes: { status: 'available', bytes: 0 },
		anonymousBytes: { status: 'available', bytes: 2048 }, pssAnonymousBytes: { status: 'available', bytes: 2048 },
		pssFileBytes: { status: 'available', bytes: 1024 }, pssSharedMemoryBytes: { status: 'available', bytes: 1024 },
	});
	assert.equal(sampled.rssBytes, 16384); assert.equal(sampled.pssBytes, 8192);
});

test('Motion process optional failures remain explicit and cannot replace required RSS/PSS', async context => {
	procFixture(context, path => path.endsWith('/smaps_rollup') ? `${memory}Private_Clean: 1 kB\nPrivate_Clean: 2 kB\nPss_File: invalid\n` : normal(path));
	const sampled = await sampleMotionOwnedProcesses(root, []);
	assert.equal(sampled.rssBytes, 16384); assert.equal(sampled.pssBytes, 8192);
	for (const process of sampled.processes) {
		assert.deepEqual(process.details.privateCleanBytes, { status: 'unavailable', reason: 'duplicate' });
		assert.deepEqual(process.details.pssFileBytes, { status: 'unavailable', reason: 'invalid' });
		assert.deepEqual(process.details.anonymousBytes, { status: 'unavailable', reason: 'not-reported' });
	}
});

for (const code of ['ENOENT', 'ESRCH']) {
	test(`Motion /proc census tolerates ${code} for a vanished foreign task without losing live owned memory`, async context => {
		procFixture(context, path => { if (path === `/proc/${foreign.pid}/stat`) throw procError(code); return normal(path); });
		const result = await sampleMotionOwnedProcesses(root, []);
		assert.deepEqual(result.processes.map(value => value.identity), [root, child]);
		assert.equal(result.rssBytes, 16384); assert.equal(result.pssBytes, 8192);
	});
	for (const boundary of ['smaps_rollup', 'identity-recheck']) {
		test(`Motion owned memory omits only the task that vanishes with ${code} at ${boundary}`, async context => {
			let childStatReads = 0;
			procFixture(context, path => {
				if (path === `/proc/${child.pid}/stat` && ++childStatReads === 2 && boundary === 'identity-recheck') throw procError(code);
				if (path === `/proc/${child.pid}/smaps_rollup` && boundary === 'smaps_rollup') throw procError(code);
				assert.notEqual(path, `/proc/${foreign.pid}/smaps_rollup`, 'foreign memory must never be read');
				return normal(path);
			});
			const result = await sampleMotionOwnedProcesses(root, [child]);
			assert.deepEqual(result.processes.map(value => value.identity), [root]);
			assert.equal(result.rssBytes, 8192); assert.equal(result.pssBytes, 4096);
		});
	}
}

test('Motion memory retains exact PID/start ownership when a task is replaced during its memory read', async context => {
	let reads = 0;
	procFixture(context, path => path === `/proc/${child.pid}/stat` && ++reads === 2 ? stat({ ...child, startTicks: '999' }) : normal(path));
	assert.deepEqual((await sampleMotionOwnedProcesses(root, [child])).processes.map(value => value.identity), [root]);
	assert.deepEqual((await sampleMotionOwnedProcesses({ ...root, startTicks: '999' }, [])).processes, []);
});

for (const code of ['EACCES', 'EPERM', 'EIO']) for (const boundary of ['stat', 'smaps_rollup']) {
	test(`Motion /proc ${boundary} still rejects ${code}`, async context => {
		const error = procError(code);
		procFixture(context, path => { if (path === `/proc/${child.pid}/${boundary}`) throw error; return normal(path); });
		await assert.rejects(sampleMotionOwnedProcesses(root, []), actual => actual === error);
	});
}
for (const boundary of ['stat', 'smaps_rollup']) {
	test(`Motion /proc ${boundary} still refuses malformed observations`, async context => {
		procFixture(context, path => path === `/proc/${child.pid}/${boundary}` ? 'malformed' : normal(path));
		await assert.rejects(sampleMotionOwnedProcesses(root, []), /Invalid Linux process stat|Missing or invalid Linux RSS\/PSS/);
	});
}
test('Motion required identity and proc-directory failures are not converted into successful empty observations', async context => {
	const error = procError('ESRCH');
	procFixture(context, () => { throw error; });
	await assert.rejects(readMotionProcessIdentity(root.pid), actual => actual === error);
	context.mock.method(fs.promises, 'readdir', () => Promise.reject(error)); syncBuiltinESMExports();
	await assert.rejects(sampleMotionOwnedProcesses(root, []), actual => actual === error);
});
test('Motion sampling still refuses a required owner that vanished before its memory observation', async context => {
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-proc-owner-'));
	try {
		procFixture(context, path => { if (path === `/proc/${root.pid}/smaps_rollup`) throw procError('ESRCH'); return normal(path); });
		await assert.rejects(startMotionSustainedSampler({ phase: 'synthetic', owner: root, logPath: join(directory, 'memory.jsonl'),
			cdp: { sample: () => { throw new Error('Telemetry must not run after lost owner'); } }, progress: () => Promise.resolve(0),
		}), /Active sustained owner disappeared or was replaced/);
	} finally { restore(context); await fs.promises.rm(directory, { recursive: true, force: true }); }
});
test('Motion process enumeration still enforces the fixed census admission', async context => {
	procFixture(context, normal, Array.from({ length: 65537 }, (_, index) => String(index + 1)));
	await assert.rejects(sampleMotionOwnedProcesses(root, []), /Process enumeration exceeds/);
});

interface Receipt {
	code: number | null; signal: string | null; failure: string | null; closureObserved: boolean;
	owner: { pid: number; startTicks: string } | null; signals: unknown[];
	survivingProcesses: unknown[]; unreapedZombies: unknown[]; cleanupErrors: string[];
}
for (const injected of ['ENOENT', 'ESRCH', 'EPERM', 'EACCES', 'malformed']) {
	test(`Motion command census handles ${injected} without changing actual child closure authority`, async context => {
		const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-proc-command-'));
		const read = fs.promises.readFile, readdir = fs.promises.readdir; let injectedReads = 0;
		try {
			context.mock.method(fs.promises, 'readdir', async (path: fs.PathLike) => {
				const names = await readdir(path); return path === '/proc' ? [...names, '90000000'] : names;
			});
			context.mock.method(fs.promises, 'readFile', (path: fs.PathLike) => {
				if (path === '/proc/90000000/stat') {
					injectedReads++; return injected === 'malformed' ? Promise.resolve('bad stat') : Promise.reject(procError(injected));
				}
				return read(path, 'utf8');
			});
			syncBuiltinESMExports();
			const run = motionSustainedCommand({ command: process.execPath, args: ['-e', 'setTimeout(()=>{},100)'], cwd: directory, directory, id: 'race' });
			if (injected === 'ENOENT' || injected === 'ESRCH') await run;
			else await assert.rejects(run, /Qualification command failed/);
			const receipt = JSON.parse(await read(join(directory, 'race-command.json'), 'utf8')) as Receipt;
			assert.ok(injectedReads > 0); assert.ok(receipt.owner); assert.equal(receipt.closureObserved, true);
			assert.deepEqual(receipt.survivingProcesses, []); assert.deepEqual(receipt.unreapedZombies, []); assert.deepEqual(receipt.cleanupErrors, []);
			if (injected === 'ENOENT' || injected === 'ESRCH') {
				assert.equal(receipt.code, 0); assert.equal(receipt.signal, null); assert.equal(receipt.failure, null); assert.deepEqual(receipt.signals, []);
			} else assert.match(receipt.failure ?? '', /Command ownership observation failed:.*(?:EPERM|EACCES|Invalid Linux process stat)/);
		} finally { restore(context); await fs.promises.rm(directory, { recursive: true, force: true }); }
	});
}
test('Motion command cannot acquire a vanished root identity even when ESRCH is transient', async context => {
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-proc-admission-'));
	const readSync = fs.readFileSync;
	try {
		context.mock.method(fs, 'readFileSync', (path: fs.PathOrFileDescriptor) => {
			if (typeof path === 'string' && /^\/proc\/\d+\/stat$/u.test(path)) throw procError('ESRCH');
			return readSync(path, 'utf8');
		}); syncBuiltinESMExports();
		await assert.rejects(motionSustainedCommand({ command: process.execPath, args: ['-e', 'setTimeout(()=>{},100)'], cwd: directory, directory, id: 'admission' }), /Qualification command failed/);
		restore(context);
		const receipt = JSON.parse(await fs.promises.readFile(join(directory, 'admission-command.json'), 'utf8')) as Receipt;
		assert.equal(receipt.owner, null); assert.equal(receipt.closureObserved, true);
		assert.match(receipt.failure ?? '', /Owned command exited before process identity admission/);
		assert.deepEqual(receipt.survivingProcesses, []);
	} finally { restore(context); await fs.promises.rm(directory, { recursive: true, force: true }); }
});

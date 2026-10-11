/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { pbkdf2 } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';

interface Identity { pid: number; startTicks: string }
interface Receipt {
	code: number | null; signal: string | null; failure: string | null; closureObserved: boolean;
	owner: Identity | null; ownedProcesses: Identity[]; survivingProcesses: Identity[];
	signals: { identity: Identity; signal: string }[]; stdout: string; stderr: string;
}
async function live(identity: Identity): Promise<boolean> {
	try {
		const stat = await readFile(`/proc/${identity.pid}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
		return fields[19] === identity.startTicks && fields[0] !== 'Z' && fields[0] !== 'X';
	} catch (error) { if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return false; throw error; }
}
async function removeSyntheticChild(path: string) {
	try {
		const identity = JSON.parse(await readFile(path, 'utf8')) as Identity;
		if (await live(identity)) process.kill(identity.pid, 'SIGKILL');
	} catch (error) { if (!(error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT')) throw error; }
}
const descendant = `const fs=require('node:fs'); const fields=fs.readFileSync('/proc/self/stat','utf8').split(') ')[1].trim().split(/\\s+/); fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,startTicks:fields[19]})); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); setTimeout(()=>process.exit(0),15000);`;
const parent = `require('node:child_process').spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{stdio:'ignore'}); setInterval(()=>{},1000);`;

test('Motionscaper sustained command timeout removes owned resistant descendants and leaves a foreign sibling alive', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-command-')), childPath = join(directory, 'child.json');
	const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
	const foreignClosed = new Promise<void>(resolve => foreign.once('close', () => resolve()));
	try {
		await assert.rejects(motionSustainedCommand({ command: process.execPath, args: ['-e', parent, descendant, childPath], cwd: directory, directory, id: 'timeout', timeoutMs: 1200 }), /Qualification command failed/);
		const identity = JSON.parse(await readFile(childPath, 'utf8')) as Identity;
		assert.equal(await live(identity), false, 'the compiler-style descendant must be gone before rejection');
		assert.ok(foreign.pid); process.kill(foreign.pid, 0);
		const receipt = JSON.parse(await readFile(join(directory, 'timeout-command.json'), 'utf8')) as Receipt;
		assert.match(receipt.failure ?? '', /deadline/); assert.equal(receipt.closureObserved, true);
		assert.equal(receipt.code, null); assert.equal(receipt.signal, 'SIGTERM');
		assert.ok(receipt.ownedProcesses.some(value => value.pid === identity.pid && value.startTicks === identity.startTicks));
		assert.ok(receipt.signals.some(value => value.identity.pid === identity.pid && value.signal === 'SIGKILL'));
		assert.deepEqual(receipt.survivingProcesses, []);
		assert.ok(receipt.signals.every(value => value.identity.pid !== foreign.pid));
	} finally { await removeSyntheticChild(childPath); foreign.kill('SIGKILL'); await foreignClosed; await rm(directory, { recursive: true, force: true }); }
});

test('Motionscaper sustained command preserves actual nonzero and spawn failure closures', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-command-'));
	try {
		await assert.rejects(motionSustainedCommand({ command: process.execPath, args: ['-e', 'process.stderr.write("actual failure");process.exit(7)'], cwd: directory, directory, id: 'nonzero' }), /Qualification command failed/);
		const nonzero = JSON.parse(await readFile(join(directory, 'nonzero-command.json'), 'utf8')) as Receipt;
		assert.equal(nonzero.code, 7); assert.equal(nonzero.signal, null); assert.equal(nonzero.stderr, 'actual failure'); assert.equal(nonzero.closureObserved, true);
		await assert.rejects(motionSustainedCommand({ command: join(directory, 'missing-executable'), args: [], cwd: directory, directory, id: 'spawn' }), /Qualification command failed/);
		const failed = JSON.parse(await readFile(join(directory, 'spawn-command.json'), 'utf8')) as Receipt;
		assert.match(failed.failure ?? '', /ENOENT/); assert.equal(failed.closureObserved, true); assert.deepEqual(failed.ownedProcesses, []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('Motionscaper sustained command admits an actual successful closure without signals', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-command-'));
	try {
		const result = await motionSustainedCommand({ command: process.execPath, args: ['-e', 'process.stdout.write("bounded success")'], cwd: directory, directory, id: 'success' });
		const receipt = JSON.parse(await readFile(result.receipt.path, 'utf8')) as Receipt;
		assert.equal(result.stdout, 'bounded success'); assert.equal(receipt.code, 0); assert.equal(receipt.signal, null);
		assert.equal(receipt.closureObserved, true); assert.deepEqual(receipt.signals, []); assert.deepEqual(receipt.survivingProcesses, []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('Motionscaper sustained command rejects a successful parent that abandons a live descendant', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-command-')), childPath = join(directory, 'orphan.json');
	try {
		const source = parent.replace('setInterval(()=>{},1000);', 'setTimeout(()=>process.exit(0),200);');
		await assert.rejects(motionSustainedCommand({ command: process.execPath, args: ['-e', source, descendant, childPath], cwd: directory, directory, id: 'orphan', timeoutMs: 4000 }), /Qualification command failed/);
		const identity = JSON.parse(await readFile(childPath, 'utf8')) as Identity;
		const receipt = JSON.parse(await readFile(join(directory, 'orphan-command.json'), 'utf8')) as Receipt;
		assert.equal(await live(identity), false); assert.equal(receipt.code, 0); assert.equal(receipt.signal, null);
		assert.equal(receipt.closureObserved, true); assert.match(receipt.failure ?? '', /live owned descendants/);
		assert.deepEqual(receipt.survivingProcesses, []);
	} finally { await removeSyntheticChild(childPath); await rm(directory, { recursive: true, force: true }); }
});

test('Motionscaper sustained command retains output admission failure while cleaning descendants', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-command-')), childPath = join(directory, 'overflow.json');
	try {
		const source = `${parent}setTimeout(()=>process.stdout.write(Buffer.alloc(70000,65)),250);`;
		await assert.rejects(motionSustainedCommand({ command: process.execPath, args: ['-e', source, descendant, childPath], cwd: directory, directory, id: 'overflow', timeoutMs: 4000 }), /Qualification command failed/);
		const identity = JSON.parse(await readFile(childPath, 'utf8')) as Identity;
		const receipt = JSON.parse(await readFile(join(directory, 'overflow-command.json'), 'utf8')) as Receipt;
		assert.equal(await live(identity), false); assert.match(receipt.failure ?? '', /output exceeds64KiB/);
		assert.equal(receipt.closureObserved, true); assert.ok(Buffer.byteLength(receipt.stdout) <= 65536);
		assert.deepEqual(receipt.survivingProcesses, []);
	} finally { await removeSyntheticChild(childPath); await rm(directory, { recursive: true, force: true }); }
});


test('Motionscaper sustained command admits a fast real identity despite asynchronous file-I/O contention', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-command-fast-'));
	// Queue fixed work on the file-I/O pool; the command itself remains an unchanged fast Node executable.
	const occupied = Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
		pbkdf2('fixed synthetic input', 'fixed synthetic salt', 500000, 32, 'sha256', error => error ? reject(error) : resolve());
	}));
	try {
		const result = await motionSustainedCommand({ command: process.execPath, args: ['--version'], cwd: directory, directory, id: 'fast', timeoutMs: 5000 });
		const receipt = JSON.parse(await readFile(result.receipt.path, 'utf8')) as Receipt;
		assert.equal(result.stdout, `${process.version}\n`); assert.equal(receipt.code, 0); assert.equal(receipt.signal, null);
		assert.equal(receipt.closureObserved, true); assert.equal(receipt.failure, null); assert.ok(receipt.owner);
		assert.ok(receipt.ownedProcesses.some(value => value.pid === receipt.owner!.pid && value.startTicks === receipt.owner!.startTicks));
		assert.deepEqual(receipt.signals, []); assert.deepEqual(receipt.survivingProcesses, []);
	} finally { await Promise.all(occupied); await rm(directory, { recursive: true, force: true }); }
});

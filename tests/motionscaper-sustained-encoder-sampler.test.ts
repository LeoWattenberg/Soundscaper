/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { readMotionProcessIdentity } from '../scripts/performance/motionscaper-sustained-observation.ts';
import { sampleMotionSustainedEncoder, startMotionSustainedEncoderSampler } from '../scripts/performance/motionscaper-sustained-encoder-sampler.ts';

const owner = { pid: 700001, parentPid: 1, startTicks: '101' }, helper = { pid: 700002, parentPid: owner.pid, startTicks: '102' };
const secondHelper = { ...helper, pid: 700004, startTicks: '104' };
const helperPath = '/qualified/motionscaper-media-host';
const command = `${helperPath}\0--encode-prores-4444-pcm-v1\0input\0output\0`;
function stat(identity = owner): string {
	return `${identity.pid} (actual identity) S ${identity.parentPid} 1 1 ${Array<string>(15).fill('0').join(' ')} ${identity.startTicks}\n`;
}
const memory = 'Rss: 8 kB\nPss: 4 kB\n';
function fixture(context: TestContext, change: (path: string, original: string) => string | Promise<string> = (_path, original) => original,
	options: Readonly<{ tasks?: readonly string[]; executable?: string }> = {}) {
	const read = fs.promises.readFile, readdir = fs.promises.readdir, readlink = fs.promises.readlink;
	context.mock.method(fs.promises, 'readFile', (path: fs.PathLike) => {
		const values: Record<string, string> = { [`/proc/${owner.pid}/stat`]: stat(), [`/proc/${helper.pid}/stat`]: stat(helper),
			[`/proc/${owner.pid}/task/${owner.pid}/children`]: '', [`/proc/${owner.pid}/task/700003/children`]: `${helper.pid} `,
			[`/proc/${helper.pid}/cmdline`]: command, [`/proc/${helper.pid}/smaps_rollup`]: memory,
			[`/proc/${secondHelper.pid}/stat`]: stat(secondHelper), [`/proc/${secondHelper.pid}/cmdline`]: command };
		if (typeof path === 'string' && path.startsWith('/proc/')) {
			assert.ok(Object.hasOwn(values, path), `Unexpected process read: ${path}`);
			return Promise.resolve().then(() => change(path, values[path]!));
		}
		return read(path, 'utf8');
	});
	context.mock.method(fs.promises, 'readdir', (path: fs.PathLike) => {
		if (path === `/proc/${owner.pid}/task`) return Promise.resolve(options.tasks ?? [String(owner.pid), '700003']);
		assert.notEqual(path, '/proc', 'encoder observation must not scan the global process table'); return readdir(path);
	});
	context.mock.method(fs.promises, 'readlink', (path: fs.PathLike) => [helper, secondHelper].some(value => path === `/proc/${value.pid}/exe`) ? Promise.resolve(options.executable ?? helperPath) : readlink(path));
	syncBuiltinESMExports(); context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
}
test('Motion encoder sample proves nonleader-thread fork ownership and real memory with two identity checks', async context => {
	const reads: string[] = []; fixture(context, (path, text) => { reads.push(path); return text; });
	const retained: number[] = [];
	const result = await sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: values => retained.push(...values.map(value => value.pid)) });
	assert.equal(result.length, 1); assert.deepEqual(result[0]!.identity, helper); assert.deepEqual(result[0]!.parentTaskIds, [700003]);
	assert.equal(result[0]!.rssBytes, 8192); assert.equal(result[0]!.pssBytes, 4096); assert.equal(result[0]!.command, command);
	assert.ok(retained.includes(helper.pid)); assert.ok(reads.filter(path => path === `/proc/${helper.pid}/stat`).length >= 2);
	assert.ok(reads.filter(path => path === `/proc/${owner.pid}/stat`).length >= 2);
});
test('Motion encoder sample does not fabricate memory when a legitimately discovered child exits', async context => {
	fixture(context, (path, text) => { if (path.endsWith('/smaps_rollup')) throw Object.assign(new Error('exited'), { code: 'ESRCH' }); return text; });
	const retained: number[] = [];
	assert.deepEqual(await sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: values => retained.push(...values.map(value => value.pid)) }), []);
	assert.ok(retained.includes(helper.pid));
});
test('Motion encoder sample refuses concurrent encoders', async context => {
	fixture(context, (path, value) => path.endsWith('/700003/children') ? `${helper.pid} ${secondHelper.pid}` : value);
	await assert.rejects(sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: () => undefined }), /Concurrent native encoders/);
});
test('Motion encoder sample refuses excess thread admission', async context => {
	fixture(context, undefined, { tasks: Array.from({ length: 257 }, (_, index) => String(owner.pid + index)) });
	await assert.rejects(sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: () => undefined }), /enumeration exceeds admission/);
});
test('Motion encoder sample refuses excess child admission', async context => {
	fixture(context, (path, value) => path.endsWith('/children') ? Array.from({ length: 65 }, (_, index) => String(helper.pid + index)).join(' ') : value);
	await assert.rejects(sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: () => undefined }), /enumeration exceeds admission/);
});
test('Motion encoder sample admits only a complete mode argument', async context => {
	fixture(context, (path, value) => path.endsWith('/cmdline') ? value.replace('pcm-v1', 'pcm-v1-foreign') : value);
	assert.deepEqual(await sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: () => undefined }), []);
});
test('Motion encoder sample requires the exact executable identity', async context => {
	fixture(context, undefined, { executable: '/foreign/helper' });
	await assert.rejects(sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: () => undefined }), /executable identity changed/);
});
test('Motion encoder sampler does not pad a short lifetime with final or cached observations', async context => {
	fixture(context); const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-encoder-short-'));
	try {
		const sampler = await startMotionSustainedEncoderSampler({ owner, helperPath, retainProcesses: () => undefined, logPath: join(directory, 'encoder.jsonl') });
		await assert.rejects(sampler.stop(), /lacks three real/);
		const rows = (await fs.promises.readFile(join(directory, 'encoder.jsonl'), 'utf8')).trim().split('\n');
		assert.equal(rows.length, 1);
	} finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});
for (const boundary of ['owner', 'helper', 'parent', 'memory', 'argv']) test(`Motion encoder sample rejects changed ${boundary} authority`, async context => {
	let ownerReads = 0, helperReads = 0, commandReads = 0;
	fixture(context, (path, text) => {
		if (path === `/proc/${owner.pid}/stat` && ++ownerReads === 2 && boundary === 'owner') return stat({ ...owner, startTicks: '999' });
		if (path === `/proc/${helper.pid}/stat` && ++helperReads === 2 && boundary === 'helper') return stat({ ...helper, startTicks: '999' });
		if (path === `/proc/${helper.pid}/stat` && boundary === 'parent') return stat({ ...helper, parentPid: 2 });
		if (path.endsWith('/smaps_rollup') && boundary === 'memory') throw Object.assign(new Error('denied'), { code: 'EACCES' });
		if (path.endsWith('/cmdline') && ++commandReads === 2 && boundary === 'argv') return command.replace('input', 'changed');
		return text;
	});
	await assert.rejects(sampleMotionSustainedEncoder({ owner, helperPath, retainProcesses: () => undefined }), /changed|parent|denied/u);
});
test('Motion encoder sampler stop awaits an in-flight memory read and retains its failure', async context => {
	let release!: () => void, entered!: () => void, reads = 0;
	const pending = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
	fixture(context, async (path, text) => { if (path.endsWith('/smaps_rollup') && ++reads === 2) { entered(); await pending; throw new Error('pending memory failure'); } return text; });
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-encoder-stop-'));
	try {
		const sampler = await startMotionSustainedEncoderSampler({ owner, helperPath, retainProcesses: () => undefined, logPath: join(directory, 'encoder.jsonl') });
		await started; let settled = false; const stopping = sampler.stop().finally(() => { settled = true; }); void stopping.catch(() => undefined);
		await Promise.resolve(); assert.equal(settled, false); release();
		await assert.rejects(stopping, /pending memory failure/); await assert.rejects(sampler.failed, /pending memory failure/);
	} finally { release(); await fs.promises.rm(directory, { recursive: true, force: true }); }
});
test('Motion encoder sampler refuses a replacement helper between independent samples', async context => {
	let reads = 0;
	fixture(context, (path, value) => path === `/proc/${helper.pid}/stat` && ++reads > 2 ? stat({ ...helper, startTicks: '999' }) : value);
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-encoder-reused-'));
	try {
		const sampler = await startMotionSustainedEncoderSampler({ owner, helperPath, retainProcesses: () => undefined, logPath: join(directory, 'encoder.jsonl') });
		await assert.rejects(sampler.failed, /PID\/start identity changed/);
		await assert.rejects(sampler.stop(), /PID\/start identity changed/);
	} finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});
test('Motion encoder sampler observes a real short child forked by a nonleader thread without slowing it', async () => {
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-encoder-real-')), actualOwner = await readMotionProcessIdentity(process.pid);
	let worker: Worker | undefined;
	const sampler = await startMotionSustainedEncoderSampler({ owner: actualOwner, helperPath: process.execPath, retainProcesses: () => undefined, logPath: join(directory, 'encoder.jsonl') });
	try {
		worker = new Worker(`const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['--eval','setTimeout(()=>{},400)','--','--encode-prores-4444-pcm-v1'],{stdio:'ignore'}); child.once('error',e=>{throw e}); child.once('close',(code,signal)=>{if(code!==0||signal!==null)throw Error('Unexpected synthetic child closure')});`, { eval: true });
		const closed = new Promise<void>((resolve, reject) => { worker!.once('error', reject); worker!.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`))); });
		await closed; const result = await sampler.stop();
		assert.ok(result.observations.length >= 3); assert.equal(result.attemptedPeriodMs, 25);
		assert.ok(result.observations.every(row => row.helpers[0]!.parentTaskIds.some(tid => tid !== actualOwner.pid)));
		assert.ok(result.observations.every(row => row.helpers[0]!.rssBytes > 0 && row.helpers[0]!.pssBytes > 0));
		assert.ok(result.observations.every((row, index, all) => !index || row.monotonicMs > all[index - 1]!.monotonicMs));
	} finally { await sampler.stop().catch(() => undefined); await worker?.terminate(); await fs.promises.rm(directory, { recursive: true, force: true }); }
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { startMotionSustainedSampler } from '../scripts/performance/motionscaper-sustained-sampler.ts';
import type { MotionSustainedTelemetry } from '../scripts/performance/motionscaper-sustained-cdp.ts';
import type { MotionOwnedMemorySample } from '../scripts/performance/motionscaper-sustained-observation.ts';
import type { MotionSustainedMemorySample } from '../scripts/performance/motionscaper-sustained-plan.ts';

const MIB = 1024 * 1024;
const owner = { pid: 700001, parentPid: 1, startTicks: '101' };
const child = { pid: 700002, parentPid: owner.pid, startTicks: '102' };
interface Memory { readonly rssBytes: number; readonly pssBytes: number }
interface Violation { readonly cap: string; readonly actualBytes: number; readonly maximumBytes: number; readonly index?: number }
interface Row {
	readonly phase: string; readonly memory: MotionOwnedMemorySample;
	readonly targets: readonly MotionSustainedTelemetry[]; readonly summary: MotionSustainedMemorySample;
	readonly rejection?: Readonly<{ message: string; violations: readonly Violation[] }>;
}
function procFixture(context: TestContext, memory: readonly [Memory, Memory]): void {
	const read = fs.promises.readFile, readdir = fs.promises.readdir;
	context.mock.method(fs.promises, 'readdir', (path: fs.PathLike) => path === '/proc'
		? Promise.resolve([String(owner.pid), String(child.pid)]) : readdir(path));
	context.mock.method(fs.promises, 'readFile', (path: fs.PathLike) => {
		for (const [index, identity] of [owner, child].entries()) {
			if (path === `/proc/${identity.pid}/stat`) {
				const fields = ['S', String(identity.parentPid), String(owner.pid), String(owner.pid), ...Array<string>(15).fill('0'), identity.startTicks];
				return Promise.resolve(`${identity.pid} (synthetic process) ${fields.join(' ')}\n`);
			}
			if (path === `/proc/${identity.pid}/smaps_rollup`) return Promise.resolve(`Rss: ${memory[index]!.rssBytes / 1024} kB\nPss: ${memory[index]!.pssBytes / 1024} kB\n`);
		}
		return read(path, 'utf8');
	});
	syncBuiltinESMExports();
	context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
}
function target(patch: Partial<MotionSustainedTelemetry> = {}): MotionSustainedTelemetry {
	return { observedAt: new Date().toISOString(), monotonicMs: performance.now(), targetId: 'page', sessionId: 'page-session',
		type: 'page', url: 'about:blank', usedHeapBytes: 1, totalHeapBytes: 2, wasmCapacityBytes: [],
		workerName: '', workerFrames: 0, backend: null, revision: null, ...patch };
}
async function rows(path: string): Promise<readonly Row[]> {
	const text = (await fs.promises.readFile(path, 'utf8')).trim();
	return text ? text.split('\n').map(line => JSON.parse(line) as Row) : [];
}

test('Motion sampler retains the exact rejected process/isolate operands and every exceeded memory cap', async context => {
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-sampler-evidence-'));
	try {
		const memory = [{ rssBytes: 1536 * MIB, pssBytes: 1024 * MIB }, { rssBytes: 768 * MIB, pssBytes: 640 * MIB }] as const;
		procFixture(context, memory);
		let observed: readonly MotionSustainedTelemetry[] = [], retained: unknown;
		const path = join(directory, 'memory.jsonl');
		await assert.rejects(startMotionSustainedSampler({ phase: 'synthetic-memory-refusal', owner, logPath: path,
			cdp: { sample: () => {
				observed = [target({ usedHeapBytes: 512 * MIB + 1, totalHeapBytes: 1024 * MIB }),
					target({ type: 'worker', targetId: 'worker', sessionId: 'worker-session', usedHeapBytes: 16 * MIB,
						workerName: 'motionscaper-composition-preview', totalHeapBytes: 32 * MIB, wasmCapacityBytes: [32 * MIB, 256 * MIB + 65536] })];
				return Promise.resolve(observed);
			} }, progress: () => Promise.resolve(0), retainProcesses: values => { retained = values; },
		}), { message: 'Declared memory ceiling exceeded.' });
		const recorded = await rows(path);
		assert.equal(recorded.length, 1, 'The refusing sample must be retained before its original cap error escapes.');
		const row = recorded[0]!;
		assert.equal(row.phase, 'synthetic-memory-refusal');
		assert.deepEqual(retained, [owner, child]);
		assert.deepEqual(row.memory.processes, memory.map((value, index) => ({ identity: [owner, child][index], ...value })));
		assert.equal(row.memory.rssBytes, 2304 * MIB); assert.equal(row.memory.pssBytes, 1664 * MIB);
		assert.deepEqual(row.targets, observed);
		assert.equal(row.summary.completedFrames, 0); assert.equal(row.summary.telemetrySequence, 1);
		assert.deepEqual(row.summary.isolateUsedHeapBytes, [512 * MIB + 1, 16 * MIB]);
		assert.deepEqual(row.summary.isolateTotalHeapBytes, [1024 * MIB, 32 * MIB]);
		assert.deepEqual(row.summary.wasmCapacityBytes, [32 * MIB, 256 * MIB + 65536]);
		assert.deepEqual(row.rejection, { message: 'Declared memory ceiling exceeded.', violations: [
			{ cap: 'maximumRssBytes', actualBytes: 2304 * MIB, maximumBytes: 2048 * MIB },
			{ cap: 'maximumPssBytes', actualBytes: 1664 * MIB, maximumBytes: 1536 * MIB },
			{ cap: 'maximumIsolateHeapBytes', actualBytes: 512 * MIB + 1, maximumBytes: 512 * MIB, index: 0 },
			{ cap: 'maximumWasmCapacityBytes', actualBytes: 256 * MIB + 65536, maximumBytes: 256 * MIB, index: 1 },
		] });
		assert.ok(Buffer.byteLength(JSON.stringify(row)) < 65536, 'This bounded two-process/two-isolate witness needs no large allocation.');
	} finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});

test('Motion sampler accepts equality at every original memory ceiling without changing accepted row fields', async context => {
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-sampler-boundary-'));
	try {
		procFixture(context, [{ rssBytes: 1536 * MIB, pssBytes: 1024 * MIB }, { rssBytes: 512 * MIB, pssBytes: 512 * MIB }]);
		const path = join(directory, 'memory.jsonl');
		const sampler = await startMotionSustainedSampler({ phase: 'synthetic-equality', owner, logPath: path,
			cdp: { sample: () => Promise.resolve([target({ usedHeapBytes: 512 * MIB, totalHeapBytes: 1024 * MIB, wasmCapacityBytes: [256 * MIB] })]) },
			progress: () => Promise.resolve(0) });
		const measured = await sampler.stop();
		assert.equal(measured.samples.length, 2); assert.deepEqual(measured.processIdentities, [owner, child]);
		for (const row of await rows(path)) {
			assert.deepEqual(Object.keys(row), ['phase', 'memory', 'targets', 'summary']);
			assert.equal(row.summary.rssBytes, 2048 * MIB); assert.equal(row.summary.pssBytes, 1536 * MIB);
			assert.deepEqual(row.summary.isolateUsedHeapBytes, [512 * MIB]);
			assert.deepEqual(row.summary.wasmCapacityBytes, [256 * MIB]);
		}
	} finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});

test('Motion sampler stop retains one in-flight rejecting row and the same terminal refusal', async context => {
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-sampler-terminal-'));
	try {
		procFixture(context, [{ rssBytes: 8192, pssBytes: 4096 }, { rssBytes: 8192, pssBytes: 4096 }]);
		let calls = 0, entered!: () => void, release!: (targets: readonly MotionSustainedTelemetry[]) => void;
		const inFlight = new Promise<void>(resolve => { entered = resolve; });
		const observation = new Promise<readonly MotionSustainedTelemetry[]>(resolve => { release = resolve; });
		const path = join(directory, 'memory.jsonl');
		const sampler = await startMotionSustainedSampler({ phase: 'synthetic-in-flight', owner, logPath: path,
			cdp: { sample: () => { if (++calls === 1) return Promise.resolve([target()]); entered(); return observation; } },
			progress: () => Promise.resolve(0) });
		await inFlight;
		const stopped = sampler.stop(); void stopped.catch(() => undefined);
		release([target({ usedHeapBytes: 512 * MIB + 1, totalHeapBytes: 1024 * MIB })]);
		let refusal: unknown;
		await assert.rejects(sampler.failed, error => {
			assert.ok(error instanceof Error); assert.equal(error.message, 'Declared memory ceiling exceeded.'); refusal = error; return true;
		});
		const recorded = await rows(path);
		assert.equal(recorded.length, 2, 'One accepted prefix and the rejecting row must be durable before failed rejects.');
		assert.equal(recorded[0]!.rejection, undefined); assert.ok(recorded[1]!.rejection);
		assert.deepEqual(recorded.map(row => row.summary.telemetrySequence), [1, 2]);
		assert.equal(calls, 2, 'Stopping must not resample or retry a terminal refusal.');
		assert.throws(() => sampler.assertHealthy(), error => error === refusal);
		await assert.rejects(stopped, error => error === refusal); assert.equal(sampler.stop(), stopped);
	} finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});

for (const boundary of ['write', 'sync', 'short-write'] as const) test(`Motion sampler keeps its cap refusal and bounded incomplete evidence on ${boundary} failure`, async context => {
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-sampler-io-'));
	try {
		procFixture(context, [{ rssBytes: 8192, pssBytes: 4096 }, { rssBytes: 8192, pssBytes: 4096 }]);
		const open = fs.promises.open, path = join(directory, 'memory.jsonl');
		const injected = new Error(`Synthetic ${boundary} failure: ${'x'.repeat(10000)}`);
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		context.mock.method(fs.promises, 'open', async (name: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
			const output = await open(name, flags, mode);
			if (name === path) {
				handle = output;
				if (boundary === 'write') context.mock.method(output, 'write', () => Promise.reject(injected));
				else if (boundary === 'sync') context.mock.method(output, 'sync', () => Promise.reject(injected));
				else {
					const write = output.write.bind(output);
					context.mock.method(output, 'write', () => write(Buffer.from('{')));
				}
			}
			return output;
		});
		syncBuiltinESMExports();
		await assert.rejects(startMotionSustainedSampler({ phase: 'synthetic-evidence-io', owner, logPath: path,
			cdp: { sample: () => Promise.resolve([target({ usedHeapBytes: 512 * MIB + 1, totalHeapBytes: 1024 * MIB })]) },
			progress: () => Promise.resolve(0) }), error => {
			assert.ok(error instanceof Error); assert.equal(error.message, 'Declared memory ceiling exceeded.'); assert.notEqual(error, injected);
			const evidence = Reflect.get(error, 'memoryEvidence') as { complete: boolean; logPath: string; operation: string; error: string; errorTruncated: boolean };
			assert.equal(evidence.complete, false); assert.equal(evidence.logPath, path);
			assert.equal(evidence.operation, boundary === 'sync' ? 'sync' : 'write');
			assert.equal(evidence.errorTruncated, boundary !== 'short-write');
			if (boundary === 'short-write') assert.match(evidence.error, /write was incomplete/u);
			else { assert.equal(evidence.error.length, 512); assert.ok(evidence.error.startsWith(`Error: Synthetic ${boundary} failure:`)); }
			assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 2048);
			return true;
		});
		assert.equal(handle?.fd, -1, 'The original sampler cleanup still closes its owned output handle.');
		if (boundary === 'short-write') assert.equal(await fs.promises.readFile(path, 'utf8'), '{');
	} finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});

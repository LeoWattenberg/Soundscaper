/* SPDX-License-Identifier: AGPL-3.0-only */
import { open, readFile, readdir, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';
import { parseMotionProcessMemory, parseMotionProcessStat, type MotionProcessIdentity } from './motionscaper-sustained-process.ts';

interface EncoderOptions {
	readonly owner: MotionProcessIdentity; readonly helperPath: string;
	retainProcesses(values: readonly MotionProcessIdentity[]): void;
}
export interface MotionSustainedEncoderMemory {
	readonly identity: MotionProcessIdentity; readonly parentTaskIds: readonly number[];
	readonly command: string; readonly executable: string; readonly rssBytes: number; readonly pssBytes: number;
	readonly readStartedMs: number; readonly monotonicMs: number;
}
interface EncoderObservation { readonly monotonicMs: number; readonly helpers: readonly MotionSustainedEncoderMemory[] }
const missing = (error: unknown) => error && typeof error === 'object' && ['ENOENT', 'ESRCH'].includes(String(Reflect.get(error, 'code')));
const same = (a: MotionProcessIdentity, b: MotionProcessIdentity) => a.pid === b.pid && a.startTicks === b.startTicks;
async function text(path: string): Promise<string> {
	const value = await readFile(path, 'utf8');
	if (Buffer.byteLength(value) > 65536) throw new Error('Encoder process observation exceeds64KiB.');
	return value;
}
async function identity(pid: number) { return parseMotionProcessStat(await text(`/proc/${pid}/stat`)); }
async function processState(pid: number) {
	const readStartedMs = performance.now(), value = await text(`/proc/${pid}/stat`);
	return { identity: parseMotionProcessStat(value), state: value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/u)[0]!,
		stat: signature(value), readStartedMs, readEndedMs: performance.now() };
}
function signature(value: string) {
	return { byteLength: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') };
}
const terminal = (state: string) => state === 'Z' || state === 'X';
function ids(value: string, maximum: number): number[] {
	const fields = value.trim() ? value.trim().split(/\s+/u) : [];
	if (fields.length > maximum || fields.some(field => !/^[1-9]\d*$/u.test(field) || !Number.isSafeInteger(Number(field)))) throw new Error('Encoder process enumeration exceeds admission.');
	return [...new Set(fields.map(Number))];
}
async function requireOwner(owner: MotionProcessIdentity) {
	if (!same(await identity(owner.pid), owner)) throw new Error('Encoder application owner identity changed.');
}
/** A fork belongs to a particular parent thread. Union every current thread's child list;
 * the process PPID/start checks still decide authority, never the directory entry alone. */
export async function sampleMotionSustainedEncoder(options: EncoderOptions): Promise<readonly MotionSustainedEncoderMemory[]> {
	await requireOwner(options.owner);
	const tasks = ids((await readdir(`/proc/${options.owner.pid}/task`)).join(' '), 256);
	if (!tasks.includes(options.owner.pid)) throw new Error('Encoder application main thread disappeared.');
	const children = new Map<number, number[]>();
	for (const tid of tasks) {
		try {
			for (const pid of ids(await text(`/proc/${options.owner.pid}/task/${tid}/children`), plan.maximumOwnedProcesses)) {
				const parents = children.get(pid) ?? []; parents.push(tid); children.set(pid, parents);
			}
		} catch (error) { if (!missing(error)) throw error; }
	}
	if (children.size > plan.maximumOwnedProcesses) throw new Error('Encoder direct-child count exceeds admission.');
	const candidates: { identity: MotionProcessIdentity; command: string; executable: string; parentTaskIds: readonly number[]; before: Awaited<ReturnType<typeof processState>> }[] = [];
	for (const [pid, parentTaskIds] of children) {
		try {
			const before = await processState(pid), found = before.identity;
			if (found.pid !== pid || found.parentPid !== options.owner.pid) throw new Error('Encoder direct-child parent identity changed.');
			options.retainProcesses([found]);
			const command = await text(`/proc/${pid}/cmdline`), argv = command.split('\0');
			if (argv[0] !== options.helperPath || !argv.some(value => value === '--encode-prores-4444-v1' || value === '--encode-prores-4444-pcm-v1')) continue;
			const executable = await readlink(`/proc/${pid}/exe`);
			if (executable !== options.helperPath) throw new Error('Encoder executable identity changed.');
			candidates.push({ identity: found, command, executable, parentTaskIds, before });
		} catch (error) { if (!missing(error)) throw error; }
	}
	if (candidates.length > 1) throw new Error('Concurrent native encoders exceed admission.');
	const observed: MotionSustainedEncoderMemory[] = [];
	for (const candidate of candidates) {
		try {
			const pid = candidate.identity.pid, readStartedMs = performance.now();
			const memory = parseMotionProcessMemory(await text(`/proc/${pid}/smaps_rollup`));
			if (memory.rssBytes > plan.maximumNativeHelperRssBytes || memory.pssBytes > plan.maximumNativeHelperPssBytes || memory.pssBytes > memory.rssBytes) throw new Error('Actual encoder memory ceiling exceeded.');
			const [after, command, executable] = await Promise.all([processState(pid), text(`/proc/${pid}/cmdline`), readlink(`/proc/${pid}/exe`)]);
			const current = after.identity;
			const differences = [...(!same(current, candidate.identity) ? ['identity'] : []), ...(current.parentPid !== options.owner.pid ? ['parent'] : []),
				...(command !== candidate.command ? ['argv'] : []), ...(executable !== candidate.executable ? ['executable'] : [])];
			let confirmation: Awaited<ReturnType<typeof processState>> | undefined;
			// Linux clears a dying process's cmdline while the PID/start identity may remain as a zombie.
			// Discard that incomplete row only after terminal proof. A live mutation, nonempty argv,
			// changed executable/parent/identity or denied read remains a qualification failure.
			if (differences.length === 1 && differences[0] === 'argv' && command === '') {
				confirmation = terminal(after.state) ? after : await processState(pid);
				if (same(confirmation.identity, candidate.identity) && confirmation.identity.parentPid === options.owner.pid && terminal(confirmation.state)) continue;
			}
			if (differences.length) {
				const observation = { differences, before: candidate.before, after, confirmation,
					afterState: after.state, confirmationState: confirmation?.state ?? null,
					beforeCommand: signature(candidate.command), afterCommand: signature(command),
					beforeExecutable: signature(candidate.executable), afterExecutable: signature(executable), readStartedMs, refusedAtMs: performance.now() };
				throw Object.assign(new Error(`Encoder identity or argv changed during memory observation: ${JSON.stringify(observation)}`), { observation });
			}
			if (terminal(after.state)) continue;
			observed.push({ identity: candidate.identity, command, executable, parentTaskIds: candidate.parentTaskIds, ...memory, readStartedMs, monotonicMs: performance.now() });
		} catch (error) { if (!missing(error)) throw error; }
	}
	await requireOwner(options.owner);
	return observed;
}

/** Encoder-only cadence is independent of the unchanged100ms whole-application/CDP sampler.
 * No wait is added to the application; a short/missed lifetime remains unqualified. */
export async function startMotionSustainedEncoderSampler(options: EncoderOptions & Readonly<{ logPath: string }>) {
	const attemptedPeriodMs = 25, started = performance.now(), output = await open(options.logPath, 'wx', 0o600);
	const observations: EncoderObservation[] = [], interrupt = new AbortController();
	let stopping = false, failure: unknown, attempts = 0, lastAttemptMs = started, first: MotionProcessIdentity | undefined;
	let rejectFailure!: (error: unknown) => void;
	const failed = new Promise<never>((_, reject) => { rejectFailure = reject; }); void failed.catch(() => undefined);
	const sample = async () => {
		lastAttemptMs = performance.now();
		if (++attempts > Math.ceil(plan.maximumPhaseMs / attemptedPeriodMs) + 1 || performance.now() - started > plan.maximumPhaseMs) throw new Error('Encoder observation phase admission exceeded.');
		const helpers = await sampleMotionSustainedEncoder(options);
		if (!helpers.length) return;
		const current = helpers[0]!.identity;
		if (first && !same(first, current)) throw new Error('Encoder PID/start identity changed within phase.');
		first ??= current;
		if (observations.length >= plan.maximumSamples) throw new Error('Encoder observation count exceeds admission.');
		const row = { monotonicMs: helpers[0]!.monotonicMs, helpers };
		await output.write(`${JSON.stringify(row)}\n`); observations.push(row);
	};
	try { await sample(); } catch (error) { await output.close(); throw error; }
	const task = (async () => {
		try {
			while (!stopping) {
				const began = performance.now();
				try { await delay(Math.max(1, attemptedPeriodMs - (performance.now() - lastAttemptMs)), undefined, { signal: interrupt.signal }); }
				catch (error) { if (stopping && interrupt.signal.aborted && error instanceof Error && error.name === 'AbortError') break; throw error; }
				if (!stopping) await sample();
				if (performance.now() - began > plan.maximumSampleGapMs) throw new Error('Encoder observation cadence exceeded.');
			}
		} catch (error) { failure = error; rejectFailure(error); }
	})();
	let stopped: Promise<Readonly<{ attemptedPeriodMs: number; attempts: number; observations: readonly EncoderObservation[]; logPath: string }>> | undefined;
	const stop = async () => {
		stopping = true; interrupt.abort(); await task;
		try {
			if (failure) throw failure;
			await output.sync();
			if (observations.length < 3) throw new Error('Encoder phase lacks three real PID/start-bound observations.');
			return { attemptedPeriodMs, attempts, observations, logPath: options.logPath };
		} finally { await output.close(); }
	};
	return { failed, stop() { return stopped ??= stop(); } };
}

/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { hashMotionSustainedFile } from './motionscaper-sustained-observation.ts';
import { parseMotionProcessStat, selectMotionOwnedProcesses, type MotionProcessIdentity } from './motionscaper-sustained-process.ts';

interface ProcessState extends MotionProcessIdentity { readonly group: number; readonly session: number; readonly state: string }
interface StatFailure {
	readonly pid: number; readonly path: string; readonly observedAt: string; readonly message: string;
	readonly encoding: 'utf8-read-string'; readonly utf8ByteLength: number; readonly sha256: string;
	readonly capturedBase64: string; readonly truncated: boolean;
}
// A task may vanish after its /proc entry was opened, so Linux read can return ESRCH.
const missing = (error: unknown) => {
	const code: unknown = error && typeof error === 'object' ? Reflect.get(error, 'code') : null;
	return code === 'ENOENT' || code === 'ESRCH';
};
const key = (value: MotionProcessIdentity) => `${value.pid}:${value.startTicks}`;
const running = (value: ProcessState) => value.state !== 'Z' && value.state !== 'X';
function parseState(text: string): ProcessState {
	const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/u);
	const identity = parseMotionProcessStat(text), group = Number(fields[2]), session = Number(fields[3]);
	if (!Number.isSafeInteger(group) || !Number.isSafeInteger(session) || group < 0 || session < 0) throw new Error('Invalid command process group/session.');
	return { ...identity, group, session, state: fields[0]! };
}

/** Linux commands get their own session. Only authenticated PID/start identities are signalled;
 * orphaned session members remain owned after the direct child exits. No group-wide kill occurs. */
export async function motionSustainedCommand(options: Readonly<{
	command: string; args: readonly string[]; cwd: string; directory: string; id: string; env?: NodeJS.ProcessEnv; timeoutMs?: number;
}>) {
	if (process.platform !== 'linux') throw new Error('Sustained external command ownership requires Linux.');
	const timeoutMs = options.timeoutMs ?? 60000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('Invalid sustained command deadline.');
	const startedAt = new Date().toISOString(), started = performance.now();
	const child = spawn(options.command, [...options.args], { cwd: options.cwd, env: options.env ?? process.env,
		detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '', stderr = '', outputBytes = 0, cleanupStarted: number | null = null;
	let close: { code: number | null; signal: NodeJS.Signals | null; closedAt: string } | null = null, exited = false;
	const failures: string[] = [], cleanupErrors: string[] = [];
	const statFailures: StatFailure[] = []; let statFailureOverflow = false;
	const observedState = (pid: number, text: string) => {
		try { return parseState(text); }
		catch (error) {
			if (statFailures.length >= 16) statFailureOverflow = true;
			else {
				// Preserve the exact string consumed by the existing parser, not a later /proc reread.
				// This is evidence of a refused observation, never permission to skip its task.
				const bytes = Buffer.from(text, 'utf8');
				statFailures.push({ pid, path: `/proc/${pid}/stat`, observedAt: new Date().toISOString(),
					message: String(error).slice(0, 500), encoding: 'utf8-read-string', utf8ByteLength: bytes.length,
					sha256: createHash('sha256').update(bytes).digest('hex'),
					capturedBase64: bytes.subarray(0, 4096).toString('base64'), truncated: bytes.length > 4096 });
			}
			throw error;
		}
	};
	const readState = async (pid: number): Promise<ProcessState | null> => {
		try { return observedState(pid, await readFile(`/proc/${pid}/stat`, 'utf8')); }
		catch (error) { if (missing(error)) return null; throw error; }
	};
	const fail = (message: string) => { if (!failures.includes(message) && failures.length < 16) failures.push(message); cleanupStarted ??= performance.now(); };
	const collect = (kind: 'stdout' | 'stderr', bytes: Buffer) => {
		outputBytes += bytes.length;
		if (outputBytes > 65536) { fail('External command output exceeds64KiB.'); return; }
		if (kind === 'stdout') stdout += bytes.toString('utf8'); else stderr += bytes.toString('utf8');
	};
	child.stdout.on('data', (bytes: Buffer) => collect('stdout', bytes)); child.stderr.on('data', (bytes: Buffer) => collect('stderr', bytes));
	child.on('error', error => fail(String(error)));
	child.once('exit', () => { exited = true; });
	child.once('close', (code, signal) => { close = { code, signal, closedAt: new Date().toISOString() }; });
	const known = new Map<string, ProcessState>(), sent = new Set<string>();
	const signals: { identity: MotionProcessIdentity; signal: NodeJS.Signals; observedAt: string; result: string }[] = [];
	let owner: ProcessState | null = null, survivors: ProcessState[] = [], zombies: ProcessState[] = [];
	const scan = async () => {
		if (!owner) return [];
		const names = (await readdir('/proc')).filter(value => /^[1-9]\d*$/u.test(value));
		if (names.length > 65536) throw new Error('Command process enumeration exceeds admission.');
		const current: ProcessState[] = [];
		for (let offset = 0; offset < names.length; offset += 32) {
			for (const value of await Promise.all(names.slice(offset, offset + 32).map(name => readState(Number(name))))) if (value) current.push(value);
		}
		// The detached spawn established this session while its root identity was live.
		const session = current.filter(value => value.group === owner!.pid && value.session === owner!.pid);
		const selected = selectMotionOwnedProcesses(current, owner, [...known.values(), ...session]);
		if (selected.length > 64 || new Set([...known.keys(), ...selected.map(key)]).size > 64) throw new Error('Command descendant admission exceeded.');
		const owned = current.filter(value => selected.some(identity => key(identity) === key(value)));
		for (const value of owned) known.set(key(value), value);
		zombies = owned.filter(value => !running(value));
		return owned.filter(running);
	};
	const signal = async (values: readonly ProcessState[], requested: NodeJS.Signals) => {
		for (const identity of values) {
			const id = `${key(identity)}:${requested}`; if (sent.has(id)) continue;
			try {
				const actual = await readState(identity.pid);
				if (!actual || key(actual) !== key(identity) || !running(actual)) continue;
				sent.add(id); process.kill(identity.pid, requested);
				signals.push({ identity, signal: requested, observedAt: new Date().toISOString(), result: 'sent' });
			} catch (error) {
				if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ESRCH') continue;
				if (cleanupErrors.length < 16) cleanupErrors.push(String(error));
			}
		}
	};
	try {
		if (child.pid) {
			// Do not yield before admission: a fast child can become a real zombie, then be reaped by the next event-loop turn.
			try { owner = observedState(child.pid, readFileSync(`/proc/${child.pid}/stat`, 'utf8')); }
			catch (error) { if (!missing(error)) throw error; }
			if (owner && (owner.group !== child.pid || owner.session !== child.pid)) throw new Error('Owned command did not establish its isolated session.');
			if (owner) known.set(key(owner), owner);
			else fail('Owned command exited before process identity admission.');
		}
		for (;;) {
			try { survivors = await scan(); } catch (error) { fail(`Command ownership observation failed: ${String(error)}`); survivors = [...known.values()].filter(running); }
			if (!failures.length && performance.now() - started >= timeoutMs) fail('External qualification command deadline exceeded.');
			if (exited) {
				survivors = (await Promise.all(survivors.map(async value => {
					const current = await readState(value.pid); return current && key(current) === key(value) && running(current) ? current : null;
				}))).filter(value => value !== null);
				if (survivors.length) fail('External command exited with live owned descendants.');
			}
			if (cleanupStarted !== null) {
				await signal(survivors, performance.now() - cleanupStarted >= 1000 ? 'SIGKILL' : 'SIGTERM');
				if (!owner && child.pid && !exited) child.kill('SIGKILL'); // Actual ChildProcess authority before /proc admission.
			}
			if (close !== null && !survivors.length) break;
			if (cleanupStarted !== null && performance.now() - cleanupStarted >= 5000) {
				cleanupErrors.push('Owned command cleanup deadline exceeded.'); break;
			}
			await delay(25);
		}
	} catch (error) {
		fail(`Command ownership setup failed: ${String(error)}`);
		if (child.pid && !exited) child.kill('SIGKILL');
		const deadline = performance.now() + 5000;
		while (!close && performance.now() < deadline) await delay(25);
		if (!close) cleanupErrors.push('Owned command setup-failure closure deadline exceeded.');
	} finally {
		// A failed closure remains a failure receipt; do not keep this observer alive forever.
		if (!close) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
	}
	const receiptPath = join(options.directory, `${options.id}-command.json`);
	const actualClose = close as { code: number | null; signal: NodeJS.Signals | null; closedAt: string } | null;
	const receipt = { argv: [options.command, ...options.args], cwd: options.cwd, pid: child.pid ?? null,
		startedAt, closedAt: actualClose?.closedAt ?? null, cleanupEndedAt: new Date().toISOString(), code: actualClose?.code ?? null, signal: actualClose?.signal ?? null,
		closureObserved: actualClose !== null, stdout, stderr, failure: failures[0] ?? null, failures, cleanupErrors, statFailures, statFailureOverflow,
		owner, ownedProcesses: [...known.values()], signals, survivingProcesses: survivors, unreapedZombies: zombies };
	await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
	const pin = await hashMotionSustainedFile(receiptPath, 512 * 1024);
	if (failures.length || cleanupErrors.length || survivors.length || !actualClose || actualClose.code !== 0 || actualClose.signal !== null) {
		throw new Error(`Qualification command failed; actual closure retained at ${receiptPath}`);
	}
	return { stdout, stderr, receipt: pin };
}

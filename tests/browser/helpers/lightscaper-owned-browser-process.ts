/* SPDX-License-Identifier: AGPL-3.0-only */

import { open, readdir, readlink, realpath } from 'node:fs/promises';
import { posix } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export interface LinuxBrowserProcessStatV1 {
	readonly pid: number;
	readonly parentPid: number;
	readonly processGroupId: number;
	readonly state: string;
	readonly startTicks: string;
}

export interface LinuxBrowserProcessRowV1 extends LinuxBrowserProcessStatV1 {
	readonly executablePath: string | null;
	readonly argv: readonly string[] | null;
}

export interface OwnedBrowserProcessRequestV1 {
	readonly browserName: 'chromium' | 'firefox';
	readonly profilePath: string;
	readonly executablePath: string;
}

export interface OwnedBrowserProcessIdentityV1 extends OwnedBrowserProcessRequestV1 {
	readonly schemaVersion: 1;
	readonly ownerPid: number;
	readonly ownerStartTicks: string;
	readonly browserPid: number;
	readonly browserStartTicks: string;
	readonly processGroupId: number;
}

export interface OwnedBrowserLifetimeV1 {
	isConnected(): boolean;
	once(event: 'disconnected', listener: () => void): unknown;
	off(event: 'disconnected', listener: () => void): unknown;
}

const MAX_PROCESSES = 4096;
const MAX_ARGUMENT_BYTES = 65_536;
const JOIN_DEADLINE_MS = 30_000;
const states = new Set(['R', 'S', 'D', 'Z', 'T', 't', 'X', 'x', 'K', 'W', 'P', 'I']);
const issued = new WeakMap<object, { facts: Readonly<OwnedBrowserProcessIdentityV1>; work?: Promise<void> }>();

function refuse(message: string): never { throw new TypeError(message); }

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	try {
		if (value === null || typeof value !== 'object') return refuse('Expected a closed process record.');
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (Reflect.ownKeys(descriptors).length !== keys.length) return refuse('Unexpected process record fields.');
		const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const key of keys) {
			const descriptor = descriptors[key];
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) return refuse('Process fields must be own data.');
			result[key] = descriptor.value as unknown;
		}
		return result;
	} catch { return refuse('Process record admission failed.'); }
}

function array(value: unknown, maximum: number): readonly unknown[] {
	try {
		if (!Array.isArray(value)) return refuse('Expected a bounded process array.');
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
		if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maximum
			|| Reflect.ownKeys(descriptors).length !== length + 1) return refuse('Process array exceeds its closed bound.');
		const result: unknown[] = [];
		for (let index = 0; index < length; index++) {
			const descriptor = descriptors[String(index)];
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) return refuse('Process arrays must be dense own data.');
			result.push(descriptor.value as unknown);
		}
		return result;
	} catch { return refuse('Process array admission failed.'); }
}

function integer(value: unknown, minimum = 1): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return refuse('Invalid process integer.');
	return value;
}

function ticks(value: unknown): string {
	if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || value.length > 128) return refuse('Invalid process start ticks.');
	return value;
}

function canonicalPath(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096 || value === '/' || !posix.isAbsolute(value)
		|| posix.normalize(value) !== value || value.endsWith('/')
		|| value.split('').some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
		return refuse('Process paths must be exact canonical absolute paths.');
	}
	return value;
}

function live(state: string): boolean { return state !== 'Z' && state !== 'X' && state !== 'x'; }

function state(value: unknown): string {
	if (typeof value !== 'string' || !states.has(value)) return refuse('Invalid Linux process state.');
	return value;
}

function request(value: unknown): Readonly<OwnedBrowserProcessRequestV1> {
	const input = record(value, ['browserName', 'profilePath', 'executablePath']);
	if (input.browserName !== 'chromium' && input.browserName !== 'firefox') return refuse('Unsupported browser process.');
	return Object.freeze({ browserName: input.browserName, profilePath: canonicalPath(input.profilePath), executablePath: canonicalPath(input.executablePath) });
}

export function parseLinuxBrowserProcessStatV1(pid: number, text: string): Readonly<LinuxBrowserProcessStatV1> {
	integer(pid);
	if (typeof text !== 'string' || text.length > 8192) return refuse('Invalid Linux process stat text.');
	// comm is parenthesized and may itself contain spaces and closing parentheses.
	const match = /^([1-9][0-9]*) \([\s\S]*\) ([\s\S]+)$/.exec(text.trimEnd());
	if (!match || Number(match[1]) !== pid) return refuse('Linux process stat PID mismatch.');
	const fields = match[2]!.split(' ');
	if (fields.length < 20 || fields.length > 64) return refuse('Incomplete Linux process stat fields.');
	const number = (token: string | undefined, minimum: number): number => {
		if (token === undefined || !/^(0|[1-9][0-9]*)$/.test(token)) return refuse('Malformed Linux process stat integer.');
		return integer(Number(token), minimum);
	};
	return Object.freeze({ pid, parentPid: number(fields[1], 0), processGroupId: number(fields[2], 0), state: state(fields[0]), startTicks: ticks(fields[19]) });
}

function processRow(value: unknown): Readonly<LinuxBrowserProcessRowV1> {
	const input = record(value, ['pid', 'parentPid', 'processGroupId', 'state', 'startTicks', 'executablePath', 'argv']);
	let argv: readonly string[] | null = null;
	if (input.argv !== null) {
		let bytes = 0;
		argv = Object.freeze(array(input.argv, 4096).map(token => {
			if (typeof token !== 'string' || token.includes('\0')) return refuse('Invalid native process argument.');
			bytes += Buffer.byteLength(token) + 1;
			if (bytes > MAX_ARGUMENT_BYTES) return refuse('Native process arguments exceed the bound.');
			return token;
		}));
	}
	return Object.freeze({ pid: integer(input.pid), parentPid: integer(input.parentPid, 0), processGroupId: integer(input.processGroupId, 0),
		state: state(input.state), startTicks: ticks(input.startTicks),
		executablePath: input.executablePath === null ? null : canonicalPath(input.executablePath), argv });
}

function matchesProfile(row: Readonly<LinuxBrowserProcessRowV1>, input: Readonly<OwnedBrowserProcessRequestV1>): boolean {
	let argv = row.argv;
	if (!argv) return false;
	if (input.browserName === 'chromium' && argv.length === 1 && argv[0] !== input.executablePath) {
		// Native Chromium can rewrite cmdline into one title; support exact ASCII-space tokens only.
		const title = argv[0]!;
		if (/\s/.test(input.executablePath) || /\s/.test(input.profilePath) || title.startsWith(' ') || title.endsWith(' ')
			|| title.includes('  ') || title.split('').some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127)) return false;
		argv = title.split(' ');
	}
	if (argv[0] !== input.executablePath) return false;
	if (input.browserName === 'chromium') {
		const tokens = argv.filter(token => token.startsWith('--user-data-dir'));
		return tokens.length === 1 && tokens[0] === `--user-data-dir=${input.profilePath}`;
	}
	const positions = argv.flatMap((token, index) => token.startsWith('-profile') || token.startsWith('--profile') ? [index] : []);
	return positions.length === 1 && argv[positions[0]!] === '-profile' && argv[positions[0]! + 1] === input.profilePath;
}

export function classifyOwnedBrowserProcessV1(value: unknown): Readonly<OwnedBrowserProcessIdentityV1> {
	const input = record(value, ['browserName', 'profilePath', 'executablePath', 'owner', 'processes']);
	const requested = request({ browserName: input.browserName, profilePath: input.profilePath, executablePath: input.executablePath });
	const owner = record(input.owner, ['pid', 'startTicks']);
	const ownerPid = integer(owner.pid), ownerStartTicks = ticks(owner.startTicks);
	const processes = array(input.processes, MAX_PROCESSES).map(processRow);
	if (new Set(processes.map(row => row.pid)).size !== processes.length) return refuse('Duplicate native process PID.');
	const ownerRow = processes.find(row => row.pid === ownerPid);
	if (!ownerRow || ownerRow.startTicks !== ownerStartTicks || !live(ownerRow.state)) return refuse('Current owner process identity is missing.');
	if (processes.some(row => live(row.state) && row.parentPid === ownerPid && (row.executablePath === null || row.argv === null))) {
		return refuse('A current direct child has incomplete executable or argument evidence.');
	}
	const candidates = processes.filter(row => live(row.state) && row.parentPid === ownerPid
		&& row.executablePath === requested.executablePath && matchesProfile(row, requested));
	if (candidates.length !== 1) return refuse('Expected exactly one owned browser process.');
	const browser = candidates[0]!;
	if (browser.pid !== browser.processGroupId) return refuse('Owned browser must lead its native process group.');
	return Object.freeze({ schemaVersion: 1, ...requested, ownerPid, ownerStartTicks, browserPid: browser.pid,
		browserStartTicks: browser.startTicks, processGroupId: browser.processGroupId });
}

function gone(error: unknown): boolean {
	if (error === null || typeof error !== 'object') return false;
	const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
	return code === 'ENOENT' || code === 'ESRCH';
}

async function readBoundedFile(path: string, maximum: number): Promise<Buffer> {
	const handle = await open(path, 'r'), bytes = Buffer.alloc(maximum + 1);
	let length = 0, failed = false, primary: unknown, cleanup: unknown, cleanupFailed = false;
	try {
		while (length < bytes.length) {
			const result = await handle.read(bytes, length, bytes.length - length, null);
			if (result.bytesRead === 0) break;
			length += result.bytesRead;
		}
		if (length > maximum) refuse('Native process file exceeds its bound.');
	} catch (error) { failed = true; primary = error; }
	try { await handle.close(); } catch (error) { cleanupFailed = true; cleanup = error; }
	if (failed || cleanupFailed) {
		bytes.fill(0);
		if (failed && cleanupFailed) throw new AggregateError([primary, cleanup], 'Native process read and close failed.', { cause: primary });
		throw failed ? primary : cleanup;
	}
	return bytes.subarray(0, length);
}

async function readStat(pid: number): Promise<Readonly<LinuxBrowserProcessStatV1>> {
	const bytes = await readBoundedFile(`/proc/${pid}/stat`, 8192);
	try { return parseLinuxBrowserProcessStatV1(pid, bytes.toString('utf8')); } finally { bytes.fill(0); }
}

async function processStats(): Promise<readonly Readonly<LinuxBrowserProcessStatV1>[]> {
	const names = (await readdir('/proc')).filter(name => /^[1-9][0-9]*$/.test(name));
	if (names.length > MAX_PROCESSES) return refuse('Native process inventory exceeds the complete scan bound.');
	const rows: Readonly<LinuxBrowserProcessStatV1>[] = [];
	for (const name of names) {
		try { rows.push(await readStat(integer(Number(name)))); }
		catch (error) { if (!gone(error)) throw error; } // A vanished process no longer owns live file readers.
	}
	return rows;
}

async function sample(input: Readonly<OwnedBrowserProcessRequestV1>, owner: Readonly<LinuxBrowserProcessStatV1>): Promise<Readonly<OwnedBrowserProcessIdentityV1>> {
	const rows: Readonly<LinuxBrowserProcessRowV1>[] = [];
	for (const stat of await processStats()) {
		let admittedStat = stat;
		let executablePath: string | null = null, argv: readonly string[] | null = null;
		if (live(stat.state) && stat.parentPid === owner.pid) {
			try {
				executablePath = canonicalPath(await realpath(await readlink(`/proc/${stat.pid}/exe`)));
				const bytes = await readBoundedFile(`/proc/${stat.pid}/cmdline`, MAX_ARGUMENT_BYTES);
				try {
					if (bytes.length === 0 || bytes[bytes.length - 1] !== 0) refuse('Incomplete native process arguments.');
					argv = bytes.toString('utf8').slice(0, -1).split('\0');
				} finally { bytes.fill(0); }
				const current = await readStat(stat.pid);
				if (current.startTicks !== stat.startTicks || current.parentPid !== stat.parentPid || current.processGroupId !== stat.processGroupId) {
					return refuse('Native process changed during acquisition.');
				}
				admittedStat = current;
			} catch (error) { if (gone(error)) continue; throw error; }
		}
		rows.push(Object.freeze({ ...admittedStat, executablePath, argv }));
	}
	const currentOwner = await readStat(owner.pid);
	if (currentOwner.startTicks !== owner.startTicks) return refuse('Native owner PID was reused.');
	return classifyOwnedBrowserProcessV1({ ...input, owner: { pid: owner.pid, startTicks: owner.startTicks }, processes: rows });
}

export async function captureOwnedBrowserProcessV1(value: OwnedBrowserProcessRequestV1): Promise<Readonly<OwnedBrowserProcessIdentityV1>> {
	const input = request(value);
	if (process.platform !== 'linux') return refuse('Owned native browser supervision requires Linux.');
	const owner = await readStat(process.pid);
	const resolved = Object.freeze({ ...input, profilePath: canonicalPath(await realpath(input.profilePath)),
		executablePath: canonicalPath(await realpath(input.executablePath)) });
	const facts = await sample(resolved, owner);
	issued.set(facts, { facts });
	return facts;
}

function sameIdentity(left: Readonly<OwnedBrowserProcessIdentityV1>, right: Readonly<OwnedBrowserProcessIdentityV1>): boolean {
	return left.browserName === right.browserName && left.profilePath === right.profilePath && left.executablePath === right.executablePath
		&& left.ownerPid === right.ownerPid && left.ownerStartTicks === right.ownerStartTicks && left.browserPid === right.browserPid
		&& left.browserStartTicks === right.browserStartTicks && left.processGroupId === right.processGroupId;
}

async function killAndJoin(facts: Readonly<OwnedBrowserProcessIdentityV1>, browser: OwnedBrowserLifetimeV1): Promise<void> {
	const connected = browser.isConnected, once = browser.once, off = browser.off;
	if (typeof connected !== 'function' || typeof once !== 'function' || typeof off !== 'function') return refuse('Invalid public browser lifetime port.');
	let disconnected = false, failed = false, primary: unknown, cleanupFailed = false, cleanup: unknown;
	const onDisconnected = (): void => { disconnected = true; };
	once.call(browser, 'disconnected', onDisconnected);
	try {
		if (!connected.call(browser)) refuse('Owned browser was already disconnected before interruption.');
		const owner = await readStat(process.pid);
		if (owner.pid !== facts.ownerPid || owner.startTicks !== facts.ownerStartTicks) refuse('Current native owner changed.');
		const current = await sample({ browserName: facts.browserName, profilePath: facts.profilePath, executablePath: facts.executablePath }, owner);
		if (!sameIdentity(facts, current) || disconnected || !connected.call(browser)) refuse('Owned browser identity changed before interruption.');
		process.kill(-facts.processGroupId, 'SIGKILL');
		const deadline = performance.now() + JOIN_DEADLINE_MS;
		let emptySamples = 0;
		for (;;) {
			const groupAlive = (await processStats()).some(row => row.processGroupId === facts.processGroupId && live(row.state));
			emptySamples = groupAlive ? 0 : emptySamples + 1;
			if (disconnected && emptySamples >= 2) break;
			if (performance.now() >= deadline) throw new Error('Owned browser interruption did not join native disconnection and process group retirement.');
			await delay(20);
		}
	} catch (error) { failed = true; primary = error; }
	try { off.call(browser, 'disconnected', onDisconnected); } catch (error) { cleanupFailed = true; cleanup = error; }
	if (failed && cleanupFailed) throw new AggregateError([primary, cleanup], 'Native interruption and browser listener cleanup failed.', { cause: primary });
	if (failed || cleanupFailed) throw failed ? primary : cleanup;
}

export function killAndJoinOwnedBrowserProcessV1(identity: unknown, browser: OwnedBrowserLifetimeV1): Promise<void> {
	// WeakMap admission never reads unissued scalar facts, accessors, or proxy traps.
	const entry = identity !== null && typeof identity === 'object' ? issued.get(identity) : undefined;
	if (!entry) return Promise.reject(new TypeError('Only native capture can issue browser process interruption authority.'));
	entry.work ??= Promise.resolve().then(() => killAndJoin(entry.facts, browser));
	return entry.work;
}

/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir } from 'node:fs/promises';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';
import { parseMotionProcessStat, parseMotionProcessMemory, selectMotionOwnedProcesses, type MotionProcessIdentity } from './motionscaper-sustained-process.ts';

function missing(error: unknown): boolean { return !!error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT'; }
export async function readMotionProcessIdentity(pid: number): Promise<MotionProcessIdentity> {
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid owned process PID.');
	return parseMotionProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
}
export interface MotionOwnedMemorySample {
	readonly observedAt: string; readonly monotonicMs: number; readonly rssBytes: number; readonly pssBytes: number;
	readonly processes: readonly Readonly<{ identity: MotionProcessIdentity; rssBytes: number; pssBytes: number }>[];
}
export async function sampleMotionOwnedProcesses(root: MotionProcessIdentity, previous: readonly MotionProcessIdentity[]): Promise<MotionOwnedMemorySample> {
	const names = (await readdir('/proc')).filter(name => /^[1-9]\d*$/u.test(name));
	if (names.length > 65536) throw new Error('Process enumeration exceeds the qualification admission.');
	const identities: MotionProcessIdentity[] = [];
	for (let offset = 0; offset < names.length; offset += 32) {
		const batch = await Promise.all(names.slice(offset, offset + 32).map(async name => {
			try { return await readMotionProcessIdentity(Number(name)); } catch (error) { if (missing(error)) return null; throw error; }
		}));
		for (const value of batch) if (value) identities.push(value);
	}
	const owned = selectMotionOwnedProcesses(identities, root, previous);
	if (owned.length > plan.maximumOwnedProcesses) throw new Error('Owned process count exceeds qualification admission.');
	const processes: MotionOwnedMemorySample['processes'][number][] = [];
	for (const identity of owned) {
		try {
			const memory = parseMotionProcessMemory(await readFile(`/proc/${identity.pid}/smaps_rollup`, 'utf8'));
			const current = await readMotionProcessIdentity(identity.pid);
			if (current.startTicks === identity.startTicks) processes.push({ identity, ...memory });
		} catch (error) { if (!missing(error)) throw error; }
	}
	return { observedAt: new Date().toISOString(), monotonicMs: performance.now(), processes,
		rssBytes: processes.reduce((total, value) => total + value.rssBytes, 0), pssBytes: processes.reduce((total, value) => total + value.pssBytes, 0) };
}
/** Hashing never materializes the duration-sized file. File identity is checked around the read. */
export async function hashMotionSustainedFile(path: string, maximumBytes = plan.maximumOutputBytes,
	onBytes?: (bytes: Uint8Array) => void) {
	const pathBefore = await lstat(path);
	if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) throw new Error('Qualification output must be a regular file, never a symbolic link.');
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (pathBefore.ino !== before.ino || pathBefore.dev !== before.dev || pathBefore.ctimeMs !== before.ctimeMs) throw new Error('Qualification output changed before hashing.');
		if (!before.isFile() || before.size > maximumBytes) throw new Error('Qualification file exceeds output admission.');
		const hash = createHash('sha256'), buffer = Buffer.alloc(plan.maximumReadBytes); let byteLength = 0, maximumReadBytes = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
			byteLength += bytesRead; maximumReadBytes = Math.max(maximumReadBytes, bytesRead);
			if (byteLength > maximumBytes) throw new Error('Qualification file grew beyond output admission.');
			hash.update(buffer.subarray(0, bytesRead));
			onBytes?.(buffer.subarray(0, bytesRead));
		}
		const [after, pathAfter] = await Promise.all([handle.stat(), lstat(path)]);
		if (!pathAfter.isFile() || pathAfter.isSymbolicLink() || before.ino !== pathAfter.ino || before.dev !== pathAfter.dev
			|| before.ctimeMs !== pathAfter.ctimeMs || before.ino !== after.ino || before.dev !== after.dev
			|| before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs || before.size !== after.size
			|| byteLength !== after.size) throw new Error('Qualification output changed while hashing.');
		return { path, byteLength, sha256: hash.digest('hex'), maximumReadBytes };
	} finally { await handle.close(); }
}

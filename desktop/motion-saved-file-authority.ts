/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomUUID } from 'node:crypto';
import { constants, watch, type FSWatcher, type Stats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute } from 'node:path';
import { MOTION_SAVED_FILE_CHUNK_BYTES, MOTION_SAVED_FILE_MAXIMUM_BYTES, type MotionSavedFileCapabilities, type MotionSavedFileDiscovery } from '../src/common/editor/motion-saved-file-contract.ts';
interface Fingerprint { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number; readonly nlink: number }
interface WatchEntry { readonly path: string; readonly name: string; readonly parent: Readonly<{ dev: number; ino: number }>; generation: number; fingerprint: Fingerprint | null | undefined; watcher: FSWatcher | null; closed: boolean; polling: Promise<MotionSavedFileDiscovery> | null }
interface Snapshot { readonly watchId: string; readonly file: FileHandle; readonly fingerprint: Fingerprint; closed: boolean; reading: Promise<Uint8Array> | null; closing: Promise<void> | null }
export interface MotionSavedFileAuthority extends MotionSavedFileCapabilities { dispose(): Promise<void> }

/** Selected-path authority only. Directory watches survive the inode replacement used by atomic Save. */
export function createMotionSavedFileAuthority(options: Readonly<{ chooseFile: () => Promise<string | null>; closeFile?: (file: FileHandle) => Promise<void> }>): MotionSavedFileAuthority {
	const closeFile = options.closeFile ?? ((file: FileHandle) => file.close());
	const watches = new Map<string, WatchEntry>(), snapshots = new Map<string, Snapshot>(); let closed = false, selecting = 0, openingSnapshots = 0;
	const active = () => { if (closed) throw new Error('Motion saved file authority is closed.'); };
	function watching(id: string): WatchEntry { active(); const entry = watches.get(id); if (!entry || entry.closed) throw new Error('Unknown Motion saved file watch.'); return entry; }
	function reading(token: string): Snapshot { active(); const entry = snapshots.get(token); if (!entry || entry.closed) throw new Error('Unknown Motion saved file snapshot.'); return entry; }
	function renewWatcher(entry: WatchEntry): void {
		if (entry.closed || entry.watcher) return;
		try {
			// Discovery polls stat even if an OS watch coalesces or drops a notification.
			const watcher = watch(dirname(entry.path), { persistent: false }, () => {}); entry.watcher = watcher;
			watcher.on('error', () => { watcher.close(); if (entry.watcher === watcher) entry.watcher = null; });
			watcher.on('close', () => { if (entry.watcher === watcher) entry.watcher = null; });
		} catch { /* Polling still discovers replacements on filesystems without watch support. */ }
	}
	async function release(token: string): Promise<void> {
		const entry = snapshots.get(token); if (!entry) throw new Error('Unknown Motion saved file snapshot.');
		if (entry.closing) return entry.closing; entry.closed = true;
		entry.closing = (async () => { if (entry.reading) await Promise.allSettled([entry.reading]); await closeFile(entry.file); snapshots.delete(token); })();
		try { await entry.closing; } finally { entry.closing = null; }
	}
	async function cancel(id: string): Promise<void> {
		const entry = watches.get(id); if (!entry) throw new Error('Unknown Motion saved file watch.');
		entry.closed = true; entry.watcher?.close(); entry.watcher = null;
		const failures: unknown[] = [];
		if (entry.polling) { const result = (await Promise.allSettled([entry.polling]))[0]!; if (result.status === 'rejected' && result.reason instanceof AggregateError) failures.push(result.reason); }
		for (const [token, snapshot] of snapshots) if (snapshot.watchId === id) try { await release(token); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Motion watch cancellation could not close every pinned file.');
		// Keep a closed watch addressable until every handle closes, so failed cancellation can be retried.
		watches.delete(id);
	}
	async function discover(watchId: string, entry: WatchEntry, afterGeneration: number): Promise<MotionSavedFileDiscovery> {
		renewWatcher(entry); const parent = await selectedParent(entry.path, false);
		const fingerprint = parent?.dev === entry.parent.dev && parent.ino === entry.parent.ino ? await selectedFile(entry.path, false) : null;
		if (entry.closed || closed) throw new Error('Motion saved file watch is closed.');
		if (!fingerprint) {
			if (entry.fingerprint !== null) { entry.generation++; entry.fingerprint = null; }
			return { state: 'unavailable', generation: entry.generation };
		}
		if (sameFingerprint(entry.fingerprint, fingerprint)) {
			if (afterGeneration === entry.generation) return { state: 'unchanged', generation: entry.generation };
		} else { entry.generation++; entry.fingerprint = fingerprint; }
		if (snapshots.size + openingSnapshots >= 16) throw new RangeError('Release a pinned Motion file snapshot before discovering another revision.');
		openingSnapshots++;
		try {
		const file = await open(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try {
			if (entry.closed || closed) throw new Error('Motion saved file watch is closed.');
			if (!sameFingerprint(fingerprint, fingerprintOf(await file.stat())) || !sameFingerprint(fingerprint, await selectedFile(entry.path, false))) throw new Error('Selected Motion file changed during snapshot discovery; retry discovery.');
			const token = randomUUID(); snapshots.set(token, { watchId, file, fingerprint, closed: false, reading: null, closing: null });
			return { state: 'snapshot', snapshot: { token, name: entry.name, byteLength: fingerprint.size, generation: entry.generation } };
		} catch (error) { try { await closeFile(file); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Motion snapshot discovery and file cleanup failed.', { cause: cleanup }); } throw error; }
		} finally { openingSnapshots--; }
	}
	return {
		async select() {
			active(); if (watches.size + selecting >= 8) throw new RangeError('Too many Motion saved file watches.'); selecting++;
			try {
				const path = await options.chooseFile(); active(); if (path === null) return null;
				if (!isAbsolute(path) || extname(path).toLowerCase() !== '.mscape') throw new Error('Choose a saved Motionscaper .mscape file.');
				await selectedFile(path, true); const parent = (await selectedParent(path, true))!; active(); const watchId = randomUUID();
				const entry: WatchEntry = { path, parent, name: basename(path), generation: 0, fingerprint: undefined, watcher: null, closed: false, polling: null };
				watches.set(watchId, entry); renewWatcher(entry); return { watchId, name: entry.name };
			} finally { selecting--; }
		},
		async poll({ watchId, afterGeneration }) {
			const entry = watching(watchId); integer(afterGeneration);
			if (afterGeneration > entry.generation) throw new Error('Motion discovery generation is ahead of its watch.');
			if (entry.polling) throw new Error('Motion saved file discovery is already in flight.');
			entry.polling = discover(watchId, entry, afterGeneration); try { return await entry.polling; } finally { entry.polling = null; }
		},
		async read({ token, offset, length }) {
			const entry = reading(token); integer(offset); integer(length);
			if (length < 1 || length > MOTION_SAVED_FILE_CHUNK_BYTES || offset > entry.fingerprint.size - length) throw new RangeError('Motion snapshot read is outside its bounded range.');
			if (entry.reading) throw new Error('Motion snapshot read is already in flight.');
			entry.reading = (async () => {
				assertPinned(entry.fingerprint, fingerprintOf(await entry.file.stat()));
				const bytes = new Uint8Array(length); let position = 0;
				while (position < length) {
					if (entry.closed || closed) throw new Error('Motion snapshot read was cancelled.');
					const result = await entry.file.read(bytes, position, length - position, offset + position);
					if (!result.bytesRead) throw new Error('Motion saved file changed during read.'); position += result.bytesRead;
				}
				assertPinned(entry.fingerprint, fingerprintOf(await entry.file.stat())); if (entry.closed || closed) throw new Error('Motion snapshot read was cancelled.'); return bytes;
			})();
			try { return await entry.reading; } finally { entry.reading = null; }
		},
		async release({ token }) { active(); await release(token); },
		async cancel({ watchId }) { active(); await cancel(watchId); },
		async dispose() {
			if (closed && !watches.size && !snapshots.size) return; closed = true; const failures: unknown[] = [];
			for (const id of watches.keys()) try { await cancel(id); } catch (error) { failures.push(error); }
			for (const token of snapshots.keys()) try { await release(token); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Motion saved file authority cleanup failed.');
		},
	};
}
function fingerprintOf(stat: Stats): Fingerprint { return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, nlink: stat.nlink }; }
function sameFingerprint(first: Fingerprint | null | undefined, second: Fingerprint | null): boolean {
	return !!first && !!second && first.dev === second.dev && first.ino === second.ino && first.size === second.size && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs;
}
function assertPinned(expected: Fingerprint, actual: Fingerprint): void {
	// Atomic replacement unlinks the old inode; its open descriptor still owns those immutable bytes.
	if (expected.dev !== actual.dev || expected.ino !== actual.ino || expected.size !== actual.size || expected.mtimeMs !== actual.mtimeMs
		|| expected.ctimeMs !== actual.ctimeMs && actual.nlink !== 0) throw new Error('Pinned Motion saved file changed during read.');
}
async function selectedFile(path: string, required: boolean): Promise<Fingerprint | null> {
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MOTION_SAVED_FILE_MAXIMUM_BYTES) {
			if (!required) return null; throw new Error('Selected Motion archive must be a regular file within its 64 GiB byte admission.');
		}
		return fingerprintOf(stat);
	} catch (error) { if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function selectedParent(path: string, required: boolean): Promise<Readonly<{ dev: number; ino: number }> | null> {
	try { const stat = await lstat(dirname(path)); if (!stat.isDirectory() || stat.isSymbolicLink()) { if (!required) return null; throw new Error('Choose a Motion file in a regular directory.'); } return { dev: stat.dev, ino: stat.ino }; }
	catch (error) { if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function integer(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Motion file count must be a nonnegative safe integer.'); }

/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomUUID, createHash, type Hash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { MOTIONSCAPER_FILE_CHUNK_BYTES, type MotionDesktopFiles, type MotionOpenFileCapability } from '../src/motionscaper/desktop-file-contract.ts';

interface Fingerprint { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
interface Binding { readonly path: string; readonly fingerprint: Fingerprint | null }
interface ReadCapability extends Binding { readonly file: FileHandle; readonly fingerprint: Fingerprint; busy: boolean }
interface WriteCapability extends Binding { readonly projectId: string; readonly saveCopy: boolean; readonly temporary: string; readonly file: FileHandle; readonly digest: Hash; bytes: number; busy: boolean; failed: boolean; closed: boolean }
export interface MotionFileDialogs {
	chooseOpen(): Promise<string | null>;
	chooseSave(options: { readonly suggestedName: string; readonly defaultPath?: string }): Promise<string | null>;
}
export interface MotionFileAuthority extends MotionDesktopFiles {
	/** Main-process OS file launch only; deliberately absent from the renderer method table. */
	openTrustedPath(path: string): Promise<MotionOpenFileCapability>;
	revokeRead(token: string): Promise<void>;
	dispose(): Promise<void>;
}

/** Capabilities live only in this main-process instance; no path crosses the renderer bridge. */
export function createMotionscaperFileAuthority(dialogs: MotionFileDialogs): MotionFileAuthority {
	const readers = new Map<string, ReadCapability>();
	const writers = new Map<string, WriteCapability>();
	const bindings = new Map<string, Binding>();
	const saving = new Set<string>();
	let disposed = false; let opening = 0;
	const active = () => { if (disposed) throw new Error('Motionscaper file authority is closed.'); };
	function reader(token: string): ReadCapability { active(); const value = readers.get(token); if (!value) throw new Error('Unknown Motionscaper read capability.'); return value; }
	function writer(token: string): WriteCapability { active(); const value = writers.get(token); if (!value) throw new Error('Unknown Motionscaper write capability.'); return value; }
	async function acquireRead(choosePath: () => Promise<string | null>): Promise<MotionOpenFileCapability | null> {
		active(); if (readers.size + opening >= 16) throw new RangeError('Too many open Motionscaper file capabilities.');
		opening += 1;
		try {
			const path = await choosePath(); if (path === null) return null; active();
			const fingerprint = await requireFile(path);
			const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			try {
				assertFingerprint(fingerprint, fingerprintOf(await file.stat())); active();
				const token = randomUUID(); readers.set(token, { path, fingerprint, file, busy: false });
				return { token, name: basename(path), byteLength: fingerprint.size };
			} catch (error) { await file.close(); throw error; }
		} finally { opening -= 1; }
	}
	const authority: MotionFileAuthority = {
		selectOpen: () => acquireRead(() => dialogs.chooseOpen()),
		async openTrustedPath(path) {
			const selected = await acquireRead(() => Promise.resolve(path));
			if (!selected) throw new Error('Motionscaper native launch has no archive.');
			return selected;
		},
		async revokeRead(token) {
			const value = readers.get(token); if (!value) return;
			await value.file.close(); if (readers.get(token) === value) readers.delete(token);
		},
		async read({ token, offset, length }) {
			const value = reader(token); integer(offset, 'read offset'); integer(length, 'read length');
			if (length > MOTIONSCAPER_FILE_CHUNK_BYTES || offset > value.fingerprint.size - length) throw new RangeError('Motionscaper read chunk is outside its bounded capability.');
			if (value.busy) throw new Error('Motionscaper read capability already has a pending chunk.');
			value.busy = true;
			try {
				assertFingerprint(value.fingerprint, fingerprintOf(await value.file.stat()));
				const bytes = new Uint8Array(length); let read = 0;
				while (read < length) {
					const result = await value.file.read(bytes, read, length - read, offset + read);
					if (!result.bytesRead) throw new Error('Motionscaper selected archive changed during read.');
					read += result.bytesRead;
				}
				assertFingerprint(value.fingerprint, fingerprintOf(await value.file.stat())); return bytes;
			} finally { value.busy = false; }
		},
		async release({ token }) { const value = reader(token); await value.file.close(); readers.delete(token); },
		async bindOpened({ token, projectId }) {
			const value = reader(token); identity(projectId);
			if (!bindings.has(projectId) && bindings.size >= 256) throw new RangeError('Too many Motionscaper file bindings.');
			if (saving.has(projectId)) throw new Error('A Motionscaper save for this project is already active.');
			assertFingerprint(value.fingerprint, await requireFile(value.path));
			bindings.set(projectId, { path: value.path, fingerprint: value.fingerprint });
		},
		async beginSave({ projectId, suggestedName, saveAs, saveCopy = false }) {
			active(); identity(projectId);
			if (!saveCopy && !bindings.has(projectId) && bindings.size >= 256) throw new RangeError('Too many Motionscaper file bindings.');
			if (typeof saveAs !== 'boolean' || typeof suggestedName !== 'string' || suggestedName.length > 512) throw new TypeError('Motionscaper Save requires a bounded name and saveAs boolean.');
			if (typeof saveCopy !== 'boolean' || saveCopy && !saveAs) throw new TypeError('Motionscaper Save Copy requires saveAs and a boolean saveCopy flag.');
			if (saving.has(projectId) || saving.size >= 4) throw new Error('A Motionscaper save is already active.');
			saving.add(projectId);
			try {
				const bound = bindings.get(projectId);
				let path: string; let fingerprint: Fingerprint | null;
				if (!saveAs && bound) { path = bound.path; fingerprint = await optionalFile(path); assertFingerprint(bound.fingerprint, fingerprint); }
				else {
					const chosen = await dialogs.chooseSave({ suggestedName: safeName(suggestedName), ...(bound && !saveCopy ? { defaultPath: bound.path } : {}) });
					if (chosen === null) { saving.delete(projectId); return null; }
					if (!isAbsolute(chosen) || extname(chosen).toLowerCase() !== '.mscape') throw new TypeError('Choose a Motionscaper .mscape destination.');
					path = chosen; fingerprint = await optionalFile(path);
				}
				if (saveCopy && bound && (path === bound.path || fingerprint && bound.fingerprint
					&& fingerprint.dev === bound.fingerprint.dev && fingerprint.ino === bound.fingerprint.ino)) throw new Error('Save Copy requires an independent destination.');
				if (saveCopy && [...readers.values()].some(value => path === value.path || fingerprint
					&& fingerprint.dev === value.fingerprint.dev && fingerprint.ino === value.fingerprint.ino)) throw new Error('Save Copy requires an independent destination from every retained open archive.');
				active();
				const temporary = join(dirname(path), `.${basename(path)}.motionscaper-${randomUUID()}.tmp`);
				const file = await open(temporary, 'wx', 0o600);
				if (disposed) { await file.close(); await rm(temporary, { force: true }); active(); }
				const token = randomUUID(); writers.set(token, { path, fingerprint, projectId, saveCopy, temporary, file, digest: createHash('sha256'), bytes: 0, busy: false, failed: false, closed: false });
				return { token };
			} catch (error) { saving.delete(projectId); throw error; }
		},
		async write({ token, offset, bytes }) {
			const value = writer(token); integer(offset, 'write offset');
			if (offset !== value.bytes) throw new RangeError('Motionscaper write offset must follow the last committed chunk.');
			if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MOTIONSCAPER_FILE_CHUNK_BYTES) throw new RangeError('Motionscaper write chunk exceeds its bounded capability.');
			if (value.busy || value.failed) throw new Error('Motionscaper write capability is busy or failed.');
			const chunk = new Uint8Array(bytes);
			value.busy = true;
			try {
				let written = 0;
				while (written < chunk.byteLength) {
					const result = await value.file.write(chunk, written, chunk.byteLength - written, offset + written);
					if (!result.bytesWritten) throw new Error('Motionscaper archive write made no progress.');
					written += result.bytesWritten;
				}
				value.digest.update(chunk); value.bytes += chunk.byteLength;
			} catch (error) { value.failed = true; throw error; }
			finally { value.busy = false; }
		},
		async commit({ token, byteLength }) {
			const value = writer(token); integer(byteLength, 'archive byte length');
			if (byteLength < 1 || value.bytes !== byteLength || value.busy || value.failed) throw new RangeError('Motionscaper archive is incomplete or its write capability failed.');
			value.busy = true;
			try {
				assertFingerprint(value.fingerprint, await optionalFile(value.path));
				await value.file.sync(); await value.file.close(); value.closed = true;
				await rename(value.temporary, value.path);
				await syncDirectory(dirname(value.path));
				const fingerprint = await requireFile(value.path);
				if (!value.saveCopy) bindings.set(value.projectId, { path: value.path, fingerprint });
				writers.delete(token); saving.delete(value.projectId);
				return { name: basename(value.path), byteLength, sha256: value.digest.digest('hex') };
			} catch (error) { value.failed = true; throw error; }
			finally { value.busy = false; }
		},
		async cancel({ token }) {
			const value = writer(token);
			if (value.busy) throw new Error('Motionscaper write capability is busy.');
			writers.delete(token); saving.delete(value.projectId);
			if (!value.closed) await value.file.close();
			await rm(value.temporary, { force: true });
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			await Promise.allSettled([...readers.values()].map((value) => value.file.close()));
			await Promise.allSettled([...writers.values()].map(async (value) => {
				if (!value.closed) await value.file.close(); await rm(value.temporary, { force: true });
			}));
			readers.clear(); writers.clear(); bindings.clear(); saving.clear();
		},
	};
	return Object.freeze(authority);
}
function integer(value: number, label: string): void { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid Motionscaper ${label}.`); }
function identity(value: string): void { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Invalid Motionscaper project identity.'); }
function safeName(value: string): string { return `${value.replace(/[\\/\p{Cc}<>:"|?*]/gu, '_').replace(/\.mscape$/iu, '').slice(0,180) || 'Motionscaper project'}.mscape`; }
function fingerprintOf(value: Fingerprint): Fingerprint { return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs }; }
function assertFingerprint(expected: Fingerprint | null, actual: Fingerprint | null): void { if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('The selected Motionscaper archive changed outside this save.'); }
async function optionalFile(path: string): Promise<Fingerprint | null> {
	if (!isAbsolute(path)) throw new TypeError('A native Motionscaper dialog must select an absolute path.');
	const stats = await lstat(path).catch((error: unknown) => { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error; });
	if (!stats) return null;
	if (!stats.isFile() || stats.isSymbolicLink() || !Number.isSafeInteger(stats.size)) throw new TypeError('Motionscaper file capability requires a regular file.');
	return fingerprintOf(stats);
}
async function requireFile(path: string): Promise<Fingerprint> { const value = await optionalFile(path); if (!value) throw new Error('Motionscaper selected archive no longer exists.'); return value; }
async function syncDirectory(path: string): Promise<void> {
	if (process.platform === 'win32') return;
	const directory = await open(path, 'r'); try { await directory.sync(); } finally { await directory.close(); }
}

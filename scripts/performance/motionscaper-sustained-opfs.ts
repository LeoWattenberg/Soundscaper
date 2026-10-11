/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import type { Page } from '@playwright/test';

export interface MotionSustainedDestinationSnapshot {
	readonly name: string; readonly suggestedName: string | null; readonly bytes: number; readonly writes: number;
	readonly maxOutstandingWrites: number; readonly closed: boolean; readonly aborted: boolean; readonly removed: boolean;
	readonly events: readonly string[];
}
interface BrowserDestination {
	prepare(name: string): Promise<void>; snapshot(): MotionSustainedDestinationSnapshot;
	read(name: string, offset: number, length: number): Promise<{ bytes: number[]; size: number }>;
	cleanup(): Promise<MotionSustainedDestinationSnapshot>;
}
type DestinationScope = typeof globalThis & { __motionSustainedDestination: BrowserDestination };

/** External harness only: serializable into an isolated page; all delivered bytes go to real OPFS. */
export function installMotionSustainedOpfs({ directoryName }: { directoryName: string }): void {
	const limit = 512 * 1024 * 1024, block = 65536;
	const valid = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(name);
	if (!valid(directoryName)) throw new Error('Invalid sustained OPFS directory.');
	let directory: FileSystemDirectoryHandle | null = null;
	let disk: FileSystemWritableFileStream | null = null;
	let state: { name: string; suggestedName: string | null; bytes: number; writes: number; maxOutstandingWrites: number; closed: boolean; aborted: boolean; removed: boolean; events: string[] } | null = null;
	let active = 0, picked = false, created = false, opening = false;
	const snapshot = (): MotionSustainedDestinationSnapshot => {
		if (!state) throw new Error('No sustained destination was prepared.');
		return { ...state, events: [...state.events] };
	};
	const event = (name: string) => { if (state && state.events.length < 16) state.events.push(name); };
	const abort = async () => {
		if (!state || !directory || state.closed) return;
		state.aborted = true;
		if (disk) { await disk.abort(); disk = null; event('abort'); }
		if (!state.removed) { if (created) await directory.removeEntry(state.name); state.removed = true; event('remove'); }
	};
	const owner: BrowserDestination = {
		async prepare(name) {
			if (!valid(name) || (state && !state.closed && !state.removed)) throw new Error('Sustained destination is invalid or still active.');
			if (!directory) {
				const root = await navigator.storage.getDirectory();
				try { await root.getDirectoryHandle(directoryName); throw new Error('Sustained OPFS directory already exists.'); }
				catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
				directory = await root.getDirectoryHandle(directoryName, { create: true });
			}
			try { await directory.getFileHandle(name); throw new Error('Sustained destination already exists.'); }
			catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
			state = { name, suggestedName: null, bytes: 0, writes: 0, maxOutstandingWrites: 0, closed: false, aborted: false, removed: false, events: ['prepare'] }; picked = false; created = false;
		},
		snapshot,
		async read(name, offset, length) {
			if (!state?.closed || state.name !== name || state.removed || !directory || !Number.isSafeInteger(offset) || offset < 0
				|| !Number.isSafeInteger(length) || length < 1 || length > block) throw new Error('Invalid sustained destination read.');
			const file = await (await directory.getFileHandle(name)).getFile();
			if (file.size !== state.bytes || offset > file.size) throw new Error('Sustained destination changed after close.');
			return { bytes: Array.from(new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())), size: file.size };
		},
		async cleanup() {
			if (active) throw new Error('Sustained cleanup requires the outstanding disk write to settle.');
			await abort();
			if (directory) { await (await navigator.storage.getDirectory()).removeEntry(directoryName, { recursive: true }); directory = null; if (state) { state.removed = true; event('directory-remove'); } }
			return snapshot();
		},
	};
	Object.defineProperty(globalThis, '__motionSustainedDestination', { value: owner, configurable: true });
	Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: async (options?: { suggestedName?: string }) => {
		if (!state || !directory || picked || state.closed || state.aborted) throw new Error('No unclaimed sustained destination.');
		picked = true; state.suggestedName = options?.suggestedName ?? null; event('picker');
		const attempt = state; const handle = await directory.getFileHandle(state.name, { create: true }); created = true;
		return { kind: 'file', name: state.name, async createWritable() {
			if (disk || opening || attempt !== state || attempt.closed || attempt.aborted) throw new Error('Sustained writer ownership changed.');
			opening = true;
			try { disk = await handle.createWritable({ keepExistingData: false }); event('open'); } finally { opening = false; }
			return new WritableStream<Uint8Array>({
				async write(chunk) {
					try {
						if (!(chunk instanceof Uint8Array) || chunk.byteLength > 4 * 1024 * 1024 || chunk.byteLength > limit - attempt.bytes || active) throw new Error('Sustained write admission exceeded.');
						for (let offset = 0; offset < chunk.byteLength; offset += block) {
							active++; attempt.maxOutstandingWrites = Math.max(attempt.maxOutstandingWrites, active);
							const bytes = new Uint8Array(chunk.subarray(offset, offset + block));
							try { await disk!.write(bytes); attempt.bytes += bytes.byteLength; attempt.writes++; if (attempt.writes === 1) event('first-write'); }
							finally { active--; }
						}
					} catch (error) { event('write-failed'); try { await abort(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Sustained write and cleanup failed.', { cause: cleanup }); } throw error; }
				},
				async close() {
					try { await disk!.close(); disk = null; attempt.closed = true; event('close'); }
					catch (error) { event('close-failed'); try { await abort(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Sustained close and cleanup failed.', { cause: cleanup }); } throw error; }
				},
				async abort() { await abort(); },
			}, { highWaterMark: 1 });
		} };
	} });
}
/** tsx decorates named closures; supply that identity helper inside this test-only script's lexical scope. */
export function motionSustainedOpfsSource(options: { directoryName: string }): string {
	return `(() => { const __name = value => value; (${installMotionSustainedOpfs.toString()})(${JSON.stringify(options)}); })();`;
}
export async function prepareMotionSustainedDestination(page: Page, name: string): Promise<void> {
	await page.evaluate(name => (globalThis as DestinationScope).__motionSustainedDestination.prepare(name), name);
}
export async function snapshotMotionSustainedDestination(page: Page): Promise<MotionSustainedDestinationSnapshot> {
	return page.evaluate(() => (globalThis as DestinationScope).__motionSustainedDestination.snapshot());
}
export async function cleanupMotionSustainedDestination(page: Page): Promise<MotionSustainedDestinationSnapshot> {
	return page.evaluate(() => (globalThis as DestinationScope).__motionSustainedDestination.cleanup());
}
export async function readMotionSustainedDestination(page: Page, name: string, destinationPath: string) {
	const before = await snapshotMotionSustainedDestination(page);
	if (before.name !== name || !before.closed || before.aborted || before.removed || before.bytes < 1 || before.bytes > 512 * 1024 * 1024) throw new Error('Sustained destination did not close successfully.');
	const handle = await open(destinationPath, 'wx'); const hash = createHash('sha256'); let offset = 0, readCalls = 0, maxReadBytes = 0; let complete = false;
	try {
		while (offset < before.bytes) {
			const length = Math.min(65536, before.bytes - offset);
			const part = await page.evaluate(request => (globalThis as DestinationScope).__motionSustainedDestination.read(request.name, request.offset, request.length), { name, offset, length });
			if (part.size !== before.bytes || part.bytes.length !== length || part.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Sustained destination read changed.');
			const bytes = Buffer.from(part.bytes); let written = 0;
			while (written < length) { const result = await handle.write(bytes.subarray(written)); if (!result.bytesWritten) throw new Error('Sustained output write stalled.'); written += result.bytesWritten; }
			hash.update(bytes); offset += length; readCalls++; maxReadBytes = Math.max(maxReadBytes, length);
		}
		if (JSON.stringify(await snapshotMotionSustainedDestination(page)) !== JSON.stringify(before)) throw new Error('Sustained destination changed during transfer.');
		await handle.sync(); complete = true; return { byteLength: offset, sha256: hash.digest('hex'), readCalls, maxReadBytes };
	} finally { try { await handle.close(); } finally { if (!complete) await rm(destinationPath, { force: true }); } }
}

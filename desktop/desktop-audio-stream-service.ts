/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdtemp, open, rm, statfs, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { normalizeDesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityQuery } from './desktop-audio-codec-capability-contract.ts';
import { normalizeDesktopAudioStreamCommand, DESKTOP_AUDIO_STREAM_MAXIMUM_BYTES,
	type DesktopAudioStreamPlan } from './desktop-audio-stream-contract.ts';

export interface DesktopAudioStreamJob {
	readonly schemaVersion: 1; readonly type: 'audio-stream-job'; readonly plan: DesktopAudioStreamPlan;
	readonly inputPath: string; readonly outputPath: string; readonly inputSha256: string;
}
interface Session<Owner extends object> {
	readonly owner: Owner; readonly plan: DesktopAudioStreamPlan; readonly directory: string;
	readonly inputPath: string; readonly outputPath: string; readonly controller: AbortController;
	readonly hash: ReturnType<typeof createHash>;
	input: FileHandle | null; output: FileHandle | null; offset: number; outputBytes: number | null;
	busy: boolean; pending: Promise<unknown> | null; encodedFrames: number;
}
export interface DesktopAudioStreamService<Owner extends object> {
	command(owner: Owner, command: unknown): Promise<unknown>;
	revokeOwner(owner: Owner): Promise<boolean>;
	dispose(): Promise<void>;
}

/** Main owns all scratch paths, file handles, session identities and cancellation. */
export function createDesktopAudioStreamService<Owner extends object>(options: Readonly<{
	readonly scratchRoot: string;
	readonly capabilities: (query: DesktopAudioCodecCapabilityQuery) => Promise<unknown>;
	readonly execute: (job: DesktopAudioStreamJob, signal: AbortSignal, onProgress?: (frames: number) => void) => Promise<number>;
	readonly availableScratchBytes?: () => Promise<bigint>;
	readonly removeScratch?: (directory: string) => Promise<void>;
}>): DesktopAudioStreamService<Owner> {
	if (!isAbsolute(options.scratchRoot) || options.scratchRoot.includes('\0')) {
		throw new TypeError('Desktop streaming audio requires an absolute private scratch root.');
	}
	const sessions = new Map<string, Session<Owner>>();
	let disposed = false; let reserved = 0; let chargedScratchBytes = 0;
	const revokedOwners = new WeakSet<Owner>();
	const cleanups = new WeakMap<Session<Owner>, Promise<void>>();
	let disposal: Promise<void> | null = null;
	const cleanup = (id: string, session: Session<Owner>): Promise<void> => {
		const existing = cleanups.get(session); if (existing) return existing;
		const operation = (async () => {
			session.controller.abort(new Error('The desktop audio stream session stopped.'));
			if (session.pending) await Promise.allSettled([session.pending]);
			const failures: unknown[] = []; let removed = false;
			if (session.input) { try { await session.input.close(); session.input = null; } catch (error) { failures.push(error); } }
			if (session.output) { try { await session.output.close(); session.output = null; } catch (error) { failures.push(error); } }
			try {
				if (options.removeScratch) await options.removeScratch(session.directory);
				else await rm(session.directory, { recursive: true, force: true });
				removed = true;
			} catch (error) { failures.push(error); }
			if (removed && !session.input && !session.output && sessions.get(id) === session) {
				sessions.delete(id); chargedScratchBytes -= session.plan.frameCount * session.plan.tuple.channelCount * 4 + session.plan.maximumOutputBytes;
			}
			if (failures.length) throw new AggregateError(failures, 'Desktop audio scratch cleanup failed.', { cause: failures[0] });
		})();
		const settled = operation.catch((error: unknown) => { cleanups.delete(session); throw error; });
		cleanups.set(session, settled); return settled;
	};
	const cleanupSessions = async (entries: readonly (readonly [string, Session<Owner>])[]): Promise<void> => {
		const results = await Promise.allSettled(entries.map(([id, session]) => cleanup(id, session)));
		const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (failures.length) throw new AggregateError(failures, 'Desktop audio session teardown failed.', { cause: failures[0] });
	};
	return Object.freeze({
		async command(owner: Owner, value: unknown): Promise<unknown> {
			if (!owner || typeof owner !== 'object') throw new TypeError('Desktop audio stream requires an owner.');
			if (disposed || revokedOwners.has(owner)) throw new Error('The desktop audio stream service or owner stopped.');
			const command = normalizeDesktopAudioStreamCommand(value);
			if (command.type === 'begin') {
				if (sessions.size + reserved >= 2) throw new Error('The desktop audio stream session limit was reached.');
				reserved += 1;
				const scratchBytes = command.plan.frameCount * command.plan.tuple.channelCount * 4 + command.plan.maximumOutputBytes;
				chargedScratchBytes += scratchBytes;
				let published = false;
				let directory: string | null = null; let input: FileHandle | null = null;
				try {
					const available = options.availableScratchBytes ? await options.availableScratchBytes()
						: await statfs(options.scratchRoot, { bigint: true }).then((volume) => volume.bavail * volume.bsize);
					if (typeof available !== 'bigint' || available < BigInt(chargedScratchBytes)) throw new RangeError('Desktop streaming audio requires more free scratch storage.');
					const query: DesktopAudioCodecCapabilityQuery = { schemaVersion: 2, operations: [command.plan.tuple] };
					const capability = normalizeDesktopAudioCodecCapabilityResult(await options.capabilities(query), query).capabilities[0]!;
					if (!capability.available || capability.provider !== 'bundled') {
						throw new Error('Large desktop audio export requires its execution-verified bundled encoder.');
					}
					if (disposed || revokedOwners.has(owner)) throw new Error('The desktop audio stream service or owner stopped.');
					directory = await mkdtemp(join(options.scratchRoot, 'stream-'));
					const inputPath = join(directory, 'input.pcm'); const outputPath = join(directory, 'output.audio');
					input = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
					if (disposed || revokedOwners.has(owner)) throw new Error('The desktop audio stream owner stopped during staging.');
					const operationId = `desktop-audio-stream-${randomBytes(16).toString('hex')}`;
					sessions.set(operationId, { owner, plan: command.plan, directory, inputPath, outputPath,
						controller: new AbortController(), hash: createHash('sha256'), input, output: null, offset: 0,
						outputBytes: null, busy: false, pending: null, encodedFrames: 0 });
					published = true;
					return Object.freeze({ operationId });
				} catch (error) {
					const failures: unknown[] = [error];
					if (input) { try { await input.close(); } catch (cleanupError) { failures.push(cleanupError); } }
					if (directory) { try { await rm(directory, { recursive: true, force: true }); } catch (cleanupError) { failures.push(cleanupError); } }
					if (failures.length > 1) throw new AggregateError(failures, 'Desktop audio admission and cleanup failed.', { cause: error });
					throw error;
				}
				finally { reserved -= 1; if (!published) chargedScratchBytes -= scratchBytes; }
			}
			const session = sessions.get(command.operationId);
			if (!session || session.owner !== owner) throw new Error('Desktop audio stream owner or identity does not match.');
			if (command.type === 'delete') { await cleanup(command.operationId, session); return true; }
			if (session.controller.signal.aborted) throw new Error('The desktop audio stream session stopped.');
			if (command.type === 'status') return Object.freeze({ frames: session.encodedFrames, frameCount: session.plan.frameCount });
			if (session.busy) throw new Error('A desktop audio stream command is already in progress.');
			session.busy = true;
			const operation = (async () => {
				if (command.type === 'write') {
					if (!session.input || session.outputBytes !== null) throw new Error('Desktop audio stream input is closed.');
					if (command.offset !== session.offset) throw new Error('Desktop audio stream input offset drifted.');
					const total = session.plan.frameCount * session.plan.tuple.channelCount * 4;
					if (command.bytes.byteLength > total - session.offset) throw new RangeError('Desktop audio stream input exceeds its exact byte bound.');
					let written = 0;
					while (written < command.bytes.byteLength) {
						const result = await session.input.write(command.bytes, written, command.bytes.byteLength - written, session.offset + written);
						if (result.bytesWritten < 1) throw new Error('Desktop audio stream input write stalled.');
						written += result.bytesWritten;
					}
					session.hash.update(command.bytes); session.offset += written;
					return Object.freeze({ offset: session.offset });
				}
				if (command.type === 'execute') {
					if (!session.input || session.offset !== session.plan.frameCount * session.plan.tuple.channelCount * 4) {
						throw new Error('Desktop audio stream input must be complete before execution.');
					}
					await session.input.close(); session.input = null;
					const outputBytes = await options.execute({ schemaVersion: 1, type: 'audio-stream-job', plan: session.plan,
						inputPath: session.inputPath, outputPath: session.outputPath, inputSha256: session.hash.digest('hex') }, session.controller.signal, (frames) => {
						if (Number.isSafeInteger(frames) && frames >= session.encodedFrames && frames <= session.plan.frameCount) session.encodedFrames = frames;
					});
					if (!Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > session.plan.maximumOutputBytes
						|| outputBytes > DESKTOP_AUDIO_STREAM_MAXIMUM_BYTES) throw new Error('Desktop audio stream output exceeded its bound.');
					session.output = await open(session.outputPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
					const metadata = await session.output.stat();
					if (!metadata.isFile() || metadata.size !== outputBytes) throw new Error('Desktop audio stream output changed after execution.');
					session.outputBytes = outputBytes; session.encodedFrames = session.plan.frameCount;
					return Object.freeze({ byteLength: outputBytes });
				}
				if (session.outputBytes === null || !session.output) throw new Error('Desktop audio stream output is unavailable.');
				if (command.type === 'stat') return Object.freeze({ byteLength: session.outputBytes });
				if (command.type !== 'read') throw new Error('Unsupported desktop audio stream command.');
				if (command.offset >= session.outputBytes) throw new RangeError('Desktop audio stream output range exceeds its bounds.');
				const length = Math.min(command.maximumBytes, session.outputBytes - command.offset);
				const bytes = new Uint8Array(length); let received = 0;
				while (received < length) {
					const result = await session.output.read(bytes, received, length - received, command.offset + received);
					if (result.bytesRead < 1) throw new Error('Desktop audio stream output range is truncated.');
					received += result.bytesRead;
				}
				return bytes;
			})();
			session.pending = operation;
			try { return await operation; } finally { session.busy = false; session.pending = null; }
		},
		async revokeOwner(owner: Owner): Promise<boolean> {
			revokedOwners.add(owner);
			const owned = [...sessions.entries()].filter(([, session]) => session.owner === owner);
			await cleanupSessions(owned);
			return owned.length > 0;
		},
		dispose(): Promise<void> {
			disposed = true;
			disposal ??= cleanupSessions([...sessions.entries()])
				.catch((error: unknown) => { disposal = null; throw error; });
			return disposal;
		},
	});
}

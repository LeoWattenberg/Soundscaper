/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomUUID, type Hash } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { normalizeMotionRenderPlan, type MotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { openMotionNativeFrameReader } from '../src/common/editor/motion-native-frame-carrier-v1.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { MOTION_DELIVERY_CHUNK_BYTES, MOTION_PRORES_DELIVERY_PROFILE, type MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
import { hashMotionscaperNativeOutput, type MotionNativeEncoder } from './motionscaper-native-executor.ts';
interface Fingerprint { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
interface Job {
	readonly token: string; readonly plan: MotionRenderPlan; readonly directory: string; readonly source: string;
	readonly output: string; readonly destination: string; readonly fingerprint: Fingerprint | null;
	readonly file: FileHandle; readonly digest: Hash; readonly signal: AbortController; readonly maximumBytes: number;
	bytes: number; closed: boolean; failed: boolean; pending: Promise<void> | null;
}
export interface MotionDeliveryAuthority extends MotionDesktopDelivery { abortActive(): Promise<void>; dispose(): Promise<void> }
export function createMotionscaperDeliveryAuthority(options: {
	readonly encoder: MotionNativeEncoder | null; readonly chooseOutput: (suggestedName: string) => Promise<string | null>;
}): MotionDeliveryAuthority {
	let current: Job | null = null; let opening = false; let disposed = false;
	const active = () => { if (disposed) throw new Error('Motionscaper delivery authority is closed.'); };
	const getJob = (token: string) => { active(); if (!current || token !== current.token) throw new Error('Unknown Motionscaper delivery capability.'); return current; };
	async function clean(job: Job) {
		if (!job.closed) { job.closed = true; await job.file.close(); }
		await rm(job.directory, { recursive: true, force: true }); if (current === job) current = null;
	}
	async function operation<T>(job: Job, action: () => Promise<T>): Promise<T> {
		if (job.pending || job.failed) throw new Error('Motionscaper delivery capability is busy or failed.');
		let done!: () => void; job.pending = new Promise<void>(resolve => { done = resolve; });
		try { job.signal.signal.throwIfAborted(); return await action(); }
		catch (error) { job.failed = true; throw error; }
		finally { job.pending = null; done(); }
	}
	return {
		getProfile() { active(); return Promise.resolve(options.encoder ? MOTION_PRORES_DELIVERY_PROFILE : null); },
		async begin(request) {
			active(); if (!options.encoder) throw new Error('Motionscaper native ProRes export is unavailable.');
			if (current || opening) throw new Error('A Motionscaper native render is already active.');
			const plan = normalizeMotionRenderPlan(request.plan);
			const maximumBytes = 65_600 + plan.frameCount * (48 + plan.width * plan.height * 16);
			if (plan.frameCount > MOTION_PRORES_DELIVERY_PROFILE.maximumFrames || plan.width > 16384 || plan.height > 16384 || plan.frameRate.num > 0x7fffffff || plan.frameRate.den > 0x7fffffff
				|| maximumBytes > 256 * 1024 ** 3) throw new RangeError('Motionscaper native carrier exceeds its bounded delivery profile.');
			if (typeof request.suggestedName !== 'string' || request.suggestedName.length > 512) throw new TypeError('Motionscaper native output name is invalid.');
			opening = true;
			try {
				const name = [...basename(request.suggestedName.replaceAll('\\', '/'))].filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').replace(/\.mov$/iu, '') || 'Motionscaper';
				const destination = await options.chooseOutput(`${name}.mov`); if (destination === null) return null; active();
				if (!isAbsolute(destination) || extname(destination).toLowerCase() !== '.mov') throw new Error('Choose an absolute Motionscaper MOV destination.');
				const fingerprint = await optionalFile(destination);
				const directory = await mkdtemp(join(dirname(destination), '.motionscaper-export-'));
				const source = join(directory, 'frames.mfc'); const output = join(directory, 'output.mov');
				try {
					await chmod(directory, 0o700); const file = await open(source, 'wx+', 0o600);
					const job: Job = { token: randomUUID(), plan, directory, source, output, destination, fingerprint, file,
						digest: createHash('sha256'), signal: new AbortController(), maximumBytes, bytes: 0, closed: false, failed: false, pending: null };
					current = job; if (disposed) { await clean(job); active(); } return { token: job.token };
				} catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
			} finally { opening = false; }
		},
		async write({ token, offset, bytes }) {
			const job = getJob(token);
			if (offset !== job.bytes || !Number.isSafeInteger(offset) || !(bytes instanceof Uint8Array)
				|| bytes.byteLength < 1 || bytes.byteLength > MOTION_DELIVERY_CHUNK_BYTES
				|| bytes.byteLength > job.maximumBytes - job.bytes) throw new RangeError('Motionscaper native chunk is outside its sequential bounded capability.');
			const chunk = new Uint8Array(bytes);
			await operation(job, async () => {
				let written = 0;
				while (written < chunk.byteLength) {
					job.signal.signal.throwIfAborted();
					const result = await job.file.write(chunk, written, chunk.byteLength - written, offset + written);
					if (!result.bytesWritten) throw new Error('Motionscaper native carrier write made no progress.'); written += result.bytesWritten;
				}
				job.digest.update(chunk); job.bytes += chunk.byteLength;
			});
		},
		async commit({ token, byteLength, sha256 }) {
			const job = getJob(token);
			return operation(job, async () => {
				try {
					if (byteLength !== job.bytes || job.digest.copy().digest('hex') !== sha256) throw new Error('Motionscaper native carrier length or digest differs from its grant.');
					const source = createScapeArchiveByteSource({ size: job.bytes, maximumReadBytes: MOTION_DELIVERY_CHUNK_BYTES, async read({ offset, length }) {
						const bytes = new Uint8Array(length); let count = 0;
						while (count < length) {
							const result = await job.file.read(bytes, count, length - count, offset + count);
							if (!result.bytesRead) throw new Error('Motionscaper native carrier is truncated.'); count += result.bytesRead;
						}
						return bytes;
					} });
					const reader = await openMotionNativeFrameReader(source, job.plan.identity, job.signal.signal);
					const { identity, width, height, frameRate, firstFrame, frameCount } = reader.header;
					if (JSON.stringify({ identity, width, height, frameRate, firstFrame, frameCount }) !== JSON.stringify(job.plan)) throw new Error('Motionscaper native carrier changed its pinned render plan.');
					await job.file.sync(); await job.file.close(); job.closed = true;
					const encoded = await options.encoder!.encode({ source: job.source, output: job.output, plan: job.plan,
						byteLength, sha256, signal: job.signal.signal });
					job.signal.signal.throwIfAborted();
					const verified = await hashMotionscaperNativeOutput(job.output, job.signal.signal);
					if (verified.byteLength !== encoded.byteLength || verified.sha256 !== encoded.sha256 || encoded.frameCount !== job.plan.frameCount) throw new Error('Motionscaper native encoder returned a mismatched output receipt.');
					await chmod(job.output, 0o600); const output = await open(job.output, 'r');
					try { await output.sync(); } finally { await output.close(); }
					if (JSON.stringify(await optionalFile(job.destination)) !== JSON.stringify(job.fingerprint)) throw new Error('Motionscaper native destination changed during rendering.');
					job.signal.signal.throwIfAborted(); await rename(job.output, job.destination);
					// A successful replacement is publication; later cancellation cannot revoke it.
					if (process.platform !== 'win32') { const directory = await open(dirname(job.destination), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
					return { identity: job.plan.identity, name: basename(job.destination), ...verified, frameCount: job.plan.frameCount, profile: MOTION_PRORES_DELIVERY_PROFILE };
				} finally { await clean(job); }
			});
		},
		async cancel({ token }) { const job = getJob(token); job.signal.abort(); await job.pending; await clean(job); },
		async abortActive() { const job = current; if (job) { job.signal.abort(); await job.pending; await clean(job); } },
		async dispose() { disposed = true; const job = current; if (job) { job.signal.abort(); await job.pending; await clean(job); } },
	};
}
async function optionalFile(path: string): Promise<Fingerprint | null> {
	try {
		const value = await lstat(path);
		if (!value.isFile() || value.isSymbolicLink()) throw new Error('Motionscaper native destination must be a regular file.');
		return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs };
	} catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
}

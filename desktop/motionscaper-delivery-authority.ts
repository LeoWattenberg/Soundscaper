/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomUUID, type Hash } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { normalizeMotionRenderPlan, type MotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { motionNativePcmPlan, openMotionNativePcmReader, type MotionNativePcmPlan } from '../src/common/editor/motion-native-pcm-carrier-v1.ts';
import { openMotionNativeFrameReader } from '../src/common/editor/motion-native-frame-carrier-v1.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { MOTION_DELIVERY_CHUNK_BYTES, MOTION_PRORES_DELIVERY_PROFILE, type MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
import { hashMotionscaperNativeOutput, type MotionNativeEncoder } from './motionscaper-native-executor.ts';
interface Fingerprint { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
interface Upload {
	readonly file: FileHandle; readonly digest: Hash; readonly maximumBytes: number; bytes: number; closed: boolean;
}
interface AudioUpload extends Upload { readonly source: string; readonly plan: MotionNativePcmPlan }
interface Job extends Upload {
	readonly token: string; readonly plan: MotionRenderPlan; readonly directory: string; readonly source: string;
	readonly output: string; readonly destination: string; readonly fingerprint: Fingerprint | null;
	readonly signal: AbortController; readonly audio: AudioUpload | null;
	failed: boolean; pending: Promise<void> | null;
}
export interface MotionDeliveryAuthority extends MotionDesktopDelivery { abortActive(): Promise<void>; dispose(): Promise<void> }
export function createMotionscaperDeliveryAuthority(options: {
	readonly encoder: MotionNativeEncoder | null; readonly chooseOutput: (suggestedName: string) => Promise<string | null>;
}): MotionDeliveryAuthority {
	let current: Job | null = null; let opening = false; let disposed = false; let releasedToken: string | null = null;
	const active = () => { if (disposed) throw new Error('Motionscaper delivery authority is closed.'); };
	const getJob = (token: string) => { active(); if (!current || token !== current.token) throw new Error('Unknown Motionscaper delivery capability.'); return current; };
	async function clean(job: Job) {
		const failures: unknown[] = [];
		for (const upload of [job, job.audio]) { try { if (upload && !upload.closed) { await upload.file.close(); upload.closed = true; } } catch (error) { failures.push(error); } }
		try { await rm(job.directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Motionscaper native temporary custody cleanup failed.');
		if (current === job) current = null; releasedToken = job.token;
	}
	async function conclude<T>(job: Job, action: () => Promise<T>): Promise<T> {
		let result: T;
		try { result = await action(); }
		catch (primary) {
			try { await clean(job); } catch (failure) { throw new AggregateError([primary, failure], 'Motionscaper native export and custody cleanup failed.', { cause: failure }); }
			throw primary;
		}
		await clean(job); return result;
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
			const audioPlan = request.audio ? motionNativePcmPlan(plan, request.audio) : null;
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
					let audio: AudioUpload | null = null;
					try { if (audioPlan) { const source = join(directory, 'audio.mpc'); audio = { source, plan: audioPlan, file: await open(source, 'wx+', 0o600), digest: createHash('sha256'), maximumBytes: 65600 + audioPlan.sampleCount * audioPlan.channels * 4, bytes: 0, closed: false }; } } catch (error) { await file.close(); throw error; }
					const job: Job = { token: randomUUID(), plan, directory, source, output, destination, fingerprint, file,
						audio, digest: createHash('sha256'), signal: new AbortController(), maximumBytes, bytes: 0, closed: false, failed: false, pending: null };
					current = job; if (disposed) { await clean(job); active(); } return { token: job.token };
				} catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
			} finally { opening = false; }
		},
		async write({ token, offset, bytes, stream }) {
			const job = getJob(token);
			if (stream !== undefined && stream !== 'audio') throw new Error('Unknown Motionscaper delivery stream.');
			const upload = stream === 'audio' ? job.audio : job; if (!upload) throw new Error('This delivery has no audio capability.');
			if (offset !== upload.bytes || !Number.isSafeInteger(offset) || !(bytes instanceof Uint8Array)
				|| bytes.byteLength < 1 || bytes.byteLength > MOTION_DELIVERY_CHUNK_BYTES
				|| bytes.byteLength > upload.maximumBytes - upload.bytes) throw new RangeError('Motionscaper native chunk is outside its sequential bounded capability.');
			const chunk = new Uint8Array(bytes);
			await operation(job, async () => {
				let written = 0;
				while (written < chunk.byteLength) {
					job.signal.signal.throwIfAborted();
					const result = await upload.file.write(chunk, written, chunk.byteLength - written, offset + written);
					if (!result.bytesWritten) throw new Error('Motionscaper native carrier write made no progress.'); written += result.bytesWritten;
				}
				upload.digest.update(chunk); upload.bytes += chunk.byteLength;
			});
		},
		async commit({ token, byteLength, sha256, audio }) {
			const job = getJob(token);
			return operation(job, () => conclude(job, async () => {
				if (byteLength !== job.bytes || job.digest.copy().digest('hex') !== sha256) throw new Error('Motionscaper native carrier length or digest differs from its grant.');
				const source = byteSource(job);
				const reader = await openMotionNativeFrameReader(source, job.plan.identity, job.signal.signal);
				const { identity, width, height, frameRate, firstFrame, frameCount } = reader.header;
				const pinned = job.plan;
				if (JSON.stringify({ identity, width, height, frameRate, firstFrame, frameCount }) !== JSON.stringify({ identity: pinned.identity, width: pinned.width, height: pinned.height, frameRate: pinned.frameRate, firstFrame: pinned.firstFrame, frameCount: pinned.frameCount })) throw new Error('Motionscaper native carrier changed its pinned render plan.');
				if (Boolean(audio) !== Boolean(job.audio)) throw new Error('Motionscaper PCM sidecar is missing or unadmitted.');
				if (job.audio && audio) {
					if (audio.byteLength !== job.audio.bytes || audio.sha256 !== job.audio.digest.copy().digest('hex') || audio.sampleCount !== job.audio.plan.sampleCount) throw new Error('Motionscaper PCM sidecar digest, length or sample count differs from its grant.');
					await openMotionNativePcmReader(byteSource(job.audio), job.audio.plan, job.signal.signal);
					await job.audio.file.sync(); await job.audio.file.close(); job.audio.closed = true;
				}
				await job.file.sync(); await job.file.close(); job.closed = true;
				const encoded = await options.encoder!.encode({ source: job.source, output: job.output, plan: job.plan,
					byteLength, sha256, signal: job.signal.signal, ...(job.audio && audio ? { audio: { source: job.audio.source, plan: job.audio.plan, ...audio } } : {}) });
				job.signal.signal.throwIfAborted();
				const verified = await hashMotionscaperNativeOutput(job.output, job.signal.signal);
				if (verified.byteLength !== encoded.byteLength || verified.sha256 !== encoded.sha256 || encoded.frameCount !== job.plan.frameCount || encoded.audioSamples !== (job.audio?.plan.sampleCount ?? 0)) throw new Error('Motionscaper native encoder returned a mismatched output receipt.');
				await chmod(job.output, 0o600); const output = await open(job.output, 'r');
				try { await output.sync(); } finally { await output.close(); }
				if (JSON.stringify(await optionalFile(job.destination)) !== JSON.stringify(job.fingerprint)) throw new Error('Motionscaper native destination changed during rendering.');
				job.signal.signal.throwIfAborted(); await rename(job.output, job.destination);
				// A successful replacement is publication; later cancellation cannot revoke it.
				if (process.platform !== 'win32') { const directory = await open(dirname(job.destination), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
				return { identity: job.plan.identity, name: basename(job.destination), ...verified, frameCount: job.plan.frameCount, profile: MOTION_PRORES_DELIVERY_PROFILE, audio: job.audio ? { sampleRate: job.audio.plan.sampleRate, channels: job.audio.plan.channels, sampleCount: job.audio.plan.sampleCount } : null };
			}));
		},
		async cancel({ token }) { active(); if (token === releasedToken) return; const job = getJob(token); job.signal.abort(); await job.pending; await clean(job); },
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

function byteSource(upload: Upload) {
	return createScapeArchiveByteSource({ size: upload.bytes, maximumReadBytes: MOTION_DELIVERY_CHUNK_BYTES, async read({ offset, length }) {
		const bytes = new Uint8Array(length); let count = 0;
		while (count < length) { const result = await upload.file.read(bytes, count, length - count, offset + count); if (!result.bytesRead) throw new Error('Motionscaper native carrier is truncated.'); count += result.bytesRead; }
		return bytes;
	} });
}

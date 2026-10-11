/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import type { MotionNativePcmPlan, MotionNativePcmReceipt } from '../src/common/editor/motion-native-pcm-carrier-v1.ts';
import type { MotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { loadMotionscaperNativeExecutable, type MotionNativeExecutable } from './motionscaper-native-payload.ts';
export interface MotionNativeEncodeRequest {
	readonly source: string; readonly output: string; readonly plan: MotionRenderPlan;
	readonly byteLength: number; readonly sha256: string; readonly signal: AbortSignal;
	readonly audio?: MotionNativePcmReceipt & { readonly source: string; readonly plan: MotionNativePcmPlan };
}
export interface MotionNativeEncodedFile { readonly byteLength: number; readonly sha256: string; readonly frameCount: number; readonly audioSamples: number }
export interface MotionNativeEncoder {
	encode(request: MotionNativeEncodeRequest): Promise<MotionNativeEncodedFile>;
}
const SELF_TEST = { productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1, operation: 'prores-4444',
	inputPixelFormat: 'rgba-f32le', encoderPixelFormat: 'yuva444p10', colorSpace: 'rec709', alphaMode: 'straight', maximumFrames: 32_768, pcmCarrierVersion: 1, audioCodec: 'pcm-s24le', maximumAudioSamples: 134_217_728 };
export async function createMotionscaperNativeEncoder(resourcesRoot: string, manifest: unknown): Promise<MotionNativeEncoder | null> {
	const executable = await loadMotionscaperNativeExecutable(resourcesRoot, manifest);
	if (!executable) return null;
	const runtimeTarget = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
	if (executable.manifest.target !== runtimeTarget) throw new Error('Motionscaper native helper is not target-native.');
	const result: unknown = JSON.parse(await execute(executable, ['--self-test'], new AbortController().signal, 10_000));
	if (JSON.stringify(result) !== JSON.stringify(SELF_TEST)) throw new Error('Motionscaper native helper advertised an unsupported capability.');
	return {
		async encode(request) {
			request.signal.throwIfAborted();
			await loadMotionscaperNativeExecutable(resourcesRoot, executable.manifest);
			const identity = request.plan.identity;
			const input: unknown = JSON.parse(await execute(executable, [request.audio ? '--encode-prores-4444-pcm-v1' : '--encode-prores-4444-v1', request.source, request.output,
				identity.projectId, identity.revisionDigest, identity.compositionId, String(request.byteLength), request.sha256, ...(request.audio ? [request.audio.source, String(request.audio.byteLength), request.audio.sha256] : [])], request.signal, 60 * 60 * 1000));
			if (!input || typeof input !== 'object' || Array.isArray(input)
				|| JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['productId', 'helperContractVersion', 'operation', 'byteLength', 'sha256', 'frameCount', 'audioSamples'].sort())) throw new Error('Motionscaper native export receipt fields are invalid.');
			const value = input as Record<string, unknown>;
			if (value.productId !== 'motionscaper' || value.helperContractVersion !== 1 || value.operation !== 'prores-4444'
				|| value.frameCount !== request.plan.frameCount || value.audioSamples !== (request.audio?.plan.sampleCount ?? 0) || typeof value.byteLength !== 'number' || !Number.isSafeInteger(value.byteLength)
				|| value.byteLength < 1 || value.byteLength > 256 * 1024 ** 3 || typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.sha256)) throw new Error('Motionscaper native export receipt identity is invalid.');
			const observed = await hashMotionscaperNativeOutput(request.output, request.signal);
			if (observed.byteLength !== value.byteLength || observed.sha256 !== value.sha256) throw new Error('Motionscaper native output differs from its receipt.');
			return { ...observed, frameCount: request.plan.frameCount, audioSamples: request.audio?.plan.sampleCount ?? 0 };
		},
	};
}
export async function hashMotionscaperNativeOutput(path: string, signal: AbortSignal): Promise<{ byteLength: number; sha256: string }> {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 256 * 1024 ** 3) throw new Error('Motionscaper native output is not a bounded regular file.');
	const digest = createHash('sha256'); let bytes = 0;
	for await (const chunk of createReadStream(path, { highWaterMark: MOTION_HASH_CHUNK_BYTES, signal })) { const data = chunk as Buffer; digest.update(data); bytes += data.byteLength; }
	const after = await lstat(path);
	if (bytes !== before.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Motionscaper native output changed while verifying.');
	return { byteLength: bytes, sha256: digest.digest('hex') };
}
const MOTION_HASH_CHUNK_BYTES = 1024 * 1024;
function execute(executable: MotionNativeExecutable, args: readonly string[], signal: AbortSignal, timeoutMs: number): Promise<string> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(executable.path, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
			env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) } });
		let stdout = ''; let stderr = ''; let bytes = 0; let failure: Error | null = null;
		let force: ReturnType<typeof setTimeout> | undefined;
		const terminate = (error: Error) => { if (failure) return; failure = error; child.kill(); force = setTimeout(() => { child.kill('SIGKILL'); }, 2000); };
		const abort = () => { terminate(new Error('Motionscaper native export was cancelled.')); };
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		const timeout = setTimeout(() => { terminate(new Error('Motionscaper native helper exceeded its execution deadline.')); }, timeoutMs);
		const collect = (kind: 'stdout' | 'stderr', data: Buffer) => {
			bytes += data.byteLength;
			if (bytes > 64 * 1024) { terminate(new Error('Motionscaper native helper exceeded its output limit.')); return; }
			if (kind === 'stdout') stdout += data.toString('utf8'); else stderr += data.toString('utf8');
		};
		child.stdout.on('data', (data: Buffer) => { collect('stdout', data); });
		child.stderr.on('data', (data: Buffer) => { collect('stderr', data); });
		child.on('error', (error) => { failure = error; });
		child.on('close', (code) => {
			clearTimeout(timeout); if (force) clearTimeout(force); signal.removeEventListener('abort', abort);
			if (failure || code !== 0) reject(failure ?? new Error(`Motionscaper native helper failed (${String(code)}): ${stderr.trim()}`)); else resolve(stdout);
		});
	});
}

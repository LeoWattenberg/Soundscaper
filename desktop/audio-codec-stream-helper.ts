/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import { normalizeDesktopAudioStreamPlan, audioStreamRecord, DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES,
	DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES } from './desktop-audio-stream-contract.ts';
import { bundledAudioCodecSpec, type BundledAudioCodecHelperConfiguration } from './bundled-audio-codec-helper-configuration.ts';

/** The helper reads and encodes one authenticated private PCM file in fixed packets. */
export async function runDesktopAudioStreamHelperJob(configuration: BundledAudioCodecHelperConfiguration,
	value: unknown, onProgress?: (frames: number, frameCount: number) => void,
): Promise<Readonly<{ contractVersion: 1; status: 'audio-stream-executed'; outputBytes: number }>> {
	const record = audioStreamRecord(value, ['schemaVersion', 'type', 'plan', 'inputPath', 'outputPath', 'inputSha256']);
	const plan = normalizeDesktopAudioStreamPlan(record.plan);
	const inputPath = safePath(record.inputPath); const outputPath = safePath(record.outputPath);
	if (record.schemaVersion !== 1 || record.type !== 'audio-stream-job' || inputPath === outputPath
		|| dirname(inputPath) !== dirname(outputPath) || typeof record.inputSha256 !== 'string'
		|| !/^[a-f0-9]{64}$/u.test(record.inputSha256)) throw new TypeError('Invalid desktop streaming audio scratch authority.');
	const spec = bundledAudioCodecSpec(configuration.codec);
	const payload = await readFile(join(configuration.runtimeRoot, spec.wasmFile));
	if (payload.byteLength !== configuration.wasmBytes || digest(payload) !== configuration.wasmSha256) {
		throw new Error('The desktop streaming audio payload changed.');
	}
	const input = await open(inputPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	let output: FileHandle | null = null;
	let session: Awaited<ReturnType<typeof openDedicatedAudioEncodeSession>> | null = null;
	let result: Readonly<{ contractVersion: 1; status: 'audio-stream-executed'; outputBytes: number }> | null = null;
	const failures: unknown[] = [];
	try {
		const initial = await input.stat();
		const inputBytes = plan.frameCount * plan.tuple.channelCount * 4;
		if (!initial.isFile() || initial.size !== inputBytes) throw new Error('Desktop streaming audio PCM geometry changed.');
		const hash = createHash('sha256'); const buffer = new Uint8Array(DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES);
		for (let offset = 0; offset < inputBytes;) {
			const length = Math.min(buffer.byteLength, inputBytes - offset);
			await readExact(input, buffer, length, offset); hash.update(buffer.subarray(0, length)); offset += length;
		}
		if (hash.digest('hex') !== record.inputSha256) throw new Error('Desktop streaming audio PCM digest changed.');
		const codecSettings = plan.tuple.settings as Readonly<Record<string, number>>;
		const settings = plan.tuple.format === 'flac' ? { compressionLevel: codecSettings.compressionLevel! } : codecSettings;
		if (plan.tuple.format === 'flac' && codecSettings.bitDepth !== 24) throw new RangeError('The reviewed desktop streaming FLAC profile requires 24-bit output.');
		session = await openDedicatedAudioEncodeSession({ format: plan.tuple.format as BrowserDedicatedAudioFormat, frameCount: plan.frameCount,
			channelCount: plan.tuple.channelCount, sampleRate: plan.tuple.sampleRate, settings },
		{ loadPayload: async () => new Uint8Array(payload) });
		output = await open(outputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
		let outputBytes = 0;
		const emit = async (bytes: Uint8Array): Promise<void> => {
			if (!(bytes instanceof Uint8Array) || bytes.byteLength > DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES
				|| bytes.byteLength > plan.maximumOutputBytes - outputBytes) throw new RangeError('Desktop streaming audio output exceeded its bound.');
			await writeExact(output!, bytes, outputBytes); outputBytes += bytes.byteLength;
		};
		let lastProgress = 0;
		onProgress?.(0, plan.frameCount);
		for (let frame = 0; frame < plan.frameCount;) {
			const frames = Math.min(DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES, plan.frameCount - frame);
			const length = frames * plan.tuple.channelCount * 4;
			await readExact(input, buffer, length, frame * plan.tuple.channelCount * 4);
			await emit(session.write(buffer.subarray(0, length), frames)); frame += frames;
			if (Date.now() - lastProgress >= 200 || frame === plan.frameCount) { onProgress?.(frame, plan.frameCount); lastProgress = Date.now(); }
		}
		const final = session.finish(); await emit(final.bytes);
		if (final.prefixPatch.byteLength > outputBytes || final.prefixPatch.byteLength > DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES) {
			throw new Error('Desktop streaming audio prefix patch exceeded the output.');
		}
		await writeExact(output, final.prefixPatch, 0);
		const last = await input.stat();
		if (last.dev !== initial.dev || last.ino !== initial.ino || last.size !== initial.size
			|| last.mtimeMs !== initial.mtimeMs || last.ctimeMs !== initial.ctimeMs) throw new Error('Desktop streaming audio PCM changed while encoding.');
		if (outputBytes < 1) throw new Error('Desktop streaming audio produced empty output.');
		result = Object.freeze({ contractVersion: 1, status: 'audio-stream-executed', outputBytes });
	} catch (error) { failures.push(error); }
	await closeDesktopAudioStreamHelperResources([...(session ? [session] : []), ...(output ? [output] : []), input], failures);
	return result!;
}

/** Finalize every opened resource while retaining the primary encoding failure. */
export async function closeDesktopAudioStreamHelperResources(resources: readonly Readonly<{ close(): void | Promise<void> }>[],
	priorFailures: readonly unknown[] = [],
): Promise<void> {
	const failures = [...priorFailures];
	for (const resource of resources) { try { await resource.close(); } catch (error) { failures.push(error); } }
	if (failures.length > 1) throw new AggregateError(failures, 'Desktop utility audio encoding and cleanup failed.', { cause: failures[0] });
	if (failures.length) throw failures[0];
}
function safePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || value.length > 4096
		|| value.split(/[\\/]/u).includes('..')) throw new TypeError('Invalid desktop streaming audio scratch path.');
	return value;
}
function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
async function readExact(handle: FileHandle, bytes: Uint8Array, length: number, position: number): Promise<void> {
	let offset = 0;
	while (offset < length) {
		const result = await handle.read(bytes, offset, length - offset, position + offset);
		if (result.bytesRead < 1) throw new Error('Desktop streaming audio PCM is truncated.'); offset += result.bytesRead;
	}
}
async function writeExact(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const result = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
		if (result.bytesWritten < 1) throw new Error('Desktop streaming audio output write stalled.'); offset += result.bytesWritten;
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded range I/O for authenticated canonical Float32 assistance WAVs. */

import { constants } from 'node:fs';
import { createHash, randomUUID, type Hash } from 'node:crypto';
import { open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { createWavHeader } from '../src/common/editor/wav.js';
import type {
	AssistanceRuntimeFamilyInputGrantV1,
	AssistanceRuntimeFamilyOutputGrantV1,
} from './assistance-runtime-family-job-contract.ts';

export const ASSISTANCE_WAVE_RANGE_IO_MAXIMUM_BYTES = 1024 * 1024;
export const ASSISTANCE_WAVE_PCM_WINDOW_MAXIMUM_BYTES = 192 * 1024 ** 2;

const HEADER_BYTES = 44;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MAXIMUM_CHANNELS = 64;

export interface AssistanceFloat32WaveGeometryV1 {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly byteLength: number;
}

export interface AssistanceFloat32WaveReadRequestV1 {
	readonly startFrame: number;
	readonly frameCount: number;
	readonly channelStart: number;
	readonly channelCount: number;
}

export interface AssistanceFloat32WaveSourceV1 {
	readonly geometry: AssistanceFloat32WaveGeometryV1;
	readFrames(
		request: AssistanceFloat32WaveReadRequestV1,
		signal?: AbortSignal,
	): Promise<readonly Float32Array[]>;
	close(): Promise<void>;
}

export interface AssistanceFloat32WaveSealedOutputV1 {
	readonly byteLength: number;
	readonly sha256: string;
}

export interface AssistanceFloat32WaveSinkV1 {
	readonly geometry: AssistanceFloat32WaveGeometryV1;
	writeFrames(channels: readonly Float32Array[], signal?: AbortSignal): Promise<void>;
	seal(signal?: AbortSignal): Promise<AssistanceFloat32WaveSealedOutputV1>;
	publish(signal?: AbortSignal): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export interface AssistanceFloat32WaveStorageV1 {
	openSource(
		input: AssistanceRuntimeFamilyInputGrantV1,
		expectedSampleRate: number,
		signal?: AbortSignal,
	): Promise<AssistanceFloat32WaveSourceV1>;
	openSink(
		output: AssistanceRuntimeFamilyOutputGrantV1,
		geometry: AssistanceFloat32WaveGeometryV1,
		signal?: AbortSignal,
	): Promise<AssistanceFloat32WaveSinkV1>;
}

export interface AssistanceFloat32WaveIoEventV1 {
	readonly kind: 'input-read' | 'spool-write' | 'publication-read' | 'publication-write';
	readonly path: string;
	readonly position: number;
	readonly byteLength: number;
}

export function createNodeAssistanceFloat32WaveStorageV1(
	onIo?: (event: AssistanceFloat32WaveIoEventV1) => void,
): AssistanceFloat32WaveStorageV1 {
	if (onIo !== undefined && typeof onIo !== 'function') {
		throw new TypeError('The assistance WAV I/O observer is invalid.');
	}
	return Object.freeze({
		openSource: (input: AssistanceRuntimeFamilyInputGrantV1,
			expectedSampleRate: number, signal?: AbortSignal) =>
			openSource(input, expectedSampleRate, signal, onIo),
		openSink: (output: AssistanceRuntimeFamilyOutputGrantV1,
			geometry: AssistanceFloat32WaveGeometryV1, signal?: AbortSignal) =>
			openSink(output, geometry, signal, onIo),
	});
}

async function openSource(
	input: AssistanceRuntimeFamilyInputGrantV1,
	expectedSampleRate: number,
	signal: AbortSignal | undefined,
	onIo: ((event: AssistanceFloat32WaveIoEventV1) => void) | undefined,
): Promise<AssistanceFloat32WaveSourceV1> {
	signal?.throwIfAborted();
	const handle = await openVerified(input.path, constants.O_RDONLY, input.identity,
		input.byteLength, 'assistance WAV input');
	try {
		const header = await readExact(handle, input.path, 0, HEADER_BYTES,
			'input-read', signal, onIo);
		const geometry = reviewHeader(header, input.byteLength, expectedSampleRate);
		let closed = false;
		return Object.freeze({ geometry,
			async readFrames(request: AssistanceFloat32WaveReadRequestV1,
				readSignal?: AbortSignal) {
				if (closed) throw new Error('The assistance WAV source is closed.');
				return readFrames(handle, input.path, geometry, request, readSignal, onIo);
			},
			async close() {
				if (closed) return;
				closed = true;
				await handle.close();
			},
		});
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function readFrames(
	handle: FileHandle,
	path: string,
	geometry: AssistanceFloat32WaveGeometryV1,
	request: AssistanceFloat32WaveReadRequestV1,
	signal: AbortSignal | undefined,
	onIo: ((event: AssistanceFloat32WaveIoEventV1) => void) | undefined,
): Promise<readonly Float32Array[]> {
	signal?.throwIfAborted();
	const { startFrame, frameCount, channelStart, channelCount } = request;
	if (!integer(startFrame, 0, geometry.frameCount - 1)
		|| !integer(frameCount, 1, geometry.frameCount - startFrame)
		|| !integer(channelStart, 0, geometry.channelCount - 1)
		|| !integer(channelCount, 1, geometry.channelCount - channelStart)) {
		throw new RangeError('The assistance WAV frame range is outside its exact geometry.');
	}
	const blockAlign = geometry.channelCount * FLOAT_BYTES;
	const rangeBytes = frameCount * blockAlign;
	if (!Number.isSafeInteger(rangeBytes) || rangeBytes > ASSISTANCE_WAVE_PCM_WINDOW_MAXIMUM_BYTES) {
		throw new RangeError('The assistance WAV PCM window exceeds its bounded range capacity.');
	}
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	const maximumFrames = Math.max(1,
		Math.floor(ASSISTANCE_WAVE_RANGE_IO_MAXIMUM_BYTES / blockAlign));
	let completed = 0;
	while (completed < frameCount) {
		signal?.throwIfAborted();
		const frames = Math.min(maximumFrames, frameCount - completed);
		const position = HEADER_BYTES + (startFrame + completed) * blockAlign;
		const bytes = await readExact(handle, path, position, frames * blockAlign,
			'input-read', signal, onIo);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		for (let frame = 0; frame < frames; frame += 1) {
			for (let selected = 0; selected < channelCount; selected += 1) {
				const sample = view.getFloat32(
					(frame * geometry.channelCount + channelStart + selected) * FLOAT_BYTES, true,
				);
				if (!Number.isFinite(sample)) {
					throw new RangeError('Enhancement audio samples must be finite.');
				}
				channels[selected]![completed + frame] = sample;
			}
		}
		completed += frames;
	}
	return Object.freeze(channels);
}

async function openSink(
	output: AssistanceRuntimeFamilyOutputGrantV1,
	geometryValue: AssistanceFloat32WaveGeometryV1,
	signal: AbortSignal | undefined,
	onIo: ((event: AssistanceFloat32WaveIoEventV1) => void) | undefined,
): Promise<AssistanceFloat32WaveSinkV1> {
	signal?.throwIfAborted();
	const geometry = exactGeometry(geometryValue);
	if (geometry.byteLength > output.maximumByteLength) {
		throw new RangeError('An enhanced WAV exceeds its authenticated output reservation.');
	}
	const destination = await openVerified(output.path, constants.O_WRONLY, output.identity,
		0, 'assistance WAV output');
	await destination.close();
	const spoolPath = join(dirname(output.path),
		`.${basename(output.path)}.${randomUUID()}.assistance-wave-partial`);
	const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
	const spool = await open(spoolPath,
		constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow, 0o600);
	try {
		const header = canonicalHeader(geometry);
		const hash = createHash('sha256');
		hash.update(header);
		await writeExact(spool, spoolPath, header, 0, 'spool-write', signal, onIo);
		return createSink(output, geometry, spoolPath, spool, hash, onIo);
	} catch (error) {
		await spool.close();
		await unlink(spoolPath).catch(() => undefined);
		throw error;
	}
}

function createSink(
	output: AssistanceRuntimeFamilyOutputGrantV1,
	geometry: AssistanceFloat32WaveGeometryV1,
	spoolPath: string,
	spool: FileHandle,
	hash: Hash,
	onIo: ((event: AssistanceFloat32WaveIoEventV1) => void) | undefined,
): AssistanceFloat32WaveSinkV1 {
	let writtenFrames = 0;
	let spoolClosed = false;
	let sealed: AssistanceFloat32WaveSealedOutputV1 | null = null;
	let destinationTouched = false;
	let published = false;
	let cleaned = false;
	return Object.freeze({ geometry,
		async writeFrames(channels: readonly Float32Array[], signal?: AbortSignal) {
			signal?.throwIfAborted();
			if (sealed || spoolClosed || !Array.isArray(channels)
				|| channels.length !== geometry.channelCount) {
				throw new TypeError('The assistance WAV spool received invalid channel geometry.');
			}
			const frameCount = channels[0]?.length ?? 0;
			if (frameCount < 1 || writtenFrames + frameCount > geometry.frameCount
				|| channels.some((channel) => !(channel instanceof Float32Array)
					|| channel.length !== frameCount)) {
				throw new RangeError('The assistance WAV spool received inexact frame geometry.');
			}
			const blockAlign = geometry.channelCount * FLOAT_BYTES;
			const maximumFrames = Math.max(1,
				Math.floor(ASSISTANCE_WAVE_RANGE_IO_MAXIMUM_BYTES / blockAlign));
			for (let start = 0; start < frameCount; start += maximumFrames) {
				signal?.throwIfAborted();
				const frames = Math.min(maximumFrames, frameCount - start);
				const body = new Uint8Array(frames * blockAlign);
				const view = new DataView(body.buffer);
				for (let frame = 0; frame < frames; frame += 1) {
					for (let channel = 0; channel < geometry.channelCount; channel += 1) {
						const sample = channels[channel]![start + frame]!;
						if (!Number.isFinite(sample)) {
							throw new RangeError('An enhanced WAV sample is not finite.');
						}
						view.setFloat32((frame * geometry.channelCount + channel) * FLOAT_BYTES,
							sample, true);
					}
				}
				const position = HEADER_BYTES + (writtenFrames + start) * blockAlign;
				await writeExact(spool, spoolPath, body, position,
					'spool-write', signal, onIo);
				hash.update(body);
			}
			writtenFrames += frameCount;
		},
		async seal(signal?: AbortSignal) {
			signal?.throwIfAborted();
			if (sealed) return sealed;
			if (writtenFrames !== geometry.frameCount) {
				throw new RangeError('The assistance WAV spool ended before its exact frame count.');
			}
			await spool.close();
			spoolClosed = true;
			sealed = Object.freeze({ byteLength: geometry.byteLength,
				sha256: hash.digest('hex') });
			return sealed;
		},
		async publish(signal?: AbortSignal) {
			signal?.throwIfAborted();
			if (!sealed || published || cleaned) {
				throw new Error('The assistance WAV spool is not ready for publication.');
			}
			const source = await open(spoolPath, constants.O_RDONLY);
			let destination: FileHandle | null = null;
			try {
				destination = await openVerified(output.path, constants.O_WRONLY, output.identity,
					0, 'assistance WAV output');
				const buffer = new Uint8Array(ASSISTANCE_WAVE_RANGE_IO_MAXIMUM_BYTES);
				let position = 0;
				while (position < sealed.byteLength) {
					signal?.throwIfAborted();
					const length = Math.min(buffer.byteLength, sealed.byteLength - position);
					const { bytesRead } = await source.read(buffer, 0, length, position);
					onIo?.({ kind: 'publication-read', path: spoolPath,
						position, byteLength: length });
					if (bytesRead !== length) throw new Error('The assistance WAV spool ended early.');
					destinationTouched = true;
					await writeExact(destination, output.path, buffer.subarray(0, length), position,
						'publication-write', signal, onIo);
					position += length;
				}
				published = true;
			} finally {
				await source.close();
				await destination?.close();
			}
		},
		async commit() {
			if (!published || cleaned) return;
			cleaned = true;
			await unlink(spoolPath);
		},
		async rollback() {
			if (!spoolClosed) {
				spoolClosed = true;
				await spool.close().catch(() => undefined);
			}
			if (destinationTouched) {
				const destination = await openVerified(output.path, constants.O_WRONLY,
					output.identity, null, 'assistance WAV output');
				try { await destination.truncate(0); } finally { await destination.close(); }
			}
			published = false;
			if (!cleaned) {
				cleaned = true;
				await unlink(spoolPath).catch(() => undefined);
			}
		},
	});
}

async function openVerified(
	path: string,
	flags: number,
	identity: Readonly<{ readonly dev: number; readonly ino: number }>,
	expectedBytes: number | null,
	label: string,
): Promise<FileHandle> {
	if (await realpath(path) !== path) throw new TypeError(`The ${label} path changed.`);
	const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
	const handle = await open(path, flags | noFollow);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || Number(stat.dev) !== identity.dev || Number(stat.ino) !== identity.ino
			|| expectedBytes !== null && stat.size !== expectedBytes) {
			throw new Error(`The ${label} identity or exact length changed.`);
		}
		return handle;
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function readExact(
	handle: FileHandle,
	path: string,
	position: number,
	byteLength: number,
	kind: AssistanceFloat32WaveIoEventV1['kind'],
	signal: AbortSignal | undefined,
	onIo: ((event: AssistanceFloat32WaveIoEventV1) => void) | undefined,
): Promise<Uint8Array> {
	if (byteLength < 1 || byteLength > ASSISTANCE_WAVE_RANGE_IO_MAXIMUM_BYTES) {
		throw new RangeError('An assistance WAV range read exceeds its exact I/O bound.');
	}
	const output = new Uint8Array(byteLength);
	let completed = 0;
	while (completed < byteLength) {
		signal?.throwIfAborted();
		const length = byteLength - completed;
		onIo?.({ kind, path, position: position + completed, byteLength: length });
		const { bytesRead } = await handle.read(output, completed, length, position + completed);
		if (bytesRead < 1) throw new Error('An assistance WAV range ended unexpectedly.');
		completed += bytesRead;
	}
	return output;
}

async function writeExact(
	handle: FileHandle,
	path: string,
	bytes: Uint8Array,
	position: number,
	kind: AssistanceFloat32WaveIoEventV1['kind'],
	signal: AbortSignal | undefined,
	onIo: ((event: AssistanceFloat32WaveIoEventV1) => void) | undefined,
): Promise<void> {
	if (bytes.byteLength < 1 || bytes.byteLength > ASSISTANCE_WAVE_RANGE_IO_MAXIMUM_BYTES) {
		throw new RangeError('An assistance WAV write exceeds its exact I/O bound.');
	}
	let completed = 0;
	while (completed < bytes.byteLength) {
		signal?.throwIfAborted();
		const length = bytes.byteLength - completed;
		onIo?.({ kind, path, position: position + completed, byteLength: length });
		const { bytesWritten } = await handle.write(
			bytes, completed, length, position + completed,
		);
		if (bytesWritten < 1) throw new Error('An assistance WAV write made no progress.');
		completed += bytesWritten;
	}
}

function reviewHeader(
	header: Uint8Array,
	byteLength: number,
	expectedSampleRate: number,
): AssistanceFloat32WaveGeometryV1 {
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	if (ascii(header, 0) !== 'RIFF' || ascii(header, 8) !== 'WAVE'
		|| ascii(header, 12) !== 'fmt ' || view.getUint32(16, true) !== 16
		|| view.getUint16(20, true) !== 3 || ascii(header, 36) !== 'data') {
		throw new TypeError('Enhancement audio requires one canonical RIFF Float32 WAV.');
	}
	const channelCount = view.getUint16(22, true);
	const dataBytes = byteLength - HEADER_BYTES;
	const blockAlign = channelCount * FLOAT_BYTES;
	if (!integer(channelCount, 1, MAXIMUM_CHANNELS) || dataBytes < blockAlign
		|| dataBytes % blockAlign !== 0) {
		throw new RangeError('Enhancement audio changed its exact channel or frame geometry.');
	}
	const geometry = exactGeometry({ sampleRate: expectedSampleRate, channelCount,
		frameCount: dataBytes / blockAlign, byteLength });
	const expected = canonicalHeader(geometry);
	if (header.some((byte, index) => byte !== expected[index])) {
		throw new TypeError('Enhancement audio changed its canonical WAV header.');
	}
	return geometry;
}

function exactGeometry(value: AssistanceFloat32WaveGeometryV1): AssistanceFloat32WaveGeometryV1 {
	if (!integer(value.sampleRate, 1, 0xffff_ffff)
		|| !integer(value.channelCount, 1, MAXIMUM_CHANNELS)
		|| !integer(value.frameCount, 1, Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('The assistance WAV geometry is invalid.');
	}
	const byteLength = HEADER_BYTES + value.frameCount * value.channelCount * FLOAT_BYTES;
	if (!Number.isSafeInteger(byteLength) || value.byteLength !== byteLength) {
		throw new RangeError('The assistance WAV byte length disagrees with its exact geometry.');
	}
	canonicalHeader(value);
	return Object.freeze({ sampleRate: value.sampleRate, channelCount: value.channelCount,
		frameCount: value.frameCount, byteLength });
}

function canonicalHeader(geometry: AssistanceFloat32WaveGeometryV1): Uint8Array {
	const value: unknown = createWavHeader({ sampleRate: geometry.sampleRate,
		channelCount: geometry.channelCount, totalFrames: geometry.frameCount,
		bitDepth: 32, float: true, dither: false });
	if (!(value instanceof Uint8Array) || value.byteLength !== HEADER_BYTES) {
		throw new RangeError('The assistance WAV geometry exceeds canonical RIFF capacity.');
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function ascii(value: Uint8Array, offset: number): string {
	return String.fromCharCode(...value.subarray(offset, offset + 4));
}

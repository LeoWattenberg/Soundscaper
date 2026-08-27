/* SPDX-License-Identifier: AGPL-3.0-only */

/** Builds an ephemeral exact WAV audition with checked cleanup ranges omitted. */

export interface LocalAssistanceCleanupAuditionRange {
	readonly startSeconds: number;
	readonly endSeconds: number;
}

const HEADER_BYTES = 44;
const BYTES_PER_FRAME = 4;

export async function createLocalAssistanceCleanupAuditionWave(
	body: Blob,
	rangesValue: readonly LocalAssistanceCleanupAuditionRange[],
): Promise<Blob> {
	if (!(body instanceof Blob) || body.type !== 'audio/wav' || body.size <= HEADER_BYTES) {
		throw new TypeError('Cleanup audition requires one nonempty canonical Float32 mono WAV.');
	}
	const header = new Uint8Array(await body.slice(0, HEADER_BYTES).arrayBuffer());
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const dataBytes = body.size - HEADER_BYTES;
	if (text(header, 0, 4) !== 'RIFF' || text(header, 8, 4) !== 'WAVE'
		|| text(header, 12, 4) !== 'fmt ' || view.getUint32(16, true) !== 16
		|| view.getUint16(20, true) !== 3 || view.getUint16(22, true) !== 1
		|| view.getUint16(32, true) !== BYTES_PER_FRAME || view.getUint16(34, true) !== 32
		|| text(header, 36, 4) !== 'data' || view.getUint32(40, true) !== dataBytes
		|| view.getUint32(4, true) !== body.size - 8 || dataBytes % BYTES_PER_FRAME !== 0) {
		throw new TypeError('Cleanup audition WAV geometry is not canonical Float32 mono.');
	}
	const sampleRate = view.getUint32(24, true);
	if (sampleRate < 1 || view.getUint32(28, true) !== sampleRate * BYTES_PER_FRAME) {
		throw new RangeError('Cleanup audition WAV timing is invalid.');
	}
	const frameCount = dataBytes / BYTES_PER_FRAME;
	const ranges = frameRanges(rangesValue, sampleRate, frameCount);
	if (ranges.length === 0) return body;
	const parts: BlobPart[] = [];
	let startFrame = 0;
	let retainedFrames = 0;
	for (const range of ranges) {
		if (range.startFrame > startFrame) {
			parts.push(body.slice(HEADER_BYTES + startFrame * BYTES_PER_FRAME,
				HEADER_BYTES + range.startFrame * BYTES_PER_FRAME));
			retainedFrames += range.startFrame - startFrame;
		}
		startFrame = range.endFrame;
	}
	if (startFrame < frameCount) {
		parts.push(body.slice(HEADER_BYTES + startFrame * BYTES_PER_FRAME));
		retainedFrames += frameCount - startFrame;
	}
	if (retainedFrames < 1) {
		throw new RangeError('Cleanup audition cannot omit the complete selected waveform.');
	}
	const retainedBytes = retainedFrames * BYTES_PER_FRAME;
	view.setUint32(4, HEADER_BYTES + retainedBytes - 8, true);
	view.setUint32(40, retainedBytes, true);
	return new Blob([header, ...parts], { type: 'audio/wav' });
}

function frameRanges(
	values: readonly LocalAssistanceCleanupAuditionRange[],
	sampleRate: number,
	frameCount: number,
): readonly Readonly<{ startFrame: number; endFrame: number }>[] {
	const ranges = values.map((value) => {
		if (!Number.isFinite(value?.startSeconds) || !Number.isFinite(value?.endSeconds)
			|| value.startSeconds < 0 || value.endSeconds <= value.startSeconds) {
			throw new RangeError('A cleanup audition range is invalid.');
		}
		return { startFrame: Math.max(0, Math.min(frameCount,
			Math.floor(value.startSeconds * sampleRate))),
		endFrame: Math.max(0, Math.min(frameCount,
			Math.ceil(value.endSeconds * sampleRate))) };
	}).filter(({ startFrame, endFrame }) => endFrame > startFrame)
		.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	const merged: { startFrame: number; endFrame: number }[] = [];
	for (const range of ranges) {
		const prior = merged.at(-1);
		if (prior && range.startFrame <= prior.endFrame) {
			prior.endFrame = Math.max(prior.endFrame, range.endFrame);
		} else merged.push({ ...range });
	}
	return Object.freeze(merged.map((range) => Object.freeze({ ...range })));
}

function text(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

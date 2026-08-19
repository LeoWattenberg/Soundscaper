/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which frames of a video can be decoded without the ones before them.
 *
 * Trimming media losslessly means stream-copying, and a stream-copied run that
 * begins on a predicted frame decodes to garbage until the next keyframe: the
 * frames the project referenced would be in the file and unwatchable. So a run
 * has to begin on a keyframe, and something has to know where they are.
 *
 * FFmpeg's `showinfo` filter already reports it, per frame, in the same pass the
 * timing probe runs — measured against the pinned build, which prints
 * `n: <index> ... iskey:<0|1>` for every frame. This reads that rather than
 * adding a second probe or a second dependency.
 *
 * It is deliberately not part of the timing asset. That asset is persisted and
 * its schema is a contract; a keyframe index is a fact about the file needed at
 * the moment of trimming, and giving it a place in stored state would be
 * migrating a schema to hold a cache.
 */

const FRAME = /\bn:\s*(\d+)\b/iu;
const KEYFRAME = /\biskey:\s*1\b/iu;

/** Frame indexes that start a decodable run, ascending and without repeats. */
export function parseFfmpegVideoKeyframeLogs(lines: readonly string[]): readonly number[] {
	if (!Array.isArray(lines)) throw new TypeError('FFmpeg keyframe logs must be an array.');
	const keyframes = new Set<number>();
	let sawFrame = false;
	for (const line of lines) {
		if (typeof line !== 'string') throw new TypeError('Every FFmpeg keyframe log must be text.');
		if (!line.includes('showinfo')) continue;
		const frame = FRAME.exec(line);
		if (!frame) continue;
		sawFrame = true;
		const index = Number(frame[1]);
		if (!Number.isSafeInteger(index) || index < 0) {
			throw new RangeError('FFmpeg reported a frame index that is not a non-negative integer.');
		}
		if (KEYFRAME.test(line)) keyframes.add(index);
	}
	if (!sawFrame) throw new Error('FFmpeg reported no frames to index.');
	// The first frame of a decodable stream is always a keyframe. A stream that
	// says otherwise cannot be cut losslessly anywhere, and pretending frame 0
	// were one would produce exactly the unwatchable output this exists to avoid.
	if (!keyframes.has(0)) throw new Error('FFmpeg reported no keyframe at the start of the stream.');
	return Object.freeze([...keyframes].sort((left, right) => left - right));
}

/**
 * The keyframe at or before a frame.
 *
 * Answers where a lossless cut containing that frame has to begin.
 */
export function keyframeAtOrBefore(keyframes: readonly number[], frame: number): number {
	if (!Number.isSafeInteger(frame) || frame < 0) {
		throw new RangeError('A frame index must be a non-negative safe integer.');
	}
	let found = -1;
	for (const keyframe of keyframes) {
		if (keyframe > frame) break;
		found = keyframe;
	}
	if (found < 0) throw new RangeError(`No keyframe precedes frame ${String(frame)}.`);
	return found;
}

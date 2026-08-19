/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The commands that write a trimmed copy, losslessly.
 *
 * Every retained run is cut with `-c copy` and the runs are then joined with the
 * concat demuxer. Nothing is re-encoded, which is why trimming does not cost a
 * generation of quality — and why every run has to begin on a keyframe, since a
 * copied run starting on a predicted frame decodes to garbage until the next
 * one. `alignTrimMediaRunsToKeyframes` is what guarantees that; these commands
 * assume it has already been applied.
 *
 * Seeking is by the **midpoint** of the first frame rather than its start. A
 * rational rate like 30000/1001 has no exact decimal, so a seek time computed
 * from the frame index alone can land microscopically before or after the frame
 * it names; landing before means snapping to the previous keyframe and cutting
 * material the plan did not ask for, and landing after means missing the
 * keyframe entirely. Half a frame of tolerance makes both impossible at any
 * precision a double can express.
 *
 * Measured against the pinned build: a 90-frame 30000/1001 clip with keyframes
 * every ten frames, cut from frame 80 for seven frames, produced exactly seven
 * frames whose first frame's checksum equalled the source frame's.
 */

const SEEK_DECIMALS = 6;

export interface TrimMediaRational {
	readonly num: number;
	readonly den: number;
}

export interface TrimMediaCutRequest {
	readonly inputPath: string;
	/** Must be a keyframe; the runs are aligned before they reach here. */
	readonly startFrame: number;
	readonly frameCount: number;
	readonly frameRate: TrimMediaRational;
	/** The output container, which is the input's own: a copy changes nothing. */
	readonly container: string;
	readonly outputPath: string;
}

/** Seek time for the midpoint of a frame, as FFmpeg spells one. */
export function trimMediaSeekSeconds(startFrame: number, frameRate: TrimMediaRational): string {
	const start = nonNegativeInteger(startFrame, 'start frame');
	const rate = rational(frameRate);
	return (((start + 0.5) * rate.den) / rate.num).toFixed(SEEK_DECIMALS);
}

/** One retained run, copied out of the source without re-encoding. */
export function buildTrimMediaCutArgs(request: TrimMediaCutRequest): readonly string[] {
	const frameCount = positiveInteger(request?.frameCount, 'frame count');
	return Object.freeze([
		'-nostdin', '-y',
		// Seeking before the input is what makes this a copy rather than a
		// decode: FFmpeg jumps to the keyframe at or before the requested time.
		'-ss', trimMediaSeekSeconds(request?.startFrame, request?.frameRate),
		'-i', nonEmpty(request?.inputPath, 'input'),
		'-frames:v', String(frameCount),
		'-c', 'copy',
		// The run's own timestamps start wherever it was cut from; the join needs
		// each part to begin at zero.
		'-avoid_negative_ts', 'make_zero',
		'-f', nonEmpty(request?.container, 'container'),
		nonEmpty(request?.outputPath, 'output'),
	]);
}

/** Join the cut runs into the single trimmed copy. */
export function buildTrimMediaConcatArgs(request: Readonly<{
	listPath: string;
	container: string;
	outputPath: string;
}>): readonly string[] {
	return Object.freeze([
		'-nostdin', '-y',
		'-f', 'concat',
		// The parts are paths this code wrote into its own MEMFS, never names a
		// project supplied, so unsafe paths are refused where they are built.
		'-safe', '0',
		'-i', nonEmpty(request?.listPath, 'list'),
		'-c', 'copy',
		'-f', nonEmpty(request?.container, 'container'),
		nonEmpty(request?.outputPath, 'output'),
	]);
}

/** The concat demuxer's list file, which is the only place these paths appear. */
export function trimMediaConcatListText(paths: readonly string[]): string {
	if (!Array.isArray(paths) || paths.length === 0) {
		throw new TypeError('A concat list requires at least one part.');
	}
	return `${paths.map((path) => {
		const part = nonEmpty(path, 'concat part');
		if (part.includes("'") || part.includes('\n')) {
			throw new TypeError('A concat part path must not contain a quote or a newline.');
		}
		return `file '${part}'`;
	}).join('\n')}\n`;
}

function rational(value: TrimMediaRational | undefined): TrimMediaRational {
	if (!value || !Number.isSafeInteger(value.num) || !Number.isSafeInteger(value.den)
		|| value.num <= 0 || value.den <= 0) {
		throw new TypeError('A trim cut requires an exact rational frame rate.');
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`A trim cut ${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`A trim cut ${name} must be a positive safe integer.`);
	}
	return value;
}

function nonEmpty(value: unknown, label: string): string {
	const text = String(value ?? '').trim();
	if (!text) throw new TypeError(`A trim ${label} path is required.`);
	if (text.includes('\0')) throw new TypeError(`A trim ${label} path must not contain NUL.`);
	return text;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Producing one trimmed copy with the FFmpeg that already ships.
 *
 * The sequence is: find where the source's keyframes are, widen the plan's runs
 * back to them, copy each run out, join the copies, and hand back the result.
 * Nothing is re-encoded at any step, so a trimmed source is the same pictures
 * and the same samples it always was — just fewer of them.
 *
 * The keyframe probe is not optional and its failure is not recoverable here. A
 * source whose keyframes cannot be read cannot be cut losslessly, and cutting it
 * anyway would write a file whose first frames decode to garbage; refusing is
 * the only honest answer, and the operation above turns that refusal into a
 * reported finding rather than a failed run.
 *
 * Every MEMFS path this writes is deleted before the lease is given back, on
 * every path out. A trim of a large source writes as much again in parts before
 * the join, and leaving those behind would exhaust the runtime the next trim
 * needs.
 */

import {
	parseFfmpegVideoKeyframeLogs,
} from '../ffmpeg-video-keyframe-index.ts';
import {
	buildFfmpegVideoTimingProbeArgs,
} from '../ffmpeg-video-timing-probe.ts';
import {
	alignTrimMediaRunsToKeyframes,
	type TrimMediaRange,
	type TrimMediaSourcePlan,
} from '../trim-media-plan.ts';
import {
	buildTrimMediaConcatArgs,
	buildTrimMediaCutArgs,
	trimMediaConcatListText,
	type TrimMediaRational,
} from '../trim-media-ffmpeg.ts';

export interface TrimMediaFfmpegRuntime {
	/** Put the source bytes where FFmpeg can read them, and answer the path. */
	writeInput(bytes: Uint8Array, options: Readonly<{ signal?: AbortSignal }>): Promise<string>;
	writeText(path: string, text: string, options: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	/** Run FFmpeg and answer its exit code and log lines. */
	exec(
		args: readonly string[],
		options: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<{ exitCode: number; logs: readonly string[] }>>;
	readOutput(path: string, options: Readonly<{ signal?: AbortSignal }>): Promise<Uint8Array>;
	deletePath(path: string): Promise<void>;
}

export interface TrimMediaExecutionRequest {
	readonly source: TrimMediaSourcePlan;
	readonly bytes: Uint8Array;
	readonly frameRate: TrimMediaRational;
	/** The source's own container; a copy never changes it. */
	readonly container: string;
	readonly extension: string;
	readonly signal?: AbortSignal;
}

export interface TrimMediaExecutionResult {
	readonly bytes: Uint8Array;
	/** The runs the copy contains, after widening to keyframes. */
	readonly runs: readonly TrimMediaRange[];
	readonly frameCount: number;
	readonly keyframeCount: number;
}

/** Cut and join one source's retained runs, losslessly. */
export async function executeTrimMediaCopy(
	runtime: TrimMediaFfmpegRuntime,
	request: TrimMediaExecutionRequest,
): Promise<TrimMediaExecutionResult> {
	const signalOptions = Object.freeze(request.signal ? { signal: request.signal } : {});
	const written: string[] = [];
	let primary: unknown;
	let hasPrimary = false;
	let result: TrimMediaExecutionResult | null = null;
	try {
		const inputPath = await runtime.writeInput(request.bytes, signalOptions);
		written.push(inputPath);
		const probe = await runtime.exec(buildFfmpegVideoTimingProbeArgs(inputPath), signalOptions);
		if (probe.exitCode !== 0) {
			throw new Error(`Reading the source's keyframes exited with ${String(probe.exitCode)}.`);
		}
		const keyframes = parseFfmpegVideoKeyframeLogs(probe.logs);
		const runs = alignTrimMediaRunsToKeyframes(request.source, keyframes);

		const parts: string[] = [];
		for (const [index, run] of runs.entries()) {
			const partPath = `${inputPath}.part-${String(index)}.${request.extension}`;
			written.push(partPath);
			const cut = await runtime.exec(buildTrimMediaCutArgs({
				inputPath,
				startFrame: run.startFrame,
				frameCount: run.endFrame - run.startFrame,
				frameRate: request.frameRate,
				container: request.container,
				outputPath: partPath,
			}), signalOptions);
			if (cut.exitCode !== 0) {
				throw new Error(`Copying a retained run exited with ${String(cut.exitCode)}.`);
			}
			parts.push(partPath);
		}

		const listPath = `${inputPath}.parts.txt`;
		written.push(listPath);
		await runtime.writeText(listPath, trimMediaConcatListText(parts), signalOptions);
		const outputPath = `${inputPath}.trimmed.${request.extension}`;
		written.push(outputPath);
		const joined = await runtime.exec(buildTrimMediaConcatArgs({
			listPath, container: request.container, outputPath,
		}), signalOptions);
		if (joined.exitCode !== 0) {
			throw new Error(`Joining the retained runs exited with ${String(joined.exitCode)}.`);
		}
		const bytes = await runtime.readOutput(outputPath, signalOptions);
		result = Object.freeze({
			bytes,
			runs,
			frameCount: runs.reduce((sum, run) => sum + (run.endFrame - run.startFrame), 0),
			keyframeCount: keyframes.length,
		});
	} catch (error) {
		primary = error;
		hasPrimary = true;
	}
	// Reverse order, so a partially written trim leaves nothing behind even when
	// one delete fails: the parts a large trim writes are as big as the source,
	// and the next trim needs that room.
	const failures: unknown[] = [];
	for (const path of [...written].reverse()) {
		try { await runtime.deletePath(path); } catch (error) { failures.push(error); }
	}
	// A cleanup failure never replaces the reason the trim failed: the first is
	// what the user has to act on and the second is what the runtime has to.
	if (hasPrimary) {
		if (failures.length === 0) throw primary;
		throw new AggregateError(
			[primary, ...failures],
			'Trimming media and its cleanup did not both complete successfully.',
		);
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Trimmed media cleanup did not complete successfully.');
	}
	if (!result) throw new Error('Trimming media produced no result.');
	return result;
}

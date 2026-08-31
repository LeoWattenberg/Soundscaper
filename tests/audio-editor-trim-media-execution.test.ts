/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	executeTrimMediaCopy,
	type TrimMediaFfmpegRuntime,
} from '../src/common/editor/controller/trim-media-execution.ts';
import { createTrimMediaPlan } from '../src/common/editor/trim-media-plan.ts';

const RATE = Object.freeze({ num: 30_000, den: 1_001 });
const SOURCE = Uint8Array.from({ length: 128 }, (_value, index) => index);

test('a trim probes, widens to keyframes, copies each run and joins them', async () => {
	const runtime = createRuntime();
	const result = await executeTrimMediaCopy(runtime.value, request());

	// The plan retains 12..18 and 42..48; the keyframes are every ten frames, so
	// both runs widen back and the copy holds more than was referenced, never less.
	assert.deepEqual(result.runs, [
		{ startFrame: 10, endFrame: 18 },
		{ startFrame: 40, endFrame: 48 },
	]);
	assert.equal(result.frameCount, 16);
	assert.equal(result.keyframeCount, 6);
	assert.deepEqual(runtime.commands, [
		'probe', 'cut:10:8', 'cut:40:8', 'concat',
	]);
	// Nothing is re-encoded at any step.
	assert.equal(runtime.executed.flat().includes('libx264'), false);
	for (const args of runtime.executed.slice(1)) assert.ok(args.includes('copy'));
});

test('every path it wrote is deleted before the lease is handed back', async () => {
	const runtime = createRuntime();
	await executeTrimMediaCopy(runtime.value, request());

	assert.deepEqual(runtime.remaining(), []);
	// Reverse order, so the parts a large trim wrote go first.
	assert.deepEqual(runtime.deleted.at(0)?.endsWith('.trimmed.mp4'), true);
	assert.deepEqual(runtime.deleted.at(-1), '/input.mp4');
});

test('a source whose keyframes cannot be read is refused rather than cut anyway', async () => {
	const runtime = createRuntime({ probeExit: 1 });
	await assert.rejects(executeTrimMediaCopy(runtime.value, request()), /keyframes exited with 1/u);
	assert.deepEqual(runtime.remaining(), [], 'a refusal still leaves the runtime clean');

	const headless = createRuntime({ keyframes: [] });
	// Cutting a stream with no keyframe at its start would write a file whose
	// first frames decode to garbage.
	await assert.rejects(executeTrimMediaCopy(headless.value, request()), /keyframe/u);
});

test('a failing cut surfaces its own reason, not the cleanup that followed it', async () => {
	const runtime = createRuntime({ cutExit: 1, deleteFails: true });
	await assert.rejects(
		executeTrimMediaCopy(runtime.value, request()),
		(error: unknown) => {
			// The user acts on why the trim failed; the runtime acts on the leak.
			assert.ok(error instanceof AggregateError);
			assert.match(String((error.errors[0] as Error).message), /Copying a retained run exited with 1/u);
			assert.ok(error.errors.length > 1);
			return true;
		},
	);
});

test('a cut rejection still deletes the partially written output path', async () => {
	const runtime = createRuntime({ cutThrows: true });
	await assert.rejects(executeTrimMediaCopy(runtime.value, request()), /cut execution failed/u);
	assert.deepEqual(runtime.remaining(), []);
	assert.equal(runtime.deleted.some((path) => path.includes('.part-0.')), true);
});

test('a clean run whose cleanup fails still reports the leak', async () => {
	const runtime = createRuntime({ deleteFails: true });
	await assert.rejects(executeTrimMediaCopy(runtime.value, request()), (error: unknown) => {
		// Several paths fail to go, so the leak is reported as all of them rather
		// than as whichever happened to be tried first.
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /cleanup did not complete/u);
		assert.ok(error.errors.every((cause) => /delete refused/u.test(String((cause as Error).message))));
		return true;
	});
});

function request() {
	const plan = createTrimMediaPlan({
		project: {
			sources: [{ id: 'a', frameCount: 60 }],
			clips: [
				{ id: 'c1', sourceId: 'a', sourceStartFrame: 12, sourceDurationFrames: 6 },
				{ id: 'c2', sourceId: 'a', sourceStartFrame: 42, sourceDurationFrames: 6 },
			],
		},
	});
	return {
		source: plan.sources[0]!,
		bytes: SOURCE,
		frameRate: RATE,
		container: 'mp4',
		extension: 'mp4',
	};
}

function createRuntime(options: {
	probeExit?: number;
	cutExit?: number;
	cutThrows?: boolean;
	keyframes?: readonly number[];
	deleteFails?: boolean;
} = {}) {
	const keyframes = options.keyframes ?? [0, 10, 20, 30, 40, 50];
	const paths = new Set<string>();
	const deleted: string[] = [];
	const executed: (readonly string[])[] = [];
	const commands: string[] = [];
	const value: TrimMediaFfmpegRuntime = {
		async writeInput() { paths.add('/input.mp4'); return '/input.mp4'; },
		async writeText(path) { paths.add(path); },
		async exec(args) {
			executed.push(args);
			if (args.includes('showinfo')) {
				commands.push('probe');
				return {
					exitCode: options.probeExit ?? 0,
					logs: Array.from({ length: 60 }, (_value, index) => (
						`[Parsed_showinfo_0 @ 0x1] n:${String(index).padStart(4)} pts:${index * 1024}`
						+ ` iskey:${keyframes.includes(index) ? 1 : 0}`
					)),
				};
			}
			if (args.includes('concat')) {
				commands.push('concat');
				paths.add(String(args.at(-1)));
				return { exitCode: 0, logs: [] };
			}
			const start = args[args.indexOf('-ss') + 1];
			const frames = args[args.indexOf('-frames:v') + 1];
			commands.push(`cut:${startFrameOf(String(start))}:${String(frames)}`);
			paths.add(String(args.at(-1)));
			if (options.cutThrows) throw new Error('cut execution failed');
			return { exitCode: options.cutExit ?? 0, logs: [] };
		},
		async readOutput() { return Uint8Array.of(1, 2, 3); },
		async deletePath(path) {
			deleted.push(path);
			if (options.deleteFails) throw new Error('delete refused');
			paths.delete(path);
		},
	};
	return { value, deleted, executed, commands, remaining: () => [...paths] };
}

/** Recover the frame a seek names, so the test reads cuts the way FFmpeg does. */
function startFrameOf(seek: string): number {
	return Math.floor((Number(seek) * RATE.num) / RATE.den);
}

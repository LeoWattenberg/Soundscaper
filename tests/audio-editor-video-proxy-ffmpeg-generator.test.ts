/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FfmpegMediaFileLease } from '../src/common/editor/ffmpeg-media-file-operation.ts';
import type {
	VideoProxyCandidateGeneratorPort,
	VideoProxyCandidateRecipe,
} from '../src/common/editor/video-proxy-candidate-observation.ts';
import {
	buildVideoProxyGenerationArgs,
	VIDEO_PROXY_GENERATION_OUTPUT,
	VIDEO_PROXY_GENERATION_RECIPE,
} from '../src/common/editor/video-proxy-generation.ts';
import {
	createFfmpegVideoProxyGenerator,
	VideoProxyGenerationError,
} from '../src/common/editor/video-proxy-ffmpeg-generator.ts';

const IDENTITY = Object.freeze({
	authority: 'owned' as const,
	projectId: 'project-1',
	sourceId: 'source-1',
	storageKey: 'source-1',
	mimeType: 'video/mp4',
	byteLength: 4,
	sha256: 'a'.repeat(64),
	generationToken: 'generation-1',
});

interface HarnessOptions {
	readonly exitCode?: number;
	readonly logs?: readonly string[];
	readonly output?: Uint8Array;
	readonly failReadOutput?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
	const events: string[] = [];
	const written = new Map<string, Uint8Array>();
	const deleted: string[] = [];
	let execArgs: readonly string[] = [];
	const lease: FfmpegMediaFileLease = {
		async writeInput(bytes) {
			const path = `editor-proxy-${written.size + 1}`;
			written.set(path, bytes);
			events.push(`write:${path}`);
			return path;
		},
		writeText: () => Promise.resolve(),
		async exec(args) {
			execArgs = args;
			events.push('exec');
			return Object.freeze({
				exitCode: options.exitCode ?? 0,
				logs: Object.freeze(options.logs ?? ['frame= 12 fps=0.0']),
			});
		},
		async readOutput(path) {
			events.push(`read:${path}`);
			if (options.failReadOutput) throw new Error('the output was not written');
			return options.output ?? new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
		},
		async deletePath(path) {
			deleted.push(path);
			events.push(`delete:${path}`);
		},
	};
	const generator = createFfmpegVideoProxyGenerator({
		runOperation: (operation, settings) => {
			events.push(settings?.signal ? 'run:signalled' : 'run');
			return operation(lease);
		},
	});
	return { generator, events, written, deleted, execArgs: () => execArgs };
}

const CURRENT = Object.freeze({ assertCurrent() {} });

/** The port answers `Awaitable<unknown>`; every caller here wants one promise. */
function generate(
	generator: VideoProxyCandidateGeneratorPort,
	recipe: VideoProxyCandidateRecipe = VIDEO_PROXY_GENERATION_RECIPE,
	options: Readonly<{ signal?: AbortSignal; assertCurrent(): void }> = CURRENT,
	body: Uint8Array = new Uint8Array([1, 2, 3, 4]),
): Promise<unknown> {
	return Promise.resolve(generator.generate(new Blob([body.slice()]), IDENTITY, recipe, options));
}

test('the generator runs the shipped recipe over the leased original', async () => {
	const harness = createHarness();
	const candidate = await harness.generator.generate(
		new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' }),
		IDENTITY,
		VIDEO_PROXY_GENERATION_RECIPE,
		CURRENT,
	);

	// The body it answers is the recipe's container, because the attachment
	// stores that MIME beside the digest and a consumer compares both.
	assert.ok(candidate instanceof Blob);
	assert.equal(candidate.type, VIDEO_PROXY_GENERATION_OUTPUT.mimeType);
	assert.equal(candidate.size, 8);

	// And the command is the shipped one, aimed at the paths the lease handed
	// out. A generator building its own arguments would be a second recipe that
	// nothing tested against the pinned core.
	const input = [...harness.written.keys()][0]!;
	assert.deepEqual(
		harness.execArgs(),
		buildVideoProxyGenerationArgs({ inputPath: input, outputPath: `${input}-proxy.mp4` }),
	);
});

test('every path the generator wrote is its own to remove, run or fail', async () => {
	const harness = createHarness();
	await generate(harness.generator);
	assert.deepEqual(harness.deleted.length, 2, harness.events.join(' '));

	// A failed encode leaves nothing behind either: the runtime is shared with
	// every other operation, and an abandoned input is a leak that outlives the
	// source it came from.
	const failing = createHarness({ exitCode: 1, logs: ['x264 [error]: bad parameters'] });
	await assert.rejects(
		generate(failing.generator),
		(error: Error) => {
			assert.ok(error instanceof VideoProxyGenerationError);
			assert.equal(error.exitCode, 1);
			// What FFmpeg said, because a proxy that failed to encode is a support
			// question and the exit code alone answers none of it.
			assert.match(error.message, /bad parameters/u);
			return true;
		},
	);
	assert.equal(failing.deleted.length, 2, failing.events.join(' '));
});

test('an empty body is refused rather than attached as a proxy of nothing', async () => {
	const harness = createHarness({ output: new Uint8Array(0) });
	await assert.rejects(generate(harness.generator), /empty/iu);
	assert.equal(harness.deleted.length, 2);
});

test('the generator refuses a recipe it was not measured against', async () => {
	const harness = createHarness();
	for (const recipe of [
		{ ...VIDEO_PROXY_GENERATION_RECIPE, id: 'framescaper-video-proxy-h264-1080-v1' },
		{ ...VIDEO_PROXY_GENERATION_RECIPE, version: 2 },
	]) {
		await assert.rejects(generate(harness.generator, recipe), /recipe/iu);
	}
	// Nothing ran: a recipe this generator cannot honour must not reach FFmpeg
	// under the name of one it can.
	assert.deepEqual(harness.events, []);
});

test('a source that moved on while the encode ran does not produce an attachment', async () => {
	const harness = createHarness();
	let calls = 0;
	await assert.rejects(
		generate(harness.generator, VIDEO_PROXY_GENERATION_RECIPE, {
			assertCurrent() {
				calls += 1;
				// Current when the encode starts, stale by the time it finishes.
				if (calls > 1) throw new Error('the source generation moved on');
			},
		}),
		/moved on/u,
	);
	assert.ok(calls > 1);
	assert.equal(harness.deleted.length, 2, 'a stale run still cleans up after itself');
});

test('an aborted generation stops before it writes anything', async () => {
	const harness = createHarness();
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		generate(harness.generator, VIDEO_PROXY_GENERATION_RECIPE, {
			signal: controller.signal, assertCurrent() {},
		}),
		(error: Error) => error.name === 'AbortError',
	);
	assert.deepEqual(harness.events, []);
});

test('the generator names itself, because the attachment records who produced it', () => {
	const { generator } = createHarness();
	assert.equal(generator.id, 'framescaper-video-proxy-ffmpeg-v1');
	assert.equal(generator.version, 1);
});

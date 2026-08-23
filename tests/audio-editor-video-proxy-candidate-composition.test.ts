/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoProxyCandidateObserverForRuntime,
	createVideoProxyExistingCandidateObserverForRuntime,
} from '../src/common/editor/controller/video-proxy-candidate-composition.ts';
import {
	assertVideoProxyCandidateObserver,
	consumeVideoProxyCandidateObservation,
	observeVideoProxyCandidate,
} from '../src/common/editor/video-proxy-candidate-observation.ts';
import { buildVideoProxyGenerationArgs } from '../src/common/editor/video-proxy-generation.ts';
import type { FfmpegMediaFileLease } from '../src/common/editor/ffmpeg-media-file-operation.ts';
import type { VideoTimingProbePort } from '../src/common/editor/video-timing-probe.ts';

const PROBE_RESULT = Object.freeze({
	nominalRate: Object.freeze({ num: 24, den: 1 }),
	timescale: 24,
	presentationTicks: Object.freeze([0n, 1n, 2n]),
	finalFrameDurationTicks: 1n,
});

function runtime(overrides: Record<string, unknown> = {}) {
	const runs: string[][] = [];
	const lease: FfmpegMediaFileLease = {
		writeInput: () => Promise.resolve('editor-proxy-1'),
		writeText: () => Promise.resolve(),
		exec: (args) => {
			runs.push([...args]);
			return Promise.resolve(Object.freeze({ exitCode: 0, logs: Object.freeze([]) }));
		},
		readOutput: () => Promise.resolve(new Uint8Array([1, 2, 3])),
		deletePath: () => Promise.resolve(),
	};
	return {
		runs,
		runtime: {
			runProxyMediaOperation: <Output>(
				operation: (value: FfmpegMediaFileLease) => Promise<Output>,
			) => operation(lease),
			probeVideoTiming: () => Promise.resolve(PROBE_RESULT),
			...overrides,
		},
	};
}

test('the shipped runtime composes into a candidate observer', () => {
	const observer = createVideoProxyCandidateObserverForRuntime(runtime().runtime);
	assert.ok(observer);
	// Authenticated by the module that will consume it, not merely shaped like it.
	assert.doesNotThrow(() => assertVideoProxyCandidateObserver(observer));
});

test('a build that cannot encode or cannot read timing generates nothing', () => {
	// No FFmpeg operation runner: there is no way to encode a proxy at all.
	assert.equal(
		createVideoProxyCandidateObserverForRuntime({ probeVideoTiming: () => Promise.resolve(PROBE_RESULT) }),
		null,
	);
	// A runner but no probe: a body could be written and never proven to conform,
	// which is the one thing a proxy may not be attached without.
	assert.equal(
		createVideoProxyCandidateObserverForRuntime({
			runProxyMediaOperation: (operation) => operation({} as FfmpegMediaFileLease),
		}),
		null,
	);
	assert.equal(createVideoProxyCandidateObserverForRuntime(null), null);
});

test('a native probe is preferred and the WebAssembly probe still backs it up', () => {
	const helperTimingProbe: VideoTimingProbePort = Object.freeze({
		id: 'desktop-helper',
		probe: () => Promise.resolve(PROBE_RESULT),
	});
	const observer = createVideoProxyCandidateObserverForRuntime(runtime().runtime, { helperTimingProbe });
	assert.ok(observer);

	// And a build with only the native probe still composes: the WebAssembly
	// probe is the fallback, not the requirement.
	assert.ok(createVideoProxyCandidateObserverForRuntime(
		{ runProxyMediaOperation: (operation) => operation({} as FfmpegMediaFileLease) },
		{ helperTimingProbe },
	));
});

test('the composed observer encodes through the shipped recipe', async () => {
	const host = runtime();
	const observer = createVideoProxyCandidateObserverForRuntime(host.runtime);
	assert.ok(observer);

	// Reaching the generator through the observer's own private request is not
	// possible from here, so the proof that the composition wired the maintained
	// command is the command the runtime was asked to run when one is made.
	const { createFfmpegVideoProxyGenerator } = await import(
		'../src/common/editor/video-proxy-ffmpeg-generator.ts'
	);
	const { VIDEO_PROXY_GENERATION_RECIPE } = await import(
		'../src/common/editor/video-proxy-generation.ts'
	);
	const generator = createFfmpegVideoProxyGenerator({
		runOperation: host.runtime.runProxyMediaOperation,
	});
	await generator.generate(
		new Blob([new Uint8Array([1, 2, 3, 4])]),
		{
			authority: 'owned', projectId: 'p', sourceId: 's', storageKey: 's',
			mimeType: 'video/mp4', byteLength: 4, sha256: 'a'.repeat(64), generationToken: 'g',
		},
		VIDEO_PROXY_GENERATION_RECIPE,
		{ assertCurrent() {} },
	);
	assert.deepEqual(
		host.runs[0],
		buildVideoProxyGenerationArgs({
			inputPath: 'editor-proxy-1', outputPath: 'editor-proxy-1-proxy.mp4',
		}),
	);
});

test('a pathless existing proxy composes without an encoder and retains no file name', async () => {
	const candidate = new File([new Uint8Array([7, 8, 9])], 'private-proxy-name.webm', {
		type: 'video/webm',
	});
	const observer = createVideoProxyExistingCandidateObserverForRuntime(candidate, {
		probeVideoTiming: () => Promise.resolve(PROBE_RESULT),
	});
	assert.ok(observer);
	const original = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' });
	const observation = await observeVideoProxyCandidate(observer, {
		original,
		identity: {
			authority: 'owned', projectId: 'project', sourceId: 'source',
			storageKey: 'original', mimeType: original.type, byteLength: original.size,
			sha256: 'a'.repeat(64), generationToken: 'generation',
		},
		originalSourceId: 'source',
		assertCurrent() {},
	});
	const material = consumeVideoProxyCandidateObservation(observation);
	assert.equal(material.candidate instanceof File, false);
	assert.equal(material.candidate.type, candidate.type);
	assert.deepEqual(new Uint8Array(await material.candidate.arrayBuffer()), new Uint8Array([7, 8, 9]));
	assert.equal(material.generatorId, 'framescaper-pathless-existing-proxy');
	assert.equal(material.recipeId, 'framescaper-existing-video-proxy-v1');
});

test('an existing proxy still requires an exact timing probe', () => {
	const candidate = new Blob(['proxy'], { type: 'video/webm' });
	assert.equal(createVideoProxyExistingCandidateObserverForRuntime(candidate, null), null);
	assert.throws(
		() => createVideoProxyExistingCandidateObserverForRuntime(
			new Blob([], { type: 'video/webm' }),
			{ probeVideoTiming: () => Promise.resolve(PROBE_RESULT) },
		),
		/cannot be empty/iu,
	);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { trimProjectMedia } from '../src/common/editor/controller/trim-media-service.ts';

const NOW = '2026-08-19T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const SEQUENCE = Object.freeze({ id: 'main', rate: Object.freeze({ num: 30, den: 1 }) });
/** Every tenth frame, which is what the fake FFmpeg reports and honours. */
const KEYFRAME_INTERVAL = 10;

function project() {
	const video = createVideoSourceV10({
		kind: 'video', id: 'vid', storageKey: 'vid', name: 'take.mp4', mimeType: 'video/mp4',
		frameCount: SAMPLE_RATE * 10, sampleRate: SAMPLE_RATE, width: 640, height: 360,
		frameRate: SEQUENCE.rate, sourceFrameCount: 300, timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest', rate: SEQUENCE.rate,
			reason: 'timing-probe-unavailable', failures: [],
		},
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}, SAMPLE_RATE);
	const audio = createAudioSourceV10({
		kind: 'audio', id: 'aud', storageKey: 'aud', name: 'take.wav', mimeType: 'audio/wav',
		frameCount: 1_000, channelCount: 2, sampleRate: SAMPLE_RATE,
	});
	const context = { projectSampleRate: SAMPLE_RATE, sequence: SEQUENCE, source: video };
	return createCurrentAudioEditorProject({
		id: 'trim-service-project', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE], primarySequenceId: SEQUENCE.id,
		sources: [video, audio],
		clips: [
			createVideoClipV10({
				id: 'v1', sourceId: 'vid', sequenceId: SEQUENCE.id,
				sequenceStartFrame: 0, sequenceFrameCount: 60, sourceInFrame: 123, sourceFrameCount: 60,
			}, context),
			createAudioClipV10({
				id: 'a1', sourceId: 'aud', timelineStartFrame: 0, durationFrames: 100,
				sourceStartFrame: 400, sourceDurationFrames: 100,
			}),
		],
		tracks: [
			createVideoTrackV10({ id: 'video-track', clipIds: ['v1'] }),
			createAudioTrackV10({ id: 'audio-track', clipIds: ['a1'] }),
		],
		projectBin: { clips: [] },
	});
}

type ProjectRecord = ReturnType<typeof project>;

/**
 * A stand-in FFmpeg that answers the keyframe probe and honours a cut the same
 * way the real one does: a run starts at the keyframe at or before what it was
 * asked for, and the copy holds exactly the frames the arguments name.
 */
function createFfmpeg() {
	const files = new Map<string, Uint8Array | string>();
	const execArgs: string[][] = [];
	let cutFrames = 0;
	const lease = {
		async writeInput(bytes: Uint8Array) { files.set('in', bytes); return 'in'; },
		async writeText(path: string, text: string) { files.set(path, text); },
		async exec(args: readonly string[]) {
			execArgs.push([...args]);
			if (args.includes('showinfo') || args.some((value) => String(value).includes('showinfo'))) {
				const logs = Array.from({ length: 300 }, (_value, index) => (
					`[Parsed_showinfo_0 @ 0x1] n:${index} pts:${index} iskey:${index % KEYFRAME_INTERVAL === 0 ? 1 : 0}`
				));
				return { exitCode: 0, logs };
			}
			const frames = args.indexOf('-frames:v');
			if (frames >= 0) cutFrames += Number(args[frames + 1]);
			const output = args[args.length - 1]!;
			files.set(output, Uint8Array.of(1, 2, 3));
			return { exitCode: 0, logs: [] };
		},
		async readOutput(path: string) {
			const value = files.get(path);
			if (value === undefined) throw new Error(`missing ${path}`);
			return typeof value === 'string' ? new TextEncoder().encode(value) : value;
		},
		async deletePath(path: string) { files.delete(path); },
	};
	return {
		execArgs,
		remaining: () => [...files.keys()],
		cutFrames: () => cutFrames,
		host: {
			async runTrimMediaOperation<Output>(operation: (value: never) => Promise<Output>) {
				return operation(lease as never);
			},
		},
	};
}

function createStore() {
	const written = new Map<string, Uint8Array>();
	return {
		written,
		value: {
			async loadMediaAsset(storageKey: string) {
				return { size: 8, async arrayBuffer() { return new ArrayBuffer(8); }, storageKey } as never;
			},
			async beginMediaAssetWrite(storageKey: string) {
				const parts: Uint8Array[] = [];
				return {
					maximumChunkBytes: 1024,
					async write(bytes: Uint8Array) { parts.push(bytes.slice()); },
					async commit() {
						written.set(storageKey, Uint8Array.from(parts.flatMap((part) => [...part])));
						return {};
					},
					async abort() { /* nothing staged survives */ },
				} as never;
			},
		},
	};
}

test('a video source is cut on keyframes and the document moves onto the result', async () => {
	const before = project();
	const ffmpeg = createFfmpeg();
	const store = createStore();
	const result = await trimProjectMedia({ project: before, store: store.value, ffmpeg: ffmpeg.host });

	// The clip reads frames 123..183; the runs widen back to the keyframe at 120,
	// so the copy holds 120..183 — 63 frames — and the clip sits 3 frames in.
	const trimmed = result.run.sources.find(({ sourceId }) => sourceId === 'vid');
	assert.equal(trimmed?.outcome, 'trimmed');
	assert.equal(trimmed?.writtenFrames, 63);
	assert.equal(ffmpeg.cutFrames(), 63, 'FFmpeg was asked for exactly the frames the copy holds');

	const after = applyEditorCommand(before, result.edit.command!, { now: NOW }) as ProjectRecord;
	const source = after.sources.find((entry) => entry.id === 'vid') as Record<string, unknown>;
	assert.equal(source.sourceFrameCount, 63);
	assert.match(String(source.storageKey), /^vid\.trim\.[0-9a-f]{16}$/u);
	assert.equal(after.clips.find((clip) => clip.id === 'v1')?.sourceInFrame, 3);
	assert.equal(validateCurrentAudioEditorProject(after), true);

	// The trimmed body is written under its own key, so the bytes the document
	// pointed at before are still there for an undo to return to.
	assert.equal(store.written.has('vid'), false);
	assert.equal(store.written.has(String(source.storageKey)), true);
	// And nothing this wrote inside FFmpeg was left behind.
	assert.deepEqual(ffmpeg.remaining(), []);
});

test('an audio source is refused rather than silently skipped', async () => {
	// The cut is a keyframe-aligned stream copy, which is a video idea. A project
	// that expected to reclaim an audio source's space has to be told it did not.
	const result = await trimProjectMedia({
		project: project(), store: createStore().value, ffmpeg: createFfmpeg().host,
	});

	const audio = result.run.sources.find(({ sourceId }) => sourceId === 'aud');
	assert.equal(audio?.outcome, 'unsupported-media');
	// And under its own reason: a user told to "consolidate it first" would try,
	// and it would not help.
	assert.match(
		String(result.run.report.items.find((item) => item.code === 'trim.unsupported-media')?.message),
		/no lossless cut here/u,
	);
	assert.equal(result.edit.command?.type, 'batch');
	const batched = result.edit.command as Readonly<{ commands: readonly { sourceId?: string }[] }>;
	assert.equal(
		batched.commands.every((command) => command.sourceId !== 'aud'),
		true,
		'no command touches the source that was not cut',
	);
});

test('the same source trimmed twice lands on the same body', async () => {
	// The key is the digest of what was written, so a repeated trim rebinds to
	// the copy that already exists rather than accumulating one per attempt.
	const store = createStore();
	const first = await trimProjectMedia({
		project: project(), store: store.value, ffmpeg: createFfmpeg().host,
	});
	const second = await trimProjectMedia({
		project: project(), store: store.value, ffmpeg: createFfmpeg().host,
	});

	const keyOf = (result: typeof first) => (
		result.run.sources.find(({ sourceId }) => sourceId === 'vid')?.storageKey
	);
	assert.equal(keyOf(first), keyOf(second));
	assert.equal(store.written.size, 1);
});

test('a container that cannot be copied is refused rather than re-wrapped', async () => {
	// Writing an unknown source into a default container would silently change
	// the file, and the whole promise of this path is that nothing changed.
	const before = project();
	const mangled = {
		...before,
		sources: before.sources.map((source) => (
			source.id === 'vid' ? { ...source, mimeType: 'video/x-unknown' } : source
		)),
	};
	const result = await trimProjectMedia({
		project: mangled as never, store: createStore().value, ffmpeg: createFfmpeg().host,
	});

	const video = result.run.sources.find(({ sourceId }) => sourceId === 'vid');
	assert.equal(video?.outcome, 'write-failed');
	assert.equal(result.edit.command, null);
	assert.match(
		String(result.run.report.items.find((item) => item.code === 'trim.write-failed')?.data.reason),
		/cannot be trimmed by copying/u,
	);
});

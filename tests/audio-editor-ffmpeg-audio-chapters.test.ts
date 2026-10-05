/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { execFfmpegAudioWithChapters } from '../src/common/editor/ffmpeg-audio-chapters.ts';
import { buildMediaFfmpegEncoderArgs } from '../src/common/editor/media-export.js';
import { encodeWav } from '../src/common/editor/wav.js';

const chapters = Object.freeze([
	{ startFrame: 0, endFrame: 24_000, title: 'Überblick = #1; \\ intro' },
	{ startFrame: 24_000, endFrame: 72_000, title: 'Second\r\nline\nnext\rcarriage\\' },
	{ startFrame: 72_000, endFrame: 96_000, title: 'Final chapter' },
]);
const settings = { format: 'mp3', sampleRate: 48_000, embeddedChapters: chapters };
const args = ['-i', 'mix.wav', '-vn', '-map_metadata', '-1', '-metadata', 'artist=Podcast', '-y', 'out.mp3'];

function createInstance(options: {
	writeFailure?: Error;
	execFailure?: Error;
	execCode?: number;
	onWrite?: () => void;
	onExec?: () => void;
} = {}) {
	const files = new Map<string, Uint8Array>();
	const calls: string[] = [];
	const seen = { args: [] as readonly string[], signal: undefined as AbortSignal | undefined };
	return {
		files, calls, seen,
		instance: {
			async writeFile(path: string, data: Uint8Array, options_: { signal?: AbortSignal } = {}) {
				calls.push(`write:${path}`);
				files.set(path, data);
				seen.signal = options_.signal;
				options.onWrite?.();
				if (options.writeFailure) throw options.writeFailure;
			},
			async exec(arguments_: readonly string[], _timeout?: number, options_: { signal?: AbortSignal } = {}) {
				calls.push('exec');
				seen.args = arguments_;
				seen.signal = options_.signal;
				options.onExec?.();
				if (options.execFailure) throw options.execFailure;
				return options.execCode ?? 0;
			},
			async deleteFile(path: string) { calls.push(`delete:${path}`); files.delete(path); },
		},
	};
}

test('chapter input maps only the original audio and preserves ordinary metadata arguments', async () => {
	const harness = createInstance();
	let metadata = '';
	harness.instance.exec = async (arguments_: readonly string[]) => {
		harness.seen.args = arguments_;
		metadata = new TextDecoder().decode(harness.files.get('out.mp3.chapters.ffmetadata'));
		return 0;
	};
	assert.equal(await execFfmpegAudioWithChapters(harness.instance, args, settings), 0);
	assert.deepEqual(harness.seen.args, [
		'-i', 'mix.wav', '-f', 'ffmetadata', '-i', 'out.mp3.chapters.ffmetadata',
		'-map', '0:a:0', '-map_chapters', '1', '-vn', '-map_metadata', '-1',
		'-metadata', 'artist=Podcast',
		...chapters.flatMap((chapter, index) => [`-metadata:c:${index}`, `title=${chapter.title}`]),
		'-y', 'out.mp3',
	]);
	assert.match(metadata, /^;FFMETADATA1\n/);
	assert.match(metadata, /\[CHAPTER\]/);
	assert.equal(metadata.includes('title='), false, 'chapter names bypass the FFmetadata escaped-line parser');
	assert.equal(harness.files.size, 0);
	assert.equal(harness.calls.at(-1), 'delete:out.mp3.chapters.ffmetadata');
	assert.equal(args.includes('-map_chapters'), false, 'the caller’s command stays reusable');
});

test('exports without chapters retain the original command and create no auxiliary files', async () => {
	for (const embeddedChapters of [undefined, []]) {
		const harness = createInstance();
		await execFfmpegAudioWithChapters(harness.instance, args, { format: 'mp3', sampleRate: 48_000, embeddedChapters });
		assert.equal(harness.seen.args, args);
		assert.deepEqual(harness.calls, ['exec']);
	}
});

test('unsupported chapter formats fail before any worker file is written', async () => {
	const harness = createInstance();
	await assert.rejects(execFfmpegAudioWithChapters(harness.instance, args, { ...settings, format: 'flac' }), /chapter/i);
	assert.deepEqual(harness.calls, []);
});

test('legacy FFmpeg M4A refuses a nonzero first chapter rather than rebasing its timestamp', async () => {
	const harness = createInstance();
	await assert.rejects(execFfmpegAudioWithChapters(harness.instance, args, {
		format: 'aac-m4a', sampleRate: 48_000,
		embeddedChapters: [{ startFrame: 24_000, endFrame: 96_000, title: 'Starts later' }],
	}), /nonzero first chapter start/iu);
	assert.deepEqual(harness.calls, []);
});

test('chapter sidecars are removed after partial writes, encoding failures, and nonzero exit codes', async () => {
	for (const failure of ['write', 'exec', 'code']) {
		const error = new Error(`${failure} failed`);
		const harness = createInstance({
			...(failure === 'write' ? { writeFailure: error } : {}),
			...(failure === 'exec' ? { execFailure: error } : {}),
			...(failure === 'code' ? { execCode: 1 } : {}),
		});
		const operation = execFfmpegAudioWithChapters(harness.instance, args, settings);
		if (failure === 'code') assert.equal(await operation, 1);
		else await assert.rejects(operation, (actual: unknown) => actual === error);
		assert.equal(harness.files.size, 0);
		assert.equal(harness.calls.at(-1), 'delete:out.mp3.chapters.ffmetadata');
	}
});

test('cancellation preserves the caller’s reason and cleans sidecars without the aborted signal', async () => {
	for (const phase of ['before', 'write', 'exec']) {
		const controller = new AbortController();
		const reason = new DOMException('chapter export cancelled', 'AbortError');
		if (phase === 'before') controller.abort(reason);
		const harness = createInstance({
			...(phase === 'write' ? { onWrite: () => controller.abort(reason) } : {}),
			...(phase === 'exec' ? { onExec: () => controller.abort(reason), execFailure: new Error('worker terminated') } : {}),
		});
		await assert.rejects(
			execFfmpegAudioWithChapters(harness.instance, args, settings, { signal: controller.signal }),
			(actual: unknown) => actual === reason,
		);
		assert.equal(harness.files.size, 0);
		if (phase === 'before') assert.deepEqual(harness.calls, []);
		else {
			assert.equal(harness.seen.signal, controller.signal);
			assert.equal(harness.calls.at(-1), 'delete:out.mp3.chapters.ffmetadata');
			if (phase === 'write') assert.equal(harness.calls.includes('exec'), false);
		}
	}
});

interface BrowserFfmpegCore {
	FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
	exec(...args: string[]): number;
	ffprobe(...args: string[]): number;
	reset(): void;
	setLogger(listener: (entry: { message: string }) => void): void;
}

test('the shipped FFmpeg core writes readable MP3 and M4A chapters with intact titles and tags', async () => {
	const previousSelf: unknown = Reflect.get(globalThis, 'self');
	Reflect.set(globalThis, 'self', { location: { href: import.meta.url } });
	try {
		const coreModuleName = '@ffmpeg/core';
		const { default: createCore } = await import(coreModuleName) as {
			default(options: { wasmBinary: Uint8Array }): Promise<BrowserFfmpegCore>;
		};
		const core = await createCore({
			wasmBinary: await readFile(new URL('../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)),
		});
		const instance = {
			writeFile: (path: string, bytes: Uint8Array) => core.FS.writeFile(path, bytes),
			deleteFile: (path: string) => core.FS.unlink(path),
			exec: (arguments_: readonly string[]) => {
				core.reset();
				return core.exec(...arguments_);
			},
		};
		core.FS.writeFile('mix.wav', encodeWav([new Float32Array(96_000)], { sampleRate: 48_000, bitDepth: 16, dither: false }));
		const cases = [
			{ chapters, mp3Ends: [0.5, 1.5, 2], m4aEnds: [0.5, 1.5, 2] },
			{
				chapters: [
					{ startFrame: 0, endFrame: 12_000, title: 'Region 1' },
					{ startFrame: 24_000, endFrame: 72_000, title: 'Region 2' },
					{ startFrame: 36_000, endFrame: 60_000, title: 'Overlap' },
					{ startFrame: 72_000, endFrame: 96_000, title: 'Ending' },
				],
				mp3Ends: [0.25, 1.5, 1.25, 2], m4aEnds: [0.5, 0.75, 1.5, 2],
			},
			{
				chapters: [
					{ startFrame: 0, endFrame: 24_000, title: 'Coincident 1' },
					{ startFrame: 0, endFrame: 48_000, title: 'Coincident 2' },
					{ startFrame: 24_000, endFrame: 96_000, title: 'Ending' },
				],
				mp3Ends: [0.5, 1, 2], m4aEnds: [0, 0.5, 2],
			},
		];
		for (const fixture of cases) for (const format of ['mp3', 'aac-m4a']) {
			const output = format === 'mp3' ? 'chapters.mp3' : 'chapters.m4a';
			const encodeArgs = buildMediaFfmpegEncoderArgs('mix.wav', output, format, {
				sampleRate: 48_000, channelCount: 1, metadata: { artist: 'Podcast author', title: 'Episode title' },
			});
			assert.equal(await execFfmpegAudioWithChapters(instance, encodeArgs, { ...settings, format, embeddedChapters: fixture.chapters }), 0);
			core.reset();
			const logs: string[] = [];
			core.setLogger(({ message }) => logs.push(message));
			// This core's ffprobe wrapper leaves its return field at -1 on success;
			// parse and assert the probe's actual structured output instead.
			core.ffprobe('-v', 'error', '-show_chapters', '-show_format', '-show_streams', '-of', 'json', output);
			const probe = JSON.parse(logs.join('\n')) as {
				chapters: { start_time: string; end_time: string; tags: { title: string } }[];
				format: { tags: { artist: string; title: string } };
				streams: { codec_type: string }[];
			};
			assert.equal(probe.chapters.length, fixture.chapters.length);
			assert.deepEqual(probe.chapters.map((chapter) => chapter.tags.title), fixture.chapters.map((chapter) => chapter.title));
			assert.deepEqual(probe.chapters.map((chapter) => Number(chapter.start_time)), fixture.chapters.map((chapter) => chapter.startFrame / 48_000));
			// M4A chapter ends are inferred from the next start and audio duration;
			// MP3 can preserve independent region ends, including gaps/overlaps.
			assert.deepEqual(probe.chapters.map((chapter) => Number(chapter.end_time)), format === 'mp3' ? fixture.mp3Ends : fixture.m4aEnds);
			assert.equal(probe.format.tags.artist, 'Podcast author');
			assert.equal(probe.format.tags.title, 'Episode title');
			assert.equal(probe.streams.filter((stream) => stream.codec_type === 'audio').length, 1);
			assert.equal(probe.streams.some((stream) => stream.codec_type === 'video'), false);
			core.FS.unlink(output);
		}
		core.FS.unlink('mix.wav');
	} finally {
		if (previousSelf === undefined) Reflect.deleteProperty(globalThis, 'self');
		else Reflect.set(globalThis, 'self', previousSelf);
	}
});

const runtimeModuleUrl = `data:text/javascript,${encodeURIComponent(`
	export const FFFSType = { WORKERFS: 'WORKERFS' };
	export class FFmpeg {
		constructor() { return new globalThis.__soundscaperChapterExportRuntime(); }
	}
`)}`;
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/ffmpeg') return { url: runtimeModuleUrl, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});

test('every browser audio encoding route passes chapters into its worker command and removes the sidecar', async () => {
	const previousRuntime: unknown = Reflect.get(globalThis, '__soundscaperChapterExportRuntime');
	const instances: ChapterRuntime[] = [];
	class ChapterRuntime {
		loaded = false;
		files = new Map<string, Uint8Array>();
		lastExec: readonly string[] = [];
		metadataAtExec = '';
		constructor() { instances.push(this); }
		on() {}
		off() {}
		async load() { this.loaded = true; }
		async writeFile(path: string, data: Uint8Array) { this.files.set(path, data); }
		async deleteFile(path: string) { this.files.delete(path); }
		async exec(arguments_: readonly string[]) {
			this.lastExec = arguments_;
			this.metadataAtExec = new TextDecoder().decode(this.files.get(`${arguments_.at(-1)}.chapters.ffmetadata`));
			return 0;
		}
		async readFile() { return Uint8Array.of(1, 2, 3); }
		async statFile() { return { size: 3 }; }
		async readFileRange() { return Uint8Array.of(1, 2, 3); }
		async createDir() {}
		async mount() {}
		async unmount() {}
		async deleteDir() {}
		terminate() { this.loaded = false; }
	}
	Reflect.set(globalThis, '__soundscaperChapterExportRuntime', ChapterRuntime);
	try {
		const { createEditorFfmpeg } = await import('../src/common/editor/ffmpeg.js');
		for (const method of ['encode', 'encodeFile', 'encodeFileToSink'] as const) {
			const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
			try {
				if (method === 'encode') await ffmpeg.encode(Uint8Array.of(1), 'mp3', settings);
				else if (method === 'encodeFile') await ffmpeg.encodeFile(new Blob([Uint8Array.of(1)]), 'mp3', settings);
				else await ffmpeg.encodeFileToSink(new Blob([Uint8Array.of(1)]), 'mp3', {
					open: () => undefined, write: () => undefined, close: () => 'done', abort: () => undefined,
				}, settings);
				const instance = instances.at(-1)!;
				assert.equal(instance.lastExec.includes('-map_chapters'), true, method);
				assert.match(instance.metadataAtExec, /\[CHAPTER\]/, method);
				assert.equal(instance.files.size, 0, method);
			} finally { ffmpeg.dispose(); }
		}
	} finally {
		if (previousRuntime === undefined) Reflect.deleteProperty(globalThis, '__soundscaperChapterExportRuntime');
		else Reflect.set(globalThis, '__soundscaperChapterExportRuntime', previousRuntime);
	}
});

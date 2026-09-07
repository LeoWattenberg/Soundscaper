/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

import { findFontInventoryProblems } from '../scripts/check-build-chunks.mjs';
import {
	encodeFfmpegVideoBytes,
	type FfmpegVideoJobInstance,
} from '../src/common/editor/ffmpeg-video-output.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';

const PROJECT_ROOT = new URL('../', import.meta.url);
const SR = 1_000;

test('the caption font staged for the encoder is a container its FreeType reads', async () => {
	// Measured against the pinned core: its FreeType reads WOFF and refuses
	// WOFF2. A WOFF2 staged here draws no caption at all, while the delivery
	// report still states the picture carries one.
	const source = await readFile(new URL('src/common/editor/video-burn-in-font.ts', PROJECT_ROOT), 'utf8');
	const files = [...source.matchAll(/@fontsource\/inter\/files\/(?<file>[\w.-]+)/gu)]
		.map((match) => match.groups!.file!);

	assert.equal(files.length, 4, 'one file per subset the burn-in rule can choose');
	for (const file of files) {
		assert.match(file, /\.woff$/u, `${file} is handed to FFmpeg, which cannot read WOFF2`);
		await access(new URL(`node_modules/@fontsource/inter/files/${file}`, PROJECT_ROOT));
	}
});

test('a burned delivery stages its font under the container the bytes actually are', async () => {
	const instance = new StagingInstance();
	await encodeFfmpegVideoBytes({
		videoBlobsBySourceId: new Map([['source-1', new Blob([Uint8Array.of(1)], { type: 'video/mp4' })]]),
		audioMix: new Blob([Uint8Array.of(3)], { type: 'audio/wav' }),
		plan: burnedPlan(),
		settings: { burnInFonts: new Map([['latin', new Blob([Uint8Array.of(2)])]]) },
		run: async <Value>(task: (job: FfmpegVideoJobInstance) => Promise<Value>) => task(instance),
		workerFsType: () => 'WORKERFS',
		terminateRuntime: () => undefined,
		isRuntimeTerminated: () => false,
		createEncodingError: (format: string, code: number) => new Error(`${format}:${code}`),
	});

	assert.deepEqual(
		instance.stagedNames.filter((name) => name.startsWith('burn-in-font-')),
		['burn-in-font-latin.woff'],
	);
	// The staged name is the path `drawtext` opens, so the two cannot drift.
	assert.match(
		filterGraph(instance.lastExec),
		/fontfile=\/editor-video-[^:,]+\/burn-in-font-latin\.woff:/u,
	);
});

test('the built font inventory still bounds the browser bundle to WOFF2', () => {
	// No browser ever loads the encoder's font, so the WOFF2-only rule exempts
	// that one by name rather than opening the format up for everything.
	assert.deepEqual(findFontInventoryProblems([
		{ path: 'dist/assets/inter-latin-600-normal-Ab12cd34.woff', size: 1 },
		{ path: 'dist/assets/inter-latin-600-normal-Ef56gh78.woff2', size: 1 },
	]), []);
	assert.deepEqual(findFontInventoryProblems([
		{ path: 'dist/assets/ubuntu-latin-400-normal-Ab12cd34.woff', size: 1 },
	]), ['dist/assets/ubuntu-latin-400-normal-Ab12cd34.woff: emitted fonts must be WOFF2']);
});

function filterGraph(command: readonly string[]): string {
	return command[command.indexOf('-filter_complex') + 1] ?? '';
}

function burnedPlan() {
	return createVideoExportPlan(project(), {
		range: { startFrame: 0, endFrame: 1_000 },
		captions: { trackId: 'labels-1', mux: false, burnIn: true },
	}) as Readonly<Record<string, unknown>>;
}

function project() {
	return {
		sampleRate: SR,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-1',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-1',
			frameCount: 10_000,
			sampleRate: SR,
			width: 1_920,
			height: 1_080,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: false,
			posterStorageKey: null,
			thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video',
			id: 'clip-1',
			sourceId: 'source-1',
			title: 'Clip',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			durationFrames: 10_000,
		}],
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			{
				id: 'labels-1',
				type: 'label',
				name: 'Dialogue',
				labels: [{ id: 'l1', startFrame: 100, endFrame: 400, title: 'first cue' }],
			},
		],
	};
}

class StagingInstance implements FfmpegVideoJobInstance {
	readonly stagedNames: string[] = [];
	lastExec: string[] = [];

	async createDir(): Promise<void> {}
	async mount(
		_fileSystemType: unknown,
		options: Readonly<{ blobs: readonly Readonly<{ name: string; data: Blob }>[] }>,
	): Promise<void> {
		for (const blob of options.blobs) this.stagedNames.push(blob.name);
	}
	async exec(args: readonly string[]): Promise<number> {
		this.lastExec = [...args];
		return 0;
	}
	async readFile(): Promise<Uint8Array> { return Uint8Array.of(7); }
	async statFile(): Promise<{ size: number }> { return { size: 1 }; }
	async readFileRange(): Promise<Uint8Array> { return Uint8Array.of(7); }
	async deleteFile(): Promise<void> {}
	async unmount(): Promise<void> {}
	async deleteDir(): Promise<void> {}
}

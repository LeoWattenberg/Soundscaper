/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const ffmpegModuleUrl = `data:text/javascript,${encodeURIComponent(`
	export const FFFSType = { WORKERFS: 'WORKERFS' };
	export class FFmpeg {
		constructor() { return new globalThis.__soundscaperBoundedOutputRuntime(); }
	}
`)}`;
register(`data:text/javascript,${encodeURIComponent(`
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/ffmpeg') return { url: ${JSON.stringify(ffmpegModuleUrl)}, shortCircuit: true };
		return nextResolve(specifier, context);
	}
`)}`, import.meta.url);

const { createEditorFfmpeg } = await import('../src/common/editor/ffmpeg.js');
const originalRuntime = globalThis.__soundscaperBoundedOutputRuntime;

test.beforeEach(() => {
	MockFfmpegRuntime.instances = [];
	globalThis.__soundscaperBoundedOutputRuntime = MockFfmpegRuntime;
});

test.afterEach(() => {
	if (originalRuntime === undefined) delete globalThis.__soundscaperBoundedOutputRuntime;
	else globalThis.__soundscaperBoundedOutputRuntime = originalRuntime;
});

test('legacy audio byte routes refuse oversized FFmpeg output before whole-file reads', async () => {
	for (const encode of [
		(ffmpeg) => ffmpeg.encode(Uint8Array.of(1), 'mp3', { maximumOutputBytes: 2 }),
		(ffmpeg) => ffmpeg.encodeFile(new Blob([Uint8Array.of(1)]), 'mp3', { maximumOutputBytes: 2 }),
	]) {
		const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
		await assert.rejects(encode(ffmpeg), /Audio export.*maximum is 2 bytes/u);
		assert.equal(MockFfmpegRuntime.instances[0].statFileCalls, 1);
		assert.equal(MockFfmpegRuntime.instances[0].readFileCalls, 0);
		ffmpeg.dispose();
	}
});

class MockFfmpegRuntime {
	static instances = [];
	loaded = false;
	readFileCalls = 0;
	statFileCalls = 0;

	constructor() { MockFfmpegRuntime.instances.push(this); }
	on() {}
	off() {}
	async load() { this.loaded = true; }
	async writeFile() {}
	async exec() { return 0; }
	async statFile() { this.statFileCalls += 1; return { size: 3 }; }
	async readFile() { this.readFileCalls += 1; return Uint8Array.of(1, 2, 3); }
	async deleteFile() {}
	async createDir() {}
	async mount() {}
	async unmount() {}
	async deleteDir() {}
	terminate() { this.loaded = false; }
}

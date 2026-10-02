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

test('legacy audio byte routes require an oversized output decision before whole-file reads', async () => {
	for (const encode of [
		(ffmpeg) => ffmpeg.encode(Uint8Array.of(1), 'mp3', { maximumOutputBytes: 2 }),
		(ffmpeg) => ffmpeg.encodeFile(new Blob([Uint8Array.of(1)]), 'mp3', { maximumOutputBytes: 2 }),
	]) {
		const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
		await assert.rejects(encode(ffmpeg), { code: 'FILE_SIZE_WARNING' });
		assert.equal(MockFfmpegRuntime.instances[0].statFileCalls, 1);
		assert.equal(MockFfmpegRuntime.instances[0].readFileCalls, 0);
		ffmpeg.dispose();
	}
});

test('legacy audio byte routes await acceptance before reading and stop on cancellation', async () => {
	for (const method of ['encode', 'encodeFile']) {
		for (const accepted of [true, false]) {
			const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
			let prompts = 0;
			const settings = { maximumOutputBytes: 2, confirmFileSizeWarning: async (warning) => {
				prompts += 1;
				assert.deepEqual(warning, { label: 'Audio export', byteLength: 3, thresholdBytes: 2 });
				assert.equal(MockFfmpegRuntime.instances[0].readFileCalls, 0);
				return accepted;
			} };
			const input = method === 'encode' ? Uint8Array.of(1) : new Blob([Uint8Array.of(1)]);
			const operation = ffmpeg[method](input, 'mp3', settings);
			if (accepted) assert.deepEqual((await operation).bytes, Uint8Array.of(1, 2, 3));
			else await assert.rejects(operation, { name: 'AbortError' });
			assert.equal(prompts, 1);
			assert.equal(MockFfmpegRuntime.instances[0].readFileCalls, accepted ? 1 : 0);
			ffmpeg.dispose();
			MockFfmpegRuntime.instances = [];
		}
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

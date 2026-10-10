/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlobSource, Input, MP3 } from 'mediabunny';

interface PinnedCore {
	exec(...arguments_: string[]): number;
	setLogger(listener: (event: Readonly<{ message: string }>) => void): void;
	readonly FS: {
		writeFile(path: string, bytes: Uint8Array): void;
		readFile(path: string): Uint8Array;
		unlink(path: string): void;
	};
}

const CORE_JAVASCRIPT = new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url);
const CORE_WASM = new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url);
let corePromise: Promise<PinnedCore> | undefined;

/** The documented FFmpeg MP3/APIC writer authors a supported CBR programme with ordinary front/back cover photographs. */
export async function ordinaryCoverMp3Fixture(illustrated: boolean): Promise<File> {
	const core = await (corePromise ??= loadCore());
	const input = 'ordinary-cover-input.mp3', cover = 'ordinary-cover.png', output = 'ordinary-cover-output.mp3';
	const messages: string[] = [];
	core.setLogger(({ message }) => { messages.push(message); if (messages.length > 30) messages.shift(); });
	let encoded: Uint8Array<ArrayBuffer>;
	try {
		const original = Uint8Array.from(Buffer.from(await readFile(new URL('../fixtures/ffmpeg-libmp3lame-one-second.mp3.base64', import.meta.url), 'utf8'), 'base64'));
		core.FS.writeFile(input, original);
		// Public-domain NASA photograph, with existing provenance/notice in the fixture directory.
		core.FS.writeFile(cover, await readFile(new URL('../electron/local-assistance-models/fixtures/astronaut.png', import.meta.url)));
		const code = core.exec('-hide_banner', '-nostdin', '-y', '-i', input,
			...(illustrated ? ['-i', cover] : []), '-map', '0:a:0',
			...(illustrated ? ['-map', '1:v:0', '-map', '1:v:0', '-c:v', 'copy',
				'-metadata:s:v:0', 'comment=Cover (front)', '-metadata:s:v:1', 'comment=Cover (back)'] : []),
			'-c:a', 'libmp3lame', '-b:a', '128k', '-metadata', 'title=Space programme', output);
		assert.equal(code, 0, messages.join('\n'));
		encoded = Uint8Array.from(core.FS.readFile(output));
	} finally {
		core.setLogger(() => {});
		for (const path of [input, cover, output]) { try { core.FS.unlink(path); } catch { /* A failed mux may have no output. */ } }
	}
	const file = new File([encoded], 'Programme.mp3', { type: 'audio/mpeg' });
	const readback = new Input({ source: new BlobSource(file), formats: [MP3] });
	try {
		const audio = await readback.getPrimaryAudioTrack();
		assert.equal(audio?.codec, 'mp3');
		assert.equal(audio?.sampleRate, 48_000);
		assert.equal(audio?.numberOfChannels, 1);
		assert.ok(await readback.computeDuration() > 0.9);
		const tags = await readback.getMetadataTags();
		assert.equal(tags.images?.length ?? 0, illustrated ? 2 : 0);
		if (illustrated) assert.ok(file.size > 1024 ** 2);
	} finally { readback.dispose(); }
	return file;
}

async function loadCore(): Promise<PinnedCore> {
	if (!('self' in globalThis)) Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
	if (!('location' in globalThis)) Object.defineProperty(globalThis, 'location', { configurable: true, value: CORE_JAVASCRIPT });
	const [{ default: createCore }, wasmBinary] = await Promise.all([
		import(CORE_JAVASCRIPT.href) as Promise<{ default: (options: Readonly<{ wasmBinary: Uint8Array }>) => Promise<PinnedCore> }>,
		readFile(CORE_WASM),
	]);
	return await createCore({ wasmBinary });
}

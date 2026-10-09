/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoKeyframeEncoderOperationRunner, type VideoKeyframeVideoEditorFfmpeg } from '../../src/common/editor/video-keyframe-ffmpeg-operation.ts';

interface Core {
	FS: { writeFile(name: string, bytes: Uint8Array): void; readFile(name: string): Uint8Array; unlink(name: string): void };
	exec(...args: string[]): number; reset(): void; setLogger(logger: (entry: { message: string }) => void): void;
}

/** Actual pinned WASM, with a tiny MEMFS adapter for the owning streamed encoder.
 * Staging at most1KiB is fixture ingress; it does not qualify native ring backpressure.
 */
export async function createPinnedExportEncoderV1() {
	const require = createRequire(import.meta.url), previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
	Object.defineProperty(globalThis, 'self', { configurable: true, value: { location: { href: 'file:///ffmpeg-core.js' } } });
	let core: Core;
	try {
		const create = require('@ffmpeg/core') as (options: { wasmBinary: Uint8Array }) => Promise<Core>;
		core = await create({ wasmBinary: await readFile(require.resolve('@ffmpeg/core/wasm')) });
	} finally { if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self'); }
	const logs: string[] = [], created = new Set<string>(), inputCopies: number[][] = [], calls: string[][] = [];
	core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	let gate = Promise.resolve(), terminated = false, disposedStreams = 0;
	const runtime = {
		async createInputStream(path: string, capacityBytes = 4096) {
			const bytes = new Uint8Array(1024); let offset = 0, closed = false;
			let resolve!: () => void, reject!: (error: unknown) => void;
			gate = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void gate.catch(() => undefined);
			return Object.freeze({ path, capacityBytes,
				async write(input: Uint8Array) { assert.equal(closed, false); assert.ok(offset + input.length <= 1024); bytes.set(input, offset); offset += input.length; },
				async close() { closed = true; inputCopies.push(Array.from(bytes.subarray(0, offset))); core.FS.writeFile(path, bytes.subarray(0, offset)); created.add(path); resolve(); },
				abort(reason?: unknown) { closed = true; reject(reason); },
				async dispose() { disposedStreams++; bytes.fill(0); },
			});
		},
		async exec(args: readonly string[]) { await gate; calls.push([...args]); core.reset(); const result = core.exec(...args); created.add(args.at(-1)!); return result; },
		async statFile(path: string) { return { size: core.FS.readFile(path).length }; },
		async readFileRange(path: string, offset: number, maximumBytes: number) { return core.FS.readFile(path).slice(offset, offset + maximumBytes); },
		async deleteFile(path: string) { core.FS.unlink(path); created.delete(path); },
	};
	const runVideoKeyframeEncoderOperation = createVideoKeyframeEncoderOperationRunner(async operation => operation(runtime),
		() => { terminated = true; }, () => terminated);
	const editor: VideoKeyframeVideoEditorFfmpeg = Object.freeze({ runVideoKeyframeEncoderOperation });
	function execute(args: string[]) { core.reset(); assert.equal(core.exec(...args), 0, logs.join('\n')); }
	return {
		editor, inputCopies, calls, streamsDisposed: () => disposedStreams,
		decode(encoded: Uint8Array) {
			core.FS.writeFile('decode.mp4', encoded); created.add('decode.mp4'); created.add('decode.rgba');
			execute(['-hide_banner','-i','decode.mp4','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','decode.rgba']);
			return Array.from(core.FS.readFile('decode.rgba'));
		},
		referenceEncode(pixels: Uint8Array) {
			const args = calls.at(-1); if (!args) throw new Error('Production encoder arguments were not observed.');
			core.FS.writeFile('reference.rgba', pixels); created.add('reference.rgba'); created.add('reference.mp4');
			const reference = args.map(value => value === args[args.indexOf('-i') + 1] ? 'reference.rgba' : value === args.at(-1) ? 'reference.mp4' : value);
			execute(reference); return core.FS.readFile('reference.mp4').slice();
		},
		close() { for (const path of created) { try { core.FS.unlink(path); } catch { /* Refused native output may be absent. */ } } created.clear(); core.reset(); },
	};
}

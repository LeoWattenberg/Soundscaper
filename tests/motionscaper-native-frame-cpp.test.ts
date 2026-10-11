/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMotionNativeFrameWriter } from '../src/common/editor/motion-native-frame-carrier-v1.ts';
import { createMotionSurface, encodeMotionChannel } from '../src/common/editor/motion-surface.ts';

test('the native Motionscaper reader consumes renderer float frames with matching alpha and Rec.709 conversion', async (context) => {
	if (process.platform === 'win32' || spawnSync('c++', ['--version']).status !== 0) {
		context.skip('The C++20 fixture runs in the target-native CMake gate when a local c++ driver is unavailable.'); return;
	}
	const root = fileURLToPath(new URL('../', import.meta.url)); const temporary = await mkdtemp(join(tmpdir(), 'motionscaper-native-carrier-'));
	try {
		const binary = join(temporary, 'fixture');
		const built = spawnSync('c++', ['-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			'native/motionscaper-media-host/src/frame_carrier.cpp', 'native/motionscaper-media-host/tests/frame_carrier_fixture.cpp',
			'native/framescaper-media-host/src/strict_json.cpp', 'native/common/sha256.cpp', '-o', binary], { cwd: root, encoding: 'utf8' });
		assert.equal(built.status, 0, built.stderr);
		const chunks: Uint8Array[] = [];
		const writer = await createMotionNativeFrameWriter({ identity: { projectId: 'p', compositionId: 'c', revisionDigest: 'a'.repeat(64) },
			width: 2, height: 1, frameRate: { num: 30000, den: 1001 }, firstFrame: 123, frameCount: 1 },
		new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk.slice()); } }));
		const frame = createMotionSurface(2, 1); frame.pixels.set([0.1234567, 0.0123456, 0.0034567, 0.2345678, 0, 0, 0, 0]);
		await writer.write(0, frame); await writer.finish();
		const path = join(temporary, 'frame.pack'); const bytes = Buffer.concat(chunks); await writeFile(path, bytes);
		const run = spawnSync(binary, [path], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr);
		assert.equal(run.stdout.trim(), `${Math.round(65535 * encodeMotionChannel(frame.pixels[0]! / frame.pixels[3]!, 'rec709'))} ${Math.round(frame.pixels[3]! * 65535)}`);
		bytes[bytes.length - 40] ^= 1; await writeFile(path, bytes);
		const corrupted = spawnSync(binary, [path], { encoding: 'utf8' }); assert.equal(corrupted.status, 1); assert.match(corrupted.stderr, /pixel digest/u);
		bytes.writeFloatLE(Number.NaN, bytes.length - 64);
		createHash('sha256').update(bytes.subarray(bytes.length - 64, bytes.length - 32)).digest().copy(bytes, bytes.length - 32);
		await writeFile(path, bytes);
		const invalid = spawnSync(binary, [path], { encoding: 'utf8' }); assert.equal(invalid.status, 1); assert.match(invalid.stderr, /premultiplied pixel/u);
	} finally { await rm(temporary, { recursive: true, force: true }); }
});

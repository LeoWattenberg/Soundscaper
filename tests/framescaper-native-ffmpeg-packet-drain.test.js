/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const MEDIA_SOURCE = join(ROOT, 'native/framescaper-media-host/src');

test('packet drain owns packet cleanup, cancellation, EAGAIN/EOF, timing and mux routing', (context) => {
	if (process.platform === 'win32') return context.skip('The native C++ fixture is exercised by the Windows CMake target.');
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-packet-drain-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const binary = join(directory, 'packet-drain');
	const compile = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-UNDEBUG',
		'-I', MEDIA_SOURCE,
		join(ROOT, 'native/framescaper-media-host/tests/ffmpeg_packet_drain_fixture.cpp'),
		'-o', binary,
	], { encoding: 'utf8' });
	if (compile.error?.code === 'ENOENT') return context.skip('No C++ compiler is available.');
	assert.equal(compile.status, 0, compile.stderr);
	const result = spawnSync(binary, [], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
});

test('every FFmpeg mux owner delegates its packet drain and preserves adapter-specific actions', () => {
	for (const [file, receive, write] of [
		['ffmpeg_simple_render.cpp', 'Receive a delivery packet', 'Write a delivery packet'],
		['ffmpeg_selected_v20_adapter.cpp', 'Receive an encoded selected-V20 packet', 'Write an encoded selected-V20 packet'],
		['ffmpeg_media_engine.cpp', 'Receive a ProRes packet', 'Write a ProRes packet'],
	]) {
		const source = readFileSync(join(MEDIA_SOURCE, file), 'utf8');
		assert.match(source, /drain_encoded_packets\(/u, file);
		assert.match(source, new RegExp(receive, 'u'), file);
		assert.match(source, new RegExp(write, 'u'), file);
		assert.doesNotMatch(source, /avcodec_receive_packet\(/u, file);
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { MOTION_NATIVE_SOURCE_MANIFEST, verifyMotionscaperNativeSourceManifest } from '../scripts/lib/motionscaper-native-source.ts';
import { buildMotionscaperNativeHost, MOTION_NATIVE_PRECISION } from '../scripts/lib/motionscaper-native-build.ts';

await test('Motionscaper native builder refuses a foreign source closure before creating outputs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-source-missing-'));
	try {
		await assert.rejects(buildMotionscaperNativeHost({ repositoryRoot: root, target: 'linux-x64',
			workRoot: join(root, 'work'), outputRoot: join(root, 'result'), ffmpegSourceRoot: root,
			boostSourceRoot: root, externalSourceRoot: root }), /ENOENT/u);
		assert.equal(MOTION_NATIVE_PRECISION.encoderInputBits, 10);
		assert.equal(MOTION_NATIVE_PRECISION.alphaStorageBits, 16);
	} finally { await rm(root, { recursive: true, force: true }); }
});

await test('Motionscaper native source closure admits exact pins and rejects source drift', async () => {
	const root = resolve('.');
	const manifest = await verifyMotionscaperNativeSourceManifest(root);
	assert.equal(manifest.productId, 'motionscaper');
	assert.deepEqual(manifest.targets, ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
	const fixture = await mkdtemp(join(tmpdir(), 'motionscaper-source-'));
	try {
		for (const path of [MOTION_NATIVE_SOURCE_MANIFEST, manifest.dependencySource.path, ...manifest.sourceFiles.map(pin => pin.path)]) {
			await mkdir(dirname(join(fixture, path)), { recursive: true });
			await copyFile(join(root, path), join(fixture, path));
		}
		assert.deepEqual(await verifyMotionscaperNativeSourceManifest(fixture), manifest);
		const carrier = join(fixture, 'native/motionscaper-media-host/src/frame_carrier.cpp');
		await writeFile(carrier, `${await readFile(carrier, 'utf8')}\n// drift\n`);
		await assert.rejects(verifyMotionscaperNativeSourceManifest(fixture), /exact pins/u);
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

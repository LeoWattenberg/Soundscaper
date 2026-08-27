/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_CODEC_POLICY,
	assertDesktopCodecPolicy,
	auditDesktopFfmpegAbsence,
	isForbiddenDesktopFfmpegPath,
} from '../scripts/lib/desktop-codec-policy.mjs';

const require = createRequire(import.meta.url);

test('desktop packaging replaces Electron proprietary codecs with its alternate FFmpeg library', () => {
	const configuration = require('../electron-builder.config.cjs');
	assert.equal(configuration.downloadAlternateFFmpeg, true);
});

test('macOS packaging preserves the authenticated pre-signed OS codec addon bytes', () => {
	const configuration = require('../electron-builder.config.cjs');
	assert.equal(typeof configuration.mac.signIgnore, 'string');
	const ignored = new RegExp(configuration.mac.signIgnore, 'u');
	assert.equal(ignored.test(
		'/tmp/Soundscaper.app/Contents/Resources/runtime/native/soundscaper-os-audio-codec/mac-arm64/soundscaper_os_audio_codec.node',
	), true);
	for (const path of [
		'/tmp/Soundscaper.app/Contents/Resources/runtime/native/soundscaper-os-audio-codec/mac-arm64/other.node',
		'/tmp/Soundscaper.app/Contents/Resources/runtime/native/mac-arm64/addon.node',
		'/tmp/Soundscaper.app/Contents/Frameworks/Electron Framework.framework/Electron Framework',
	]) assert.equal(ignored.test(path), false, path);
});

test('desktop codec policy is immutable and fixes provider priority without bundled FFmpeg', () => {
	assert.deepEqual(DESKTOP_CODEC_POLICY, {
		schemaVersion: 1,
		bundledFfmpeg: false,
		providerOrder: ['bundled-reviewed-codecs', 'os', 'external-user-install'],
	});
	assert.equal(Object.isFrozen(DESKTOP_CODEC_POLICY), true);
	assert.equal(Object.isFrozen(DESKTOP_CODEC_POLICY.providerOrder), true);
	assert.equal(assertDesktopCodecPolicy(structuredClone(DESKTOP_CODEC_POLICY)), DESKTOP_CODEC_POLICY);
	assert.throws(() => assertDesktopCodecPolicy({
		...DESKTOP_CODEC_POLICY,
		bundledFfmpeg: true,
	}), /desktop codec policy/iu);
	assert.throws(() => assertDesktopCodecPolicy({
		...DESKTOP_CODEC_POLICY,
		providerOrder: ['os', 'bundled-reviewed-codecs', 'external-user-install'],
	}), /desktop codec policy/iu);
});

test('desktop FFmpeg payload matcher is narrow but covers core and native libav names', () => {
	for (const path of [
		'runtime/ffmpeg',
		'runtime/ffmpeg/0.12.10/ffmpeg-core.wasm',
		'renderer/assets/ffmpeg-core.js',
		'runtime/native/ffmpeg.exe',
		'runtime/native/ffprobe',
		'runtime/native/avcodec-61.dll',
		'runtime/native/libavformat.so.61',
		'runtime/native/libavutil.dylib',
		'desktop/ffmpeg-corresponding-source.json',
		'ffmpeg-runtime-manifest.json',
	]) assert.equal(isForbiddenDesktopFfmpegPath(path), true, path);

	for (const path of [
		'renderer/assets/ffmpeg-wrapper-A1B2.js',
		'desktop/project-library-runtime/src/common/editor/ffmpeg-video-timing-probe.js',
		'desktop/project-library-runtime/desktop/framescaper-media-host-payload.js',
		'config/framescaper-media-host-payload-manifest.json',
		'runtime/native/framescaper-media-host/linux-x64/framescaper-media-host',
		'runtime/native/framescaper-media-host/linux-x64/libframescaper-media.so',
		'licenses/THIRD_PARTY_LICENSES.md',
		'runtime/native/linux-x64/libaom.so',
	]) assert.equal(isForbiddenDesktopFfmpegPath(path), false, path);
});

test('desktop resource audit permits the authenticated media host but rejects general FFmpeg', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-codec-absence-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'runtime/native/linux-x64'), { recursive: true });
	await writeFile(join(root, 'runtime/native/linux-x64/libaom.so'), 'reviewed AV1 encoder');
	await mkdir(join(root, 'runtime/native/framescaper-media-host/linux-x64'), { recursive: true });
	await writeFile(join(root,
		'runtime/native/framescaper-media-host/linux-x64/framescaper-media-host'), 'authenticated host');
	assert.deepEqual(await auditDesktopFfmpegAbsence({ root, label: 'Fixture resources' }), {
		status: 'no-bundled-ffmpeg',
		entryCount: 7,
	});
	await writeFile(join(root,
		'runtime/native/framescaper-media-host/linux-x64/ffmpeg'), 'unmanaged executable');
	await assert.rejects(
		() => auditDesktopFfmpegAbsence({ root, label: 'Fixture resources' }),
		/Fixture resources.*framescaper-media-host.*ffmpeg/iu,
	);
	await rm(join(root, 'runtime/native/framescaper-media-host/linux-x64/ffmpeg'));

	await mkdir(join(root, 'runtime/ffmpeg'), { recursive: true });
	await assert.rejects(
		() => auditDesktopFfmpegAbsence({ root, label: 'Fixture resources' }),
		/Fixture resources.*runtime\/ffmpeg/iu,
	);
	await rm(join(root, 'runtime/ffmpeg'), { recursive: true });

	await writeFile(join(root, 'runtime/native/linux-x64/avcodec-61.dll'), 'forbidden libav');
	await assert.rejects(
		() => auditDesktopFfmpegAbsence({ root, label: 'Fixture resources' }),
		/Fixture resources.*avcodec-61\.dll/iu,
	);
	await rm(join(root, 'runtime/native/linux-x64/avcodec-61.dll'));

	await symlink(join(root, 'runtime/native/linux-x64/libaom.so'), join(root, 'ffmpeg-core.wasm'));
	await assert.rejects(
		() => auditDesktopFfmpegAbsence({ root, label: 'Fixture resources' }),
		/Fixture resources.*ffmpeg-core\.wasm/iu,
	);
});

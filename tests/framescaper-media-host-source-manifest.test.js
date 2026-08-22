/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	auditFramescaperMediaHost,
	deriveFramescaperMediaHostPayloadManifest,
	framescaperMediaHostTargetForRuntime,
	readFramescaperMediaHostSourceManifest,
	verifyFramescaperMediaHostPayloadManifest,
} from '../scripts/lib/framescaper-media-host-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const hostRoot = join(repositoryRoot, 'native/framescaper-media-host');

test('the native host pins official FFmpeg 9.0.1 source and its complete local source closure', () => {
	const audit = auditFramescaperMediaHost({ repositoryRoot });
	assert.deepEqual(audit.findings, []);
	assert.deepEqual(audit.manifest.ffmpeg, {
		version: '9.0.1',
		releaseName: 'Lei',
		released: '2026-08-12',
		url: 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
		signatureUrl: 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz.asc',
		signingKeyFingerprint: 'FCF986EA15E6E293A5644F10B4322F04D67658D8',
		byteLength: 12_036_420,
		sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
		extractedTree: {
			algorithm: 'framescaper-portable-source-tree-sha256-v1',
			fileCount: 10_397,
			sha256: 'dc709cc7d80424f45aab44ac94e59f7c8669fe18b877e9e5f1319006bfa622b4',
		},
		configureRecipe: 'build/ffmpeg-9.0.1-configure.json',
		licenceMode: 'GPL-2.0-or-later',
	});
	assert.deepEqual(audit.manifest.boost, {
		version: '1.92.0',
		sourceManifest: 'config/boost-multiprecision-source-manifest.json',
		archiveSha256: '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c',
		headerClosure: {
			algorithm: 'boost-include-closure-sha256-v1',
			roots: ['boost/multiprecision/cpp_int.hpp'],
			fileCount: 254,
			sha256: 'a2f5894e12bc386b7db96936aba5f5bef3910e52da634c7630c73f1fa63e913d',
		},
	});
});

test('five target recipes exist but runtime packaging contains no unbuilt payload', () => {
	const release = verifyFramescaperMediaHostPayloadManifest({ repositoryRoot });
	assert.deepEqual(release.payload.targets.map(({ id }) => id), [
		'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
	]);
	assert.equal(release.payload.targets.every(
		({ status, payload, blockedBy }) => status === 'pending-external' && payload === null && blockedBy.length > 0,
	), true);
	assert.deepEqual(release.payload.payloads, []);
	assert.deepEqual(
		deriveFramescaperMediaHostPayloadManifest(readFramescaperMediaHostSourceManifest(repositoryRoot)),
		release.payload,
	);
	assert.equal(framescaperMediaHostTargetForRuntime('win32', 'arm64')?.id, 'win-arm64');
	assert.equal(framescaperMediaHostTargetForRuntime('darwin', 'x64'), null);
});

test('the candidate recipe disables network, raw FFmpeg arguments, and external codec growth', () => {
	const recipe = JSON.parse(readFileSync(join(hostRoot, 'build/ffmpeg-9.0.1-configure.json'), 'utf8'));
	assert.ok(recipe.configureFlags.includes('--disable-network'));
	assert.ok(recipe.configureFlags.includes('--disable-autodetect'));
	assert.deepEqual(recipe.policy, {
		rawFfmpegArguments: false,
		network: false,
		externalLibraries: [],
		enabledDecoders: ['prores'],
		enabledEncoders: ['prores_ks'],
		enabledDemuxers: ['mov'],
		enabledMuxers: ['mov'],
		enabledProtocols: ['file'],
		blockedComponents: [
			'av1', 'exr', 'h264', 'hevc', 'libvpx-vp9', 'libx264', 'png', 'tiff', 'vp9',
		],
		payloadPublicationRequiresLicensingAndTargetEvidence: true,
	});
	const targets = JSON.parse(readFileSync(join(hostRoot, 'build/targets.json'), 'utf8'));
	assert.deepEqual(targets.targets.map(({ cmakePreset }) => cmakePreset), [
		'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
	]);
});

test('the build input audit binds its Boost requirement to the independently pinned closure', () => {
	const boost = JSON.parse(readFileSync(join(
		repositoryRoot, 'config/boost-multiprecision-source-manifest.json',
	), 'utf8'));
	const source = readFramescaperMediaHostSourceManifest(repositoryRoot);
	assert.equal(source.boost.version, boost.component.version);
	assert.equal(source.boost.archiveSha256, boost.source.sha256);
	assert.deepEqual(source.boost.headerClosure, {
		algorithm: boost.headerClosure.algorithm,
		roots: boost.headerClosure.roots,
		fileCount: boost.headerClosure.fileCount,
		sha256: boost.headerClosure.sha256,
	});
});

test('the browser FFmpeg runtime stays on @ffmpeg/core 0.12.10', () => {
	const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
	const lock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'));
	assert.equal(packageJson.dependencies['@ffmpeg/core'], '0.12.10');
	assert.equal(lock.packages['node_modules/@ffmpeg/core'].version, '0.12.10');
});

test('the C++20 contract fixture self-tests and rejects raw FFmpeg arguments', (context) => {
	const compiler = spawnSync('c++', ['--version'], { encoding: 'utf8' });
	if (compiler.status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-media-host-'));
	try {
		const executable = join(directory, 'framescaper-media-host');
		const built = spawnSync('c++', [
			'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			'-DFRAMESCAPER_MEDIA_HOST_CONTRACT_ONLY=1', '-I', join(hostRoot, 'src'),
			...[
				'media_host.cpp', 'image_sequence_pack.cpp', 'legacy_plan_semantics.cpp',
				'legacy_plan_v8_filter_semantics.cpp', 'media_file_grants.cpp', 'media_plan.cpp',
				'sha256.cpp', 'strict_json.cpp',
			].map((file) => join(hostRoot, 'src', file)),
			'-o', executable,
		], { encoding: 'utf8' });
		assert.equal(built.status, 0, built.stderr);
		const selfTest = spawnSync(executable, ['--self-test'], { encoding: 'utf8' });
		assert.equal(selfTest.status, 0, selfTest.stderr);
		assert.deepEqual(JSON.parse(selfTest.stdout), {
			contractVersion: 1, mode: 'contract-fixture', ok: true,
		});
		const capabilities = spawnSync(executable, ['--capabilities'], { encoding: 'utf8' });
		assert.deepEqual(JSON.parse(capabilities.stdout), {
			contractVersion: 1,
			operations: ['probe-video-source', 'media-decode', 'media-encode', 'media-render', 'media-proxy'],
			rawFfmpegArguments: false,
			network: false,
		});
		const raw = spawnSync(executable, ['-vf', 'movie=/secret'], { encoding: 'utf8' });
		assert.equal(raw.status, 64);
		assert.match(raw.stderr, /does not admit raw FFmpeg or unknown arguments/u);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

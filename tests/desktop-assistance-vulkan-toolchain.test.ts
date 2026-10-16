/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	desktopVulkanToolchainPlan, prepareDesktopVulkanBuild, validateVulkanSourceArchiveEntry, verifyVulkanSourceArchive,
} from '../scripts/lib/desktop-assistance-vulkan-toolchain.mjs';

const root = '/tmp/desktop-vulkan-fixture';

test('Vulkan toolchain supports both native Linux architectures and Windows target architectures', () => {
	for (const [targetId, platform, architecture] of [
		['linux-x64', 'linux', 'x64'], ['linux-arm64', 'linux', 'arm64'],
		['win-x64', 'win32', 'x64'], ['win-arm64', 'win32', 'x64'],
	] as const) {
		const plan = desktopVulkanToolchainPlan({ targetId, platform, architecture, work: root });
		assert.equal(plan.targetId, targetId);
		assert.ok(plan.configureArgs.includes(`-DVulkan_INCLUDE_DIR=${root}/vulkan-toolchain/install/include`));
		assert.ok(plan.configureArgs.some((arg: string) => arg.startsWith('-DVulkan_GLSLC_EXECUTABLE=')));
		assert.ok(plan.configureArgs.some((arg: string) => arg.startsWith('-DSPIRV-Headers_DIR=')));
		assert.ok(plan.loaderArgs.includes('-DUPDATE_DEPS=OFF'));
		assert.ok(plan.shadercArgs.includes('-DSHADERC_SKIP_TESTS=ON'));
		assert.ok(plan.shadercArgs.includes('-DSHADERC_SKIP_INSTALL=OFF'));
		assert.ok(plan.shadercArgs.includes('-DFETCHCONTENT_FULLY_DISCONNECTED=ON'));
	}
});

test('Windows ARM64 uses a target loader and a host-native shader compiler', () => {
	const plan = desktopVulkanToolchainPlan({ targetId: 'win-arm64', platform: 'win32', architecture: 'x64', work: root });
	assert.deepEqual(plan.targetGeneratorArgs, ['-A', 'ARM64']);
	assert.deepEqual(plan.hostGeneratorArgs, ['-A', 'x64']);
	assert.ok(plan.configureArgs.includes(`-DVulkan_LIBRARY=${root}/vulkan-toolchain/install/lib/vulkan-1.lib`));
	assert.ok(plan.configureArgs.includes('-DCMAKE_SKIP_RPATH=ON'));
});

test('Vulkan toolchain rejects unsupported or cross-Linux builds', () => {
	for (const [targetId, platform, architecture] of [
		['mac-arm64', 'darwin', 'arm64'], ['linux-arm64', 'linux', 'x64'], ['win-x64', 'linux', 'x64'],
	] as const) {
		assert.throws(() => desktopVulkanToolchainPlan({ targetId, platform, architecture, work: root }), /target|native/iu);
	}
	assert.throws(() => desktopVulkanToolchainPlan({ targetId: 'linux-x64', platform: 'linux', architecture: 'x64', work: '.' }), /absolute/iu);
});

test('Vulkan source authentication rejects corrupt and oversized cached archives', () => {
	const source = { id: 'test', byteLength: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
	assert.equal(verifyVulkanSourceArchive(Buffer.from('abc'), source).toString(), 'abc');
	assert.throws(() => verifyVulkanSourceArchive(Buffer.from('abd'), source), /digest/iu);
	assert.throws(() => verifyVulkanSourceArchive(Buffer.from('abcd'), source), /length/iu);
});

test('Vulkan source extraction rejects paths outside the pinned source and special files', () => {
	for (const path of ['source/file.cpp', 'source/subdir/']) {
		assert.doesNotThrow(() => validateVulkanSourceArchiveEntry({ path, type: 'File' }, 'source'));
	}
	for (const [path, type] of [
		['other/file', 'File'], ['source/../escape', 'File'], ['source/./file', 'File'],
		['source\\escape', 'File'], ['/source/file', 'File'], ['source/link', 'SymbolicLink'],
		['source/link', 'Link'], ['source/pipe', 'FIFO'],
	]) assert.throws(() => validateVulkanSourceArchiveEntry({ path, type }, 'source'), /entry/iu);
});

test('the complete Vulkan production toolchain has immutable archive pins and no test-only dependencies', async () => {
	const pins = JSON.parse(await readFile(new URL('../config/desktop-assistance-vulkan-sources.json', import.meta.url), 'utf8')) as {
		sources: { id: string; url: string; commit: string; byteLength: number; sha256: string }[];
	};
	assert.deepEqual(pins.sources.map(({ id }) => id), [
		'vulkan-headers', 'vulkan-loader', 'shaderc', 'glslang', 'spirv-headers', 'spirv-tools',
	]);
	for (const source of pins.sources) {
		assert.match(source.commit, /^[a-f0-9]{40}$/u);
		assert.ok(source.url.endsWith(`/tar.gz/${source.commit}`));
		assert.match(source.sha256, /^[a-f0-9]{64}$/u);
		assert.ok(source.byteLength > 0 && source.byteLength < 16 * 1024 * 1024);
	}
});

// A cached archive is still untrusted input; reject it before invoking any compiler.
test('Vulkan preparation authenticates cached source bytes before extraction or compilation', async () => {
	const fixture = await mkdtemp(join(tmpdir(), 'desktop-vulkan-pins-'));
	try {
		const cacheRoot = join(fixture, 'cache');
		const work = join(fixture, 'work');
		const commit = 'e3b1eec08173d6b825cd3ac88c885a63b621504a';
		const cache = join(cacheRoot, 'vulkan-sources', commit);
		await mkdir(cache, { recursive: true });
		await writeFile(join(cache, 'source.tar.gz'), 'corrupt');
		await assert.rejects(prepareDesktopVulkanBuild({
			targetId: 'linux-x64', platform: 'linux', architecture: 'x64', cacheRoot, work,
		}), /source archive length/iu);
	} finally {
		await rm(fixture, { recursive: true, force: true });
	}
});

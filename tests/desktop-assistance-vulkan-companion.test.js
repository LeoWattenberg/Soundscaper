/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildDesktopVulkanCompanion, patchGgmlVulkanShaderGenerator } from '../scripts/lib/desktop-assistance-vulkan-companion.mjs';

test('Vulkan shader generation selects the Windows host architecture and rejects upstream drift', () => {
	const source = '    ExternalProject_Add(\n        vulkan-shaders-gen\n        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/vulkan-shaders';
	const patched = patchGgmlVulkanShaderGenerator(source);
	assert.ok(patched.includes('CMAKE_GENERATOR "${CMAKE_GENERATOR}"'));
	assert.ok(patched.includes('CMAKE_GENERATOR_PLATFORM "${GGML_VULKAN_SHADERS_GEN_PLATFORM}"'));
	assert.throws(() => patchGgmlVulkanShaderGenerator(patched), /exact source/u);
	assert.throws(() => patchGgmlVulkanShaderGenerator(`${source}\n${source}`), /exact source/u);
});

test('Vulkan companion builds use their own directory and preserve engine reproducibility controls', async (context) => {
	const work = await mkdtemp(join(tmpdir(), 'vulkan-companion-'));
	context.after(() => rm(work, { recursive: true, force: true }));
	const calls = [];
	const notices = [{ path: 'VULKAN-NOTICES.txt', bytes: Buffer.from('notice'), sources: ['pinned/LICENSE'] }];
	const plan = { targetId: 'linux-x64', executable: 'whisper-cli',
		vulkanConfigureArgs: ['-DBUILD_SHARED_LIBS=OFF', '-DGGML_VULKAN=ON'] };
	const prepare = async (options) => {
		assert.equal(options.targetId, 'linux-x64');
		assert.equal(options.work, work);
		return { configureArgs: ['-DVulkan_LIBRARY=/pinned/libvulkan.so'], notices,
			provenance: { schemaVersion: 1, source: 'pinned' },
			environment: { LD_LIBRARY_PATH: '/pinned', PATH: '/pinned/bin:/system/bin', SOURCE_DATE_EPOCH: 'toolchain' } };
	};
	const run = async (executable, args, cwd, environment) => {
		calls.push({ executable, args, cwd, environment });
		if (args[0] === '--build') {
			await mkdir(join(work, 'build-vulkan', 'bin'), { recursive: true });
			await writeFile(join(work, 'build-vulkan', 'bin', 'whisper-cli'), 'binary');
		}
	};
	const built = await buildDesktopVulkanCompanion({ plan, work, source: join(work, 'source'),
		cacheRoot: join(work, 'cache'), platform: 'linux', architecture: 'x64',
		environment: { SOURCE_DATE_EPOCH: 'engine', GIT_CEILING_DIRECTORIES: work, PATH: '/system/bin' },
		reproducibleFlags: '-ffile-prefix-map=work=/usr/src/engine-build -fno-ident',
		prepare, run });
	assert.equal(built.binary, join(work, 'build-vulkan', 'bin', 'whisper-cli'));
	assert.equal(built.notices, notices);
	assert.deepEqual(built.provenance, { configureArgs: plan.vulkanConfigureArgs,
		toolchain: { schemaVersion: 1, source: 'pinned' } });
	assert.deepEqual(built.environment, { LD_LIBRARY_PATH: '/pinned', PATH: '/pinned/bin:/system/bin', SOURCE_DATE_EPOCH: 'engine',
		GIT_CEILING_DIRECTORIES: work });
	assert.deepEqual(calls[0].args.slice(0, 4), ['-S', join(work, 'source'), '-B', join(work, 'build-vulkan')]);
	assert.ok(calls[0].args.includes('-DGGML_VULKAN=ON'));
	assert.ok(calls[0].args.includes('-DVulkan_LIBRARY=/pinned/libvulkan.so'));
	assert.ok(calls[0].args.includes('-DCMAKE_CXX_FLAGS=-ffile-prefix-map=work=/usr/src/engine-build -fno-ident'));
	assert.deepEqual(calls[1].args, ['--build', join(work, 'build-vulkan'), '--config', 'Release',
		'--target', 'whisper-cli', '--parallel', '4']);
});

test('Vulkan companion compilation failures fail packaging instead of silently shipping CPU only', async () => {
	await assert.rejects(buildDesktopVulkanCompanion({ plan: { targetId: 'linux-arm64',
		executable: 'llama-completion', target: 'llama-completion', vulkanConfigureArgs: ['-DGGML_VULKAN=ON'] },
		source: '/source', work: '/work', cacheRoot: '/cache', platform: 'linux', architecture: 'arm64',
		environment: {}, prepare: async () => ({ configureArgs: [], environment: {} }),
		run: () => Promise.reject(new Error('shader compilation failed')) }), /shader compilation failed/u);
});

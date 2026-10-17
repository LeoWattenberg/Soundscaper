/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { patchGgmlVulkanShaderGenerator } from '../scripts/lib/desktop-assistance-vulkan-companion.mjs';

const runFile = promisify(execFile);

for (const host of ['x64', 'ARM64']) test(`Vulkan's ${host} shader generator configures independently of the engine target`, async context => {
	const root = await mkdtemp(join(tmpdir(), 'vulkan cmake '));
	context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
	const source = join(root, 'source');
	const build = join(root, 'build');
	await mkdir(join(source, 'vulkan-shaders'), { recursive: true });
	await writeFile(join(source, 'vulkan-shaders/CMakeLists.txt'), `
cmake_minimum_required(VERSION 3.20)
project(shader_generator_fixture LANGUAGES NONE)
file(WRITE "\${CMAKE_CURRENT_BINARY_DIR}/host-platform.txt" "\${CMAKE_GENERATOR_PLATFORM}")
`);
	// Keep the upstream ExternalProject layout and execute the real patch. The
	// platform option is checked even on Linux, before any Windows build starts.
	await writeFile(join(source, 'CMakeLists.txt'), patchGgmlVulkanShaderGenerator(`
cmake_minimum_required(VERSION 3.20)
project(engine_fixture LANGUAGES NONE)
include(ExternalProject)
    ExternalProject_Add(
        vulkan-shaders-gen
        SOURCE_DIR \${CMAKE_CURRENT_SOURCE_DIR}/vulkan-shaders
        BINARY_DIR \${CMAKE_BINARY_DIR}/host-generator
        CMAKE_ARGS -DCMAKE_BUILD_TYPE=Release
        INSTALL_COMMAND ""
    )
`));
	await runFile('cmake', ['-S', source, '-B', build,
		// Cross the parent target to ensure the child uses the requested host.
		...(process.platform === 'win32' ? ['-A', host === 'x64' ? 'ARM64' : 'x64'] : []),
		`-DGGML_VULKAN_SHADERS_GEN_PLATFORM=${host}`,
	], { timeout: 30_000 });
	const cache = await readFile(join(build, 'CMakeCache.txt'), 'utf8');
	const generator = /^CMAKE_GENERATOR:INTERNAL=(.+)$/mu.exec(cache)?.[1]?.trim();
	assert.ok(generator);
	const command = await readFile(join(build, 'vulkan-shaders-gen-prefix/tmp/vulkan-shaders-gen-cfgcmd.txt'), 'utf8');
	assert.ok(command.includes(`-G${generator};`), 'The platform requires an explicit generator.');
	assert.ok(command.includes(`-A${host};`), 'The child must use the host platform, not the engine target.');
	if (process.platform === 'win32') {
		await runFile('cmake', ['--build', build, '--config', 'Release'], { timeout: 30_000 });
		assert.equal(await readFile(join(build, 'host-generator/host-platform.txt'), 'utf8'), host);
	}
});

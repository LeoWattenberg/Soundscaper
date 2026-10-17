/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDesktopVulkanBuild } from './desktop-assistance-vulkan-toolchain.mjs';

const VULKAN_CMAKE_SHA256 = '95b77526cbede60b669abf1bc13657956284d0b20835096e64f24682a5a1a0e2';
const SHADER_GENERATOR_BEFORE = '    ExternalProject_Add(\n        vulkan-shaders-gen\n        SOURCE_DIR';
const SHADER_GENERATOR_AFTER = '    ExternalProject_Add(\n        vulkan-shaders-gen\n        CMAKE_GENERATOR "${CMAKE_GENERATOR}"\n        CMAKE_GENERATOR_PLATFORM "${GGML_VULKAN_SHADERS_GEN_PLATFORM}"\n        SOURCE_DIR';

/** Keep the portable CPU executable independent of the optional system Vulkan loader. */
export async function buildDesktopVulkanCompanion({ plan, source, work, cacheRoot,
	platform, architecture, environment, reproducibleFlags, run, prepare = prepareDesktopVulkanBuild }) {
	const toolchain = await prepare({ targetId: plan.targetId, cacheRoot, work, platform, architecture });
	const patches = [];
	if (platform === 'win32') {
		const file = 'ggml/src/ggml-vulkan/CMakeLists.txt';
		const sourcePath = join(source, file), original = await readFile(sourcePath, 'utf8');
		if (hash(original) !== VULKAN_CMAKE_SHA256) throw new Error('Vulkan shader-generator patch source changed.');
		const patched = patchGgmlVulkanShaderGenerator(original);
		await writeFile(sourcePath, patched);
		patches.push({ id: 'windows-host-shader-generator-v2', file,
			inputSha256: VULKAN_CMAKE_SHA256, outputSha256: hash(patched),
			patchSha256: hash(JSON.stringify({ before: SHADER_GENERATOR_BEFORE, after: SHADER_GENERATOR_AFTER })) });
	}
	const build = join(work, 'build-vulkan');
	const configureArgs = ['-S', source, '-B', build, ...plan.vulkanConfigureArgs, ...toolchain.configureArgs];
	if (platform !== 'win32') configureArgs.push(`-DCMAKE_C_FLAGS=${reproducibleFlags}`,
		`-DCMAKE_CXX_FLAGS=${reproducibleFlags}`);
	// The toolchain provides its loader search path; each engine keeps its own
	// reproducible timestamps and source-path isolation.
	const buildEnvironment = { ...toolchain.environment, ...environment,
		...Object.fromEntries(['LD_LIBRARY_PATH', 'PATH'].filter((key) => toolchain.environment[key])
			.map((key) => [key, toolchain.environment[key]])) };
	await run('cmake', configureArgs, work, buildEnvironment);
	await run('cmake', ['--build', build, '--config', 'Release', '--target',
		plan.target ?? 'whisper-cli', '--parallel', '4'], work, buildEnvironment);
	const binary = await builtExecutable(build, plan.executable);
	return { binary, notices: toolchain.notices, environment: buildEnvironment,
		provenance: { configureArgs: plan.vulkanConfigureArgs, toolchain: toolchain.provenance,
			...(patches.length ? { patches } : {}) } };
}

/** Shader generators execute on the runner, including when targeting Windows ARM64. */
export function patchGgmlVulkanShaderGenerator(source) {
	if (source.split(SHADER_GENERATOR_BEFORE).length !== 2 || source.includes(SHADER_GENERATOR_AFTER)) {
		throw new Error('Vulkan shader-generator patch does not match its exact source context.');
	}
	return source.replace(SHADER_GENERATOR_BEFORE, SHADER_GENERATOR_AFTER);
}

async function builtExecutable(build, name) {
	for (const path of [join(build, 'bin', name), join(build, 'bin', 'Release', name)]) {
		try {
			const stat = await lstat(path);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) throw new Error('Vulkan companion executable is invalid.');
			return path;
		} catch (error) { if (error.code !== 'ENOENT') throw error; }
	}
	throw new Error('Vulkan build did not produce its companion executable.');
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

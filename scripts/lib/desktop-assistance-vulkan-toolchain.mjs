/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { extract, list } from 'tar';

const runFile = promisify(execFile);
const PINS = JSON.parse(await readFile(new URL('../../config/desktop-assistance-vulkan-sources.json', import.meta.url), 'utf8'));
const TARGETS = ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'];
const LICENSE_PATHS = {
	'vulkan-headers': 'LICENSE.md', 'vulkan-loader': 'LICENSE.txt', shaderc: 'LICENSE',
	glslang: 'LICENSE.txt', 'spirv-headers': 'LICENSE', 'spirv-tools': 'LICENSE',
};

/** Build only the pinned production source closure. No SDK, FetchContent, or driver is downloaded. */
export async function prepareDesktopVulkanBuild({
	targetId, cacheRoot, work, platform = process.platform, architecture = process.arch,
}) {
	const plan = desktopVulkanToolchainPlan({ targetId, work, platform, architecture });
	if (!isAbsolute(cacheRoot)) throw new TypeError('Vulkan staging requires an absolute cache root.');
	const sourceRoots = {};
	await mkdir(plan.root, { recursive: true });
	for (const source of PINS.sources) {
		const cache = resolve(cacheRoot, 'vulkan-sources', source.commit);
		await mkdir(cache, { recursive: true });
		const bytes = await authenticatedSourceArchive(source, cache);
		const archive = join(plan.root, `${source.id}.tar.gz`);
		await writeFile(archive, bytes, { flag: 'wx', mode: 0o400 });
		await extractSource(archive, plan.root, source.root);
		sourceRoots[source.id] = join(plan.root, source.root);
	}
	await verifyShadercDependencies(sourceRoots);
	const environment = {
		...process.env, SOURCE_DATE_EPOCH: '1784257917', TZ: 'UTC', LC_ALL: 'C',
		GIT_CEILING_DIRECTORIES: work,
	};
	for (const id of ['vulkan-headers', 'spirv-headers']) {
		await configure(id, [], plan.targetGeneratorArgs);
		await command('cmake', ['--install', join(plan.root, `build-${id}`), '--config', 'Release'], plan.root, environment);
	}
	await configure('vulkan-loader', plan.loaderArgs, plan.targetGeneratorArgs);
	await build('vulkan-loader', 'vulkan');
	await command('cmake', ['--install', join(plan.root, 'build-vulkan-loader'), '--config', 'Release'], plan.root, environment);
	await configure('shaderc', [...plan.shadercArgs,
		`-DSHADERC_GLSLANG_DIR=${sourceRoots.glslang}`,
		`-DSHADERC_SPIRV_TOOLS_DIR=${sourceRoots['spirv-tools']}`,
		`-DSHADERC_SPIRV_HEADERS_DIR=${sourceRoots['spirv-headers']}`,
	], plan.hostGeneratorArgs);
	await build('shaderc', 'glslc_exe');
	const glslc = await regularFile(plan.glslc);
	const loader = await regularFile(plan.loader);
	const version = (await command(plan.glslc, ['--version'], plan.root, environment)).stdout.trim();
	const notices = await sourceNotices(sourceRoots);
	return {
		configureArgs: plan.configureArgs,
		// Engine reproducibility variables take precedence when callers merge this
		// environment. The source-built loader is needed only for build canaries.
		environment: platform === 'linux' ? { LD_LIBRARY_PATH: join(plan.install, 'lib') }
			: { PATH: `${join(plan.install, 'bin')};${process.env.PATH ?? ''}` },
		provenance: {
			recipeId: 'pinned-vulkan-toolchain-v1', sdkVersion: PINS.sdkVersion,
			shadercVersion: PINS.shadercVersion, targetId, hostArchitecture: architecture,
			sourceDateEpoch: Number(environment.SOURCE_DATE_EPOCH),
			sources: PINS.sources,
			shaderCompiler: { version, byteLength: glslc.byteLength, sha256: hash(glslc) },
			loaderImportLibrary: { byteLength: loader.byteLength, sha256: hash(loader) },
			runtimeDependency: platform === 'win32' ? 'System Vulkan loader vulkan-1.dll and vendor driver.'
				: 'System Vulkan loader libvulkan.so.1 and vendor driver.',
		},
		notices,
	};

	async function configure(id, args, generatorArgs) {
		const reproducible = platform === 'win32'
			? ['-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
				'-DCMAKE_C_FLAGS=/Brepro', '-DCMAKE_CXX_FLAGS=/Brepro /EHsc',
				'-DCMAKE_EXE_LINKER_FLAGS=/Brepro', '-DCMAKE_SHARED_LINKER_FLAGS=/Brepro']
			: [`-DCMAKE_C_FLAGS=-ffile-prefix-map=${work}=/usr/src/vulkan-build -fno-ident`,
				`-DCMAKE_CXX_FLAGS=-ffile-prefix-map=${work}=/usr/src/vulkan-build -fno-ident`];
		await command('cmake', ['-S', sourceRoots[id], '-B', join(plan.root, `build-${id}`),
			...generatorArgs, '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_INSTALL_PREFIX=${plan.install}`,
			'-DCMAKE_INSTALL_LIBDIR=lib', '-DFETCHCONTENT_FULLY_DISCONNECTED=ON',
			...reproducible, ...args], plan.root, environment);
	}
	async function build(id, target) {
		await command('cmake', ['--build', join(plan.root, `build-${id}`), '--config', 'Release',
			'--target', target, '--parallel', '4'], plan.root, environment);
	}
}

/** Keep host shader tools distinct from a cross-compiled Windows ARM64 loader. */
export function desktopVulkanToolchainPlan({ targetId, work, platform, architecture }) {
	if (!['linux', 'win32'].includes(platform) || !TARGETS.includes(targetId)) throw new TypeError('Vulkan target is unsupported.');
	const operatingSystem = platform === 'win32' ? 'win' : platform;
	if (!['x64', 'arm64'].includes(architecture) || !targetId.startsWith(`${operatingSystem}-`)
		|| (platform === 'linux' && targetId !== `linux-${architecture}`)) {
		throw new Error('Vulkan requires a native Linux runner or a Windows target runner.');
	}
	if (!isAbsolute(work)) throw new TypeError('Vulkan staging requires an absolute work directory.');
	const root = join(work, 'vulkan-toolchain'), install = join(root, 'install');
	const windows = platform === 'win32';
	const glslc = windows ? join(root, 'build-shaderc', 'glslc', 'Release', 'glslc.exe')
		: join(root, 'build-shaderc', 'glslc', 'glslc');
	const loader = join(install, 'lib', windows ? 'vulkan-1.lib' : 'libvulkan.so.1.4.357');
	const targetGeneratorArgs = windows ? ['-A', targetId === 'win-arm64' ? 'ARM64' : 'x64'] : [];
	const hostGeneratorArgs = windows ? ['-A', architecture === 'arm64' ? 'ARM64' : 'x64'] : [];
	const loaderArgs = [`-DCMAKE_PREFIX_PATH=${install}`,
		`-DVulkanHeaders_DIR=${join(install, 'share', 'cmake', 'VulkanHeaders')}`, '-DUPDATE_DEPS=OFF', '-DBUILD_TESTS=OFF',
		'-DBUILD_WERROR=OFF', '-DLOADER_CODEGEN=OFF', '-DSYSCONFDIR=/etc',
		'-DBUILD_WSI_XCB_SUPPORT=OFF', '-DBUILD_WSI_XLIB_SUPPORT=OFF',
		'-DBUILD_WSI_XLIB_XRANDR_SUPPORT=OFF', '-DBUILD_WSI_WAYLAND_SUPPORT=OFF'];
	const shadercArgs = ['-DSHADERC_SKIP_TESTS=ON', '-DSHADERC_SKIP_EXAMPLES=ON',
		'-DSHADERC_SKIP_COPYRIGHT_CHECK=ON', '-DSHADERC_SKIP_INSTALL=OFF',
		'-DSHADERC_ENABLE_WERROR_COMPILE=OFF', '-DSHADERC_ENABLE_SHARED_CRT=OFF',
		'-DSPIRV_SKIP_TESTS=ON', '-DENABLE_GLSLANG_BINARIES=OFF', '-DFETCHCONTENT_FULLY_DISCONNECTED=ON'];
	const configureArgs = [`-DVulkan_INCLUDE_DIR=${join(install, 'include')}`, `-DVulkan_LIBRARY=${loader}`,
		`-DVulkan_GLSLC_EXECUTABLE=${glslc}`,
		`-DSPIRV-Headers_DIR=${join(install, 'share', 'cmake', 'SPIRV-Headers')}`,
		...(windows ? [`-DGGML_VULKAN_SHADERS_GEN_PLATFORM=${architecture === 'arm64' ? 'ARM64' : 'x64'}`] : []),
		// Never embed an absolute build directory as a loader search location.
		'-DCMAKE_SKIP_RPATH=ON', '-DFETCHCONTENT_FULLY_DISCONNECTED=ON'];
	return { targetId, root, install, glslc, loader, targetGeneratorArgs, hostGeneratorArgs,
		loaderArgs, shadercArgs, configureArgs };
}

export function verifyVulkanSourceArchive(bytes, source) {
	if (bytes.byteLength !== source.byteLength) throw new Error(`Vulkan ${source.id} source archive length changed.`);
	if (hash(bytes) !== source.sha256) throw new Error(`Vulkan ${source.id} source archive digest changed.`);
	return bytes;
}

export function validateVulkanSourceArchiveEntry(entry, root) {
	const components = entry.path.split('/').filter(Boolean);
	if (entry.path.startsWith('/') || components[0] !== root || components.some((part) => part === '..' || part === '.')
		|| entry.path.includes('\\') || !['File', 'Directory'].includes(entry.type)) {
		throw new Error('Vulkan archive contains an unexpected source entry.');
	}
}

async function authenticatedSourceArchive(source, cache) {
	const archive = join(cache, 'source.tar.gz');
	try { return verifyVulkanSourceArchive(await readFile(archive), source); }
	catch (error) { if (error.code !== 'ENOENT') throw error; }
	const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok || !response.body) throw new Error(`Vulkan source download failed: ${response.status}`);
	const chunks = [];
	let length = 0;
	for await (const value of response.body) {
		length += value.byteLength;
		if (length > source.byteLength) throw new RangeError('Vulkan source exceeds its pinned download bound.');
		chunks.push(value);
	}
	const bytes = verifyVulkanSourceArchive(Buffer.concat(chunks), source);
	// Publish complete bytes atomically when Whisper and Qwen build in parallel.
	const temporary = await mkdtemp(join(cache, 'download-'));
	try {
		const complete = join(temporary, 'source.tar.gz');
		await writeFile(complete, bytes, { flag: 'wx' });
		try { await link(complete, archive); }
		catch (error) {
			if (error.code !== 'EEXIST') throw error;
			return verifyVulkanSourceArchive(await readFile(archive), source);
		}
		return bytes;
	} finally { await rm(temporary, { recursive: true, force: true }); }
}

async function extractSource(archive, destination, root) {
	let entries = 0, bytes = 0;
	await list({ file: archive, strict: true, onentry(entry) {
		validateVulkanSourceArchiveEntry(entry, root);
		entries += 1;
		bytes += entry.size;
		if (entries > 30_000 || bytes > 256 * 1024 * 1024 || entry.size > 40 * 1024 * 1024) {
			throw new RangeError('Vulkan source extraction exceeds its bounds.');
		}
	} });
	await extract({ file: archive, cwd: destination, strict: true, preservePaths: false });
}

async function verifyShadercDependencies(roots) {
	const deps = await readFile(join(roots.shaderc, 'DEPS'), 'utf8');
	for (const [id, field] of [['glslang', 'glslang'], ['spirv-headers', 'spirv_headers'], ['spirv-tools', 'spirv_tools']]) {
		const commit = PINS.sources.find((source) => source.id === id).commit;
		if (!deps.includes(`'${field}_revision': '${commit}'`)) {
			throw new Error(`Pinned shaderc dependency does not match ${id}.`);
		}
	}
}

async function sourceNotices(roots) {
	const text = ['Vulkan GPU companion build and runtime source notices',
		'Vulkan-Headers copyright 2015-2026 The Khronos Group Inc.; Apache-2.0 OR MIT.',
		'The GPU executable uses the system Vulkan loader and graphics driver. Neither is distributed here.',
	];
	const sources = [];
	for (const source of PINS.sources) {
		const path = LICENSE_PATHS[source.id];
		sources.push(`${source.url}#${path}`);
		text.push(`${source.id}: ${source.url}\n${path}`, await readFile(join(roots[source.id], path), 'utf8'));
	}
	return [{ path: 'VULKAN_NOTICES.txt', bytes: Buffer.from(`${text.join('\n\n')}\n`), sources }];
}

async function regularFile(path) {
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) throw new Error('Vulkan build output is not a regular file.');
	return readFile(path);
}

async function command(executable, args, cwd, env) {
	try { return await runFile(executable, args, { cwd, env, windowsHide: true,
		maxBuffer: 16 * 1024 * 1024, timeout: 25 * 60_000 }); }
	catch (error) { throw new Error(`Vulkan toolchain build failed: ${executable} ${args.join(' ')}\n${error.stderr ?? ''}\n${error.stdout ?? ''}`, { cause: error }); }
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

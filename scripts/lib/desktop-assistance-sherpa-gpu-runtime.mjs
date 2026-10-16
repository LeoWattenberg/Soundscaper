/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build the authenticated Sherpa speech runtime against GPU-capable native ORT. */

import { execFile } from 'node:child_process';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import nativeManifest from '../../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import recipe from '../../config/assistance-sherpa-gpu-build.json' with { type: 'json' };
import {
	createDesktopAssistanceOnnxNativeClosureManifest, prepareDesktopAssistanceOnnxNativeClosure,
} from './desktop-assistance-onnx-native-closure.mjs';
import {
	hash, patchSherpaGpuSources, prepareSherpaGpuSources, sherpaGpuSourceNotices,
	validateSherpaGpuSourceEntry, verifySherpaGpuSource,
} from './desktop-assistance-sherpa-gpu-sources.mjs';

export { validateSherpaGpuSourceEntry, verifySherpaGpuSource };

const runFile = promisify(execFile);
const TARGETS = ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'];
const BUILD_ARGS = ['--config', 'Release', '--target', 'sherpa-onnx-node', 'sherpa-onnx-cxx-api', 'onnx-webgpu-device-probe', '--parallel', '4'];
const CONFIGURE_ARGS = [
	'-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=ON', '-DFETCHCONTENT_FULLY_DISCONNECTED=ON',
	'-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=ON', '-DSHERPA_ONNX_ENABLE_TTS=OFF',
	'-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF', '-DSHERPA_ONNX_ENABLE_BINARY=OFF',
	'-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF', '-DSHERPA_ONNX_ENABLE_TESTS=OFF',
	'-DSHERPA_ONNX_ENABLE_PYTHON=OFF', '-DSHERPA_ONNX_BUILD_C_API_EXAMPLES=OFF',
	'-DSHERPA_ONNX_ENABLE_C_API=ON', '-DSHERPA_ONNX_USE_STATIC_CRT=ON',
	'-DCMAKE_POLICY_VERSION_MINIMUM=3.10',
];

export function desktopSherpaGpuBuildPlan({ targetId, platform = process.platform, architecture = process.arch }) {
	const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	if (!TARGETS.includes(targetId) || !['darwin', 'linux', 'win32'].includes(platform)
		|| !targetId.startsWith(`${os}-`) || !['x64', 'arm64'].includes(architecture)
		|| platform !== 'win32' && targetId !== `${os}-${architecture}`) {
		throw new Error('Sherpa GPU builds require a matching native target runner.');
	}
	return {
		targetId, generatorArgs: platform === 'win32' ? ['-A', targetId === 'win-arm64' ? 'ARM64' : 'x64'] : [],
		configureArgs: [...CONFIGURE_ARGS], buildArgs: [...BUILD_ARGS],
		executionProviders: targetId === 'mac-arm64' ? ['coreml', 'webgpu', 'cpu'] : ['webgpu', 'cpu'],
	};
}

export function desktopSherpaGpuRecipeSourceBuild() {
	return {
		recipeId: recipe.recipeId, sourceRevision: recipe.sourceRevision,
		sourceSha256: recipe.sources[0].sha256, recipeSha256: hash(Buffer.from(JSON.stringify(recipe))),
	};
}

export function createSherpaGpuBuildWorkDirectory({ cacheRoot, platform = process.platform }) {
	if (platform !== 'win32') return mkdtemp(join(cacheRoot, 'build-'));
	// MSBuild's tracking logs still obey MAX_PATH even on long-path-enabled hosts.
	// Keep the deep dependency build tree outside the checkout/cache on Windows.
	return mkdtemp(join(tmpdir(), 'sc-sg-'));
}

/** Receipts may replace only the selected platform package; all other pins stay reviewed. */
export function validateDesktopAssistanceSherpaGpuBuildReceipt(value) {
	if (!value || value.schemaVersion !== 1 || !TARGETS.includes(value.targetId) || !value.manifest || !value.provenance
		|| !same(Object.keys(value).sort(), ['manifest', 'provenance', 'schemaVersion', 'targetId'])) {
		throw new TypeError('The Sherpa GPU build receipt identity is invalid.');
	}
	const { targetId } = value;
	const base = structuredClone(value.manifest), target = base.targets?.[targetId];
	if (!target) throw new TypeError('The Sherpa GPU target is missing.');
	base.targets[targetId] = nativeManifest.targets[targetId];
	if (!same(base, nativeManifest)) throw new TypeError('The Sherpa GPU receipt changed another target or the common package.');
	const built = target.package, closure = createDesktopAssistanceOnnxNativeClosureManifest(targetId);
	const expectedNames = [...closure.files.map(({ path }) => path), ...generatedNames(targetId)].sort();
	if (target.status !== 'built' || !same(Object.keys(target).sort(), ['executionProviders', 'package', 'status'])
		|| !same(target.executionProviders, providers(targetId))
		|| !built || !same(Object.keys(built).sort(), ['files', 'integrity', 'name', 'sourceBuild', 'sourceUrl', 'version'])
		|| built.name !== packageName(targetId) || built.version !== recipe.version
		|| built.sourceUrl !== recipe.sources[0].url || !/^sha512-[A-Za-z\d+/]+={0,2}$/u.test(built.integrity ?? '')
		|| built.integrity !== recipe.sources[0].integrity
		|| !same(built.sourceBuild, desktopSherpaGpuRecipeSourceBuild())
		|| !built.files || !same(Object.keys(built.files).sort(), expectedNames)) {
		throw new TypeError('The Sherpa GPU receipt package, providers, or source pins are invalid.');
	}
	for (const file of closure.files) {
		if (!same(built.files[file.path], { byteLength: file.byteLength, sha256: file.sha256 })) {
			throw new TypeError('The Sherpa GPU receipt changed a pinned ONNX provider library.');
		}
	}
	for (const file of Object.values(built.files)) {
		if (!file || !same(Object.keys(file).sort(), ['byteLength', 'sha256'])
			|| !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > 512 * 1024 * 1024
			|| !/^[a-f\d]{64}$/u.test(file.sha256)) throw new TypeError('The Sherpa GPU file pin is invalid.');
	}
	const provenance = value.provenance;
	if (!same(Object.keys(provenance).sort(), [
		'buildArgs', 'cmakeVersion', 'compiler', 'configureArgs', 'nativeRecipeFiles', 'nodeAddonApiVersion',
		'nodeHeadersVersion', 'onnxRuntime', 'recipeId', 'recipeSourceBuild', 'schemaVersion', 'sourceDateEpoch',
		'sourceRevision', 'sources', 'targetId',
	]) || provenance.schemaVersion !== 1 || provenance.recipeId !== recipe.recipeId || provenance.targetId !== targetId
		|| provenance.sourceRevision !== recipe.sourceRevision || provenance.nodeHeadersVersion !== recipe.nodeHeadersVersion
		|| provenance.nodeAddonApiVersion !== recipe.nodeAddonApiVersion || provenance.sourceDateEpoch !== 1786406400
		|| !/^cmake version \d+\.\d+/u.test(provenance.cmakeVersion)
		|| !/^[A-Za-z][A-Za-z\d_]*$/u.test(provenance.compiler?.id ?? '')
		|| !/^\d+(?:\.\d+){1,3}(?:[-+][A-Za-z\d.-]+)?$/u.test(provenance.compiler?.version ?? '')
		|| !same(provenance.recipeSourceBuild, desktopSherpaGpuRecipeSourceBuild())
		|| !same(provenance.configureArgs, CONFIGURE_ARGS) || !same(provenance.buildArgs, BUILD_ARGS)
		|| !same(provenance.nativeRecipeFiles, recipe.nativeRecipeFiles)
		|| !same(provenance.sources, recipe.sources.map(({ id, url, sha256, byteLength }) => ({ id, url, sha256, byteLength })))
		|| !same(provenance.onnxRuntime, closure)) throw new TypeError('The Sherpa GPU receipt provenance is invalid.');
	const bytes = Buffer.from(`${JSON.stringify(provenance, null, '\t')}\n`);
	if (!same(built.files['build-provenance.json'], fingerprint(bytes))) throw new TypeError('The Sherpa GPU provenance file digest is invalid.');
	return value;
}

export async function prepareDesktopAssistanceSherpaGpu({
	repositoryRoot, targetId, cacheRoot, nodeModulesRoot = join(repositoryRoot, 'node_modules'),
	platform = process.platform, architecture = process.arch, fetchImpl = globalThis.fetch,
}) {
	const plan = desktopSherpaGpuBuildPlan({ targetId, platform, architecture });
	if (![repositoryRoot, cacheRoot, nodeModulesRoot].every(isAbsolute)) throw new TypeError('Sherpa GPU builds require absolute roots.');
	for (const [path, sha256] of Object.entries(recipe.nativeRecipeFiles)) {
		if (hash(await readFile(join(repositoryRoot, path))) !== sha256) throw new Error('The Sherpa GPU native recipe differs from its reviewed digest.');
	}
	const cache = resolve(cacheRoot, 'sherpa-gpu-builds', recipe.sourceRevision);
	await mkdir(cache, { recursive: true });
	const work = await createSherpaGpuBuildWorkDirectory({ cacheRoot: cache, platform });
	try {
		const { roots, downloads } = await prepareSherpaGpuSources({ recipe, cacheRoot, work, targetId, fetchImpl });
		await patchSherpaGpuSources(roots['sherpa-source'], recipe);
		const packageRoot = join(work, 'node_modules', packageName(targetId));
		const ort = await prepareDesktopAssistanceOnnxNativeClosure({ targetId, outputRoot: packageRoot, cacheRoot, fetchImpl });
		const build = join(work, 'compiled');
		const args = ['-S', join(repositoryRoot, 'native', 'assistance-sherpa-gpu'), '-B', build,
			...plan.generatorArgs, ...plan.configureArgs,
			`-DSHERPA_SOURCE=${roots['sherpa-source']}`, `-DORT_INCLUDE=${ort.includeRoot}`, `-DORT_LIBRARY=${ort.libraryPath}`,
			`-DNODE_HEADERS=${roots['node-headers']}`, `-DNODE_ADDON_API=${roots['node-addon-api']}`, `-DSCAPE_WORK_ROOT=${work}`,
			...recipe.sources.filter(({ fetchContentId }) => fetchContentId)
				.map(({ id, fetchContentId }) => `-DFETCHCONTENT_SOURCE_DIR_${fetchContentId}=${roots[id]}`)];
		if (platform === 'win32') {
			const nodeLibrary = join(work, 'node.lib'), delayHook = join(work, 'win_delay_load_hook.cc');
			await copyFile(downloads[targetId === 'win-arm64' ? 'node-arm64-lib' : 'node-x64-lib'], nodeLibrary);
			await copyFile(downloads['node-delay-hook'], delayHook);
			args.push(`-DNODE_LIBRARY=${nodeLibrary}`, `-DNODE_DELAY_HOOK=${delayHook}`);
		}
		const environment = { ...process.env, SOURCE_DATE_EPOCH: '1786406400', TZ: 'UTC', LC_ALL: 'C', GIT_CEILING_DIRECTORIES: work };
		const cmakeVersion = (await command('cmake', ['--version'], work, environment)).stdout.split('\n')[0].trim();
		await command('cmake', args, work, environment);
		await command('cmake', ['--build', build, ...plan.buildArgs], work, environment);
		const addon = await locateBuildFile(build, 'sherpa-onnx.node');
		assertSherpaGpuBinaryArchitecture(await readFile(addon), targetId);
		await copyFile(addon, join(packageRoot, 'sherpa-onnx.node'));
		for (const name of generatedNames(targetId).filter((name) => /\.(?:dll|dylib|so)$/u.test(name) || name.startsWith('onnx-webgpu-device-probe'))) {
			const compiled = await locateBuildFile(build, name);
			assertSherpaGpuBinaryArchitecture(await readFile(compiled), targetId);
			await copyFile(compiled, join(packageRoot, name));
		}
		await writeFile(join(packageRoot, 'SHERPA_NOTICES.txt'), await sherpaGpuSourceNotices(roots, downloads));
		const provenance = {
			schemaVersion: 1, recipeId: recipe.recipeId, targetId, sourceRevision: recipe.sourceRevision,
			nodeHeadersVersion: recipe.nodeHeadersVersion, nodeAddonApiVersion: recipe.nodeAddonApiVersion,
			sourceDateEpoch: 1786406400, cmakeVersion, compiler: await compilerIdentity(build),
			recipeSourceBuild: desktopSherpaGpuRecipeSourceBuild(), configureArgs: plan.configureArgs, buildArgs: plan.buildArgs,
			nativeRecipeFiles: recipe.nativeRecipeFiles,
			sources: recipe.sources.map(({ id, url, sha256, byteLength }) => ({ id, url, sha256, byteLength })),
			onnxRuntime: { files: ort.files, sourcePins: ort.sourcePins },
		};
		await writeFile(join(packageRoot, 'build-provenance.json'), `${JSON.stringify(provenance, null, '\t')}\n`);
		const files = await fingerprintPackage(packageRoot), manifest = structuredClone(nativeManifest);
		manifest.targets[targetId] = { status: 'built', executionProviders: plan.executionProviders, package: {
			name: packageName(targetId), version: recipe.version, sourceUrl: recipe.sources[0].url,
			integrity: recipe.sources[0].integrity, sourceBuild: desktopSherpaGpuRecipeSourceBuild(), files,
		} };
		const summary = validateDesktopAssistanceSherpaGpuBuildReceipt({ schemaVersion: 1, targetId, manifest, provenance });
		const published = join(cache, `package-${hash(Buffer.from(JSON.stringify(files)))}`);
		await mkdir(join(published, 'node_modules'), { recursive: true });
		await cp(packageRoot, join(published, 'node_modules', packageName(targetId)), { recursive: true });
		await cp(join(nodeModulesRoot, nativeManifest.commonPackage.name),
			join(published, 'node_modules', nativeManifest.commonPackage.name), { recursive: true });
		return { manifest, nodeModulesRoot: join(published, 'node_modules'), summary };
	} finally { await rm(work, { recursive: true, force: true }); }
}

function generatedNames(targetId) {
	const extension = targetId.startsWith('win-') ? 'dll' : targetId.startsWith('mac-') ? 'dylib' : 'so';
	const prefix = targetId.startsWith('win-') ? '' : 'lib';
	return [`${prefix}sherpa-onnx-c-api.${extension}`, `${prefix}sherpa-onnx-cxx-api.${extension}`,
		'sherpa-onnx.node', 'SHERPA_NOTICES.txt', 'build-provenance.json',
		`onnx-webgpu-device-probe${targetId.startsWith('win-') ? '.exe' : ''}`];
}
function packageName(targetId) { return `sherpa-onnx-${targetId === 'mac-arm64' ? 'darwin-arm64' : targetId}`; }
function providers(targetId) { return targetId === 'mac-arm64' ? ['coreml', 'webgpu', 'cpu'] : ['webgpu', 'cpu']; }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function fingerprint(bytes) { return { byteLength: bytes.byteLength, sha256: hash(bytes) }; }
async function command(file, args, cwd, env) {
	try { return await runFile(file, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }); }
	catch (cause) { throw new Error(`Sherpa GPU ${file} failed: ${cause.stderr || cause.stdout || cause.message}`, { cause }); }
}
async function locateBuildFile(root, name) {
	const matches = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) await visit(join(directory, entry.name));
			else if (entry.isFile() && entry.name === name) matches.push(join(directory, entry.name));
		}
	}
	await visit(root);
	if (matches.length !== 1) throw new Error(`The compiled Sherpa file ${name} is missing or ambiguous.`);
	return matches[0];
}
async function fingerprintPackage(root) {
	const files = {};
	for (const name of (await readdir(root)).sort()) {
		const path = join(root, name), stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The Sherpa GPU package contains a non-file.');
		files[name] = fingerprint(await readFile(path));
	}
	return files;
}
async function compilerIdentity(build) {
	const version = (await readdir(join(build, 'CMakeFiles'))).find((name) => /^\d+\.\d+/u.test(name));
	const source = await readFile(join(build, 'CMakeFiles', version, 'CMakeCXXCompiler.cmake'), 'utf8');
	return {
		id: /^set\(CMAKE_CXX_COMPILER_ID "([^"]+)"\)/mu.exec(source)?.[1],
		version: /^set\(CMAKE_CXX_COMPILER_VERSION "([^"]+)"\)/mu.exec(source)?.[1],
	};
}

/** Fail the package build if a target compiler silently emitted a host binary. */
export function assertSherpaGpuBinaryArchitecture(bytes, targetId) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64 || !TARGETS.includes(targetId)) {
		throw new Error('The Sherpa GPU binary architecture is invalid.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let valid;
	if (targetId.startsWith('linux-')) {
		valid = view.getUint32(0, false) === 0x7f454c46 && bytes[4] === 2 && bytes[5] === 1
		&& view.getUint16(18, true) === (targetId === 'linux-arm64' ? 183 : 62);
	} else if (targetId.startsWith('win-')) {
		const offset = view.getUint32(0x3c, true);
		valid = view.getUint16(0, true) === 0x5a4d && offset <= bytes.byteLength - 24
		&& view.getUint32(offset, true) === 0x00004550
		&& view.getUint16(offset + 4, true) === (targetId === 'win-arm64' ? 0xaa64 : 0x8664);
	} else {
		valid = view.getUint32(0, true) === 0xfeedfacf && view.getUint32(4, true) === 0x100000c;
	}
	if (!valid) throw new Error('The Sherpa GPU binary architecture does not match its target.');
}

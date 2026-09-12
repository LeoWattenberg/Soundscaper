/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build the missing Windows ARM64 Node-API wrapper over pinned upstream libraries. */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, win32 } from 'node:path';
import { promisify } from 'node:util';
import { extract } from 'tar';

import nativeManifest from '../../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import recipe from '../../config/assistance-sherpa-win-arm64-build.json' with { type: 'json' };

const runFile = promisify(execFile);
const TARGET = 'win-arm64';
const PACKAGE_NAME = 'sherpa-onnx-win-arm64';
const CPP_PREFIX = 'harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp/';
const DLLS = ['onnxruntime.dll', 'onnxruntime_providers_shared.dll',
	'sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll'];
const PACKAGE_FILES = [...DLLS, 'sherpa-onnx.node', 'SHERPA-LICENSE', 'NODE-ADDON-API-LICENSE',
	'NODE-GYP-LICENSE', 'NODE-LICENSE', 'build-provenance.json'].sort();

export function desktopSherpaArm64BuildPlan({ targetId, platform = process.platform }) {
	if (targetId !== TARGET || platform !== 'win32') {
		throw new Error('The Sherpa ARM64 addon requires a Windows package runner and win-arm64 target.');
	}
	return {
		targetId, configureArgs: ['-A', 'ARM64', '-DCMAKE_BUILD_TYPE=Release'],
		buildArgs: ['--config', 'Release', '--target', 'sherpa-onnx', '--parallel', '4'],
	};
}

export function desktopSherpaArm64NativeArchiveInvocation(archive, destination) {
	const localArchive = win32.relative(destination, archive).replaceAll('\\', '/');
	if (win32.isAbsolute(localArchive)) throw new Error('The Sherpa native archive must share its extraction drive.');
	return {
		cwd: destination,
		args: ['-xf', localArchive, '--strip-components=1'],
	};
}

export function validateDesktopAssistanceSherpaArm64BuildReceipt(value) {
	if (!value || value.schemaVersion !== 1 || value.targetId !== TARGET || !value.manifest || !value.provenance) {
		throw new TypeError('The Sherpa ARM64 build receipt identity is invalid.');
	}
	const base = structuredClone(value.manifest);
	if (!base.targets || !base.targets[TARGET]) throw new TypeError('The built Sherpa target is missing.');
	const target = base.targets[TARGET];
	base.targets[TARGET] = nativeManifest.targets[TARGET];
	if (JSON.stringify(base) !== JSON.stringify(nativeManifest)) {
		throw new TypeError('The Sherpa build receipt changed the reviewed common package or another target.');
	}
	const source = recipe.sources.find(({ id }) => id === 'sherpa-source');
	const nativeSource = recipe.sources.find(({ id }) => id === 'sherpa-native');
	const built = target.package;
	if (target.status !== 'built' || built?.name !== PACKAGE_NAME || built.version !== recipe.version
		|| built.sourceUrl !== source.url || built.integrity !== source.integrity
		|| JSON.stringify(built.sourceBuild) !== JSON.stringify({
			recipeId: recipe.recipeId, sourceRevision: recipe.sourceRevision,
			sourceSha256: source.sha256, nativeAssetSha256: nativeSource.sha256,
		}) || !built.files || JSON.stringify(Object.keys(built.files).sort()) !== JSON.stringify(PACKAGE_FILES)) {
		throw new TypeError('The Sherpa build receipt package or source pins are invalid.');
	}
	const provenance = value.provenance;
	if (provenance.schemaVersion !== 1 || provenance.recipeId !== recipe.recipeId || provenance.targetId !== TARGET
		|| provenance.sourceRevision !== recipe.sourceRevision || provenance.nodeHeadersVersion !== recipe.nodeHeadersVersion
		|| provenance.nodeAddonApiVersion !== recipe.nodeAddonApiVersion
		|| !/^cmake version \d+\.\d+/u.test(provenance.cmakeVersion)
		|| typeof provenance.compiler?.id !== 'string' || typeof provenance.compiler.version !== 'string'
		|| provenance.cmakeSha256 !== recipe.cmakeSha256
		|| JSON.stringify(provenance.configureArgs) !== JSON.stringify(desktopSherpaArm64BuildPlan({ targetId: TARGET, platform: 'win32' }).configureArgs)
		|| JSON.stringify(provenance.sources) !== JSON.stringify(recipe.sources.map(({ id, url, sha256, byteLength }) => ({ id, url, sha256, byteLength })))) {
		throw new TypeError('The Sherpa build receipt provenance does not bind its source recipe.');
	}
	const bytes = Buffer.from(`${JSON.stringify(provenance, null, '\t')}\n`);
	if (built.files['build-provenance.json'].byteLength !== bytes.byteLength
		|| built.files['build-provenance.json'].sha256 !== hash(bytes)) {
		throw new TypeError('The Sherpa build receipt provenance file digest is invalid.');
	}
	for (const file of Object.values(built.files)) {
		if (!Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > 512 * 1024 * 1024
			|| !/^[a-f\d]{64}$/u.test(file.sha256)) throw new TypeError('The built Sherpa file digest is invalid.');
	}
	return value;
}

export async function prepareDesktopAssistanceSherpaArm64({
	repositoryRoot, targetId, cacheRoot, platform = process.platform,
}) {
	const plan = desktopSherpaArm64BuildPlan({ targetId, platform });
	if (!isAbsolute(repositoryRoot) || !isAbsolute(cacheRoot)) {
		throw new TypeError('The Sherpa build requires absolute repository and cache roots.');
	}
	const cache = resolve(cacheRoot, 'sherpa-node-api', recipe.sourceRevision);
	await mkdir(cache, { recursive: true });
	const downloads = new Map();
	for (const source of recipe.sources) downloads.set(source.id, await authenticatedSource(cache, source));
	const work = await mkdtemp(join(cache, 'build-'));
	try {
		const source = join(work, 'source'), native = join(work, 'native');
		const headers = join(work, 'headers'), nodeApi = join(work, 'node-addon-api');
		await extractFiles(downloads.get('sherpa-source'), source,
			(path) => path.startsWith(CPP_PREFIX) || path.startsWith('sherpa-onnx/c-api/') || path === 'LICENSE');
		await extractFiles(downloads.get('node-headers'), headers,
			(path) => path.startsWith('include/node/') && path.endsWith('.h'));
		await extractFiles(downloads.get('node-addon-api'), nodeApi, () => true);
		await mkdir(native);
		const nativeArchive = desktopSherpaArm64NativeArchiveInvocation(downloads.get('sherpa-native'), native);
		await command('tar', nativeArchive.args, nativeArchive.cwd);
		for (const name of DLLS) assertArm64PortableExecutable(await readFile(join(native, 'lib', name)));
		const build = join(work, 'compiled');
		const cmakeRoot = join(repositoryRoot, 'native', 'assistance-sherpa-node-api');
		if (hash(await readFile(join(cmakeRoot, 'CMakeLists.txt'))) !== recipe.cmakeSha256) {
			throw new Error('The Sherpa CMake recipe differs from its reviewed digest.');
		}
		// Preserve extensions required by the MSVC linker and CMake language detection.
		const delayHook = join(work, 'win_delay_load_hook.cc'), nodeLibrary = join(work, 'node.lib');
		await copyFile(downloads.get('node-delay-hook'), delayHook);
		await copyFile(downloads.get('node-arm64-lib'), nodeLibrary);
		const configureArgs = ['-S', cmakeRoot, '-B', build, ...plan.configureArgs,
			`-DSHERPA_SOURCE=${source}`, `-DSHERPA_NATIVE=${native}`, `-DNODE_HEADERS=${headers}`,
			`-DNODE_ADDON_API=${nodeApi}`, `-DNODE_LIBRARY=${nodeLibrary}`, `-DSCAPE_WORK_ROOT=${work}`,
			`-DNODE_DELAY_HOOK=${delayHook}`];
		const cmakeVersion = (await command('cmake', ['--version'], work)).stdout.split('\n')[0].trim();
		await command('cmake', configureArgs, work);
		await command('cmake', ['--build', build, ...plan.buildArgs], work);
		const binary = join(build, 'Release', 'sherpa-onnx.node');
		assertArm64PortableExecutable(await readFile(binary));
		const provenance = {
			schemaVersion: 1, recipeId: recipe.recipeId, targetId,
			sourceRevision: recipe.sourceRevision, nodeHeadersVersion: recipe.nodeHeadersVersion,
			nodeAddonApiVersion: recipe.nodeAddonApiVersion, cmakeVersion,
			compiler: await compilerIdentity(build), configureArgs: plan.configureArgs,
			cmakeSha256: hash(await readFile(join(cmakeRoot, 'CMakeLists.txt'))),
			sources: recipe.sources.map(({ id, url, sha256, byteLength }) => ({ id, url, sha256, byteLength })),
		};
		const packageRoot = join(work, 'node_modules', PACKAGE_NAME);
		await mkdir(packageRoot, { recursive: true });
		await copyFile(binary, join(packageRoot, 'sherpa-onnx.node'));
		for (const name of DLLS) await copyFile(join(native, 'lib', name), join(packageRoot, name));
		await copyFile(join(source, 'LICENSE'), join(packageRoot, 'SHERPA-LICENSE'));
		await copyFile(join(nodeApi, 'LICENSE.md'), join(packageRoot, 'NODE-ADDON-API-LICENSE'));
		await copyFile(downloads.get('node-gyp-license'), join(packageRoot, 'NODE-GYP-LICENSE'));
		await copyFile(downloads.get('node-license'), join(packageRoot, 'NODE-LICENSE'));
		await writeFile(join(packageRoot, 'build-provenance.json'), `${JSON.stringify(provenance, null, '\t')}\n`);
		const files = await fingerprintPackage(packageRoot);
		const sourceDescriptor = recipe.sources.find(({ id }) => id === 'sherpa-source');
		const manifest = structuredClone(nativeManifest);
		manifest.targets[TARGET] = { status: 'built', package: {
			name: PACKAGE_NAME, version: recipe.version, sourceUrl: sourceDescriptor.url,
			integrity: sourceDescriptor.integrity,
			sourceBuild: {
				recipeId: recipe.recipeId, sourceRevision: recipe.sourceRevision,
				sourceSha256: sourceDescriptor.sha256,
				nativeAssetSha256: recipe.sources.find(({ id }) => id === 'sherpa-native').sha256,
			},
			files,
		} };
		const published = join(cache, `package-${hash(Buffer.from(JSON.stringify(files)))}`);
		await mkdir(join(published, 'node_modules'), { recursive: true });
		await cp(packageRoot, join(published, 'node_modules', PACKAGE_NAME), { recursive: true });
		await cp(join(repositoryRoot, 'node_modules', nativeManifest.commonPackage.name),
			join(published, 'node_modules', nativeManifest.commonPackage.name), { recursive: true });
		const summary = validateDesktopAssistanceSherpaArm64BuildReceipt({ schemaVersion: 1, targetId, manifest, provenance });
		return {
			manifest, nodeModulesRoot: join(published, 'node_modules'),
			summary,
		};
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

export function assertArm64PortableExecutable(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64) throw new Error('The ARM64 executable is truncated.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const offset = view.getUint32(0x3c, true);
	if (view.getUint16(0, true) !== 0x5a4d || offset > bytes.byteLength - 24
		|| view.getUint32(offset, true) !== 0x00004550 || view.getUint16(offset + 4, true) !== 0xaa64) {
		throw new Error('The Sherpa native payload is not a Windows ARM64 executable.');
	}
}

async function authenticatedSource(cache, source) {
	const path = join(cache, source.sha256);
	let bytes;
	try { bytes = await readFile(path); }
	catch (error) { if (error.code !== 'ENOENT') throw error; }
	if (bytes === undefined) {
		const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
		if (!response.ok || !response.body) throw new Error(`Sherpa source download failed: ${source.id} (${response.status}).`);
		const chunks = []; let length = 0;
		for await (const chunk of response.body) {
			length += chunk.byteLength;
			if (length > source.byteLength) throw new Error(`The Sherpa source ${source.id} exceeds its pinned length.`);
			chunks.push(chunk);
		}
		bytes = Buffer.concat(chunks);
		verifySource(bytes, source);
		await writeFile(path, bytes, { flag: 'wx' });
	} else verifySource(bytes, source);
	return path;
}

function verifySource(bytes, source) {
	if (bytes.byteLength !== source.byteLength || hash(bytes) !== source.sha256
		|| source.integrity && `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== source.integrity) {
		throw new Error(`The Sherpa source ${source.id} failed its pinned integrity check.`);
	}
}

async function extractFiles(archive, destination, include) {
	await mkdir(destination, { recursive: true });
	await extract({
		file: archive, cwd: destination, strip: 1, strict: true, preservePaths: false,
		filter(path, entry) {
			const relative = path.split('/').slice(1).join('/');
			return entry.type === 'File' && !relative.includes('..') && !relative.includes('\\') && include(relative);
		},
	});
}

async function fingerprintPackage(root) {
	const files = {};
	for (const name of (await readdir(root)).sort()) {
		const path = join(root, name), metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('The built Sherpa package must contain regular files.');
		const bytes = await readFile(path);
		files[name] = { byteLength: bytes.byteLength, sha256: hash(bytes) };
	}
	return files;
}

async function compilerIdentity(build) {
	for (const name of await readdir(join(build, 'CMakeFiles'))) {
		if (!/^\d+\.\d+/u.test(name)) continue;
		const source = await readFile(join(build, 'CMakeFiles', name, 'CMakeCXXCompiler.cmake'), 'utf8');
		const id = /set\(CMAKE_CXX_COMPILER_ID "([^"]+)"\)/u.exec(source)?.[1];
		const version = /set\(CMAKE_CXX_COMPILER_VERSION "([^"]+)"\)/u.exec(source)?.[1];
		if (id && version) return { id, version };
	}
	throw new Error('The Sherpa compiler identity could not be read.');
}

async function command(executable, args, cwd) {
	try {
		return await runFile(executable, args, {
			cwd, env: { ...process.env, SOURCE_DATE_EPOCH: '1787225940' }, windowsHide: true,
			maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60_000,
		});
	} catch (error) {
		throw new Error(`Sherpa ARM64 build failed: ${executable}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
	}
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

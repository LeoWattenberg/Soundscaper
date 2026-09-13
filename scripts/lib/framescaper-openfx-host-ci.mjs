/* SPDX-License-Identifier: AGPL-3.0-only */

/** Execute one target-native OpenFX host build and publish its verified CI result. */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, resolve } from 'node:path';

import {
	FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS,
	createFramescaperOpenFxHostBuildRecipe,
	executeFramescaperOpenFxHostBuildRecipe,
	fingerprintFramescaperOpenFxHostToolchainReceipt,
} from '../../native/framescaper-openfx-host/build/recipe-driver.mjs';
import {
	createFramescaperOpenFxHostBuildResult,
} from './framescaper-openfx-host-build-result.mjs';
import { verifyFramescaperOpenFxCiSource } from './framescaper-openfx-source-ci.mjs';
import {
	soundscaperProfessionalNativeIsolationConfigureArguments,
} from './soundscaper-professional-native-target-build.mjs';

const SOURCE_RECEIPT = '.framescaper-source-identity.json';
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const ENVIRONMENT_KEYS = Object.freeze([
	'INCLUDE', 'LIB', 'LIBPATH', 'MACOSX_DEPLOYMENT_TARGET', 'PATH', 'SDKROOT', 'SYSTEMROOT',
	'TEMP', 'TMP',
]);

export async function runFramescaperOpenFxHostCiBuild(options, dependencies = {}) {
	const repositoryRoot = canonicalDirectory(options?.repositoryRoot, 'repository root');
	const target = exactTarget(options?.target);
	if (`${process.platform}-${process.arch}` !== target.hostRuntime) {
		throw new Error(`The ${target.id} OpenFX result requires target-native ${target.hostRuntime} Node.js.`);
	}
	const openfxSourceRoot = canonicalDirectory(options?.openfxSourceRoot, 'OpenFX source root');
	await verifyFramescaperOpenFxCiSource({ repositoryRoot, sourceRoot: openfxSourceRoot });
	const boostSourceRoot = canonicalDirectory(options?.boostSourceRoot, 'Boost source root');
	const boostReceipt = sourceReceipt(boostSourceRoot, 'Boost source receipt');
	const workRoot = exclusiveDirectory(options?.workRoot, 'OpenFX work root');
	const buildResultRoot = absentPath(options?.buildResultRoot, 'OpenFX build-result root');
	canonicalDirectory(dirname(buildResultRoot), 'OpenFX build-result parent');
	const toolchain = createFramescaperOpenFxHostCiToolchainReceipt({
		target: target.id,
		outputPath: resolve(workRoot, 'openfx-toolchain.json'),
	});
	const recipeOutputRoot = exclusiveDirectory(resolve(workRoot, 'recipe'), 'OpenFX recipe output');
	const recipe = createFramescaperOpenFxHostBuildRecipe({
		repositoryRoot,
		targetId: target.id,
		hostRuntime: target.hostRuntime,
		toolchainReceipt: toolchain.path,
		toolchainIdentity: toolchain.receipt.identitySha256,
		openfxSourceRoot,
		boostSourceRoot,
		outputRoot: recipeOutputRoot,
	});
	const runRecipe = dependencies.executeRecipe ?? executeFramescaperOpenFxHostBuildRecipe;
	runRecipe(recipe);
	const isolationBuildRoot = resolve(workRoot, 'isolation-build');
	const isolationInstallRoot = resolve(workRoot, 'isolation-install');
	const configure = [...soundscaperProfessionalNativeIsolationConfigureArguments({
		target: target.id,
		sourceRoot: resolve(repositoryRoot, 'native/milestone-5-native-isolation-launcher'),
		buildRoot: isolationBuildRoot,
		ninja: toolchain.receipt.executables.ninja.path,
		cCompiler: toolchain.receipt.executables.c.path,
		cxxCompiler: toolchain.receipt.executables.cxx.path,
	})];
	const run = dependencies.run ?? spawnSync;
	for (const [label, args] of [
		['isolation configure', configure],
		['isolation build', ['--build', isolationBuildRoot, '--config', 'Release', '--parallel', '1']],
		['isolation install', ['--install', isolationBuildRoot, '--config', 'Release',
			'--prefix', isolationInstallRoot]],
	]) runChecked(run, toolchain.receipt.executables.cmake.path, args, label, 'inherit');
	const suffix = target.id.startsWith('win-') ? '.exe' : '';
	const hostInstallRoot = resolve(recipeOutputRoot, 'host-install');
	const selfTests = [
		selfTest(run, 'openfx-scanner-self-test',
			resolve(hostInstallRoot, 'bin', `framescaper-ofx-scanner${suffix}`), ['--self-test'], 0),
		selfTest(run, 'openfx-runtime-host-self-test',
			resolve(hostInstallRoot, 'bin', `framescaper-ofx-runtime-host${suffix}`), ['--self-test'], 0),
		selfTest(run, 'isolation-launcher-refusal',
			resolve(isolationInstallRoot, 'bin', `milestone5-native-isolation-launcher${suffix}`), [], 125),
	].sort(({ id: left }, { id: right }) => left < right ? -1 : left > right ? 1 : 0);
	const sourceRevision = resolveSourceRevision(repositoryRoot, dependencies.resolveRevision);
	const sourceAuthentication = {
		openfx: sourceReceipt(openfxSourceRoot, 'OpenFX source receipt'),
		boost: boostReceipt,
	};
	const runtimeLibraryPaths = linuxLoaderPaths(target.id);
	return createFramescaperOpenFxHostBuildResult({
		target: target.id,
		repositoryRoot,
		hostInstallRoot,
		isolationInstallRoot,
		runtimeLibraryPaths,
		buildResultRoot,
		sourceRevision,
		buildRecipeSha256: sha256(Buffer.from(canonicalJson(recipe))),
		toolchainReceipt: toolchain.receipt,
		sourceAuthentication,
		selfTests,
	});
}

export function createFramescaperOpenFxHostCiToolchainReceipt(options) {
	const target = exactTarget(options?.target);
	const outputPath = absentPath(options?.outputPath, 'OpenFX toolchain receipt');
	canonicalDirectory(dirname(outputPath), 'OpenFX toolchain receipt parent');
	const candidates = process.platform === 'win32'
		? { c: ['cl.exe'], cxx: ['cl.exe'], cmake: ['cmake.exe'], ninja: ['ninja.exe'] }
		: process.platform === 'darwin'
			? { c: ['clang'], cxx: ['clang++'], cmake: ['cmake'], ninja: ['ninja'] }
			: { c: ['cc', 'gcc', 'clang'], cxx: ['c++', 'g++', 'clang++'], cmake: ['cmake'], ninja: ['ninja'] };
	const overrides = { c: process.env.CC, cxx: process.env.CXX };
	const executables = {};
	for (const role of ['c', 'cmake', 'cxx', 'ninja']) {
		const path = resolveExecutable(overrides[role], candidates[role]);
		const bytes = readFileSync(path);
		executables[role] = { path, sha256: sha256(bytes) };
	}
	const environment = {};
	for (const key of ENVIRONMENT_KEYS) {
		if (typeof process.env[key] === 'string' && process.env[key].length > 0) {
			environment[key] = process.env[key];
		}
	}
	if (!environment.PATH) throw new Error('The OpenFX CI toolchain has no PATH.');
	const body = {
		schemaVersion: 1,
		targetId: target.id,
		hostRuntime: target.hostRuntime,
		executables,
		environment,
	};
	const receipt = { ...body, identitySha256: fingerprintFramescaperOpenFxHostToolchainReceipt(body) };
	writeFileSync(outputPath, `${JSON.stringify(receipt, null, '\t')}\n`, { flag: 'wx', mode: 0o400 });
	return Object.freeze({ path: outputPath, receipt: deepFreeze(receipt) });
}

function selfTest(run, id, command, args, expectedStatus) {
	const result = runChecked(run, command, args, `self-test ${id}`, 'pipe', expectedStatus);
	const output = Buffer.from(`${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`);
	return Object.freeze({
		id,
		status: 'passed',
		commandSha256: sha256(Buffer.from(canonicalJson({ command: basename(command), args, expectedStatus }))),
		outputSha256: sha256(output),
	});
}

function runChecked(run, command, args, label, stdio, expectedStatus = 0) {
	const result = run(command, args, {
		encoding: 'utf8', shell: false, windowsHide: true, stdio,
		maxBuffer: MAXIMUM_OUTPUT_BYTES,
		env: { ...process.env, SOURCE_DATE_EPOCH: '1786492800', TZ: 'UTC', LC_ALL: 'C' },
	});
	if (!result || result.error !== undefined || result.signal !== null
		|| result.status !== expectedStatus) {
		throw new Error(`OpenFX ${label} failed with status ${String(result?.status)}: `
			+ String(result?.stderr ?? result?.stdout ?? result?.error?.message ?? '').slice(0, 4096));
	}
	return result;
}

function linuxLoaderPaths(target) {
	if (!target.startsWith('linux-')) return [];
	const name = target === 'linux-x64' ? 'ld-linux-x86-64.so.2' : 'ld-linux-aarch64.so.1';
	const candidates = target === 'linux-x64'
		? [`/lib64/${name}`, `/lib/x86_64-linux-gnu/${name}`]
		: [`/lib/${name}`, `/lib/aarch64-linux-gnu/${name}`, `/lib64/${name}`];
	for (const candidate of candidates) {
		try {
			const path = realpathSync(candidate);
			if (statSync(path).isFile()) return [path];
		} catch { /* inspect the next fixed target loader location */ }
	}
	throw new Error(`The target-native Linux loader ${name} is unavailable.`);
}

function resolveExecutable(override, candidates) {
	if (typeof override === 'string' && override.trim() !== '') {
		return canonicalFile(isAbsolute(override) ? override : searchPath(override));
	}
	for (const candidate of candidates) {
		try { return canonicalFile(searchPath(candidate)); }
		catch { /* inspect the next closed tool name */ }
	}
	throw new Error(`No target-native executable was found for ${candidates.join(', ')}.`);
}

function searchPath(name) {
	if (typeof name !== 'string' || name.includes('\0') || name.includes('/') || name.includes('\\')) {
		throw new TypeError('A toolchain executable override must be one basename or absolute path.');
	}
	for (const directory of String(process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
		const candidate = resolve(directory, name);
		try { if (statSync(candidate).isFile()) return candidate; }
		catch { /* inspect the next PATH entry */ }
	}
	throw new Error(`Toolchain executable ${name} is not on PATH.`);
}

function sourceReceipt(root, label) {
	let value;
	try { value = JSON.parse(readFileSync(resolve(root, SOURCE_RECEIPT), 'utf8')); }
	catch (error) { throw new Error(`The ${label} is unavailable.`, { cause: error }); }
	if (value.root !== root) throw new Error(`The ${label} is path-misbound.`);
	return deepFreeze(value);
}

function resolveSourceRevision(root, port) {
	const result = port ? port(root) : spawnSync('git', ['rev-parse', 'HEAD'], {
		cwd: root, encoding: 'utf8', shell: false,
	});
	const value = typeof result === 'string' ? result : result?.status === 0 ? result.stdout : '';
	if (!/^(?:[a-f\d]{40}|[a-f\d]{64})\s*$/u.test(String(value))) {
		throw new Error('The OpenFX CI source revision could not be resolved.');
	}
	return String(value).trim();
}

function exactTarget(value) {
	const target = FRAMESCAPER_OPENFX_HOST_BUILD_TARGETS.find(({ id }) => id === value);
	if (!target) throw new TypeError('The OpenFX CI target is unsupported.');
	return target;
}

function exclusiveDirectory(value, label) {
	const path = absentPath(value, label);
	canonicalDirectory(dirname(path), `${label} parent`);
	mkdirSync(path, { mode: 0o700 });
	return canonicalDirectory(path, label);
}

function absentPath(value, label) {
	const path = absolutePath(value, label);
	try { lstatSync(path); }
	catch (error) {
		if (error?.code === 'ENOENT') return path;
		throw error;
	}
	throw new Error(`The ${label} already exists.`);
}

function canonicalDirectory(value, label) {
	const path = absolutePath(value, label);
	const metadata = lstatSync(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(path) !== path) {
		throw new Error(`The ${label} is not one canonical directory.`);
	}
	return path;
}

function canonicalFile(value) {
	const path = realpathSync(absolutePath(value, 'toolchain executable'));
	const metadata = lstatSync(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error('A toolchain executable is not one canonical file.');
	}
	return path;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be absolute and normalized.`);
	return value;
}

function canonicalJson(value) { return JSON.stringify(value, null, '\t'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Immutable target-native helper build results and ephemeral checkout staging. */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import {
	lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import {
	NATIVE_HELPER_ADDON_ROOT,
	NATIVE_HELPER_ADDON_TARGETS,
	readNativeHelperAddonSourceManifest,
} from './native-helper-addon-build.mjs';
import { authenticateNativeHelperBuildInputs } from './native-helper-addon-build-inputs.mjs';
import { listNativeSourceTree } from './native-source-tree.mjs';

export { stageNativeHelperAddonBuildResult } from './native-helper-addon-build-result-staging.mjs';

export const NATIVE_HELPER_ADDON_BUILD_RESULT_RECEIPT = 'build-result.json';
export const NATIVE_HELPER_ADDON_STAGED_BUILD_RESULT = 'native-helper-addon-build-result.json';

const SOURCE_REGISTER = 'config/milestone-5-native-source-acquisitions.json';
const CMAKE_RECIPE = `${NATIVE_HELPER_ADDON_ROOT}/CMakeLists.txt`;
const HEADER_SOURCE_ID = 'electron-node-api-headers';
const MAXIMUM_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAXIMUM_FIXTURE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_RECEIPT_BYTES = 256 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

export function deriveNativeHelperAddonBuildPolicy({ repositoryRoot, target }) {
	const root = absolutePath(repositoryRoot, 'repository root');
	const claimed = targetRecord(target);
	const manifest = readNativeHelperAddonSourceManifest(root);
	const authenticated = authenticateNativeHelperBuildInputs({ repositoryRoot: root, manifest });
	const sourceFiles = manifest.sourceFiles.map((descriptor) => ({ ...descriptor }));
	const sourceRoot = resolve(root, NATIVE_HELPER_ADDON_ROOT, 'src');
	const sourceTree = listNativeSourceTree(sourceRoot);
	assert(sourceTree.irregular.length === 0,
		'The native helper source inventory must contain regular files only.');
	const presentSources = sourceTree.files
		.map((path) => relative(sourceRoot, path).split('\\').join('/')).sort();
	const pinnedSources = sourceFiles.map(({ path }) => path).sort();
	assert(sameJson(presentSources, pinnedSources),
		'The native helper source inventory does not exactly match its pins.');
	for (const descriptor of sourceFiles) {
		const bytes = readRegularFileSync(root, `${NATIVE_HELPER_ADDON_ROOT}/src/${descriptor.path}`,
			`native helper source ${descriptor.path}`);
		verifyDescriptor(bytes, descriptor, `native helper source ${descriptor.path}`);
	}
	const recipeBytes = readRegularFileSync(root, CMAKE_RECIPE, 'native helper CMake recipe');
	const registerBytes = readRegularFileSync(root, SOURCE_REGISTER, 'native source register');
	const register = parseJson(registerBytes, 'native source register');
	const headers = register.sources?.find(({ id }) => id === HEADER_SOURCE_ID);
	assert(headers && headers.version === '43.1.1' && headers.archive && headers.extractedTree,
		'The native source register has no exact Electron 43.1.1 header source.');
	const electronHeaders = {
		id: HEADER_SOURCE_ID,
		version: headers.version,
		archive: descriptorIdentity(headers.archive),
		extractedTree: {
			algorithm: headers.extractedTree.algorithm,
			fileCount: headers.extractedTree.fileCount,
			sha256: headers.extractedTree.sha256,
		},
	};
	const policy = {
		algorithm: 'soundscaper-native-helper-addon-build-policy-sha256-v1',
		target: claimed.id,
		runtime: claimed.runtime,
		addonVersion: manifest.addonVersion,
		napiVersion: manifest.napiVersion,
		payloadName: manifest.payloadName,
		source: {
			manifest: {
				addonVersion: manifest.addonVersion,
				napiVersion: manifest.napiVersion,
				payloadName: manifest.payloadName,
				license: manifest.license,
				toolchain: manifest.toolchain,
				sourceFiles,
			},
			cmakeRecipe: fileDescriptor(CMAKE_RECIPE, recipeBytes),
			vendoredHeaders: authenticated.vendoredHeaders,
			fixturePlugins: authenticated.fixturePlugins,
		},
		electronHeaders,
		commands: portableBuildCommands(claimed.id),
	};
	return deepFreeze({ ...policy, sha256: sha256(canonicalJson(policy)) });
}

export async function createNativeHelperAddonBuildResult(options) {
	const root = absolutePath(options?.repositoryRoot, 'repository root');
	const target = targetRecord(options?.target).id;
	const buildResultRoot = absentAbsolutePath(options?.buildResultRoot, 'build-result root');
	const payloadPath = absolutePath(options?.payloadPath, 'native helper payload');
	const fixtureRoot = absolutePath(options?.fixtureRoot, 'native helper fixture root');
	const sourceRevision = String(options?.sourceRevision ?? '');
	assert(REVISION.test(sourceRevision), 'The native helper build-result source revision is invalid.');
	const policy = deriveNativeHelperAddonBuildPolicy({ repositoryRoot: root, target });
	const toolchain = normalizeToolchainReceipt(options?.toolchainReceipt, target);
	const payloadBytes = await regularFile(payloadPath, 'native helper build output', MAXIMUM_PAYLOAD_BYTES);
	const fixtures = await readFixturePluginSet(fixtureRoot, policy);
	const selfTest = normalizeSelfTest(options?.selfTest, policy, fixtures.files.length);
	const parent = await canonicalDirectory(dirname(buildResultRoot), 'build-result parent');
	const temporary = await mkdtemp(resolve(parent, '.native-helper-build-result-'));
	let published = false;
	try {
		const payloadRoot = resolve(temporary, 'payload');
		await mkdir(payloadRoot, { mode: 0o700 });
		const payloadOutput = resolve(payloadRoot, policy.payloadName);
		await writeFile(payloadOutput, payloadBytes, { flag: 'wx', mode: 0o555 });
		const fixtureOutputRoot = resolve(temporary, 'fixtures');
		await mkdir(fixtureOutputRoot, { mode: 0o700 });
		for (const descriptor of fixtures.files) {
			await writeFile(resolve(fixtureOutputRoot, descriptor.name), fixtures.bytes.get(descriptor.name),
				{ flag: 'wx', mode: 0o555 });
		}
		const receipt = deepFreeze({
			schemaVersion: 1,
			kind: 'soundscaper-native-helper-addon-build-result',
			target,
			runtime: policy.runtime,
			sourceRevision,
			buildPolicy: policy,
			toolchain,
			selfTest,
			payload: fileDescriptor(`payload/${policy.payloadName}`, payloadBytes),
			fixturePlugins: { root: 'fixtures', files: fixtures.files },
		});
		await writeFile(resolve(temporary, NATIVE_HELPER_ADDON_BUILD_RESULT_RECEIPT),
			canonicalJson(receipt), { flag: 'wx', mode: 0o444 });
		await verifyNativeHelperAddonBuildResult({ buildResultRoot: temporary });
		await rename(temporary, buildResultRoot);
		published = true;
		return deepFreeze({ buildResultRoot, receipt });
	} finally {
		if (!published) await rm(temporary, { recursive: true, force: true });
	}
}

export async function verifyNativeHelperAddonBuildResult({ buildResultRoot }) {
	const root = await canonicalDirectory(buildResultRoot, 'native helper build-result root');
	const entries = await readdir(root, { withFileTypes: true });
	assert(sameJson(entries.map(({ name }) => name).sort(), ['build-result.json', 'fixtures', 'payload']),
		'The native helper build-result inventory is invalid.');
	const receiptBytes = await regularFile(resolve(root, NATIVE_HELPER_ADDON_BUILD_RESULT_RECEIPT),
		'native helper build-result receipt', MAXIMUM_RECEIPT_BYTES);
	const receipt = parseJson(receiptBytes, 'native helper build-result receipt');
	validateReceipt(receipt);
	const payloadRoot = await canonicalDirectory(resolve(root, 'payload'), 'native helper build-result payload root');
	const payloadEntries = await readdir(payloadRoot, { withFileTypes: true });
	assert(payloadEntries.length === 1 && payloadEntries[0].isFile()
		&& !payloadEntries[0].isSymbolicLink() && payloadEntries[0].name === receipt.payload.name,
	'The native helper build-result payload inventory is invalid.');
	const payloadBytes = await regularFile(resolve(root, receipt.payload.path),
		'native helper build-result payload', MAXIMUM_PAYLOAD_BYTES);
	verifyDescriptor(payloadBytes, receipt.payload, 'native helper build-result payload');
	const fixtureRoot = await canonicalDirectory(resolve(root, receipt.fixturePlugins.root),
		'native helper build-result fixture root');
	const fixtureEntries = await readdir(fixtureRoot, { withFileTypes: true });
	assert(fixtureEntries.every((entry) => entry.isFile() && !entry.isSymbolicLink())
		&& sameJson(fixtureEntries.map(({ name }) => name).sort(),
			receipt.fixturePlugins.files.map(({ name }) => name).sort()),
	'The native helper build-result fixture inventory is invalid.');
	const fixtureBytes = new Map();
	for (const descriptor of receipt.fixturePlugins.files) {
		const bytes = await regularFile(resolve(root, descriptor.path),
			`native helper build-result fixture ${descriptor.name}`, MAXIMUM_FIXTURE_BYTES);
		verifyDescriptor(bytes, descriptor, `native helper build-result fixture ${descriptor.name}`);
		fixtureBytes.set(descriptor.name, bytes);
	}
	deepFreeze(receipt);
	return deepFreeze({
		buildResultRoot: root,
		receipt,
		receiptBytes,
		receiptSha256: sha256(receiptBytes),
		payloadBytes,
		fixtureBytes,
	});
}

function validateReceipt(receipt) {
	assert(receipt && typeof receipt === 'object' && !Array.isArray(receipt),
		'The native helper build-result receipt is invalid.');
	assert(receipt.schemaVersion === 1
		&& receipt.kind === 'soundscaper-native-helper-addon-build-result',
	'The native helper build-result kind is invalid.');
	const target = targetRecord(receipt.target);
	assert(receipt.runtime === target.runtime, 'The native helper build-result target and runtime disagree.');
	assert(REVISION.test(String(receipt.sourceRevision)), 'The native helper build-result revision is invalid.');
	assert(receipt.buildPolicy?.target === target.id && receipt.buildPolicy.runtime === target.runtime
		&& SHA256.test(String(receipt.buildPolicy.sha256)),
	'The native helper build policy is target or runtime misbound.');
	const policyWithoutDigest = { ...receipt.buildPolicy };
	delete policyWithoutDigest.sha256;
	assert(sha256(canonicalJson(policyWithoutDigest)) === receipt.buildPolicy.sha256,
		'The native helper build policy digest is invalid.');
	normalizeToolchainReceipt(receipt.toolchain, target.id);
	assert(receipt.fixturePlugins?.root === 'fixtures' && Array.isArray(receipt.fixturePlugins.files),
		'The native helper build-result fixture record is invalid.');
	const fixtureNames = receipt.buildPolicy.source?.fixturePlugins?.variants
		?.map(({ name }) => `${name}${receipt.buildPolicy.source.fixturePlugins.suffix}`);
	assert(Array.isArray(fixtureNames) && sameJson(
		receipt.fixturePlugins.files.map(({ name }) => name), fixtureNames,
	), 'The native helper build-result fixture set does not match its build policy.');
	for (const descriptor of receipt.fixturePlugins.files) {
		assert(descriptor.path === `fixtures/${descriptor.name}`,
			'The native helper build-result fixture path is invalid.');
		validateDescriptor(descriptor, MAXIMUM_FIXTURE_BYTES,
			`native helper build-result fixture ${descriptor.name}`);
	}
	normalizeSelfTest(receipt.selfTest, receipt.buildPolicy, receipt.fixturePlugins.files.length);
	assert(receipt.payload?.name === receipt.buildPolicy.payloadName
		&& receipt.payload.path === `payload/${receipt.payload.name}`,
	'The native helper build-result payload path is invalid.');
	validateDescriptor(receipt.payload, MAXIMUM_PAYLOAD_BYTES, 'native helper build-result payload');
}

function normalizeToolchainReceipt(value, target) {
	assert(value && typeof value === 'object' && !Array.isArray(value),
		'The native helper toolchain receipt is required.');
	const receipt = {
		target: String(value.target ?? ''),
		cmake: boundedText(value.cmake, 'CMake identity'),
		generator: boundedText(value.generator, 'CMake generator'),
		compilerId: boundedText(value.compilerId, 'compiler ID'),
		compilerVersion: boundedText(value.compilerVersion, 'compiler version'),
		systemName: boundedText(value.systemName, 'toolchain system name'),
		systemProcessor: boundedText(value.systemProcessor, 'toolchain processor'),
	};
	assert(receipt.target === target, 'The native helper toolchain receipt is target misbound.');
	const expectedSystem = target.startsWith('win-') ? 'Windows'
		: target === 'mac-arm64' ? 'Darwin' : 'Linux';
	const processors = target.endsWith('arm64')
		? new Set(['ARM64', 'aarch64', 'arm64']) : new Set(['AMD64', 'x86_64', 'x64']);
	const generatorMatches = target.startsWith('win-')
		? /^Visual Studio (?:17 2022|18 2026)$/u.test(receipt.generator)
		: receipt.generator === 'Unix Makefiles';
	assert(receipt.systemName === expectedSystem && processors.has(receipt.systemProcessor)
		&& generatorMatches,
	'The native helper toolchain receipt does not match its target.');
	return deepFreeze(receipt);
}

function normalizeSelfTest(value, policy, fixtureCount) {
	assert(value && typeof value === 'object' && !Array.isArray(value)
		&& value.status === 'passed' && value.runtime === policy.runtime
		&& value.addonVersion === policy.addonVersion && value.napiVersion === policy.napiVersion
		&& value.buildId === `${policy.addonVersion}+${policy.target}`
		&& value.backendCount === 3 && value.renderedFrames === 64
		&& value.fixtureCount === fixtureCount && value.inspectedFixtureCount === fixtureCount - 2
		&& value.hostedFixtureCount === 3
		&& SHA256.test(String(value.renderSha256))
		&& SHA256.test(String(value.outputSha256)),
	'The native helper target-native self-test receipt is invalid.');
	return deepFreeze({
		status: 'passed', runtime: value.runtime, addonVersion: value.addonVersion,
		napiVersion: value.napiVersion, buildId: value.buildId,
		backendCount: value.backendCount, renderedFrames: value.renderedFrames,
		fixtureCount: value.fixtureCount, inspectedFixtureCount: value.inspectedFixtureCount,
		hostedFixtureCount: value.hostedFixtureCount,
		renderSha256: value.renderSha256, outputSha256: value.outputSha256,
	});
}

async function readFixturePluginSet(root, policy) {
	const directory = await canonicalDirectory(root, 'native helper fixture root');
	const entries = await readdir(directory, { withFileTypes: true });
	const names = policy.source.fixturePlugins.variants
		.map(({ name }) => `${name}${policy.source.fixturePlugins.suffix}`);
	assert(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink())
		&& sameJson(entries.map(({ name }) => name).sort(), [...names].sort()),
	'The native helper fixture build output inventory is invalid.');
	const files = [];
	const bytes = new Map();
	for (const name of names) {
		const value = await regularFile(resolve(directory, name),
			`native helper fixture build output ${name}`, MAXIMUM_FIXTURE_BYTES);
		files.push(fileDescriptor(`fixtures/${name}`, value));
		bytes.set(name, value);
	}
	return { files, bytes };
}

function portableBuildCommands(target) {
	if (target.startsWith('win-')) return {
		configure: ['cmake', '-S', '$SOURCE', '-B', '$BUILD',
			'-A', target === 'win-arm64' ? 'ARM64' : 'x64',
			'-DSOUNDSCAPER_TARGET_ID=$TARGET', '-DSOUNDSCAPER_ADDON_VERSION=$ADDON_VERSION',
			'-DSOUNDSCAPER_NAPI_VERSION=$NAPI_VERSION',
			'-DSOUNDSCAPER_NODE_API_INCLUDE=$HEADERS/include/node'],
		build: ['cmake', '--build', '$BUILD', '--config', 'Release', '--parallel'],
		install: ['cmake', '--install', '$BUILD', '--config', 'Release', '--prefix', '$INSTALL'],
	};
	return {
		configure: ['cmake', '-S', '$SOURCE', '-B', '$BUILD', '-G', 'Unix Makefiles',
			'-DCMAKE_BUILD_TYPE=Release', '-DSOUNDSCAPER_TARGET_ID=$TARGET',
			'-DSOUNDSCAPER_ADDON_VERSION=$ADDON_VERSION',
			'-DSOUNDSCAPER_NAPI_VERSION=$NAPI_VERSION',
			'-DSOUNDSCAPER_NODE_API_INCLUDE=$HEADERS/include/node',
			...(target === 'mac-arm64'
				? ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_SYSROOT=$MACOS_SDK'] : [])],
		build: ['cmake', '--build', '$BUILD', '--parallel'],
		install: ['cmake', '--install', '$BUILD', '--prefix', '$INSTALL'],
	};
}

function descriptorIdentity(value) {
	assert(typeof value.url === 'string' && value.url.startsWith('https://')
		&& typeof value.fileName === 'string' && value.fileName
		&& Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && SHA256.test(value.sha256),
	'The Electron header archive identity is invalid.');
	return { url: value.url, fileName: value.fileName, byteLength: value.byteLength, sha256: value.sha256 };
}

function targetRecord(value) {
	const target = NATIVE_HELPER_ADDON_TARGETS.find(({ id }) => id === value);
	assert(target, `Unsupported native helper build target ${String(value)}.`);
	return target;
}

function boundedText(value, label) {
	assert(typeof value === 'string' && value.trim().length >= 1 && value.length <= 512,
		`The native helper ${label} is invalid.`);
	return value.trim();
}

function fileDescriptor(path, bytes) {
	return { name: path.split('/').at(-1), path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function validateDescriptor(value, maximum, label) {
	assert(value && typeof value === 'object' && typeof value.name === 'string' && value.name
		&& typeof value.path === 'string' && value.path
		&& Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && value.byteLength <= maximum
		&& SHA256.test(String(value.sha256)), `The ${label} descriptor is invalid.`);
}

function verifyDescriptor(bytes, descriptor, label) {
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length mismatch.`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest mismatch.`);
}

function readRegularFileSync(root, path, label) {
	const absolute = resolve(root, ...path.split('/'));
	const bytes = requireRegularFileSync(absolute, label);
	return bytes;
}

function requireRegularFileSync(path, label) {
	/* Sync reads are limited to the small policy closure used during deterministic derivation. */
	try {
		const metadata = lstatSync(path);
		assert(metadata.isFile() && !metadata.isSymbolicLink() && realpathSync(path) === path,
			`The ${label} is not one canonical regular file.`);
		return readFileSync(path);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(`The ${label}`)) throw error;
		throw new Error(`Unable to read the ${label}: ${error.message}`, { cause: error });
	}
}

async function regularFile(path, label, maximum) {
	const absolute = absolutePath(path, label);
	const metadata = await lstat(absolute);
	assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0 && metadata.size <= maximum,
		`The ${label} is not one bounded regular file.`);
	return readFile(absolute);
}

async function canonicalDirectory(path, label) {
	const absolute = absolutePath(path, label);
	const metadata = await lstat(absolute);
	assert(metadata.isDirectory() && !metadata.isSymbolicLink() && await realpath(absolute) === absolute,
		`The ${label} is not a canonical directory.`);
	return absolute;
}

function absentAbsolutePath(path, label) {
	const absolute = absolutePath(path, label);
	try {
		if (lstatSync(absolute)) throw new Error(`The ${label} already exists.`);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
	return absolute;
}

function absolutePath(value, label) {
	assert(typeof value === 'string' && value.length > 0 && resolve(value) === value && !value.includes('\0'),
		`The ${label} must be an absolute normalized path.`);
	return value;
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`The ${label} is invalid JSON: ${error.message}`, { cause: error }); }
}

function canonicalJson(value) {
	return Buffer.from(`${JSON.stringify(sortJson(value), null, '\t')}\n`);
}

function sortJson(value) {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function sameJson(left, right) {
	return canonicalJson(left).equals(canonicalJson(right));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

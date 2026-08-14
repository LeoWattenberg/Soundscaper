/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	cp,
	lstat,
	mkdir,
	readFile,
	readdir,
	readlink,
	realpath,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
	pruneFrameworkDevelopmentHeaders,
	pruneFrameworkLinkerStubs,
	pruneUnpackableSymlinks,
} from './desktop-nightly-tests-browser-pruning.mjs';

export const NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS = Object.freeze([
	'@axe-core/playwright',
	'@echogarden/pffft-wasm',
	'@ffmpeg/core',
	'@ffmpeg/ffmpeg',
	'@noble/hashes',
	'@playwright/test',
	'@zip.js/zip.js',
	'fflate',
	'saxes',
	'sql.js',
]);

const REQUIRED_INPUTS = Object.freeze([
	{ source: 'desktop/nightly-tests-main.mjs', destination: 'desktop/nightly-tests-main.mjs', kind: 'file', label: 'nightly test launcher' },
	{ source: 'desktop/nightly-tests-manifest.mjs', destination: 'desktop/nightly-tests-manifest.mjs', kind: 'file', label: 'nightly test manifest reader' },
	{ source: 'scripts/lib/desktop-nightly-tests-runtime.mjs', destination: 'scripts/lib/desktop-nightly-tests-runtime.mjs', kind: 'file', label: 'nightly test runtime' },
	{ source: 'scripts/lib/desktop-nightly-tests-static-route.mjs', destination: 'scripts/lib/desktop-nightly-tests-static-route.mjs', kind: 'file', label: 'nightly test static route resolver' },
	{ source: 'playwright.nightly-tests.config.mjs', destination: 'playwright.nightly-tests.config.mjs', kind: 'file', label: 'nightly test Playwright config' },
	{ source: 'dist', destination: 'dist', kind: 'directory', label: 'production web build' },
	{ source: 'src', destination: 'src', kind: 'directory', label: 'browser-test source tree' },
	{ source: 'tests/browser', destination: 'tests/browser', kind: 'directory', label: 'browser test tree', exclude: new Set(['AGENTS.md']) },
	{ source: 'tests/aup3-fixture.js', destination: 'tests/aup3-fixture.js', kind: 'file', label: 'AUP3 browser support fixture' },
	{ source: 'tests/fixtures/aup4-native-rich.js', destination: 'tests/fixtures/aup4-native-rich.js', kind: 'file', label: 'AUP4 browser support fixture' },
]);

const REQUIRED_NOTICE_FILES = Object.freeze({
	'@axe-core/playwright': Object.freeze(['LICENSE']),
	'@echogarden/pffft-wasm': Object.freeze(['COPYING']),
	'@playwright/test': Object.freeze(['LICENSE', 'NOTICE']),
	'axe-core': Object.freeze(['LICENSE', 'LICENSE-3RD-PARTY.txt']),
	playwright: Object.freeze(['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt']),
	'playwright-core': Object.freeze(['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt']),
});
const NOTICE_NAME = /^(?:copying|licen[cs]e|notice|thirdpartynotices)(?:[._-].*)?$/iu;
const PACKAGE_NAME = /^(?:@[a-z\d](?:[a-z\d._-]*[a-z\d])?\/[a-z\d](?:[a-z\d._-]*[a-z\d])?|[a-z\d](?:[a-z\d._-]*[a-z\d])?)$/u;
const SOURCE_REVISION = /^[a-f\d]{40}$/u;

export async function stageDesktopNightlyTests({
	repositoryRoot,
	outputRoot,
	browserSourceRoot,
	sourceRevision = null,
	target = {},
}) {
	const root = resolveRequiredPath(repositoryRoot, 'repository root');
	const output = resolveRequiredPath(outputRoot, 'output root');
	const browsers = resolveRequiredPath(browserSourceRoot, 'browser source root');
	await assertDirectory(root, 'nightly test repository root');
	assertSafeOutput({ root, output, browsers });
	await assertSafeOutputPath(output);
	if (sourceRevision !== null && !SOURCE_REVISION.test(sourceRevision)) {
		throw new TypeError('Nightly test source revision must be a 40-character lowercase SHA-1.');
	}
	const normalizedTarget = normalizeTarget(target);
	const projectPackage = await readRequiredJson(join(root, 'package.json'), 'Soundscaper package metadata');
	if (projectPackage.name !== 'soundscaper' || typeof projectPackage.version !== 'string' || !projectPackage.version) {
		throw new Error('Soundscaper package metadata has an unexpected name or version.');
	}

	await validateRequiredInputs(root);
	const runtimePackages = await resolveRuntimePackages(root);
	await validateRuntimePackages(root, runtimePackages);
	const browserRevisions = await validateBrowserCache(root, browsers);
	await validateLicenses(root, runtimePackages);

	const temporaryOutput = `${output}.staging-${process.pid}-${randomUUID()}`;
	await assertSafeOutputPath(temporaryOutput);
	await rm(temporaryOutput, { recursive: true, force: true });
	try {
		await mkdir(temporaryOutput, { recursive: true });
		await copyRequiredInputs(root, temporaryOutput);
		await copyRuntimePackages(root, temporaryOutput, runtimePackages);
		await copyTree(browsers, join(temporaryOutput, '.local-browsers'), {
			excludedRootNames: new Set(['.links']),
		});
		await pruneFrameworkDevelopmentHeaders(join(temporaryOutput, '.local-browsers'));
		await pruneFrameworkLinkerStubs(join(temporaryOutput, '.local-browsers'));
		await pruneUnpackableSymlinks(join(temporaryOutput, '.local-browsers'));
		await stageLicenses(root, temporaryOutput, runtimePackages);
		await writeJson(join(temporaryOutput, 'package.json'), nightlyTestsPackage(projectPackage.version));

		const payloadPaths = [
			'.local-browsers',
			'dist',
			'licenses',
			'node_modules',
			'package.json',
			'playwright.nightly-tests.config.mjs',
			'src',
			'tests',
		];
		const payload = [];
		for (const path of payloadPaths) payload.push(await describePayload(join(temporaryOutput, path), path));
		const manifest = {
			schemaVersion: 1,
			kind: 'soundscaper-desktop-nightly-tests',
			applicationVersion: projectPackage.version,
			sourceRevision,
			target: normalizedTarget,
			browserRevisions,
			runtimePackages: runtimePackages.map(({ name, version }) => ({ name, version })),
			payload,
		};
		await writeJson(join(temporaryOutput, 'stage-manifest.json'), manifest);
		await rm(output, { recursive: true, force: true });
		await mkdir(dirname(output), { recursive: true });
		await rename(temporaryOutput, output);
		return Object.freeze({ outputRoot: output, manifest: Object.freeze(manifest) });
	} catch (error) {
		await rm(temporaryOutput, { recursive: true, force: true });
		throw error;
	}
}

async function validateRequiredInputs(root) {
	for (const input of REQUIRED_INPUTS) {
		const path = join(root, input.source);
		if (input.kind === 'directory') await assertDirectory(path, `required ${input.label}`);
		else await assertRegularFile(path, `required ${input.label}`);
		await assertSafeTree(path, input.label);
	}
	for (const path of ['LICENSE', 'THIRD_PARTY_LICENSES.md']) {
		await assertRegularFile(join(root, path), `required ${path}`);
	}
	await assertRegularFile(
		join(root, 'LICENSES/Playwright-winldd-MIT.txt'),
		'required Playwright WinLDD MIT notice',
	);
	await assertDirectory(join(root, 'LICENSES'), 'required license directory');
	await assertSafeTree(join(root, 'LICENSES'), 'license directory');
}

async function copyRequiredInputs(root, output) {
	for (const input of REQUIRED_INPUTS) {
		await copyTree(join(root, input.source), join(output, input.destination), {
			excludedRootNames: input.exclude ?? new Set(),
		});
	}
}

async function resolveRuntimePackages(root) {
	const packages = new Map();
	const pending = [...NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS];
	while (pending.length) {
		const name = pending.shift();
		assertPackageName(name);
		if (packages.has(name)) continue;
		const packageRoot = join(root, 'node_modules', ...name.split('/'));
		const metadata = await readRequiredJson(join(packageRoot, 'package.json'), `runtime package ${name}`);
		if (metadata.name !== name || typeof metadata.version !== 'string' || !metadata.version) {
			throw new Error(`Runtime package ${name} has mismatched package metadata.`);
		}
		packages.set(name, { name, version: metadata.version, root: packageRoot });
		for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) {
			assertPackageName(dependency);
			pending.push(dependency);
		}
	}
	return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function validateRuntimePackages(root, runtimePackages) {
	const nodeModulesRoot = join(root, 'node_modules');
	for (const runtimePackage of runtimePackages) {
		if (!isPathInside(nodeModulesRoot, runtimePackage.root)) {
			throw new Error(`Unsafe runtime package path for ${runtimePackage.name}.`);
		}
		await assertDirectory(runtimePackage.root, `runtime package ${runtimePackage.name}`);
		await assertSafeTree(runtimePackage.root, `runtime package ${runtimePackage.name}`, {
			excludedRootNames: runtimePackage.name === 'playwright-core' ? new Set(['.local-browsers']) : new Set(),
		});
	}
}

async function copyRuntimePackages(root, output, runtimePackages) {
	for (const runtimePackage of runtimePackages) {
		await copyTree(runtimePackage.root, join(output, 'node_modules', ...runtimePackage.name.split('/')), {
			excludedRootNames: runtimePackage.name === 'playwright-core' ? new Set(['.local-browsers']) : new Set(),
		});
	}
}

async function validateBrowserCache(root, browserRoot) {
	if (browserRoot === root || isPathInside(browserRoot, root)) {
		throw new Error('Nightly test browser source cannot contain the repository root.');
	}
	await assertDirectory(browserRoot, 'Playwright browser source');
	await assertSafeTree(browserRoot, 'Playwright browser source', {
		allowContainedSymlinks: true,
		excludedRootNames: new Set(['.links']),
	});
	const registry = await readRequiredJson(
		join(root, 'node_modules/playwright-core/browsers.json'),
		'Playwright browser registry',
	);
	if (!Array.isArray(registry.browsers)) throw new Error('Playwright browser registry has no browser inventory.');
	const records = new Map(registry.browsers.map((browser) => [browser.name, browser]));
	const requirements = [
		['chromium-headless-shell', 'chromiumHeadlessShell'],
		['firefox', 'firefox'],
		['webkit', 'webkit'],
		['ffmpeg', 'ffmpeg'],
	];
	const entries = (await readdir(browserRoot, { withFileTypes: true }))
		.filter((entry) => entry.name !== '.links');
	const admitted = new Set();
	const revisions = {};
	for (const [browserName, manifestName] of requirements) {
		const record = records.get(browserName);
		if (!record || typeof record.revision !== 'string' || !/^\d+$/u.test(record.revision)) {
			throw new Error(`Playwright browser registry has no valid ${browserName} revision.`);
		}
		const candidates = new Set([record.revision, ...Object.values(record.revisionOverrides ?? {})]);
		const prefix = browserName.replaceAll('-', '_');
		const matches = entries.filter((entry) => entry.isDirectory()
			&& browserDirectoryMatches(entry.name, prefix, candidates));
		if (matches.length !== 1) {
			throw new Error(`Playwright browser source must contain exactly one installed ${browserName} revision.`);
		}
		await assertRegularFile(
			join(browserRoot, matches[0].name, 'INSTALLATION_COMPLETE'),
			`installed ${browserName} completion marker`,
		);
		admitted.add(matches[0].name);
		revisions[manifestName] = matches[0].name.match(/(\d+)$/u)?.[1];
	}
	const winlddRecord = records.get('winldd');
	if (winlddRecord) {
		if (typeof winlddRecord.revision !== 'string' || !/^\d+$/u.test(winlddRecord.revision)) {
			throw new Error('Playwright browser registry has no valid winldd revision.');
		}
		const candidates = new Set([winlddRecord.revision, ...Object.values(winlddRecord.revisionOverrides ?? {})]);
		const matches = entries.filter((entry) => entry.isDirectory()
			&& browserDirectoryMatches(entry.name, 'winldd', candidates));
		if (matches.length > 1) {
			throw new Error('Playwright browser source must contain at most one installed winldd revision.');
		}
		if (matches.length === 1) {
			await assertRegularFile(
				join(browserRoot, matches[0].name, 'INSTALLATION_COMPLETE'),
				'installed winldd completion marker',
			);
			admitted.add(matches[0].name);
			revisions.winldd = matches[0].name.match(/(\d+)$/u)?.[1];
		}
	}
	const unexpected = entries.filter((entry) => !admitted.has(entry.name));
	if (unexpected.length) {
		throw new Error(`Playwright browser source has unexpected entries: ${unexpected.map(({ name }) => name).join(', ')}`);
	}
	return Object.freeze(revisions);
}

function browserDirectoryMatches(name, prefix, revisions) {
	for (const revision of revisions) {
		if (name === `${prefix}-${revision}`) return true;
		if (name.startsWith(`${prefix}_`) && name.endsWith(`_special-${revision}`)) return true;
	}
	return false;
}

async function validateLicenses(root, runtimePackages) {
	const packageByName = new Map(runtimePackages.map((runtimePackage) => [runtimePackage.name, runtimePackage]));
	for (const [packageName, requiredFiles] of Object.entries(REQUIRED_NOTICE_FILES)) {
		const runtimePackage = packageByName.get(packageName);
		if (!runtimePackage) throw new Error(`Distributed notice package ${packageName} is absent from the runtime closure.`);
		for (const name of requiredFiles) {
			await assertRegularFile(join(runtimePackage.root, name), `required ${packageName} ${name}`);
		}
	}
	await assertRegularFile(join(root, 'THIRD_PARTY_LICENSES.md'), 'required third-party notice');
}

async function stageLicenses(root, output, runtimePackages) {
	const licenseRoot = join(output, 'licenses');
	await copyTree(join(root, 'LICENSE'), join(licenseRoot, 'Soundscaper-AGPL-3.0.txt'));
	await copyTree(join(root, 'THIRD_PARTY_LICENSES.md'), join(licenseRoot, 'THIRD_PARTY_LICENSES.md'));
	await copyTree(join(root, 'LICENSES'), join(licenseRoot, 'LICENSES'));
	for (const runtimePackage of runtimePackages) {
		const entries = await readdir(runtimePackage.root, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !NOTICE_NAME.test(entry.name)) continue;
			await copyTree(
				join(runtimePackage.root, entry.name),
				join(licenseRoot, 'node_modules', ...runtimePackage.name.split('/'), entry.name),
			);
		}
	}
}

async function assertSafeTree(root, label, options = {}) {
	const excludedRootNames = options.excludedRootNames ?? new Set();
	const canonicalRoot = await realpath(root);
	await visit(root, '');

	async function visit(path, relativePath) {
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink()) {
			if (!options.allowContainedSymlinks) throw new Error(`${label} contains a symbolic link: ${relativePath || '.'}`);
			const target = await readlink(path);
			if (isAbsolute(target)) throw new Error(`${label} symbolic link must be relative: ${relativePath}`);
			const lexicalTarget = resolve(dirname(path), target);
			if (!isPathInside(root, lexicalTarget) && lexicalTarget !== root) {
				throw new Error(`${label} symbolic link leaves its source root: ${relativePath}`);
			}
			let canonicalTarget;
			try {
				canonicalTarget = await realpath(path);
			} catch (error) {
				throw new Error(`${label} contains an unresolved symbolic link: ${relativePath}`, { cause: error });
			}
			if (!isPathInside(canonicalRoot, canonicalTarget) && canonicalTarget !== canonicalRoot) {
				throw new Error(`${label} symbolic link leaves its canonical source root: ${relativePath}`);
			}
			return;
		}
		if (metadata.isFile()) return;
		if (!metadata.isDirectory()) throw new Error(`${label} contains a non-file entry: ${relativePath || '.'}`);
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (!relativePath && excludedRootNames.has(entry.name)) continue;
			await visit(join(path, entry.name), relativePath ? `${relativePath}/${entry.name}` : entry.name);
		}
	}
}

async function copyTree(source, destination, options = {}) {
	const sourceMetadata = await lstat(source);
	await mkdir(dirname(destination), { recursive: true });
	if (sourceMetadata.isFile()) {
		await cp(source, destination, { force: false, errorOnExist: true });
		return;
	}
	const excludedRootNames = options.excludedRootNames ?? new Set();
	await cp(source, destination, {
		recursive: true,
		force: false,
		errorOnExist: true,
		verbatimSymlinks: true,
		filter: (candidate) => {
			const relativePath = relative(source, candidate);
			if (!relativePath) return true;
			return !excludedRootNames.has(relativePath.split(sep)[0]);
		},
	});
}

async function describePayload(path, manifestPath) {
	const entries = [];
	await collect(path, '');
	const aggregate = createHash('sha256');
	let byteLength = 0;
	for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
		aggregate.update(`${entry.kind}\0${entry.path}\0${entry.byteLength}\0${entry.sha256}\0`);
		byteLength += entry.byteLength;
	}
	return Object.freeze({
		path: manifestPath,
		fileCount: entries.length,
		byteLength,
		sha256: aggregate.digest('hex'),
	});

	async function collect(candidate, relativePath) {
		const metadata = await lstat(candidate);
		if (metadata.isDirectory()) {
			for (const entry of await readdir(candidate, { withFileTypes: true })) {
				await collect(join(candidate, entry.name), relativePath ? `${relativePath}/${entry.name}` : entry.name);
			}
			return;
		}
		if (metadata.isSymbolicLink()) {
			const target = await readlink(candidate);
			const bytes = Buffer.from(target);
			entries.push({ path: relativePath || manifestPath, kind: 'symlink', byteLength: bytes.byteLength, sha256: sha256(bytes) });
			return;
		}
		if (!metadata.isFile()) throw new Error(`Nightly test payload contains a non-file entry: ${manifestPath}/${relativePath}`);
		entries.push({
			path: relativePath || manifestPath,
			kind: 'file',
			byteLength: metadata.size,
			sha256: await hashFile(candidate),
		});
	}
}

function nightlyTestsPackage(version) {
	return {
		name: 'soundscaper-nightly-tests',
		productName: 'Soundscaper Nightly Tests',
		desktopName: 'org.soundscaper.desktop.nightly-tests',
		version,
		description: 'Portable Soundscaper Playwright browser test runner',
		main: 'desktop/nightly-tests-main.mjs',
		type: 'module',
		private: true,
		license: 'AGPL-3.0-only',
	};
}

function normalizeTarget(target) {
	if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('Nightly test target must be an object.');
	const platform = normalizeTargetValue(target.platform, 'platform');
	const arch = normalizeTargetValue(target.arch, 'architecture');
	return Object.freeze({ platform, arch });
}

function normalizeTargetValue(value, label) {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string' || !/^[a-z\d][a-z\d._-]*$/u.test(value)) {
		throw new TypeError(`Nightly test target ${label} is invalid.`);
	}
	return value;
}

function assertSafeOutput({ root, output, browsers }) {
	const buildRoot = join(root, '.desktop-build');
	if (!isPathInside(buildRoot, output)) {
		throw new Error('Nightly test output must be a proper descendant of the repository .desktop-build directory.');
	}
	if (output === browsers || isPathInside(output, browsers) || isPathInside(browsers, output)) {
		throw new Error('Nightly test output cannot overlap its browser source.');
	}
}

async function assertSafeOutputPath(path) {
	let candidate = path;
	while (true) {
		try {
			const metadata = await lstat(candidate);
			if (metadata.isSymbolicLink()) {
				throw new Error(`Nightly test output path contains a symbolic link: ${candidate}`);
			}
			if (candidate !== path && !metadata.isDirectory()) {
				throw new Error(`Nightly test output parent is not a directory: ${candidate}`);
			}
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		const parent = dirname(candidate);
		if (parent === candidate) return;
		candidate = parent;
	}
}

async function assertDirectory(path, label) {
	let metadata;
	try {
		metadata = await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error(`Required ${label} is missing: ${path}`, { cause: error });
		throw error;
	}
	if (metadata.isSymbolicLink()) throw new Error(`Required ${label} cannot be a symbolic link: ${path}`);
	if (!metadata.isDirectory()) throw new Error(`Required ${label} is not a directory: ${path}`);
}

async function assertRegularFile(path, label) {
	let metadata;
	try {
		metadata = await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error(`Required ${label} is missing: ${path}`, { cause: error });
		throw error;
	}
	if (metadata.isSymbolicLink()) throw new Error(`Required ${label} cannot be a symbolic link: ${path}`);
	if (!metadata.isFile()) throw new Error(`Required ${label} is not a regular file: ${path}`);
}

async function readRequiredJson(path, label) {
	await assertRegularFile(path, label);
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${path}`, { cause: error });
	}
}

function resolveRequiredPath(value, label) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Nightly test ${label} is required.`);
	return resolve(value);
}

function assertPackageName(name) {
	if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) throw new Error(`Unsafe runtime package name: ${String(name)}`);
}

function isPathInside(root, candidate) {
	const path = relative(root, candidate);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function hashFile(path) {
	return new Promise((resolvePromise, reject) => {
		const hash = createHash('sha256');
		const stream = createReadStream(path);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolvePromise(hash.digest('hex')));
	});
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

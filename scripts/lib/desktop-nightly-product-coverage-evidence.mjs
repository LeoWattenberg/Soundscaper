/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { extractFile } from '@electron/asar';

const SCRIPT_PATTERN = /\.(?:c|m)?js$/u;
const SOURCE_MAP_PATTERN = /\.map$/u;

/**
 * Preserve the exact JavaScript and renderer maps behind a packaged product.
 *
 * The next product preparation destroys `.desktop-build`, while the installed
 * nightly runner writes coverage somewhere else again. Keeping content-addressed
 * evidence beside each packaged product gives the importer a portable source
 * for both URL normalization and its executable-code denominator.
 *
 * @param {{ buildRoot: string, productId: string, productOutput: string, sourceRevision: string }} options
 */
export async function preserveDesktopNightlyProductCoverageEvidence({
	buildRoot,
	productId,
	productOutput,
	sourceRevision,
}) {
	if (!['soundscaper', 'framescaper'].includes(productId)) {
		throw new TypeError('Desktop nightly coverage evidence needs a known product.');
	}
	const build = requiredAbsolutePath(buildRoot, 'build root');
	const output = requiredAbsolutePath(productOutput, 'product output');
	if (!/^[0-9a-f]{40}$/u.test(sourceRevision ?? '')) {
		throw new TypeError('Desktop nightly coverage evidence needs a full source revision.');
	}
	const evidenceRoot = join(output, 'e2e-coverage');
	const applicationRoot = join(build, 'app');
	const rendererRoot = join(build, 'renderer');
	const sourceMapRoot = join(build, 'renderer-source-maps');
	const [applicationScripts, rendererScripts, sourceMaps] = await Promise.all([
		filesMatching(applicationRoot, SCRIPT_PATTERN, 'packaged application scripts'),
		filesMatching(rendererRoot, SCRIPT_PATTERN, 'packaged renderer scripts'),
		filesMatching(sourceMapRoot, SOURCE_MAP_PATTERN, 'renderer source maps'),
	]);
	if (sourceMaps.length === 0) {
		throw new Error('Desktop nightly coverage evidence requires renderer source maps.');
	}
	const appAsar = await uniquePackagedAppAsar(output);
	const resourcesRoot = dirname(appAsar);
	const archiveBytes = await readFile(appAsar);

	await rm(evidenceRoot, { recursive: true, force: true });
	await mkdir(evidenceRoot, { recursive: true });
	const scripts = [];
	for (const name of applicationScripts) {
		const bytes = Buffer.from(extractFile(appAsar, name));
		await assertSameBytes(join(applicationRoot, name), bytes, `packaged app.asar/${name}`);
		scripts.push(await preserveFile({
			artifactPath: `app/${name}`,
			bytes,
			evidenceRoot,
			packagedPath: `app.asar/${name}`,
			realm: preloadScript(name) ? 'preload' : 'main',
		}));
	}
	for (const name of rendererScripts) {
		const packagedRenderer = join(resourcesRoot, 'renderer', name);
		const bytes = await readFile(packagedRenderer);
		await assertSameBytes(join(rendererRoot, name), bytes, `packaged renderer/${name}`);
		scripts.push(await preserveFile({
			artifactPath: `renderer/${name}`,
			bytes,
			evidenceRoot,
			packagedPath: `renderer/${name}`,
			realm: 'renderer',
		}));
	}
	const preservedMaps = [];
	for (const name of sourceMaps) {
		preservedMaps.push(await preserveFile({
			artifactPath: `renderer-source-maps/${name}`,
			evidenceRoot,
			sourcePath: join(sourceMapRoot, name),
		}));
	}
	const manifest = {
		schemaVersion: 2,
		kind: 'soundscaper-e2e-product-build-evidence',
		productId,
		sourceRevision,
		packageArchive: fileRecord(archiveBytes),
		scripts,
		sourceMaps: preservedMaps,
	};
	const target = join(evidenceRoot, 'manifest.json');
	const temporary = join(evidenceRoot, '.manifest.json.tmp');
	await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
	await rename(temporary, target);
	return Object.freeze(manifest);
}

async function preserveFile({
	artifactPath,
	bytes,
	evidenceRoot,
	packagedPath,
	realm,
	sourcePath,
}) {
	const contents = bytes ?? await readFile(sourcePath);
	const target = join(evidenceRoot, artifactPath);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents, { flag: 'wx' });
	return Object.freeze({
		...(realm === undefined ? {} : { realm }),
		...(packagedPath === undefined ? {} : { packagedPath }),
		artifactPath,
		...fileRecord(contents),
	});
}

async function uniquePackagedAppAsar(productOutput) {
	const candidates = (await walkFiles(productOutput))
		.filter((name) => /(?:^|\/)resources\/app\.asar$/u.test(name));
	if (candidates.length !== 1) {
		throw new Error('Desktop nightly coverage evidence needs one finished packaged app.asar.');
	}
	return join(productOutput, candidates[0]);
}

async function assertSameBytes(sourcePath, packagedBytes, label) {
	const staged = await readFile(sourcePath);
	if (!staged.equals(packagedBytes)) {
		throw new Error(`Desktop nightly coverage ${label} differs from the staged executable.`);
	}
}

function fileRecord(bytes) {
	return Object.freeze({
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

async function filesMatching(root, pattern, label) {
	let files;
	try {
		files = await walkFiles(root);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error(`Desktop nightly coverage ${label} are missing.`, { cause: error });
		throw error;
	}
	return files.filter((name) => pattern.test(name));
}

async function walkFiles(root, directory = root) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await walkFiles(root, path));
		else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
	}
	return files.sort();
}

function preloadScript(name) {
	return /(?:^|[-/])preload\.(?:c|m)?js$/u.test(name);
}

function requiredAbsolutePath(value, label) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError(`Desktop nightly coverage ${label} is required.`);
	}
	return resolve(value);
}

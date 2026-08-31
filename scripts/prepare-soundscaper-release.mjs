#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { copyFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	resolveProductApplicationVersion,
	resolveProductDesktopMetadata,
	resolveProductReleaseTag,
	validateProductReleaseLines,
} from './lib/product-release-lines.mjs';

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STABLE_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const DOCUMENT_PATHS = Object.freeze({
	releaseLines: 'config/product-release-lines.json',
	packageMetadata: 'package.json',
	packageLock: 'package-lock.json',
	desktopProduct: 'desktop/product.json',
});
const REPLACEMENT_ORDER = Object.freeze([
	'packageMetadata', 'packageLock', 'desktopProduct', 'releaseLines',
]);

export function parseSoundscaperReleasePrepareArguments(args) {
	if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string'
		|| args[0].startsWith('-')) {
		throw new TypeError('Release preparation requires exactly one stable version.');
	}
	return Object.freeze({ version: args[0] });
}

export function createSoundscaperReleasePreparation(documents, versionValue) {
	const version = String(versionValue ?? '');
	if (!STABLE_SEMVER.test(version)) {
		throw new TypeError('The Soundscaper stable version must be plain semantic versioning.');
	}
	const { releaseLines: currentReleaseLines } = assertSynchronizedSoundscaperMetadata(documents);

	const releaseLines = structuredClone(currentReleaseLines);
	releaseLines.products.soundscaper.stable.version = version;
	releaseLines.products.soundscaper.applicationVersionChannel = 'stable';
	releaseLines.products.soundscaper.releaseChannel = 'stable';
	const validatedReleaseLines = validateProductReleaseLines(releaseLines);
	const packageMetadata = structuredClone(documents.packageMetadata);
	const packageLock = structuredClone(documents.packageLock);
	packageMetadata.version = version;
	packageLock.version = version;
	packageLock.packages[''].version = version;
	return Object.freeze({
		releaseLines: structuredClone(validatedReleaseLines),
		packageMetadata,
		packageLock,
		desktopProduct: structuredClone(resolveProductDesktopMetadata(
			'soundscaper', validatedReleaseLines,
		)),
	});
}

export function assertSoundscaperReleaseMetadataSynchronized(documents, tagValue) {
	const { releaseLines, version } = assertSynchronizedSoundscaperMetadata(documents);
	const release = resolveProductReleaseTag(tagValue, releaseLines);
	if (release.productId !== 'soundscaper' || release.channel !== 'stable'
		|| release.version !== version) {
		throw new Error('The tag does not match the selected Soundscaper stable release line.');
	}
	return release;
}

export async function verifyCheckedInSoundscaperRelease(options = {}) {
	const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
	const documents = await readDocuments(repositoryRoot);
	return assertSoundscaperReleaseMetadataSynchronized(documents, options.tag);
}

export async function prepareSoundscaperRelease(options = {}) {
	const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
	const documents = await readDocuments(repositoryRoot);
	const prepared = createSoundscaperReleasePreparation(documents, options.version);
	await replaceDocuments(repositoryRoot, prepared);
	(options.writeOutput ?? ((value) => process.stdout.write(value)))(
		`Soundscaper ${options.version} metadata prepared; commit it before pushing v${options.version}.\n`,
	);
	return prepared;
}

async function readDocuments(repositoryRoot) {
	const entries = await Promise.all(Object.entries(DOCUMENT_PATHS).map(async ([name, path]) => [
		name, JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8')),
	]));
	return Object.fromEntries(entries);
}

async function replaceDocuments(repositoryRoot, documents) {
	const token = `${process.pid}-${Date.now()}`;
	const entries = REPLACEMENT_ORDER.map((name) => {
		const target = resolve(repositoryRoot, DOCUMENT_PATHS[name]);
		return { name, target, temporary: `${target}.release-stage-${token}`,
			backup: `${target}.release-backup-${token}` };
	});
	let published = 0;
	try {
		for (const entry of entries) {
			await writeFile(entry.temporary, `${JSON.stringify(documents[entry.name], null, '\t')}\n`,
				{ encoding: 'utf8', flag: 'wx', mode: 0o600 });
			await copyFile(entry.target, entry.backup, constants.COPYFILE_EXCL);
		}
		for (const entry of entries) {
			await rename(entry.temporary, entry.target);
			published += 1;
		}
	} catch (error) {
		for (const entry of entries.slice(0, published).reverse()) {
			await copyFile(entry.backup, entry.target);
		}
		throw error;
	} finally {
		for (const entry of entries) {
			await ignoreMissing(unlink(entry.temporary));
			await ignoreMissing(unlink(entry.backup));
		}
	}
}

function assertPackageDocuments(packageMetadata, packageLock, expectedVersion) {
	if (!packageMetadata || typeof packageMetadata !== 'object' || Array.isArray(packageMetadata)
		|| packageMetadata.name !== 'soundscaper' || packageMetadata.version !== expectedVersion
		|| !packageLock || typeof packageLock !== 'object' || Array.isArray(packageLock)
		|| packageLock.name !== 'soundscaper' || packageLock.version !== expectedVersion
		|| !packageLock.packages || typeof packageLock.packages !== 'object'
		|| packageLock.packages['']?.name !== 'soundscaper'
		|| packageLock.packages['']?.version !== expectedVersion) {
		throw new Error('package.json and package-lock.json are not synchronized to Soundscaper.');
	}
}

function assertSynchronizedSoundscaperMetadata(documents) {
	if (!documents || typeof documents !== 'object' || Array.isArray(documents)) {
		throw new TypeError('Soundscaper release preparation documents are invalid.');
	}
	const releaseLines = validateProductReleaseLines(documents.releaseLines);
	const version = resolveProductApplicationVersion('soundscaper', releaseLines);
	assertPackageDocuments(documents.packageMetadata, documents.packageLock, version);
	const expectedDesktop = resolveProductDesktopMetadata('soundscaper', releaseLines);
	if (JSON.stringify(documents.desktopProduct) !== JSON.stringify(expectedDesktop)) {
		throw new Error('The checked-in Soundscaper desktop metadata is not synchronized.');
	}
	return Object.freeze({ releaseLines, version });
}

async function ignoreMissing(operation) {
	try { await operation; }
	catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	const { version } = parseSoundscaperReleasePrepareArguments(process.argv.slice(2));
	prepareSoundscaperRelease({ version }).catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

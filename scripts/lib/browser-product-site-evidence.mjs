/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { sourceMapDirectoryFor } from './build-source-map-relocation.mjs';

export const BROWSER_PRODUCT_EVIDENCE = '.browser-product-build.json';
const REQUIRED_PRODUCT_FILES = Object.freeze(['en/index.html', '_headers', '_redirects', 'offline-shell.json', 'service-worker.js']);

function validateIdentity({ outputDirectory, productId, origin, sourceRevision }) {
	if (!isAbsolute(outputDirectory) || !['soundscaper', 'framescaper', 'motionscaper'].includes(productId)
		|| new URL(origin).origin !== origin || !/^[a-f\d]{40}$/u.test(sourceRevision)) throw new Error('Browser product evidence requires an exact build identity.');
}

/** Verify the product identity and every digest recorded by the build step. */
export async function verifyBrowserProductBuildEvidence(site) {
	validateIdentity(site);
	const { outputDirectory } = site;
	const evidencePath = resolve(outputDirectory, BROWSER_PRODUCT_EVIDENCE);
	let evidence;
	try {
		evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`The ${site.productId} browser site has no readable verification evidence at ${evidencePath}.`,
			{ cause: error },
		);
	}
	if (evidence.schemaVersion !== 2
		|| evidence.productId !== site.productId
		|| evidence.origin !== site.origin
		|| evidence.sourceRevision !== site.sourceRevision) {
		throw new Error(`The ${site.productId} browser-site verification evidence names the wrong build.`);
	}
	const required = requiredProductFiles(site.productId);
	const actualFiles = await browserProductFiles(outputDirectory);
	if (required.some((relativePath) => !actualFiles.includes(relativePath))
		|| JSON.stringify(Object.keys(evidence.files ?? {}).sort()) !== JSON.stringify(actualFiles)) {
		throw new Error(`The ${site.productId} browser-site verification evidence has an incomplete file inventory.`);
	}
	for (const relativePath of actualFiles) {
		const bytes = await readFile(resolve(outputDirectory, relativePath));
		const record = evidence.files[relativePath];
		if (record?.byteLength !== bytes.byteLength || record.sha256 !== sha256(bytes)) {
			throw new Error(`The verified ${site.productId} browser file changed: ${relativePath}.`);
		}
	}
	const actualMaps = await browserSourceMapFiles(outputDirectory);
	if (JSON.stringify(Object.keys(evidence.sourceMaps ?? {}).sort()) !== JSON.stringify(actualMaps)) {
		throw new Error(`The ${site.productId} browser-site source-map evidence has an incomplete inventory.`);
	}
	for (const relativePath of actualMaps) {
		const bytes = await readFile(resolve(sourceMapDirectoryFor(outputDirectory), relativePath));
		const record = evidence.sourceMaps[relativePath];
		if (record?.byteLength !== bytes.byteLength || record.sha256 !== sha256(bytes)) {
			throw new Error(`The verified ${site.productId} browser source map changed: ${relativePath}.`);
		}
	}
	const document = await readFile(resolve(outputDirectory, 'en/index.html'), 'utf8');
	if (!document.includes(`data-product="${site.productId}"`)) {
		throw new Error(`The verified ${site.productId} browser site serves the wrong product document.`);
	}
	return evidence;
}

export async function recordBrowserProductBuildEvidence(site) {
	validateIdentity(site);
	const { outputDirectory } = site;
	const files = {};
	for (const relativePath of await browserProductFiles(outputDirectory)) {
		const bytes = await readFile(resolve(outputDirectory, relativePath));
		files[relativePath] = Object.freeze({ byteLength: bytes.byteLength, sha256: sha256(bytes) });
	}
	const sourceMaps = {};
	for (const relativePath of await browserSourceMapFiles(outputDirectory)) {
		const bytes = await readFile(resolve(sourceMapDirectoryFor(outputDirectory), relativePath));
		sourceMaps[relativePath] = Object.freeze({ byteLength: bytes.byteLength, sha256: sha256(bytes) });
	}
	const evidence = {
		schemaVersion: 2,
		productId: site.productId,
		origin: site.origin,
		sourceRevision: site.sourceRevision,
		files,
		sourceMaps,
	};
	await writeFile(
		resolve(outputDirectory, BROWSER_PRODUCT_EVIDENCE),
		`${JSON.stringify(evidence, null, 2)}\n`,
		'utf8',
	);
}

function requiredProductFiles(productId) {
	return Object.freeze([
		...REQUIRED_PRODUCT_FILES,
		`manifest-${productId}.webmanifest`,
	]);
}

async function browserProductFiles(outputDirectory, relativeDirectory = '') {
	const files = [];
	const directory = resolve(outputDirectory, relativeDirectory);
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		if (relativePath === BROWSER_PRODUCT_EVIDENCE) continue;
		if (entry.isDirectory()) {
			files.push(...await browserProductFiles(outputDirectory, relativePath));
		} else if (entry.isFile()) {
			files.push(relativePath);
		} else {
			throw new Error(`The browser-product site contains an unsupported entry: ${relativePath}.`);
		}
	}
	return files.sort();
}

async function browserSourceMapFiles(outputDirectory) {
	const root = sourceMapDirectoryFor(outputDirectory);
	try { return await browserProductFiles(root); }
	catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}


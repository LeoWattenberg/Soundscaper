/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Mirrors pinned upstream model artifacts into the product's object store.
 *
 *   node scripts/mirror-local-models.mjs --model silero-vad-v6
 *   node scripts/mirror-local-models.mjs --model silero-vad-v6 --publish --write-catalog
 *   node scripts/mirror-local-models.mjs --verify
 *
 * Fetching and verifying is the default and touches nothing outside the
 * staging directory. Publishing uploads to the bucket the product serves to
 * users, so it happens only with an explicit --publish, and --write-catalog
 * records the artifacts the run actually proved.
 *
 * Publishing reads R2_MODELS_* S3 credentials from the process environment.
 * The token is provisioned outside this repository with Object Read & Write
 * access scoped only to the cataloged bucket, and its endpoint must name that
 * bucket's EU jurisdiction. This command never reads a catalog signing key:
 * after its public HEAD, Range, CORS, and full-digest checks pass, the changed
 * catalog is handed to the repository-external signer.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	catalogWithMirroredArtifacts,
	mirrorLocalModel,
	mirrorLocation,
	verifyMirroredArtifact,
} from './lib/local-model-mirror.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const catalogPath = resolve(repositoryRoot, 'config/local-model-catalog.json');
const matrixPath = resolve(repositoryRoot, 'config/production-licensing-matrix.json');

function parseArguments(argv) {
	const options = { models: [], publish: false, writeCatalog: false, verify: false, stagingRoot: null };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--model') {
			const value = argv[index + 1];
			if (!value) throw new Error('--model needs a model id');
			options.models.push(value);
			index += 1;
		} else if (argument === '--staging') {
			const value = argv[index + 1];
			if (!value) throw new Error('--staging needs a directory');
			options.stagingRoot = resolve(value);
			index += 1;
		} else if (argument === '--publish') {
			options.publish = true;
		} else if (argument === '--write-catalog') {
			options.writeCatalog = true;
		} else if (argument === '--verify') {
			options.verify = true;
		} else {
			throw new Error(`Unrecognised argument: ${argument}`);
		}
	}
	return options;
}

/**
 * Serializes the catalog the way it is checked in: short scalar arrays stay on
 * one line. Without this, recording one artifact reflows every platform list
 * and buries the change that matters in a diff nobody wants to read.
 */
function serializeCatalog(catalog) {
	const lines = [];
	let pending = null;
	for (const line of JSON.stringify(catalog, null, '\t').split('\n')) {
		const trimmed = line.trim();
		if (/^"(?:platforms)": \[$/u.test(trimmed)) {
			pending = [line.trimEnd()];
			continue;
		}
		if (pending) {
			pending.push(trimmed);
			if (trimmed.startsWith(']')) {
				lines.push(`${pending[0]}${pending.slice(1, -1).join(' ')}${pending.at(-1)}`);
				pending = null;
			}
			continue;
		}
		lines.push(line);
	}
	return `${lines.join('\n')}\n`;
}

function formatBytes(bytes) {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
	return `${bytes} B`;
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	const catalogText = await readFile(catalogPath, 'utf8');
	let catalog = JSON.parse(catalogText);
	const { localModelEvidence } = JSON.parse(await readFile(matrixPath, 'utf8'));

	const models = options.models.length > 0
		? options.models
		: catalog.entries.filter((entry) => entry.upstream).map((entry) => entry.modelId);
	if (models.length === 0) throw new Error('No cataloged model has a pinned upstream to mirror');

	const stagingRoot = options.stagingRoot ?? resolve(repositoryRoot, '.model-mirror');
	process.stdout.write(`Staging in ${stagingRoot}\n`);

	if (options.verify) {
		let verified = 0;
		for (const modelId of models) {
			const entry = catalog.entries.find((candidate) => candidate.modelId === modelId);
			const artifacts = entry?.artifacts ?? entry?.upstream?.artifacts ?? [];
			process.stdout.write(`\n${modelId}\n`);
			for (const artifact of artifacts) {
				const { url } = mirrorLocation(catalog, entry, artifact.fileName);
				await verifyMirroredArtifact({ url, artifact });
				verified += 1;
				process.stdout.write(`  ${artifact.fileName} ${formatBytes(artifact.byteLength)} verified\n`);
			}
		}
		process.stdout.write(`\nVerified ${verified} mirrored artifacts against their pinned digests\n`);
		return;
	}

	for (const modelId of models) {
		process.stdout.write(`\n${modelId}\n`);
		const reported = new Set();
		const result = await mirrorLocalModel({
			catalog,
			evidence: localModelEvidence,
			modelId,
			stagingRoot,
			publish: options.publish,
			onProgress: ({ fileName, reused }) => {
				if (reused && !reported.has(fileName)) {
					reported.add(fileName);
					process.stdout.write(`  ${fileName}: already staged and verified\n`);
				}
			},
		});
		for (const artifact of result.artifacts) {
			process.stdout.write(`  ${artifact.fileName} ${formatBytes(artifact.byteLength)} ${artifact.sha256}\n`);
			process.stdout.write(`    -> ${artifact.url}\n`);
		}
		process.stdout.write(result.published ? '  published\n' : '  verified only, not published\n');
		if (options.writeCatalog) {
			catalog = catalogWithMirroredArtifacts(catalog, modelId, result.artifacts);
		}
	}

	if (options.writeCatalog) {
		await writeFile(catalogPath, serializeCatalog(catalog), 'utf8');
		process.stdout.write(`\nRecorded mirrored artifacts in ${catalogPath}\n`);
		process.stdout.write('Externally re-sign the catalog, review the diff, then run its gates.\n');
	}
}

await main();

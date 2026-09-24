#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Publish or verify authenticated optional AI archives in the EU model bucket. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { uploadImmutableR2File } from './lib/local-model-mirror.mjs';
import { verifyMirroredArtifact } from './lib/local-model-mirror-publication.mjs';
import { validateDesktopAssistanceRuntimeDistribution } from './lib/desktop-assistance-runtime-distribution-verification.mjs';
import { R2Client } from './lib/r2-client.mjs';

const BUCKET = 'soundscaper-assets';
const BASE_URL = 'https://assets.soundscaper.org/runtime/assistance/';
const TARGETS = new Set(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
const FAMILIES = ['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p'];
const SHA256 = /^[a-f\d]{64}$/u;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function exactArchive(path, archive) {
	const hash = createHash('sha256');
	let byteLength = 0;
	for await (const chunk of createReadStream(path)) {
		byteLength += chunk.length;
		assert(byteLength <= archive.byteLength, 'Staged assistance archive length changed.');
		hash.update(chunk);
	}
	assert(byteLength === archive.byteLength && hash.digest('hex') === archive.sha256,
		'Staged assistance archive digest or length changed.');
}

function validatedDistribution(authority) {
	const distribution = validateDesktopAssistanceRuntimeDistribution(authority);
	assert(distribution?.schemaVersion === 1 && TARGETS.has(distribution.targetId)
		&& Array.isArray(distribution.bundles)
		&& JSON.stringify(distribution.bundles.map(({ familyId }) => familyId)) === JSON.stringify(FAMILIES),
		'Assistance runtime distribution is invalid.');
	return distribution;
}

async function* authenticatedArchives(distribution, archivesRoot) {
	const seen = new Set();
	for (const bundle of distribution.bundles) {
		const { familyId, runtimeVersion, archive } = bundle;
		assert(FAMILIES.includes(familyId) && !seen.has(familyId)
			&& /^[A-Za-z\d][A-Za-z\d._-]*$/u.test(runtimeVersion ?? '')
			&& SHA256.test(archive?.sha256 ?? '')
			&& Number.isSafeInteger(archive?.byteLength) && archive.byteLength > 0,
			'Assistance runtime archive identity is invalid.');
		seen.add(familyId);
		const relative = `${familyId}/${runtimeVersion}/${distribution.targetId}/${archive.sha256}.tar.gz`;
		assert(archive.url === `${BASE_URL}${relative}`, 'Assistance runtime archive URL is not immutable.');
		const file = resolve(archivesRoot, relative);
		await exactArchive(file, archive);
		yield { archive, familyId, file, relative };
	}
}

/** The result is usable only after complete public readback of every archive. */
export async function publishAssistanceRuntimeBundles({
	authority, archivesRoot, client, upload = uploadImmutableR2File,
	verify = verifyMirroredArtifact,
}) {
	const distribution = validatedDistribution(authority);
	assert(client?.bucket === BUCKET
		&& client.endpoint?.hostname?.includes('.eu.r2.cloudflarestorage.com'),
		'Assistance runtime publisher requires the EU soundscaper-assets R2 bucket.');
	let published = 0;
	for await (const { archive, familyId, file, relative } of authenticatedArchives(distribution, archivesRoot)) {
		const result = await upload({ client, key: `runtime/assistance/${relative}`, file,
			artifact: archive, contentType: 'application/gzip' });
		assert(result?.status === 0, `Assistance runtime R2 publication failed for ${familyId}.`);
		await verify({ url: archive.url, artifact: archive });
		published += 1;
	}
	return { targetId: distribution.targetId, published };
}

/** Verify every staged archive and its complete public response without R2 access. */
export async function verifyAssistanceRuntimeBundles({
	authority, archivesRoot, verify = verifyMirroredArtifact,
}) {
	const distribution = validatedDistribution(authority);
	let verified = 0;
	for await (const { archive } of authenticatedArchives(distribution, archivesRoot)) {
		await verify({ url: archive.url, artifact: archive });
		verified += 1;
	}
	return { targetId: distribution.targetId, verified };
}

async function main() {
	assert(process.argv.length === 3 && ['--publish', '--verify'].includes(process.argv[2]),
		'Use --publish to upload and verify, or --verify to read back the staged assistance archives.');
	const root = resolve(import.meta.dirname, '..');
	const stageRoot = resolve(root, '.desktop-build');
	const stage = JSON.parse(await readFile(resolve(stageRoot, 'stage-manifest.json'), 'utf8'));
	const manifestBytes = await readFile(resolve(stageRoot,
		'app/config/assistance-runtime-distribution.json'));
	const authority = { manifestBytes, receipt: stage.assistanceRuntimeDistribution,
		targetId: `${stage.target.platform}-${stage.target.arch}`,
		nativeManifestBytes: await readFile(resolve(stageRoot,
			'app/config/assistance-native-runtime-manifest.json')),
		familyManifestBytes: await readFile(resolve(stageRoot,
			'app/config/assistance-runtime-family-supply-candidates.json')),
		kokoroManifestBytes: await readFile(resolve(stageRoot,
			'app/config/assistance-kokoro-g2p-runtime-manifest.json')) };
	const archivesRoot = resolve(stageRoot, 'assistance-distribution');
	if (process.argv[2] === '--verify') {
		const result = await verifyAssistanceRuntimeBundles({ authority, archivesRoot });
		process.stdout.write(`Verified ${result.verified} staged and public assistance archives for ${result.targetId}.\n`);
		return;
	}
	const client = new R2Client({ environmentPrefix: 'R2_MODELS',
		defaultBucket: BUCKET, label: 'assistance runtime publisher' });
	const result = await publishAssistanceRuntimeBundles({ authority, archivesRoot, client });
	process.stdout.write(`Published and publicly verified ${result.published} assistance archives for ${result.targetId}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

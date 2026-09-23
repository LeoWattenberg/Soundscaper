#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Publish authenticated optional AI archives to the existing EU model bucket. */

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
		assert(byteLength <= archive.byteLength, 'Assistance archive length changed before publication.');
		hash.update(chunk);
	}
	assert(byteLength === archive.byteLength && hash.digest('hex') === archive.sha256,
		'Assistance archive digest or length changed before publication.');
}

/** The result is usable only after complete public readback of every archive. */
export async function publishAssistanceRuntimeBundles({
	authority, archivesRoot, client, upload = uploadImmutableR2File,
	verify = verifyMirroredArtifact,
}) {
	const distribution = validateDesktopAssistanceRuntimeDistribution(authority);
	assert(distribution?.schemaVersion === 1 && TARGETS.has(distribution.targetId)
		&& Array.isArray(distribution.bundles)
		&& JSON.stringify(distribution.bundles.map(({ familyId }) => familyId)) === JSON.stringify(FAMILIES),
		'Assistance runtime distribution is invalid.');
	assert(client?.bucket === BUCKET
		&& client.endpoint?.hostname?.includes('.eu.r2.cloudflarestorage.com'),
		'Assistance runtime publisher requires the EU soundscaper-assets R2 bucket.');
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
		const result = await upload({ client, key: `runtime/assistance/${relative}`, file,
			artifact: archive, contentType: 'application/gzip' });
		assert(result?.status === 0, `Assistance runtime R2 publication failed for ${familyId}.`);
		await verify({ url: archive.url, artifact: archive });
	}
	return { targetId: distribution.targetId, published: seen.size };
}

async function main() {
	assert(process.argv.length === 3 && process.argv[2] === '--publish',
		'Use --publish to upload and publicly verify the staged assistance archives.');
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
	const client = new R2Client({ environmentPrefix: 'R2_MODELS',
		defaultBucket: BUCKET, label: 'assistance runtime publisher' });
	const result = await publishAssistanceRuntimeBundles({ authority,
		archivesRoot: resolve(stageRoot, 'assistance-distribution'), client });
	process.stdout.write(`Published and publicly verified ${result.published} assistance archives for ${result.targetId}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

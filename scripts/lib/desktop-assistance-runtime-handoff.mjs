/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transfer authority for one published, target-native AI distribution. */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { assistanceNativeRuntimeStageSummary } from '../../desktop/assistance-native-runtime-payload.mjs';
import { verifyAssistanceRuntimeBundles } from '../publish-assistance-runtime-assets.mjs';
import { verifyAssistanceRuntimeArchive } from './desktop-assistance-runtime-archive.mjs';
import { validateDesktopAssistanceRuntimeDistribution } from './desktop-assistance-runtime-distribution-verification.mjs';
import { validateDesktopKokoroG2pManifest } from './desktop-kokoro-g2p-runtime.mjs';
import { desktopAssistanceNativeManifest } from './desktop-assistance-speech-runtime.mjs';
import { signedAssistanceFamilySummary } from './desktop-signed-assistance-family-summary.mjs';
import { verifyMirroredArtifactDelivery } from './local-model-mirror-publication.mjs';

const MANIFESTS = Object.freeze({
	manifestBytes: 'assistance-runtime-distribution.json',
	nativeManifestBytes: 'assistance-native-runtime-manifest.json',
	familyManifestBytes: 'assistance-runtime-family-supply-candidates.json',
	kokoroManifestBytes: 'assistance-kokoro-g2p-runtime-manifest.json',
});
const REVISION = /^[a-f\d]{40}(?:[a-f\d]{24})?$/u;
const TARGETS = new Set(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const VERSION = /^[A-Za-z\d][A-Za-z\d._-]*$/u;
const SHA256 = /^[a-f\d]{64}$/u;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function descriptor(bytes) {
	return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function regularBytes(path, maximum = 8 * 1024 * 1024) {
	const info = await lstat(path);
	assert(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maximum,
		`AI runtime handoff file is not a regular bounded file: ${path}`);
	return readFile(path);
}

async function fileInventory(root) {
	const files = [];
	async function walk(directory, prefix) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			assert(!entry.isSymbolicLink(), 'AI runtime handoff contains a symbolic link.');
			if (entry.isDirectory()) await walk(join(directory, entry.name), path);
			else {
				assert(entry.isFile(), 'AI runtime handoff contains a special file.');
				files.push(path);
			}
		}
	}
	await walk(root, '');
	return files.sort();
}

function archivePaths(distribution) {
	return distribution.bundles.map(({ familyId, runtimeVersion, archive }) => {
		assert(VERSION.test(runtimeVersion) && SHA256.test(archive?.sha256 ?? ''),
			'AI runtime handoff contains an unsafe archive identity.');
		return `${familyId}/${runtimeVersion}/${distribution.targetId}/${archive.sha256}.tar.gz`;
	});
}

async function downloadPublishedArchive({ file, archive, fetchImpl }) {
	await mkdir(dirname(file), { recursive: true });
	await verifyMirroredArtifactDelivery({ url: archive.url, artifact: archive, fetchImpl });
	const response = await fetchImpl(archive.url, {
		method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
		headers: { Origin: 'https://soundscaper.org' },
	});
	assert(response?.status === 200 && response.body
		&& response.headers.get('content-length') === String(archive.byteLength)
		&& ['*', 'https://soundscaper.org'].includes(response.headers.get('access-control-allow-origin')),
		'Published AI runtime archive did not return the exact browser-readable body.');
	const temporary = `${file}.download-${process.pid}`;
	let byteLength = 0;
	const hash = createHash('sha256');
	const verify = new Transform({ transform(chunk, _encoding, callback) {
		byteLength += chunk.length;
		if (byteLength > archive.byteLength) {
			callback(new Error('Published AI runtime archive exceeded its pinned length.'));
			return;
		}
		hash.update(chunk);
		callback(null, chunk);
	} });
	try {
		await pipeline(Readable.fromWeb(response.body), verify,
			createWriteStream(temporary, { flags: 'wx' }));
		assert(byteLength === archive.byteLength && hash.digest('hex') === archive.sha256,
			'Published AI runtime archive digest or length differs from its manifest.');
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}

function validateReceipts(handoff, authority, sourceNativeManifest) {
	const { targetId } = handoff;
	const native = JSON.parse(authority.nativeManifestBytes.toString('utf8'));
	const family = JSON.parse(authority.familyManifestBytes.toString('utf8'));
	const kokoro = JSON.parse(authority.kokoroManifestBytes.toString('utf8'));
	const expectedNative = assistanceNativeRuntimeStageSummary(native, targetId);
	assert(JSON.stringify(handoff.assistanceNativeRuntime) === JSON.stringify(expectedNative),
		'AI runtime handoff speech receipt differs from its manifest.');
	const selectedNative = sourceNativeManifest ?? desktopAssistanceNativeManifest(handoff, targetId);
	const expectedSource = structuredClone(selectedNative);
	const signingFiles = new Map(handoff.assistanceRuntimeDistribution.signingFiles
		.map((file) => [file.path, file]));
	for (const packageDescriptor of [expectedSource.commonPackage, expectedSource.targets[targetId]?.package]) {
		for (const [name, file] of Object.entries(packageDescriptor?.files ?? {})) {
			const path = `${expectedSource.runtimePrefix}/node_modules/${packageDescriptor.name}/${name}`;
			const signed = signingFiles.get(path);
			if (!signed) continue;
			assert(file.byteLength === signed.original.byteLength && file.sha256 === signed.original.sha256,
				'AI runtime handoff speech signing receipt differs from the source manifest.');
			file.byteLength = signed.signed.byteLength;
			file.sha256 = signed.signed.sha256;
		}
	}
	assert(JSON.stringify(expectedSource) === JSON.stringify(native),
		'AI runtime handoff speech build receipt differs from its manifest.');
	const expectedFamilyDescriptor = descriptor(authority.familyManifestBytes);
	const familySummary = handoff.assistanceRuntimeFamilies;
	assert(familySummary?.targetId === targetId
		&& familySummary.manifest?.path === `config/${MANIFESTS.familyManifestBytes}`
		&& familySummary.manifest.byteLength === expectedFamilyDescriptor.byteLength
		&& familySummary.manifest.sha256 === expectedFamilyDescriptor.sha256,
		'AI runtime handoff family receipt differs from its manifest.');
	const recomputedFamilies = signedAssistanceFamilySummary(familySummary, family);
	assert(JSON.stringify(recomputedFamilies) === JSON.stringify(familySummary),
		'AI runtime handoff family totals differ from its manifest.');
	const kokoroSummary = handoff.kokoroG2pRuntime;
	validateDesktopKokoroG2pManifest(kokoro, targetId);
	const kokoroDescriptor = descriptor(authority.kokoroManifestBytes);
	assert(kokoroSummary?.targetId === targetId
		&& kokoroSummary.manifest?.path === `config/${MANIFESTS.kokoroManifestBytes}`
		&& kokoroSummary.manifest.byteLength === kokoroDescriptor.byteLength
		&& kokoroSummary.manifest.sha256 === kokoroDescriptor.sha256
		&& kokoroSummary.fileCount === kokoro.files?.length
		&& kokoroSummary.byteLength === kokoro.files.reduce((sum, file) => sum + file.byteLength, 0),
		'AI runtime handoff Kokoro receipt differs from its manifest.');
}

/** Authenticate all local handoff bytes before either packaging product uses them. */
export async function readDesktopAssistanceRuntimeHandoff({
	handoffRoot, sourceRevision, targetId, archivesRoot, download = false,
	fetchImpl = fetch, sourceNativeManifest,
}) {
	assert(REVISION.test(sourceRevision ?? '') && TARGETS.has(targetId),
		'AI runtime handoff requires an exact source revision and desktop target.');
	const handoff = JSON.parse((await regularBytes(resolve(handoffRoot, 'handoff.json'))).toString('utf8'));
	assert(handoff.schemaVersion === 1 && handoff.sourceRevision === sourceRevision
		&& handoff.targetId === targetId,
		'AI runtime handoff source revision or target differs from the package job.');
	const authority = { receipt: handoff.assistanceRuntimeDistribution, targetId };
	for (const [key, name] of Object.entries(MANIFESTS)) {
		authority[key] = await regularBytes(resolve(handoffRoot, 'config', name));
	}
	const distribution = validateDesktopAssistanceRuntimeDistribution(authority);
	validateReceipts(handoff, authority, sourceNativeManifest);
	const relativeArchives = archivePaths(distribution);
	const expectedFiles = ['handoff.json', ...Object.values(MANIFESTS).map((name) => `config/${name}`)].sort();
	assert(JSON.stringify(await fileInventory(handoffRoot)) === JSON.stringify(expectedFiles),
		'AI runtime handoff file inventory differs from its authenticated manifest.');
	assert(typeof archivesRoot === 'string' && archivesRoot !== '',
		'AI runtime handoff requires an archive source or download cache.');
	if (download) {
		for (let index = 0; index < relativeArchives.length; index += 1) {
			const file = resolve(archivesRoot, relativeArchives[index]);
			const existing = await lstat(file).catch((error) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			assert(existing === null || (existing.isFile() && !existing.isSymbolicLink()),
				'AI runtime archive download cache contains a non-regular file.');
			if (existing === null) await downloadPublishedArchive({ file,
				archive: distribution.bundles[index].archive, fetchImpl });
		}
	}
	await verifyAssistanceRuntimeBundles({ authority, archivesRoot, verify: async () => {} });
	for (let index = 0; index < relativeArchives.length; index += 1) {
		await verifyAssistanceRuntimeArchive(resolve(archivesRoot, relativeArchives[index]),
			distribution.bundles[index].files);
	}
	return { handoff, authority, distribution, relativeArchives, archivesRoot };
}

export async function exportDesktopAssistanceRuntimeHandoff({
	buildRoot, handoffRoot, sourceRevision, targetId, sourceNativeManifest,
}) {
	const stage = JSON.parse((await regularBytes(resolve(buildRoot, 'stage-manifest.json'))).toString('utf8'));
	assert(stage.sourceRevision === sourceRevision
		&& `${stage.target?.platform}-${stage.target?.arch}` === targetId,
		'The staged AI runtime source revision or target differs from the publisher.');
	const handoff = {
		schemaVersion: 1, sourceRevision, targetId,
		assistanceNativeRuntime: stage.assistanceNativeRuntime,
		assistanceNativeBuild: stage.assistanceNativeBuild,
		assistanceRuntimeFamilies: stage.assistanceRuntimeFamilies,
		assistanceRuntimeDistribution: stage.assistanceRuntimeDistribution,
		kokoroG2pRuntime: stage.kokoroG2pRuntime,
	};
	await rm(handoffRoot, { recursive: true, force: true });
	await mkdir(resolve(handoffRoot, 'config'), { recursive: true });
	await writeFile(resolve(handoffRoot, 'handoff.json'), `${JSON.stringify(handoff, null, 2)}\n`);
	for (const name of Object.values(MANIFESTS)) {
		await copyFile(resolve(buildRoot, 'app/config', name), resolve(handoffRoot, 'config', name));
	}
	return readDesktopAssistanceRuntimeHandoff({
		handoffRoot, sourceRevision, targetId, sourceNativeManifest,
		archivesRoot: resolve(buildRoot, 'assistance-distribution'),
	});
}

export async function stageDesktopAssistanceRuntimeHandoff({
	handoffRoot, sourceRevision, targetId, archiveRoot, cacheRoot, sourceNativeManifest,
	fetchImpl = fetch,
}) {
	const verified = await readDesktopAssistanceRuntimeHandoff({
		handoffRoot, sourceRevision, targetId, sourceNativeManifest,
		archivesRoot: cacheRoot, download: true, fetchImpl,
	});
	for (const path of verified.relativeArchives) {
		const output = resolve(archiveRoot, path);
		await mkdir(dirname(output), { recursive: true });
		await copyFile(resolve(verified.archivesRoot, path), output);
	}
	const { handoff, authority, distribution } = verified;
	return {
		speech: { manifest: JSON.parse(authority.nativeManifestBytes.toString('utf8')),
			summary: handoff.assistanceNativeRuntime, buildReceipt: handoff.assistanceNativeBuild },
		families: { manifestBytes: authority.familyManifestBytes, summary: handoff.assistanceRuntimeFamilies },
		kokoro: { manifest: JSON.parse(authority.kokoroManifestBytes.toString('utf8')),
			manifestBytes: authority.kokoroManifestBytes,
			summary: { targetId, fileCount: handoff.kokoroG2pRuntime.fileCount,
				byteLength: handoff.kokoroG2pRuntime.byteLength } },
		distribution: { manifest: distribution, manifestBytes: authority.manifestBytes,
			summary: handoff.assistanceRuntimeDistribution },
	};
}

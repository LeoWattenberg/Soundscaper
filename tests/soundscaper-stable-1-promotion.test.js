/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalJson } from '../scripts/lib/canonical-json.mjs';

import {
	createSoundscaperStable1Promotion,
	promoteSoundscaperStable1,
	validateSoundscaperStable1PromotionSource,
} from '../scripts/promote-soundscaper-stable-1.mjs';

const ROOT = new URL('../', import.meta.url);
const ADMISSION = Object.freeze({
	admitted: true,
	releaseCandidate: Object.freeze({
		version: '1.0.0-rc.1',
		tag: 'soundscaper-v1.0.0-rc.1',
		commitSha: '0123456789abcdef0123456789abcdef01234567',
		desktopPreviewWorkflowRunId: 12_345_678_901,
		packageInventorySha256: 'a'.repeat(64),
	}),
});

test('Stable 1 promotion changes only the admitted Soundscaper release line and package versions', async () => {
	const documents = await readCandidateDocuments(ROOT);
	const promoted = createSoundscaperStable1Promotion(documents, ADMISSION);
	assert.equal(promoted.releaseLines.products.soundscaper.applicationVersionChannel, 'stable');
	assert.equal(promoted.releaseLines.products.soundscaper.releaseChannel, 'stable');
	assert.equal(promoted.releaseLines.products.soundscaper.stable.status, 'admitted');
	assert.deepEqual(promoted.releaseLines.products.framescaper, documents.releaseLines.products.framescaper);
	assert.equal(promoted.packageMetadata.version, '1.0.0');
	assert.equal(promoted.packageLock.version, '1.0.0');
	assert.equal(promoted.packageLock.packages[''].version, '1.0.0');
	assert.deepEqual(promoted.desktopProduct, {
		schemaVersion: 1, id: 'soundscaper', applicationVersion: '1.0.0',
		applicationVersionChannel: 'stable', releaseChannel: 'stable', updateTagPrefix: 'v',
	});
	assert.deepEqual(promoted.productionCapabilities.products.soundscaper.release, {
		softwareStatus: 'feature-complete',
		channel: 'stable',
		candidateVersion: '1.0.0-rc.1',
		stableTarget: '1.0.0',
		admissionProfile: 'soundscaper-stable-1',
		admissionStatus: 'admitted',
	});
	assert.deepEqual(
		promoted.productionCapabilities.products.framescaper,
		documents.productionCapabilities.products.framescaper,
	);
	assert.deepEqual(promoted.productionSecurityMatrix.releaseCandidate, {
		version: '1.0.0-rc.1',
		stableVersion: '1.0.0',
		stable1Admission: 'admitted',
	});
	assert.deepEqual(
		{ ...promoted.productionSecurityMatrix, releaseCandidate: undefined },
		{ ...documents.productionSecurityMatrix, releaseCandidate: undefined },
		'the promotion cannot turn pending security controls or external evidence into passes',
	);
	assert.equal(
		promoted.ffmpegRuntimeManifest.evidence.securityMatrix.byteLength,
		Buffer.byteLength(`${JSON.stringify(promoted.productionSecurityMatrix, null, '\t')}\n`),
	);
	assert.match(promoted.ffmpegRuntimeManifest.evidence.securityMatrix.sha256, /^[a-f\d]{64}$/u);
	assert.notEqual(
		promoted.ffmpegRuntimeManifest.evidence.securityMatrix.sha256,
		documents.ffmpegRuntimeManifest.evidence.securityMatrix.sha256,
	);
	assert.match(promoted.ffmpegRuntimeManifest.review.payloadSha256, /^[a-f\d]{64}$/u);
	assert.equal(promoted.ffmpegRuntimeManifest.review.payloadSha256, digest(Buffer.from(canonicalJson(
		Object.fromEntries(Object.entries(promoted.ffmpegRuntimeManifest).filter(([key]) => key !== 'review')),
	))));
	assert.throws(
		() => createSoundscaperStable1Promotion(documents, { admitted: false }),
		/not admitted/iu,
	);
	assert.equal(validateSoundscaperStable1PromotionSource(
		ADMISSION, ADMISSION.releaseCandidate.commitSha,
	).commitSha, ADMISSION.releaseCandidate.commitSha);
	assert.throws(
		() => validateSoundscaperStable1PromotionSource(ADMISSION, 'f'.repeat(40)),
		/exact admitted release-candidate commit and tree/iu,
	);
	const drifted = structuredClone(documents);
	drifted.productionCapabilities.products.soundscaper.release.admissionStatus = 'admitted';
	assert.throws(() => createSoundscaperStable1Promotion(drifted, ADMISSION), /candidate.*register/iu);
});

test('the promotion command writes nothing when external admission remains blocked', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-stable-promotion-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const documents = await readCandidateDocuments(ROOT);
	await writeDocuments(repositoryRoot, documents);
	const before = await bytesByPath(repositoryRoot);
	await assert.rejects(
		promoteSoundscaperStable1({ repositoryRoot, runAdmission: async () => ({ admitted: false }) }),
		/not admitted/iu,
	);
	assert.deepEqual(await bytesByPath(repositoryRoot), before);

	await promoteSoundscaperStable1({
		repositoryRoot,
		runAdmission: async () => ADMISSION,
		expectedSourceCommit: ADMISSION.releaseCandidate.commitSha,
		writeOutput: () => undefined,
	});
	const after = await readDocuments(new URL(`file://${repositoryRoot}/`));
	assert.equal(after.releaseLines.products.soundscaper.stable.status, 'admitted');
	assert.equal(after.packageMetadata.version, '1.0.0');
	assert.equal(after.packageLock.version, '1.0.0');
	assert.equal(after.desktopProduct.applicationVersion, '1.0.0');
	assert.equal(after.productionCapabilities.products.soundscaper.release.admissionStatus, 'admitted');
	assert.equal(after.productionSecurityMatrix.releaseCandidate.stable1Admission, 'admitted');
	assert.notEqual(
		after.ffmpegRuntimeManifest.evidence.securityMatrix.sha256,
		documents.ffmpegRuntimeManifest.evidence.securityMatrix.sha256,
	);
});

test('promotion refuses a checkout other than the exact admitted candidate commit', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-stable-promotion-source-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const documents = await readCandidateDocuments(ROOT);
	await writeDocuments(repositoryRoot, documents);
	const before = await bytesByPath(repositoryRoot);
	await assert.rejects(promoteSoundscaperStable1({
		repositoryRoot,
		runAdmission: async () => ADMISSION,
		resolveSourceCommit: async () => 'f'.repeat(40),
		writeOutput: () => undefined,
	}), /exact admitted release-candidate commit and tree/iu);
	assert.deepEqual(await bytesByPath(repositoryRoot), before);
});

test('promotion rolls every document back when a replacement rename fails partway', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-stable-promotion-rollback-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const documents = await readCandidateDocuments(ROOT);
	await writeDocuments(repositoryRoot, documents);
	const before = await bytesByPath(repositoryRoot);
	let replacementCount = 0;
	await assert.rejects(promoteSoundscaperStable1({
		repositoryRoot,
		runAdmission: async () => ADMISSION,
		expectedSourceCommit: ADMISSION.releaseCandidate.commitSha,
		writeOutput: () => undefined,
		fileSystem: {
			rename: async (source, target) => {
				if (source.endsWith('.stable-promotion-stage') && ++replacementCount === 3) {
					throw new Error('injected replacement failure');
				}
				return rename(source, target);
			},
		},
	}), /injected replacement failure/iu);
	assert.deepEqual(await bytesByPath(repositoryRoot), before);
});

test('an interrupted partial replacement is fenced and recovered before another promotion', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-stable-promotion-recovery-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const documents = await readCandidateDocuments(ROOT);
	await writeDocuments(repositoryRoot, documents);
	let replacementCount = 0;
	await assert.rejects(promoteSoundscaperStable1({
		repositoryRoot,
		runAdmission: async () => ADMISSION,
		expectedSourceCommit: ADMISSION.releaseCandidate.commitSha,
		writeOutput: () => undefined,
		fileSystem: {
			rename: async (source, target) => {
				if (source.endsWith('.stable-promotion-stage') && ++replacementCount === 3) {
					throw new Error('injected interrupted replacement');
				}
				return rename(source, target);
			},
			copyFile: async (source, target, mode) => {
				if (source.endsWith('.stable-promotion-backup') && replacementCount === 3) {
					throw new Error('injected interrupted rollback');
				}
				return copyFile(source, target, mode);
			},
		},
	}), /could not be rolled back completely/iu);
	assert.ok((await readdir(repositoryRoot)).includes('.soundscaper-stable-1-promotion-prepared'));

	await promoteSoundscaperStable1({
		repositoryRoot,
		runAdmission: async () => ADMISSION,
		expectedSourceCommit: ADMISSION.releaseCandidate.commitSha,
		writeOutput: () => undefined,
	});
	const recovered = await readDocuments(new URL(`file://${repositoryRoot}/`));
	assert.equal(recovered.releaseLines.products.soundscaper.stable.status, 'admitted');
	assert.equal(recovered.packageMetadata.version, '1.0.0');
	assert.deepEqual((await recursiveFiles(repositoryRoot)).filter((path) =>
		/stable-promotion|soundscaper-stable-1-promotion/u.test(path)), []);
});

async function readDocuments(root) {
	const [
		releaseLines, packageMetadata, packageLock, desktopProduct,
		productionCapabilities, productionSecurityMatrix, ffmpegRuntimeManifest,
	] = await Promise.all([
		json(new URL('config/product-release-lines.json', root)),
		json(new URL('package.json', root)),
		json(new URL('package-lock.json', root)),
		json(new URL('desktop/product.json', root)),
		json(new URL('config/production-capabilities.json', root)),
		json(new URL('config/production-security-matrix.json', root)),
		json(new URL('config/ffmpeg-runtime-manifest.json', root)),
	]);
	return {
		releaseLines, packageMetadata, packageLock, desktopProduct,
		productionCapabilities, productionSecurityMatrix, ffmpegRuntimeManifest,
	};
}

async function readCandidateDocuments(root) {
	const documents = await readDocuments(root);
	if (documents.releaseLines.products.soundscaper.applicationVersionChannel === 'candidate') {
		return documents;
	}
	const candidate = structuredClone(documents);
	const line = candidate.releaseLines.products.soundscaper;
	line.applicationVersionChannel = 'candidate';
	line.releaseChannel = 'candidate';
	line.stable.status = 'pending-admission';
	for (const metadata of [candidate.packageMetadata, candidate.packageLock]) {
		metadata.version = line.candidate.version;
	}
	candidate.packageLock.packages[''].version = line.candidate.version;
	candidate.desktopProduct = {
		schemaVersion: 1, id: 'soundscaper', applicationVersion: line.candidate.version,
		applicationVersionChannel: 'candidate', releaseChannel: 'candidate', updateTagPrefix: line.candidate.tagPrefix,
	};
	Object.assign(candidate.productionCapabilities.products.soundscaper.release, {
		channel: 'candidate', admissionStatus: 'pending-external-evidence',
	});
	candidate.productionSecurityMatrix.releaseCandidate = {
		version: line.candidate.version,
		stable1Admission: 'blocked-on-remaining-milestone-9-evidence',
	};
	const securityBytes = Buffer.from(`${JSON.stringify(candidate.productionSecurityMatrix, null, '\t')}\n`);
	candidate.ffmpegRuntimeManifest.evidence.securityMatrix.byteLength = securityBytes.byteLength;
	candidate.ffmpegRuntimeManifest.evidence.securityMatrix.sha256 = digest(securityBytes);
	const payload = Object.fromEntries(Object.entries(candidate.ffmpegRuntimeManifest)
		.filter(([key]) => key !== 'review'));
	candidate.ffmpegRuntimeManifest.review.payloadSha256 = digest(Buffer.from(canonicalJson(payload)));
	return candidate;
}

async function writeDocuments(repositoryRoot, documents) {
	await Promise.all([
		mkdir(join(repositoryRoot, 'config'), { recursive: true }),
		mkdir(join(repositoryRoot, 'desktop'), { recursive: true }),
	]);
	await Promise.all([
		writeJson(join(repositoryRoot, 'config/product-release-lines.json'), documents.releaseLines),
		writeJson(join(repositoryRoot, 'package.json'), documents.packageMetadata),
		writeJson(join(repositoryRoot, 'package-lock.json'), documents.packageLock),
		writeJson(join(repositoryRoot, 'desktop/product.json'), documents.desktopProduct),
		writeJson(join(repositoryRoot, 'config/production-capabilities.json'), documents.productionCapabilities),
		writeJson(join(repositoryRoot, 'config/production-security-matrix.json'), documents.productionSecurityMatrix),
		writeJson(join(repositoryRoot, 'config/ffmpeg-runtime-manifest.json'), documents.ffmpegRuntimeManifest),
	]);
}

async function bytesByPath(repositoryRoot) {
	return Promise.all([
		'config/product-release-lines.json', 'package.json', 'package-lock.json', 'desktop/product.json',
		'config/production-capabilities.json', 'config/production-security-matrix.json',
		'config/ffmpeg-runtime-manifest.json',
	].map(async (path) => [path, await readFile(join(repositoryRoot, path), 'utf8')]));
}

async function recursiveFiles(root, prefix = '') {
	const files = [];
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = join(prefix, entry.name);
		if (entry.isDirectory()) files.push(...await recursiveFiles(root, path));
		else files.push(path);
	}
	return files;
}

async function json(url) { return JSON.parse(await readFile(url, 'utf8')); }
async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }

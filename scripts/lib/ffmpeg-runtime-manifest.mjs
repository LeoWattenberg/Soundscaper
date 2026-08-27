/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { renameIntoPlaceExclusively } from './exclusive-rename.mjs';
import { createFfmpegRuntimeEvidenceRepinner } from './ffmpeg-runtime-manifest-repin.mjs';
import {
	assert,
	assertCleanHttpsUrl,
	assertExactKeys,
	assertPlainObject,
	assertSafeRelativePath,
	assertSortedUnique,
	canonicalJson,
	deepFreeze,
	parseJson,
	readRegularFile,
	readStagedRegularFile,
	sha256,
	verifyDescriptorBytes,
	writeVerifiedFileExclusive,
} from './verified-manifest-helpers.mjs';

export { assertSafeRelativePath, canonicalJson };

export const FFMPEG_RUNTIME_MANIFEST_PATH = 'config/ffmpeg-runtime-manifest.json';

const VERIFIED_RELEASES = new WeakSet();
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const EVIDENCE_PATHS = Object.freeze({
	lineEndings: '.gitattributes',
	correspondingSource: 'desktop/ffmpeg-corresponding-source.json',
	notices: 'THIRD_PARTY_LICENSES.md',
	releaseSeverityPolicy: 'config/release-severity-policy.json',
	licensingPolicy: 'docs/production-licensing-policy.md',
	licensingMatrix: 'config/production-licensing-matrix.json',
	securityMatrix: 'config/production-security-matrix.json',
	threatModel: 'docs/production-threat-model.md',
});
const PUBLICATION_GATE_IDS = Object.freeze([
	'dependency-notice-version-audit',
	'ffmpeg-enabled-codec-patent-review',
	'ffmpeg-enabled-library-corresponding-source',
	'ffmpeg-runtime-manifest-integrity',
	'web-notice-delivery',
]);
const DESKTOP_RELEASE_GATE_IDS = Object.freeze([
	'dependency-notice-version-audit',
	'desktop-notice-delivery',
	'ffmpeg-enabled-codec-patent-review',
	'ffmpeg-enabled-library-corresponding-source',
	'ffmpeg-runtime-manifest-integrity',
]);
const PURPOSES = Object.freeze({
	audit: null,
	'desktop-assembly': null,
	'runtime-publication': null,
	'desktop-release': null,
});
const REVIEW_SCOPES = Object.freeze([
	'desktop-assembly',
	'desktop-release-policy',
	'runtime-publication-policy',
]);

export const repinFfmpegRuntimeEvidence = createFfmpegRuntimeEvidenceRepinner({
	assert, canonicalJson, evidencePaths: EVIDENCE_PATHS, manifestPath: FFMPEG_RUNTIME_MANIFEST_PATH,
	parseJson, readRegularFile, sha256, validateManifestShape,
});

export async function verifyFfmpegRuntimeManifest({
	repositoryRoot,
	purpose = 'audit',
	manifestPath = FFMPEG_RUNTIME_MANIFEST_PATH,
} = {}) {
	assert(typeof repositoryRoot === 'string' && repositoryRoot, 'repositoryRoot is required');
	assert(Object.hasOwn(PURPOSES, purpose), `Unsupported FFmpeg runtime manifest purpose: ${purpose}`);
	const root = await realpath(resolve(repositoryRoot));
	const manifestBytes = await readRegularFile(root, manifestPath, 'FFmpeg runtime manifest');
	const manifest = parseJson(manifestBytes, 'FFmpeg runtime manifest');
	validateManifestShape(manifest);
	validateReview(manifest);
	const publicPolicyBytes = await readRegularFile(root, manifest.publication.policy.path, 'runtime publication policy');
	verifyDescriptorBytes(publicPolicyBytes, manifest.publication.policy, 'runtime publication policy');
	const publicPolicy = validatePublicPolicy(
		parseJson(publicPolicyBytes, 'runtime publication policy'), manifest,
	);

	const [projectPackageBytes, lockBytes, installedPackageBytes] = await Promise.all([
		readRegularFile(root, 'package.json', 'project package metadata'),
		readRegularFile(root, 'package-lock.json', 'project package lock'),
		readRegularFile(root, `${manifest.package.lockPath}/package.json`, 'installed FFmpeg package metadata'),
	]);
	validatePackageIdentity(manifest, {
		projectPackage: parseJson(projectPackageBytes, 'package.json'),
		lock: parseJson(lockBytes, 'package-lock.json'),
		installedPackage: parseJson(installedPackageBytes, '@ffmpeg/core/package.json'),
	});

	const runtimeFiles = await Promise.all(manifest.runtime.files.map(async (descriptor) => {
		const path = `${manifest.package.lockPath}/dist/esm/${descriptor.name}`;
		const bytes = await readRegularFile(root, path, `runtime file ${descriptor.name}`);
		verifyDescriptorBytes(bytes, descriptor, `runtime file ${descriptor.name}`);
		return Object.freeze({ ...descriptor, path, bytes });
	}));
	const evidence = Object.fromEntries(await Promise.all(Object.entries(EVIDENCE_PATHS).map(async ([id, expectedPath]) => {
		const descriptor = manifest.evidence[id];
		assert(descriptor.path === expectedPath, `evidence.${id}.path must be ${expectedPath}`);
		const bytes = await readRegularFile(root, descriptor.path, `runtime evidence ${id}`);
		verifyDescriptorBytes(bytes, descriptor, `runtime evidence ${id}`);
		return [id, Object.freeze({ ...descriptor, bytes })];
	})));
	const corsBytes = await readRegularFile(root, manifest.publication.cors.path, 'runtime CORS policy');
	verifyDescriptorBytes(corsBytes, manifest.publication.cors, 'runtime CORS policy');
	validateCorsPolicy(parseJson(corsBytes, 'runtime CORS policy'), manifest.publication.corsOrigins);
	const licensingMatrix = parseJson(evidence.licensingMatrix.bytes, 'production licensing matrix');
	validateLinkedEvidence(
		manifest,
		evidence,
		licensingMatrix,
		parseJson(evidence.securityMatrix.bytes, 'production security matrix'),
	);
	validateLineEndingPolicy(String(evidence.lineEndings.bytes), manifest);
	validateAuthorizations(manifest.authorizations, licensingMatrix);
	deepFreeze(manifest);

	const release = Object.freeze({
		repositoryRoot: root,
		manifest,
		manifestBytes,
		manifestSha256: sha256(manifestBytes),
		runtimeFiles: Object.freeze(runtimeFiles),
		evidence: Object.freeze(evidence),
		corsBytes,
		publicPolicy,
		publicPolicyBytes,
	});
	VERIFIED_RELEASES.add(release);
	return release;
}

export async function stageVerifiedFfmpegRuntime({ release, outputRoot }) {
	const snapshot = snapshotVerifiedFfmpegRuntime(release);
	assert(typeof outputRoot === 'string' && outputRoot, 'outputRoot is required');
	await renameIntoPlaceExclusively(resolve(outputRoot), 'FFmpeg runtime output', async (temporary) => {
		for (const { name, bytes } of snapshot.runtimeFiles) {
			await writeFile(resolve(temporary, name), bytes, { flag: 'wx' });
		}
		await writeFile(resolve(temporary, release.manifest.publication.manifestName), snapshot.manifestBytes, { flag: 'wx' });
		return temporary;
	});
	return ffmpegRuntimeStageSummary(release);
}

export async function stageVerifiedFfmpegNotice({ release, outputPath }) {
	const snapshot = snapshotVerifiedFfmpegRuntime(release);
	await writeVerifiedFileExclusive(outputPath, snapshot.evidence.notices.bytes, 'FFmpeg notice output');
}

export async function verifyStagedFfmpegRuntime({ release, outputRoot, stageManifestPath, noticePath }) {
	verifyBufferedFfmpegRuntime(release);
	const expectedNames = [
		...release.runtimeFiles.map(({ name }) => name),
		release.manifest.publication.manifestName,
	].sort();
	const entries = await readdir(outputRoot, { withFileTypes: true });
	const actualNames = entries.map(({ name }) => name).sort();
	assert(canonicalJson(actualNames) === canonicalJson(expectedNames),
		`Staged FFmpeg runtime inventory mismatch: ${actualNames.join(', ') || '<empty>'}`);
	for (const entry of entries) {
		assert(entry.isFile() && !entry.isSymbolicLink(), `Staged FFmpeg runtime entry is not a regular file: ${entry.name}`);
	}
	for (const descriptor of release.runtimeFiles) {
		const bytes = await readFile(resolve(outputRoot, descriptor.name));
		verifyDescriptorBytes(bytes, descriptor, `staged runtime file ${descriptor.name}`);
	}
	const stagedManifest = await readFile(resolve(outputRoot, release.manifest.publication.manifestName));
	assert(stagedManifest.equals(release.manifestBytes), 'Staged FFmpeg runtime manifest does not match the verified policy manifest');
	if (stageManifestPath) {
		const stage = parseJson(await readStagedRegularFile(stageManifestPath, 'desktop stage manifest'), 'desktop stage manifest');
		assert(canonicalJson(stage.ffmpeg) === canonicalJson(ffmpegRuntimeStageSummary(release)),
			'Desktop stage manifest does not retain the verified FFmpeg runtime summary');
	}
	if (noticePath) {
		const notice = await readStagedRegularFile(noticePath, 'staged FFmpeg notice');
		verifyDescriptorBytes(notice, release.evidence.notices, 'staged FFmpeg notice');
	}
	return ffmpegRuntimeStageSummary(release);
}

export function ffmpegRuntimeStageSummary(release) {
	assertVerifiedRelease(release);
	return {
		package: release.manifest.package.name,
		version: release.manifest.package.version,
		license: release.manifest.package.license,
		runtimeManifest: {
			id: release.manifest.id,
			name: release.manifest.publication.manifestName,
			sha256: release.manifestSha256,
		},
		files: Object.fromEntries(release.runtimeFiles.map(({ name, byteLength, sha256: digest }) => [
			name,
			{ byteLength, sha256: digest },
		])),
	};
}

export function verifyBufferedFfmpegRuntime(release) {
	assertVerifiedRelease(release);
	assert(sha256(release.manifestBytes) === release.manifestSha256,
		'Buffered FFmpeg runtime manifest changed after validation');
	assert(canonicalJson(parseJson(release.manifestBytes, 'buffered FFmpeg runtime manifest')) === canonicalJson(release.manifest),
		'Buffered FFmpeg runtime manifest disagrees with the validated policy');
	for (const descriptor of release.runtimeFiles) {
		verifyDescriptorBytes(descriptor.bytes, descriptor, `buffered runtime file ${descriptor.name}`);
	}
	for (const [id, descriptor] of Object.entries(release.evidence)) {
		verifyDescriptorBytes(descriptor.bytes, descriptor, `buffered runtime evidence ${id}`);
	}
	verifyDescriptorBytes(release.corsBytes, release.manifest.publication.cors, 'buffered runtime CORS policy');
	verifyDescriptorBytes(
		release.publicPolicyBytes, release.manifest.publication.policy, 'buffered runtime publication policy',
	);
	validatePublicPolicy(parseJson(release.publicPolicyBytes, 'buffered runtime publication policy'), release.manifest);
	return release;
}

export function snapshotVerifiedFfmpegRuntime(release) {
	verifyBufferedFfmpegRuntime(release);
	return {
		manifestBytes: Buffer.from(release.manifestBytes),
		runtimeFiles: release.runtimeFiles.map((file) => ({ ...file, bytes: Buffer.from(file.bytes) })),
		evidence: Object.fromEntries(Object.entries(release.evidence).map(([id, file]) => [
			id, { ...file, bytes: Buffer.from(file.bytes) },
		])),
		corsBytes: Buffer.from(release.corsBytes),
		publicPolicy: release.publicPolicy,
		publicPolicyBytes: Buffer.from(release.publicPolicyBytes),
	};
}

function validateManifestShape(manifest) {
	assertPlainObject(manifest, 'manifest');
	assertExactKeys(manifest, [
		'schemaVersion', 'id', 'package', 'runtime', 'publication', 'evidence', 'security', 'authorizations', 'review',
	], 'manifest');
	assert(manifest.schemaVersion === 1, 'FFmpeg runtime manifest schemaVersion must be 1');
	assert(/^ffmpeg-core-\d+\.\d+\.\d+$/u.test(manifest.id), 'FFmpeg runtime manifest ID is invalid');

	assertPlainObject(manifest.package, 'package');
	assertExactKeys(manifest.package, ['name', 'version', 'lockPath', 'resolved', 'integrity', 'license'], 'package');
	assert(manifest.package.name === '@ffmpeg/core', 'package.name must be @ffmpeg/core');
	assert(/^\d+\.\d+\.\d+$/u.test(manifest.package.version), 'package.version is invalid');
	assert(manifest.id === `ffmpeg-core-${manifest.package.version}`, 'manifest.id disagrees with package.version');
	assert(manifest.package.lockPath === 'node_modules/@ffmpeg/core', 'package.lockPath is invalid');
	assertCleanHttpsUrl(manifest.package.resolved, 'package.resolved');
	assert(/^sha512-[A-Za-z\d+/_=-]+$/u.test(manifest.package.integrity), 'package.integrity is invalid');
	assert(manifest.package.license === 'GPL-2.0-or-later', 'package.license is invalid');

	assertPlainObject(manifest.runtime, 'runtime');
	assertExactKeys(manifest.runtime, ['publicPrefix', 'cacheControl', 'files'], 'runtime');
	assert(manifest.runtime.publicPrefix === `runtime/ffmpeg/${manifest.package.version}`, 'runtime.publicPrefix is invalid');
	assert(manifest.runtime.cacheControl === 'public, max-age=31536000, immutable', 'runtime.cacheControl is invalid');
	assert(Array.isArray(manifest.runtime.files), 'runtime.files must be an array');
	assert(manifest.runtime.files.length === 2, 'runtime.files must contain exactly two descriptors');
	for (const descriptor of manifest.runtime.files) validateRuntimeDescriptor(descriptor);

	assertPlainObject(manifest.publication, 'publication');
	assertExactKeys(manifest.publication, [
		'bucket', 'jurisdiction', 'manifestName', 'noticeName', 'correspondingSourceName', 'corsOrigins', 'cors', 'policy',
	], 'publication');
	assert(manifest.publication.bucket === 'soundscaper-assets', 'publication.bucket is invalid');
	assert([null, 'eu', 'fedramp'].includes(manifest.publication.jurisdiction), 'publication.jurisdiction is invalid');
	assert(manifest.publication.manifestName === 'manifest.json', 'publication.manifestName is invalid');
	assert(manifest.publication.noticeName === 'THIRD_PARTY_LICENSES.md', 'publication.noticeName is invalid');
	assert(manifest.publication.correspondingSourceName === 'ffmpeg-corresponding-source.json', 'publication.correspondingSourceName is invalid');
	assert(Array.isArray(manifest.publication.corsOrigins) && manifest.publication.corsOrigins.length > 0,
		'publication.corsOrigins must be a non-empty array');
	assertSortedUnique(manifest.publication.corsOrigins, 'publication.corsOrigins');
	for (const origin of manifest.publication.corsOrigins) validateCorsOrigin(origin);
	validateFileDescriptor(manifest.publication.cors, 'publication.cors');
	assert(manifest.publication.cors.path === 'r2-cors.json', 'publication.cors.path must be r2-cors.json');
	validateFileDescriptor(manifest.publication.policy, 'publication.policy');
	assert(manifest.publication.policy.path === 'config/ffmpeg-runtime-publication-policy.json',
		'publication.policy.path must be config/ffmpeg-runtime-publication-policy.json');

	assertPlainObject(manifest.evidence, 'evidence');
	assertExactKeys(manifest.evidence, Object.keys(EVIDENCE_PATHS), 'evidence');
	for (const [id, descriptor] of Object.entries(manifest.evidence)) validateFileDescriptor(descriptor, `evidence.${id}`);

	assertPlainObject(manifest.security, 'security');
	assertExactKeys(manifest.security, ['matrixPath', 'riskId', 'controlId'], 'security');
	assert(manifest.security.matrixPath === 'config/production-security-matrix.json', 'security.matrixPath is invalid');
	assert(manifest.security.riskId === 'runtime-supply-chain', 'security.riskId is invalid');
	assert(manifest.security.controlId === 'validated-ffmpeg-runtime-publication', 'security.controlId is invalid');

	assertPlainObject(manifest.authorizations, 'authorizations');
	assertExactKeys(manifest.authorizations, ['desktopAssembly', 'runtimePublication', 'desktopRelease'], 'authorizations');
	for (const [id, authorization] of Object.entries(manifest.authorizations)) validateAuthorization(authorization, `authorizations.${id}`);

	assertPlainObject(manifest.review, 'review');
	assertExactKeys(manifest.review, ['status', 'reviewedAt', 'reviewer', 'scopes', 'payloadSha256'], 'review');
}

function validateReview(manifest) {
	assert(['approved', 'pending'].includes(manifest.review.status),
		'FFmpeg runtime review status must be approved or pending');
	assert(/^\d{4}-\d{2}-\d{2}$/u.test(manifest.review.reviewedAt), 'FFmpeg runtime reviewedAt is invalid');
	assert(Date.parse(`${manifest.review.reviewedAt}T00:00:00Z`) <= Date.now(), 'FFmpeg runtime review date is in the future');
	assert(typeof manifest.review.reviewer === 'string' && manifest.review.reviewer.trim().length >= 3,
		'FFmpeg runtime reviewer is invalid');
	assert(Array.isArray(manifest.review.scopes), 'FFmpeg runtime review scopes must be an array');
	assert(canonicalJson(manifest.review.scopes) === canonicalJson(REVIEW_SCOPES),
		`FFmpeg runtime review scopes must be ${REVIEW_SCOPES.join(', ')}`);
	assert(SHA256_PATTERN.test(manifest.review.payloadSha256), 'FFmpeg runtime review payload digest is invalid');
	const payload = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'review'));
	assert(sha256(Buffer.from(canonicalJson(payload))) === manifest.review.payloadSha256,
		'FFmpeg runtime review payload digest is stale or invalid');
}

function validatePackageIdentity(manifest, { projectPackage, lock, installedPackage }) {
	assert(projectPackage.name === 'soundscaper', 'package.json is not the Soundscaper package');
	assert(projectPackage.dependencies?.[manifest.package.name] === manifest.package.version,
		`package.json must pin ${manifest.package.name} ${manifest.package.version}`);
	assert(lock.lockfileVersion === 3, 'package-lock.json must use lockfileVersion 3');
	const entry = lock.packages?.[manifest.package.lockPath];
	assertPlainObject(entry, `package-lock ${manifest.package.lockPath}`);
	for (const field of ['version', 'resolved', 'integrity', 'license']) {
		assert(entry[field] === manifest.package[field], `package-lock ${field} disagrees with the runtime policy manifest`);
	}
	assert(installedPackage.name === manifest.package.name, 'installed FFmpeg package name disagrees with the manifest');
	assert(installedPackage.version === manifest.package.version, 'installed FFmpeg package version disagrees with the manifest');
	assert(installedPackage.license === manifest.package.license, 'installed FFmpeg package license disagrees with the manifest');
}

function validateLinkedEvidence(manifest, evidence, licensingMatrix, securityMatrix) {
	const source = parseJson(evidence.correspondingSource.bytes, 'FFmpeg corresponding-source descriptor');
	assert(source.schemaVersion === 1, 'FFmpeg corresponding-source descriptor schemaVersion must be 1');
	assert(source.runtime?.package === manifest.package.name, 'corresponding-source runtime package disagrees with the manifest');
	assert(source.runtime?.version === manifest.package.version, 'corresponding-source runtime version disagrees with the manifest');
	const files = Object.fromEntries(manifest.runtime.files.map((file) => [file.name, file]));
	assert(source.runtime?.javascriptSha256 === files['ffmpeg-core.js'].sha256,
		'corresponding-source JavaScript digest disagrees with the manifest');
	assert(source.runtime?.wasmSha256 === files['ffmpeg-core.wasm'].sha256,
		'corresponding-source WebAssembly digest disagrees with the manifest');
	const sourceOutputs = [];
	for (const [id, label] of [['source', 'FFmpeg source'], ['buildSource', 'ffmpeg.wasm build source']]) {
		validateSourceDescriptor(source[id], label);
		sourceOutputs.push(source[id].fileName);
	}
	const reservedOutputs = new Set([
		'SHA256SUMS', 'Soundscaper-AGPL-3.0.txt', 'THIRD_PARTY_LICENSES.md',
		'ffmpeg-corresponding-source.json', 'ffmpeg-runtime-manifest.json',
	]);
	assert(new Set(sourceOutputs.map((name) => name.toLowerCase())).size === sourceOutputs.length,
		'FFmpeg source archive filenames must be unique');
	for (const fileName of sourceOutputs) {
		assert(![...reservedOutputs].some((reserved) => reserved.toLowerCase() === fileName.toLowerCase()),
			`FFmpeg source archive filename is reserved: ${fileName}`);
	}
	const notices = String(evidence.notices.bytes);
	assert(notices.includes(`@ffmpeg/core\` ${manifest.package.version}`)
		|| notices.includes(`@ffmpeg/core ${manifest.package.version}`),
		'THIRD_PARTY_LICENSES.md does not identify the checked-in FFmpeg runtime');
	const buildTag = /\/refs\/tags\/([^/]+)\.tar\.gz$/u.exec(new URL(source.buildSource.url).pathname)?.[1];
	const noticeBuildTags = [...notices.matchAll(/https:\/\/github\.com\/ffmpegwasm\/ffmpeg\.wasm\/tree\/([A-Za-z\d._-]+)/gu)];
	assert(buildTag && noticeBuildTags.length > 0 && noticeBuildTags.every((match) => match[1] === buildTag),
		'THIRD_PARTY_LICENSES.md does not identify the pinned ffmpeg.wasm build source');
	const releasePolicy = parseJson(evidence.releaseSeverityPolicy.bytes, 'release severity policy');
	assert(releasePolicy.schemaVersion === 1, 'release severity policy schemaVersion must be 1');
	assert(releasePolicy.releaseGate?.maximumOpen?.critical === 0,
		'release severity policy must block open critical defects');
	assert(licensingMatrix.schemaVersion === 1 && Array.isArray(licensingMatrix.releaseGates),
		'production licensing matrix release gates are invalid');
	assert(securityMatrix.schemaVersion === 1 && Array.isArray(securityMatrix.risks),
		'production security matrix risks are invalid');
	const risk = securityMatrix.risks.find(({ id }) => id === manifest.security.riskId);
	assert(risk, `production security matrix has no ${manifest.security.riskId} risk`);
	assert(risk.currentControls?.some(({ id }) => id === manifest.security.controlId),
		`production security matrix has no ${manifest.security.controlId} control`);
}

function validateLineEndingPolicy(attributes, manifest) {
	const requiredPaths = [
		'.gitattributes',
		FFMPEG_RUNTIME_MANIFEST_PATH,
		manifest.publication.cors.path,
		manifest.publication.policy.path,
		...Object.values(EVIDENCE_PATHS).filter((path) => path !== '.gitattributes'),
	];
	const lines = new Set(attributes.split(/\r?\n/u).map((line) => line.trim()));
	for (const path of requiredPaths) {
		assert(lines.has(`/${path} text eol=lf`), `.gitattributes must pin LF for ${path}`);
	}
}

function validatePublicPolicy(policy, manifest) {
	assertPlainObject(policy, 'runtime publication policy');
	assertExactKeys(policy, [
		'cloudflare', 'immutableCacheControl', 'pages', 'pointer', 'publicOrigin', 'publicPrefix', 'releaseSegment',
		'releaseMetadata', 'runtimeFiles', 'schemaVersion',
	], 'runtime publication policy');
	assert(policy.schemaVersion === 1, 'runtime publication policy schemaVersion must be 1');
	assert(policy.publicOrigin === 'https://assets.soundscaper.org', 'runtime publication publicOrigin is invalid');
	assert(policy.publicPrefix === manifest.runtime.publicPrefix, 'runtime publication publicPrefix disagrees with the manifest');
	assert(policy.releaseSegment === 'releases', 'runtime publication releaseSegment is invalid');
	assert(policy.immutableCacheControl === manifest.runtime.cacheControl,
		'runtime publication immutable cache policy disagrees with the manifest');
	assert(Array.isArray(policy.runtimeFiles) && policy.runtimeFiles.length === 2,
		'runtime publication policy must define exactly two runtime files');
	const expectedRuntimeFiles = [
		{ name: 'ffmpeg-core.js', contentType: 'text/javascript; charset=utf-8' },
		{ name: 'ffmpeg-core.wasm', contentType: 'application/wasm' },
	];
	for (const [index, expected] of expectedRuntimeFiles.entries()) {
		const file = policy.runtimeFiles[index];
		assertPlainObject(file, `runtime publication file ${String(index)}`);
		assertExactKeys(file, ['contentType', 'name'], `runtime publication file ${String(index)}`);
		assert(file.name === expected.name && file.contentType === expected.contentType,
			`runtime publication file ${String(index)} is invalid`);
		const manifestFile = manifest.runtime.files[index];
		assert(manifestFile.name === file.name && manifestFile.contentType === file.contentType,
			`runtime publication policy ${file.name} contentType disagrees with the manifest`);
	}
	assertPlainObject(policy.releaseMetadata, 'runtime publication releaseMetadata');
	assertExactKeys(policy.releaseMetadata, ['correspondingSource', 'manifest', 'notice'],
		'runtime publication releaseMetadata');
	const expectedMetadataTypes = {
		manifest: 'application/json; charset=utf-8',
		notice: 'text/markdown; charset=utf-8',
		correspondingSource: 'application/json; charset=utf-8',
	};
	for (const [name, contentType] of Object.entries(expectedMetadataTypes)) {
		const metadata = policy.releaseMetadata[name];
		assertPlainObject(metadata, `runtime publication ${name} metadata`);
		assertExactKeys(metadata, ['contentType'], `runtime publication ${name} metadata`);
		assert(metadata.contentType === contentType,
			`runtime publication ${name} metadata contentType is invalid`);
	}
	assertPlainObject(policy.pointer, 'runtime publication pointer');
	assertExactKeys(policy.pointer, ['cacheControl', 'contentType', 'name'], 'runtime publication pointer');
	assert(policy.pointer.name === 'latest.json', 'runtime publication pointer name is invalid');
	assert(policy.pointer.contentType === 'application/json; charset=utf-8',
		'runtime publication pointer contentType is invalid');
	assert(policy.pointer.cacheControl === 'no-store', 'runtime publication pointer cacheControl is invalid');
	assertPlainObject(policy.pages, 'runtime publication Pages policy');
	assertExactKeys(policy.pages, ['origin'], 'runtime publication Pages policy');
	assert(policy.pages.origin === 'https://soundscaper.org', 'runtime publication Pages origin is invalid');
	assertPlainObject(policy.cloudflare, 'runtime publication Cloudflare policy');
	assertExactKeys(policy.cloudflare, ['pagesRuleRef', 'pointerRuleRef', 'releaseRuleRef'],
		'runtime publication Cloudflare policy');
	assert(/^soundscaper-ffmpeg-runtime-[a-z-]+-v1$/u.test(policy.cloudflare.pointerRuleRef),
		'runtime publication Cloudflare pointerRuleRef is invalid');
	assert(/^soundscaper-ffmpeg-runtime-[a-z-]+-v1$/u.test(policy.cloudflare.releaseRuleRef),
		'runtime publication Cloudflare releaseRuleRef is invalid');
	assert(/^soundscaper-pages-[a-z-]+-v1$/u.test(policy.cloudflare.pagesRuleRef),
		'runtime publication Cloudflare pagesRuleRef is invalid');
	return deepFreeze(policy);
}

function validateAuthorizations(authorizations, licensingMatrix) {
	assertAuthorization(authorizations.desktopAssembly, [], 'desktop assembly');
	assertAuthorization(
		authorizations.runtimePublication,
		blockedLicensingGates(licensingMatrix, PUBLICATION_GATE_IDS),
		'runtime publication',
	);
	assertAuthorization(
		authorizations.desktopRelease,
		blockedLicensingGates(licensingMatrix, DESKTOP_RELEASE_GATE_IDS),
		'desktop release',
	);
}

function blockedLicensingGates(matrix, gateIds) {
	assert(new Set(matrix.releaseGates.map(({ id }) => id)).size === matrix.releaseGates.length,
		'production licensing matrix release gate IDs must be unique');
	const gates = new Map(matrix.releaseGates.map((gate) => [gate.id, gate]));
	return gateIds.filter((id) => {
		const gate = gates.get(id);
		assert(gate, `production licensing matrix has no ${id} gate`);
		assert(gate.status === 'implemented' || gate.status === 'blocked', `${id} has an unsupported status`);
		return gate.status !== 'implemented';
	});
}

function assertAuthorization(authorization, blockedBy, label) {
	const expectedStatus = blockedBy.length === 0 ? 'approved' : 'blocked';
	assert(authorization.status === expectedStatus,
		`${label} authorization must be ${expectedStatus} for the current licensing gates`);
	assert(canonicalJson(authorization.blockedBy) === canonicalJson(blockedBy),
		`${label} blockedBy must match the current licensing gates: ${blockedBy.join(', ') || '<none>'}`);
}

function validateCorsPolicy(cors, expectedOrigins) {
	assertPlainObject(cors, 'CORS policy');
	assertExactKeys(cors, ['rules'], 'CORS policy');
	assert(Array.isArray(cors.rules) && cors.rules.length === 1, 'CORS policy must contain exactly one rule');
	const rule = cors.rules[0];
	assertPlainObject(rule, 'CORS rule');
	assertExactKeys(rule, ['allowed', 'exposeHeaders', 'maxAgeSeconds'], 'CORS rule');
	assertPlainObject(rule.allowed, 'CORS allowed policy');
	assertExactKeys(rule.allowed, ['origins', 'methods', 'headers'], 'CORS allowed policy');
	assert(canonicalJson(rule.allowed.origins) === canonicalJson(expectedOrigins), 'CORS origins disagree with the manifest');
	assert(canonicalJson([...rule.allowed.methods].sort()) === canonicalJson(['GET', 'HEAD']), 'CORS methods must be GET and HEAD');
	assert(canonicalJson(rule.allowed.headers) === canonicalJson(['Range']), 'CORS headers must contain only Range');
	assert(canonicalJson([...rule.exposeHeaders].sort()) === canonicalJson(['Content-Length', 'Content-Range', 'ETag']),
		'CORS exposed headers are invalid');
	assert(rule.maxAgeSeconds === 86_400, 'CORS maxAgeSeconds must be 86400');
}

function validateCorsOrigin(value) {
	let url;
	try { url = new URL(value); } catch { throw new Error(`Invalid CORS origin: ${value}`); }
	assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', `Invalid CORS origin: ${value}`);
	const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	assert(url.hostname && !url.hostname.includes('*'), `Unsafe CORS origin: ${value}`);
	assert(url.protocol === 'https:' || (loopback && url.protocol === 'http:'), `Unsafe CORS origin: ${value}`);
}

function validateRuntimeDescriptor(descriptor) {
	assertPlainObject(descriptor, 'runtime file descriptor');
	assertExactKeys(descriptor, ['name', 'byteLength', 'sha256', 'contentType'], `runtime file ${descriptor.name || '<unknown>'}`);
	assert(typeof descriptor.name === 'string' && /^[A-Za-z\d][A-Za-z\d._-]{0,127}$/u.test(descriptor.name),
		`Unsafe runtime file name: ${descriptor.name}`);
	assert(typeof descriptor.contentType === 'string' && /^[a-z\d.+-]+\/[a-z\d.+-]+(?:; charset=utf-8)?$/u.test(descriptor.contentType),
		`Invalid content type for ${descriptor.name}`);
	assertDescriptorSizeAndDigest(descriptor, `runtime file ${descriptor.name}`, 64 * 1024 * 1024);
}

function validateFileDescriptor(descriptor, label) {
	assertPlainObject(descriptor, label);
	assertExactKeys(descriptor, ['path', 'byteLength', 'sha256'], label);
	assertSafeRelativePath(descriptor.path, `${label}.path`);
	assertDescriptorSizeAndDigest(descriptor, label, 64 * 1024 * 1024);
}

function validateSourceDescriptor(descriptor, label) {
	assertPlainObject(descriptor, label);
	assertExactKeys(descriptor, ['url', 'fileName', 'byteLength', 'sha256'], label);
	assertCleanHttpsUrl(descriptor.url, `${label} URL`);
	assert(typeof descriptor.fileName === 'string' && /^[A-Za-z\d](?:[A-Za-z\d._-]{0,158}[A-Za-z\d])?$/u.test(descriptor.fileName),
		`${label} filename is invalid`);
	assert(!/^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\.|$)/iu.test(descriptor.fileName), `${label} filename is reserved`);
	assertDescriptorSizeAndDigest(descriptor, label, 2 * 1024 * 1024 * 1024);
}

function validateAuthorization(authorization, label) {
	assertPlainObject(authorization, label);
	assertExactKeys(authorization, ['status', 'blockedBy'], label);
	assert(authorization.status === 'approved' || authorization.status === 'blocked', `${label}.status is invalid`);
	assert(Array.isArray(authorization.blockedBy), `${label}.blockedBy must be an array`);
	assertSortedUnique(authorization.blockedBy, `${label}.blockedBy`);
	for (const id of authorization.blockedBy) assert(/^[a-z\d]+(?:-[a-z\d]+)*$/u.test(id), `${label}.blockedBy contains an invalid ID`);
}

function assertDescriptorSizeAndDigest(descriptor, label, maximum) {
	assert(Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength > 0 && descriptor.byteLength <= maximum,
		`${label} byte length is invalid`);
	assert(SHA256_PATTERN.test(descriptor.sha256), `${label} digest is invalid`);
}

function assertVerifiedRelease(release) {
	assert(VERIFIED_RELEASES.has(release), 'A verified FFmpeg runtime release is required');
}

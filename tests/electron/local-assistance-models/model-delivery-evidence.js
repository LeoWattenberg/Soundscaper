/* SPDX-License-Identifier: AGPL-3.0-only */

/** Live public-delivery and packaged-install evidence for costly real-model tests. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { verifyMirroredArtifactDelivery } from '../../../scripts/lib/local-model-mirror-publication.mjs';

const CHECKS = Object.freeze(['public-head', 'byte-range', 'cors', 'full-sha256']);
const TARGET = /^(?:darwin|linux|win32)-(?:arm64|x64)$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const SOURCE_REVISION = /^[a-f\d]{40}$/u;
const PACKAGE_IDENTITY_FIELDS = Object.freeze([
	'application', 'applicationVersion', 'productId', 'sourceRevision', 'stageManifest', 'target',
]);
const PACKAGE_FILE_FIELDS = Object.freeze(['byteLength', 'fileName', 'sha256']);
const SHERPA_TASKS = new Set([
	'voice-activity-detection', 'speaker-segmentation', 'speaker-embedding',
]);
const ONNX_TASKS = new Set([
	'speech-enhancement', 'face-detection', 'object-detection', 'saliency-detection',
	'optical-character-recognition', 'text-embedding', 'image-text-embedding',
	'word-alignment', 'source-separation', 'audio-tagging', 'beat-tracking',
	'shot-detection', 'dereverberation',
]);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Keep the packaged test's runtime progress admission aligned with production's model mapping. */
export function expectedRuntimeArchiveFileNames(modelId, task) {
	let families;
	if (task === 'speech-recognition') {
		families = [modelId === 'whisper-large-v3-turbo-ggml' ? 'whisper-cpp' : 'sherpa-onnx-node'];
	} else if (SHERPA_TASKS.has(task)) families = ['sherpa-onnx-node'];
	else if (task === 'editorial-generation') families = ['llama-cpp'];
	else if (task === 'text-to-speech') families = ['onnxruntime-node', 'kokoro-g2p'];
	else if (ONNX_TASKS.has(task)) families = ['onnxruntime-node'];
	else throw new TypeError(`No reviewed runtime mapping exists for local model ${modelId}.`);
	return Object.freeze(families.map((familyId) => `${familyId}.tar.gz`));
}

export async function readNightlyPackageIdentity({ payloadRoot, productRoot, productId, target }) {
	assert.ok(isAbsolute(payloadRoot), 'The nightly payload root must be absolute.');
	assert.ok(isAbsolute(productRoot), 'The packaged product root must be absolute.');
	assert.equal(resolve(productRoot), resolve(payloadRoot, 'products'),
		'The packaged product root is detached from the nightly payload.');
	assert.ok(['framescaper', 'soundscaper'].includes(productId), 'The packaged product identity is invalid.');
	assert.ok(typeof target === 'string' && TARGET.test(target), 'The nightly model target is invalid.');
	const fileSystem = await rawFileSystem();
	const stageTarget = stagedTarget(target);
	const nightlyPath = join(payloadRoot, 'stage-manifest.json');
	const productPath = join(productRoot, productId, 'stage-manifest.json');
	const applicationPath = join(productRoot, `${productId}.asar`);
	await assertRegularFile(fileSystem, nightlyPath, 'nightly stage manifest');
	await assertRegularFile(fileSystem, productPath, 'packaged product stage manifest');
	await assertRegularFile(fileSystem, applicationPath, 'packaged product application');
	const [nightlyBytes, productBytes, applicationBytes] = await Promise.all([
		fileSystem.readFile(nightlyPath), fileSystem.readFile(productPath), fileSystem.readFile(applicationPath),
	]);
	const nightly = parseManifest(nightlyBytes, 'nightly stage manifest');
	const product = parseManifest(productBytes, 'packaged product stage manifest');
	assert.equal(nightly.schemaVersion, 1, 'The nightly stage manifest schema is unsupported.');
	assert.equal(nightly.kind, 'soundscaper-desktop-nightly-tests',
		'The nightly stage manifest has the wrong identity.');
	assert.ok(typeof nightly.sourceRevision === 'string' && SOURCE_REVISION.test(nightly.sourceRevision),
		'The nightly stage manifest needs an exact source revision.');
	assert.deepEqual(nightly.target, stageTarget, 'The nightly stage manifest has the wrong target.');
	assert.equal(product.schemaVersion, 1, 'The packaged product stage manifest schema is unsupported.');
	assert.equal(product.productId, productId, 'The packaged product stage manifest has the wrong product.');
	assert.ok(typeof product.applicationVersion === 'string' && product.applicationVersion !== '',
		'The packaged product stage manifest needs an application version.');
	assert.equal(product.sourceRevision, nightly.sourceRevision,
		'The packaged product source revision differs from the nightly source revision.');
	assert.deepEqual(product.target, stageTarget, 'The packaged product stage manifest has the wrong target.');
	return Object.freeze({
		productId,
		applicationVersion: product.applicationVersion,
		sourceRevision: nightly.sourceRevision,
		target,
		application: Object.freeze({ fileName: `${productId}.asar`,
			byteLength: applicationBytes.byteLength, sha256: digest(applicationBytes) }),
		stageManifest: Object.freeze({ fileName: 'stage-manifest.json',
			byteLength: productBytes.byteLength, sha256: digest(productBytes) }),
	});
}

export async function verifyCatalogModelDelivery(model, { fetchImpl = fetch, signal } = {}) {
	assertModel(model);
	return Object.freeze(await Promise.all(model.artifacts.map(async (artifact) => {
		const verified = await verifyMirroredArtifactDelivery({
			url: artifact.url,
			artifact,
			fetchImpl,
			signal,
		});
		return Object.freeze({ fileName: artifact.fileName, ...verified });
	})));
}

export function createModelInstallEvidence({
	model,
	delivery,
	installation,
	packageIdentity,
	checkedAt = new Date().toISOString(),
}) {
	assertModel(model);
	const packageSnapshot = validatePackageIdentity(packageIdentity);
	assert.equal(new Date(checkedAt).toISOString(), checkedAt,
		'The nightly model evidence timestamp must be canonical UTC.');
	assert.deepEqual(delivery, model.artifacts,
		`${model.modelId} public delivery differs from the catalog.`);
	assert.equal(installation?.model?.modelId, model.modelId,
		'The packaged installer returned a different model identity.');
	assert.equal(installation.model.version, model.version,
		'The packaged installer returned a different model version.');
	assert.equal(installation.model.availability, 'installed',
		'The packaged installer did not report an installed model.');
	const installedBytes = model.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0);
	assert.equal(installation.model.installedBytes, installedBytes,
		'The packaged installer returned a different installed byte count.');
	const expectedArtifactSha256s = model.artifacts.map(({ sha256 }) => sha256).toSorted();
	assert.ok(Array.isArray(installation.model.artifactSha256s),
		'The packaged installer returned no installed artifact SHA-256s.');
	const artifactSha256s = [...installation.model.artifactSha256s].toSorted();
	assert.deepEqual(artifactSha256s, expectedArtifactSha256s,
		'The packaged installer installed artifact SHA-256s differ from the catalog.');
	assert.ok(Number.isFinite(installation.elapsedMs) && installation.elapsedMs >= 0,
		'The packaged installer elapsed time is invalid.');
	assert.ok(Array.isArray(installation.artifacts), 'The packaged installer progress is invalid.');
	const runtimeFileNames = new Set(expectedRuntimeArchiveFileNames(model.modelId, model.task));
	const progress = [];
	const runtimeProgress = [];
	for (const event of installation.artifacts) {
		const artifact = model.artifacts.find(({ fileName }) => fileName === event?.fileName);
		assert.ok((artifact || runtimeFileNames.has(event?.fileName)) && event.modelId === model.modelId,
			'The packaged installer reported progress for a foreign artifact.');
		if (!artifact) {
			assert.ok(Number.isSafeInteger(event.totalBytes) && event.totalBytes > 0
				&& event.completedBytes === event.totalBytes,
				'The packaged installer did not finish a required runtime archive transfer.');
			runtimeProgress.push(Object.freeze({
				modelId: event.modelId, fileName: event.fileName,
				completedBytes: event.completedBytes, totalBytes: event.totalBytes,
			}));
			continue;
		}
		assert.equal(event.totalBytes, artifact.byteLength,
			'The packaged installer progress differs from the catalog byte count.');
		assert.equal(event.completedBytes, artifact.byteLength,
			'The packaged installer did not finish a reported artifact transfer.');
		progress.push(Object.freeze({
			modelId: event.modelId,
			fileName: event.fileName,
			completedBytes: event.completedBytes,
			totalBytes: event.totalBytes,
		}));
	}
	assert.equal(new Set(progress.map(({ fileName }) => fileName)).size, progress.length,
		'The packaged installer reported duplicate artifact progress.');
	assert.equal(new Set(runtimeProgress.map(({ fileName }) => fileName)).size, runtimeProgress.length,
		'The packaged installer reported duplicate runtime progress.');
	assert.deepEqual(progress.map(({ fileName }) => fileName).toSorted(),
		model.artifacts.map(({ fileName }) => fileName).toSorted(),
		'The packaged installer artifact filename set differs from the catalog.');
	return Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-nightly-local-model-install',
		checkedAt,
		sourceRevision: packageSnapshot.sourceRevision,
		modelId: model.modelId,
		version: model.version,
		target: packageSnapshot.target,
		package: packageSnapshot,
		checks: CHECKS,
		artifacts: delivery,
		installation: Object.freeze({
			availability: 'installed',
			installedBytes,
			elapsedMs: installation.elapsedMs,
			artifactSha256s: Object.freeze(artifactSha256s),
			progress: Object.freeze(progress),
			runtimeProgress: Object.freeze(runtimeProgress),
		}),
	});
}

function validatePackageIdentity(value) {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value),
		'The nightly package identity must be a record.');
	assert.deepEqual(Object.keys(value).toSorted(), PACKAGE_IDENTITY_FIELDS,
		'The nightly package identity has unexpected fields.');
	assert.ok(['framescaper', 'soundscaper'].includes(value.productId),
		'The nightly package identity has an invalid product.');
	assert.ok(typeof value.applicationVersion === 'string' && value.applicationVersion !== '',
		'The nightly package identity has an invalid application version.');
	assert.ok(typeof value.sourceRevision === 'string' && SOURCE_REVISION.test(value.sourceRevision),
		'The nightly package identity has an invalid source revision.');
	assert.ok(typeof value.target === 'string' && TARGET.test(value.target),
		'The nightly package identity has an invalid target.');
	const application = validatePackageFile(value.application, `${value.productId}.asar`, 'application');
	const stageManifest = validatePackageFile(value.stageManifest, 'stage-manifest.json', 'stage manifest');
	return Object.freeze({ productId: value.productId, applicationVersion: value.applicationVersion,
		sourceRevision: value.sourceRevision, target: value.target, application, stageManifest });
}

function validatePackageFile(value, fileName, label) {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value),
		`The nightly package ${label} identity must be a record.`);
	assert.deepEqual(Object.keys(value).toSorted(), PACKAGE_FILE_FIELDS,
		`The nightly package ${label} identity has unexpected fields.`);
	assert.equal(value.fileName, fileName, `The nightly package ${label} has the wrong file name.`);
	assert.ok(Number.isSafeInteger(value.byteLength) && value.byteLength > 0,
		`The nightly package ${label} has an invalid byte length.`);
	assert.ok(typeof value.sha256 === 'string' && SHA256.test(value.sha256),
		`The nightly package ${label} has an invalid SHA-256.`);
	return Object.freeze({ fileName, byteLength: value.byteLength, sha256: value.sha256 });
}

function stagedTarget(target) {
	const [platform, arch] = target.split('-');
	return Object.freeze({ platform: { darwin: 'mac', linux: 'linux', win32: 'win' }[platform], arch });
}

async function assertRegularFile(fileSystem, path, label) {
	const metadata = await fileSystem.lstat(path);
	assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `The ${label} must be a regular file.`);
}

async function rawFileSystem() {
	if (!process.versions.electron) return { lstat, readFile };
	// Electron's patched fs exposes an ASAR as a virtual directory. Identity
	// evidence needs the archive file itself so its exact packaged bytes are hashed.
	return (await import('node:original-fs')).promises;
}

function parseManifest(bytes, label) {
	let value;
	try { value = JSON.parse(bytes.toString('utf8')); }
	catch (error) { throw new Error(`The ${label} is not valid JSON.`, { cause: error }); }
	assert.ok(value && typeof value === 'object' && !Array.isArray(value),
		`The ${label} must be a record.`);
	return value;
}

function assertModel(model) {
	assert.ok(model && typeof model.modelId === 'string' && model.modelId !== '',
		'Nightly model evidence needs a model identity.');
	assert.ok(typeof model.version === 'string' && model.version !== '',
		'Nightly model evidence needs a model version.');
	assert.ok(Array.isArray(model.artifacts) && model.artifacts.length > 0,
		'Nightly model evidence needs catalog artifacts.');
	for (const artifact of model.artifacts) {
		assert.ok(typeof artifact?.fileName === 'string'
			&& /^[A-Za-z\d][A-Za-z\d._-]*$/u.test(artifact.fileName),
			'Nightly model evidence needs a plain artifact file name.');
	}
}

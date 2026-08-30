#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalJson } from './lib/canonical-json.mjs';
import {
	resolveProductApplicationVersion,
	resolveProductDesktopMetadata,
	validateProductReleaseLines,
} from './lib/product-release-lines.mjs';
import { runSoundscaperStable1ReleaseAdmissionCli } from
	'./check-soundscaper-stable-1-release-admission.mjs';
import { validateSoundscaperStable1ReleaseCandidateIdentity } from
	'./lib/soundscaper-stable-1-release-admission.mjs';

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCUMENT_PATHS = Object.freeze({
	releaseLines: 'config/product-release-lines.json',
	packageMetadata: 'package.json',
	packageLock: 'package-lock.json',
	desktopProduct: 'desktop/product.json',
	productionCapabilities: 'config/production-capabilities.json',
	productionSecurityMatrix: 'config/production-security-matrix.json',
	ffmpegRuntimeManifest: 'config/ffmpeg-runtime-manifest.json',
});
const REPLACEMENT_ORDER = Object.freeze([
	'packageMetadata', 'packageLock', 'desktopProduct', 'productionCapabilities',
	'productionSecurityMatrix', 'ffmpegRuntimeManifest', 'releaseLines',
]);
const PREPARED_MARKER = '.soundscaper-stable-1-promotion-prepared';
const COMMITTED_MARKER = '.soundscaper-stable-1-promotion-committed';
const DEFAULT_FILE_SYSTEM = Object.freeze({ copyFile, rename, unlink, writeFile });
const execFileAsync = promisify(execFile);

export function createSoundscaperStable1Promotion(documents, admission) {
	if (admission?.admitted !== true) {
		throw new Error('Soundscaper Stable 1 is not admitted; version metadata was not promoted.');
	}
	const candidate = validateSoundscaperStable1ReleaseCandidateIdentity(admission.releaseCandidate);
	if (!documents || typeof documents !== 'object' || Array.isArray(documents)) {
		throw new TypeError('Soundscaper Stable 1 promotion documents are invalid.');
	}
	const currentReleaseLines = validateProductReleaseLines(documents.releaseLines);
	const soundscaper = currentReleaseLines.products.soundscaper;
	if (soundscaper.stable.version !== '1.0.0'
		|| soundscaper.stable.admissionProfile !== 'soundscaper-stable-1') {
		throw new Error('The Soundscaper Stable 1 release authority is not the declared 1.0.0 line.');
	}
	const currentVersion = resolveProductApplicationVersion('soundscaper', currentReleaseLines);
	if (candidate.version !== soundscaper.candidate.version) {
		throw new Error('The admitted release candidate does not match the Soundscaper release authority.');
	}
	assertPackageDocuments(documents.packageMetadata, documents.packageLock, currentVersion);
	const currentDesktopProduct = resolveProductDesktopMetadata('soundscaper', currentReleaseLines);
	if (JSON.stringify(documents.desktopProduct) !== JSON.stringify(currentDesktopProduct)) {
		throw new Error('The checked-in Soundscaper desktop product metadata is not synchronized.');
	}
	assertCandidateRegisters(documents, soundscaper);

	const releaseLines = structuredClone(currentReleaseLines);
	releaseLines.products.soundscaper.stable.status = 'admitted';
	releaseLines.products.soundscaper.applicationVersionChannel = 'stable';
	releaseLines.products.soundscaper.releaseChannel = 'stable';
	const validatedReleaseLines = validateProductReleaseLines(releaseLines);
	const stableVersion = resolveProductApplicationVersion('soundscaper', validatedReleaseLines);
	const packageMetadata = structuredClone(documents.packageMetadata);
	const packageLock = structuredClone(documents.packageLock);
	packageMetadata.version = stableVersion;
	packageLock.version = stableVersion;
	packageLock.packages[''].version = stableVersion;
	const productionCapabilities = structuredClone(documents.productionCapabilities);
	productionCapabilities.products.soundscaper.release.channel = 'stable';
	productionCapabilities.products.soundscaper.release.admissionStatus = 'admitted';
	const productionSecurityMatrix = structuredClone(documents.productionSecurityMatrix);
	productionSecurityMatrix.releaseCandidate = {
		version: soundscaper.candidate.version,
		stableVersion,
		stable1Admission: 'admitted',
	};
	const ffmpegRuntimeManifest = repinSecurityMatrix(
		documents.ffmpegRuntimeManifest, productionSecurityMatrix,
	);
	return Object.freeze({
		releaseLines: structuredClone(validatedReleaseLines),
		packageMetadata,
		packageLock,
		desktopProduct: structuredClone(resolveProductDesktopMetadata('soundscaper', validatedReleaseLines)),
		productionCapabilities,
		productionSecurityMatrix,
		ffmpegRuntimeManifest,
	});
}

export function validateSoundscaperStable1PromotionSource(admission, sourceCommitSha) {
	if (admission?.admitted !== true) throw new Error('Soundscaper Stable 1 is not admitted.');
	const candidate = validateSoundscaperStable1ReleaseCandidateIdentity(admission.releaseCandidate);
	if (sourceCommitSha !== candidate.commitSha) {
		throw new Error('Stable 1 source is not the exact admitted release-candidate commit and tree.');
	}
	return candidate;
}

export async function promoteSoundscaperStable1(options = {}) {
	const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
	const runAdmission = options.runAdmission ?? runAdmissionGate;
	const writeOutput = options.writeOutput ?? ((value) => process.stdout.write(value));
	const fileSystem = { ...DEFAULT_FILE_SYSTEM, ...options.fileSystem };
	if (typeof runAdmission !== 'function' || typeof writeOutput !== 'function') {
		throw new TypeError('Soundscaper Stable 1 promotion dependencies are invalid.');
	}
	await recoverPromotionDocuments(repositoryRoot, fileSystem);
	const admission = await runAdmission();
	if (admission?.admitted !== true) {
		throw new Error('Soundscaper Stable 1 is not admitted; no version files were changed.');
	}
	const resolveSourceCommit = options.resolveSourceCommit ?? resolveRepositoryHead;
	if (typeof resolveSourceCommit !== 'function') {
		throw new TypeError('The Soundscaper Stable 1 source resolver is invalid.');
	}
	const sourceCommit = options.expectedSourceCommit
		?? await resolveSourceCommit(repositoryRoot);
	validateSoundscaperStable1PromotionSource(admission, sourceCommit);
	const documents = await readDocuments(repositoryRoot);
	const promoted = createSoundscaperStable1Promotion(documents, admission);
	await replaceDocuments(repositoryRoot, promoted, fileSystem);
	writeOutput('Soundscaper Stable 1 metadata promoted to 1.0.0; the admitted tag is v1.0.0.\n');
	return promoted;
}

async function runAdmissionGate() {
	let output = '';
	const exitCode = await runSoundscaperStable1ReleaseAdmissionCli(['--json'], {
		writeOutput: (value) => { output += value; },
	});
	const result = JSON.parse(output);
	if (exitCode !== 0 || result?.admitted !== true) return { admitted: false };
	return result;
}

async function resolveRepositoryHead(repositoryRoot) {
	const { stdout } = await execFileAsync(
		'git', ['rev-parse', '--verify', 'HEAD^{commit}'],
		{ cwd: repositoryRoot, encoding: 'utf8' },
	);
	const commit = stdout.trim();
	if (!/^[a-f0-9]{40}$/u.test(commit)) {
		throw new Error('The current Soundscaper source commit could not be authenticated.');
	}
	return commit;
}

async function readDocuments(repositoryRoot) {
	const entries = await Promise.all(Object.entries(DOCUMENT_PATHS).map(async ([name, path]) => [
		name, JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8')),
	]));
	return Object.fromEntries(entries);
}

async function replaceDocuments(repositoryRoot, documents, fileSystem) {
	const preparedMarker = resolve(repositoryRoot, PREPARED_MARKER);
	const committedMarker = resolve(repositoryRoot, COMMITTED_MARKER);
	const staged = replacementEntries(repositoryRoot);
	await fileSystem.writeFile(preparedMarker, 'prepared\n', {
		encoding: 'utf8', flag: 'wx', mode: 0o600,
	});
	let committed = false;
	try {
		for (const { name, temporary } of staged) {
			await fileSystem.writeFile(temporary, `${JSON.stringify(documents[name], null, '\t')}\n`, {
				encoding: 'utf8', flag: 'wx', mode: 0o600,
			});
		}
		for (const { target, backup } of staged) {
			await fileSystem.copyFile(target, backup, constants.COPYFILE_EXCL);
		}
		for (const { target, temporary } of staged) await fileSystem.rename(temporary, target);
		await fileSystem.rename(preparedMarker, committedMarker);
		committed = true;
		await cleanupReplacementFiles(staged, fileSystem);
		await fileSystem.unlink(committedMarker);
	} catch (error) {
		if (committed) throw error;
		const rollbackErrors = [];
		await rollbackReplacement(staged, preparedMarker, fileSystem).catch((rollbackError) => {
			rollbackErrors.push(rollbackError);
		});
		if (rollbackErrors.length > 0) {
			throw new AggregateError(rollbackErrors,
				'Soundscaper Stable 1 promotion failed and could not be rolled back completely.',
				{ cause: error });
		}
		throw error;
	}
}

async function recoverPromotionDocuments(repositoryRoot, fileSystem) {
	await recoverInterruptedReplacement(
		replacementEntries(repositoryRoot),
		resolve(repositoryRoot, PREPARED_MARKER),
		resolve(repositoryRoot, COMMITTED_MARKER),
		fileSystem,
	);
}

function replacementEntries(repositoryRoot) {
	return REPLACEMENT_ORDER.map((name) => {
		const target = resolve(repositoryRoot, DOCUMENT_PATHS[name]);
		return {
			name,
			target,
			temporary: `${target}.stable-promotion-stage`,
			backup: `${target}.stable-promotion-backup`,
		};
	});
}

async function recoverInterruptedReplacement(staged, preparedMarker, committedMarker, fileSystem) {
	const [prepared, committed] = await Promise.all([
		pathExists(preparedMarker), pathExists(committedMarker),
	]);
	if (prepared && committed) {
		throw new Error('Soundscaper Stable 1 promotion has conflicting transaction markers.');
	}
	if (prepared) await rollbackReplacement(staged, preparedMarker, fileSystem);
	if (committed) {
		await cleanupReplacementFiles(staged, fileSystem);
		await fileSystem.unlink(committedMarker);
	}
}

async function rollbackReplacement(staged, preparedMarker, fileSystem) {
	const errors = [];
	for (const { target, backup } of staged) {
		if (!await pathExists(backup)) continue;
		await fileSystem.copyFile(backup, target).catch((error) => errors.push(error));
	}
	if (errors.length > 0) throw new AggregateError(errors, 'Stable 1 metadata rollback failed.');
	await cleanupReplacementFiles(staged, fileSystem);
	await fileSystem.unlink(preparedMarker);
}

async function cleanupReplacementFiles(staged, fileSystem) {
	for (const { temporary, backup } of staged) {
		await ignoreMissing(fileSystem.unlink(temporary));
		await ignoreMissing(fileSystem.unlink(backup));
	}
}

async function pathExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

async function ignoreMissing(operation) {
	try {
		await operation;
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
}

function assertCandidateRegisters(documents, soundscaper) {
	const release = documents.productionCapabilities?.products?.soundscaper?.release;
	if (release?.softwareStatus !== 'feature-complete' || release.channel !== 'candidate'
		|| release.candidateVersion !== soundscaper.candidate.version
		|| release.stableTarget !== soundscaper.stable.version
		|| release.admissionProfile !== soundscaper.stable.admissionProfile
		|| release.admissionStatus !== 'pending-external-evidence') {
		throw new Error('The Soundscaper production capability candidate register is inconsistent.');
	}
	const security = documents.productionSecurityMatrix?.releaseCandidate;
	if (security?.version !== soundscaper.candidate.version
		|| security.stable1Admission !== 'blocked-on-remaining-milestone-9-evidence') {
		throw new Error('The Soundscaper production security candidate register is inconsistent.');
	}
	const manifest = documents.ffmpegRuntimeManifest;
	const securityBytes = Buffer.from(`${JSON.stringify(documents.productionSecurityMatrix, null, '\t')}\n`);
	const reviewPayload = manifest === null || typeof manifest !== 'object'
		? null : Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'review'));
	if (manifest?.evidence?.securityMatrix?.byteLength !== securityBytes.byteLength
		|| manifest.evidence.securityMatrix.sha256 !== sha256(securityBytes)
		|| manifest.review?.payloadSha256 !== sha256(Buffer.from(canonicalJson(reviewPayload)))) {
		throw new Error('The candidate security register evidence pins are stale.');
	}
}

function repinSecurityMatrix(manifestValue, securityMatrix) {
	const manifest = structuredClone(manifestValue);
	const bytes = Buffer.from(`${JSON.stringify(securityMatrix, null, '\t')}\n`);
	manifest.evidence.securityMatrix.byteLength = bytes.byteLength;
	manifest.evidence.securityMatrix.sha256 = sha256(bytes);
	const payload = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'review'));
	manifest.review.payloadSha256 = sha256(Buffer.from(canonicalJson(payload)));
	return manifest;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
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

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	const arguments_ = process.argv.slice(2);
	let admissionPath = null;
	let expectedSourceCommit;
	for (let index = 0; index < arguments_.length; index += 1) {
		if (arguments_[index] === '--admission-json') admissionPath = arguments_[index += 1] ?? null;
		else if (arguments_[index] === '--expected-source-commit') {
			expectedSourceCommit = arguments_[index += 1];
		} else throw new Error(`Unexpected argument: ${arguments_[index]}`);
	}
	if ((admissionPath === null) !== (expectedSourceCommit === undefined)) {
		throw new Error('--admission-json and --expected-source-commit must be supplied together.');
	}
	const options = admissionPath === null ? {} : {
		runAdmission: async () => JSON.parse(await readFile(resolve(admissionPath), 'utf8')),
		expectedSourceCommit,
	};
	promoteSoundscaperStable1(options).catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

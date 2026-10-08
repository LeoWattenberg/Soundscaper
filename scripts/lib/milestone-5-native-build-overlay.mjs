/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit CI build receipts may overlay only the committed professional payload template. */
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	canonicalDirectory, canonicalJson, canonicalRegularFile, regularFileInventory, sha256,
	buildResultDescriptors, soundscaperProfessionalNativeSourceIdsForTarget, verificationFor,
} from './soundscaper-professional-native-build-result-contract.mjs';
import {
	stageSoundscaperProfessionalNativeBuildResult, stagedManifestRow,
	STAGED_BUILD_RESULT_RECEIPT_NAME, verifySoundscaperProfessionalNativeBuildResult,
	verifyStagedBuildResultDirectory,
} from './soundscaper-professional-native-build-result.mjs';
import { assertSoundscaperProfessionalNativeBuildSourceRevision }
	from './soundscaper-professional-native-build-source.mjs';
import { MILESTONE_5_TARGETS } from './milestone-5-product-scope.mjs';

const MANIFEST_PATH = 'config/soundscaper-professional-native-payload-manifest.json';
const SOURCES_PATH = 'config/milestone-5-native-source-acquisitions.json';
const RESULT_PREFIX = 'soundscaper-professional-native-build-result-';

export async function stageProfessionalNativeBuildResultSet({ repositoryRoot, resultsRoot }) {
	const results = await verifiedResults(resultsRoot);
	if (results.length !== MILESTONE_5_TARGETS.length) throw new Error('CI native staging requires all five build results.');
	const output = [];
	for (const result of results) output.push(await stageSoundscaperProfessionalNativeBuildResult({
		repositoryRoot, buildResultRoot: result.buildResultRoot,
	}));
	return output;
}

export async function authenticateProfessionalNativeBuildOverlay({ repositoryRoot, sourceRevision, resultsRoot }) {
	assertSoundscaperProfessionalNativeBuildSourceRevision(repositoryRoot, sourceRevision);
	const results = await verifiedResults(resultsRoot);
	const templateBytes = gitBlob(repositoryRoot, sourceRevision, MANIFEST_PATH);
	const expected = JSON.parse(String(templateBytes));
	const sources = JSON.parse(String(gitBlob(repositoryRoot, sourceRevision, SOURCES_PATH)));
	const generatedPaths = new Set([MANIFEST_PATH]);
	for (const result of results) {
		if (result.receipt.sourceRevision !== sourceRevision) throw new Error('A native build overlay receipt has another source revision.');
		const target = result.receipt.target;
		const index = expected.targets.findIndex((entry) => entry.id === target);
		if (index < 0 || expected.targets[index].status !== 'ci-generated') {
			throw new Error('A native build overlay requires an exact committed CI-generated target.');
		}
		assertPinnedSources(result.receipt, sources);
		const prefix = `native/soundscaper-professional-host/prebuilt/${target}`;
		const receiptPath = `${prefix}/${STAGED_BUILD_RESULT_RECEIPT_NAME}`;
		expected.targets[index] = stagedManifestRow(result.receipt, prefix, {
			path: receiptPath, byteLength: result.receiptBytes.byteLength, sha256: result.receiptSha256,
		});
		await verifyStagedBuildResultDirectory(resolve(repositoryRoot, prefix), result);
		const expectedFiles = [STAGED_BUILD_RESULT_RECEIPT_NAME,
			...buildResultDescriptors(result.receipt).map(({ path }) => path.slice('payload/'.length))].sort();
		if (JSON.stringify(await regularFileInventory(resolve(repositoryRoot, prefix))) !== JSON.stringify(expectedFiles)) {
			throw new Error('A native build overlay staged inventory is not closed.');
		}
		for (const path of expectedFiles) generatedPaths.add(`${prefix}/${path}`);
	}
	const manifestBytes = await canonicalRegularFile(resolve(repositoryRoot, MANIFEST_PATH), 'native build overlay manifest');
	if (!manifestBytes.equals(canonicalJson(expected))) throw new Error('The native build overlay is not the exact generated manifest.');
	assertGeneratedWorktree(repositoryRoot, generatedPaths);
	return {
		manifestBytes,
		sourceBinding: Object.freeze({ status: 'verified-head-native-build-overlay', sourceRevision,
			buildResultOverlay: Object.freeze({ manifestPath: MANIFEST_PATH,
				committedManifestSha256: sha256(templateBytes), manifestSha256: sha256(manifestBytes),
				targets: Object.freeze(results.map(({ receipt, receiptSha256 }) => Object.freeze({
					target: receipt.target, receiptSha256,
				}))),
			}),
		}),
	};
}

async function verifiedResults(rootValue) {
	const root = await canonicalDirectory(rootValue, 'native build-result set');
	const entries = await readdir(root, { withFileTypes: true });
	if (entries.length < 1 || entries.length > MILESTONE_5_TARGETS.length) throw new Error('A native build-result set has invalid target inventory.');
	const results = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
		const target = entry.name.slice(RESULT_PREFIX.length);
		if (!entry.name.startsWith(RESULT_PREFIX) || !MILESTONE_5_TARGETS.includes(target)
			|| !entry.isDirectory() || entry.isSymbolicLink()) throw new Error('A native build-result set contains an unsupported target.');
		const verified = await verifySoundscaperProfessionalNativeBuildResult({ buildResultRoot: resolve(root, entry.name) });
		if (verified.receipt.target !== target) throw new Error('A native build-result set target is misbound.');
		results.push(verified);
	}
	return results;
}

function assertGeneratedWorktree(root, allowed) {
	const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
		{ cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	for (const record of status.split('\0').filter(Boolean)) {
		const path = record.slice(3);
		if (!allowed.has(path) || (path === MANIFEST_PATH ? record.slice(0, 2) !== ' M' : record.slice(0, 2) !== '??')) {
			throw new Error('A native build overlay cannot authorize other worktree or index changes.');
		}
	}
}

function assertPinnedSources(receipt, register) {
	const authenticated = verificationFor(receipt, 'source-authentication').authentication.sources;
	const ids = soundscaperProfessionalNativeSourceIdsForTarget(receipt.target);
	for (const id of ids) {
		const entry = authenticated.find((source) => source.id === id);
		const pinned = register.sources.filter((source) => source.id === id);
		if (pinned.length !== 1 || entry.archiveEvidence.byteLength !== pinned[0].archive.byteLength
			|| entry.archiveEvidence.sha256 !== pinned[0].archive.sha256
			|| JSON.stringify(entry.extractedTreeEvidence) !== JSON.stringify(pinned[0].extractedTree)) {
			throw new Error('A native build overlay source receipt disagrees with the committed source pin.');
		}
	}
}

function gitBlob(root, revision, path) {
	return execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
}

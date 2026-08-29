/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

const EXPECTED_ACCEPTED_COHORT = {
	id: 'hosted-ci-family-v1-lease-matrix-e7c76c70',
	acceptedAt: '2026-08-29',
	runId: 33_261_286_048,
	runUrl: 'https://github.com/LeoWattenberg/Soundscaper/actions/runs/33261286048',
	sourceRevision: 'e7c76c7013f94f14834c13a5fa25c261cd754627',
	attemptCount: 1,
	retryCount: 0,
	enclosingRunConclusion: 'failure',
	scopeDisposition: 'accepted-five-successful-lease-matrix-jobs-only-unrelated-packaging-failure-excluded',
	retention: 'hosted-run-artifacts-with-checked-in-byte-length-and-sha256',
	resultSchemaVersion: 1,
	resultMode: 'project-library-lease-matrix-v1',
	workflowCount: 8,
	caseCountPerTarget: 15,
	artifacts: [
		{
			targetId: 'windows-x64',
			jobId: 99_125_946_674,
			artifactId: 9_717_648_019,
			artifactName: 'soundscaper-v1-framescaper-v1-lease-matrix-win-x64',
			archiveByteLength: 1_290,
			archiveSha256: 'c57ae77e05ef29b6277f634567ec2468450a5a8ef0525b62743e5a5583419866',
			resultByteLength: 4_152,
			resultSha256: 'bd27fe7335e2006bcc197bae22f4ab270f16d6a93e3b9754ca8ec59b0df65e32',
		},
		{
			targetId: 'windows-arm64',
			jobId: 99_125_946_663,
			artifactId: 9_717_722_269,
			artifactName: 'soundscaper-v1-framescaper-v1-lease-matrix-win-arm64',
			archiveByteLength: 1_297,
			archiveSha256: 'f6aeaa5d81aa3f06e1faff58951b04054ac6724c9f616beac917bdbd81820914',
			resultByteLength: 4_154,
			resultSha256: '77e4aceecc785207c6d97d87ff09dabc3dd4af23d3097a092b375403616f2778',
		},
		{
			targetId: 'macos-arm64',
			jobId: 99_125_946_656,
			artifactId: 9_717_635_037,
			artifactName: 'soundscaper-v1-framescaper-v1-lease-matrix-mac-arm64',
			archiveByteLength: 1_295,
			archiveSha256: 'ce3f90f61904faf712376b60d7ba2569268673a44c2c5944602699276bf39e93',
			resultByteLength: 4_155,
			resultSha256: 'fe52b5d24a3208159b9289e77c747c1c5225ab81532169dff10d4ede108de332',
		},
		{
			targetId: 'linux-x64',
			jobId: 99_125_946_681,
			artifactId: 9_717_617_341,
			artifactName: 'soundscaper-v1-framescaper-v1-lease-matrix-linux-x64',
			archiveByteLength: 1_298,
			archiveSha256: '90f84ee8de0f3cd57f66f9597c1540858de479a20317624458c83e91ecfebe73',
			resultByteLength: 4_152,
			resultSha256: '90015fb25a07e69080ee3fdbe94990c02a065af5ba95f8f32553634a1e722a05',
		},
		{
			targetId: 'linux-arm64',
			jobId: 99_125_946_654,
			artifactId: 9_717_612_971,
			artifactName: 'soundscaper-v1-framescaper-v1-lease-matrix-linux-arm64',
			archiveByteLength: 1_299,
			archiveSha256: '7e5d1eff66247db4c94a5545ef377a2c8364e270e151cecc79fec1135416af5c',
			resultByteLength: 4_154,
			resultSha256: 'cf74d3d93a748884dc2554713adbf8953be5ec5e434896efb063ad679db6e388',
		},
	],
};

test('family-v1 desktop lease controls are isolated and qualified on every maintained target', async () => {
	const [compatibility, security, closure] = await Promise.all([
		json('config/project-compatibility.json'),
		json('config/production-security-matrix.json'),
		json('config/milestone-2-closure.json'),
	]);
	const rule = compatibility.rules.find(({ id }) => id === 'current-desktop-electron-lease-protections');
	assert.equal(rule.status, 'implemented');
	assert.match(rule.currentBehavior, /distinct roots.*application IDs.*user_version 1.*v1 IPC namespaces.*monotonic lease tokens/iu);
	assert.match(rule.currentBehavior, /No pre-release library is opened, copied forward, enumerated, mutated, or deleted/iu);
	assert.match(rule.currentBehavior, /accepted packaged matrix.*all five maintained desktop targets/iu);
	assert.match(rule.currentBehavior, /stable 1\.0.*Milestone 9.*remain(?:s)? separate.*blocked/iu);

	const controls = new Map(security.risks.flatMap(({ currentControls }) => currentControls.map((control) => [control.id, control])));
	const isolation = controls.get('family-v1-desktop-library-isolation');
	const leaseMatrix = controls.get('packaged-cross-platform-electron-lease-matrix');
	assert.match(isolation.summary, /exact family-v1 handshakes.*user_version 1.*product-qualified IPC namespaces/iu);
	assert.match(isolation.summary, /without any pre-release importer or copy-forward chain/iu);
	assert.match(leaseMatrix.summary, /renewable process-lifetime.*writer lease.*monotonic fencing token/iu);
	assert.match(leaseMatrix.summary, /reviewed no-retry cohort.*run 33261286048.*all five maintained targets/iu);
	assert.match(leaseMatrix.summary, /unrelated.*packaging.*outside.*accepted scope.*Milestone 9.*separate/iu);

	const item = closure.items.find(({ id }) => id === 'm2-electron-lease-matrix');
	assert.equal(item.status, 'implemented');
	assert.deepEqual(item.completedWorkflowIds, item.workflowIds);
	assert.deepEqual(item.qualifiedDesktopTargets, closure.testActivation.desktopTargets);
	assert.equal(item.acceptedResultCohortId, EXPECTED_ACCEPTED_COHORT.id);
	assert.deepEqual(leaseMatrix.acceptedResultCohort, EXPECTED_ACCEPTED_COHORT);
});

test('capability inventory names only current family-v1 desktop owners', async () => {
	const capabilities = await json('config/production-capabilities.json');
	for (const [family, expected] of Object.entries({
		soundscaper: [
			'desktop/soundscaper-project-library-contract.ts',
			'desktop/soundscaper-project-library-main.ts',
			'src/soundscaper/editor-project.ts',
		],
		framescaper: [
			'desktop/framescaper-project-library-contract.ts',
			'desktop/framescaper-project-library-main.ts',
			'src/framescaper/editor-project.ts',
			'desktop/framescaper-baseline-artifact-smoke.js',
		],
	})) {
		const product = capabilities.products[family];
		assert.deepEqual(product.projectSchemaIdentity, {
			schemaFamily: family,
			schemaVersion: 1,
			evidence: product.projectSchemaIdentity.evidence,
		});
		const evidence = product.platforms['electron-enhanced'].evidence;
		for (const path of expected) assert.ok(evidence.includes(path), `${family}: ${path}`);
		assert.doesNotMatch(JSON.stringify(evidence), /(?:soundscaper-project-library-v1[01]|project-library-v(?:10|1[2-9]|20)|framescaper-v(?:18|20|27)-artifact)/u);
	}
});

test('lease workflow retains every maintained target while stable human evidence remains pending', async () => {
	const workflow = await text('.github/workflows/desktop-preview.yml');
	const start = workflow.indexOf('\n  soundscaper-project-library-lease-matrix:');
	const job = workflow.slice(start);
	for (const { runner, platform, arch } of [
		{ runner: 'windows-2025', platform: 'win', arch: 'x64' },
		{ runner: 'windows-11-arm', platform: 'win', arch: 'arm64' },
		{ runner: 'macos-15', platform: 'mac', arch: 'arm64' },
		{ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64' },
		{ runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
	]) assert.match(job, new RegExp(`runner: ${runner}\\n\\s+platform: ${platform}\\n\\s+arch: ${arch}`, 'u'));

	const compatibility = await json('config/project-compatibility.json');
	assert.equal(compatibility.baselineDecision.stableReleaseAdmission, 'blocked-on-remaining-milestone-9-evidence');
	const verification = await text('docs/milestone-9-guided-verification.md');
	assert.match(verification, /Stable 1\.0 release conclusion \| pending/iu);
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}

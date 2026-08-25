/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	MILESTONE_5_PACKAGE_CELLS,
	aggregateMilestone5HandoffMatrix,
	assembleMilestone5HandoffMatrix,
	auditMilestone5HandoffMatrixDirectory,
} from '../scripts/lib/milestone-5-handoff-matrix.mjs';

const REVISION = 'a'.repeat(40);
const QUALIFICATION_REVISION = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);
const VERSION = '0.2.0-beta.1';
const WORKLOAD_IDS = [
	'm5-native-helper-and-audio',
	'm5b-native-media-plan-parity-and-decode',
	'm5b-professional-media-tier',
	'm5b-persistent-services-recovery',
	'm5b-clean-external-display',
	'm5b-openfx-isolation-and-packaging',
];
const INPUT_PATHS = [
	'config/quality-budgets.json',
	'config/production-licensing-matrix.json',
	'config/milestone-5-native-source-acquisitions.json',
	'config/milestone-5-package-release-authentication-policy.json',
	'config/milestone-5-native-isolation-review-policy.json',
	'config/milestone-5-qualification-evidence.json',
	'config/native-addon-payload-manifest.json',
	'config/soundscaper-professional-native-payload-manifest.json',
	'config/framescaper-media-host-payload-manifest.json',
	'config/framescaper-openfx-host-payload-manifest.json',
	'config/boost-multiprecision-source-manifest.json',
	'native/framescaper-media-host/source-manifest.json',
	'native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json',
	'native/framescaper-openfx-host/source-manifest.json',
	'vendor/pipewire-headers/UPSTREAM',
];

test('serialized cells can be validated but cannot claim milestone readiness', () => {
	const pending = aggregateMilestone5HandoffMatrix(
		MILESTONE_5_PACKAGE_CELLS.map((identity) => cell(identity)),
	);
	assert.equal(pending.schemaVersion, 2);
	assert.equal(pending.matrixInputsAuthenticated, false);
	assert.equal(pending.engineeringEvidenceAuthenticated, false);
	assert.equal(pending.milestoneReleaseReady, null);
	assert.equal(pending.status, 'unattributed-serialized-cells');
	assert.equal(pending.cells.length, 10);
	assert.equal(pending.blockers.length, 2);
	assert.ok(pending.blockers.every(({ cells }) => (
		JSON.stringify(cells) === JSON.stringify(MILESTONE_5_PACKAGE_CELLS.map(
			({ productId, targetId }) => `${productId}:${targetId}`,
		))
	)));

	const ready = aggregateMilestone5HandoffMatrix(
		MILESTONE_5_PACKAGE_CELLS.map((identity) => cell(identity, true)),
	);
	assert.equal(ready.matrixInputsAuthenticated, false);
	assert.equal(ready.milestoneReleaseReady, null);
	assert.equal(ready.status, 'unattributed-serialized-cells');
	assert.deepEqual(ready.blockers, []);
	assert.equal(ready.sourceRevision, REVISION);
	assert.equal(ready.qualificationSourceRevision, QUALIFICATION_REVISION);
	assert.equal(ready.applicationVersion, VERSION);
});

test('matrix aggregation rejects missing, duplicate, drifted, or unauthenticated cells', () => {
	for (const mutate of [
		(cells) => cells.pop(),
		(cells) => { cells[9] = structuredClone(cells[0]); },
		(cells) => { cells[4].sourceRevision = 'd'.repeat(40); },
		(cells) => { cells[4].packageEvidence.applicationVersion = '9.9.9'; },
		(cells) => { cells[4].inputDigests['config/quality-budgets.json'].sha256 = 'e'.repeat(64); },
		(cells) => { cells[4].assemblyInputsAuthenticated = false; },
		(cells) => { cells[4].sourceRevisionBinding.status = 'unattributed-working-tree'; },
		(cells) => { delete cells[4].inputDigests[packageDigestKey(cells[4], cells[4].packageEvidence.packages[0].name)]; },
	]) {
		const cells = MILESTONE_5_PACKAGE_CELLS
			.map((identity) => cell(identity))
			.map((value) => structuredClone(value));
		mutate(cells);
		assert.throws(() => aggregateMilestone5HandoffMatrix(cells), /matrix|cell|source|version|digest|authenticated|package/iu);
	}
});

test('caller-authored ready cells cannot omit any release prerequisite', () => {
	for (const mutate of [
		(value) => { value.sources.activationBlocked = 1; },
		(value) => { value.payloads.built = 14; value.payloads.pendingExternal = 1; },
		(value) => { value.qualification.provisionedProfileCount = 17; },
		(value) => { value.qualification.acceptedCohortCount = 5; },
		(value) => { value.qualification.pendingHandoffGates = ['legalAndTrademarkReview']; },
		(value) => { value.licensing.disabledGates = ['native-audio']; },
		(value) => { value.licensing.blockedPolicyRows = ['native-audio-stack']; },
		(value) => { value.packageEvidence.packages[0].name = 'invented.zip'; },
		(value) => { value.packageEvidence.desktopCodecPolicy.bundledFfmpeg = true; },
		(value) => { value.qualification.revisionBinding.kind = 'invented'; },
		(value) => { delete value.packageEvidence.releaseAuthentication.policyEvidence; },
		(value) => { delete value.inputDigests['config/production-licensing-matrix.json']; },
		(value) => {
			value.inputDigests['desktop-package:framescaper:win-x64:foreign.zip'] = {
				byteLength: 1, sha256: DIGEST,
			};
		},
		(value) => {
			value.inputDigests['invented/shared.json'] = { byteLength: 1, sha256: DIGEST };
		},
	]) {
		const cells = MILESTONE_5_PACKAGE_CELLS.map((identity) => cell(identity, true));
		mutate(cells[0]);
		assert.throws(
			() => aggregateMilestone5HandoffMatrix(cells),
			/readiness|ready|package|qualification|input|digest|matrix|cell|codec policy/iu,
		);
	}
});

test('directory audit requires ten canonical regular handoff files and binds their bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-m5-matrix-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await Promise.all(MILESTONE_5_PACKAGE_CELLS.map(async (identity) => {
		await writeFile(
			join(root, handoffName(identity)),
			`${JSON.stringify(cell(identity), null, '\t')}\n`,
		);
	}));
	const audit = await auditMilestone5HandoffMatrixDirectory(root);
	assert.equal(audit.matrixInputsAuthenticated, false);
	assert.equal(audit.milestoneReleaseReady, null);
	assert.equal(audit.cellEvidence.length, 10);
	assert.ok(audit.cellEvidence.every(({ byteLength, sha256 }) => (
		byteLength > 0 && /^[a-f\d]{64}$/u.test(sha256)
	)));
	const output = `${root}-aggregate.json`;
	context.after(() => rm(output, { force: true }));
	const cli = spawnSync(process.execPath, [
		'scripts/aggregate-milestone-5-handoffs.mjs',
		'--input-directory', root,
		'--output', output,
		'--require-ready',
	], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
	assert.equal(cli.status, 1, cli.stderr);
	assert.equal(cli.signal, null);
	await assert.rejects(assembleMilestone5HandoffMatrix({
		repositoryRoot: join(import.meta.dirname, '..'),
		packageDirectory: root,
		sourceRevision: REVISION,
	}), /package matrix/iu);

	const first = MILESTONE_5_PACKAGE_CELLS[0];
	const firstPath = join(root, handoffName(first));
	await writeFile(firstPath, JSON.stringify(cell(first)));
	await assert.rejects(auditMilestone5HandoffMatrixDirectory(root), /canonical/iu);
	await rm(firstPath);
	await mkdir(firstPath);
	await assert.rejects(auditMilestone5HandoffMatrixDirectory(root), /regular/iu);
	await rm(firstPath, { recursive: true });
	const outside = join(root, 'outside.json');
	await writeFile(outside, `${JSON.stringify(cell(first), null, '\t')}\n`);
	await symlink(outside, firstPath);
	await assert.rejects(auditMilestone5HandoffMatrixDirectory(root), /regular|symbolic|unexpected/iu);
});

function cell({ productId, targetId }, ready = false) {
	const runtimeName = `runtime-manifest-${productId}-${targetId}.json`;
	const authenticationName = `release-authentication-${productId}-${targetId}.json`;
	const packages = packageDescriptors(productId, targetId).map((descriptor) => (
		ready ? descriptor : { ...descriptor, content: null }
	));
	const signatureBlocker = 'Exact package release signatures and installer attestations are pending.';
	const blockers = ready ? [] : [
		{ id: 'lab:unprovisioned', reason: 'Physical lab is not provisioned.' },
		{ id: 'package-signature:pending', reason: signatureBlocker },
	];
	return {
		schemaVersion: 2,
		assessmentScope: { kind: 'package-cell', productId, targetId },
		assemblyInputsAuthenticated: true,
		sourceInputsAudited: true,
		engineeringEvidenceAuthenticated: ready,
		packageCellReady: ready,
		milestoneReleaseReady: null,
		status: ready ? 'ready' : 'pending-external',
		sources: {
			authenticated: ready ? 10 : 0,
			pendingExternal: ready ? 0 : 10,
			activationBlocked: ready ? 0 : 10,
			total: 10,
		},
		payloads: { built: ready ? 20 : 1, pendingExternal: ready ? 0 : 19, total: 20 },
		qualification: {
			workloadIds: WORKLOAD_IDS, profileCount: 18, provisionedProfileCount: ready ? 18 : 0,
			acceptedCohortCount: ready ? 6 : 0, sourceRevision: QUALIFICATION_REVISION,
			revisionBinding: {
				kind: 'qualification-evidence-only-descendant',
				qualificationSourceRevision: QUALIFICATION_REVISION,
				handoffSourceRevision: REVISION,
				changedPathCount: 2,
				changedPathsSha256: DIGEST,
			},
			pendingHandoffGates: ready ? [] : ['legalAndTrademarkReview'],
		},
		packageEvidence: {
			status: ready
				? 'installed-application-closure-audited'
				: 'release-authentication-pending',
			releaseAuthentication: ready
				? {
					status: 'authenticated', blockedBy: null,
					evidence: { name: authenticationName, byteLength: 12, sha256: DIGEST },
					policyEvidence: {
						name: 'config/milestone-5-package-release-authentication-policy.json',
						byteLength: 1, sha256: DIGEST,
					},
				}
				: {
					status: 'pending-external', blockedBy: signatureBlocker, evidence: null,
					policyEvidence: {
						name: 'config/milestone-5-package-release-authentication-policy.json',
						byteLength: 1, sha256: DIGEST,
					},
				},
			productId, targetId, applicationVersion: VERSION,
			sourceRevision: REVISION,
			runtimeManifest: { name: runtimeName, byteLength: 7, sha256: DIGEST },
			desktopCodecPolicy: {
				schemaVersion: 1,
				bundledFfmpeg: false,
				providerOrder: ['bundled-reviewed-codecs', 'os', 'external-user-install'],
			},
			packages,
			packageCount: packages.length,
			totalPackageBytes: packages.reduce((total, descriptor) => total + descriptor.byteLength, 0),
		},
		licensing: { disabledGates: ready ? [] : ['native-audio'], blockedPolicyRows: [] },
		blockers,
		sourceRevision: REVISION,
		observedHeadRevision: REVISION,
		sourceRevisionBinding: { status: 'authenticated-clean-head', sourceRevision: REVISION },
		inputDigests: {
			...Object.fromEntries(INPUT_PATHS.map((path) => [
				path, { byteLength: 1, sha256: DIGEST },
			])),
			[packageDigestKey({ assessmentScope: { productId, targetId } }, runtimeName)]: {
				byteLength: 7, sha256: DIGEST,
			},
			...(ready ? {
				[packageDigestKey({ assessmentScope: { productId, targetId } }, authenticationName)]: {
					byteLength: 12, sha256: DIGEST,
				},
			} : {}),
			...Object.fromEntries(packages.map(({ name, byteLength, sha256 }) => [
				packageDigestKey({ assessmentScope: { productId, targetId } }, name),
				{ byteLength, sha256 },
			])),
		},
	};
}

function packageDescriptors(productId, targetId) {
	const productName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const suffixes = {
		'linux-x64': [
			['Linux x64 AppImage', 'linux-x64.AppImage'],
			['Linux x64 Debian package', 'linux-amd64.deb'],
		],
		'linux-arm64': [
			['Linux ARM64 AppImage', 'linux-arm64.AppImage'],
			['Linux ARM64 Debian package', 'linux-arm64.deb'],
		],
		'mac-arm64': [['macOS Apple silicon DMG', 'mac-arm64.dmg']],
		'win-x64': [
			['Windows x64 installer', 'win-x64.exe'],
			['Windows x64 ZIP', 'win-x64.zip'],
		],
		'win-arm64': [
			['Windows ARM64 installer', 'win-arm64.exe'],
			['Windows ARM64 ZIP', 'win-arm64.zip'],
		],
	}[targetId];
	return suffixes.map(([label, suffix], index) => ({
		label,
		name: `${productName}-${VERSION}-${suffix}`,
		byteLength: 9 + index,
		sha256: DIGEST,
		content: {
			status: 'installed-resource-closure-audited',
			productId,
			targetId,
			applicationVersion: VERSION,
			sourceRevision: REVISION,
			fileCount: 7,
			totalBytes: 101,
			closureSha256: DIGEST,
			contentManifestByteLength: 211,
			contentManifestSha256: DIGEST,
			installedFileCount: 8,
			installedTotalBytes: 165,
			installedClosureSha256: DIGEST,
		},
	}));
}

function packageDigestKey(value, name) {
	const { productId, targetId } = value.assessmentScope;
	return `desktop-package:${productId}:${targetId}:${name}`;
}

function handoffName({ productId, targetId }) {
	return `milestone-5-handoff-${productId}-${targetId}.json`;
}

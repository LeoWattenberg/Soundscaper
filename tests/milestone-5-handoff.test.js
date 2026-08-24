/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	MILESTONE_5_HANDOFF_WORKLOAD_IDS,
	assessMilestone5Handoff,
	assembleMilestone5Handoff,
	authenticateMilestone5HandoffSourceRevision,
	isAssembledMilestone5Handoff,
	validateMilestone5QualificationRevisionCompatibility,
} from '../scripts/lib/milestone-5-handoff.mjs';
import { createSoundscaperLinuxPackageFixture } from './helpers/milestone-5-linux-package-fixture.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'));

function currentInputs() {
	return {
		qualityBudgets: load('config/quality-budgets.json'),
		licensingMatrix: load('config/production-licensing-matrix.json'),
		sourceAcquisitions: load('config/milestone-5-native-source-acquisitions.json'),
		releaseAuthenticationPolicy: load('config/milestone-5-package-release-authentication-policy.json'),
		nativeIsolationReviewPolicy: load('config/milestone-5-native-isolation-review-policy.json'),
		nativeAddonPayload: load('config/native-addon-payload-manifest.json'),
		soundscaperProfessionalPayload: load('config/soundscaper-professional-native-payload-manifest.json'),
		mediaHostPayload: load('config/framescaper-media-host-payload-manifest.json'),
		openFxHostPayload: load('config/framescaper-openfx-host-payload-manifest.json'),
	};
}

test('milestone-5 handoff reports unauthenticated engineering inputs without claiming release readiness', () => {
	const handoff = assessMilestone5Handoff(currentInputs());

	assert.equal(handoff.schemaVersion, 2);
	assert.deepEqual(handoff.assessmentScope, { kind: 'engineering-inputs' });
	assert.equal(handoff.assemblyInputsAuthenticated, false);
	assert.equal(handoff.engineeringEvidenceAuthenticated, false);
	assert.equal(handoff.packageCellReady, false);
	assert.equal(handoff.milestoneReleaseReady, null);
	assert.equal(Object.hasOwn(handoff, 'releaseReady'), false);
	assert.equal(handoff.status, 'pending-external');
	assert.deepEqual(handoff.qualification.workloadIds, MILESTONE_5_HANDOFF_WORKLOAD_IDS);
	assert.equal(handoff.qualification.profileCount, 18);
	assert.equal(handoff.qualification.provisionedProfileCount, 0);
	assert.equal(handoff.qualification.acceptedCohortCount, 0);
	assert.deepEqual(handoff.qualification.pendingHandoffGates, [
		'legalAndTrademarkReview',
		'nativeIsolationSecurityReview',
		'productionSigningAndNotarization',
	]);
	assert.deepEqual(handoff.sources, {
		authenticated: 0, pendingExternal: 10, activationBlocked: 10, total: 10,
	});
	assert.deepEqual(handoff.payloads, {
		built: 1,
		pendingExternal: 19,
		total: 20,
	});
	assert.deepEqual(handoff.licensing.disabledGates, ['native-audio', 'native-codecs', 'native-plugins']);
	assert.equal(handoff.packageEvidence, null);
	assert.ok(handoff.licensing.blockedPolicyRows.includes('native-audio-stack'));
	assert.ok(handoff.licensing.blockedPolicyRows.includes('plugin-format-ofx'));
	assert.ok(handoff.licensing.blockedPolicyRows.includes('codec-encode-prores-mov-422-hq'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'lab:unprovisioned'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'package-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'source-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'source-authentication:juce'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'assembly-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'payload:soundscaper:win-arm64'));
});

test('milestone-5 handoff refuses caller-authored readiness objects without authenticated audits', () => {
	const inputs = structuredClone(currentInputs());
	for (const manifest of [
		inputs.nativeAddonPayload, inputs.soundscaperProfessionalPayload,
		inputs.mediaHostPayload, inputs.openFxHostPayload,
	]) {
		for (const target of manifest.targets) {
			target.status = 'built';
			target.blockedBy = null;
			target.payload = target.payload ?? { sha256: 'a'.repeat(64) };
		}
	}
	const lab = inputs.qualityBudgets.environments.find(({ id }) => id === 'native-os-lab-matrix');
	lab.status = 'active';
	lab.qualificationEligible = true;
	const architectures = {
		windowsX64: 'x64', windowsArm64: 'arm64', macosArm64: 'arm64',
		linuxX64: 'x64', linuxArm64: 'arm64',
	};
	for (const key of Object.keys(lab.physicalHosts)) {
		lab.physicalHosts[key] = {
			hostId: `host-${key}`,
			platformId: key,
			architecture: architectures[key],
			osImage: 'fixed-image',
			osVersion: '1',
			cpuModel: 'fixed-cpu',
			logicalCpuCount: 8,
			memoryBytes: 16 * 1024 * 1024 * 1024,
			gpuModel: 'fixed-gpu',
			driverVersion: '1',
			audioInterfaceModel: 'fixed-audio-interface',
			audioDriverVersion: '1',
			displayIdentity: 'fixed-display',
		};
	}
	for (const key of Object.keys(lab.handoffGates)) lab.handoffGates[key] = 'accepted';
	for (const id of MILESTONE_5_HANDOFF_WORKLOAD_IDS) {
		inputs.qualityBudgets.workloads.find((workload) => workload.id === id).status = 'qualified';
		inputs.qualityBudgets.qualification.qualifiedWorkloadIds.push(id);
	}
	for (const gate of inputs.licensingMatrix.futureDistributionGates) {
		if (['native-audio', 'native-codecs', 'native-plugins'].includes(gate.id)) gate.status = 'enabled';
	}
	for (const row of inputs.licensingMatrix.nativeFormatPolicies) row.status = 'implemented';
	for (const source of inputs.sourceAcquisitions.sources) {
		source.activationStatus = 'accepted';
		source.blockedBy = null;
	}
	const profiles = lab.profiles;
	inputs.acceptedCohorts = MILESTONE_5_HANDOFF_WORKLOAD_IDS.map((workloadId) => ({
		schemaVersion: 2,
		workloadId,
		status: 'accepted',
		qualificationEvidencePublished: true,
		evaluation: { passed: true, failures: [] },
		sourceRevision: 'f'.repeat(40),
		labProfileIds: profiles
			.filter(({ productId }) => workloadId.startsWith('m5b-')
				? productId === 'framescaper' : productId === 'soundscaper')
			.map(({ id }) => id),
	}));

	const handoff = assessMilestone5Handoff(inputs);
	assert.equal(handoff.engineeringEvidenceAuthenticated, false);
	assert.equal(handoff.assemblyInputsAuthenticated, false);
	assert.equal(handoff.packageCellReady, false);
	assert.equal(handoff.milestoneReleaseReady, null);
	assert.equal(handoff.status, 'pending-external');
	assert.ok(handoff.blockers.some(({ id }) => id === 'qualification-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'payload-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'package-audit:missing'));
	assert.equal(handoff.qualification.acceptedCohortCount, 0);
});

test('repository assembly runs the authenticated payload and raw-evidence auditors', async () => {
	const handoff = await assembleMilestone5Handoff(repositoryRoot);
	assert.equal(isAssembledMilestone5Handoff(handoff), true);
	assert.equal(handoff.sourceRevision, null);
	assert.match(handoff.observedHeadRevision, /^[a-f\d]{40}$/u);
	assert.deepEqual(handoff.sourceRevisionBinding, {
		status: 'unattributed-working-tree',
		sourceRevision: null,
		observedHeadRevision: handoff.observedHeadRevision,
	});
	assert.equal(handoff.sourceInputsAudited, true);
	assert.equal(handoff.engineeringEvidenceAuthenticated, false);
	assert.equal(handoff.assemblyInputsAuthenticated, true);
	assert.equal(handoff.packageCellReady, false);
	assert.equal(handoff.milestoneReleaseReady, null);
	assert.deepEqual(handoff.assessmentScope, { kind: 'engineering-inputs' });
	assert.equal(handoff.qualification.acceptedCohortCount, 0);
	assert.ok(!handoff.blockers.some(({ id }) => id === 'qualification-audit:missing'));
	assert.ok(!handoff.blockers.some(({ id }) => id === 'payload-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'package-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'source-revision:unattributed'));
	assert.equal(handoff.packageEvidence, null);
	assert.ok(handoff.inputDigests['config/milestone-5-qualification-evidence.json']);
	assert.ok(handoff.inputDigests['config/native-addon-payload-manifest.json']);
});

test('repository assembly refuses to attribute working bytes to a non-HEAD revision', async () => {
	const parentRevision = git(repositoryRoot, 'rev-parse', 'HEAD^');
	await assert.rejects(
		assembleMilestone5Handoff(repositoryRoot, parentRevision),
		/does not resolve to HEAD/iu,
	);
});

test('repository assembly binds an exact package and rejects a drifted staged payload summary', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const packageRoot = await mkdtemp(join(tmpdir(), 'soundscaper-m5-package-'));
	context.after(() => rm(packageRoot, { recursive: true, force: true }));
	const version = load('package.json').version;
	const fixture = await createSoundscaperLinuxPackageFixture({
		applicationVersion: version,
		context,
		packageRoot,
		repositoryRoot,
		sourceRevision: null,
	});
	const { manifestName, runtimeManifest: manifest } = fixture;
	const options = { packageRoot, productId: 'soundscaper', targetId: 'linux-x64' };
	const handoff = await assembleMilestone5Handoff(repositoryRoot, undefined, options);
	assert.deepEqual(handoff.assessmentScope, {
		kind: 'package-cell', productId: 'soundscaper', targetId: 'linux-x64',
	});
	assert.equal(handoff.sourceInputsAudited, true);
	assert.equal(handoff.engineeringEvidenceAuthenticated, false);
	assert.equal(handoff.assemblyInputsAuthenticated, true);
	assert.equal(handoff.packageCellReady, false);
	assert.equal(handoff.milestoneReleaseReady, null);
	assert.equal(handoff.packageEvidence.productId, 'soundscaper');
	assert.equal(handoff.packageEvidence.targetId, 'linux-x64');
	assert.equal(handoff.packageEvidence.packageCount, 2);
	assert.ok(!handoff.blockers.some(({ id }) => id === 'package-audit:missing'));
	assert.ok(handoff.blockers.some(({ id }) => id === 'package-signature:pending'));
	assert.equal(handoff.packageEvidence.releaseAuthentication.status, 'pending-external');
	assert.deepEqual(handoff.packageEvidence.desktopCodecPolicy, {
		schemaVersion: 1,
		bundledFfmpeg: false,
		providerOrder: ['bundled-open-codecs', 'os', 'external-user-install'],
	});
	assert.ok(handoff.inputDigests[
		`desktop-package:soundscaper:linux-x64:${manifestName}`
	]);
	assert.equal(Object.keys(handoff.inputDigests).some((name) => (
		name.endsWith(':ffmpeg-corresponding-source.json')
	)), false);

	manifest.nativeAddons.payload.sha256 = '0'.repeat(64);
	await writeJson(join(packageRoot, manifestName), manifest);
	await assert.rejects(
		assembleMilestone5Handoff(repositoryRoot, undefined, options),
		/package native-addon target disagrees|runtime manifest|embedded and adjacent/iu,
	);
});

test('milestone-5 handoff rejects incomplete or invented matrix members', () => {
	for (const mutate of [
		(inputs) => inputs.nativeAddonPayload.targets.pop(),
		(inputs) => { inputs.mediaHostPayload.targets[0].status = 'invented'; },
		(inputs) => inputs.qualityBudgets.environments.find(({ id }) =>
			id === 'native-os-lab-matrix').profiles.pop(),
		(inputs) => inputs.sourceAcquisitions.sources.pop(),
		(inputs) => inputs.licensingMatrix.nativeFormatPolicies.pop(),
		(inputs) => { inputs.licensingMatrix.nativeFormatPolicies[2].id = 'invented-policy-row'; },
		(inputs) => inputs.licensingMatrix.futureDistributionGates.find(({ id }) =>
			id === 'native-audio').status = 'invented',
	]) {
		const inputs = structuredClone(currentInputs());
		mutate(inputs);
		assert.throws(() => assessMilestone5Handoff(inputs), /Milestone 5|native|payload|lab|source/iu);
	}
});

test('checked-in qualification may follow its measured revision only through evidence-only changes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-m5-history-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'config'), { recursive: true });
	const historical = {
		workloads: [
			...MILESTONE_5_HANDOFF_WORKLOAD_IDS.map((id) => ({ id, status: 'implemented', stable: id })),
			{ id: 'unrelated', status: 'qualified', stable: true },
		],
		qualification: { qualifiedWorkloadIds: ['unrelated'] },
		stable: { runtimeContract: 7 },
	};
	await writeJson(join(root, 'config/quality-budgets.json'), historical);
	git(root, 'init');
	git(root, 'config', 'user.email', 'tests@soundscaper.invalid');
	git(root, 'config', 'user.name', 'Soundscaper Tests');
	git(root, 'add', '.');
	git(root, 'commit', '-m', 'measured source');
	const measuredRevision = git(root, 'rev-parse', 'HEAD');

	const accepted = structuredClone(historical);
	for (const workload of accepted.workloads) {
		if (MILESTONE_5_HANDOFF_WORKLOAD_IDS.includes(workload.id)) workload.status = 'qualified';
	}
	accepted.qualification.qualifiedWorkloadIds.push(...MILESTONE_5_HANDOFF_WORKLOAD_IDS);
	await Promise.all([
		writeJson(join(root, 'config/quality-budgets.json'), accepted),
		writeJson(join(root, 'config/milestone-5-qualification-evidence.json'), { schemaVersion: 1 }),
		writeJson(join(root, 'qualification/milestone-5/cohort.json'), { schemaVersion: 2 }),
	]);
	git(root, 'add', '.');
	git(root, 'commit', '-m', 'accept qualification evidence');
	const evidenceRevision = git(root, 'rev-parse', 'HEAD');
	assert.deepEqual(authenticateMilestone5HandoffSourceRevision(root, evidenceRevision), {
		status: 'authenticated-clean-head',
		sourceRevision: evidenceRevision,
	});
	assert.throws(
		() => authenticateMilestone5HandoffSourceRevision(root, measuredRevision),
		/does not resolve to HEAD/iu,
	);
	await writeFile(join(root, 'untracked.txt'), 'dirty\n');
	assert.throws(
		() => authenticateMilestone5HandoffSourceRevision(root, evidenceRevision),
		/worktree.*must be clean/iu,
	);
	await rm(join(root, 'untracked.txt'));
	const binding = validateMilestone5QualificationRevisionCompatibility(
		root, measuredRevision, evidenceRevision, accepted,
	);
	assert.deepEqual({ ...binding, changedPathsSha256: '<digest>' }, {
		kind: 'qualification-evidence-only-descendant',
		qualificationSourceRevision: measuredRevision,
		handoffSourceRevision: evidenceRevision,
		changedPathCount: 3,
		changedPathsSha256: '<digest>',
	});
	assert.match(binding.changedPathsSha256, /^[a-f\d]{64}$/u);

	accepted.stable.runtimeContract = 8;
	await writeJson(join(root, 'config/quality-budgets.json'), accepted);
	git(root, 'add', '.');
	git(root, 'commit', '-m', 'semantic budget drift');
	assert.throws(
		() => validateMilestone5QualificationRevisionCompatibility(
			root, measuredRevision, git(root, 'rev-parse', 'HEAD'), accepted,
		),
		/quality budgets changed beyond qualification publication markers/iu,
	);
	git(root, 'checkout', '--quiet', '-b', 'runtime-drift', evidenceRevision);
	await writeFile(join(root, 'runtime.js'), 'runtime drift\n');
	git(root, 'add', '.');
	git(root, 'commit', '-m', 'runtime drift');
	assert.throws(
		() => validateMilestone5QualificationRevisionCompatibility(
			root, measuredRevision, git(root, 'rev-parse', 'HEAD'), accepted,
		),
		/runtime\.js.*outside the evidence-only bridge/iu,
	);
});

test('desktop target matrix retains one digest-bound Milestone 5 handoff per package', () => {
	const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/desktop-preview.yml'), 'utf8');
	const packageStart = workflow.indexOf('\n  package:');
	const packageEnd = workflow.indexOf('\n  package-with-tests:', packageStart);
	const packageJob = workflow.slice(packageStart, packageEnd);
	const retainIndex = packageJob.indexOf('- name: Retain the verified runtime manifest');
	const handoffIndex = packageJob.indexOf('- name: Assemble the fail-closed Milestone 5 handoff');
	const stageIndex = packageJob.indexOf('- name: Stage the offline renderer and runtimes');
	const packageIndex = packageJob.indexOf('- name: Package ${{ matrix.product }}', stageIndex);
	const stageStep = packageJob.slice(stageIndex, packageIndex);

	assert.match(packageJob, /node scripts\/assemble-milestone-5-handoff\.mjs --output/u);
	assert.ok(retainIndex >= 0 && handoffIndex > retainIndex,
		'Milestone 5 package evidence must be assembled after retaining the runtime manifest.');
	assert.match(packageJob, /--product "\$\{\{ matrix\.product \}\}"/u);
	assert.match(packageJob, /--target "\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}"/u);
	assert.match(packageJob, /--package-root "release\/desktop"/u);
	assert.match(stageStep, /SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(packageJob, /SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(packageJob, /fetch-depth: 0/u);
	assert.match(packageJob,
		/name: milestone-5-handoff-\$\{\{ matrix\.product \}\}-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(packageJob, /milestone-5-handoff-\$\{\{ matrix\.product \}\}-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}\.json/u);
});

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(cwd, ...args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

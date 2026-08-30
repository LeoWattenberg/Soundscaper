/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	canonicalM9SoakFixtureBytes,
	generateM9SoakFixture,
	validateM9SoakSpec,
} from '../scripts/lib/m9-soak-fixture.mjs';
import {
	evaluateSoundscaperStable1BehaviorEnvironmentCoverage,
	expandSoundscaperStable1BehaviorEnvironmentRequirements,
	validateSoundscaperStable1BehaviorEnvironmentMatrix,
} from '../scripts/lib/soundscaper-stable-1-behavior-environments.mjs';
import { SOUNDSCAPER_STABLE_1_CHECKS, SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS } from
	'../scripts/lib/soundscaper-stable-1-check-inventory.mjs';
import {
	evaluateSoundscaperStable1ReleaseAdmission,
	parseSoundscaperStable1GuidedVerification,
} from '../scripts/lib/soundscaper-stable-1-release-admission.mjs';
import {
	readSoundscaperStable1QualificationEvidenceRegister,
	validateSoundscaperStable1QualificationEvidenceRegister,
} from '../scripts/lib/soundscaper-stable-1-qualification-evidence.mjs';
import {
	createSoundscaperStableLifecyclePlan,
} from '../scripts/soundscaper-stable-lifecycle-smoke.mjs';

const ROOT = new URL('../', import.meta.url);
const MATRIX = validateSoundscaperStable1BehaviorEnvironmentMatrix(JSON.parse(
	await readFile(new URL('config/soundscaper-stable-1-behavior-environments.json', ROOT), 'utf8'),
));
const SPEC_BYTES = await readFile(new URL('config/soundscaper-stable-1-soak-spec.json', ROOT));
const SPEC = validateM9SoakSpec(JSON.parse(SPEC_BYTES));
const RECORD_URL = new URL('docs/soundscaper-stable-1-guided-verification.md', ROOT);
const CHECK_ROW = /^(\| (?<id>[A-Z]{2,3}-\d{2}) \| .*? \| )pending( \| )pending( \| .*? \|)$/gmu;

test('the Soundscaper stable inventory excludes Framescaper runtime campaign rows', () => {
	assert.equal(SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.length, 75);
	assert.ok(SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.includes('SB-01'));
	assert.ok(SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.includes('SDL-09'));
	assert.ok(SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.includes('LA-17'));
	assert.ok(SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.includes('REL-14'));
	assert.ok(SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.includes('GAT-10'));
	assert.ok(!SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.some((id) =>
		/^(?:FB|FD|FW|FN|FDL|PI|PW|CAP)-/u.test(id)));
	assert.ok(!SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.includes('GAT-02'));
	const authoritativeText = SOUNDSCAPER_STABLE_1_CHECKS.map(({ check }) => check).join('\n');
	assert.doesNotMatch(authoritativeText,
		/(?:launch|build|package|install|run|open)\b.{0,48}\bFramescaper|both products|paired-product/iu);
	assert.doesNotMatch(authoritativeText, /soundscaper_helper\.node/iu);
	assert.match(SOUNDSCAPER_STABLE_1_CHECKS.find(({ id }) => id === 'SN-02').check,
		/soundscaper_professional\.node/iu);
	assert.doesNotMatch(SOUNDSCAPER_STABLE_1_CHECKS
		.filter(({ id }) => id !== 'SB-09').map(({ check }) => check).join('\n'), /\bcapture\b|\bOpenFX\b/iu);
});

test('the Soundscaper behavior matrix covers its inventory without a Framescaper cell', () => {
	const requirements = expandSoundscaperStable1BehaviorEnvironmentRequirements(MATRIX);
	assert.deepEqual([...requirements.keys()], [...SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS]);
	assert.equal(requirements.size, 75);
	assert.equal(MATRIX.productId, 'soundscaper');
	assert.ok(MATRIX.cells.every(({ productId }) => productId === null || productId === 'soundscaper'));
	assert.equal(MATRIX.cellSets.find(({ id }) => id === MATRIX.soakCellSetId).cellIds.length, 11);
	assert.equal(requirements.get('SN-01').length, 11);
	assert.equal(requirements.get('SN-09').length, 7);
	assert.equal(requirements.get('SDL-01').length, 12);
	assert.equal(requirements.get('LA-01').length, 11);
	assert.equal(requirements.get('LA-02').length, 5);
	assert.equal([...requirements.values()].reduce((total, cellIds) => total + cellIds.length, 0), 509);
});

test('the pinned Soundscaper soak never schedules a Framescaper runtime', async () => {
	const fixture = generateM9SoakFixture(SPEC, 'qualification');
	assert.deepEqual(SPEC.productIds, ['soundscaper']);
	assert.equal(SPEC.workloadId, 'soundscaper-stable-1-complete-system-soak');
	assert.deepEqual(new Set(fixture.projects.map(({ productId }) => productId)), new Set(['soundscaper']));
	assert.ok(fixture.schedule.every(({ productId }) => productId === 'soundscaper'));
	assert.ok(SPEC.operations.some(({ kind }) => kind === 'persistent-delivery-recovery'));
	assert.ok(SPEC.operations.some(({ kind }) => kind === 'save-reopen'));
	assert.ok(SPEC.operations.some(({ kind }) => kind === 'local-assistance'));
	assert.ok(SPEC.operations.some(({ kind }) => kind === 'foreign-project-custody'));
	assert.ok(!SPEC.operations.some(({ id, kind }) => /framescaper|capture|openfx/iu.test(`${id}:${kind}`)));
	assert.equal(sha256(canonicalM9SoakFixtureBytes(fixture)), SPEC.generatedArtifacts.qualification.sha256);
	assert.equal(SPEC.generator.sourceSha256, sha256(await readFile(
		new URL(SPEC.generator.sourcePath, ROOT),
	)));
});

test('Soundscaper qualification reserves exactly two runs in every release-runtime cell', async () => {
	const register = await readSoundscaperStable1QualificationEvidenceRegister(ROOT.pathname);
	assert.equal(register.workloadId, SPEC.workloadId);
	assert.equal(register.fixtureId, SPEC.fixtureId);
	assert.equal(register.cells.length, 11);
	assert.ok(register.cells.every(({ runs }) => runs.length === 2));
	assert.equal(register.packageInventorySha256, null);
	assert.equal(register.attestationProfileVersion, SPEC.evidenceAuthority.profileVersion);
	assert.equal(register.attestationProfileSha256, SPEC.evidenceAuthority.profileSha256);
	assert.equal(register.trustedLabKeyRegistrySha256,
		SPEC.evidenceAuthority.trustedKeyRegistry.sha256);
	assert.equal(register.workloadRunnerVersion, SPEC.evidenceAuthority.workloadRunner.version);
	assert.ok(register.cells.every((cell) => cell.sourceRevision === null
		&& cell.packageInventorySha256 === null
		&& cell.workloadRunnerSha256 === null
		&& cell.runs.every((run) => run.sourceRevision === null
			&& run.runId === null
			&& run.packageInventorySha256 === null
			&& run.workloadRunnerSha256 === null)));
	assert.equal(register.soakSpecSha256, sha256(SPEC_BYTES));
});

test('every accepted soak cell and run binds the exact candidate source and package inventory', async () => {
	const register = structuredClone(await readSoundscaperStable1QualificationEvidenceRegister(ROOT.pathname));
	register.status = 'accepted';
	register.blockedBy = null;
	register.sourceRevision = '0123456789abcdef0123456789abcdef01234567';
	register.packageInventorySha256 = 'a'.repeat(64);
	register.budgetSha256 = 'b'.repeat(64);
	for (const cell of register.cells) {
		cell.status = 'accepted';
		cell.sourceRevision = register.sourceRevision;
		cell.packageInventorySha256 = register.packageInventorySha256;
		cell.workloadRunnerSha256 = 'c'.repeat(64);
		for (const run of cell.runs) {
			run.runId = `${cell.cellId}-run-${String(run.sequence)}`;
			run.sourceRevision = register.sourceRevision;
			run.packageInventorySha256 = register.packageInventorySha256;
			run.workloadRunnerSha256 = cell.workloadRunnerSha256;
			Object.assign(run, evidencePin(`${cell.cellId}-run-${run.sequence}`));
		}
		Object.assign(cell.cohort, evidencePin(`${cell.cellId}-cohort`));
	}
	assert.doesNotThrow(() => validateSoundscaperStable1QualificationEvidenceRegister(register, MATRIX));
	for (const [mutate, reason] of [
		[(value) => { value.cells[0].sourceRevision = 'f'.repeat(40); }, /source revision/iu],
		[(value) => { value.cells[0].runs[0].sourceRevision = 'f'.repeat(40); }, /source revision/iu],
		[(value) => { value.cells[0].packageInventorySha256 = 'f'.repeat(64); }, /package inventory/iu],
		[(value) => { value.cells[0].runs[0].packageInventorySha256 = 'f'.repeat(64); }, /package inventory/iu],
		[(value) => { value.cells[0].runs[0].runId = value.cells[0].runs[1].runId; }, /run identity/iu],
		[(value) => { value.cells[0].runs[0].workloadRunnerSha256 = 'f'.repeat(64); }, /runner digest/iu],
	]) {
		const changed = structuredClone(register);
		mutate(changed);
		assert.throws(
			() => validateSoundscaperStable1QualificationEvidenceRegister(changed, MATRIX),
			reason,
		);
	}
});

test('Soundscaper admission is closed over only its own guided record and qualification', async () => {
	const markdown = await readFile(RECORD_URL, 'utf8');
	const parsed = parseSoundscaperStable1GuidedVerification(markdown);
	assert.equal(parsed.rows.length, 75);
	assert.deepEqual(parsed.missingIds, []);
	assert.deepEqual(parsed.unexpectedIds, []);
	assert.deepEqual(parsed.changedIds, []);
	assert.equal(parsed.runIdentity.get('Product'), 'soundscaper');
	assert.equal(parsed.runIdentity.get('Stable release'), '1.0.0');
	assert.equal(parsed.runIdentity.get('Release candidate commit SHA'), 'pending');
	assert.equal(parsed.runIdentity.get('Desktop preview workflow run ID'), 'pending');
	assert.equal(parsed.runIdentity.get('Release candidate package inventory SHA-256'), 'pending');
	assert.equal(parsed.completion.has('Framescaper desktop evidence location'), false);
	assert.equal(parsed.completion.has('Capture evidence location'), false);

	const requirements = expandSoundscaperStable1BehaviorEnvironmentRequirements(MATRIX);
	const passing = passingRecord(markdown, requirements);
	const passingParsed = parseSoundscaperStable1GuidedVerification(passing);
	const coverage = evaluateSoundscaperStable1BehaviorEnvironmentCoverage(passingParsed, MATRIX);
	assert.equal(coverage.passed, true);
	const audit = {
		passed: true,
		qualificationReady: true,
		status: 'accepted',
		workloadId: SPEC.workloadId,
		matrixId: MATRIX.matrixId,
		sourceRevision: '0123456789abcdef0123456789abcdef01234567',
		packageInventorySha256: 'a'.repeat(64),
		requiredCellCount: 11,
		requiredRunCount: 22,
		auditedRunCount: 22,
		blockers: [],
	};
	const nativeReadinessAudit = passingNativeReadinessAudit();
	const admitted = evaluateSoundscaperStable1ReleaseAdmission(passingParsed, {
		behaviorEnvironmentMatrix: MATRIX,
		qualificationEvidenceAudit: audit,
		nativeReadinessAudit,
	});
	assert.equal(admitted.admitted, true);
	assert.deepEqual(admitted.releaseCandidate, {
		version: '1.0.0-rc.1',
		tag: 'soundscaper-v1.0.0-rc.1',
		commitSha: '0123456789abcdef0123456789abcdef01234567',
		desktopPreviewWorkflowRunId: 12_345_678_901,
		packageInventorySha256: 'a'.repeat(64),
	});
	assert.equal(admitted.nativeReadiness.passed, true);
	assert.equal(admitted.nativeReadiness.readyTargetCount, 5);
	for (const [field, value, reason] of [
		['sourceRevision', 'f'.repeat(40), /qualification.*source revision/iu],
		['packageInventorySha256', 'f'.repeat(64), /qualification.*package inventory/iu],
	]) {
		const result = evaluateSoundscaperStable1ReleaseAdmission(passingParsed, {
			behaviorEnvironmentMatrix: MATRIX,
			qualificationEvidenceAudit: { ...audit, [field]: value },
			nativeReadinessAudit,
		});
		assert.equal(result.admitted, false);
		assert.match(result.reasons.join('\n'), reason);
	}
	for (const [field, original, replacement, property, reason] of [
		['Release candidate commit SHA', '0123456789abcdef0123456789abcdef01234567',
			'ABCDEF0123456789ABCDEF0123456789ABCDEF01', 'commitSha', /commit SHA/iu],
		['Desktop preview workflow run ID', '12345678901',
			'9007199254740992', 'desktopPreviewWorkflowRunId', /positive safe integer/iu],
		['Release candidate package inventory SHA-256', 'a'.repeat(64),
			'b'.repeat(63), 'packageInventorySha256', /inventory SHA-256/iu],
	]) {
		const invalidRecord = passing.replace(`| ${field} | ${original} |`, `| ${field} | ${replacement} |`);
		const invalid = evaluateSoundscaperStable1ReleaseAdmission(
			parseSoundscaperStable1GuidedVerification(invalidRecord), {
				behaviorEnvironmentMatrix: MATRIX,
				qualificationEvidenceAudit: audit,
				nativeReadinessAudit,
			},
		);
		assert.equal(invalid.admitted, false, field);
		assert.equal(invalid.releaseCandidate[property], null, field);
		assert.match(invalid.reasons.join('\n'), reason, field);
	}

	for (const [name, brokenAudit, reason] of [
		['missing', undefined, /native-readiness audit is missing/iu],
		['invalid', null, /native-readiness audit is invalid/iu],
		['pending', { ...nativeReadinessAudit, status: 'pending' }, /native-readiness audit is not ready/iu],
		['typed blocked', blockedNativeReadinessAudit(), /professional payload is pending/iu],
		['short', { ...nativeReadinessAudit, targets: nativeReadinessAudit.targets.slice(0, 4) },
			/exactly five targets/iu],
		['missing external readiness', {
			...nativeReadinessAudit,
			targets: nativeReadinessAudit.targets.map((target, index) => index === 0
				? { ...target, productionReadinessSha256: null } : target),
			}, /invalid productionReadinessSha256/iu],
		['foreign native source revision', {
			...nativeReadinessAudit,
			targets: nativeReadinessAudit.targets.map((target, index) => index === 0
				? { ...target, sourceRevision: 'f'.repeat(40) } : target),
		}, /native target linux-x64.*source revision.*release candidate/iu],
	]) {
		const result = evaluateSoundscaperStable1ReleaseAdmission(passingParsed, {
			behaviorEnvironmentMatrix: MATRIX,
			qualificationEvidenceAudit: audit,
			nativeReadinessAudit: brokenAudit,
		});
		assert.equal(result.admitted, false, name);
		assert.match(result.reasons.join('\n'), reason, name);
	}

	const scopeReduced = passing.replace('| pass | run:', '| not-applicable | decision:invented run:');
	const reducedResult = evaluateSoundscaperStable1ReleaseAdmission(
		parseSoundscaperStable1GuidedVerification(scopeReduced), {
			behaviorEnvironmentMatrix: MATRIX,
			qualificationEvidenceAudit: audit,
			nativeReadinessAudit,
		},
	);
	assert.equal(reducedResult.admitted, false);
	assert.match(reducedResult.reasons.join('\n'), /not-applicable/iu);

	const changedText = passing.replace(
		SOUNDSCAPER_STABLE_1_CHECKS[0].check,
		`${SOUNDSCAPER_STABLE_1_CHECKS[0].check} Drifted.`,
	);
	assert.match(evaluateSoundscaperStable1ReleaseAdmission(
		parseSoundscaperStable1GuidedVerification(changedText), {
			behaviorEnvironmentMatrix: MATRIX,
			qualificationEvidenceAudit: audit,
			nativeReadinessAudit,
		},
	).reasons.join('\n'), /text changed/iu);
});

test('the v1.0.0 workflow admits, rehearses, deploys, and publishes only Soundscaper', async () => {
	const workflow = await readFile(new URL('.github/workflows/soundscaper-stable-1.yml', ROOT), 'utf8');
	assert.match(workflow, /tags:\s*\n\s*- 'v1\.0\.0'/u);
	assert.doesNotMatch(workflow, /framescaper/iu);
	assert.match(workflow, /resolveProductReleaseTag/u);
	assert.match(workflow, /release:soundscaper:stable-1:admission:json/u);
	assert.match(workflow, /npm run build:pages/u);
	assert.match(workflow, /SCAPE_PRODUCT: soundscaper/u);
	assert.match(workflow, /wrangler pages deploy dist --project-name=soundscaper --branch=main/u);
	assert.match(workflow, /npm run verify:pages/u);
	assert.match(workflow,
		/desktop:release-assets -- --product soundscaper\s+--admission-profile soundscaper-stable-1/u);
	assert.match(workflow, /Soundscaper-1\.0\.0-source\.tar\.gz/u);
	assert.match(workflow, /THIRD_PARTY_LICENSES\.md/u);
	assert.match(workflow, /SHA256SUMS/u);
	assert.match(workflow, /soundscaper-stable-lifecycle-smoke\.mjs/u);
	const deliveryRestartSmoke = workflowStep(
		workflow, 'Smoke persistent delivery restart and publication recovery',
	);
	assert.match(deliveryRestartSmoke, /matrix\.target\.platform == 'linux'.*matrix\.target\.arch == 'x64'/u);
	assert.match(deliveryRestartSmoke, /npm run desktop:smoke:persistent-delivery-restart/u);
	assert.match(deliveryRestartSmoke, /SOUNDSCAPER_SMOKE_XVFB: 'true'/u);
	assert.doesNotMatch(workflow, /gh run list/u,
		'the release never substitutes a newer successful candidate run');
	assert.match(workflow, /name: Download the exact admitted release record/u);
	assert.match(workflow, /outputs:\s*\n\s+candidate_commit_sha:/u);
	assert.ok([...workflow.matchAll(/ref: \$\{\{ needs\.admission\.outputs\.candidate_commit_sha \}\}/gu)].length >= 3,
		'every source-building downstream job checks out the admitted RC commit');
	assert.match(workflow, /git rev-parse --verify "\$candidate_commit_sha\^\{commit\}"/u);
	assert.match(workflow, /git rev-parse "\$candidate_commit_sha\^\{tree\}"/u);
	assert.match(workflow, /tagged_tree_sha=.*RELEASE_TAG.*\^\{tree\}/u,
		'the stable tag records its exact tree before checking out the admitted candidate');
	assert.match(workflow, /promoted_tree_sha="\$\(git write-tree\)"/u);
	assert.match(workflow, /test "\$promoted_tree_sha" = "\$tagged_tree_sha"/u,
		'the stable tag tree must equal the admitted candidate plus the deterministic metadata transition');
	assert.match(workflow, /promote-soundscaper-stable-1\.mjs --admission-json/u);
	assert.match(workflow, /npm run check:static/u);
	for (const shard of ['soundscaper', 'common']) {
		assert.match(workflow, new RegExp(`npm test -- --shard=${shard}`, 'u'));
	}
	const admissionJob = workflowJob(workflow, 'admission');
	assert.match(admissionJob,
		/Provision interchange conformance reference tools[\s\S]*npm run provision:interchange-conformance[\s\S]*npm test -- --shard=common/u,
		'the clean stable-tag checkout provisions the pinned readers before the common reference tests');
	assert.match(workflow, /soundscaper-stable-1-admission\.json/u);
	const assembly = workflowJob(workflow, 'assemble');
	const professionalSource = workflowJob(workflow, 'professional-source');
	assert.match(professionalSource, /provision:milestone-5-native-sources/u);
	assert.doesNotMatch(workflow, /--root=/u,
		'the provisioning CLI requires the root path as a separate argument');
	for (const id of [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2',
	]) assert.match(professionalSource, new RegExp(`--source ${id}`, 'u'));
	assert.doesNotMatch(professionalSource, /--source (?:x264|x265|libvpx|libopus)/u);
	assert.match(professionalSource, /name: soundscaper-professional-native-source-cache/u);
	assert.match(assembly, /name: Download the authenticated professional-native source cache/u);
	assert.match(assembly, /SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT:/u);
	assert.match(assembly, /Soundscaper-professional-native-compliance\.json/u);
	assert.match(assembly, /name: Download the authenticated admission JSON/u);
	assert.match(assembly, /release\/desktop\/soundscaper-stable-1-admission\.json/u);
	assert.match(workflow, /candidate\.desktopPreviewWorkflowRunId/u);
	assert.match(workflow, /validateSoundscaperStable1CandidateWorkflowRun/u);
	assert.match(workflow, /authenticateSoundscaperStable1CandidateArtifact/u);
	assert.match(workflow, /gh run view "\$run_id"/u);
	assert.match(workflow, /gh run download "\$run_id" --name release-inventory/u);
	assert.match(workflow, /gh run download "\$run_id" --name "nightly-soundscaper-\$TARGET_ID"/u);
	assert.match(workflow, /gh release create .*--draft/isu);
	assert.match(workflow, /gh release edit .*--draft=false/isu);
	assert.equal([...workflow.matchAll(/GH_REPO: \$\{\{ github\.repository \}\}/gu)].length, 3);
	assert.equal([...workflow.matchAll(/npm install --global npm@12\.0\.1/gu)].length, 6,
		'every Stable 1 job that executes repository code pins the declared npm runtime');
	const targets = [...workflow.matchAll(/platform:\s*(linux|mac|win)\s+arch:\s*(x64|arm64)/gu)]
		.map((match) => `${match[1]}-${match[2]}`);
	assert.deepEqual([...new Set(targets)].sort(), [
		'linux-arm64', 'linux-x64', 'mac-arm64', 'win-arm64', 'win-x64',
	]);
	assert.match(workflow, /^permissions: \{\}$/mu,
		'the workflow token starts with no ambient repository authority');
	const jobs = Object.fromEntries([
		'admission', 'professional-source', 'package', 'lifecycle', 'assemble', 'draft-release',
		'deploy-web', 'publish-release',
	].map((name) => [name, workflowJob(workflow, name)]));
	for (const name of ['admission', 'professional-source', 'package', 'assemble', 'deploy-web']) {
		assert.match(jobs[name], /permissions:\s*\n\s+contents: read/u, `${name} can only read source`);
		assert.doesNotMatch(jobs[name], /contents: write/u, `${name} cannot mutate repository releases`);
		assert.doesNotMatch(jobs[name], /actions: read/u, `${name} does not use the Actions API`);
	}
	assert.match(jobs.lifecycle, /permissions:\s*\n\s+actions: read\s*\n\s+contents: read/u);
	assert.doesNotMatch(jobs.lifecycle, /contents: write/u);
	for (const name of ['draft-release', 'publish-release']) {
		assert.match(jobs[name], /permissions:\s*\n\s+contents: write/u, `${name} owns release mutation`);
	}
	assert.equal([...workflow.matchAll(/contents: write/gu)].length, 2,
		'only draft creation and final publication receive contents:write');
	const actionReferences = [...workflow.matchAll(/^\s+uses: (?<reference>\S+)/gmu)]
		.map(({ groups }) => groups.reference);
	assert.ok(actionReferences.length > 0);
	assert.deepEqual(actionReferences.filter((reference) => !/@[a-f0-9]{40}$/u.test(reference)), [],
		'every third-party workflow action is immutable-commit pinned');

	const windowsCredentials = workflowStep(workflow, 'Require stable Windows signing credentials');
	const windowsCodec = workflowStep(workflow, 'Build the target-native Windows audio codec host');
	const macCredentials = workflowStep(workflow, 'Require stable macOS signing and notarization credentials');
	const macCertificateImport = workflowStep(workflow, 'Import the macOS signing certificate');
	const macCodec = workflowStep(workflow, 'Build the signed target-native macOS audio codec host');
	const linuxStage = workflowStep(workflow, 'Stage the admitted Linux renderer and authenticated runtimes');
	const windowsStage = workflowStep(workflow, 'Stage the admitted Windows renderer and authenticated runtimes');
	const macStage = workflowStep(workflow, 'Stage the admitted macOS renderer and authenticated runtimes');
	const linuxPackage = workflowStep(workflow, 'Build unsigned Stable 1 Linux packages');
	const windowsPackage = workflowStep(workflow, 'Build signed Stable 1 Windows packages');
	const macPackage = workflowStep(workflow, 'Build signed and notarized Stable 1 macOS packages');
	assert.doesNotMatch(`${linuxStage}\n${linuxPackage}`, /secrets\.|CSC_LINK|APPLE_ID|MAC_SIGNING/u,
		'Linux never receives signing or notarization credentials');
	assert.match(windowsPackage, /secrets\.SOUNDSCAPER_WINDOWS_SIGNING_CERTIFICATE/u);
	assert.match(windowsPackage, /secrets\.SOUNDSCAPER_WINDOWS_SIGNING_PASSWORD/u);
	assert.doesNotMatch(`${windowsCredentials}\n${windowsCodec}\n${windowsStage}\n${windowsPackage}`,
		/SOUNDSCAPER_MAC_|APPLE_|secrets\.SOUNDSCAPER_MAC/u,
		'Windows never receives Apple or macOS credentials');
	assert.match(macStage, /secrets\.SOUNDSCAPER_MAC_SIGNING_IDENTITY/u);
	assert.match(macCertificateImport,
		/apple-actions\/import-codesign-certs@[a-f0-9]{40}/u,
		'the certificate importer is immutable-commit pinned');
	assert.match(macCertificateImport, /secrets\.SOUNDSCAPER_MAC_SIGNING_CERTIFICATE/u);
	assert.doesNotMatch(macPackage, /secrets\.SOUNDSCAPER_MAC_SIGNING_CERTIFICATE/u,
		'electron-builder discovers the already imported identity instead of receiving the P12 again');
	assert.match(macPackage, /secrets\.SOUNDSCAPER_APPLE_ID/u);
	assert.doesNotMatch(`${macCredentials}\n${macCertificateImport}\n${macCodec}\n${macStage}\n${macPackage}`,
		/SOUNDSCAPER_WINDOWS_/u,
		'macOS never receives Windows credentials');
	assert.match(macCodec, /SOUNDSCAPER_MAC_SIGNING_IDENTITY: \$\{\{ secrets\.SOUNDSCAPER_MAC_SIGNING_IDENTITY \}\}/u,
		'the codec build and desktop staging authenticate the same Developer ID identity');
});

test('stable lifecycle plans install the candidate, upgrade, and roll back on every target', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		const [platform, arch] = target.split('-');
		const extension = platform === 'linux' ? 'deb' : platform === 'mac' ? 'dmg' : 'exe';
		const packageTarget = platform === 'linux' && arch === 'x64' ? 'linux-amd64'
			: `${platform}-${arch}`;
		const plan = createSoundscaperStableLifecyclePlan({
			target,
			candidatePackage: `/candidate/Soundscaper-1.0.0-rc.1-${packageTarget}.${extension}`,
			stablePackage: `/stable/Soundscaper-1.0.0-${packageTarget}.${extension}`,
			installRoot: '/tmp/soundscaper-stable-lifecycle-install',
		});
		assert.equal(plan.target, target);
		assert.deepEqual(plan.stages.map(({ id, version }) => [id, version]), [
			['candidate-install-open', '1.0.0-rc.1'],
			['stable-upgrade-reopen', '1.0.0'],
			['candidate-rollback-reopen', '1.0.0-rc.1'],
		]);
	}
	assert.throws(() => createSoundscaperStableLifecyclePlan({
		target: 'linux-x64',
		candidatePackage: '/candidate/Frames-1.0.0-rc.1-linux-amd64.deb',
		stablePackage: '/stable/Soundscaper-1.0.0-linux-amd64.deb',
		installRoot: '/tmp/install',
	}), /candidate package name/iu);
});

function passingNativeReadinessAudit() {
	return {
		schemaVersion: 1,
		status: 'ready',
		blockers: [],
		targets: ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].map((id, index) => ({
				id,
				status: 'ready',
				sourceRevision: '0123456789abcdef0123456789abcdef01234567',
			payloadSha256: String(index + 1).repeat(64),
			buildCandidateSha256: String(index + 2).repeat(64),
			productionReadinessSha256: String(index + 3).repeat(64),
		})),
	};
}

function blockedNativeReadinessAudit() {
	const targets = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'];
	return {
		schemaVersion: 1,
		status: 'blocked',
		targets: targets.map((id) => ({
			id,
			status: 'blocked',
			blockers: ['The professional payload is pending.'],
		})),
		blockers: targets.map((target) => ({
			target,
			detail: 'The professional payload is pending.',
		})),
	};
}

function passingRecord(markdown, requirements) {
	const runIds = new Map();
	for (const cellIds of requirements.values()) {
		for (const cellId of cellIds) runIds.set(cellId, `S1-${cellId}`);
	}
	const filled = markdown
		.replace(CHECK_ROW, (...arguments_) => {
			const groups = arguments_.at(-1);
			const [, leading, , separator, trailing] = arguments_;
			return `${leading}pass${separator}${requirements.get(groups.id)
				.map((cellId) => `run:${runIds.get(cellId)}`).join(' ')}${trailing}`;
		})
		.replace('| Campaign identifier | pending |', '| Campaign identifier | S1-CAMPAIGN-001 |')
		.replace('| Campaign coordinator | pending |', '| Campaign coordinator | Release owner |')
		.replace('| Release candidate | pending |', '| Release candidate | 1.0.0-rc.1 |')
		.replace('| Baseline commit SHA | pending |', '| Baseline commit SHA | abcdef0123456789 |')
		.replace('| Release candidate commit SHA | pending |',
			'| Release candidate commit SHA | 0123456789abcdef0123456789abcdef01234567 |')
		.replace('| Desktop preview workflow run ID | pending |',
			'| Desktop preview workflow run ID | 12345678901 |')
		.replace('| Release candidate package inventory SHA-256 | pending |',
			`| Release candidate package inventory SHA-256 | ${'a'.repeat(64)} |`)
		.replace('| Supported-matrix decision | pending |', '| Supported-matrix decision | decision:s1-matrix |')
		.replace('| Automated gate artifact | pending |', '| Automated gate artifact | artifact:s1-gates |')
		.replace('| Evidence root | pending |', '| Evidence root | evidence:s1 |')
		.replace(
			'| pending | pending | pending | pending | pending | pending | pending | pending |',
			[...runIds].map(([cellId, runId]) =>
				`| ${runId} | 2026-09-01T12:00:00Z | Verifier | abcdef0 / package | soundscaper | cell:${cellId} | exact hardware | evidence:${runId} |`,
			).join('\n'),
		);
	const marker = '## Completion record';
	const index = filled.indexOf(marker);
	return `${filled.slice(0, index)}${filled.slice(index).replace(
		/^\| (?<field>[^|]+?) \| pending \|$/gmu,
		(_row, ...arguments_) => {
			const { field } = arguments_.at(-1);
			return `| ${field} | ${field === 'Soundscaper Stable 1 release conclusion' ? 'pass' : 'recorded'} |`;
		},
	)}`;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function evidencePin(name) {
	return {
		path: `qualification/soundscaper-stable-1/${name}.json`,
		byteLength: 1,
		sha256: 'c'.repeat(64),
	};
}

function workflowJob(source, name) {
	const marker = `\n  ${name}:\n`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `workflow job ${name} exists`);
	const nextJob = /\n {2}[a-z][a-z0-9-]*:\n/gu;
	nextJob.lastIndex = start + marker.length;
	const next = nextJob.exec(source);
	return source.slice(start, next === null ? source.length : next.index);
}

function workflowStep(source, name) {
	const marker = `      - name: ${name}\n`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `workflow step ${name} exists`);
	const next = source.indexOf('\n      - name:', start + marker.length);
	return source.slice(start, next === -1 ? source.length : next);
}

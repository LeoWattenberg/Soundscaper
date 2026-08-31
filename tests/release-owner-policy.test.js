/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const releasePolicy = await readFile(new URL('../docs/release-policy.md', import.meta.url), 'utf8');
const soundscaperQa = await readFile(new URL('../docs/qa/soundscaper.md', import.meta.url), 'utf8');
const framescaperQa = await readFile(new URL('../docs/qa/framescaper.md', import.meta.url), 'utf8');
const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const interchangeConformance = await readFile(
	new URL('../docs/interchange-conformance.md', import.meta.url), 'utf8');
const notices = await readFile(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8');
const technicalReadme = await readFile(new URL('../Technical_README.md', import.meta.url), 'utf8');
const threatModel = await readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8');
const securityMatrix = JSON.parse(await readFile(
	new URL('../config/production-security-matrix.json', import.meta.url), 'utf8'));
const compatibilityPolicy = JSON.parse(await readFile(
	new URL('../config/project-compatibility.json', import.meta.url), 'utf8'));

test('the owner decides a release from real CI and optional manual QA', () => {
	assert.match(releasePolicy, /pushing the stable tag is the owner's\s+release decision/iu);
	assert.match(releasePolicy, /automated tests.*what actually ran/isu);
	assert.match(releasePolicy, /manual QA.*never.*CI gate/isu);
	assert.doesNotMatch(releasePolicy, /qualification matrix|admission evidence|approved waiver|requalif/iu);
});

test('both QA templates hold releases for the three non-negotiable bug classes', () => {
	for (const template of [soundscaperQa, framescaperQa]) {
		assert.match(template, /Do not release with a known data-loss, security, or primary-workflow failure/u);
		assert.match(template, /Everything else is an owner decision/u);
	}
});

test('owner commands expose QA, release preparation, and soak debugging without formal aliases', () => {
	assert.equal(packageManifest.scripts['qa:new'], 'node scripts/create-qa-run.mjs');
	assert.equal(packageManifest.scripts['release:soundscaper:prepare'],
		'node scripts/prepare-soundscaper-release.mjs');
	assert.equal(packageManifest.scripts['debug:soak'], 'node scripts/run-soundscaper-soak.mjs');
	assert.doesNotMatch(
		JSON.stringify(packageManifest.scripts),
		/release:[^" ]*(?:admission|promot)|quality:cohort|qualification-evidence|trusted-lab|milestone5a:lab-diagnostic/iu,
	);
});

test('the fixed M5A lab and cohort harness is gone', async () => {
	for (const path of [
		'../desktop/native-helper-lab-diagnostic.ts',
		'../scripts/run-m5a-native-lab-diagnostic.mjs',
		'../tests/desktop-native-helper-lab-diagnostic.test.ts',
	]) await assert.rejects(access(new URL(path, import.meta.url)), /ENOENT/u);
});

test('the deleted severity register is not runtime-integrity evidence', async () => {
	await assert.rejects(access(new URL('../config/release-severity-policy.json', import.meta.url)), /ENOENT/u);
	const manifest = JSON.parse(await readFile(
		new URL('../config/ffmpeg-runtime-manifest.json', import.meta.url), 'utf8',
	));
	assert.equal(Object.hasOwn(manifest.evidence, 'releaseSeverityPolicy'), false);
	assert.doesNotMatch(JSON.stringify(manifest), /release-severity-policy/u);
});

test('interchange tooling has a real notice instead of an approval restamping task', () => {
	assert.doesNotMatch(
		interchangeConformance,
		/Outstanding: the third-party notices entry|review\.payloadSha256|status: approved|re-stamp/iu,
	);
	assert.match(interchangeConformance, /third-party notices.*already records/isu);
	for (const dependency of [
		'opentimelineio 0.18.1',
		'otio-cmx3600-adapter 1.0.0',
		'otio-fcpx-xml-adapter 1.0.0',
	]) assert.ok(notices.includes(dependency), `${dependency} notice is missing`);
});

test('legacy FFmpeg diagnostics require concrete checks, not human approval', () => {
	assert.doesNotMatch(
		threatModel,
		/protected independent approval|rollback qualification change|## Review and release rules|acceptance evidence named in the matrix|release review/iu,
	);
	assert.match(threatModel, /## Model maintenance rules/iu);
	assert.doesNotMatch(
		technicalReadme,
		/publication blockers have received their existing approvals|two gated steps/iu,
	);
	assert.match(technicalReadme, /legacy\s+diagnostic commands/iu);
});

test('fixed-host workflows report what was exercised without issuing qualification verdicts', () => {
	const archiveExpansion = securityMatrix.risks.find(
		({ id }) => id === 'scape-archive-expansion');
	const sharedLibrary = securityMatrix.risks.find(
		({ id }) => id === 'shared-desktop-project-library-integrity');
	const packagedOpen = archiveExpansion.currentControls.find(
		({ id }) => id === 'packaged-linux-x64-current-schema-scape-open');
	const packagedReopen = archiveExpansion.currentControls.find(
		({ id }) => id === 'packaged-linux-x64-current-schema-scape-reopen');
	for (const control of [packagedOpen, packagedReopen]) {
		assert.match(control.summary, /exercises only/iu);
		assert.match(control.summary, /does not exercise/iu);
		assert.doesNotMatch(control.summary, /\bqualif(?:y|ies|ied|ication)\b/iu);
	}
	for (const id of [
		'shared-library-cross-product-media-availability',
		'shared-library-packaged-platform-durability',
	]) {
		const risk = sharedLibrary.residualRisks.find((candidate) => candidate.id === id);
		assert.doesNotMatch(`${risk.exposure}\n${risk.requiredControl}`, /\bqualif(?:y|ies|ied|ication)\b/iu);
		assert.match(`${risk.exposure}\n${risk.requiredControl}`, /exercised|not exercised/iu);
	}
	const historicalWorkflow = compatibilityPolicy.rules.find(
		({ id }) => id === 'current-desktop-packaged-source-bearing-handoff');
	assert.doesNotMatch(historicalWorkflow.currentBehavior, /\bqualif(?:y|ies|ied|ication)\b/iu);
	assert.match(historicalWorkflow.currentBehavior, /exercised|not exercised/iu);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityPolicyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const securityMatrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const compatibilityDocumentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

interface CompatibilityRule {
	readonly id: string;
	readonly status: string;
	readonly requiredOutcome: string;
	readonly currentBehavior: string;
	readonly evidence: readonly string[];
}

interface SecurityControl {
	readonly id: string;
	readonly summary: string;
	readonly evidence: ReadonlyArray<Readonly<{ kind: string; path: string }>>;
}

interface SecurityRisk {
	readonly id: string;
	readonly currentControls: readonly SecurityControl[];
}

const PROJECTOR_EVIDENCE = [
	'src/common/editor/project-feature-video-clip-render-v1.ts',
	'src/common/editor/project-feature-video-rendered-fallback.ts',
	'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
] as const;

const INTEGRITY_EVIDENCE = [
	'src/common/editor/project-fallback-integrity-snapshot.ts',
	'tests/audio-editor-project-fallback-integrity-relationships.test.ts',
] as const;
const EXPORT_EVIDENCE = [
	'tests/audio-editor-video-rendered-fallback-delivery-projection.test.ts',
	'tests/audio-editor-video-clip-fallback-export-regression.test.ts',
] as const;
const PORTABILITY_EVIDENCE = [
	'tests/audio-editor-scape-video-clip-fallback-roundtrip.test.ts',
	'tests/audio-editor-desktop-shared-project-video-clip-fallback-handoff.test.ts',
] as const;

test('compatibility policy owns the closed rendered-fallback relationship schema', async () => {
	const policy = await compatibilityPolicy();
	const core = compatibilityRule(policy, 'project-feature-requirements-core');
	assert.equal(core.status, 'implemented');
	assertSemanticClaims(core.currentBehavior, [
		['current manifest schema', /feature-requirements manifest schema 2/iu],
		['closed role union', /closed.*roles?/iu],
		['whole-audio role', /project-audio-mix-v1/u],
		['whole-video role', /project-video-render-v1/u],
		['clip-video role', /video-clip-render-v1/u],
		['legacy normalization', /schema 1.*deterministic.*whole-project.*role/iu],
	]);
	assertEvidencePaths(core.evidence, [
		'src/common/editor/project-feature-requirements.ts',
		'tests/audio-editor-project-feature-requirements.test.ts',
	]);
});

test('compatibility policy narrowly qualifies target-only video-effects clip projection and delivery', async () => {
	const policy = await compatibilityPolicy();
	const playback = compatibilityRule(policy, 'current-video-rendered-fallback-playback');
	const integrity = compatibilityRule(policy, 'current-controller-rendered-fallback-integrity');
	assert.equal(playback.status, 'implemented');
	assertSemanticClaims(playback.currentBehavior, [
		['clip role ownership', /video-clip-render-v1.*videoEffects/iu],
		['exact target', /exact.*target clip ID/iu],
		['distinct silent fallback', /fallback source.*different.*canonical source.*hasAudio.*false/iu],
		['duration geometry', /frame count.*target.*duration/iu],
		['canonical-source geometry', /sample rate.*width.*height.*frame rate.*canonical source/iu],
		['target-only projection', /only.*target.*timeline clip/iu],
		['preserved placement and membership', /track membership.*timeline placement.*duration.*group.*A\/V link/iu],
		['neutral source-local transforms', /source.*frame zero.*trim.*zero.*speed.*one.*video effects.*empty/iu],
		['ordinary video export', /ordinary.*video (?:composition|export).*projected.*target/iu],
		['packaged activation', /Linux x64 packaged workflow.*activation and transport playback.*both frozen video roles/iu],
		['packaged delivery residual', /packaged.*final-delivery.*unqualified/iu],
	]);
	assertSemanticClaims(integrity.currentBehavior, [
		['relationship selector', /selector.*role.*target clip ID/iu],
		['relationship currentness', /snapshot.*role.*target.*ID.*current/iu],
	]);
	await assertCompatibilityEvidence(playback, PROJECTOR_EVIDENCE);
	await assertCompatibilityEvidence(playback, EXPORT_EVIDENCE);
	await assertCompatibilityEvidence(integrity, INTEGRITY_EVIDENCE);
});

test('compatibility policy binds portable Scape and managed handoff witnesses', async () => {
	const policy = await compatibilityPolicy();
	const scape = compatibilityRule(policy, 'current-scape-feature-requirements');
	const scapeIntegrity = compatibilityRule(policy, 'current-scape-rendered-fallback-integrity');
	const handoff = compatibilityRule(policy, 'current-video-rendered-fallback-playback');
	assertSemanticClaims(scape.currentBehavior, [
		['clip relationship preservation', /video-clip-render-v1.*target clip ID/iu],
		['collision remap scope', /copy.*collision.*remap.*fallback source ID.*preserv.*target clip or track ID/iu],
	]);
	assertSemanticClaims(scapeIntegrity.currentBehavior, [
		['archive relationship binding', /role.*target clip or track ID.*source ID.*SHA-256/iu],
	]);
	assertSemanticClaims(handoff.currentBehavior, [
		['managed fresh-recipient handoff', /video-clip-render-v1.*managed.*fresh recipient/iu],
		['canonical target and exact body', /target clip ID.*fallback.*body.*digest/iu],
	]);
	await assertCompatibilityEvidence(scape, PORTABILITY_EVIDENCE.slice(0, 1));
	await assertCompatibilityEvidence(handoff, PORTABILITY_EVIDENCE.slice(1));
});

test('security controls bind the clip relationship through playback, integrity, and export', async () => {
	const matrix = await securityMatrix();
	const projectDocuments = securityRisk(matrix, 'external-project-document-validation');
	const playback = securityControl(projectDocuments, 'video-rendered-fallback-playback');
	const delivery = securityControl(projectDocuments, 'video-rendered-fallback-export');
	assertSemanticClaims(playback.summary, [
		['closed clip role', /video-clip-render-v1.*videoEffects/iu],
		['target and geometry', /target clip ID.*frame count.*duration.*sample rate.*width.*height.*frame rate/iu],
		['silent distinct source', /different.*canonical source.*hasAudio.*false/iu],
		['target-only transient state', /only.*target.*track membership.*timeline placement.*canonical.*unchanged/iu],
		['managed handoff witness', /managed.*fresh recipient.*target clip ID.*fallback body.*digest/iu],
		['packaged activation', /Linux x64 packaged workflow.*activation and transport playback.*both frozen video roles/iu],
		['packaged delivery residual', /packaged.*final-delivery.*unqualified/iu],
	]);
	assertSemanticClaims(delivery.summary, [
		['role-target selector', /selector.*role.*target clip ID.*source ID.*SHA-256/iu],
		['ordinary delivery witness', /video-clip-render-v1.*ordinary.*video (?:composition|export)/iu],
		['canonical state', /canonical project.*history.*save.*unchanged/iu],
	]);
	await assertSecurityEvidence(playback, PROJECTOR_EVIDENCE);
	await assertSecurityEvidence(playback, PORTABILITY_EVIDENCE.slice(1));
	await assertSecurityEvidence(delivery, [...INTEGRITY_EVIDENCE, ...EXPORT_EVIDENCE]);
});

test('compatibility and security documents state the slice and its narrow non-goals', async () => {
	const compatibility = normalize(await readFile(compatibilityDocumentationUrl, 'utf8'));
	const threatModel = normalize(await readFile(threatModelUrl, 'utf8'));
	for (const [name, documentation] of [
		['compatibility documentation', compatibility],
		['production threat model', threatModel],
	] as const) {
		assertSemanticClaims(documentation, [
			[`${name}: schema roles`, /manifest schema 2.*project-audio-mix-v1.*project-video-render-v1.*video-clip-render-v1/iu],
			[`${name}: legacy normalization`, /schema 1.*deterministic.*whole-project.*roles?/iu],
			[`${name}: clip qualification`, /video-clip-render-v1.*videoEffects.*target clip ID/iu],
			[`${name}: target projection`, /only.*target.*track membership.*timeline placement.*canonical.*unchanged/iu],
			[`${name}: relationship integrity`, /integrity.*role.*target clip ID.*source ID.*SHA-256/iu],
			[`${name}: export and portability`, /ordinary.*video export.*portable.*\.scape.*collision.*managed.*handoff/iu],
		]);
		assertNarrowNonGoals(documentation, name);
	}
});

async function compatibilityPolicy(): Promise<Readonly<{ rules: readonly CompatibilityRule[] }>> {
	return JSON.parse(await readFile(compatibilityPolicyUrl, 'utf8')) as Readonly<{
		rules: readonly CompatibilityRule[];
	}>;
}

async function securityMatrix(): Promise<Readonly<{ risks: readonly SecurityRisk[] }>> {
	return JSON.parse(await readFile(securityMatrixUrl, 'utf8')) as Readonly<{
		risks: readonly SecurityRisk[];
	}>;
}

function compatibilityRule(
	policy: Readonly<{ rules: readonly CompatibilityRule[] }>,
	id: string,
): CompatibilityRule {
	const rule = policy.rules.find((candidate) => candidate.id === id);
	if (!rule) throw new ReferenceError(`Missing compatibility rule ${id}.`);
	return rule;
}

function securityRisk(
	matrix: Readonly<{ risks: readonly SecurityRisk[] }>,
	id: string,
): SecurityRisk {
	const risk = matrix.risks.find((candidate) => candidate.id === id);
	if (!risk) throw new ReferenceError(`Missing security risk ${id}.`);
	return risk;
}

function securityControl(risk: SecurityRisk, id: string): SecurityControl {
	const control = risk.currentControls.find((candidate) => candidate.id === id);
	if (!control) throw new ReferenceError(`Missing security control ${id}.`);
	return control;
}

function assertSemanticClaims(
	text: string,
	claims: ReadonlyArray<readonly [label: string, pattern: RegExp]>,
): void {
	for (const [label, pattern] of claims) assert.match(text, pattern, label);
}

function assertEvidencePaths(actual: readonly string[], expected: readonly string[]): void {
	for (const path of expected) assert.ok(actual.includes(path), `missing policy evidence: ${path}`);
}

async function assertCompatibilityEvidence(
	rule: CompatibilityRule,
	paths: readonly string[],
): Promise<void> {
	assertEvidencePaths(rule.evidence, paths);
	await assertExistingPaths(paths);
}

async function assertSecurityEvidence(control: SecurityControl, paths: readonly string[]): Promise<void> {
	for (const path of paths) {
		assert.ok(control.evidence.some((item) => item.path === path), `missing security evidence: ${path}`);
	}
	await assertExistingPaths(paths);
}

async function assertExistingPaths(paths: readonly string[]): Promise<void> {
	for (const path of paths) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
	}
}

function assertNarrowNonGoals(text: string, name: string): void {
	assertSemanticClaims(text, [
		[`${name}: generic authoring`, /generic.*authoring.*unqualified/iu],
		[`${name}: third-party activation`, /third-party.*activation.*unqualified/iu],
		[`${name}: multiple clip fallbacks`, /multiple.*clip.*fallbacks?.*unqualified/iu],
		[`${name}: unmanaged delivery`, /linked.*unmanaged.*delivery.*unqualified/iu],
		[`${name}: packaged runtime`, /packaged.*unqualified/iu],
		[`${name}: browser behavior`, /browser.*unqualified/iu],
		[`${name}: codec qualification`, /codec.*unqualified/iu],
		[`${name}: reference scale`, /reference-scale.*unqualified/iu],
	]);
}

function normalize(value: string): string {
	return value.replace(/\s+/gu, ' ');
}

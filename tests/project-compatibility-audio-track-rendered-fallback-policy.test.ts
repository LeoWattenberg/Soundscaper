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
	'src/common/editor/project-feature-audio-track-render-v1.ts',
	'src/common/editor/project-feature-audio-rendered-fallback.ts',
	'tests/audio-editor-project-feature-audio-track-render-v1.test.ts',
] as const;
const DELIVERY_EVIDENCE = [
	'tests/audio-editor-audio-track-render-fallback-delivery.test.ts',
	'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
] as const;
const PORTABILITY_EVIDENCE = [
	'tests/audio-editor-scape-audio-track-fallback-roundtrip.test.ts',
] as const;
const HANDOFF_EVIDENCE = [
	'tests/desktop-project-library-audio-track-render-fallback-handoff.test.ts',
] as const;

test('compatibility policy narrowly qualifies the track-local audio-effects render relationship', async () => {
	const policy = await compatibilityPolicy();
	const rule = compatibilityRule(policy, 'current-audio-track-rendered-fallback');
	assert.equal(rule.status, 'implemented');
	assertSemanticClaims(rule.requiredOutcome, [
		['track role ownership', /audio-effects requirement.*unavailable.*audio-track-render-v1/iu],
		['target-only projection', /exactly one audio track.*clip lane.*active effect rack/iu],
		['native remainder', /every other lane.*mixer routing.*master processing stays native/iu],
		['private delivery', /selector-bound operation-time verification.*private digest-bound chunk provider.*ordinary lanes.*ordinary sources/iu],
		['portable roundtrip', /portable \.scape.*preserve the exact track relationship.*collision copy.*only the fallback source identity/iu],
		['managed handoff outcome', /explicit managed handoff carries the relationship.*ordinary lane sources.*fresh recipient.*manifest-only reference/iu],
	]);
	assertSemanticClaims(rule.currentBehavior, [
		['single audio fallback', /at most one audio rendered fallback of either closed audio role.*ambiguous/iu],
		['registered unavailable only', /registered audioEffects item.*unavailable.*unknown availability never qualifies/iu],
		['manifest target validation', /exactly one existing audio track.*active effect rack.*at least one enabled.*effect.*non-empty clip lane/iu],
		['lane extent geometry', /frameCount must equal the lane extent/iu],
		['tracks fail closed', /supplies no tracks fails closed/iu],
		['neutral rendered lane', /replaces only the target lane.*neutral rendered clip.*frame zero.*lane extent.*neutralizes only that track's rack/iu],
		['retained mix identity', /identity, gain, pan, mute, solo, and envelope.*native mixing and routing still apply/iu],
		['ordinary lane sources', /ordinary lanes still load their ordinary sources.*skips ordinary source loading only when the whole-mix role/iu],
		['admission binding', /admission capture binds the target track's type, rack activity, effect identity and inertness flags, lane membership, and exact lane placement/iu],
		['selector target binding', /selector carrying the role and exact target track ID.*selection, currentness, and conflicting-claim comparison/iu],
		['merged private delivery', /ordinary source buffers and chunk providers with the fallback source removed.*readable only through the operation-time digest-bound private provider/iu],
		['time-pitch and refusal', /committed time-pitch caches are prepared for the native lanes.*missing ordinary sources still refuse export.*stems, BW64, and any ADM setting reject/iu],
		['final-video composition', /same composition reaches the audio side of maintained final-video delivery/iu],
		['portable preservation', /retains the relationship and exact target track ID.*copy collision remaps only the fallback source identity/iu],
		['managed handoff witness', /editable compatible sender whose ordinary save stays document-only.*fresh recipient that reports the registered capability unavailable.*byte-exact canonical shadow.*refuses delivery on corrupted recipient-local render PCM.*mixes the native lane with the verified private provider/iu],
		['affected-object naming', /names the replaced track and each timeline clip its lane anchors/iu],
		['packaged activation', /exact Linux x64 packaged workflow.*source\/component UI activation and transport playback/iu],
		['narrow non-goals', /group, send, and master-scoped roles.*multiple simultaneous audio fallbacks.*packaged final delivery or browser qualification beyond the portable roundtrip and maintained managed handoff.*third-party feature-code activation remain unqualified/iu],
	]);
	await assertCompatibilityEvidence(rule, PROJECTOR_EVIDENCE);
	await assertCompatibilityEvidence(rule, DELIVERY_EVIDENCE);
	await assertCompatibilityEvidence(rule, PORTABILITY_EVIDENCE);
	await assertCompatibilityEvidence(rule, HANDOFF_EVIDENCE);
});

test('the schema rule owns the closed track relationship', async () => {
	const policy = await compatibilityPolicy();
	const core = compatibilityRule(policy, 'project-feature-requirements-core');
	assertSemanticClaims(core.currentBehavior, [
		['track role listed', /audio-track-render-v1/u],
		['track validation', /track role is restricted to audioEffects.*target track ID.*active effect rack.*enabled effect.*non-empty clip lane/iu],
		['lane geometry', /exact timeline placement.*must not reference the fallback source.*frameCount must equal the lane extent/iu],
		['tracks threading', /receives the project tracks at every validation, creation, clone, commit, remap, and inspection call site/iu],
	]);
	assertEvidencePaths(core.evidence, [
		'src/common/editor/project-feature-audio-track-render-v1.ts',
		'tests/audio-editor-project-feature-audio-track-render-v1.test.ts',
	]);
});

test('security controls bind the track relationship through playback, integrity, and delivery', async () => {
	const matrix = await securityMatrix();
	const projectDocuments = securityRisk(matrix, 'external-project-document-validation');
	const playback = securityControl(projectDocuments, 'audio-rendered-fallback-playback');
	const delivery = securityControl(projectDocuments, 'audio-rendered-fallback-export');
	const admission = securityControl(projectDocuments, 'controller-rendered-fallback-admission');
	assertSemanticClaims(playback.summary, [
		['closed track role', /audio-track-render-v1.*registered audioEffects item reported unavailable/iu],
		['target and lane geometry', /target track ID.*non-empty audio clip lane.*exact timeline placement.*extent.*equal exactly/iu],
		['target-only transient state', /replaces only that lane.*neutralizes only that rack.*every other lane, mixer, and master rack stays native/iu],
		['admission binding', /rack activity, effect identity and inertness flags, lane membership, and exact lane placement/iu],
		['managed handoff', /reaches explicit managed handoff to a fresh recipient.*editable compatible sender/iu],
		['packaged activation', /exact Linux x64 packaged.*UI activation and transport playback.*qualified.*packaged final delivery and browser qualification remain open/iu],
	]);
	assertSemanticClaims(delivery.summary, [
		['role-target selector', /binds the closed role and exact target track ID/iu],
		['merged private render', /ordinary source buffers and chunk providers with the fallback source removed.*readable only through the verified private provider/iu],
		['native lane caches', /committed time-pitch caches are prepared for the native lanes.*missing ordinary sources still refuse export/iu],
	]);
	assertSemanticClaims(admission.summary, [
		['claim targets', /conflicting relationship roles and target clip or track IDs/iu],
		['audio selector union', /closed role union.*null whole-mix target or one exact target track ID/iu],
	]);
	await assertSecurityEvidence(playback, [...PROJECTOR_EVIDENCE.slice(0, 1), ...HANDOFF_EVIDENCE]);
	await assertSecurityEvidence(delivery, [...DELIVERY_EVIDENCE.slice(0, 1), ...PORTABILITY_EVIDENCE, ...HANDOFF_EVIDENCE]);
});

test('compatibility and security documents state the track slice and its narrow non-goals', async () => {
	const compatibility = normalize(await readFile(compatibilityDocumentationUrl, 'utf8'));
	const threatModel = normalize(await readFile(threatModelUrl, 'utf8'));
	for (const [name, documentation] of [
		['compatibility documentation', compatibility],
		['production threat model', threatModel],
	] as const) {
		assertSemanticClaims(documentation, [
			[`${name}: schema roles`, /`project-audio-mix-v1`, `audio-track-render-v1`, `project-video-render-v1`, and `video-clip-render-v1`/u],
			[`${name}: track qualification`, /audio-track-render-v1.*(?:registered )?`?audioEffects`?.*(?:reported )?unavailable/iu],
			[`${name}: target-only projection`, /replaces only.*(?:that|the target) lane.*neutraliz(?:es|ing) only that.*rack/iu],
			[`${name}: native remainder`, /every other lane, mixer, and master rack stays native|every other track, clip, mixer group, mixer send, master rack/iu],
			[`${name}: single audio fallback`, /at most one audio rendered fallback of either closed audio role|more than one qualifying audio rendered fallback of either closed audio role/iu],
		]);
	}
	assertSemanticClaims(compatibility, [
		['compatibility: merged delivery', /ordinary source buffers and chunk providers with the fallback source removed from both/iu],
		['compatibility: portable roundtrip', /retains the relationship and exact target track ID|preserving that canonical target clip or track ID/iu],
		['compatibility: managed handoff', /fresh recipient that reports the registered `?audioEffects`? capability unavailable.*admits the relationship by role, target track ID, source ID, and SHA-256/iu],
	]);
	assertSemanticClaims(threatModel, [
		['threat model: track handoff qualified', /for the track role editor playback, maintained delivery, portable `?\.scape`? round-trip, managed handoff, and exact Linux x64 packaged UI activation and transport playback are qualified, but packaged final delivery and browser workflows are not/iu],
	]);
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

function normalize(value: string): string {
	return value.replace(/\s+/gu, ' ');
}

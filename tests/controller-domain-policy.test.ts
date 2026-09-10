/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cruise } from 'dependency-cruiser';

import {
	CONTROLLER_DOMAINS,
	classifyControllerDomainDependencies,
	compareControllerDomainDependencies,
	compareControllerDomainPolicyBaseline,
	controllerDomainStronglyConnectedComponents,
	controllerRuntimeCycleFindings,
	inspectControllerDomainTree,
	planControllerDomainPolicyTightening,
	validateControllerDomainPolicy,
} from '../scripts/lib/controller-domain-policy.mjs';

const FIXTURE_DOMAINS = ['alpha', 'beta', 'gamma'] as const;

type Dependencies = Record<string, { runtime: string[]; typeOnly: string[] }>;

function emptyDependencies(): Dependencies {
	return Object.fromEntries(FIXTURE_DOMAINS.map((domain) => [domain, {
		runtime: [],
		typeOnly: [],
	}]));
}

function policy(overrides: Partial<Dependencies> = {}) {
	return {
		schemaVersion: 2 as const,
		publicModules: ['alpha/alpha-api.ts', 'beta/beta-api.ts', 'gamma/gamma-api.ts'],
		allowedDependencies: { ...emptyDependencies(), ...overrides },
	};
}

function fixture(context: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-controller-domains-'));
	context.after(() => rmSync(root, { force: true, recursive: true }));
	for (const domain of FIXTURE_DOMAINS) {
		mkdirSync(join(root, domain, 'internal'), { recursive: true });
		writeFileSync(join(root, domain, `${domain}-api.ts`), 'export const api = true;\n');
	}
	writeFileSync(join(root, 'alpha', 'internal', 'alpha-service.ts'), 'export const service = true;\n');
	return root;
}

test('the controller taxonomy stays explicit and stable', () => {
	assert.deepEqual(CONTROLLER_DOMAINS, [
		'analysis', 'assistance', 'capture', 'clip-video', 'composition', 'document', 'edit',
		'effects', 'export', 'import', 'preferences', 'recording', 'shared', 'source',
		'track-audio', 'transport',
	]);
});

test('a canonical schema-v2 policy passes validation', () => {
	assert.deepEqual(validateControllerDomainPolicy(policy(), FIXTURE_DOMAINS), []);
});

test('policy validation requires schema v2 and the complete canonical dependency matrix', () => {
	const candidate = {
		...policy({
			alpha: { runtime: ['gamma', 'beta', 'beta'], typeOnly: ['beta', 'delta', 'alpha'] },
		}),
		schemaVersion: 1 as 2,
	};
	delete candidate.allowedDependencies.beta;
	candidate.allowedDependencies.delta = { runtime: [], typeOnly: [] };
	candidate.publicModules = [
		'beta/beta-api.ts', 'alpha/alpha-api.ts', 'alpha/alpha-api.ts', 'alpha/internal/hidden.ts',
	];
	const findings = validateControllerDomainPolicy(candidate, FIXTURE_DOMAINS);
	for (const pattern of [
		/schemaVersion must be 2/u,
		/publicModules must be sorted and unique/u,
		/direct public source file.*alpha\/internal\/hidden\.ts/u,
		/missing dependency entry.*beta/u,
		/unknown dependency entry.*delta/u,
		/alpha runtime.*sorted and unique/u,
		/cannot depend on itself.*alpha/u,
		/unknown domain.*delta/u,
		/both runtime and typeOnly.*alpha -> beta/u,
	]) assert.ok(findings.some((finding) => pattern.test(finding)), `missing ${pattern}`);
});

test('the structural policy checks inventory, internals, symlinks, and wildcard barrels', (context) => {
	const root = fixture(context);
	mkdirSync(join(root, 'alpha', 'helpers'));
	writeFileSync(join(root, 'alpha', 'helpers', 'hidden.ts'), 'export const hidden = true;\n');
	writeFileSync(join(root, 'alpha', 'undeclared.ts'), 'export {};\n');
	writeFileSync(join(root, 'beta', 'internal', 'index.ts'), 'export {};\n');
	writeFileSync(join(root, 'beta', 'wildcard.ts'), "export * from './beta-api.ts';\n");
	writeFileSync(join(root, 'gamma', 'types.ts'), "export type * from './gamma-api.ts';\n");
	symlinkSync(join(root, 'alpha', 'internal', 'alpha-service.ts'), join(root, 'alpha', 'linked-api.ts'));
	const candidate = policy();
	candidate.publicModules.push('beta/stale.ts', 'beta/wildcard.ts', 'gamma/types.ts');
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		policy: candidate,
	});
	for (const pattern of [
		/private controller module must live under internal.*alpha\/helpers\/hidden\.ts/u,
		/controller symlink is forbidden.*alpha\/linked-api\.ts/u,
		/undeclared public controller module.*alpha\/undeclared\.ts/u,
		/declared public controller module does not exist.*beta\/stale\.ts/u,
		/barrel filename.*beta\/internal\/index\.ts/u,
		/value wildcard export.*beta\/wildcard\.ts:1/u,
	]) assert.ok(findings.some((finding) => pattern.test(finding)), `missing ${pattern}`);
	assert.ok(!findings.some((finding) => /gamma\/types\.ts:1/u.test(finding)));
});

test('root source files and unknown or missing domains fail the structural policy', (context) => {
	const root = fixture(context);
	writeFileSync(join(root, 'stray.ts'), 'export {};\n');
	mkdirSync(join(root, 'misc'));
	rmSync(join(root, 'beta'), { recursive: true });
	const candidate = policy();
	candidate.publicModules = candidate.publicModules.filter((module) => !module.startsWith('beta/'));
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		policy: candidate,
	});
	assert.ok(findings.some((finding) => /root source.*stray\.ts/u.test(finding)));
	assert.ok(findings.some((finding) => /unknown controller domain.*misc/u.test(finding)));
	assert.ok(findings.some((finding) => /missing controller domain.*beta/u.test(finding)));
});

test('raw dependency-cruiser results classify domain pairs and let runtime dominate', () => {
	const observed = classifyControllerDomainDependencies({
		modules: [
			{
				source: 'src/common/editor/controller/alpha/alpha-api.ts',
				dependencies: [
					{
						resolved: 'src/common/editor/controller/beta/beta-api.ts',
						typeOnly: true,
						dependencyTypes: ['local', 'import'],
					},
					{
						resolved: 'src/common/editor/controller/gamma/gamma-api.ts',
						dependencyTypes: ['local', 'type-import'],
					},
				],
			},
			{
				source: 'src/common/editor/controller/alpha/internal/value.ts',
				dependencies: [{
					resolved: 'src/common/editor/controller/beta/internal/value.ts',
					dependencyTypes: ['local', 'import'],
				}],
			},
			{
				source: 'src/common/editor/controller/beta/beta-api.ts',
				dependencies: [
					{
						resolved: 'src/common/editor/controller/gamma/gamma-api.ts',
						dependencyTypes: ['local', 'type-only', 'import'],
					},
					{
						resolved: 'src/common/editor/controller/alpha/alpha-api.ts',
						preCompilationOnly: true,
						dependencyTypes: ['local', 'pre-compilation-only'],
					},
				],
			},
			{
				source: 'src/common/editor/ui/outside.ts',
				dependencies: [{
					resolved: 'src/common/editor/controller/alpha/alpha-api.ts',
					dependencyTypes: ['local', 'import'],
				}],
			},
		],
	}, FIXTURE_DOMAINS);
	assert.deepEqual(observed, {
		alpha: { runtime: ['beta'], typeOnly: ['gamma'] },
		beta: { runtime: [], typeOnly: ['alpha', 'gamma'] },
		gamma: { runtime: [], typeOnly: [] },
	});
});

test('a post-compilation cruise restores runtime imports and cycles hidden by a type query', async (context) => {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-controller-cruise-'));
	context.after(() => rmSync(root, { force: true, recursive: true }));
	const controllerRoot = join(root, 'src', 'common', 'editor', 'controller');
	mkdirSync(join(controllerRoot, 'alpha'), { recursive: true });
	mkdirSync(join(controllerRoot, 'beta'), { recursive: true });
	writeFileSync(join(controllerRoot, 'alpha', 'alpha-api.ts'), [
		"type BetaModule = typeof import('../beta/beta-api.ts');",
		'export async function loadBeta(): Promise<BetaModule> {',
		"\treturn import('../beta/beta-api.ts');",
		'}',
		'',
	].join('\n'));
	writeFileSync(join(controllerRoot, 'beta', 'beta-api.ts'), [
		"import { loadBeta } from '../alpha/alpha-api.ts';",
		'export const beta = loadBeta;',
		'',
	].join('\n'));

	async function runCruise(tsPreCompilationDeps: boolean) {
		const { output } = await cruise(['src/common/editor/controller'], {
			baseDir: root,
			includeOnly: '^src/common/editor/controller/',
			tsPreCompilationDeps,
		});
		if (typeof output === 'string') throw new Error('Dependency Cruiser returned formatted output.');
		return output;
	}

	const complete = await runCruise(true);
	const runtime = await runCruise(false);
	assert.deepEqual(
		complete.modules.find((module) => module.source.endsWith('/alpha/alpha-api.ts'))
			?.dependencies[0]?.dependencyTypes,
		['local', 'type-import'],
	);
	assert.deepEqual(
		runtime.modules.find((module) => module.source.endsWith('/alpha/alpha-api.ts'))
			?.dependencies[0]?.dependencyTypes,
		['local', 'dynamic-import'],
	);
	assert.ok(controllerRuntimeCycleFindings(runtime).some((finding) => (
		finding.includes('alpha/alpha-api.ts') && finding.includes('beta/beta-api.ts')
	)));
	assert.deepEqual(classifyControllerDomainDependencies(
		complete,
		['alpha', 'beta'],
		{ runtimeCruiseResult: runtime },
	), {
		alpha: { runtime: ['beta'], typeOnly: [] },
		beta: { runtime: ['alpha'], typeOnly: [] },
	});
});

test('exact comparison reports additions, stale permissions, upgrades, and downgrades', () => {
	const configured = emptyDependencies();
	configured.alpha = { runtime: ['beta'], typeOnly: ['gamma'] };
	configured.gamma = { runtime: ['beta'], typeOnly: [] };
	const observed = emptyDependencies();
	observed.alpha = { runtime: ['gamma'], typeOnly: ['beta'] };
	observed.beta = { runtime: ['gamma'], typeOnly: [] };
	const findings = compareControllerDomainDependencies(observed, configured, FIXTURE_DOMAINS);
	assert.equal(findings.length, 4);
	for (const pattern of [
		/new dependency.*beta -> gamma.*runtime/u,
		/stale permission.*gamma -> beta.*runtime/u,
		/became runtime.*alpha -> gamma/u,
		/can tighten to typeOnly.*alpha -> beta/u,
	]) assert.ok(findings.some((finding) => pattern.test(finding)), `missing ${pattern}`);
});

test('baseline comparison allows deletions and downgrades but rejects additions and upgrades', () => {
	const baseline = policy({
		alpha: { runtime: ['beta'], typeOnly: ['gamma'] },
		beta: { runtime: [], typeOnly: ['gamma'] },
	});
	const current = policy({
		alpha: { runtime: ['gamma'], typeOnly: ['beta'] },
		beta: { runtime: ['alpha'], typeOnly: [] },
	});
	const findings = compareControllerDomainPolicyBaseline(current, baseline, FIXTURE_DOMAINS);
	assert.equal(findings.length, 2);
	assert.ok(findings.some((finding) => /upgraded.*alpha -> gamma.*typeOnly to runtime/u.test(finding)));
	assert.ok(findings.some((finding) => /added.*beta -> alpha.*runtime/u.test(finding)));
});

test('tightening deletes stale permissions and downgrades runtime permissions', () => {
	const current = policy({
		alpha: { runtime: ['beta', 'gamma'], typeOnly: [] },
		beta: { runtime: [], typeOnly: ['gamma'] },
	});
	const observed = emptyDependencies();
	observed.alpha = { runtime: [], typeOnly: ['beta'] };
	const plan = planControllerDomainPolicyTightening(current, observed, FIXTURE_DOMAINS);
	assert.deepEqual(plan.findings, []);
	assert.deepEqual(plan.changes, [
		{ source: 'alpha', target: 'beta', from: 'runtime', to: 'typeOnly' },
		{ source: 'alpha', target: 'gamma', from: 'runtime', to: 'none' },
		{ source: 'beta', target: 'gamma', from: 'typeOnly', to: 'none' },
	]);
	assert.deepEqual(plan.policy?.allowedDependencies, observed);
});

test('tightening refuses dependency additions and runtime upgrades', () => {
	const current = policy({ alpha: { runtime: [], typeOnly: ['beta'] } });
	const observed = emptyDependencies();
	observed.alpha = { runtime: ['beta'], typeOnly: ['gamma'] };
	const plan = planControllerDomainPolicyTightening(current, observed, FIXTURE_DOMAINS);
	assert.equal(plan.policy, null);
	assert.ok(plan.findings.some((finding) => /cannot add.*alpha -> gamma.*typeOnly/u.test(finding)));
	assert.ok(plan.findings.some((finding) => /cannot upgrade.*alpha -> beta.*runtime/u.test(finding)));
});

test('SCC diagnostics distinguish runtime cycles and show when an edge breaks one', () => {
	const dependencies = emptyDependencies();
	dependencies.alpha = { runtime: ['beta'], typeOnly: ['gamma'] };
	dependencies.beta = { runtime: ['alpha'], typeOnly: [] };
	dependencies.gamma = { runtime: [], typeOnly: ['alpha'] };
	assert.deepEqual(controllerDomainStronglyConnectedComponents(
		dependencies,
		{ domains: FIXTURE_DOMAINS },
	), [['alpha', 'beta']]);
	assert.deepEqual(controllerDomainStronglyConnectedComponents(
		dependencies,
		{ domains: FIXTURE_DOMAINS, includeTypeOnly: true },
	), [['alpha', 'beta', 'gamma']]);
	dependencies.beta.runtime = [];
	assert.deepEqual(controllerDomainStronglyConnectedComponents(
		dependencies,
		{ domains: FIXTURE_DOMAINS },
	), []);
});

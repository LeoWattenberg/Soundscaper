#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
} from './lib/controller-domain-policy.mjs';

const root = resolve(import.meta.dirname, '..');
const controllerRoot = join(root, 'src', 'common', 'editor', 'controller');
const policyPath = join(root, 'config', 'controller-domain-policy.json');
const legacyPolicyPath = join(root, 'config', 'controller-domain-public-modules.json');
const tighten = process.argv.includes('--tighten');
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--tighten');
if (unknownArguments.length) throw new RangeError(`Unknown controller-domain arguments: ${unknownArguments.join(' ')}`);

const observed = await observeControllerDependencies();
const loaded = loadCurrentPolicy();
if (loaded?.schemaVersion !== 2) {
	bootstrapPolicy(loaded, observed);
} else {
	checkPolicy(loaded, observed);
}

async function observeControllerDependencies() {
	const complete = await cruiseControllerDependencies(true);
	const runtime = await cruiseControllerDependencies(false);
	const runtimeCycleFindings = controllerRuntimeCycleFindings(runtime);
	if (runtimeCycleFindings.length) fail(runtimeCycleFindings);
	return classifyControllerDomainDependencies(complete, CONTROLLER_DOMAINS, {
		runtimeCruiseResult: runtime,
	});
}

async function cruiseControllerDependencies(tsPreCompilationDeps) {
	const result = await cruise(['src/common/editor/controller'], {
		baseDir: root,
		includeOnly: '^src/common/editor/controller/',
		outputType: 'json',
		tsConfig: { fileName: join(root, 'tsconfig.json') },
		tsPreCompilationDeps,
		validate: false,
	});
	if (result.exitCode !== 0) throw new Error('Dependency Cruiser could not inspect controller domains.');
	return typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
}

function loadCurrentPolicy() {
	if (existsSync(policyPath)) return readJson(policyPath);
	if (existsSync(legacyPolicyPath)) return readJson(legacyPolicyPath);
	return null;
}

function bootstrapPolicy(legacy, dependencies) {
	const publicModules = Array.isArray(legacy?.modules) ? legacy.modules : null;
	if (publicModules === null) {
		throw new Error('Controller domain policy is absent and no schema-v1 public-module inventory is available.');
	}
	const policy = {
		schemaVersion: 2,
		publicModules: [...publicModules],
		allowedDependencies: dependencies,
	};
	const findings = inspectControllerDomainTree({ controllerRoot, policy });
	if (findings.length) fail(findings);
	if (!tighten) {
		fail(['controller domain policy needs schema-v2 bootstrap; run npm run check:controller-domains:tighten.']);
	}
	writePolicy(policy);
	console.log('Bootstrapped the controller-domain policy from the live dependency graph.');
	printSummary(policy, dependencies);
}

function checkPolicy(policy, dependencies) {
	const structuralFindings = inspectControllerDomainTree({ controllerRoot, policy });
	const baseline = loadBaselinePolicy();
	if (tighten) {
		if (structuralFindings.length) fail(structuralFindings);
		const plan = planControllerDomainPolicyTightening(policy, dependencies);
		if (plan.findings.length || plan.policy === null) fail(plan.findings);
		const baselineFindings = baseline
			? compareControllerDomainPolicyBaseline(plan.policy, baseline)
			: [];
		if (baselineFindings.length) fail(baselineFindings);
		if (plan.changes.length) {
			writePolicy(plan.policy);
			for (const change of plan.changes) {
				console.log(`Tightened ${change.source} -> ${change.target}: ${change.from} -> ${change.to}.`);
			}
		} else {
			console.log('Controller-domain dependency policy has no room to tighten.');
		}
		printSummary(plan.policy, dependencies);
		return;
	}

	const findings = [
		...structuralFindings,
		...compareControllerDomainDependencies(dependencies, policy.allowedDependencies),
		...(baseline ? compareControllerDomainPolicyBaseline(policy, baseline) : []),
	];
	if (findings.length) fail([...new Set(findings)]);
	printSummary(policy, dependencies);
}

function loadBaselinePolicy() {
	const requested = String(process.env.CONTROLLER_DOMAIN_BASE_REVISION || '').trim();
	const explicit = requested && !/^0+$/u.test(requested) ? requested : null;
	const candidate = explicit ?? 'HEAD';
	let revision;
	try {
		revision = git(['rev-parse', '--verify', `${candidate}^{commit}`]).trim();
	} catch (error) {
		throw new Error(`Cannot resolve controller-domain base revision ${candidate}.`, { cause: error });
	}
	const serialized = readPolicyAtRevision(revision);
	if (serialized === null) return null;
	let policy;
	try {
		policy = JSON.parse(serialized);
	} catch (error) {
		throw new Error(`Cannot parse the controller-domain policy at base revision ${revision}.`, { cause: error });
	}
	if (policy?.schemaVersion !== 2) return null;
	const findings = validateControllerDomainPolicy(policy);
	if (findings.length) {
		throw new Error(`Controller domain base policy is invalid:\n${findings.join('\n')}`);
	}
	return policy;
}

function readPolicyAtRevision(revision) {
	for (const path of ['config/controller-domain-policy.json', 'config/controller-domain-public-modules.json']) {
		try {
			return git(['show', `${revision}:${path}`]);
		} catch {
			// An absent or schema-v1 policy is the expected one-time bootstrap case.
		}
	}
	return null;
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(`Cannot read controller-domain policy ${path}.`, { cause: error });
	}
}

function writePolicy(policy) {
	writeFileSync(policyPath, `${JSON.stringify(policy, null, '\t')}\n`);
}

function printSummary(policy, dependencies) {
	const runtimePairs = pairCount(dependencies, 'runtime');
	const typeOnlyPairs = pairCount(dependencies, 'typeOnly');
	const runtimeComponents = controllerDomainStronglyConnectedComponents(dependencies);
	const allComponents = controllerDomainStronglyConnectedComponents(dependencies, { includeTypeOnly: true });
	const runtimeLargest = largestComponent(runtimeComponents);
	const allLargest = largestComponent(allComponents);
	console.log(
		`Checked ${CONTROLLER_DOMAINS.length} controller domains, ${policy.publicModules.length} public modules, `
		+ `${runtimePairs} runtime pairs, and ${typeOnlyPairs} type-only pairs.`,
	);
	console.log(
		`Largest controller SCC: runtime ${runtimeLargest.length}${componentMembers(runtimeLargest)}; `
		+ `type-inclusive ${allLargest.length}${componentMembers(allLargest)}.`,
	);
}

function pairCount(dependencies, category) {
	return CONTROLLER_DOMAINS.reduce((count, domain) => count + dependencies[domain][category].length, 0);
}

function largestComponent(components) {
	return components.reduce((largest, component) => (
		component.length > largest.length ? component : largest
	), CONTROLLER_DOMAINS.length ? [CONTROLLER_DOMAINS[0]] : []);
}

function componentMembers(component) {
	return component.length > 1 ? ` (${component.join(', ')})` : '';
}

function fail(findings) {
	throw new Error(`Controller domain guard failed:\n${findings.join('\n')}`);
}

function git(arguments_) {
	return execFileSync('git', arguments_, {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

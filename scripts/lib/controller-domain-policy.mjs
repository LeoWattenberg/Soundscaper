/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import ts from 'typescript';

export const CONTROLLER_DOMAINS = Object.freeze([
	'analysis',
	'assistance',
	'capture',
	'clip-video',
	'composition',
	'document',
	'edit',
	'effects',
	'export',
	'import',
	'preferences',
	'recording',
	'shared',
	'source',
	'track-audio',
	'transport',
]);

const SOURCE_FILE = /\.[cm]?[jt]sx?$/u;
const BARREL_FILE = /^(?:(?:index|mod|barrel)\.|.+-barrel\.)/u;
const CONTROLLER_MODULE = /^src\/common\/editor\/controller\/([^/]+)\//u;

function repositoryPath(path) {
	return path.split(sep).join('/');
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalStrings(values) {
	return [...new Set(values)].sort();
}

function emptyDependencies(domains) {
	return Object.fromEntries(domains.map((domain) => [domain, { runtime: [], typeOnly: [] }]));
}

function dependencyCategory(dependencies, source, target) {
	const entry = dependencies?.[source];
	if (Array.isArray(entry?.runtime) && entry.runtime.includes(target)) return 'runtime';
	if (Array.isArray(entry?.typeOnly) && entry.typeOnly.includes(target)) return 'typeOnly';
	return 'none';
}

function dependencyPairs(dependencies, domains) {
	const pairs = [];
	for (const source of domains) {
		const runtime = Array.isArray(dependencies?.[source]?.runtime)
			? dependencies[source].runtime : [];
		const typeOnly = Array.isArray(dependencies?.[source]?.typeOnly)
			? dependencies[source].typeOnly : [];
		for (const target of runtime) {
			pairs.push({ source, target, category: 'runtime' });
		}
		for (const target of typeOnly) {
			pairs.push({ source, target, category: 'typeOnly' });
		}
	}
	return pairs;
}

function publicModuleFindings(publicModules, domains) {
	if (!Array.isArray(publicModules) || publicModules.some((module) => typeof module !== 'string')) {
		return ['controller domain policy publicModules must be an array of strings.'];
	}
	const findings = [];
	const canonical = canonicalStrings(publicModules);
	if (canonical.length !== publicModules.length
		|| canonical.some((module, index) => module !== publicModules[index])) {
		findings.push('controller domain policy publicModules must be sorted and unique.');
	}
	const domainPattern = domains.map((domain) => domain.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
	const publicModule = new RegExp(`^(?:${domainPattern})/[^/]+\\.[cm]?[jt]sx?$`, 'u');
	for (const module of publicModules) {
		if (!publicModule.test(module)) {
			findings.push(`controller public inventory must name a direct public source file: ${module}`);
		}
	}
	return findings;
}

/** Validate the complete controller-domain policy without mutating it. */
export function validateControllerDomainPolicy(policy, domains = CONTROLLER_DOMAINS) {
	if (!isRecord(policy)) return ['controller domain policy must be an object.'];
	const findings = [];
	if (policy.schemaVersion !== 2) {
		findings.push('controller domain policy schemaVersion must be 2.');
	}
	findings.push(...publicModuleFindings(policy.publicModules, domains));
	if (!isRecord(policy.allowedDependencies)) {
		findings.push('controller domain policy allowedDependencies must be an object.');
		return findings;
	}
	const keys = Object.keys(policy.allowedDependencies);
	const sortedKeys = [...keys].sort();
	if (keys.some((domain, index) => domain !== sortedKeys[index])) {
		findings.push('controller domain policy dependency entries must be sorted.');
	}
	const known = new Set(domains);
	for (const domain of domains) {
		if (!Object.hasOwn(policy.allowedDependencies, domain)) {
			findings.push(`controller domain policy is missing dependency entry for ${domain}.`);
		}
	}
	for (const [source, entry] of Object.entries(policy.allowedDependencies)) {
		if (!known.has(source)) {
			findings.push(`controller domain policy has unknown dependency entry for ${source}.`);
			continue;
		}
		if (!isRecord(entry)) {
			findings.push(`controller domain policy dependency entry for ${source} must be an object.`);
			continue;
		}
		for (const category of ['runtime', 'typeOnly']) {
			const targets = entry[category];
			if (!Array.isArray(targets) || targets.some((target) => typeof target !== 'string')) {
				findings.push(`controller domain policy ${source} ${category} dependencies must be an array of strings.`);
				continue;
			}
			const canonical = canonicalStrings(targets);
			if (canonical.length !== targets.length
				|| canonical.some((target, index) => target !== targets[index])) {
				findings.push(`controller domain policy ${source} ${category} dependencies must be sorted and unique.`);
			}
			for (const target of targets) {
				if (target === source) {
					findings.push(`controller domain cannot depend on itself: ${source} -> ${target}.`);
				} else if (!known.has(target)) {
					findings.push(`controller domain dependency names unknown domain ${target}: ${source} -> ${target}.`);
				}
			}
		}
		if (Array.isArray(entry.runtime) && Array.isArray(entry.typeOnly)) {
			for (const target of entry.runtime) {
				if (entry.typeOnly.includes(target)) {
					findings.push(`controller dependency appears in both runtime and typeOnly: ${source} -> ${target}.`);
				}
			}
		}
	}
	return findings;
}

function collectSourceFiles(directory, controllerRoot, findings) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink()) {
			findings.push(`controller symlink is forbidden: ${repositoryPath(relative(controllerRoot, path))}`);
		} else if (entry.isDirectory()) {
			files.push(...collectSourceFiles(path, controllerRoot, findings));
		} else if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(path);
	}
	return files;
}

function isValueWildcardExport(statement) {
	return ts.isExportDeclaration(statement)
		&& statement.moduleSpecifier !== undefined
		&& !statement.isTypeOnly
		&& (statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause));
}

/** Inspect the controller folder layout and its declared public source surface. */
export function inspectControllerDomainTree({
	controllerRoot,
	domains = CONTROLLER_DOMAINS,
	policy,
}) {
	const findings = validateControllerDomainPolicy(policy, domains);
	const expectedDomains = new Set(domains);
	const observedDomains = new Set();

	for (const entry of readdirSync(controllerRoot, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			observedDomains.add(entry.name);
			if (!expectedDomains.has(entry.name)) findings.push(`unknown controller domain: ${entry.name}`);
		} else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
			findings.push(`controller root source file is forbidden: ${entry.name}`);
		}
	}
	for (const domain of domains) {
		if (!observedDomains.has(domain)) findings.push(`missing controller domain: ${domain}`);
	}

	const sourceFiles = collectSourceFiles(controllerRoot, controllerRoot, findings);
	const actualPublicModules = [];
	for (const path of sourceFiles) {
		const module = repositoryPath(relative(controllerRoot, path));
		const segments = module.split('/');
		if (segments.length === 2 && expectedDomains.has(segments[0])) actualPublicModules.push(module);
		if (segments.length > 2 && expectedDomains.has(segments[0]) && segments[1] !== 'internal') {
			findings.push(`private controller module must live under internal/: ${module}`);
		}
		if (BARREL_FILE.test(basename(path))) findings.push(`controller barrel filename is forbidden: ${module}`);

		const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
		for (const statement of source.statements) {
			if (!isValueWildcardExport(statement)) continue;
			const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
			findings.push(`controller value wildcard export is forbidden: ${module}:${line}`);
		}
	}

	const declaredModules = Array.isArray(policy?.publicModules) ? policy.publicModules : [];
	const declared = new Set(declaredModules);
	for (const module of actualPublicModules.sort()) {
		if (!declared.has(module)) findings.push(`undeclared public controller module: ${module}`);
	}
	const actual = new Set(actualPublicModules);
	for (const module of declaredModules) {
		if (!actual.has(module)) findings.push(`declared public controller module does not exist: ${module}`);
	}
	return findings;
}

function controllerDomain(path, domains) {
	if (typeof path !== 'string') return null;
	const match = CONTROLLER_MODULE.exec(repositoryPath(path));
	return match && domains.includes(match[1]) ? match[1] : null;
}

function isTypeOnlyDependency(dependency) {
	return dependency?.typeOnly === true
		|| dependency?.preCompilationOnly === true
		|| dependency?.dependencyTypes?.includes('type-only') === true
		|| dependency?.dependencyTypes?.includes('type-import') === true;
}

/**
 * Collapse pre- and post-compilation dependency-cruiser edges into domain pairs.
 *
 * @param {unknown} cruiseResult
 * @param {readonly string[]} [domains]
 * @param {{ runtimeCruiseResult?: unknown }} [options]
 */
export function classifyControllerDomainDependencies(
	cruiseResult,
	domains = CONTROLLER_DOMAINS,
	{ runtimeCruiseResult = null } = {},
) {
	const classified = emptyDependencies(domains);
	const runtime = Object.fromEntries(domains.map((domain) => [domain, new Set()]));
	const typeOnly = Object.fromEntries(domains.map((domain) => [domain, new Set()]));
	observe(cruiseResult);
	if (runtimeCruiseResult !== null) observe(runtimeCruiseResult);

	function observe(result) {
		for (const module of result?.modules ?? []) {
			const source = controllerDomain(module.source, domains);
			if (source === null) continue;
			for (const dependency of module.dependencies ?? []) {
				const target = controllerDomain(dependency.resolved, domains);
				if (target === null || target === source) continue;
				if (isTypeOnlyDependency(dependency)) {
					if (!runtime[source].has(target)) typeOnly[source].add(target);
				} else {
					runtime[source].add(target);
					typeOnly[source].delete(target);
				}
			}
		}
	}
	for (const domain of domains) {
		classified[domain] = {
			runtime: [...runtime[domain]].sort(),
			typeOnly: [...typeOnly[domain]].sort(),
		};
	}
	return classified;
}

/** Report module cycles found after TypeScript-only dependencies have been erased. */
export function controllerRuntimeCycleFindings(cruiseResult) {
	const findings = [];
	for (const module of cruiseResult?.modules ?? []) {
		for (const dependency of module.dependencies ?? []) {
			if (dependency.circular !== true) continue;
			findings.push(
				`runtime circular controller dependency: ${module.source} -> ${dependency.resolved}.`,
			);
		}
	}
	return findings.sort();
}

/** Require configured permissions to describe the live dependency graph exactly. */
export function compareControllerDomainDependencies(observed, configured, domains = CONTROLLER_DOMAINS) {
	const findings = [];
	for (const source of domains) {
		for (const target of domains) {
			if (source === target) continue;
			const actual = dependencyCategory(observed, source, target);
			const allowed = dependencyCategory(configured, source, target);
			if (actual === allowed) continue;
			if (actual === 'runtime' && allowed === 'typeOnly') {
				findings.push(`controller dependency became runtime: ${source} -> ${target} (configured typeOnly).`);
			} else if (actual !== 'none' && allowed === 'none') {
				findings.push(`new dependency between controller domains: ${source} -> ${target} (${actual}).`);
			} else if (actual === 'typeOnly' && allowed === 'runtime') {
				findings.push(`controller dependency can tighten to typeOnly: ${source} -> ${target}.`);
			} else if (actual === 'none') {
				findings.push(`stale permission for controller dependency: ${source} -> ${target} (${allowed}).`);
			}
		}
	}
	return findings;
}

/** Reject permissions that are broader than those present at the Git base revision. */
export function compareControllerDomainPolicyBaseline(current, baseline, domains = CONTROLLER_DOMAINS) {
	const findings = [];
	for (const { source, target, category } of dependencyPairs(current.allowedDependencies, domains)) {
		const previous = dependencyCategory(baseline.allowedDependencies, source, target);
		if (category === 'runtime' && previous === 'typeOnly') {
			findings.push(`controller dependency upgraded: ${source} -> ${target} from typeOnly to runtime.`);
		} else if (previous === 'none') {
			findings.push(`controller dependency added: ${source} -> ${target} (${category}).`);
		}
	}
	return findings;
}

/** Build the only policy rewrite the tighten command may perform. */
export function planControllerDomainPolicyTightening(policy, observed, domains = CONTROLLER_DOMAINS) {
	const findings = [];
	for (const { source, target, category } of dependencyPairs(observed, domains)) {
		const configured = dependencyCategory(policy.allowedDependencies, source, target);
		if (configured === 'none') {
			findings.push(`tightening cannot add controller dependency ${source} -> ${target} (${category}).`);
		} else if (category === 'runtime' && configured === 'typeOnly') {
			findings.push(`tightening cannot upgrade controller dependency ${source} -> ${target} to runtime.`);
		}
	}
	if (findings.length) return { policy: null, changes: [], findings };

	const changes = [];
	for (const source of domains) {
		for (const target of domains) {
			if (source === target) continue;
			const from = dependencyCategory(policy.allowedDependencies, source, target);
			const to = dependencyCategory(observed, source, target);
			if (from !== to) changes.push({ source, target, from, to });
		}
	}
	return {
		policy: {
			schemaVersion: 2,
			publicModules: [...policy.publicModules],
			allowedDependencies: Object.fromEntries(domains.map((domain) => [domain, {
				runtime: [...observed[domain].runtime],
				typeOnly: [...observed[domain].typeOnly],
			}])),
		},
		changes,
		findings,
	};
}

/** Return sorted, non-singleton strongly connected domain components. */
export function controllerDomainStronglyConnectedComponents(
	dependencies,
	{ domains = CONTROLLER_DOMAINS, includeTypeOnly = false } = {},
) {
	const adjacency = new Map(domains.map((domain) => [domain, new Set([
		...(dependencies?.[domain]?.runtime ?? []),
		...(includeTypeOnly ? dependencies?.[domain]?.typeOnly ?? [] : []),
	])]));
	const indexes = new Map();
	const lowLinks = new Map();
	const stack = [];
	const onStack = new Set();
	const components = [];
	let nextIndex = 0;

	function visit(domain) {
		indexes.set(domain, nextIndex);
		lowLinks.set(domain, nextIndex);
		nextIndex += 1;
		stack.push(domain);
		onStack.add(domain);
		for (const target of adjacency.get(domain) ?? []) {
			if (!adjacency.has(target)) continue;
			if (!indexes.has(target)) {
				visit(target);
				lowLinks.set(domain, Math.min(lowLinks.get(domain), lowLinks.get(target)));
			} else if (onStack.has(target)) {
				lowLinks.set(domain, Math.min(lowLinks.get(domain), indexes.get(target)));
			}
		}
		if (lowLinks.get(domain) !== indexes.get(domain)) return;
		const component = [];
		let member;
		do {
			member = stack.pop();
			onStack.delete(member);
			component.push(member);
		} while (member !== domain);
		if (component.length > 1) components.push(component.sort());
	}

	for (const domain of domains) {
		if (!indexes.has(domain)) visit(domain);
	}
	return components.sort((left, right) => left[0].localeCompare(right[0]));
}

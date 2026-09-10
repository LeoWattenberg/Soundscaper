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

function repositoryPath(path) {
	return path.split(sep).join('/');
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

function manifestFindings(manifest, domains) {
	const findings = [];
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		return ['controller public-module manifest must be an object.'];
	}
	if (manifest.schemaVersion !== 1) findings.push('controller public-module manifest schemaVersion must be 1.');
	if (!Array.isArray(manifest.modules) || manifest.modules.some((module) => typeof module !== 'string')) {
		findings.push('controller public-module manifest modules must be an array of strings.');
		return findings;
	}
	const canonical = [...new Set(manifest.modules)].sort();
	if (canonical.length !== manifest.modules.length
		|| canonical.some((module, index) => module !== manifest.modules[index])) {
		findings.push('controller public-module manifest modules must be sorted and unique.');
	}
	const domainPattern = domains.map((domain) => domain.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
	const publicModule = new RegExp(`^(?:${domainPattern})/[^/]+\\.[cm]?[jt]sx?$`, 'u');
	for (const module of manifest.modules) {
		if (!publicModule.test(module)) {
			findings.push(`controller public inventory must name a direct public source file: ${module}`);
		}
	}
	return findings;
}

/**
 * Inspect a controller tree without mutating it.
 *
 * @param {{
 *   controllerRoot: string,
 *   domains?: readonly string[],
 *   manifest: { schemaVersion: number, modules: readonly string[] },
 * }} options
 * @returns {string[]}
 */
export function inspectControllerDomainTree({
	controllerRoot,
	domains = CONTROLLER_DOMAINS,
	manifest,
}) {
	const findings = manifestFindings(manifest, domains);
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

	const declared = new Set(Array.isArray(manifest?.modules) ? manifest.modules : []);
	for (const module of actualPublicModules.sort()) {
		if (!declared.has(module)) findings.push(`undeclared public controller module: ${module}`);
	}
	const actual = new Set(actualPublicModules);
	for (const module of declared) {
		if (!actual.has(module)) findings.push(`declared public controller module does not exist: ${module}`);
	}

	return findings;
}

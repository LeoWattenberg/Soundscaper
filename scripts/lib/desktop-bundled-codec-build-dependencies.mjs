/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticate every module dependency used by a corresponding-source build script. */

import { posix } from 'node:path';

import ts from 'typescript';

export function collectDesktopBundledCodecBuildDependencies(scriptPath, source) {
	if (typeof scriptPath !== 'string' || scriptPath.length === 0 || scriptPath.includes('\0')) {
		throw new TypeError('Corresponding-source build script path is invalid.');
	}
	if (typeof source !== 'string') {
		throw new TypeError('Corresponding-source build script source is invalid.');
	}
	const file = ts.createSourceFile(
		scriptPath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	if (file.parseDiagnostics.length > 0) {
		throw new Error(`Corresponding-source build script ${scriptPath} is not valid JavaScript.`);
	}
	const specifiers = [];
	function visit(node) {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			&& node.moduleSpecifier !== undefined) {
			if (!ts.isStringLiteral(node.moduleSpecifier)) {
				throw new Error(
					`Corresponding-source build script ${scriptPath} has a non-literal module specifier.`,
				);
			}
			specifiers.push(node.moduleSpecifier.text);
		}
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
				throw new Error(
					`Corresponding-source build script ${scriptPath} has a non-literal dynamic import.`,
				);
			}
			specifiers.push(node.arguments[0].text);
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	const dependencies = specifiers.map((specifier) => {
		if (specifier.startsWith('node:')) return null;
		if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
			throw new Error(
				`Corresponding-source build script ${scriptPath} imports unsupported module authority: ${specifier}.`,
			);
		}
		const dependency = posix.normalize(posix.join(posix.dirname(scriptPath), specifier));
		if (dependency.startsWith('../') || posix.isAbsolute(dependency)) {
			throw new Error(
				`Corresponding-source build script ${scriptPath} dependency leaves the repository.`,
			);
		}
		return dependency;
	}).filter((dependency) => dependency !== null).sort();
	return Object.freeze(dependencies);
}

export function validateDesktopBundledCodecBuildImports({
	codecId,
	scriptPath,
	bytes,
	supportFiles,
	archives,
}) {
	const source = String(bytes);
	const imports = collectDesktopBundledCodecBuildDependencies(scriptPath, source);
	const admitted = new Set(supportFiles.map(({ path }) => path));
	if (imports.some((path) => !admitted.has(path))) {
		throw new Error(`${codecId} build script has an unbundled local dependency.`);
	}
	const expectedImports = codecId === 'wavpack'
		? ['scripts/lib/wavpack-wasm-toolchain.mjs']
		: ['scripts/lib/bundled-codec-source-input.mjs'];
	if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
		throw new Error(`${codecId} build script dependency closure is invalid.`);
	}
	if (archives.some(({ fileName }) => !source.includes(`'${fileName}'`))) {
		throw new Error(`${codecId} build script does not select its bundled source filename.`);
	}
}

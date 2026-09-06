/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check

import { resolve } from 'node:path';
import ts from 'typescript';

/**
 * Resolve the compiler's actual consumer graph through the same ordered table
 * as Vite. This checks arguments, results, types and dynamic imports, rather
 * than just the presence of export names on an otherwise unconsumed adapter.
 *
 * @param {import('typescript').CompilerOptions} options
 * @param {{repositoryRoot: string, aliases: readonly {find: RegExp, standIn: string}[]}} composition
 * @returns {import('typescript').CompilerHost}
 */
export function createProductCompilerHost(options, { repositoryRoot, aliases }) {
	const host = ts.createCompilerHost(options);
	const cache = ts.createModuleResolutionCache(repositoryRoot, host.getCanonicalFileName, options);
	host.resolveModuleNameLiterals = (literals, containingFile, redirectedReference, compilerOptions) => (
		literals.map((literal) => {
			const alias = aliases.find((row) => row.find.test(literal.text));
			return ts.resolveModuleName(
				alias ? resolve(repositoryRoot, alias.standIn) : literal.text,
				containingFile, compilerOptions, host, cache, redirectedReference,
			);
		})
	);
	return host;
}

/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check

import ts from 'typescript';
import { createProductSubstitutionResolver } from './product-aliases.mjs';

/**
 * Resolve the compiler's actual consumer graph through the same ordered table
 * as Vite. This checks arguments, results, types and dynamic imports, rather
 * than just the presence of export names on an otherwise unconsumed adapter.
 *
 * @param {import('typescript').CompilerOptions} options
 * @param {{repositoryRoot: string, aliases: readonly {sourcePaths: readonly string[], standIn: string}[]}} composition
 * @returns {import('typescript').CompilerHost}
 */
export function createProductCompilerHost(options, { repositoryRoot, aliases }) {
	const host = ts.createCompilerHost(options);
	const cache = ts.createModuleResolutionCache(repositoryRoot, host.getCanonicalFileName, options);
	const resolveSubstitution = createProductSubstitutionResolver(repositoryRoot, aliases);
	host.resolveModuleNameLiterals = (literals, containingFile, redirectedReference, compilerOptions) => (
		literals.map((literal) => {
			const substitution = resolveSubstitution(literal.text, containingFile);
			return ts.resolveModuleName(
				substitution ?? literal.text,
				containingFile, compilerOptions, host, cache, redirectedReference,
			);
		})
	);
	return host;
}

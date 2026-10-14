/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fileDigest } from './verified-ci-input-tree.ts';

export type CiInputCacheKind = 'dependencies' | 'firefox';
export interface CiInputCacheIdentityOptions {
	readonly repositoryRoot: string;
	readonly kind: CiInputCacheKind;
	readonly nodeVersion: string;
	readonly npmVersion: string;
	readonly platform: string;
	readonly architecture: string;
	readonly scope: string;
	readonly environment: NodeJS.ProcessEnv;
}

export function dependencyWorkspaceRoots(repositoryRoot: string): readonly string[] {
	const manifest: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
	if (typeof manifest !== 'object' || manifest === null || !('workspaces' in manifest) || !Array.isArray(manifest.workspaces)
		|| !manifest.workspaces.every((path: unknown) => typeof path === 'string' && /^(?:[\w-]+\/)*[\w-]+$/u.test(path))) {
		throw new Error('Installed-tree caching requires explicit repository workspace paths.');
	}
	return (manifest.workspaces as string[]).map(path => join(repositoryRoot, path));
}

/** Cache namespaces never restore across different authenticated inputs or host/toolchain policies. */
export function ciInputCacheIdentity(options: CiInputCacheIdentityOptions): string {
	const { repositoryRoot, kind, environment } = options;
	const files = ['package-lock.json', 'scripts/ci-input-cache.mjs', 'scripts/lib/verified-ci-input-tree.ts', 'scripts/lib/ci-input-cache-identity.ts'];
	if (kind === 'dependencies') {
		files.push('package.json', '.nvmrc', '.npmrc');
		for (const root of dependencyWorkspaceRoots(repositoryRoot)) files.push(join(relative(repositoryRoot, root), 'package.json'));
		for (const file of readdirSync(join(repositoryRoot, 'patches/npm')).sort()) files.push(join('patches/npm', file));
	} else files.push('node_modules/playwright-core/package.json', 'node_modules/playwright-core/browsers.json');
	const installPolicy = ['NODE_ENV', 'npm_config_omit', 'npm_config_include', 'npm_config_ignore_scripts', 'npm_config_install_links', 'ELECTRON_SKIP_BINARY_DOWNLOAD', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD'].map(key => [key, environment[key] ?? '']);
	return createHash('sha256').update(JSON.stringify({
		schemaVersion: 1, kind, nodeVersion: options.nodeVersion, npmVersion: options.npmVersion,
		platform: options.platform, architecture: options.architecture, scope: options.scope, installPolicy,
		files: files.sort().map(file => [file, fileDigest(join(repositoryRoot, file))]),
	})).digest('hex');
}

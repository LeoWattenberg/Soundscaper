#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { appendFileSync, lstatSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { ciInputCacheIdentity, dependencyWorkspaceRoots } from './lib/ci-input-cache-identity.ts';
import { recordVerifiedInputTree, verifyInputTree } from './lib/verified-ci-input-tree.ts';

const [operation, kind] = process.argv.slice(2);
if (!['key', 'verify', 'record', 'reset'].includes(operation) || !['dependencies', 'firefox'].includes(kind)) throw new Error('Expected key/verify/record/reset and dependencies/firefox.');
const repositoryRoot = resolve(import.meta.dirname, '..');
const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8' });
if (npm.status !== 0) throw new Error('Could not authenticate the npm toolchain identity.');
const scope = `${process.env.CI_INPUT_CACHE_SCOPE || 'local'}/${process.env.ImageOS || 'unknown'}/${process.env.ImageVersion || 'unknown'}`;
const identity = ciInputCacheIdentity({ repositoryRoot, kind, nodeVersion: process.version, npmVersion: npm.stdout.trim(), platform: process.platform, architecture: process.arch, scope, environment: process.env });
const root = resolve(repositoryRoot, kind === 'dependencies' ? 'node_modules' : '.wrangler/ci-input-cache/firefox');
const receipt = resolve(repositoryRoot, `.wrangler/ci-input-cache/${kind}-receipt.json`);
const options = { root, receipt, identity, allowedLinkRoots: kind === 'dependencies' ? dependencyWorkspaceRoots(repositoryRoot) : [] };
let executable = null;
if (kind === 'firefox' && ['verify', 'record'].includes(operation)) {
	process.env.PLAYWRIGHT_BROWSERS_PATH = root;
	const { firefox } = await import('playwright-core');
	executable = firefox.executablePath();
}
const engineInstalled = () => {
	if (executable === null) return true;
	try { return lstatSync(executable).isFile() && (process.platform === 'win32' || (lstatSync(executable).mode & 0o111) !== 0); }
	catch { return false; }
};
if (operation === 'key') console.log(`key=${identity}`);
if (operation === 'verify') console.log(`valid=${String(engineInstalled() && verifyInputTree(options))}`);
if (operation === 'record') {
	if (!engineInstalled()) throw new Error('The pinned Firefox executable was not installed.');
	recordVerifiedInputTree(options);
}
if (operation === 'reset') { rmSync(root, { recursive: true, force: true }); rmSync(receipt, { force: true }); }
if (kind === 'firefox' && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PLAYWRIGHT_BROWSERS_PATH=${root}\n`);

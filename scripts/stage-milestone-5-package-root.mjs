#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Assembles the exact package root the Milestone 5 audit reads.
 *
 * electron-builder's output directory is a work area, not a release: alongside
 * the installers it leaves its unpacked application tree, an icon-set
 * directory, `builder-debug.yml` and update metadata. The audit is fail-closed
 * on anything it did not expect — that is the point of it — so it has to be
 * handed the release inputs and nothing else.
 *
 * The package names come from the same inventory the audit checks against, so
 * the two cannot describe different releases. Files are hard-linked where the
 * filesystem allows it, because a desktop release is hundreds of megabytes.
 */

import { copyFile, link, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopReleaseTargetPackageInventory } from './desktop-release-assets.mjs';
import {
	milestone5PackageReleaseAuthenticationEvidenceName,
} from './lib/milestone-5-package-release-authentication.mjs';
import {
	readProductReleaseLines,
	resolveProductApplicationVersion,
} from './lib/product-release-lines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where packaging stages the release inputs. It has to be one named constant
 * because it also has to be listed in `.gitignore`: the handoff authenticates
 * its source revision against a clean worktree, so a staged root git can see
 * refuses the release it was staged for.
 */
export const MILESTONE_5_PACKAGE_ROOT = 'release/milestone-5-package';

export async function stageMilestone5PackageRoot({
	repositoryRoot = ROOT, packageRoot, outputRoot = MILESTONE_5_PACKAGE_ROOT, productId, targetId,
}) {
	const source = resolve(repositoryRoot, requiredValue(packageRoot, 'package root'));
	const output = resolve(repositoryRoot, requiredValue(outputRoot, 'output root'));
	// The staged root is rebuilt from scratch, so it must not be, or contain, the
	// packaging output it is copying from.
	if (output === source || source.startsWith(`${output}${sep}`)) {
		throw new Error('The staged package root cannot contain the packaging output.');
	}
	const selectedProductId = requiredValue(productId, 'product');
	const releaseLines = await readProductReleaseLines(repositoryRoot);
	const applicationVersion = resolveProductApplicationVersion(selectedProductId, releaseLines);
	const inventory = desktopReleaseTargetPackageInventory(
		selectedProductId, requiredValue(targetId, 'target'), applicationVersion,
	);
	const entries = await readdir(source, { withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink())
		.map(({ name }) => name).sort();
	const packages = inventory.map(({ label, pattern }) => {
		const matches = files.filter((name) => pattern.test(name));
		if (matches.length !== 1) throw new Error(`Packaging produced no single ${label}.`);
		return matches[0];
	});
	const releaseAuthentication = milestone5PackageReleaseAuthenticationEvidenceName(productId, targetId);
	const staged = [
		...packages,
		`runtime-manifest-${productId}-${targetId}.json`,
		...(files.includes(releaseAuthentication) ? [releaseAuthentication] : []),
	];
	await rm(output, { recursive: true, force: true });
	await mkdir(output, { recursive: true });
	for (const name of staged) {
		if (!files.includes(name)) throw new Error(`Packaging produced no ${name}.`);
		await link(join(source, name), join(output, name))
			.catch(() => copyFile(join(source, name), join(output, name)));
	}
	return Object.freeze({ output, staged: Object.freeze(staged) });
}

function requiredValue(value, label) {
	const text = String(value ?? '').trim();
	if (!text) throw new Error(`The Milestone 5 package ${label} is required.`);
	return text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const options = {};
	for (let index = 2; index < process.argv.length; index += 2) {
		const field = {
			'--package-root': 'packageRoot',
			'--output': 'outputRoot',
			'--product': 'productId',
			'--target': 'targetId',
		}[process.argv[index]];
		if (!field) throw new Error(`Unexpected argument: ${process.argv[index]}`);
		options[field] = process.argv[index + 1];
	}
	const result = await stageMilestone5PackageRoot(options);
	process.stdout.write(`${result.staged.join('\n')}\n`);
}

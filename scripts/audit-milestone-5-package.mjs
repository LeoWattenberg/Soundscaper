#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	assembleMilestone5PackageAudit,
	assembleMilestone5ProductPackageAudit,
} from './lib/milestone-5-package-audit.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
let outputPath = null;
let requirePass = false;
const packageArguments = { productId: null, targetId: null, packageRoot: null };
for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];
	if (argument === '--require-pass') {
		if (requirePass) {
			throw new Error('--require-pass may be supplied only once.');
		}
		requirePass = true;
		continue;
	}
	if (argument === '--output') {
		const value = process.argv[index += 1];
		if (!value || value.startsWith('--')) throw new Error(`${argument} requires a file path.`);
		if (outputPath !== null) throw new Error('--output may be supplied only once.');
		outputPath = value;
		continue;
	}
	const packageField = {
		'--product': 'productId',
		'--target': 'targetId',
		'--package-root': 'packageRoot',
	}[argument];
	if (packageField !== undefined) {
		const value = process.argv[index += 1];
		if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
		if (packageArguments[packageField] !== null) {
			throw new Error(`${argument} may be supplied only once.`);
		}
		packageArguments[packageField] = value;
		continue;
	}
	throw new Error(`Unexpected Milestone 5 package-audit argument: ${argument}`);
}

const suppliedPackageArguments = Object.values(packageArguments).filter((value) => value !== null).length;
if (![0, 3].includes(suppliedPackageArguments)) {
	throw new Error('--product, --target, and --package-root must be supplied together.');
}
const packageOptions = suppliedPackageArguments === 0 ? null : packageArguments;
if (requirePass && packageOptions === null) {
	throw new Error('--require-pass requires --product, --target, and --package-root.');
}

const audit = packageOptions === null
	? await assembleMilestone5PackageAudit(repositoryRoot, process.env.SOUNDSCAPER_SOURCE_REVISION)
	: await assembleMilestone5ProductPackageAudit({
		repositoryRoot,
		sourceRevision: process.env.SOUNDSCAPER_SOURCE_REVISION,
		productIds: [packageOptions.productId],
		packageOptions,
	});
const bytes = `${JSON.stringify(audit, null, '\t')}\n`;
if (outputPath) writeFileSync(resolve(outputPath), bytes, { flag: 'wx' });
else process.stdout.write(bytes);
if (requirePass && !audit.passed) process.exitCode = 1;

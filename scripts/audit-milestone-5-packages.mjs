#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	assembleMilestone5PackageAuditSummary,
	readMilestone5PackageAuditDirectory,
} from './lib/milestone-5-package-audit-summary.mjs';

let auditDirectory = null;
let packageDirectory = null;
let outputPath = null;
let productId = null;
let requirePass = false;
for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];
	if (argument === '--require-pass') {
		if (requirePass) {
			throw new Error('--require-pass may be supplied only once.');
		}
		requirePass = true;
		continue;
	}
	if (['--input-directory', '--package-directory', '--output', '--product'].includes(argument)) {
		const value = process.argv[index += 1];
		if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
		if (argument === '--input-directory') {
			if (auditDirectory !== null) throw new Error(`${argument} may be supplied only once.`);
			auditDirectory = value;
		} else if (argument === '--package-directory') {
			if (packageDirectory !== null) throw new Error(`${argument} may be supplied only once.`);
			packageDirectory = value;
		} else if (argument === '--output') {
			if (outputPath !== null) throw new Error(`${argument} may be supplied only once.`);
			outputPath = value;
		} else {
			if (productId !== null) throw new Error(`${argument} may be supplied only once.`);
			if (!['soundscaper', 'framescaper'].includes(value)) {
				throw new Error('--product must select soundscaper or framescaper.');
			}
			productId = value;
		}
		continue;
	}
	throw new Error(`Unexpected Milestone 5 package-audit summary argument: ${argument}`);
}
if ((auditDirectory === null) === (packageDirectory === null)) {
	throw new Error('Supply exactly one of --input-directory or --package-directory.');
}

const summary = packageDirectory === null
	? await readMilestone5PackageAuditDirectory(
		resolve(auditDirectory), productId === null ? undefined : [productId],
	)
	: await assembleMilestone5PackageAuditSummary({
		repositoryRoot: resolve(import.meta.dirname, '..'),
		packageDirectory: resolve(packageDirectory),
		sourceRevision: process.env.SOUNDSCAPER_SOURCE_REVISION,
		...(productId === null ? {} : { productIds: [productId] }),
	});
const bytes = `${JSON.stringify(summary, null, '\t')}\n`;
if (outputPath) writeFileSync(resolve(outputPath), bytes, { flag: 'wx' });
else process.stdout.write(bytes);
if (requirePass && !summary.passed) process.exitCode = 1;

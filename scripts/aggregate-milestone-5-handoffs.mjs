#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	assembleMilestone5HandoffMatrix,
	auditMilestone5HandoffMatrixDirectory,
} from './lib/milestone-5-handoff-matrix.mjs';

let handoffDirectory = null;
let packageDirectory = null;
let outputPath = null;
let requireAutomatedReady = false;
for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];
	if (argument === '--require-ready') {
		throw new Error('--require-ready is ambiguous; use --require-automated-ready.');
	}
	if (argument === '--require-automated-ready') {
		if (requireAutomatedReady) {
			throw new Error('--require-automated-ready may be supplied only once.');
		}
		requireAutomatedReady = true;
		continue;
	}
	if (['--input-directory', '--package-directory', '--output'].includes(argument)) {
		const value = process.argv[index += 1];
		if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
		if (argument === '--input-directory') {
			if (handoffDirectory !== null) throw new Error(`${argument} may be supplied only once.`);
			handoffDirectory = value;
		} else if (argument === '--package-directory') {
			if (packageDirectory !== null) throw new Error(`${argument} may be supplied only once.`);
			packageDirectory = value;
		} else {
			if (outputPath !== null) throw new Error(`${argument} may be supplied only once.`);
			outputPath = value;
		}
		continue;
	}
	throw new Error(`Unexpected Milestone 5 matrix argument: ${argument}`);
}
if ((handoffDirectory === null) === (packageDirectory === null)) {
	throw new Error('Supply exactly one of --input-directory or --package-directory.');
}

const handoff = packageDirectory === null
	? await auditMilestone5HandoffMatrixDirectory(resolve(handoffDirectory))
	: await assembleMilestone5HandoffMatrix({
		repositoryRoot: resolve(import.meta.dirname, '..'),
		packageDirectory: resolve(packageDirectory),
		sourceRevision: process.env.SOUNDSCAPER_SOURCE_REVISION,
	});
const bytes = `${JSON.stringify(handoff, null, '\t')}\n`;
if (outputPath) writeFileSync(resolve(outputPath), bytes, { flag: 'wx' });
else process.stdout.write(bytes);
if (requireAutomatedReady && !handoff.milestoneAutomatedReady) process.exitCode = 1;

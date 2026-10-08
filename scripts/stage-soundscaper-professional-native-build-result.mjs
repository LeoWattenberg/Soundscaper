#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Revalidate and stage one native build result into an ephemeral packaging checkout. */

import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
	stageSoundscaperProfessionalNativeBuildResult,
} from './lib/soundscaper-professional-native-build-result.mjs';
import { stageProfessionalNativeBuildResultSet } from './lib/milestone-5-native-build-overlay.mjs';

const values = parseArguments(process.argv.slice(2));
const repositoryRoot = canonicalDirectory(resolve(values.root ?? process.cwd()), 'repository root');
const result = values['result-directory'] === undefined ? await stageSoundscaperProfessionalNativeBuildResult({
	buildResultRoot: canonicalDirectory(resolve(values.result), 'build-result root'),
	repositoryRoot,
}) : await stageProfessionalNativeBuildResultSet({
	resultsRoot: canonicalDirectory(resolve(values['result-directory']), 'build-result directory'), repositoryRoot,
});
process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);

function parseArguments(args) {
	const output = {};
	for (const argument of args) {
		const match = /^--(result|result-directory|root)=(.+)$/u.exec(argument);
		if (!match || output[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate argument ${argument}.`);
		}
		output[match[1]] = match[2];
	}
	if (Boolean(output.result) === Boolean(output['result-directory'])) {
		throw new TypeError('Supply exactly one of --result=... or --result-directory=....');
	}
	return output;
}

function canonicalDirectory(value, label) {
	if (!isAbsolute(value) || resolve(value) !== value || value.includes('\0')) {
		throw new TypeError(`The ${label} must be an absolute normalized path.`);
	}
	const metadata = lstatSync(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(value) !== value) {
		throw new Error(`The ${label} is not one canonical directory.`);
	}
	return value;
}

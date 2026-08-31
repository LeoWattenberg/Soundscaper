#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Revalidate and stage one native build result into an ephemeral packaging checkout. */

import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
	stageSoundscaperProfessionalNativeBuildResult,
} from './lib/soundscaper-professional-native-build-result.mjs';

const values = parseArguments(process.argv.slice(2));
const result = await stageSoundscaperProfessionalNativeBuildResult({
	buildResultRoot: canonicalDirectory(resolve(values.result), 'build-result root'),
	repositoryRoot: canonicalDirectory(resolve(values.root ?? process.cwd()), 'repository root'),
});
process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);

function parseArguments(args) {
	const output = {};
	for (const argument of args) {
		const match = /^--(result|root)=(.+)$/u.exec(argument);
		if (!match || output[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate argument ${argument}.`);
		}
		output[match[1]] = match[2];
	}
	if (!output.result) throw new TypeError('--result=... is required.');
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

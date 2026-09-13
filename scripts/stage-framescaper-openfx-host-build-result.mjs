#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Revalidate and stage one OpenFX CI result into an ephemeral packaging checkout. */

import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { stageFramescaperOpenFxHostBuildResult } from
	'./lib/framescaper-openfx-host-build-result.mjs';

const values = {};
for (const argument of process.argv.slice(2)) {
	const match = /^--(result|root)=(.+)$/u.exec(argument);
	if (!match || values[match[1]] !== undefined) {
		throw new TypeError(`Unsupported or duplicate OpenFX staging argument ${argument}.`);
	}
	values[match[1]] = match[2];
}
if (!values.result) throw new TypeError('--result=... is required.');
const result = await stageFramescaperOpenFxHostBuildResult({
	buildResultRoot: directory(resolve(values.result), 'build-result root'),
	repositoryRoot: directory(resolve(values.root ?? process.cwd()), 'repository root'),
});
process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);

function directory(value, label) {
	if (!isAbsolute(value) || resolve(value) !== value || value.includes('\0')) {
		throw new TypeError(`The ${label} must be absolute and normalized.`);
	}
	const metadata = lstatSync(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(value) !== value) {
		throw new Error(`The ${label} is not one canonical directory.`);
	}
	return value;
}

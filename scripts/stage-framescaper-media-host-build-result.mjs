#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Verify and stage one CI-produced media-host result into a packaging checkout. */

import { resolve } from 'node:path';

import { normalizeAbsoluteCliPath } from './lib/absolute-cli-path.mjs';
import {
	stageFramescaperMediaHostBuildResult,
} from './lib/framescaper-media-host-build-result-staging.mjs';

const values = {};
for (const argument of process.argv.slice(2)) {
	const match = /^--(build-result|root)=(.+)$/u.exec(argument);
	if (!match || values[match[1]] !== undefined) {
		throw new TypeError(`Unsupported or duplicate argument ${argument}.`);
	}
	values[match[1]] = match[2];
}
if (!values['build-result']) throw new TypeError('--build-result=... is required.');
const result = await stageFramescaperMediaHostBuildResult({
	repositoryRoot: normalizeAbsoluteCliPath(resolve(values.root ?? process.cwd()), 'repository root'),
	buildResultRoot: normalizeAbsoluteCliPath(resolve(values['build-result']), 'build-result root'),
});
process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);

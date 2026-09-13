#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Materialize the repository-pinned OpenFX source tree for one CI build job. */

import { resolve } from 'node:path';

import { normalizeAbsoluteCliPath } from './lib/absolute-cli-path.mjs';
import { provisionFramescaperOpenFxCiSource } from './lib/framescaper-openfx-source-ci.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
	const match = /^--(output|root)=(.+)$/u.exec(value);
	if (!match) throw new TypeError(`Unsupported OpenFX source-provision argument ${value}.`);
	return [match[1], match[2]];
}));
if (!args.output) throw new TypeError('--output=... is required.');
const result = await provisionFramescaperOpenFxCiSource({
	repositoryRoot: normalizeAbsoluteCliPath(resolve(args.root ?? process.cwd()), 'repository root'),
	destinationRoot: normalizeAbsoluteCliPath(resolve(args.output), 'OpenFX source output'),
});
process.stdout.write(`${JSON.stringify({
	status: 'provisioned', sourceRoot: result.sourceRoot,
}, null, '\t')}\n`);

#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build, self-test, and emit one target-native Framescaper OpenFX result. */

import { resolve } from 'node:path';

import { normalizeAbsoluteCliPath } from './lib/absolute-cli-path.mjs';
import { runFramescaperOpenFxHostCiBuild } from './lib/framescaper-openfx-host-ci.mjs';

const allowed = new Set(['boost-source', 'openfx-source', 'output', 'root', 'target', 'work-root']);
const values = {};
for (const argument of process.argv.slice(2)) {
	const match = /^--([a-z][a-z-]*)=(.+)$/u.exec(argument);
	if (!match || !allowed.has(match[1]) || values[match[1]] !== undefined) {
		throw new TypeError(`Unsupported or duplicate OpenFX build argument ${argument}.`);
	}
	values[match[1]] = match[2];
}
for (const name of ['boost-source', 'openfx-source', 'output', 'target', 'work-root']) {
	if (!values[name]) throw new TypeError(`--${name}=... is required.`);
}
const result = await runFramescaperOpenFxHostCiBuild({
	repositoryRoot: path(values.root ?? process.cwd(), 'repository root'),
	target: values.target,
	openfxSourceRoot: path(values['openfx-source'], 'OpenFX source root'),
	boostSourceRoot: path(values['boost-source'], 'Boost source root'),
	workRoot: path(values['work-root'], 'OpenFX work root'),
	buildResultRoot: path(values.output, 'OpenFX build-result root'),
});
process.stdout.write(`${JSON.stringify({
	status: 'build-result-created',
	target: result.receipt.target,
	outputRoot: result.buildResultRoot,
	buildRecipeSha256: result.receipt.buildRecipeSha256,
}, null, '\t')}\n`);

function path(value, label) {
	return normalizeAbsoluteCliPath(resolve(value), label);
}

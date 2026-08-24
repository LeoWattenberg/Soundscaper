#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const named = Object.fromEntries(process.argv.slice(2).map((argument) => {
	const [key, ...rest] = argument.replace(/^--/u, '').split('=');
	return [key, rest.join('=')];
}));
if (!named.provider || !named.profile || !named['source-revision'] || !named['budget-sha256']) {
	throw new Error('Usage: --provider=<module> --profile=<json> --source-revision=<40hex> --budget-sha256=<64hex>');
}
const { runM5aNativeLabDiagnostic } = await import(
	'../desktop/project-library-runtime/desktop/native-helper-lab-diagnostic.js'
);
const provider = await import(pathToFileURL(resolve(named.provider)).href);
if (typeof provider.createFreshM5aLabHelper !== 'function') {
	throw new Error('The lab provider must export createFreshM5aLabHelper(request).');
}
const result = await runM5aNativeLabDiagnostic({
	sourceRevision: named['source-revision'],
	budgetSha256: named['budget-sha256'],
	expectedRuntimeProfile: JSON.parse(named.profile),
	createFreshHelper: provider.createFreshM5aLabHelper,
});
process.stdout.write(`${JSON.stringify(result)}\n`);

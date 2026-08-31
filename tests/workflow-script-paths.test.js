/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const WORKFLOW_ROOT = new URL('.github/workflows/', ROOT);
const SCRIPT_INVOCATION = /(?:^|\s)(scripts\/[\w./-]+\.mjs)\b/gmu;
const INLINE_IMPORT = /from '(\.{1,2}\/[\w./-]+\.js)'/gu;

const workflowNames = (await readdir(WORKFLOW_ROOT)).filter((name) => name.endsWith('.yml')).sort();

test('workflows reference scripts and modules that exist in the checkout', async () => {
	assert.ok(workflowNames.length > 0, 'expected at least one workflow to audit');
	for (const workflowName of workflowNames) {
		const workflow = await readFile(new URL(workflowName, WORKFLOW_ROOT), 'utf8');
		const referenced = new Set([
			...[...workflow.matchAll(SCRIPT_INVOCATION)].map((match) => match[1]),
			...[...workflow.matchAll(INLINE_IMPORT)].map((match) => match[1].replace(/^\.{1,2}\//u, '')),
		]);
		for (const path of referenced) {
			await assert.doesNotReject(
				access(new URL(path, ROOT)),
				`${workflowName} references ${path}, which is missing from the checkout`,
			);
		}
	}
});

test('the translation sync workflow reads the committed locale tags from their owning module', async () => {
	const workflow = await readFile(new URL('sync-audacity-translations.yml', WORKFLOW_ROOT), 'utf8');
	const specifier = /import \{ COMMITTED_LOCALE_TAGS \} from '(?<path>[^']+)'/u.exec(workflow)?.groups?.path;

	assert.ok(specifier, 'the prepare job must derive --exposed-locales from the committed locale module');
	const module = await import(new URL(specifier.replace(/^\.{1,2}\//u, ''), ROOT).href);
	assert.ok(Array.isArray(module.COMMITTED_LOCALE_TAGS) && module.COMMITTED_LOCALE_TAGS.includes('en'),
		`${specifier} must export the committed locale tags the staged release is verified against`);
});

test('the translation discovery request authenticates with the workflow token', async () => {
	const workflow = await readFile(new URL('sync-audacity-translations.yml', WORKFLOW_ROOT), 'utf8');
	const discoveryStep = / {6}- name: Discover and verify the latest upstream artifact\n(?<step>[\s\S]*?)(?=\n {6}- name:)/u
		.exec(workflow)?.groups?.step;

	assert.ok(discoveryStep, 'the translation workflow must retain its upstream discovery step');
	assert.match(discoveryStep, / {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n/u);
});

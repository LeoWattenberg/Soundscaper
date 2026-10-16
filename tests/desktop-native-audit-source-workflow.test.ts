/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('desktop audit sources follow the selected engineering scope and authenticate before upload', async () => {
	const sources = extractJob(await readWorkflow('desktop-preview.yml'), 'milestone-5-native-audit-source');
	assert.match(sources, /needs: \[quality, professional-native-source\]/u);
	assert.match(sources, /name: desktop-professional-native-source-cache/u);
	assert.match(sources, /SOUNDSCAPER_NATIVE_AUDIT_PRODUCTS: \$\{\{ needs\.quality\.outputs\.release-products \}\}/u);
	assert.match(sources, /milestone5EngineeringScope\(products\)/u);
	assert.match(sources, /scope\.sourceIds\.flatMap\(\(id\) => \['--source', id\]\)/u);
	assert.match(sources, /auditMilestone5NativeSourceAcquisitionsForProducts\(process\.cwd\(\), products, root\)/u);
	const upload = sources.indexOf('name: desktop-milestone-5-native-audit-source-cache');
	assert.ok(upload > sources.indexOf('auditMilestone5NativeSourceAcquisitionsForProducts(process.cwd()'));
	assert.match(sources, /'--check', '--root', root, \.\.\.selectors/u);
});

test('Framescaper package audits use the retained cache while native builds and release sources retain their ten-source cache', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const packages = extractJob(workflow, 'package');
	assert.match(packages, /needs: \[[^\n]*milestone-5-native-audit-source\]/u);
	assert.match(packages, /if: matrix\.product == 'framescaper'[\s\S]*?name: desktop-milestone-5-native-audit-source-cache/u);
	const audit = packages.slice(packages.indexOf('- name: Audit the Milestone 5 package'),
		packages.indexOf('- name: Upload the Milestone 5 package audit'));
	assert.match(audit, /SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT: \$\{\{ matrix\.product == 'framescaper' && format\('\{0\}\/soundscaper-milestone-5-audit-source-cache', runner\.temp\) \|\| format\('\{0\}\/soundscaper-professional-native-source-cache', runner\.temp\) \}\}/u);
	const build = extractJob(workflow, 'professional-native-build');
	assert.match(build, /source-cache-artifact: desktop-professional-native-source-cache/u);
	const release = extractJob(workflow, 'release-inventory');
	assert.match(release, /name: desktop-professional-native-source-cache/u);
	assert.doesNotMatch(release, /desktop-milestone-5-native-audit-source-cache/u);
});

test('aggregate package audits select the same retained source cache for a Framescaper release or nightly suite', async () => {
	const aggregate = extractJob(await readWorkflow('desktop-preview.yml'), 'milestone-5-package-audit-summary');
	assert.match(aggregate, /needs: \[quality, package, milestone-5-native-audit-source\]/u);
	assert.match(aggregate, /if: contains\(fromJSON\(needs\.quality\.outputs\.release-products\), 'framescaper'\)[\s\S]*?name: desktop-milestone-5-native-audit-source-cache/u);
	const audit = aggregate.slice(aggregate.indexOf('- name: Re-audit and summarize the packages'));
	assert.match(audit, /SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT: \$\{\{ contains\(fromJSON\(needs\.quality\.outputs\.release-products\), 'framescaper'\) && format\('\{0\}\/soundscaper-milestone-5-audit-source-cache', runner\.temp\) \|\| format\('\{0\}\/soundscaper-professional-native-source-cache', runner\.temp\) \}\}/u);
});

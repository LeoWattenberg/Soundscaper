/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJob } from './helpers/workflow-jobs.js';

test('Motion tags enter a separate quality-gated package route and never the inherited native or assistance publishers', async () => {
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	for (const stage of ['alpha', 'beta', 'rc']) assert.ok(workflow.includes(`'motionscaper-v*-${stage}.*'`));
	assert.ok(extractJob(workflow, 'quality').includes("release ? [release.productId] : ['soundscaper', 'framescaper']"));
	const motion = extractJob(workflow, 'motionscaper-preview');
	assert.match(motion, /needs: \[quality, tests, coverage, browser, firefox\]/u);
	assert.match(motion, /startsWith\(github.ref, 'refs\/tags\/motionscaper-v'\)/u);
	assert.match(motion, /uses: \.\/\.github\/workflows\/motionscaper-desktop-preview.yml/u);
	for (const job of ['publish-assistance-runtime-handoff', 'professional-native-source', 'soundscaper-project-library-lease-matrix']) {
		assert.match(extractJob(workflow, job), /!startsWith\(github.ref, 'refs\/tags\/motionscaper-v'\)/u);
	}
});

test('Motion preview packages exact helper results with own smoke and mandatory source inventory without publishing', async () => {
	const workflow = await readFile(new URL('../.github/workflows/motionscaper-desktop-preview.yml', import.meta.url), 'utf8');
	assert.match(workflow, /workflow_call:/u); assert.doesNotMatch(workflow, /contents: write|gh release|--publish always|publish: /u);
	assert.match(extractJob(workflow, 'native'), /uses: \.\/\.github\/workflows\/motionscaper-media-host-native-build.yml/u);
	const packages = extractJob(workflow, 'package');
	assert.match(packages, /needs: native/u); assert.match(packages, /SCAPE_PRODUCT: motionscaper/u);
	assert.match(packages, /MOTIONSCAPER_NATIVE_BUILD_RESULT: \$\{\{ runner.temp \}\}\/motionscaper-native-build-result/u);
	assert.ok(packages.indexOf('name: motionscaper-media-host-build-result-') < packages.indexOf('run: node scripts/desktop-prepare.mjs'));
	assert.match(packages, /node scripts\/motionscaper-release-target.ts/u);
	assert.match(packages, /--publish never/u); assert.match(packages, /name: motionscaper-preview-\$\{\{ matrix.target.id \}\}/u);
	const inventory = extractJob(workflow, 'inventory');
	assert.match(inventory, /needs: package/u); assert.match(inventory, /node scripts\/motionscaper-release-assets.ts/u);
	assert.match(inventory, /name: motionscaper-preview-inventory/u); assert.match(inventory, /name: motionscaper-preview-evidence/u);
});

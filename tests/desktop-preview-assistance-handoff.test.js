/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('preview publishes Windows AI archives once and packages the authenticated handoff', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const publisher = extractJob(workflow, 'publish-windows-assistance-runtime-handoff');
	const packager = extractJob(workflow, 'package');
	assert.match(publisher, /needs: \[quality, tests, coverage, browser, firefox\]/u);
	assert.match(publisher, /matrix:[\s\S]*?windows-2025[\s\S]*?windows-11-arm/u);
	assert.match(publisher, /node scripts\/desktop-prepare\.mjs/u);
	assert.match(publisher, /desktop:publish:assistance-runtimes/u);
	assert.match(publisher, /node scripts\/export-assistance-runtime-handoff\.mjs/u);
	assert.match(publisher, /name: assistance-runtime-handoff-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(publisher, /SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(publisher, /R2_MODELS_ACCESS_KEY_ID: \$\{\{ secrets\.R2_MODELS_ACCESS_KEY_ID \}\}/u);
	assert.match(packager, /needs: \[quality, tests, coverage, browser, firefox, publish-windows-assistance-runtime-handoff\]/u);
	assert.match(packager, /Download the published Windows AI runtime handoff/u);
	assert.match(packager, /SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT:/u);
	assert.match(packager, /node scripts\/publish-assistance-runtime-assets\.mjs --verify/u);
	assert.doesNotMatch(packager, /R2_MODELS_|desktop:publish:assistance-runtimes/u);
});

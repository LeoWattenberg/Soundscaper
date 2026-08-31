/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('the stable tag runs ordinary checks, packages every target, deploys, and publishes', async () => {
	const workflow = await readFile(new URL('.github/workflows/soundscaper-stable-1.yml', ROOT), 'utf8');
	assert.match(workflow, /tags:\s*\n\s*- 'v1\.0\.0'/u);
	assert.match(workflow, /verifyCheckedInSoundscaperRelease/u);
	assert.match(workflow, /RELEASE_TAG:\s*\$\{\{ github\.ref_name \}\}/u);
	assert.match(workflow, /npm run check:static/u);
	for (const shard of ['framescaper', 'soundscaper', 'common']) {
		assert.match(workflow, new RegExp(`shard: ${shard}`, 'u'));
	}
	assert.match(workflow, /npm run coverage:check/u);
	assert.match(workflow, /npm run test:browser/u);
	assert.match(workflow, /uses: \.\/\.github\/workflows\/soundscaper-professional-native-build\.yml/u);
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		assert.match(workflow, new RegExp(`target: ${target}`, 'u'));
	}
	assert.match(workflow, /stage-soundscaper-professional-native-build-result\.mjs/u);
	assert.match(workflow, /npm run desktop:smoke/u);
	assert.match(workflow, /desktop:release-assets -- --product soundscaper/u);
	assert.match(workflow, /Soundscaper-1\.0\.0-source\.tar\.gz/u);
	assert.match(workflow, /THIRD_PARTY_LICENSES\.md/u);
	assert.match(workflow, /SHA256SUMS/u);
	assert.match(workflow, /gh release create .*--draft/isu);
	assert.match(workflow, /wrangler pages deploy dist --project-name=soundscaper --branch=main/u);
	assert.match(workflow, /npm run verify:pages/u);
	assert.match(workflow, /gh release edit .*--draft=false/isu);
	assert.doesNotMatch(workflow,
		/admission|attestation|productionReadiness|reviewKey|notari[sz]|Developer ID|CSC_LINK|CSC_KEY_PASSWORD|SIGNING_CERTIFICATE|APPLE_ID/iu);
	assert.doesNotMatch(workflow, /soundscaper-stable-lifecycle-smoke/u);
	assert.doesNotMatch(workflow, /framescaper-v|SCAPE_PRODUCT: framescaper/iu);
	assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/u);
	assert.doesNotMatch(workflow, /signing.identity|certificate|notari[sz]/iu);
	assert.match(workflow, /^permissions: \{\}$/mu);
	const actionReferences = [...workflow.matchAll(/^\s+- uses: (?<reference>\S+)/gmu)]
		.map(({ groups }) => groups.reference)
		.filter((reference) => !reference.startsWith('./'));
	assert.ok(actionReferences.length > 0);
	assert.deepEqual(actionReferences.filter((reference) => !/@[a-f0-9]{40}$/u.test(reference)), []);
});

test('preview packaging has no dormant stable admission step', async () => {
	const workflow = await readFile(new URL('.github/workflows/desktop-preview.yml', ROOT), 'utf8');
	assert.doesNotMatch(workflow, /Stable 1 admission|release:soundscaper:stable-1:admission/iu);
});

test('release workflow dependencies keep publishing behind checks and deployment', async () => {
	const workflow = await readFile(new URL('.github/workflows/soundscaper-stable-1.yml', ROOT), 'utf8');
	const assembly = workflowJob(workflow, 'assemble');
	assert.match(assembly, /needs: \[source, coverage, browser, package\]/u);
	assert.match(workflowJob(workflow, 'draft-release'), /needs: assemble/u);
	assert.match(workflowJob(workflow, 'deploy-web'), /needs: \[source, draft-release\]/u);
	assert.match(workflowJob(workflow, 'publish-release'), /needs: deploy-web/u);
	assert.equal([...workflow.matchAll(/contents: write/gu)].length, 2);
});

function workflowJob(source, name) {
	const marker = `\n  ${name}:\n`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `workflow job ${name} exists`);
	const nextJob = /\n {2}[a-z][a-z0-9-]*:\n/gu;
	nextJob.lastIndex = start + marker.length;
	const next = nextJob.exec(source);
	return source.slice(start, next === null ? source.length : next.index);
}

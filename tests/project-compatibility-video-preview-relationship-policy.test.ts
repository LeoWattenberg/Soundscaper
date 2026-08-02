/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface CompatibilityRule {
	readonly id: string;
	readonly status: string;
	readonly requiredOutcome: string;
	readonly currentBehavior: string;
	readonly evidence: readonly string[];
}

interface CompatibilityPolicy {
	readonly rules: readonly CompatibilityRule[];
}

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('disposable video previews remain reproducible local relationships, not durable project media', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8')) as CompatibilityPolicy;
	const relationship = policy.rules.find(
		({ id }) => id === 'current-disposable-video-preview-relationship',
	);
	assert.ok(relationship, 'the disposable video-preview relationship rule is required');
	assert.equal(relationship.status, 'implemented');
	assert.match(
		relationship.requiredOutcome,
		/trusted retained original.*content digest.*type.*time.*versioned recipe.*output integrity/iu,
	);
	assert.match(
		relationship.requiredOutcome,
		/reproducible cache.*(?:project history|history).*\.scape.*managed handoff.*rendered fallback.*durable/iu,
	);
	assert.match(
		relationship.currentBehavior,
		/repository.*derives.*original.*SHA-256.*generation token.*caller/iu,
	);
	assert.match(
		relationship.currentBehavior,
		/content-addressed.*storage key.*digest.*poster or thumbnail.*normalized timestamp.*recipe ID.*recipe version/iu,
	);
	assert.match(
		relationship.currentBehavior,
		/revalidates.*original.*before.*public.*(?:the )?same IndexedDB transaction/iu,
	);
	assert.match(
		relationship.currentBehavior,
		/load.*companion.*output size.*SHA-256.*legacy.*cache miss/iu,
	);
	assert.match(
		relationship.currentBehavior,
		/new video imports.*null.*preview locators.*read-write.*\.scape imports.*null.*desktop recipient binding.*ignores/iu,
	);
	assert.match(
		relationship.currentBehavior,
		/maintained exact-schema first-party audio whole-mix fallback.*separately qualified.*fresh-recipient managed acquisition.*activation.*first-party video-effects full render.*separately qualified.*controller activation.*route-specific source and digest admission.*generic video fallback and proxy relationships.*unqualified/iu,
	);
	for (const evidence of [
		'src/common/editor/storage/video-derivative-relationship.ts',
		'src/common/editor/storage/video-derivative-repository.ts',
		'src/common/editor/controller/source-import.ts',
		'src/common/editor/commands/project-source-bin-runtime.js',
		'src/common/editor/scape-project.js',
		'src/common/editor/storage/desktop-shared-project-source-availability.ts',
		'tests/audio-editor-video-derivative-binding.test.ts',
		'tests/audio-editor-source-import.test.ts',
		'tests/audio-editor-project-bin.test.js',
		'tests/audio-editor-scape-project.test.js',
		'tests/audio-editor-desktop-shared-project-source-availability.test.ts',
		'tests/audio-editor-desktop-shared-project-media-sender-video.test.ts',
		'tests/audio-editor-feature-requirement-retention.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
	]) assert.ok(relationship.evidence.includes(evidence), evidence);

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /Disposable video preview relationships/iu);
	assert.match(
		documentation,
		/poster.*thumbnail.*trusted retained original.*versioned recipe.*output.*SHA-256/isu,
	);
	assert.match(
		documentation,
		/reproducible.*not.*project history.*\.scape.*managed handoff.*rendered fallbacks.*durable/isu,
	);
	assert.match(documentation, /maintained exact-schema first-party audio whole-mix fallback.*separately qualified.*fresh-recipient managed acquisition.*activation.*first-party video-effects full render.*separately qualified.*controller activation.*route-specific source and digest admission.*generic video fallback and proxy relationships remain unqualified/isu);
	assert.match(
		documentation,
		/not editorial proxies.*decoder.*RSS/isu,
	);
});

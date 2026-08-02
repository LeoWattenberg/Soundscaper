/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);
const compatibilityDocumentUrl = new URL('../docs/project-compatibility.md', import.meta.url);
const securityUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('linked WAV handoff policy stays point-in-time and container-free', async () => {
	const policy = JSON.parse(await readFile(compatibilityUrl, 'utf8'));
	const rule = policy.rules.find(
		({ id }) => id === 'current-desktop-linked-wav-managed-handoff',
	);
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/explicitly injected Electron.*point-in-time.*RIFF or RF64 WAV.*PCM or IEEE-float.*512 MiB.*main-private.*pathless.*sender.*no owned PCM body.*explicit managed handoff.*canonical Float32 PCM.*fresh recipient.*ordinary owned canonical PCM.*reopen.*without.*locator.*external WAV container.*locator.*must not enter.*shared managed catalog.*recipient/iu,
	);
	assert.match(
		rule.currentBehavior,
		/main-private registry.*absolute path.*device, inode, size, modification time, and change time.*512 MiB.*binding.*scalar.*pathless.*whole WAV snapshot.*exact SHA-256.*RIFF or RF64.*PCM or IEEE-float.*canonical source geometry.*sender.*owned source inventory remains empty.*prepareHandoff.*two.*canonical Float32.*managed `audio-f32le-chunks-v1`.*fresh recipient.*owned source writer.*reopens.*without.*linked-original port.*WAV container bytes.*locator identity.*never cross.*managed-media bridge or catalog/iu,
	);
	for (const path of [
		'desktop/linked-video-locator-ipc.js',
		'src/common/editor/desktop-linked-original-port.ts',
		'src/common/editor/controller/linked-wav-import-service.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/desktop-linked-audio-locator.test.ts',
		'tests/audio-editor-linked-wav-import.test.ts',
		'tests/audio-editor-linked-audio-source-reader.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
	]) assert.ok(rule.evidence.includes(path), path);

	const documentation = await readFile(compatibilityDocumentUrl, 'utf8');
	assert.match(
		documentation,
		/narrow linked-WAV managed-handoff exception.*explicitly injected Electron.*point-in-time.*RIFF or RF64.*PCM or IEEE-float.*512 MiB.*main-private registry.*sender.*owned PCM inventory remains empty.*explicit `prepareHandoff`.*canonical Float32 PCM.*fresh recipient.*ordinary owned source writer.*reopen.*without.*locator.*external WAV container bytes.*locator identity.*do not cross.*managed-media bridge or enter.*shared catalog/isu,
	);
	assert.match(
		documentation,
		/does not qualify.*packaged executable or UI.*operating-system file-dialog or path durability.*relink or watch.*broader audio formats.*audio range playback.*generic linked-audio support/isu,
	);
});

test('linked WAV managed handoff is a narrow point-in-time security control', async () => {
	const matrix = JSON.parse(await readFile(securityUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'point-in-time-linked-wav-managed-handoff',
	);
	assert.equal(risk?.status, 'partial');
	assert.ok(control);
	assert.match(
		control.summary,
		/explicitly injected Electron.*main-private.*pathless point-in-time binding.*RIFF or RF64 WAV.*PCM or IEEE-float.*512 MiB.*sender.*no owned PCM body.*whole external WAV.*exact digest.*canonical geometry/iu,
	);
	assert.match(
		control.summary,
		/canonical Float32 PCM chunks.*only explicit managed handoff.*two canonical Float32 PCM passes.*`audio-f32le-chunks-v1`/iu,
	);
	assert.match(
		control.summary,
		/fresh recipient.*no locator port.*ordinary owned canonical PCM.*reopen.*without the original locator.*external WAV container bytes.*locator identity.*never cross.*managed-media bridge or catalog/iu,
	);
	assert.match(
		control.summary,
		/not.*packaged executable or UI.*operating-system file-dialog or path durability.*relink or watch.*broader formats.*audio range playback.*generic linked-audio support/iu,
	);
	for (const path of [
		'desktop/linked-video-locator-store.ts',
		'desktop/linked-video-locator-ipc.js',
		'desktop/preload.mjs',
		'src/common/editor/desktop-linked-original-port.ts',
		'src/common/editor/controller/linked-wav-import-service.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/desktop-linked-audio-locator.test.ts',
		'tests/audio-editor-linked-wav-import.test.ts',
		'tests/audio-editor-linked-audio-source-reader.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	const residual = risk?.residualRisks.find(
		({ id }) => id === 'shared-library-cross-product-media-availability',
	);
	assert.match(
		residual?.exposure ?? '',
		/narrow linked-WAV exception.*point-in-time.*sender without owned PCM.*canonical Float32 PCM.*fresh recipient.*(?:owns|owned) canonical PCM.*without the locator.*external WAV container.*does not cross/iu,
	);
	assert.match(
		residual?.exposure ?? '',
		/broader linked audio.*packaged executable or UI.*operating-system path durability.*relink or watch.*audio range playback.*remain.*open/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/narrow linked-WAV managed-handoff exception.*Electron-injected.*point-in-time/isu,
	);
	assert.match(
		threatModel,
		/main-private RIFF or RF64 WAV no larger than 512 MiB\s+when.*PCM or IEEE-float/isu,
	);
	assert.match(
		threatModel,
		/sender has\s+no owned PCM.*explicit managed handoff.*two\s+canonical Float32 PCM passes.*fresh recipient.*ordinary\s+owned canonical PCM.*reopens without the original locator/isu,
	);
	assert.match(
		threatModel,
		/external container bytes and locator identity do not cross the managed-media\s+bridge or enter its catalog/iu,
	);
	assert.match(
		threatModel,
		/does not qualify.*packaged executable or UI.*operating-system file-dialog or path durability.*relink or watch.*broader audio formats.*audio ranges.*generic linked-audio/isu,
	);
});

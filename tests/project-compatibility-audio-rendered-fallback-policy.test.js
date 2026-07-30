/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('compatibility policy qualifies only first-party audio whole-mix fallback playback', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-first-party-audio-rendered-fallback-playback');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(rule.requiredOutcome, /exact-current-schema.*audioEffects.*rendered fallback.*whole-mix.*editor playback.*canonical state/iu);
	assert.match(
		rule.currentBehavior,
		/authoritative.*exact schema 9.*registered audioEffects.*unavailable.*declared and effective rendered-fallback.*descriptor.*canonical manifest/iu,
	);
	assert.match(
		rule.currentBehavior,
		/one.*mono or stereo.*full.*frame zero.*sample rate.*master channel.*ADM.*surround.*reject.*ambiguous.*reserved.*reject/iu,
	);
	assert.match(
		rule.currentBehavior,
		/removes canonical audio clips and tracks.*neutral.*mixer and master.*retains video and label.*initial activation and later engine reapplies.*stored metadata.*rechecked.*short sources.*buffer geometry.*oversized sources.*streamable chunk provider.*does not prefetch or revalidate.*later provider failure.*readiness failure.*prevents.*engine load/iu,
	);
	assert.match(
		rule.currentBehavior,
		/canonical project.*history.*persistence.*save.*export.*offline render.*unchanged.*persistent localized.*active during editor playback.*without exposing.*source/iu,
	);
	assert.match(
		rule.currentBehavior,
		/point-in-time.*not.*durable byte lease.*stale.*source preparation.*cache or provider state.*activation source failure.*does not roll.*back.*generic or video fallback.*unknown or third-party.*future schemas.*earlier Soundscaper/iu,
	);

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-audio-rendered-fallback.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/source-audio.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(rule.evidence.includes(reference), reference);

	const documentation = await readFile(new URL('../docs/project-compatibility.md', import.meta.url), 'utf8');
	const roadmap = await readFile(new URL('../roadmap.md', import.meta.url), 'utf8');
	assert.match(documentation, /exact schema 9.*first-party audio-effects rendered fallback.*whole-mix.*frame zero.*editor playback/isu);
	assert.match(documentation, /point-in-time.*not a durable byte lease.*generic and video.*fallback.*remain/isu);
	assert.match(roadmap, /exact-schema-V9.*first-party audio-effects rendered\s+fallback/isu);
	assert.match(roadmap, /For editor\s+playback.*whole-mix clip.*frame zero/isu);
	assert.match(roadmap, /editor playback through the short decoded-source.*persistent active-fallback indicator.*browser-qualified.*stream-provider readiness.*unit coverage only.*does not.*prefetch or revalidate.*chunks after point-in-time admission.*exit.*remains open.*rendered-fallback\s+runtime behavior\s+beyond.*first-party audio whole-mix/isu);
});

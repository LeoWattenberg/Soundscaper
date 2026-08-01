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
		rule.requiredOutcome,
		/explicit managed desktop handoff.*fallback source.*only by that requirement.*fresh-recipient acquisition.*controller digest verification.*activation/iu,
	);
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
		/removes canonical audio clips and tracks.*neutral.*mixer and master.*retains video and label.*initial activation and later engine reapplies.*stored metadata.*rechecked.*short sources.*buffer geometry.*oversized sources.*streamable chunk provider.*does not prefetch or revalidate.*later provider failure/iu,
	);
	assert.match(
		rule.currentBehavior,
		/initial activation.*required fallback source.*decoded buffer or stream-provider candidate.*privately.*before.*session activation reservation.*without mutating.*shared source-buffer or provider.*engine chunk sources.*currentness or reservation.*discarded.*prior buffer and provider identities.*active project, tab, and lock.*unchanged/iu,
	);
	assert.match(
		rule.currentBehavior,
		/ordinary-source loading.*excludes.*required fallback.*private source-buffer and chunk-source snapshots.*staged required representation.*wins.*engine.*engine callback succeeds.*lifetime signal.*active.*synchronous project-identity or activation-admission assertion.*immediately before shared publication.*no intervening await.*shared source maps/iu,
	);
	assert.match(
		rule.currentBehavior,
		/canonical project.*history.*persistence.*save.*export.*offline render.*unchanged.*persistent localized.*active during editor playback.*without exposing.*source/iu,
	);
	assert.match(
		rule.currentBehavior,
		/point-in-time.*not.*durable byte lease/iu,
	);
	assert.match(
		rule.currentBehavior,
		/each canonical playback reapply.*one replaceable controller-lifetime task.*newer reapply.*successful project switch.*abort.*metadata.*audio-context.*decoded-body.*exact reason.*late settlement.*buffers.*chunk providers.*engine chunk sources.*missing-source state.*status.*only the newest source-ready projection.*engine/iu,
	);
	assert.match(
		rule.currentBehavior,
		/explicit desktop handoff.*roots.*fallback-only source.*manifest.*canonical managed PCM.*editable original.*fresh recipient.*both bodies.*canonical shadow.*transfer acquisition.*managed descriptor and body SHA-256.*controller separately verifies.*manifest fallback digest.*after shadow publication.*before.*transient whole-mix projection.*exact fallback samples.*engine/iu,
	);
	assert.match(
		rule.currentBehavior,
		/engine.*already entered.*not abortable.*transactional.*engine-side effects.*later activation failure.*successful commit.*not roll back.*ordinary-source loading.*outside.*cache-fit policy.*streamed chunks.*not prefetched or revalidated.*generic or video fallback.*unknown or third-party.*future schemas.*earlier Soundscaper/iu,
	);

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-audio-rendered-fallback.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/source-audio.ts',
		'src/common/editor/retention.js',
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-required-source-preparation.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/desktop-project-library-audio-rendered-fallback-handoff.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(rule.evidence.includes(reference), reference);

	const documentation = await readFile(new URL('../docs/project-compatibility.md', import.meta.url), 'utf8');
	assert.match(documentation, /exact schema 9.*first-party audio-effects rendered fallback.*whole-mix.*frame zero.*editor playback/isu);
	assert.match(documentation, /initial activation.*required fallback source.*decoded buffer or stream-provider candidate.*privately.*before.*activation reservation.*without changing.*shared buffer.*provider.*engine.*chunk-source state.*currentness.*reservation.*fails.*discarded.*prior buffer.*provider.*identities.*active project.*tab.*lock.*unchanged/isu);
	assert.match(documentation, /ordinary-source loading.*excludes.*required fallback.*private source-buffer.*chunk-source snapshots.*staged required representation.*wins.*engine.*engine callback.*succeeds.*lifetime signal.*active.*synchronous project-identity or.*activation-admission assertion.*immediately\s+before shared publication.*no.*intervening await.*shared\s+source maps/isu);
	assert.match(documentation, /each canonical playback reapply.*replaceable controller-lifetime task.*newer reapply.*successful project switch.*abort.*metadata.*audio-context.*decoded-body.*exact signal reason.*late settlement.*buffer.*provider.*engine-source.*missing-source.*status.*only the newest source-ready projection.*engine/isu);
	assert.match(documentation, /engine.*already entered.*not abortable.*transactional.*engine-side effects.*later activation.*failure.*successful commit.*does not roll back.*ordinary-source loading.*outside.*cache-fit policy.*does not.*prefetch or revalidate/isu);
	assert.match(documentation, /explicit desktop handoff.*manifest reachability.*fallback.*no timeline or Project Bin clip.*Soundscaper.*canonical original and fallback PCM.*fresh Framescaper.*both exact managed bodies.*canonical project shadow.*managed descriptor and body digest.*controller.*manifest fallback digest.*before.*read-only activation.*engine.*synthetic whole-mix.*exact fallback samples.*document snapshot.*canonical project/isu);
	assert.match(documentation, /point-in-time.*not a durable byte lease.*generic and video.*fallback.*remain/isu);
});

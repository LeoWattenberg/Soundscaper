/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('compatibility policy qualifies role-defined audio whole-mix fallback playback and delivery', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-audio-whole-mix-rendered-fallback');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/exact-current-schema.*canonical namespaced feature identity.*unavailable or unknown.*closed project-audio-mix-v1.*whole-mix.*editor playback.*final-mix audio export.*selector-bound operation-time.*private chunk provider.*canonical state/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/explicit managed desktop handoff.*fallback source.*only by that requirement.*fresh-recipient acquisition.*controller digest verification.*activation/iu,
	);
	assert.match(
		rule.currentBehavior,
		/authoritative.*exact schema 9.*exactly one.*canonical namespaced feature ID.*unavailable or unknown.*declared and effective rendered-fallback.*closed project-audio-mix-v1.*canonical manifest/iu,
	);
	assert.match(
		rule.currentBehavior,
		/closed role supplies.*media semantics.*feature ID.*opaque identity.*does not discover, load, or execute.*feature code/iu,
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
		/audio delivery projection.*only.*audio rendered fallback.*does not compose.*video rendered fallback.*bypass.*simultaneous rendered fallback.*reject/iu,
	);
	assert.match(
		rule.currentBehavior,
		/final-mix.*only.*stems.*BW64.*ADM.*reject.*before.*verification.*plan.*(?:picker|destination selection).*render/iu,
	);
	assert.match(
		rule.currentBehavior,
		/operation-time.*selector.*requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*full canonical.*chunk scan.*private.*chunk provider.*sole.*render source.*global.*buffer.*provider.*cache.*unchanged/iu,
	);
	assert.match(
		rule.currentBehavior,
		/provider.*read.*rereads.*stored chunk.*geometry.*digest.*currentness.*chang.*integrity.*offline.*does not retry.*realtime/iu,
	);
	assert.match(
		rule.currentBehavior,
		/canonical project.*history.*persistence.*save.*unchanged.*persistent localized.*active during editor playback.*without exposing.*source/iu,
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
		/maintained org\.example\.future-mixer unknown-feature desktop handoff witness.*feature-requirement-only intrinsic read-only.*current writable project lock.*without flushing.*roots.*fallback-only source.*manifest.*canonical managed PCM.*editable original.*fresh recipient.*both bodies.*canonical shadow.*transfer acquisition.*managed descriptor and body SHA-256.*controller separately verifies.*manifest fallback digest.*after shadow publication.*before.*transient whole-mix projection.*exact fallback samples.*engine.*corrupt.*after activation.*reject.*before.*render.*output.*repair.*exact PCM.*final-mix.*canonical.*unchanged/iu,
	);
	assert.match(
		rule.currentBehavior,
		/org\.example\.future-mixer.*unknown-feature composed Soundscaper-to-fresh-Framescaper.*manifest.*metadata.*localized.*UI.*exact feature ID.*requirement ID/iu,
	);
	assert.match(
		rule.currentBehavior,
		/operation-time.*selector.*exact requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*tamper.*refus.*repair.*canonical project.*shadow.*unchanged/iu,
	);
	assert.match(
		rule.currentBehavior,
		/engine.*already entered.*not abortable.*transactional.*engine-side effects.*later activation failure.*successful commit.*not roll back.*ordinary-source loading.*outside.*cache-fit policy.*streamed chunks.*not prefetched or revalidated.*more than one.*feature identities.*non-audio roles.*future schemas.*earlier Soundscaper.*linked-only.*unmanaged.*authoring.*freeze.*proxy.*publisher authenticity.*third-party code activation.*packaged.*UI.*browser.*reference-scale.*durable byte lease/iu,
	);

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-audio-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/controller/audio-rendered-fallback-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/source-audio.ts',
		'src/common/editor/retention.js',
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-audio-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-provider.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-required-source-preparation.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/desktop-project-library-audio-rendered-fallback-handoff.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(rule.evidence.includes(reference), reference);

	const documentation = await readFile(new URL('../docs/project-compatibility.md', import.meta.url), 'utf8');
	const normalizedDocumentation = documentation.replace(/\s+/gu, ' ');
	assert.match(normalizedDocumentation, /exact schema 9.*canonical namespaced feature ID.*unavailable or unknown.*closed `project-audio-mix-v1` role.*whole-mix.*frame zero.*editor playback/isu);
	assert.match(normalizedDocumentation, /closed role supplies.*media semantics.*feature ID.*opaque identity.*does not discover, load, or execute.*feature code/isu);
	assert.match(documentation, /initial activation.*required fallback source.*decoded buffer or stream-provider candidate.*privately.*before.*activation reservation.*without changing.*shared buffer.*provider.*engine.*chunk-source state.*currentness.*reservation.*fails.*discarded.*prior buffer.*provider.*identities.*active project.*tab.*lock.*unchanged/isu);
	assert.match(documentation, /ordinary-source loading.*excludes.*required fallback.*private source-buffer.*chunk-source snapshots.*staged required representation.*wins.*engine.*engine callback.*succeeds.*lifetime signal.*active.*synchronous project-identity or.*activation-admission assertion.*immediately\s+before shared publication.*no.*intervening await.*shared\s+source maps/isu);
	assert.match(documentation, /each canonical playback reapply.*replaceable controller-lifetime task.*newer reapply.*successful project switch.*abort.*metadata.*audio-context.*decoded-body.*exact signal reason.*late settlement.*buffer.*provider.*engine-source.*missing-source.*status.*only the newest source-ready projection.*engine/isu);
	assert.match(documentation, /engine.*already entered.*not abortable.*transactional.*engine-side effects.*later activation.*failure.*successful commit.*does not roll back.*ordinary-source loading.*outside.*cache-fit policy.*does not.*prefetch or revalidate/isu);
	assert.match(documentation, /explicit desktop handoff.*manifest reachability.*fallback.*no timeline or Project Bin clip.*Soundscaper.*org\.example\.future-mixer.*feature-requirement report.*current writable project lock.*unchanged.*without flushing.*declared read-only.*future-schema.*lock-contended.*reject.*fresh Framescaper.*canonical original and fallback PCM.*exact managed.*bodies.*canonical project shadow.*transfer.*managed descriptor and body digest.*controller.*manifest fallback digest.*before.*read-only activation.*engine.*synthetic whole-mix.*exact fallback samples.*document snapshot.*canonical project/isu);
	assert.match(documentation, /audio-delivery projection.*only.*audio rendered fallback.*does not compose.*video rendered fallback.*bypass.*simultaneous rendered fallback.*reject/isu);
	assert.match(documentation, /final-mix.*only.*stems.*BW64.*ADM.*reject.*before.*verification.*planning.*destination.*render/isu);
	assert.match(documentation, /operation-time.*selector.*requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*full canonical.*chunk scan.*private.*chunk provider.*sole.*render source.*global.*cache.*unchanged/isu);
	assert.match(documentation, /provider.*read.*rereads.*stored chunk.*geometry.*digest.*currentness.*chang.*integrity.*offline.*does not retry.*realtime/isu);
	assert.match(normalizedDocumentation, /Corrupt same-shaped recipient-local PCM after activation.*rejects delivery before rendering or output.*exact repair restores the exact PCM.*final-mix.*canonical project.*shadow.*unchanged/isu);
	assert.match(normalizedDocumentation, /`org\.example\.future-mixer`.*unknown-feature composed Soundscaper-to-fresh-Framescaper.*manifest.*metadata.*localized.*UI.*exact feature ID.*requirement ID/isu);
	assert.match(normalizedDocumentation, /operation-time.*selector.*exact requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*tamper.*refus.*repair.*canonical project.*shadow.*unchanged/isu);
	assert.match(documentation, /exact point-in-time provider.*immutable.*Blob.*not durable leases.*role-defined.*audio whole-mix.*first-party video-effects whole-project.*clip-target.*narrow editor-playback\s+and delivery.*other generic rendered-fallback\s+roles/isu);
	assert.match(normalizedDocumentation, /more than one.*feature identities.*non-audio roles.*future schemas.*earlier Soundscaper schemas.*linked-only.*unmanaged.*authoring.*freeze.*proxy.*publisher authenticity.*third-party code activation.*packaged.*UI.*browser.*reference-scale/isu);
});

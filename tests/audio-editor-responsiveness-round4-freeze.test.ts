/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { installAudioTrackFreezeCandidateV21, removeAudioTrackFreezeCandidateV21, commitAudioTrackFreezeCandidateV21 } from '../src/common/editor/audio-track-freeze-lifecycle-v21.ts';
import { descriptorReadCounter, freezeWorkFixture, selectedFreezeRecordCounter } from './helpers/responsiveness-round4-fixtures.ts';

void test('freeze install shares exact clip/source proofs instead of inspecting each whole collection per input', context => {
	const fixture = freezeWorkFixture();
	const { project, freeze, derivedSource, sourceContentIdentities } = fixture;
	const work = descriptorReadCounter([...project.clips, ...project.sources], 'id');
	let after: Readonly<Record<string, unknown>>;
	try { after = installAudioTrackFreezeCandidateV21(project, { trackId: 'target', expectedFreeze: null, replacementFreeze: freeze,
		derivedSource, sourceContentIdentities }); }
	finally { work.restore(); }
	context.diagnostic(`120 inputs / 120 sources: ${String(work.reads())} original record ID descriptor reads`);
	assert.ok(work.reads() <= 600, String(work.reads()));
	assert.equal((after!.sources as unknown[]).length, 121);
	assert.equal(Object.hasOwn(project.tracks[0]!, 'audioFreeze'), false);
	assert.ok(Object.isFrozen(after!));
});

for (const operation of ['install', 'remove', 'commit'] as const) void test(`freeze ${operation} snapshots its target track collection once`, context => {
	const { project, freeze, digests, derivedSource, sourceContentIdentities, derivedClip } = freezeWorkFixture(120, true);
	const work = descriptorReadCounter([project.tracks], '0');
	try {
		if (operation === 'install') installAudioTrackFreezeCandidateV21(project, { trackId: 'target', expectedFreeze: freeze,
			replacementFreeze: freeze, derivedSource, sourceContentIdentities });
		else if (operation === 'remove') removeAudioTrackFreezeCandidateV21(project, { trackId: 'target', expectedFreeze: freeze });
		else commitAudioTrackFreezeCandidateV21(project, { trackId: 'target', expectedFreeze: freeze, operationDigests: digests,
			derivedSourceContentSha256: 'a'.repeat(64), derivedClip });
	} finally { work.restore(); }
	context.diagnostic(`${operation}: ${String(work.reads())} original track-collection snapshots`);
	assert.equal(work.reads(), 1);
});

void test('freeze commit reuses the proven editable clip records and IDs when removing originals', context => {
	const { project, freeze, digests, derivedClip } = freezeWorkFixture(120, true);
	const work = descriptorReadCounter(project.clips, 'id');
	let after: Readonly<Record<string, unknown>>;
	try { after = commitAudioTrackFreezeCandidateV21(project, { trackId: 'target', expectedFreeze: freeze, operationDigests: digests,
		derivedSourceContentSha256: 'a'.repeat(64), derivedClip }); }
	finally { work.restore(); }
	context.diagnostic(`120-clip commit: ${String(work.reads())} original clip record ID inspections`);
	assert.ok(work.reads() <= 240, String(work.reads()));
	assert.equal((after!.clips as unknown[]).length, 1);
	assert.equal((after!.sources as unknown[]).length, 1);
	assert.equal(project.clips.length, 120);
});

void test('freeze refresh reuses the exact source snapshot and expected current freeze admission', context => {
	const { project, freeze, derivedSource, sourceContentIdentities } = freezeWorkFixture(120, true);
	const sources = descriptorReadCounter([project.sources], '0');
	const current = descriptorReadCounter([project.tracks[0]!.audioFreeze as object], 'derivedSourceId');
	try { installAudioTrackFreezeCandidateV21(project, { trackId: 'target', expectedFreeze: freeze, replacementFreeze: freeze,
		derivedSource, sourceContentIdentities }); }
	finally { current.restore(); sources.restore(); }
	context.diagnostic(`refresh: ${String(sources.reads())} source snapshots; ${String(current.reads())} current freeze field inspections`);
	assert.equal(sources.reads(), 1);
	assert.equal(current.reads(), 2);
});

for (const kind of ['clip', 'source'] as const) void test(`freeze install reuses the searched ${kind} record without a selected-only admission copy`, context => {
	const { project, freeze, derivedSource, sourceContentIdentities } = freezeWorkFixture();
	const work = selectedFreezeRecordCounter(`${kind}-`, kind === 'clip' ? 'sourceId' : 'contentSha256');
	try { installAudioTrackFreezeCandidateV21(project, { trackId: 'target', expectedFreeze: null, replacementFreeze: freeze, derivedSource, sourceContentIdentities }); }
	finally { work.restore(); }
	context.diagnostic(`${kind}: ${String(work.reads())} selected-only record admissions`);
	assert.equal(work.reads(), 0);
});

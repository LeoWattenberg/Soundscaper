import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admBedChannelCount,
	admBedChannelOrder,
	evaluateAdmPassthroughEligibility,
	normalizeAdmProjectMetadata,
	validateAdmAuthoredRouting,
	validateAdmProjectMetadata,
} from '../src/common/editor/adm-project-metadata.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	migrateAudioEditorProject,
	migrateAudioEditorProjectV6ToV7,
} from '../src/common/editor/migration.js';
import { validateAudioEditorProject } from '../src/common/editor/project.js';
import { createAudioEditorProjectV6 } from '../src/common/editor/project-v6.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	createAudioEditorProjectV7,
	loadAudioEditorProjectV7,
	validateAudioEditorProjectV7,
} from '../src/common/editor/project-v7.ts';

const NOW = '2026-07-28T12:34:56.000Z';

function authoredAdm() {
	return {
		mode: 'authored' as const,
		programme: { name: 'Main programme', language: 'eng' },
		content: { name: 'Main content', language: 'eng' },
		bed: {
			name: '5.1 bed',
			layout: '5.1' as const,
			assignments: [
				{ stripKind: 'track' as const, stripId: 'dialogue', sourceChannel: 0, bedChannel: 'C' as const },
				{ stripKind: 'group' as const, stripId: 'music', sourceChannel: 0, bedChannel: 'L' as const, gain: 0.8 },
			],
		},
	};
}

function passthroughAdm(overrides: Record<string, unknown> = {}) {
	return {
		mode: 'passthrough' as const,
		payload: {
			kind: 'axml' as const,
			xml: '<ebuCoreMain />',
			rawBase64: Buffer.from('<ebuCoreMain />').toString('base64'),
		},
		chna: {
			entries: [{
				trackIndex: 1,
				audioTrackUid: 'ATU_00000001',
				audioTrackFormatIdRef: 'AT_00010001_01',
				audioPackFormatIdRef: 'AP_00010001',
			}],
			rawBase64: 'AQABAA==',
		},
		source: { id: 'source-adm', storageKey: 'pcm/source-adm', mimeType: 'audio/wav' },
		geometry: { sampleRate: 48_000, channelCount: 2, frameCount: 96_000, bitDepth: 24, float: false },
		pristineRevision: 0,
		valid: true,
		warnings: [],
		...overrides,
	};
}

test('authored ADM normalizes one programme, content, DirectSpeakers bed, and terminal assignments', () => {
	assert.deepEqual(admBedChannelOrder('mono'), ['M']);
	assert.deepEqual(admBedChannelOrder('stereo'), ['L', 'R']);
	assert.deepEqual(admBedChannelOrder('5.1'), ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']);
	assert.equal(admBedChannelCount('5.1'), 6);

	const normalized = normalizeAdmProjectMetadata(authoredAdm());
	assert.deepEqual(normalized, {
		...authoredAdm(),
		bed: {
			...authoredAdm().bed,
			assignments: [
				{ ...authoredAdm().bed.assignments[0], gain: 1 },
				authoredAdm().bed.assignments[1],
			],
		},
	});
	assert.equal(validateAdmProjectMetadata({ adm: normalized }), true);
	assert.throws(() => normalizeAdmProjectMetadata({
		...authoredAdm(),
		bed: { ...authoredAdm().bed, layout: 'stereo', assignments: authoredAdm().bed.assignments },
	}), /bed channel C.*stereo/i);
	assert.throws(() => normalizeAdmProjectMetadata({
		...authoredAdm(),
		bed: { ...authoredAdm().bed, assignments: [authoredAdm().bed.assignments[0], authoredAdm().bed.assignments[0]] },
	}), /duplicate ADM assignment/i);
	assert.throws(() => normalizeAdmProjectMetadata({
		...authoredAdm(),
		programme: { ...authoredAdm().programme, language: 'en-GB' },
	}), /ISO 639|language/iu);
});

test('authored ADM routing reports missing, non-terminal, and out-of-range assignments without rejecting drafts', () => {
	const project = createAudioEditorProjectV7({
		now: NOW,
		masterChannels: 2,
		tracks: [
			{ type: 'audio', id: 'dry', name: 'Dry', clipIds: [] },
			{ type: 'audio', id: 'dialogue', name: 'Dialogue', clipIds: [] },
		],
		mixer: {
			groups: [{ id: 'music', name: 'Music' }],
			sends: [{ id: 'reverb', name: 'Reverb' }],
			routes: { dialogue: { groupId: 'music', sends: { reverb: 1 } } },
		},
		metadata: { adm: authoredAdm() },
	});
	const issues = validateAdmAuthoredRouting(project.metadata.adm, project);
	assert.ok(issues.some((issue) => issue.code === 'non-terminal-strip' && issue.stripId === 'dialogue'));
	assert.ok(issues.some((issue) => issue.code === 'missing-terminal-strip' && issue.stripId === 'dry'));
	assert.ok(issues.some((issue) => issue.code === 'missing-terminal-strip' && issue.stripId === 'reverb'));
	assert.ok(issues.some((issue) => issue.code === 'missing-bed-channel' && issue.bedChannel === 'R'));

	const outOfRange = normalizeAdmProjectMetadata({
		...authoredAdm(),
		bed: {
			...authoredAdm().bed,
			assignments: [{ stripKind: 'track', stripId: 'dry', sourceChannel: 6, bedChannel: 'L' }],
		},
	});
	assert.ok(validateAdmAuthoredRouting(outOfRange, project).some((issue) => issue.code === 'source-channel-out-of-range'));
});

test('authored ADM routing validates terminal bus channels against routed source width', () => {
	const project = createAudioEditorProjectV7({
		now: NOW,
		masterChannels: 6,
		sources: [{ id: 'source', storageKey: 'pcm/source', frameCount: 4, channelCount: 2 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4 }],
		tracks: [{ type: 'audio', id: 'dialogue', name: 'Dialogue', clipIds: ['clip'] }],
		mixer: {
			groups: [{ id: 'music', name: 'Music' }],
			routes: { dialogue: { groupId: 'music' } },
		},
	});
	const metadata = normalizeAdmProjectMetadata({
		...authoredAdm(),
		bed: {
			...authoredAdm().bed,
			assignments: [{ stripKind: 'group', stripId: 'music', sourceChannel: 2, bedChannel: 'L' }],
		},
	});

	assert.ok(validateAdmAuthoredRouting(metadata, project).some((issue) => (
		issue.code === 'source-channel-out-of-range' && issue.stripId === 'music'
	)));
});

test('passthrough ADM stays JSON-safe and eligibility requires pristine source geometry and project revision', () => {
	const metadata = normalizeAdmProjectMetadata(passthroughAdm());
	assert.deepEqual(JSON.parse(JSON.stringify(metadata)), metadata);
	assert.equal(validateAdmProjectMetadata({ adm: metadata }), true);
	const exact = {
		projectRevision: 0,
		sourceId: 'source-adm',
		sampleRate: 48_000,
		channelCount: 2,
		frameCount: 96_000,
		bitDepth: 24 as const,
		float: false,
		startFrame: 0,
		endFrame: 96_000,
	};
	assert.deepEqual(evaluateAdmPassthroughEligibility(metadata, exact), { eligible: true, reason: null });
	assert.deepEqual(evaluateAdmPassthroughEligibility(metadata, { ...exact, projectRevision: 1 }), {
		eligible: false, reason: 'project-revision-changed',
	});
	assert.deepEqual(evaluateAdmPassthroughEligibility(metadata, { ...exact, sourceId: 'replacement' }), {
		eligible: false, reason: 'source-changed',
	});
	assert.deepEqual(evaluateAdmPassthroughEligibility(metadata, { ...exact, startFrame: 48_000 }), {
		eligible: false, reason: 'range-changed',
	});
	const twentyBit = normalizeAdmProjectMetadata(passthroughAdm({
		geometry: { ...passthroughAdm().geometry, bitDepth: 20 },
	}));
	assert.deepEqual(evaluateAdmPassthroughEligibility(twentyBit, { ...exact, bitDepth: 20 }), {
		eligible: true, reason: null,
	});
	const invalid = normalizeAdmProjectMetadata(passthroughAdm({ valid: false, warnings: ['Broken CHNA reference'] }));
	assert.deepEqual(evaluateAdmPassthroughEligibility(invalid, exact), {
		eligible: false, reason: 'invalid-adm',
	});
	assert.throws(() => normalizeAdmProjectMetadata(passthroughAdm({
		payload: { kind: 'bxml', base64: new Uint8Array([1, 2, 3]) },
	})), /base64.*string/i);
	assert.throws(() => normalizeAdmProjectMetadata(passthroughAdm({
		payload: {
			kind: 'axml',
			xml: '<ebuCoreMain />',
			rawBase64: Buffer.from('<different />').toString('base64'),
		},
	})), /raw.*AXML|AXML.*raw/iu);
	assert.throws(() => normalizeAdmProjectMetadata(passthroughAdm({
		payload: { kind: 'axml', xml: '<ebuCoreMain />' },
	})), /raw.*AXML|AXML.*raw/iu);
	const directReferences = normalizeAdmProjectMetadata(passthroughAdm({
		payload: { kind: 'sxml', base64: 'AQIDBA==' },
		chna: {
			rawBase64: 'AQABAA==',
			entries: [
				passthroughAdm().chna.entries[0],
				{
					...passthroughAdm().chna.entries[0],
					audioTrackUid: 'ATU_00000002',
					audioTrackFormatIdRef: 'AC_00010001_00',
				},
			],
		},
	}));
	assert.equal(directReferences.mode, 'passthrough');
	assert.equal(directReferences.payload.kind, 'sxml');
	assert.equal(directReferences.chna.entries[1]?.trackIndex, 1);
	assert.equal(directReferences.chna.entries[1]?.audioTrackFormatIdRef, 'AC_00010001');
	const dualPayload = normalizeAdmProjectMetadata(passthroughAdm({
		serialPayload: { kind: 'sxml', base64: 'AQIDBA==' },
	}));
	assert.equal(dualPayload.mode === 'passthrough' ? dualPayload.serialPayload?.kind : null, 'sxml');
	const noPackReference = normalizeAdmProjectMetadata(passthroughAdm({
		chna: {
			...passthroughAdm().chna,
			entries: passthroughAdm().chna.entries.map((entry) => ({
				...entry, audioPackFormatIdRef: '',
			})),
		},
	}));
	assert.equal(noPackReference.mode === 'passthrough'
		? noPackReference.chna.entries[0]?.audioPackFormatIdRef
		: null, '');
	const rawList = riffChunk('LIST', Uint8Array.of(0x49, 0x4e, 0x46, 0x4f, 1));
	const sequenced = normalizeAdmProjectMetadata(passthroughAdm({
		riffChunkSequence: [{
			id: 'LIST', placement: 'after-data', rawBase64: Buffer.from(rawList).toString('base64'),
		}],
	}));
	assert.deepEqual(sequenced.mode === 'passthrough' ? sequenced.riffChunkSequence : null, [{
		id: 'LIST', placement: 'after-data', rawBase64: Buffer.from(rawList).toString('base64'),
	}]);
	const rawFact = riffChunk('fact', Uint8Array.of(1, 0, 0, 0));
	assert.throws(() => normalizeAdmProjectMetadata(passthroughAdm({
		riffChunkSequence: [{
			id: 'fact', placement: 'before-data', rawBase64: Buffer.from(rawFact).toString('base64'),
		}],
	})), /fact.*forbidden|forbidden.*fact|structural.*fact/iu);
});

test('V7 projects require canonical nullable ADM and metadata commands normalize and clear it', () => {
	const empty = createAudioEditorProjectV7({ now: NOW });
	assert.equal(empty.schemaVersion, 7);
	assert.equal(empty.metadata.adm, null);
	assert.equal(validateAudioEditorProjectV7(empty), true);
	assert.equal(validateAudioEditorProject(empty as never), true);

	const project = createAudioEditorProjectV7({ now: NOW, metadata: { adm: authoredAdm() } });
	assert.equal(project.metadata.adm?.mode, 'authored');
	assert.equal(validateAudioEditorProjectV7(project), true);
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete (missing.metadata as Record<string, unknown>).adm;
	assert.throws(() => validateAudioEditorProjectV7(missing), /metadata\.adm/u);

	const updated = applyEditorCommand(empty, {
		type: 'metadata/update', changes: { adm: authoredAdm() },
	}, { now: NOW });
	assert.equal(updated.metadata.adm?.mode, 'authored');
	assert.equal(updated.metadata.adm?.bed.assignments[0]?.gain, 1);
	const multichannelPassthrough = applyEditorCommand(empty, {
		type: 'metadata/update',
		changes: { adm: passthroughAdm({
			geometry: { ...passthroughAdm().geometry, channelCount: 6 },
		}) },
	}, { now: NOW });
	assert.equal(multichannelPassthrough.masterChannels, 6);
	const cleared = applyEditorCommand(updated, {
		type: 'metadata/update', changes: { adm: null },
	}, { now: NOW });
	assert.equal(cleared.metadata.adm, null);
	assert.throws(() => applyEditorCommand(createAudioEditorProjectV6({ now: NOW }), {
		type: 'metadata/update', changes: { adm: authoredAdm() },
	}, { now: NOW }), /cannot be updated/u);
});

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	chunk.set(new TextEncoder().encode(id));
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
}

test('V6 migration adds null ADM, preserves stereo routing, and leaves the input untouched', () => {
	const v6 = createAudioEditorProjectV6({
		id: 'legacy-v6',
		now: NOW,
		masterChannels: 2,
		tracks: [{ type: 'audio', id: 'track', name: 'Track', clipIds: [] }],
		mixer: { routes: { track: { groupId: null, sends: {} } } },
		metadata: { bext: { description: 'Legacy BEXT' } },
	});
	const original = structuredClone(v6);
	const migrated = migrateAudioEditorProjectV6ToV7(v6);
	assert.deepEqual(v6, original);
	assert.equal(migrated.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(migrated.metadata.adm, null);
	assert.equal(migrated.masterChannels, 2);
	assert.deepEqual(migrated.mixer, v6.mixer);
	assert.deepEqual(migrateAudioEditorProject(v6), {
		project: migrated, migrated: true, fromVersion: 6, readOnly: false, reason: null,
	});
});

test('V7 loading clones current projects and preserves future projects read-only', () => {
	const current = createAudioEditorProjectV7({ now: NOW, metadata: { adm: passthroughAdm() } });
	assert.deepEqual(loadAudioEditorProjectV7(current), {
		project: current, readOnly: false, reason: null,
	});
	assert.notStrictEqual(loadAudioEditorProjectV7(current).project, current);
	assert.deepEqual(migrateAudioEditorProject(current), {
		project: current, migrated: false, fromVersion: 7, readOnly: false, reason: null,
	});
	const future = { ...current, schemaVersion: 8, futureData: { retained: true } };
	assert.deepEqual(loadAudioEditorProjectV7(future), {
		project: future, readOnly: true, reason: 'newer-schema',
	});
	assert.deepEqual(migrateAudioEditorProject(future), {
		project: future, migrated: false, fromVersion: 8, readOnly: true, reason: 'newer-schema',
	});
});

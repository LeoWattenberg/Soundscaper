/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_V18,
	FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
} from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	applyFramescaperProjectCommandV18,
} from '../src/framescaper/editor-project-v18-commands.ts';
import {
	createFramescaperProjectHistoryV18,
	executeFramescaperProjectCommandV18,
	redoFramescaperProjectCommandV18,
	undoFramescaperProjectCommandV18,
} from '../src/framescaper/editor-project-v18-history.ts';
import {
	cloneFramescaperProjectV18,
	createFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';
import {
	createFramescaperProjectSessionV18,
} from '../src/framescaper/editor-project-v18-session.ts';
import type { FramescaperSequenceV18 } from '../src/framescaper/editor-project-v18-sequence.ts';

const CREATED = '2026-08-13T10:00:00.000Z';
const EDITED = '2026-08-13T10:01:00.000Z';
const UNDONE = '2026-08-13T10:02:00.000Z';
const REDONE = '2026-08-13T10:03:00.000Z';

test('V18 commands execute through the V17 projection and restore exact all-null authority', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'v18-command', title: 'Before', now: CREATED,
	});
	const edited = applyFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		project,
		{ type: 'project/rename', title: 'After' },
		{ now: EDITED },
	);
	assert.equal(edited.schemaVersion, 18);
	assert.equal(edited.title, 'After');
	assert.equal(edited.revision, Number(project.revision) + 1);
});

test('generic V18 commands cannot introduce, remove, or change proxy attachment authority', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'v18-command-authority', title: 'Authority', now: CREATED,
	});
	const hostileSource = {
		id: 'new-video', kind: 'video', name: 'Video', storageKey: 'new-video',
		mimeType: 'video/mp4', frameCount: 48_000, sampleFrameCount: 48_000,
		sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 100, height: 100,
		proxyAttachment: { forged: true },
	};
	const added = applyFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		project,
		{ type: 'source/add', source: hostileSource },
		{ now: EDITED },
	);
	const addedSource = added.sources.find(({ id }) => id === 'new-video');
	assert.equal(addedSource?.kind, 'video');
	assert.equal(addedSource?.proxyAttachment, null);

	const attachedSource = createVideoSourceV10({
		...hostileSource, contentSha256: '12'.repeat(32),
	});
	delete attachedSource.proxyAttachment;
	const attached = structuredClone(createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'v18-attached', title: 'Attached', now: CREATED,
		sources: [attachedSource],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'new-video', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({ id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true })],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	})) as unknown as Record<string, unknown>;
	(attached.sources as Record<string, unknown>[])[0]!.proxyAttachment = attachment();
	const requirements = (attached.featureRequirements as { requirements: readonly unknown[] }).requirements;
	attached.featureRequirements = {
		schemaVersion: 2,
		requirements: [...requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	assert.throws(() => applyFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		attached,
		{ type: 'project/rename', title: 'Forbidden' },
	), /intrinsically read-only|proxy attachment/iu);
});

test('V18 history validates every snapshot and retains undo/redo attachment authority', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'v18-history', title: 'Before', now: CREATED,
	});
	let history = createFramescaperProjectHistoryV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		project,
		{ limit: 2 },
	);
	history = executeFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		history,
		{ type: 'project/rename', title: 'After' },
		{ now: EDITED },
	);
	assert.equal(history.present.title, 'After');
	assert.equal(history.undoStack.length, 1);
	history = undoFramescaperProjectCommandV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, history, { now: UNDONE });
	assert.equal(history.present.title, 'Before');
	assert.equal(history.present.updatedAt, UNDONE);
	history = redoFramescaperProjectCommandV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, history, { now: REDONE });
	assert.equal(history.present.title, 'After');
	assert.equal(history.present.updatedAt, REDONE);

	const malformed = structuredClone(history) as unknown as typeof history;
	(malformed.undoStack[0]!.project as unknown as Record<string, unknown>).schemaVersion = 17;
	assert.throws(() => undoFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		malformed,
	), /schema version/iu);
});

test('the isolated V18 session installs validated history atomically against a private token', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'v18-session', title: 'Before', now: CREATED,
	});
	const session = createFramescaperProjectSessionV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, project);
	const capture = session.capture();
	const next = executeFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		capture.history,
		{ type: 'project/rename', title: 'Installed' },
		{ now: EDITED },
	);
	assert.equal(session.install(capture.token, next).title, 'Installed');
	assert.equal(session.snapshot().present.title, 'Installed');
	assert.throws(() => session.install(capture.token, next), /history changed/iu);

	const current = session.capture();
	const invalid = structuredClone(current.history) as unknown as typeof current.history;
	(invalid.present as unknown as Record<string, unknown>).schemaVersion = 17;
	assert.throws(() => session.install(current.token, invalid), /schema version/iu);
	assert.equal(session.snapshot().present.title, 'Installed');
});

test('nested-sequence commands preserve aliases through history, cloning, and Scape documents', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'nested-command', title: 'Nested command', now: CREATED,
		sequences: [
			{ id: 'root', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'shared', rate: { num: 24, den: 1 }, trackIds: [] },
		],
		primarySequenceId: 'root',
	});
	const added = applyFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		project,
		{
			type: 'subsequence/add',
			subsequence: {
				id: 'shared-a', sequenceId: 'root', sourceSequenceId: 'shared',
				sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 24,
			},
		},
		{ now: EDITED },
	);
	assert.equal(added.revision, Number(project.revision) + 1);
	assert.equal(added.subsequences[0]?.sourceSequenceId, 'shared');

	let history = createFramescaperProjectHistoryV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		added,
	);
	history = executeFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		history,
		{ type: 'subsequence/update', subsequenceId: 'shared-a', changes: { sequenceStartFrame: 90 } },
		{ now: UNDONE },
	);
	assert.equal(history.present.subsequences[0]?.sequenceStartFrame, 90);
	assert.equal(history.undoStack[0]?.command.type, 'subsequence/update');
	const undone = undoFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		history,
		{ now: REDONE },
	);
	assert.equal(undone.present.subsequences[0]?.sequenceStartFrame, 0);
	const redone = redoFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		undone,
		{ now: '2026-08-13T10:04:00.000Z' },
	);
	assert.equal(redone.present.subsequences[0]?.sequenceStartFrame, 90);

	const clone = cloneFramescaperProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		redone.present,
	);
	assert.deepEqual(clone.subsequences, redone.present.subsequences);
	assert.notStrictEqual(clone.subsequences, redone.present.subsequences);
	const parsed = parseScapeProjectDocument(serializeScapeProjectDocument(clone));
	assert.deepEqual(cloneFramescaperProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		parsed,
	), clone);
});

test('V18 sequence commands create an empty secondary owner before nesting and delete it after removal', () => {
	const profile = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
	const initial = createFramescaperProjectV18(profile, {
		id: 'sequence-authoring', title: 'Sequence authoring', now: CREATED,
	});
	const primary = initial.sequences[0]!;
	const shared = emptySequence('shared', 'Shared sequence', primary);
	const created = applyFramescaperProjectCommandV18(profile, initial, {
		type: 'sequence/create', sequence: shared,
	}, { now: EDITED });
	assert.deepEqual(created.sequences, [primary, shared]);
	assert.equal(created.revision, initial.revision + 1);
	assert.equal(created.featureRequirements.requirements.some(
		({ id }) => id === FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_V18.id,
	), false);

	const placed = applyFramescaperProjectCommandV18(profile, created, {
		type: 'subsequence/add', subsequence: {
			id: 'shared-placement', sequenceId: String(primary.id), sourceSequenceId: 'shared',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
		},
	});
	assert.equal(placed.featureRequirements.requirements.some(
		({ id }) => id === FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_V18.id,
	), true);
	assert.throws(() => applyFramescaperProjectCommandV18(profile, placed, {
		type: 'sequence/delete', sequenceId: 'shared',
	}), /sequence.*referenced|nested.*placement/iu);

	const unplaced = applyFramescaperProjectCommandV18(profile, placed, {
		type: 'subsequence/remove', subsequenceId: 'shared-placement',
	});
	const deleted = applyFramescaperProjectCommandV18(profile, unplaced, {
		type: 'sequence/delete', sequenceId: 'shared',
	}, { now: REDONE });
	assert.deepEqual(deleted.sequences, [primary]);
	assert.deepEqual(deleted.subsequences, []);
	assert.equal(deleted.featureRequirements.requirements.some(
		({ id }) => id === FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_V18.id,
	), false);
});

test('V18 sequence authoring is strict, history-owned, and refuses unsafe deletion', () => {
	const profile = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
	const initial = createFramescaperProjectV18(profile, {
		id: 'sequence-fences', title: 'Sequence fences', now: CREATED,
	});
	const primary = initial.sequences[0]!;
	const sequence = emptySequence('shared', 'Shared sequence', primary);
	assert.throws(() => applyFramescaperProjectCommandV18(profile, initial, {
		type: 'sequence/delete', sequenceId: String(initial.primarySequenceId),
	}), /primary sequence/iu);
	assert.throws(() => applyFramescaperProjectCommandV18(profile, initial, {
		type: 'sequence/create', sequence: { ...sequence, surprise: true },
	} as never), /unsupported field|exact/iu);
	assert.throws(() => applyFramescaperProjectCommandV18(profile, initial, {
		type: 'sequence/create', sequence: { ...sequence, trackIds: ['occupied'] },
	} as never), /empty|track/iu);

	let history = createFramescaperProjectHistoryV18(profile, initial);
	history = executeFramescaperProjectCommandV18(profile, history, {
		type: 'sequence/create', sequence,
	}, { now: EDITED });
	assert.equal(history.present.sequences.length, 2);
	assert.equal(history.undoStack[0]?.command.type, 'sequence/create');
	const undone = undoFramescaperProjectCommandV18(profile, history, { now: UNDONE });
	assert.equal(undone.present.sequences.length, 1);
	const redone = redoFramescaperProjectCommandV18(profile, undone, { now: REDONE });
	assert.equal(redone.present.sequences.length, 2);
	assert.equal(redone.present.sequences[1]?.id, 'shared');
	assert.throws(() => applyFramescaperProjectCommandV18(profile, redone.present, {
		type: 'sequence/create', sequence,
	}), /duplicate.*sequence|already exists/iu);
});

function emptySequence(
	id: string,
	name: string,
	primary: Readonly<Record<string, unknown>>,
): FramescaperSequenceV18 {
	return {
		id, name,
		rate: structuredClone(primary.rate),
		dropFrame: primary.dropFrame,
		startTimecode: structuredClone(primary.startTimecode),
		trackIds: [],
		trackNodes: [],
	};
}

function attachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${'34'.repeat(32)}`, mimeType: 'video/mp4', byteLength: 1,
		sha256: '34'.repeat(32), originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${'56'.repeat(32)}`,
			sha256: '56'.repeat(32), sourceSha256: '34'.repeat(32), byteLength: 112,
			frameCount: 10, timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

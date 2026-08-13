/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

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
	createFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';
import {
	createFramescaperProjectSessionV18,
} from '../src/framescaper/editor-project-v18-session.ts';

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
	assert.equal(edited.revision, project.revision + 1);
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

	const attached = structuredClone(project) as Record<string, unknown>;
	(attached.sources as Record<string, unknown>[]).push({ ...hostileSource, proxyAttachment: attachment() });
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

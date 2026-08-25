/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model-v30.ts';
import {
	createFramescaperTimelineImageCurrentProjectPublicationV30,
} from '../src/framescaper/editor-timeline-image-current-project-publication-v30.ts';
import {
	executeFramescaperProjectCommandV30,
	createFramescaperProjectHistoryV30,
	type FramescaperProjectHistoryV30,
} from '../src/framescaper/editor-project-v30-history.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;
const DIGEST_A = '51'.repeat(32);
const DIGEST_B = '52'.repeat(32);
const DIGEST_C = '53'.repeat(32);

test('published image CAS is installed as one saved undoable active history revision', async () => {
	const base = createFramescaperProjectV30(PROFILE, framescaperV20Options());
	let active = base;
	let history = createFramescaperProjectHistoryV30(PROFILE, base);
	let token = Object.freeze({ generation: 1 });
	let publishedBytes: Uint8Array | null = null;
	let opened = 0;
	const signal = new AbortController().signal;
	const port = createFramescaperTimelineImageCurrentProjectPublicationV30({
		controller: {
			get project() { return active; },
			actions: { project: { openById: () => { active = history.present; opened += 1; } } },
		},
		session: session(),
		executeCommand: (value, command, options) => (
			executeFramescaperProjectCommandV30(PROFILE, value, command, options)
		),
		publishIfCurrent: async (request) => {
			assert.equal(request.expected, base);
			assert.equal(request.signal, signal);
			publishedBytes = request.bytes;
			return request.project;
		},
		now: () => '2026-08-25T15:00:00.000Z',
	});
	const source = sourceFixture();
	const clip = clipFixture(String(base.primarySequenceId));
	const command = imageCommand(source, clip);
	const body = new Blob([Uint8Array.of(1, 2, 3, 4)], { type: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE });
	const result = await port.publish({ project: base, source, clip, body, command, signal });

	assert.equal(result, history.present);
	assert.equal(active, result);
	assert.equal(result.updatedAt, '2026-08-25T15:00:00.000Z');
	assert.equal(history.undoStack.length, 1);
	assert.deepEqual(publishedBytes, Uint8Array.of(1, 2, 3, 4));
	assert.equal(opened, 1);

	function session() {
		return {
			captureProjectHistory: () => ({ history, token }),
			assertProjectHistoryToken: (_projectId: string, expected: unknown) => {
				if (expected !== token) throw new Error('stale history token');
			},
			updateProjectHistory: (_projectId: string, value: FramescaperProjectHistoryV30) => {
				history = value; token = Object.freeze({ generation: 2 });
			},
			markProjectSaved: () => undefined,
			getProjectHistory: () => history,
		};
	}
});

test('stale active state is rejected before staging an image body', async () => {
	const base = createFramescaperProjectV30(PROFILE, framescaperV20Options());
	const other = { ...base, revision: Number(base.revision) + 1 } as typeof base;
	let staged = 0;
	const port = createFramescaperTimelineImageCurrentProjectPublicationV30({
		controller: {
			project: other,
			actions: { project: { openById: () => undefined } },
		},
		session: {
			captureProjectHistory: () => ({
				history: createFramescaperProjectHistoryV30(PROFILE, base), token: null,
			}),
			assertProjectHistoryToken: () => undefined,
			updateProjectHistory: () => undefined,
			markProjectSaved: () => undefined,
			getProjectHistory: () => createFramescaperProjectHistoryV30(PROFILE, base),
		},
		executeCommand: (history) => history,
		publishIfCurrent: async () => { staged += 1; return null; },
	});
	const source = sourceFixture();
	const clip = clipFixture(String(base.primarySequenceId));
	await assert.rejects(port.publish({
		project: base, source, clip,
		body: new Blob([Uint8Array.of(1)]),
		command: imageCommand(source, clip),
	}), (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(staged, 0);
});

function sourceFixture() {
	return {
		schemaVersion: 1 as const, kind: 'image' as const,
		id: 'image-source-current', name: 'Current image',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image-source-current', contentSha256: DIGEST_A,
		assetByteLength: 4_096, original: {
			fileName: 'current.png', mimeType: 'image/png', recognizedFormat: 'png' as const,
			byteLength: 4, sha256: DIGEST_B,
		}, canonical: {
			width: 1, height: 1, hasAlpha: true, frameCount: 1,
			durationTicks: '5000000', timingMode: 'fallback' as const,
		}, conversionReceiptSha256: DIGEST_C,
	};
}

function clipFixture(sequenceId: string) {
	return {
		schemaVersion: 1 as const, kind: 'image' as const,
		id: 'image-clip-current', sourceId: 'image-source-current', sequenceId,
		sequenceStartFrame: 0, sequenceFrameCount: 50, sourceStartTicks: '0',
	};
}

function imageCommand(
	source: ReturnType<typeof sourceFixture>,
	clip: ReturnType<typeof clipFixture>,
) {
	return {
		type: 'batch' as const,
		commands: [{
			type: 'image-source/set' as const,
			sourceId: source.id, expectedSource: null, source,
		}, {
			type: 'image-clip/set' as const,
			clipId: clip.id, expectedClip: null, expectedPlacement: null, clip,
			placement: { scope: 'project-bin' as const },
		}],
	};
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import { VIDEO_TIMING_ASSET_MIME_TYPE } from '../src/common/editor/video-timing-asset.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { resolveFramescaperVideoProxyPreviewV18 } from '../src/framescaper/editor-video-proxy-preview-v18.ts';
import {
	ARCHIVE_ORIGINAL_BYTES,
	ARCHIVE_ORIGINAL_SHA,
	ARCHIVE_PROJECT_ID,
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_PROXY_SHA,
	ARCHIVE_SOURCE_ID,
	ARCHIVE_TIMING,
	archiveProject,
} from './helpers/framescaper-v18-archive-fixture.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const PROXY_KEY = `video-proxy-sha256:${ARCHIVE_PROXY_SHA}`;

interface HarnessOptions {
	readonly bodies?: Readonly<Record<string, Blob | null>>;
	readonly project?: unknown;
}

function harness(options: HarnessOptions = {}) {
	const project = options.project ?? archiveProject();
	const source = (project as { sources: Record<string, unknown>[] }).sources
		.find((candidate) => candidate.id === ARCHIVE_SOURCE_ID)!;
	const bodies: Record<string, Blob | null> = {
		[PROXY_KEY]: new Blob([ARCHIVE_PROXY_BYTES.slice()], { type: 'video/mp4' }),
		[ARCHIVE_TIMING.reference.storageKey]: new Blob([ARCHIVE_TIMING.bytes.slice()], {
			type: VIDEO_TIMING_ASSET_MIME_TYPE,
		}),
		...options.bodies,
	};
	const released: string[] = [];
	const task = Object.freeze({ generation: 1 });
	const timing: VideoSourceTimingView = Object.freeze({
		kind: 'cfr',
		rate: Object.freeze({ num: 10, den: 1 }),
		frameCount: Number(source.sourceFrameCount),
	});
	return {
		released,
		ports: {
			profile: PROFILE,
			getProject: () => project,
			captureTask: () => task,
			assertTaskCurrent: () => {},
			acquireBody: (request: { expected: Record<string, unknown>; role: string }) => {
				const key = String(request.expected.storageKey);
				const body = bodies[key];
				if (!body) throw new Error(`The ${request.role} body ${key} is missing.`);
				return Promise.resolve(Object.freeze({
					identity: Object.freeze({
						...request.expected,
						generationToken: `${String(request.expected.kind)}:${String(request.expected.sha256)}`,
					}),
					body,
					assertCurrent() {},
					release() {
						released.push(key);
					},
				}));
			},
			observeOriginal: () => Promise.resolve(Object.freeze({
				identity: Object.freeze({
					authority: 'owned' as const,
					projectId: ARCHIVE_PROJECT_ID,
					sourceId: ARCHIVE_SOURCE_ID,
					storageKey: String(source.storageKey ?? ARCHIVE_SOURCE_ID),
					mimeType: 'video/mp4',
					byteLength: ARCHIVE_ORIGINAL_BYTES.byteLength,
					sha256: ARCHIVE_ORIGINAL_SHA,
					generationToken: `owned:${String(source.storageKey ?? ARCHIVE_SOURCE_ID)}:${ARCHIVE_ORIGINAL_SHA}`,
				}),
				timing: bindVideoSourceTimingView(
					new Map([[ARCHIVE_SOURCE_ID, timing]]),
					source as Readonly<Record<string, unknown>>,
				),
				assertCurrent() {},
				release() {
					released.push('original');
				},
			})),
		},
	};
}

test('a preview shows the proxy once this session has re-proved it', async () => {
	const host = harness();
	const preview = await resolveFramescaperVideoProxyPreviewV18(host.ports as never, {
		sourceId: ARCHIVE_SOURCE_ID,
	});

	assert.equal(preview.kind, 'proxy');
	assert.ok(preview.kind === 'proxy');
	assert.equal(preview.body.size, ARCHIVE_PROXY_BYTES.byteLength);
	assert.equal(preview.mimeType, 'video/mp4');
	// The proxy's own timing view travels with it, because the pictures are the
	// proxy's and the boundaries have to be read from the body being shown.
	assert.ok(preview.timing);
	assert.equal(preview.audioPolicy, 'ignore-proxy-container-audio-v1');
	// Every lease taken to decide this is given back.
	assert.ok(host.released.includes('original'));
	assert.ok(host.released.includes(PROXY_KEY));
});

test('a source with no attachment answers the original without touching storage', async () => {
	const project = archiveProject();
	const source = project.sources.find((candidate) => candidate.id === ARCHIVE_SOURCE_ID)!;
	(source as Record<string, unknown>).proxyAttachment = null;
	let reads = 0;
	const preview = await resolveFramescaperVideoProxyPreviewV18({
		profile: PROFILE,
		getProject: () => project,
		captureTask: () => ({}),
		assertTaskCurrent: () => {},
		acquireBody: () => {
			reads += 1;
			throw new Error('nothing should be read');
		},
		observeOriginal: () => {
			reads += 1;
			throw new Error('nothing should be observed');
		},
	} as never, { sourceId: ARCHIVE_SOURCE_ID });

	assert.deepEqual(preview, { kind: 'original', sourceId: ARCHIVE_SOURCE_ID, reason: 'no-attachment' });
	assert.equal(reads, 0);
});

test('a proxy body that is gone falls back to the original rather than failing', async () => {
	// Retention may have collected it, or a project copy may have travelled
	// without its bodies. A proxy is an optimisation, and one that throws is
	// worse than one that declines.
	const host = harness({ bodies: { [PROXY_KEY]: null } });
	const preview = await resolveFramescaperVideoProxyPreviewV18(host.ports as never, {
		sourceId: ARCHIVE_SOURCE_ID,
	});

	assert.equal(preview.kind, 'original');
	assert.ok(preview.kind === 'original');
	assert.equal(preview.reason, 'body-unavailable');
	assert.ok(host.released.includes('original'), 'the original lease is still given back');
});

test('a body whose bytes are not the ones the attachment names is not shown', async () => {
	// The digest is re-proved every session precisely so a swapped body cannot
	// present itself as the proxy that was attached.
	const host = harness({
		bodies: {
			[PROXY_KEY]: new Blob([new Uint8Array(ARCHIVE_PROXY_BYTES.byteLength).fill(7)], {
				type: 'video/mp4',
			}),
		},
	});
	const preview = await resolveFramescaperVideoProxyPreviewV18(host.ports as never, {
		sourceId: ARCHIVE_SOURCE_ID,
	});

	assert.equal(preview.kind, 'original');
	assert.ok(preview.kind === 'original');
	assert.equal(preview.reason, 'not-attested');
});

test('an aborted preview stays aborted rather than answering the original', async () => {
	// A cancelled preview is the caller's own decision, and swallowing it would
	// leave a torn-down consumer holding a picture it no longer wants.
	const host = harness();
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		resolveFramescaperVideoProxyPreviewV18(host.ports as never, {
			sourceId: ARCHIVE_SOURCE_ID, signal: controller.signal,
		}),
		(error: Error) => error.name === 'AbortError',
	);
});

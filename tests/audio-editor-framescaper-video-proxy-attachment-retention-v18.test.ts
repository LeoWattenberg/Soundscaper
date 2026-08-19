/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperVideoProxyAttachmentsV18,
	retainFramescaperVideoProxyAttachmentsV18,
} from '../src/framescaper/editor-video-proxy-attachment-retention-v18.ts';

const SHA = 'a1'.repeat(32);
const OTHER_SHA = 'b2'.repeat(32);

function attachment(overrides: Record<string, unknown> = {}) {
	return {
		storageKey: `video-proxy-sha256:${SHA}`,
		sha256: SHA,
		byteLength: 128,
		mimeType: 'video/mp4',
		originalSha256: SHA,
		frameCount: 4,
		timingAsset: { storageKey: 'video-timing-sha256:cc', sha256: 'cc'.repeat(32) },
		...overrides,
	};
}

function project(overrides: Record<string, unknown> = {}) {
	return {
		sources: [
			{
				id: 'video-1',
				kind: 'video',
				contentSha256: SHA,
				sourceFrameCount: 4,
				proxyAttachment: attachment(),
			},
			{ id: 'audio-1', kind: 'audio' },
		],
		clips: [{ id: 'clip-1', sourceId: 'video-1', retimeMap: null }],
		projectBin: { clips: [] },
		...overrides,
	};
}

function carry(before: Record<string, unknown>, after: Record<string, unknown>) {
	retainFramescaperVideoProxyAttachmentsV18(after, framescaperVideoProxyAttachmentsV18(before));
	const source = (after.sources as Record<string, unknown>[]).find(({ id }) => id === 'video-1');
	return source?.proxyAttachment ?? null;
}

test('an edit that leaves the source alone keeps its proxy', () => {
	const before = project();
	const after = structuredClone(project());
	// The kind of edit that fills a session: a clip moved, a track renamed, a
	// marker dropped. None of it touches what the attachment claims.
	(after.clips as Record<string, unknown>[])[0]!.startFrame = 48;
	assert.deepEqual(carry(before, after), attachment());
});

test('an edit that changes the bytes behind the source drops it', () => {
	// Relink, changed-content relink, replace, reprobe, reimport, trim-media and
	// consolidate all arrive here as a new content digest on the same source. None
	// of them needs to know a proxy existed.
	const after = structuredClone(project());
	(after.sources as Record<string, unknown>[])[0]!.contentSha256 = OTHER_SHA;
	assert.equal(carry(project(), after), null);
});

test('an edit that changes how many frames the source has drops it', () => {
	// Conformance proved boundary for boundary against a frame count. A source
	// that now reports a different one was not the source that was proved.
	const after = structuredClone(project());
	(after.sources as Record<string, unknown>[])[0]!.sourceFrameCount = 5;
	assert.equal(carry(project(), after), null);
});

test('removing the last occurrence of a source drops it', () => {
	// A proxy for material nothing places is retention with no purpose, and the
	// V18 validator refuses the document outright.
	const after = structuredClone(project());
	after.clips = [];
	assert.equal(carry(project(), after), null);

	// A Project Bin occurrence is still an occurrence.
	const inBin = structuredClone(project());
	inBin.clips = [];
	inBin.projectBin = { clips: [{ id: 'bin-1', sourceId: 'video-1', retimeMap: null }] };
	assert.deepEqual(carry(project(), inBin), attachment());
});

test('retiming any occurrence drops it, including one of several', () => {
	// A retimed occurrence no longer presents the boundaries conformance proved,
	// so the proxy stops standing in for what is on screen.
	const after = structuredClone(project());
	(after.clips as Record<string, unknown>[])[0]!.retimeMap = { kind: 'ramp' };
	assert.equal(carry(project(), after), null);

	const partly = structuredClone(project());
	(partly.projectBin as { clips: unknown[] }).clips = [
		{ id: 'bin-1', sourceId: 'video-1', retimeMap: { kind: 'ramp' } },
	];
	assert.equal(carry(project(), partly), null);
});

test('a source that was never attached, or has gone, ends explicitly null', () => {
	const before = project();
	const after = structuredClone(project());
	(after.sources as Record<string, unknown>[]).push({
		id: 'video-2', kind: 'video', contentSha256: OTHER_SHA, sourceFrameCount: 9,
	});
	(after.clips as Record<string, unknown>[]).push({
		id: 'clip-2', sourceId: 'video-2', retimeMap: null,
	});
	retainFramescaperVideoProxyAttachmentsV18(after, framescaperVideoProxyAttachmentsV18(before));

	const sources = after.sources as Record<string, unknown>[];
	// Every video source carries the field explicitly, because the V18 wire
	// requires it present and audio sources require it absent.
	assert.equal(sources.find(({ id }) => id === 'video-2')?.proxyAttachment, null);
	assert.equal(Object.hasOwn(sources.find(({ id }) => id === 'audio-1')!, 'proxyAttachment'), false);

	// And a source the edit deleted takes its attachment with it.
	const removed = structuredClone(project());
	removed.sources = (removed.sources as Record<string, unknown>[]).filter(({ id }) => id !== 'video-1');
	removed.clips = [];
	retainFramescaperVideoProxyAttachmentsV18(removed, framescaperVideoProxyAttachmentsV18(before));
	assert.deepEqual(framescaperVideoProxyAttachmentsV18(removed), new Map());
});

test('reading a project answers exactly the attachments it holds', () => {
	assert.deepEqual(
		[...framescaperVideoProxyAttachmentsV18(project()).keys()],
		['video-1'],
	);
	const detached = structuredClone(project());
	(detached.sources as Record<string, unknown>[])[0]!.proxyAttachment = null;
	assert.equal(framescaperVideoProxyAttachmentsV18(detached).size, 0);
	assert.equal(framescaperVideoProxyAttachmentsV18(null).size, 0);
});

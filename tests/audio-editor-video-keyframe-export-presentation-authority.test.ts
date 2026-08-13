/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoKeyframeExportPresentationAuthority,
} from '../src/common/editor/video-keyframe-export-presentation-authority.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const DIGEST = '12'.repeat(32);
const RATE = Object.freeze({ num: 10, den: 1 });

test('resolves uniform wall-clock positions through exact unequal VFR intervals', () => {
	const source = videoSource('vfr', 4, { timing: 'exact' });
	const clip = videoClip('uniform', 'vfr', null, {
		sequenceFrameCount: 8,
		sourceInFrame: 1,
		sourceFrameCount: 3,
	});
	const timing = bindVfr(source, [0n, 1n, 4n, 10n], 2n, 10);
	const authority = createVideoKeyframeExportPresentationAuthority({
		project: project([source], [clip]),
		timingBySourceId: new Map([['vfr', timing]]),
	});

	const descriptor = authority.resolvePresentationDescriptor({
		clip: structuredClone(clip),
		source: structuredClone(source),
		localSequencePosition: Object.freeze({ num: 4, den: 1 }),
	});
	assert.deepEqual(descriptor, {
		outerCell: 4,
		segmentIndex: 0,
		mode: 'constant-forward',
		sourceFrame: exact(29n, 12n),
		sourceTime: exact(13n, 20n),
		drawableSourceFrame: 2,
		drawableSourceStartTime: exact(2n, 5n),
		drawableSourceEndTime: exact(1n),
	});
	assert.equal(Object.isFrozen(descriptor), true);

	const entry = frameEntry(source, clip, descriptor);
	assert.strictEqual(authority.presentationForEntry(entry), descriptor);
	assert.throws(
		() => authority.presentationForEntry({ ...entry, presentationDescriptor: { ...descriptor } }),
		/authenticated|authority|descriptor/iu,
	);
});

test('dispatches every curve mode through the precompiled exact frame binding', () => {
	const source = videoSource('curve-source', 8);
	const clip = videoClip('curve', 'curve-source', {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 1, den: 1 } },
			{ outerFrame: 2, sourceFrame: { num: 3, den: 1 } },
			{ outerFrame: 3, sourceFrame: { num: 3, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 2, den: 1 } },
		],
		segments: [
			{ mode: 'constant-forward' },
			{ mode: 'freeze' },
			{ mode: 'constant-reverse' },
		],
	}, { sequenceFrameCount: 4, sourceInFrame: 1, sourceFrameCount: 3 });
	const timing = bindCfr(source, 8);
	const authority = createVideoKeyframeExportPresentationAuthority({
		project: project([source], [clip]),
		timingBySourceId: new Map([['curve-source', timing]]),
	});
	const clonedClip = structuredClone(clip);
	const clonedSource = structuredClone(source);
	const expected = [
		['constant-forward', 1],
		['constant-forward', 2],
		['freeze', 3],
		['constant-reverse', 2],
	] as const;
	for (const [cell, [mode, drawable]] of expected.entries()) {
		const descriptor = authority.resolvePresentationDescriptor({
			clip: clonedClip,
			source: clonedSource,
			localSequencePosition: Object.freeze({ num: cell * 2 + 1, den: 2 }),
		});
		assert.equal(descriptor.outerCell, cell);
		assert.equal(descriptor.mode, mode);
		assert.equal(descriptor.drawableSourceFrame, drawable);
	}
});

test('binds descriptors to exact authority, clip, source, and canonical clone structure', () => {
	const source = videoSource('source', 4);
	const firstClip = videoClip('first', 'source', null);
	const secondClip = videoClip('second', 'source', null);
	const timing = bindCfr(source, 4);
	const input = {
		project: project([source], [firstClip, secondClip]),
		timingBySourceId: new Map([['source', timing]]),
	} as const;
	const first = createVideoKeyframeExportPresentationAuthority(input);
	const second = createVideoKeyframeExportPresentationAuthority(input);
	const descriptor = first.resolvePresentationDescriptor({
		clip: structuredClone(firstClip),
		source: structuredClone(source),
		localSequencePosition: Object.freeze({ num: 1, den: 2 }),
	});
	assert.throws(
		() => first.presentationForEntry(frameEntry(source, secondClip, descriptor)),
		/clip|authority|descriptor/iu,
	);
	assert.throws(
		() => second.presentationForEntry(frameEntry(source, firstClip, descriptor)),
		/authority|descriptor/iu,
	);
	assert.throws(() => first.resolvePresentationDescriptor({
		clip: { ...firstClip, sourceInFrame: 1 },
		source: structuredClone(source),
		localSequencePosition: Object.freeze({ num: 0, den: 1 }),
	}), /clip.*match|source range|canonical/iu);
	assert.throws(() => first.resolvePresentationDescriptor({
		clip: structuredClone(firstClip),
		source: { ...source, contentSha256: '34'.repeat(32) },
		localSequencePosition: Object.freeze({ num: 0, den: 1 }),
	}), /source.*match|digest|canonical/iu);
	assert.throws(() => first.resolvePresentationDescriptor({
		clip: structuredClone(firstClip),
		source: structuredClone(source),
		localSequencePosition: Object.freeze({ num: 2, den: 4 }),
	}), /canonical|reduced/iu);
});

test('fails before descriptor work for missing or mismatched authenticated timing tokens', () => {
	const source = videoSource('source', 4);
	const clip = videoClip('clip', 'source', null);
	assert.throws(() => createVideoKeyframeExportPresentationAuthority({
		project: project([source], [clip]),
		timingBySourceId: new Map(),
	}), /timing|source/iu);
	const other = videoSource('other', 4);
	assert.throws(() => createVideoKeyframeExportPresentationAuthority({
		project: project([source], [clip]),
		timingBySourceId: new Map([['source', bindCfr(other, 4)]]),
	}), /timing|source/iu);
});

function project(sources: readonly unknown[], clips: readonly unknown[]) {
	return Object.freeze({ sources: Object.freeze([...sources]), clips: Object.freeze([...clips]) });
}

function videoSource(
	id: string,
	frameCount: number,
	options: Readonly<{ timing?: 'cfr' | 'exact' }> = {},
): Readonly<Record<string, unknown>> {
	const exactTiming = options.timing === 'exact';
	return Object.freeze({
		id,
		kind: 'video',
		contentSha256: DIGEST,
		frameRate: RATE,
		sourceFrameCount: frameCount,
		timingAsset: exactTiming ? Object.freeze({}) : null,
		timingDecision: Object.freeze({
			mode: exactTiming ? 'exact' : 'conform-cfr-at-ingest',
			rate: RATE,
		}),
		width: 64,
		height: 32,
	});
}

function videoClip(
	id: string,
	sourceId: string,
	retimeMap: unknown,
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		id,
		kind: 'video',
		sourceId,
		sequenceId: 'main',
		sequenceStartFrame: 0,
		sequenceFrameCount: 4,
		sourceInFrame: 0,
		sourceFrameCount: 4,
		retimeMap,
		...overrides,
	});
}

function frameEntry(
	source: Readonly<Record<string, unknown>>,
	clip: Readonly<Record<string, unknown>>,
	descriptor: unknown,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		kind: 'video',
		sourceId: source.id,
		clipId: clip.id,
		source,
		clip,
		presentationDescriptor: descriptor,
	});
}

function bindCfr(source: Readonly<Record<string, unknown>>, frameCount: number) {
	return bindVideoSourceTimingView(new Map([[
		String(source.id),
		Object.freeze({ kind: 'cfr', rate: RATE, frameCount }),
	]]), source);
}

function bindVfr(
	sourceValue: Readonly<Record<string, unknown>>,
	presentationTicks: readonly bigint[],
	finalFrameDurationTicks: bigint,
	timescale: number,
): BoundVideoSourceTimingView {
	const publication = createVideoTimingAssetPublication(DIGEST, {
		timescale,
		presentationTicks,
		finalFrameDurationTicks,
	});
	const source = {
		...sourceValue,
		timingAsset: publication.reference,
	};
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr',
		reference: publication.reference,
		index,
	});
	return bindVideoSourceTimingView(new Map([[String(sourceValue.id), view]]), source);
}

function exact(numerator: bigint, denominator = 1n) {
	return Object.freeze({ numerator, denominator });
}

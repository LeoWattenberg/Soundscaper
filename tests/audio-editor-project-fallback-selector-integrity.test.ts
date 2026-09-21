/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	sameProjectAudioFallbackSelector,
	selectProjectAudioFallbackTarget,
	snapshotProjectAudioFallbackSelector,
	type ProjectAudioFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity-audio.ts';
import {
	sameProjectVideoFallbackSelector,
	selectProjectVideoFallbackTarget,
	snapshotProjectVideoFallbackSelector,
	type ProjectVideoFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity-video.ts';
import type { ProjectFeatureRequirement } from '../src/common/editor/project-feature-requirements.ts';

const SHA256 = 'a'.repeat(64);
const AUDIO_ERROR = 'The selected audio rendered fallback does not match one active project requirement and source claim.';
const VIDEO_ERROR = 'The selected video rendered fallback does not match one active project requirement and source claim.';
const AUDIO_SELECTOR = Object.freeze({
	requirementId: 'audio-render',
	featureId: 'org.soundscaper.audio-effects',
	role: 'project-audio-mix-v1',
	kind: 'audio',
	sourceId: 'audio-source',
	sha256: SHA256,
	targetTrackId: null,
} as const satisfies ProjectAudioFallbackIntegritySelector);
const VIDEO_SELECTOR = Object.freeze({
	requirementId: 'video-render',
	featureId: 'org.soundscaper.video-effects',
	role: 'project-video-render-v1',
	kind: 'video',
	sourceId: 'video-source',
	sha256: SHA256,
	targetClipId: null,
} as const satisfies ProjectVideoFallbackIntegritySelector);

for (const fixture of [
	{
		name: 'audio',
		selector: AUDIO_SELECTOR as Readonly<Record<string, unknown>>,
		snapshot: snapshotProjectAudioFallbackSelector as unknown as (value: unknown) => Readonly<Record<string, unknown>>,
		message: 'The selected audio rendered fallback is invalid.',
	},
	{
		name: 'video',
		selector: VIDEO_SELECTOR as Readonly<Record<string, unknown>>,
		snapshot: snapshotProjectVideoFallbackSelector as unknown as (value: unknown) => Readonly<Record<string, unknown>>,
		message: 'The selected video rendered fallback is invalid.',
	},
] as const) {
	test(`${fixture.name} selector snapshots copy only own data without invoking accessors`, () => {
		const mutable = { ...fixture.selector };
		const snapshot = fixture.snapshot(mutable);
		mutable.sourceId = 'tampered-source';
		assert.equal(snapshot.sourceId, fixture.selector.sourceId);
		assert.equal(Object.isFrozen(snapshot), true);

		let getterCalls = 0;
		const accessor = { ...fixture.selector };
		Object.defineProperty(accessor, 'sourceId', {
			enumerable: true,
			get() { getterCalls += 1; return fixture.selector.sourceId; },
		});
		assert.throws(
			() => fixture.snapshot(accessor),
			(error: unknown) => error instanceof TypeError && error.message === fixture.message,
		);
		assert.equal(getterCalls, 0);

		const inherited = { ...fixture.selector };
		delete inherited.featureId;
		Object.setPrototypeOf(inherited, { featureId: fixture.selector.featureId });
		assert.throws(
			() => fixture.snapshot(inherited),
			(error: unknown) => error instanceof TypeError && error.message === fixture.message,
		);
	});
}

test('audio selector target selection rejects duplicate and conflicting claims with exact wording', () => {
	const requirement = audioRequirement();
	const source = Object.freeze({
		id: AUDIO_SELECTOR.sourceId,
		kind: 'audio' as const,
		channelCount: 1,
		frameCount: 1,
		chunkFrames: 1,
	});
	const selected = selectProjectAudioFallbackTarget([requirement], [source], AUDIO_SELECTOR);
	assert.equal(selected.claim, requirement.fallback);
	assert.equal(selected.source, source);
	assert.equal(Object.isFrozen(selected), true);

	assertSelectionError(
		() => selectProjectAudioFallbackTarget([requirement, requirement], [source], AUDIO_SELECTOR),
		AUDIO_ERROR,
	);
	assertSelectionError(
		() => selectProjectAudioFallbackTarget([requirement], [source, source], AUDIO_SELECTOR),
		AUDIO_ERROR,
	);
	assertSelectionError(
		() => selectProjectAudioFallbackTarget([
			requirement,
			audioRequirement({ id: 'conflicting-audio', sha256: 'b'.repeat(64) }),
		], [source], AUDIO_SELECTOR),
		AUDIO_ERROR,
	);
	assert.doesNotThrow(() => selectProjectAudioFallbackTarget([
		requirement,
		audioRequirement({ id: 'matching-audio' }),
	], [source], AUDIO_SELECTOR));
});

test('video selector target selection rejects duplicate and conflicting claims with exact wording', () => {
	const requirement = videoRequirement();
	const source = Object.freeze({ id: VIDEO_SELECTOR.sourceId, kind: 'video' as const });
	const selected = selectProjectVideoFallbackTarget([requirement], [source], VIDEO_SELECTOR);
	assert.equal(selected.claim, requirement.fallback);
	assert.equal(selected.source, source);
	assert.equal(Object.isFrozen(selected), true);

	assertSelectionError(
		() => selectProjectVideoFallbackTarget([requirement, requirement], [source], VIDEO_SELECTOR),
		VIDEO_ERROR,
	);
	assertSelectionError(
		() => selectProjectVideoFallbackTarget([requirement], [source, source], VIDEO_SELECTOR),
		VIDEO_ERROR,
	);
	assertSelectionError(
		() => selectProjectVideoFallbackTarget([
			requirement,
			videoRequirement({ id: 'conflicting-video', role: 'video-clip-render-v1', targetClipId: 'clip-1' }),
		], [source], VIDEO_SELECTOR),
		VIDEO_ERROR,
	);
	assert.doesNotThrow(() => selectProjectVideoFallbackTarget([
		requirement,
		videoRequirement({ id: 'matching-video' }),
	], [source], VIDEO_SELECTOR));
});

test('selector equality includes common identity and role-specific relationship identity', () => {
	assert.equal(sameProjectAudioFallbackSelector(AUDIO_SELECTOR, { ...AUDIO_SELECTOR }), true);
	assert.equal(sameProjectAudioFallbackSelector(AUDIO_SELECTOR, {
		...AUDIO_SELECTOR,
		requirementId: 'other-audio-render',
	}), false);
	const audioTrack = Object.freeze({
		...AUDIO_SELECTOR,
		role: 'audio-track-render-v1' as const,
		targetTrackId: 'track-1',
	});
	assert.equal(sameProjectAudioFallbackSelector(audioTrack, { ...audioTrack }), true);
	assert.equal(sameProjectAudioFallbackSelector(audioTrack, { ...audioTrack, targetTrackId: 'track-2' }), false);

	assert.equal(sameProjectVideoFallbackSelector(VIDEO_SELECTOR, { ...VIDEO_SELECTOR }), true);
	assert.equal(sameProjectVideoFallbackSelector(VIDEO_SELECTOR, {
		...VIDEO_SELECTOR,
		sha256: 'b'.repeat(64),
	}), false);
	const videoClip = Object.freeze({
		...VIDEO_SELECTOR,
		role: 'video-clip-render-v1' as const,
		targetClipId: 'clip-1',
	});
	assert.equal(sameProjectVideoFallbackSelector(videoClip, { ...videoClip }), true);
	assert.equal(sameProjectVideoFallbackSelector(videoClip, { ...videoClip, targetClipId: 'clip-2' }), false);
});

function audioRequirement(options: Readonly<{
	id?: string;
	sha256?: string;
}> = {}): ProjectFeatureRequirement {
	return Object.freeze({
		id: options.id ?? AUDIO_SELECTOR.requirementId,
		featureId: AUDIO_SELECTOR.featureId,
		displayName: 'Audio fallback',
		disposition: 'rendered-fallback',
		fallback: Object.freeze({
			role: AUDIO_SELECTOR.role,
			kind: AUDIO_SELECTOR.kind,
			sourceId: AUDIO_SELECTOR.sourceId,
			sha256: options.sha256 ?? AUDIO_SELECTOR.sha256,
		}),
	});
}

function videoRequirement(options: Readonly<{
	id?: string;
	role?: 'project-video-render-v1' | 'video-clip-render-v1';
	targetClipId?: string;
}> = {}): ProjectFeatureRequirement {
	const role = options.role ?? VIDEO_SELECTOR.role;
	return Object.freeze({
		id: options.id ?? VIDEO_SELECTOR.requirementId,
		featureId: VIDEO_SELECTOR.featureId,
		displayName: 'Video fallback',
		disposition: 'rendered-fallback',
		fallback: role === 'video-clip-render-v1'
			? Object.freeze({
				role,
				kind: VIDEO_SELECTOR.kind,
				sourceId: VIDEO_SELECTOR.sourceId,
				sha256: VIDEO_SELECTOR.sha256,
				targetClipId: options.targetClipId ?? 'clip-1',
			})
			: Object.freeze({
				role,
				kind: VIDEO_SELECTOR.kind,
				sourceId: VIDEO_SELECTOR.sourceId,
				sha256: VIDEO_SELECTOR.sha256,
			}),
	});
}

function assertSelectionError(operation: () => unknown, message: string): void {
	assert.throws(operation, (error: unknown) => error instanceof Error && error.message === message);
}

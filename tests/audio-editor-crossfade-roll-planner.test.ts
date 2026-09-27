/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	planCrossfadeRoll,
	type CrossfadeRollClip,
	type CrossfadeRollProjectIndex,
} from '../src/common/editor/ui/timeline/crossfade-roll-planner.ts';

test('crossfade roll shifts both inner edges by one shared delta and returns one atomic command', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500);
	const incoming = clip('incoming', 1_500, 1_000, 500);
	const plan = planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, incoming),
		outgoing,
		incoming,
		requestedDeltaFrames: 100,
	});

	assert.ok(plan);
	assert.equal(plan.appliedDeltaFrames, 100);
	assert.deepEqual(plan.previews.map(preview => ({
		clipId: preview.clipId,
		timelineStartFrame: preview.timelineStartFrame,
		durationFrames: preview.durationFrames,
		sourceStartFrame: preview.sourceStartFrame,
		sourceDurationFrames: preview.sourceDurationFrames,
	})), [
		{
			clipId: 'outgoing', timelineStartFrame: 1_000, durationFrames: 1_100,
			sourceStartFrame: 500, sourceDurationFrames: 1_100,
		},
		{
			clipId: 'incoming', timelineStartFrame: 1_600, durationFrames: 900,
			sourceStartFrame: 600, sourceDurationFrames: 900,
		},
	]);
	const [outgoingPreview, incomingPreview] = plan.previews;
	assert.ok(outgoingPreview);
	assert.ok(incomingPreview);
	const originalOverlap = outgoing.timelineStartFrame + outgoing.durationFrames
		- incoming.timelineStartFrame;
	const previewOverlap = outgoingPreview.timelineStartFrame + outgoingPreview.durationFrames
		- incomingPreview.timelineStartFrame;
	assert.equal(previewOverlap, originalOverlap);
	assert.deepEqual(plan.command, {
		type: 'batch',
		commands: [
			{
				type: 'clip/trim', clipId: 'outgoing', sourceDurationFrames: 1_100,
				durationFrames: 1_100, trimEndFrames: 400,
			},
			{
				type: 'clip/trim', clipId: 'incoming', timelineStartFrame: 1_600,
				sourceStartFrame: 600, sourceDurationFrames: 900, durationFrames: 900,
				trimStartFrames: 600,
			},
		],
	});
	assert.ok(Object.isFrozen(plan));
	assert.ok(Object.isFrozen(plan.previews));
	assert.ok(plan.previews.every(Object.isFrozen));
	assert.ok(Object.isFrozen(plan.command));
	assert.ok(plan.command.commands.every(Object.isFrozen));
});

test('the tighter source boundary clamps both edges to the same negative roll delta', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500, { sourceStartFrame: 500 });
	const incoming = clip('incoming', 1_500, 1_000, 500, { sourceStartFrame: 25 });
	const plan = planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, incoming),
		outgoing,
		incoming,
		requestedDeltaFrames: -200,
	});

	assert.ok(plan);
	assert.equal(plan.appliedDeltaFrames, -25);
	assert.equal(plan.previews[0]?.durationFrames, 975);
	assert.equal(plan.previews[1]?.timelineStartFrame, 1_475);
	assert.equal(plan.previews[1]?.durationFrames, 1_025);
	assert.equal(
		(plan.previews[0]?.timelineStartFrame ?? 0) + (plan.previews[0]?.durationFrames ?? 0)
			- (plan.previews[1]?.timelineStartFrame ?? 0),
		500,
	);
});

test('roll preserves one shared delta through reversed source geometry', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500, { reversed: true });
	const incoming = clip('incoming', 1_500, 1_000, 500, { reversed: true });
	const plan = planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, incoming),
		outgoing,
		incoming,
		requestedDeltaFrames: 100,
	});

	assert.ok(plan);
	assert.equal(plan.appliedDeltaFrames, 100);
	assert.deepEqual(plan.previews.map(preview => ({
		clipId: preview.clipId,
		timelineStartFrame: preview.timelineStartFrame,
		durationFrames: preview.durationFrames,
		sourceStartFrame: preview.sourceStartFrame,
		sourceDurationFrames: preview.sourceDurationFrames,
		trimStartFrames: preview.trimStartFrames,
		trimEndFrames: preview.trimEndFrames,
	})), [
		{
			clipId: 'outgoing', timelineStartFrame: 1_000, durationFrames: 1_100,
			sourceStartFrame: 400, sourceDurationFrames: 1_100,
			trimStartFrames: 400, trimEndFrames: 500,
		},
		{
			clipId: 'incoming', timelineStartFrame: 1_600, durationFrames: 900,
			sourceStartFrame: 500, sourceDurationFrames: 900,
			trimStartFrames: 500, trimEndFrames: 600,
		},
	]);
});

test('roll clamps before either inner edge can pass the opposite outer edge', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500);
	const incoming = clip('incoming', 1_500, 1_000, 500);
	for (const [requestedDeltaFrames, appliedDeltaFrames] of [
		[-2_000, -499],
		[2_000, 499],
	] as const) {
		const plan = planCrossfadeRoll({
			projectIndex: projectIndex(outgoing, incoming),
			outgoing,
			incoming,
			requestedDeltaFrames,
		});
		assert.ok(plan);
		assert.equal(plan.appliedDeltaFrames, appliedDeltaFrames);
		const [outgoingPreview, incomingPreview] = plan.previews;
		assert.ok(outgoingPreview);
		assert.ok(incomingPreview);
		assert.ok(outgoingPreview.timelineStartFrame < incomingPreview.timelineStartFrame);
		assert.ok(
			outgoingPreview.timelineStartFrame + outgoingPreview.durationFrames
				< incomingPreview.timelineStartFrame + incomingPreview.durationFrames,
		);
		assert.equal(
			outgoingPreview.timelineStartFrame + outgoingPreview.durationFrames
				- incomingPreview.timelineStartFrame,
			500,
		);
	}
});

test('zero, fully clamped, missing-source, and non-overlap requests are no-ops', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500);
	const incoming = clip('incoming', 1_500, 1_000, 500);
	const index = projectIndex(outgoing, incoming);
	assert.equal(planCrossfadeRoll({
		projectIndex: index, outgoing, incoming, requestedDeltaFrames: 0,
	}), null);

	const noLeftMaterial = clip('no-left-material', 1_500, 1_000, 500, { sourceStartFrame: 0 });
	assert.equal(planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, noLeftMaterial),
		outgoing,
		incoming: noLeftMaterial,
		requestedDeltaFrames: -100,
	}), null);

	const missing = projectIndex(outgoing, incoming);
	missing.sourceById.delete(incoming.sourceId);
	assert.equal(planCrossfadeRoll({
		projectIndex: missing, outgoing, incoming, requestedDeltaFrames: 100,
	}), null);

	const separate = clip('separate', 2_000, 1_000, 500);
	assert.equal(planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, separate),
		outgoing,
		incoming: separate,
		requestedDeltaFrames: 100,
	}), null);
});

test('roll refuses authority that requires relation, warp, or musical-edge expansion', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500);
	for (const changes of [
		{ groupId: 'group' },
		{ avLinkId: 'av-link' },
		{ warpMap: { breakpoints: [] } },
		{ anchor: 'musical' as const },
	]) {
		const incoming = clip('incoming', 1_500, 1_000, 500, changes);
		assert.equal(planCrossfadeRoll({
			projectIndex: projectIndex(outgoing, incoming),
			outgoing,
			incoming,
			requestedDeltaFrames: 100,
		}), null);
	}
});

test('roll refuses stale indexed geometry and a triple-overlap seam', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500);
	const incoming = clip('incoming', 1_500, 1_000, 500);
	const stale = projectIndex(outgoing, incoming);
	stale.clipById.set(outgoing.id, { ...outgoing, durationFrames: 999 });
	assert.equal(planCrossfadeRoll({
		projectIndex: stale, outgoing, incoming, requestedDeltaFrames: 100,
	}), null);

	const third = clip('third', 1_700, 600, 500);
	const triple = projectIndex(outgoing, incoming, third);
	assert.equal(planCrossfadeRoll({
		projectIndex: triple, outgoing, incoming, requestedDeltaFrames: 100,
	}), null);
});

test('roll clamps at neighboring transition boundaries instead of creating a triple overlap', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500);
	const incoming = clip('incoming', 1_500, 1_000, 500);
	const rightNeighbor = clip('right-neighbor', 2_050, 800, 500);
	const positive = planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, incoming, rightNeighbor),
		outgoing,
		incoming,
		requestedDeltaFrames: 100,
	});
	assert.ok(positive);
	assert.equal(positive.appliedDeltaFrames, 50);
	assert.equal(
		positive.previews[0].timelineStartFrame + positive.previews[0].durationFrames,
		rightNeighbor.timelineStartFrame,
	);

	const leftNeighbor = clip('left-neighbor', 550, 900, 500);
	const negative = planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, incoming, leftNeighbor),
		outgoing,
		incoming,
		requestedDeltaFrames: -100,
	});
	assert.ok(negative);
	assert.equal(negative.appliedDeltaFrames, -50);
	assert.equal(
		negative.previews[1].timelineStartFrame,
		leftNeighbor.timelineStartFrame + leftNeighbor.durationFrames,
	);
});

test('roll is a no-op when either neighboring transition already touches its boundary', () => {
	const outgoing = clip('outgoing', 1_000, 1_000, 500);
	const incoming = clip('incoming', 1_500, 1_000, 500);
	const rightNeighbor = clip('right-neighbor', 2_000, 800, 500);
	assert.equal(planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, incoming, rightNeighbor),
		outgoing,
		incoming,
		requestedDeltaFrames: 100,
	}), null);

	const leftNeighbor = clip('left-neighbor', 500, 1_000, 500);
	assert.equal(planCrossfadeRoll({
		projectIndex: projectIndex(outgoing, incoming, leftNeighbor),
		outgoing,
		incoming,
		requestedDeltaFrames: -100,
	}), null);
});

function clip(
	id: string,
	timelineStartFrame: number,
	durationFrames: number,
	overlapSourceOffset: number,
	overrides: Partial<CrossfadeRollClip> = {},
): CrossfadeRollClip {
	return Object.freeze({
		id,
		kind: 'audio',
		sourceId: `${id}-source`,
		timelineStartFrame,
		durationFrames,
		sourceStartFrame: overlapSourceOffset,
		sourceDurationFrames: durationFrames,
		trimStartFrames: overlapSourceOffset,
		trimEndFrames: overlapSourceOffset,
		fadeInFrames: 80,
		fadeOutFrames: 120,
		fadeInShape: 1,
		fadeOutShape: 2,
		reversed: false,
		...overrides,
	});
}

function projectIndex(
	outgoing: CrossfadeRollClip,
	incoming: CrossfadeRollClip,
	...additional: readonly CrossfadeRollClip[]
): CrossfadeRollProjectIndex {
	const clips = [outgoing, incoming, ...additional];
	const track = Object.freeze({ id: 'track', clipIds: clips.map(item => item.id) });
	return {
		clipById: new Map(clips.map(item => [item.id, item])),
		sourceById: new Map(clips.map(item => [item.sourceId, Object.freeze({
			id: item.sourceId,
			frameCount: 4_000,
		})])),
		clipsByTrackId: new Map([[track.id, clips]]),
		trackByClipId: new Map(clips.map(item => [item.id, track])),
	};
}

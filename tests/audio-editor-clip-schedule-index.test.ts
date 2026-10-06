/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import type { EngineClip, EngineProject } from '../src/common/editor/engine/types.ts';

function fixture() {
	let geometryReads = 0;
	const clips = Array.from({ length: 1000 }, (_, index) => new Proxy(Object.freeze({ id: `clip-${index}`, sourceId: 'audio',
		timelineStartFrame: index * 40, durationFrames: 60, sourceStartFrame: index % 7, sourceDurationFrames: 60 }), {
		get(target, property, receiver) { if (property === 'timelineStartFrame' || property === 'durationFrames') geometryReads++; return Reflect.get(target, property, receiver) as unknown; },
	}));
	const clipIds = clips.map((clip) => clip.id).reverse();
	const track = { id: 'track', type: 'audio', clipIds };
	const project = Object.freeze({ clips: Object.freeze(clips), tracks: Object.freeze([track]) });
	const buffer = { length: 1000, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(1000) } as AudioBuffer;
	const input = {} as AudioNode;
	const options = { project, sources: new Map([['audio', buffer]]), trackInputs: new Map([['track', input]]), fromFrame: 491, toFrame: 501, sampleRate: 48000 };
	return { project, track, options, geometryReads: () => geometryReads, reset: () => { geometryReads = 0; } };
}
function comparable(plans: ReturnType<typeof buildClipSchedulePlans>) {
	return plans.map(({ clip, ...plan }) => ({ ...plan, clipId: clip.id }));
}

test('retained schedule geometry avoids complete clip and crossfade preparation on a second narrow render', () => {
	const subject = fixture(); const first = buildClipSchedulePlans(subject.options); subject.reset();
	const second = buildClipSchedulePlans(subject.options);
	assert.deepEqual(comparable(second), comparable(first));
	assert.ok(subject.geometryReads() < 10, `second range read ${subject.geometryReads()} geometry fields`);
	assert.deepEqual(second.map((plan) => plan.clip.id), ['clip-12', 'clip-11']);
	assert.deepEqual(second[0]!.crossfadeInRanges, [[0, 20]]);
});

test('mutable track membership invalidates prepared geometry and exposed crossfade ranges cannot poison later plans', () => {
	const subject = fixture(); const first = buildClipSchedulePlans(subject.options);
	(first[0]!.crossfadeInRanges as number[][])[0]![1] = 999;
	subject.track.clipIds.push('clip-12'); subject.track.clipIds.splice(subject.track.clipIds.indexOf('clip-11'), 1);
	const current = buildClipSchedulePlans(subject.options);
	const fresh = buildClipSchedulePlans({ ...subject.options, project: { ...subject.project } });
	assert.deepEqual(comparable(current), comparable(fresh));
	assert.deepEqual(current.map((plan) => plan.clip.id), ['clip-12', 'clip-12']);
});

test('mutable public clip geometry remains observed and source resolution is live for retained immutable geometry', () => {
	const subject = fixture(); const mutable: EngineProject = structuredClone({ clips: subject.project.clips.map((clip) => ({ ...clip })), tracks: subject.project.tracks });
	const before = buildClipSchedulePlans({ ...subject.options, project: mutable });
	const clip = mutable.clips![12] as EngineClip & { timelineStartFrame: number }; clip.timelineStartFrame = 2000;
	assert.notDeepEqual(comparable(buildClipSchedulePlans({ ...subject.options, project: mutable })), comparable(before));
	let offset = 70;
	const cached = { ...subject.options, sourceResolver: () => ({ sourceStartFrame: offset }) };
	assert.equal(buildClipSchedulePlans(cached)[0]!.offsetFrame, 81);
	offset = 90; assert.equal(buildClipSchedulePlans(cached)[0]!.offsetFrame, 101);
});

test('indexed windows preserve fresh baseline plans across boundary, zero-length, duplicate and nested overlaps', () => {
	const clips = [
		{ id: 'outer', timelineStartFrame: 0, durationFrames: 400 },
		{ id: 'left', timelineStartFrame: 20, durationFrames: 180 },
		{ id: 'right', timelineStartFrame: 100, durationFrames: 220 },
		{ id: 'same', timelineStartFrame: 100, durationFrames: 220 },
		{ id: 'empty', timelineStartFrame: 90, durationFrames: 0 },
	].map((clip) => Object.freeze({ ...clip, sourceId: 'audio', sourceStartFrame: 0, sourceDurationFrames: Math.max(1, clip.durationFrames) }));
	const track = { id: 'track', type: 'audio', clipIds: Object.freeze(['right', 'left', 'outer', 'same', 'empty', 'left', 'missing']) };
	const project = Object.freeze({ clips: Object.freeze(clips), tracks: Object.freeze([track]) });
	const sample = fixture().options;
	for (const [fromFrame, toFrame] of [[0, 20], [20, 90], [90, 100], [100, 200], [200, 220], [320, 400], [400, 401], [120, 120], [125, 100], [NaN, 125], [100, Infinity]]) {
		const options = { ...sample, fromFrame: fromFrame!, toFrame: toFrame!, project };
		const indexed = buildClipSchedulePlans(options);
		const baseline = buildClipSchedulePlans({ ...options, project: { ...project } });
		assert.deepEqual(indexed, baseline, `${fromFrame}..${toFrame}`);
	}
});

test('frozen root with accessor or mutable nested geometry remains uncached and observes changes', () => {
	let start = 0;
	const clip = Object.freeze({ id: 'mutable-getter', sourceId: 'audio', get timelineStartFrame() { return start; }, durationFrames: 100 });
	const project = Object.freeze({ clips: Object.freeze([clip]), tracks: Object.freeze([{ id: 'track', type: 'audio', clipIds: ['mutable-getter'] }]) });
	const options = { ...fixture().options, project, fromFrame: 0, toFrame: 10 };
	assert.equal(buildClipSchedulePlans(options).length, 1); start = 200; assert.equal(buildClipSchedulePlans(options).length, 0);
});

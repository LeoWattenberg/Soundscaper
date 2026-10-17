/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createMotionCompositionLinkState, normalizeMotionCompositionLinkState, receiveMotionCompositionUpdate, conformMotionCompositionLink, resumeMotionCompositionLink, restoreMotionCompositionLink } from '../src/common/editor/motion-link-state.ts';

function offer(revision: number, changes: Partial<{ width: number; height: number; durationFrames: number; sampleRate: number; title: string; projectId: string; compositionId: string; frameRate: { num: number; den: number }; outputSpace: 'srgb' | 'rec709' }> = {}) {
	const project = createMotionscaperProject({ id: changes.projectId ?? 'motion', title: changes.title ?? `Revision ${revision}`, compositionId: changes.compositionId ?? 'main' });
	const composition = project.compositions[0]!;
	return createMotionCompositionOffer(composition.id, createMotionscaperRevision({ ...project, sampleRate: changes.sampleRate ?? project.sampleRate, revision, compositions: [{ ...composition,
		width: changes.width ?? composition.width, height: changes.height ?? composition.height, durationFrames: changes.durationFrames ?? composition.durationFrames,
		frameRate: changes.frameRate ?? composition.frameRate, color: { ...composition.color, outputSpace: changes.outputSpace ?? composition.color.outputSpace } }] }));
}

test('M10 compatible saved revisions replace the accepted immutable snapshot once and preserve external identity through rename', () => {
	const original = createMotionCompositionLinkState(offer(1)); const update = offer(2, { title: 'Renamed title' });
	const next = receiveMotionCompositionUpdate(original, update);
	assert.equal(next.accepted.revision.digest, update.revision.digest); assert.equal(next.pending, null); assert.equal(next.paused, false);
	assert.equal(original.accepted.revision.revision, 1); assert.ok(Object.isFrozen(next)); assert.ok(Object.isFrozen(next.accepted.revision.project));
	assert.equal(receiveMotionCompositionUpdate(next, update), next); assert.equal(receiveMotionCompositionUpdate(next, offer(1)), next);
});

test('M10 every incompatible output dimension remains pending until explicit conform', () => {
	for (const changes of [{ width: 1280 }, { height: 720 }, { durationFrames: 42 }, { sampleRate: 44100 }, { frameRate: { num: 24, den: 1 } }, { outputSpace: 'rec709' as const }]) {
		const state = createMotionCompositionLinkState(offer(1)); const update = offer(2, changes);
		const pending = receiveMotionCompositionUpdate(state, update); assert.equal(pending.accepted.revision.revision, 1); assert.equal(pending.pending?.revision.digest, update.revision.digest);
		assert.equal(resumeMotionCompositionLink(pending).accepted.revision.revision, 1);
		const conformed = conformMotionCompositionLink(pending); assert.equal(conformed.accepted.revision.digest, update.revision.digest); assert.equal(conformed.pending, null);
		assert.equal(conformMotionCompositionLink(conformed), conformed);
	}
});

test('M10 undo restores a historical revision and pauses automatic updates until Resume', () => {
	const first = offer(1); const second = offer(2); const third = offer(3);
	const current = receiveMotionCompositionUpdate(createMotionCompositionLinkState(first), second);
	const undone = restoreMotionCompositionLink(current, first); assert.equal(undone.accepted.revision.revision, 1); assert.equal(undone.pending?.revision.revision, 2); assert.equal(undone.paused, true);
	const updated = receiveMotionCompositionUpdate(undone, third); assert.equal(updated.accepted.revision.revision, 1); assert.equal(updated.pending?.revision.revision, 3);
	assert.equal(receiveMotionCompositionUpdate(updated, second), updated);
	const resumed = resumeMotionCompositionLink(updated); assert.equal(resumed.accepted.revision.revision, 3); assert.equal(resumed.pending, null); assert.equal(resumed.paused, false);
	assert.equal(resumeMotionCompositionLink(resumed), resumed);
});

test('M10 undo retains the newest incompatible update and conform does not silently resume a paused link', () => {
	const first = offer(1); const current = receiveMotionCompositionUpdate(createMotionCompositionLinkState(first), offer(2));
	const pending = receiveMotionCompositionUpdate(current, offer(3, { width: 1280 }));
	const undone = restoreMotionCompositionLink(pending, first); assert.equal(undone.pending?.revision.revision, 3);
	const resumed = resumeMotionCompositionLink(undone); assert.equal(resumed.paused, false); assert.equal(resumed.accepted.revision.revision, 1); assert.equal(resumed.pending?.revision.revision, 3);
	const conformed = conformMotionCompositionLink(undone); assert.equal(conformed.accepted.revision.revision, 3); assert.equal(conformed.paused, true);
	const latest = receiveMotionCompositionUpdate(conformed, offer(4, { width: 1280 })); assert.equal(latest.pending?.revision.revision, 4); assert.equal(latest.accepted.revision.revision, 3);
});

test('M10 newer compatible updates supersede pending output changes and rejected/conflicting deliveries preserve accepted state', () => {
	const first = offer(1); const pending = receiveMotionCompositionUpdate(createMotionCompositionLinkState(first), offer(3, { width: 1280 }));
	assert.equal(receiveMotionCompositionUpdate(pending, offer(2)), pending);
	assert.throws(() => receiveMotionCompositionUpdate(pending, offer(3, { width: 640 })), /conflict/u);
	assert.throws(() => receiveMotionCompositionUpdate(pending, offer(4, { projectId: 'other' })), /identity/u);
	assert.throws(() => receiveMotionCompositionUpdate(pending, offer(4, { compositionId: 'other' })), /identity/u);
	assert.throws(() => receiveMotionCompositionUpdate(pending, { ...offer(4), revision: { ...offer(4).revision, digest: '0'.repeat(64) } }), /digest/u);
	assert.throws(() => restoreMotionCompositionLink(pending, offer(4)), /future/u);
	assert.throws(() => resumeMotionCompositionLink({ ...pending }), /issued/u);
	const accepted = receiveMotionCompositionUpdate(pending, offer(4)); assert.equal(accepted.accepted.revision.revision, 4); assert.equal(accepted.pending, null);
	assert.equal(pending.accepted.revision.revision, 1); assert.equal(pending.pending?.revision.revision, 3);
});

test('M10 offline reopen preserves the accepted snapshot, pending update and Undo pause without trusting malformed persisted state', () => {
	const first = offer(1); const latest = receiveMotionCompositionUpdate(createMotionCompositionLinkState(first), offer(2));
	const paused = restoreMotionCompositionLink(latest, first);
	const reopened = normalizeMotionCompositionLinkState(JSON.parse(JSON.stringify(paused)) as unknown);
	assert.deepEqual(reopened, paused); assert.equal(receiveMotionCompositionUpdate(reopened, offer(3)).accepted.revision.revision, 1);
	assert.equal(resumeMotionCompositionLink(reopened).accepted.revision.revision, 2);
	assert.throws(() => normalizeMotionCompositionLinkState({ ...paused, pending: first }), /newer/u);
	assert.throws(() => normalizeMotionCompositionLinkState({ ...paused, pending: offer(3, { projectId: 'other' }) }), /identity/u);
	assert.throws(() => normalizeMotionCompositionLinkState({ ...paused, paused: 'yes' }), /boolean/u);
	assert.throws(() => normalizeMotionCompositionLinkState({ ...paused, peerToken: 'private' }), /field/u);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { HelperContractViolationError, assertHelperWireEnvelope } from '../desktop/helper-wire-admission.ts';
import {
	PLUGIN_INSTANCE_STATES,
	PLUGIN_OPAQUE_STATE_CHUNK_BYTES,
	PLUGIN_OPAQUE_STATE_CONTROL_ENVELOPE_BYTES,
	PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES,
	PLUGIN_OPAQUE_STATE_MAXIMUM_CHUNKS,
	PLUGIN_OPAQUE_STATE_MAXIMUM_RETAINED_INSTANCES,
	PluginInstanceStateStore,
	assemblePluginOpaqueState,
	assertPluginInstanceId,
	choosePluginInstanceContinuity,
	planPluginOpaqueStateTransfer,
	validatePluginOpaqueStateChunk,
	validatePluginOpaqueStateDescriptor,
	type PluginOpaqueStatePersistOutcome,
} from '../desktop/plugin-instance-state.ts';
import { computeAudioTrackFreezeDigestsV1 } from '../src/common/editor/audio-track-freeze-v21.ts';

const INSTANCE = 'instance-a';
const SOURCE_SHA = 'a'.repeat(64);

function statePattern(byteLength: number, seed: number): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	for (let index = 0; index < byteLength; index += 1) bytes[index] = (index * 31 + seed) & 0xff;
	return bytes;
}

function rejected(outcome: PluginOpaqueStatePersistOutcome) {
	assert.equal(outcome.status, 'rejected');
	if (outcome.status !== 'rejected') throw new Error('unreachable');
	return outcome;
}

function persisted(outcome: PluginOpaqueStatePersistOutcome) {
	assert.equal(outcome.status, 'persisted');
	if (outcome.status !== 'persisted') throw new Error('unreachable');
	return outcome;
}

function digestInput(effectsActive = true) {
	return {
		sampleRate: 48_000,
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		track: {
			type: 'audio', id: 'track-a', clipIds: ['clip-a'],
			gain: 1, pan: 0, mute: false, solo: false,
			effectsActive,
			effects: [{ id: 'fx-a', type: 'vst3-host', enabled: true, params: { drive: 0.5 } }],
		},
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 1_024, durationFrames: 1_024,
			gain: 1, fadeInFrames: 0, fadeOutFrames: 0, envelope: [], opaqueExtensions: {},
		}],
		sourceContentIdentities: [{ sourceId: 'source-a', contentSha256: SOURCE_SHA }],
		automationLanes: [],
	};
}

/** An authored freeze is the project's own record, never one made after a fault. */
function authoredFreeze() {
	return {
		schemaVersion: 1,
		derivedSourceId: 'frozen-track-a',
		...computeAudioTrackFreezeDigestsV1(digestInput()),
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
	};
}

test('the ceiling, the chunk size and the control envelope are the milestone values', () => {
	assert.equal(PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES, 16 * 1024 * 1024);
	assert.equal(PLUGIN_OPAQUE_STATE_CONTROL_ENVELOPE_BYTES, 64 * 1024);
	assert.equal(PLUGIN_OPAQUE_STATE_MAXIMUM_CHUNKS * PLUGIN_OPAQUE_STATE_CHUNK_BYTES, PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES);
	assert.deepEqual([...PLUGIN_INSTANCE_STATES], ['hosted', 'stopped', 'faulted', 'revoked']);
});

test('a state is chunked, and every chunk round trips back to the exact bytes', () => {
	const bytes = statePattern(PLUGIN_OPAQUE_STATE_CHUNK_BYTES * 2 + 17, 5);
	const transfer = planPluginOpaqueStateTransfer({ instanceId: INSTANCE, generation: 3, bytes });
	assert.equal(transfer.descriptor.byteLength, bytes.byteLength);
	assert.equal(transfer.descriptor.chunkCount, 3);
	assert.equal(transfer.chunks.length, 3);
	assert.equal(transfer.descriptor.sha256, createHash('sha256').update(bytes).digest('hex'));
	for (const chunk of transfer.chunks) {
		assert.ok(chunk.bytes.byteLength <= PLUGIN_OPAQUE_STATE_CHUNK_BYTES);
		// A chunk that shared the whole state's buffer would smuggle the state.
		assert.equal(chunk.bytes.byteOffset, 0);
		assert.equal(chunk.bytes.buffer.byteLength, chunk.bytes.byteLength);
		assert.deepEqual(validatePluginOpaqueStateChunk(chunk), chunk);
	}
	const assembled = assemblePluginOpaqueState(transfer.descriptor, transfer.chunks);
	assert.deepEqual(assembled.bytes, bytes);
	assert.equal(assembled.sha256, transfer.descriptor.sha256);

	const empty = planPluginOpaqueStateTransfer({ instanceId: INSTANCE, generation: 0, bytes: new Uint8Array(0) });
	assert.equal(empty.chunks.length, 0);
	assert.equal(assemblePluginOpaqueState(empty.descriptor, empty.chunks).byteLength, 0);
});

test('the descriptor rides the control envelope and the state itself cannot', () => {
	const bytes = statePattern(PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES, 1);
	const transfer = planPluginOpaqueStateTransfer({ instanceId: INSTANCE, generation: 1, bytes });
	assert.equal(transfer.chunks.length, PLUGIN_OPAQUE_STATE_MAXIMUM_CHUNKS);
	// The descriptor is an ordinary control message and is admitted as one.
	assertHelperWireEnvelope(transfer.descriptor);
	assert.ok(JSON.stringify(transfer.descriptor).length < PLUGIN_OPAQUE_STATE_CONTROL_ENVELOPE_BYTES);
	// The state is not, which is exactly why it has its own bounded channel.
	assert.throws(
		() => assertHelperWireEnvelope({ instanceId: INSTANCE, bytes }),
		(error: unknown) => error instanceof HelperContractViolationError && error.code === 'oversized',
	);
	assert.throws(
		() => assertHelperWireEnvelope({ instanceId: INSTANCE, chunks: transfer.chunks.map((chunk) => chunk.bytes) }),
		(error: unknown) => error instanceof HelperContractViolationError && error.code === 'oversized',
	);
	assert.deepEqual(assemblePluginOpaqueState(transfer.descriptor, transfer.chunks).bytes, bytes);
});

test('a state past the ceiling is refused before any channel carries it', () => {
	const bytes = new Uint8Array(PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 1);
	assert.throws(
		() => planPluginOpaqueStateTransfer({ instanceId: INSTANCE, generation: 1, bytes }),
		(error: unknown) => error instanceof HelperContractViolationError && error.code === 'oversized',
	);
	assert.throws(
		() => validatePluginOpaqueStateChunk({
			instanceId: INSTANCE, generation: 1, chunkIndex: 0,
			bytes: new Uint8Array(PLUGIN_OPAQUE_STATE_CHUNK_BYTES + 1),
		}),
		(error: unknown) => error instanceof HelperContractViolationError && error.code === 'oversized',
	);
});

test('descriptors, chunks and instance ids are admitted against a closed schema', () => {
	const good = planPluginOpaqueStateTransfer({ instanceId: INSTANCE, generation: 2, bytes: statePattern(64, 2) });
	assert.deepEqual(validatePluginOpaqueStateDescriptor(good.descriptor), good.descriptor);
	const cases: unknown[] = [
		null,
		{ ...good.descriptor, extra: 1 },
		{ ...good.descriptor, sha256: 'A'.repeat(64) },
		{ ...good.descriptor, chunkCount: 2 },
		{ ...good.descriptor, byteLength: PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 1 },
		{ ...good.descriptor, generation: -1 },
		{ ...good.descriptor, instanceId: '../../etc/passwd' },
		{ ...good.descriptor, instanceId: 'C:\\plugins\\state' },
	];
	for (const candidate of cases) {
		assert.throws(() => validatePluginOpaqueStateDescriptor(candidate), HelperContractViolationError);
	}
	// Nothing path-shaped is an instance id, so no id can smuggle a raw path.
	for (const id of ['/abs/path', 'a/b', 'a\\b', '', '.hidden', 'x'.repeat(129)]) {
		assert.throws(() => assertPluginInstanceId(id), HelperContractViolationError);
	}
	assert.equal(assertPluginInstanceId('instance-1.a_b'), 'instance-1.a_b');

	const packed = new Uint8Array(128);
	assert.throws(
		() => validatePluginOpaqueStateChunk({ instanceId: INSTANCE, generation: 1, chunkIndex: 0, bytes: packed.subarray(0, 64) }),
		HelperContractViolationError,
		'a view over a larger buffer is not a tight chunk',
	);
	assert.throws(
		() => validatePluginOpaqueStateChunk({ instanceId: INSTANCE, generation: 1, chunkIndex: 0, bytes: [1, 2, 3] }),
		HelperContractViolationError,
	);
	assert.throws(
		() => validatePluginOpaqueStateChunk({ instanceId: INSTANCE, generation: 1, chunkIndex: 0 }),
		HelperContractViolationError,
	);
});

test('an incomplete, reordered or altered transfer never assembles', () => {
	const bytes = statePattern(PLUGIN_OPAQUE_STATE_CHUNK_BYTES + 8, 9);
	const { descriptor, chunks } = planPluginOpaqueStateTransfer({ instanceId: INSTANCE, generation: 4, bytes });
	assert.throws(() => assemblePluginOpaqueState(descriptor, [chunks[0]]), HelperContractViolationError);
	assert.throws(() => assemblePluginOpaqueState(descriptor, [...chunks].reverse()), HelperContractViolationError);
	assert.throws(() => assemblePluginOpaqueState(descriptor, [...chunks, chunks[1]]), HelperContractViolationError);
	assert.throws(
		() => assemblePluginOpaqueState(descriptor, chunks.map((chunk) => ({ ...chunk, instanceId: 'other' }))),
		HelperContractViolationError,
	);
	const tampered = chunks.map((chunk, index) => index === 1
		? { ...chunk, bytes: Uint8Array.from(chunk.bytes, (byte) => byte ^ 0xff) }
		: chunk);
	assert.throws(() => assemblePluginOpaqueState(descriptor, tampered), /digest/u);
});

test('an oversize state makes the instance ineligible without discarding the retained state', () => {
	const store = new PluginInstanceStateStore();
	const bytes = statePattern(4_096, 7);
	const kept = persisted(store.persist({ instanceId: INSTANCE, generation: 1, bytes }));
	assert.equal(kept.retained.byteLength, 4_096);
	assert.equal(store.isEligible(INSTANCE), true);

	const refusal = rejected(store.declareOversizeState({
		instanceId: INSTANCE, generation: 2, declaredByteLength: PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 1,
	}));
	assert.equal(refusal.code, 'oversize');
	assert.equal(refusal.eligible, false, 'the instance stops being eligible to host');
	assert.deepEqual(refusal.retained, kept.retained, 'and keeps exactly the state it last persisted');
	assert.equal(store.isEligible(INSTANCE), false);

	const readBack = store.read(INSTANCE);
	assert.ok(readBack);
	assert.deepEqual(readBack.bytes, bytes, 'the retained bytes survive the refusal verbatim');
	assert.equal(store.describe(INSTANCE).ineligibleReason, 'oversize-state');
	assert.deepEqual(store.describe(INSTANCE).retained, kept.retained);

	// The same refusal arrives when the oversize bytes are handed over directly.
	const direct = new PluginInstanceStateStore();
	persisted(direct.persist({ instanceId: INSTANCE, generation: 1, bytes }));
	const overBytes = rejected(direct.persist({
		instanceId: INSTANCE, generation: 2, bytes: new Uint8Array(PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 1),
	}));
	assert.equal(overBytes.code, 'oversize');
	assert.equal(overBytes.eligible, false);
	assert.deepEqual(direct.read(INSTANCE)?.bytes, bytes);

	store.forget(INSTANCE);
	assert.equal(store.read(INSTANCE), null);
	assert.equal(store.isEligible(INSTANCE), true);
});

test('an oversize report that does not describe an oversize state is malformed, not a verdict', () => {
	const store = new PluginInstanceStateStore();
	const bytes = statePattern(64, 1);
	persisted(store.persist({ instanceId: INSTANCE, generation: 1, bytes }));

	// The bytes were never transferred, so the declared length is all main has
	// to go on. A helper that mis-states it must not be able to cost an
	// instance its eligibility with a size nothing ever measured.
	for (const declaredByteLength of [64, PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES, -1, 1.5, Number.NaN]) {
		const bogus = rejected(store.declareOversizeState({ instanceId: INSTANCE, generation: 2, declaredByteLength }));
		assert.equal(bogus.code, 'malformed', `${String(declaredByteLength)} is not an oversize state`);
		assert.equal(bogus.eligible, true);
		assert.equal(store.isEligible(INSTANCE), true);
	}

	const real = rejected(store.declareOversizeState({
		instanceId: INSTANCE, generation: 2, declaredByteLength: PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 1,
	}));
	assert.equal(real.code, 'oversize');
	assert.equal(store.isEligible(INSTANCE), false);
	assert.deepEqual(store.read(INSTANCE)?.bytes, bytes);
});

test('retention is bounded, and at the ceiling the store refuses rather than evicting', () => {
	const store = new PluginInstanceStateStore();
	let refused: ReturnType<typeof rejected> | null = null;
	let retainedCount = 0;
	// Instance ids arrive from a helper and every retained state may be 16 MiB,
	// so an unbounded retention map is an unbounded memory grant.
	for (let index = 0; index < 4_096 && refused === null; index += 1) {
		const outcome = store.persist({ instanceId: `instance-${String(index)}`, generation: 1, bytes: statePattern(8, index) });
		if (outcome.status === 'rejected') refused = rejected(outcome);
		else retainedCount += 1;
	}
	assert.ok(refused, 'a store that retains 16 MiB per instance must bound how many instances it retains');
	assert.equal(refused.code, 'capacity');
	assert.equal(retainedCount, PLUGIN_OPAQUE_STATE_MAXIMUM_RETAINED_INSTANCES);
	assert.equal(refused.eligible, true, 'a full store is not a verdict about the instance that arrived last');
	assert.ok(retainedCount > 0);
	assert.ok(store.read('instance-0'), 'the ceiling refuses the newcomer; it never evicts a state already retained');

	// An instance the store already holds keeps its right to update its state.
	persisted(store.persist({ instanceId: 'instance-0', generation: 2, bytes: statePattern(16, 2) }));
	store.forget('instance-0');
	persisted(store.persist({ instanceId: 'instance-overflow', generation: 1, bytes: statePattern(8, 1) }));
});

test('a stale or malformed transfer is a retry, not a verdict about the instance', () => {
	const store = new PluginInstanceStateStore();
	const bytes = statePattern(256, 3);
	const kept = persisted(store.persist({ instanceId: INSTANCE, generation: 5, bytes }));
	const stale = rejected(store.persist({ instanceId: INSTANCE, generation: 4, bytes: statePattern(16, 1) }));
	assert.equal(stale.code, 'stale-generation');
	assert.equal(stale.eligible, true, 'a stale replay does not cost eligibility');
	assert.deepEqual(stale.retained, kept.retained);
	const malformed = rejected(store.persist({
		instanceId: INSTANCE, generation: 6, bytes: 'not-bytes' as unknown as Uint8Array,
	}));
	assert.equal(malformed.code, 'malformed');
	assert.equal(malformed.eligible, true);
	assert.deepEqual(store.read(INSTANCE)?.bytes, bytes);
});

test('the store copies on the way in and on the way out', () => {
	const store = new PluginInstanceStateStore();
	const bytes = statePattern(32, 11);
	persisted(store.persist({ instanceId: INSTANCE, generation: 1, bytes }));
	bytes[0] = (bytes[0] ^ 0xff) & 0xff;
	const first = store.read(INSTANCE);
	assert.ok(first);
	assert.notDeepEqual(first.bytes, bytes, 'a caller cannot mutate the retained state after the fact');
	first.bytes[1] = 0x5a;
	assert.notDeepEqual(store.read(INSTANCE)?.bytes, first.bytes);
});

test('a failure with no authored freeze offers bypass and never a fabricated freeze', () => {
	const decision = choosePluginInstanceContinuity({
		instanceId: INSTANCE,
		state: 'faulted',
		retainedOpaqueState: { instanceId: INSTANCE, generation: 2, byteLength: 64, sha256: SOURCE_SHA },
	});
	assert.equal(decision.mode, 'bypass');
	assert.equal(decision.freeze, null, 'nothing is offered as a freeze that the project did not author');
	assert.equal(decision.parametersIntact, true);
	assert.equal(decision.cause, 'faulted');
	assert.equal(decision.opaqueState?.byteLength, 64);
	assert.equal(JSON.stringify(decision).includes('project-authored'), false,
		'a bypass must not be dressed up with an authored-freeze provenance');

	// An empty freeze context is the same answer: there is nothing to play.
	const unfrozen = choosePluginInstanceContinuity({
		instanceId: INSTANCE,
		state: 'revoked',
		freeze: { currentDigests: computeAudioTrackFreezeDigestsV1(digestInput()) },
	});
	assert.equal(unfrozen.mode, 'bypass');
	assert.equal(unfrozen.freeze, null);
});

test('an authored freeze that cannot be verified is bypassed, never played', () => {
	const currentDigests = computeAudioTrackFreezeDigestsV1(digestInput());
	// A project record main cannot validate is not a freeze main may play, and
	// a recovery answer that throws leaves the user with no answer at all.
	for (const authored of [null, 'freeze', { schemaVersion: 1 }, { ...authoredFreeze(), schemaVersion: 2 }]) {
		const decision = choosePluginInstanceContinuity({
			instanceId: INSTANCE, state: 'faulted', freeze: { authored, currentDigests },
		});
		assert.equal(decision.mode, 'bypass', `an unverifiable freeze (${JSON.stringify(authored)}) is not playable`);
		assert.equal(decision.freeze, null);
		assert.equal(JSON.stringify(decision).includes('project-authored'), false);
	}
	const unverifiableCurrent = choosePluginInstanceContinuity({
		instanceId: INSTANCE, state: 'faulted', freeze: { authored: authoredFreeze(), currentDigests: { rack: 'nope' } },
	});
	assert.equal(unverifiableCurrent.mode, 'bypass', 'digests that will not normalize cannot certify a freeze as fresh');
	assert.equal(unverifiableCurrent.freeze, null);
});

test('a fresh authored V21 freeze plays and a stale one falls back to bypass', () => {
	const authored = authoredFreeze();
	const fresh = choosePluginInstanceContinuity({
		instanceId: INSTANCE,
		state: 'faulted',
		freeze: { authored, currentDigests: computeAudioTrackFreezeDigestsV1(digestInput()) },
	});
	assert.equal(fresh.mode, 'frozen-playback');
	assert.equal(fresh.freeze?.provenance, 'project-authored');
	assert.equal(fresh.freeze?.derivedSourceId, 'frozen-track-a');
	assert.equal(fresh.freeze?.freshnessDigestSha256, authored.freshnessDigestSha256);

	// The rack changed after the freeze was authored, so the freeze no longer
	// describes what the user would hear and must not be played as if it did.
	const stale = choosePluginInstanceContinuity({
		instanceId: INSTANCE,
		state: 'faulted',
		freeze: { authored, currentDigests: computeAudioTrackFreezeDigestsV1(digestInput(false)) },
	});
	assert.equal(stale.mode, 'bypass');
	assert.equal(stale.freeze, null);

	assert.throws(
		() => choosePluginInstanceContinuity({ instanceId: INSTANCE, state: 'hosted' }),
		RangeError,
		'a hosted instance has nothing to recover from',
	);
});

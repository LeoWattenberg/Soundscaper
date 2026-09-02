/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { effectLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import {
	compileProjectPathPdcPlanV21,
	type ProjectPathPdcPlanV21,
} from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import {
	NATIVE_EFFECT_LATENCY_PROJECTION_MARKER,
	createNativeEffectLatencyLedgerV21,
	nativeEffectLatencyKeyV21,
	nativeEffectPdcErrorSamplesV21,
	projectNativeEffectLatencyV21,
	type NativeEffectInstanceV21,
	type NativeEffectLatencyLedgerOptionsV21,
	type NativeEffectLatencyLedgerV21,
} from '../src/common/editor/engine/native-effect-latency-v21.ts';

const SAMPLE_RATE = 48_000;
const INSTANCE: NativeEffectInstanceV21 = Object.freeze({
	instanceId: 'native-verb-1',
	strip: Object.freeze({ kind: 'mixer-node' as const, id: 'verb' }),
	effectId: 'verb-native',
});

test('feeds an accepted native latency through send, group, sidechain and master exactly', () => {
	const ledger = createLedger();
	assert.equal(ledger.report(INSTANCE.instanceId, 512).status, 'accepted');
	assert.equal(ledger.commitAtBlockBoundary(1_024).status, 'swapped');
	const plan = ledger.authoritative.plan;
	assert.equal(ledger.authoritative.pdcErrorSamples, 0);
	assert.equal(plan.nodeOutputLatencyFrames.get('track:voice'), 480);
	assert.equal(plan.nodeInputLatencyFrames.get('mixer-node:verb'), 480);
	assert.equal(plan.nodeOutputLatencyFrames.get('mixer-node:verb'), 1_040);
	assert.equal(plan.nodeInputLatencyFrames.get('mixer-node:bus'), 1_040);
	assert.equal(plan.nodeOutputLatencyFrames.get('mixer-node:bus'), 1_136);
	assert.equal(plan.nodeInputLatencyFrames.get('master'), 1_136);
	assert.equal(plan.nodeOutputLatencyFrames.get('master'), 1_376);
	assert.equal(plan.outputLatencyFrames.get('main'), 1_376);
	assert.deepEqual([...plan.edgeCompensationFrames].sort(byKey), [
		['bus-master', 0], ['master-main', 0], ['music-bus', 1_040], ['music-ducks-verb', 1_040],
		['verb-bus', 0], ['voice-bus', 560], ['voice-verb', 0],
	]);
	assert.equal(plan.latencyFrames, 1_376);
	assert.equal(plan.monitoringLatencyFrames, 1_376);
	assert.equal(plan.renderLatencyFrames, 1_376);
	assert.equal(plan.freezeLatencyFramesByTrack.get('voice'), 480);
	assert.equal(plan.freezeLatencyFramesByTrack.get('music'), 0);
	assert.equal(plan.automationLatencyFrames(effectAddress('verb', 'verb-native')), 528);
	assert.equal(plan.automationLatencyFrames(effectAddress('verb', 'verb-pre')), 480);
	assert.equal(plan.automationLatencyFrames({ kind: 'edge', edgeId: 'music-bus', parameterId: 'level' }), 1_040);
	assert.equal(ledger.authoritative.contributedFrames.get(INSTANCE.instanceId), 512);
	assert.equal(ledger.authoritative.instanceStates.get(INSTANCE.instanceId), 'active');
});

test('keeps the published revision authoritative until a block boundary accepts the swap', () => {
	const ledger = createLedger();
	const before = ledger.authoritative;
	assert.equal(before.revision, 0);
	assert.equal(before.plan.latencyFrames, 864);
	const idleBefore = ledger.pending;
	assert.equal(idleBefore, null);
	assert.equal(ledger.report(INSTANCE.instanceId, 512).pendingRevision, 1);
	// The new plan exists in full while the old one is still the one being heard.
	assert.equal(ledger.pending?.plan.latencyFrames, 1_376);
	assert.equal(ledger.authoritative, before);
	const midBlock = ledger.commitAtBlockBoundary(1_000);
	assert.deepEqual(midBlock, { status: 'unsafe-boundary', atFrame: 1_000, revision: 0, previousRevision: 0 });
	assert.equal(ledger.authoritative, before);
	assert.equal(ledger.pending?.revision, 1);
	const swapped = ledger.commitAtBlockBoundary(1_024);
	assert.deepEqual(swapped, { status: 'swapped', atFrame: 1_024, revision: 1, previousRevision: 0 });
	assert.equal(ledger.authoritative.plan.latencyFrames, 1_376);
	const idleAfterSwap = ledger.pending;
	assert.equal(idleAfterSwap, null);
	assert.deepEqual(ledger.commitAtBlockBoundary(2_048), {
		status: 'idle', atFrame: 2_048, revision: 1, previousRevision: 1,
	});
	// A swap already published cannot be re-scheduled behind itself.
	assert.equal(ledger.report(INSTANCE.instanceId, 256).status, 'accepted');
	assert.equal(ledger.commitAtBlockBoundary(1_024).status, 'unsafe-boundary');
});

test('resolves exactly one revision for every frame on either side of a swap', () => {
	const ledger = createLedger();
	ledger.report(INSTANCE.instanceId, 512);
	assert.equal(ledger.commitAtBlockBoundary(1_280).status, 'swapped');
	ledger.report(INSTANCE.instanceId, 96);
	assert.equal(ledger.commitAtBlockBoundary(2_560).status, 'swapped');
	for (let frame = 0; frame <= 3_000; frame += 1) {
		const revision = ledger.revisionAtFrame(frame);
		assert.equal(revision.pdcErrorSamples, 0);
		const expected = frame < 1_280 ? 0 : frame < 2_560 ? 1 : 2;
		assert.equal(revision.revision, expected, `frame ${frame}`);
		assert.equal(revision.plan.latencyFrames, [864, 1_376, 960][expected]);
	}
});

test('retains a bounded swap history that still covers frame zero', () => {
	const time = clock();
	const ledger = createLedger({ now: time.now });
	for (let index = 1; index <= 12; index += 1) {
		time.advance(20_000);
		assert.equal(ledger.report(INSTANCE.instanceId, index * 64).status, 'accepted');
		assert.equal(ledger.commitAtBlockBoundary(index * 128).status, 'swapped');
	}
	assert.equal(ledger.authoritative.revision, 12);
	// The oldest window the ledger still holds is stretched back over frame 0, so
	// the frame axis stays total after the history is trimmed.
	assert.equal(ledger.revisionAtFrame(0).revision, 5);
	assert.equal(ledger.revisionAtFrame(12 * 128).revision, 12);
	assert.throws(() => ledger.revisionAtFrame(-1), /frame must be an integer/u);
});

test('a bypassed native effect recompiles to the plan of a project that never had it', () => {
	const ledger = createLedger({ project: project({ sidechainEffectId: 'verb-pre' }) });
	ledger.report(INSTANCE.instanceId, 512);
	ledger.commitAtBlockBoundary(128);
	assert.equal(ledger.authoritative.plan.latencyFrames, 1_376);
	assert.equal(ledger.setBypassed(INSTANCE.instanceId, true).status, 'accepted');
	assert.equal(ledger.commitAtBlockBoundary(256).status, 'swapped');
	assert.equal(ledger.authoritative.contributedFrames.get(INSTANCE.instanceId), 0);
	assert.equal(ledger.authoritative.reportedFrames.get(INSTANCE.instanceId), 512);
	assert.equal(ledger.authoritative.instanceStates.get(INSTANCE.instanceId), 'bypassed');
	assert.deepEqual(planShape(ledger.authoritative.plan), planShape(withoutNativePlan()));
	assert.equal(ledger.setBypassed(INSTANCE.instanceId, true).status, 'unchanged');
	assert.equal(ledger.setBypassed(INSTANCE.instanceId, false).status, 'accepted');
	ledger.commitAtBlockBoundary(384);
	assert.equal(ledger.authoritative.plan.latencyFrames, 1_376);
});

test('a lost host contributes zero and recompiles to the plan without that effect', () => {
	const ledger = createLedger({ project: project({ sidechainEffectId: 'verb-pre' }) });
	ledger.report(INSTANCE.instanceId, 512);
	ledger.commitAtBlockBoundary(128);
	const loss = ledger.reportHostLoss(INSTANCE.instanceId);
	assert.deepEqual(loss, {
		status: 'faulted', instanceId: INSTANCE.instanceId, detail: 'host-lost',
		fault: 'host-lost', pendingRevision: 2,
	});
	assert.equal(ledger.commitAtBlockBoundary(256).status, 'swapped');
	assert.equal(ledger.authoritative.faults.get(INSTANCE.instanceId), 'host-lost');
	assert.deepEqual(planShape(ledger.authoritative.plan), planShape(withoutNativePlan()));
	// A dead host is not reported over, and it does not fault twice.
	assert.equal(ledger.report(INSTANCE.instanceId, 64).status, 'ignored');
	assert.equal(ledger.setBypassed(INSTANCE.instanceId, true).detail, 'faulted-instance');
	assert.equal(ledger.reportHostLoss(INSTANCE.instanceId).status, 'unchanged');
});

test('faults and bypasses an unbounded latency instead of absorbing it', () => {
	const ledger = createLedger();
	ledger.report(INSTANCE.instanceId, 512);
	ledger.commitAtBlockBoundary(128);
	assert.equal(ledger.maxLatencyFrames, 96_000);
	const faulted = ledger.report(INSTANCE.instanceId, 96_001);
	assert.equal(faulted.status, 'faulted');
	assert.equal(faulted.fault, 'latency-out-of-range');
	assert.equal(ledger.pending?.contributedFrames.get(INSTANCE.instanceId), 0);
	ledger.commitAtBlockBoundary(256);
	assert.equal(ledger.authoritative.plan.latencyFrames, 864);
	assert.equal(ledger.authoritative.instanceStates.get(INSTANCE.instanceId), 'faulted');
	// The explicit re-enable is the only way back, and it starts from zero.
	assert.equal(ledger.reinstate(INSTANCE.instanceId).status, 'accepted');
	assert.equal(ledger.reinstate(INSTANCE.instanceId).status, 'unchanged');
	assert.equal(ledger.report(INSTANCE.instanceId, 512).status, 'accepted');
	ledger.commitAtBlockBoundary(384);
	assert.equal(ledger.authoritative.plan.latencyFrames, 1_376);
});

test('rejects every shape of latency the compensation cannot realize', () => {
	for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 96_001]) {
		const ledger = createLedger();
		const report = ledger.report(INSTANCE.instanceId, value);
		assert.equal(report.fault, 'latency-out-of-range', `latency ${value}`);
		assert.equal(ledger.pending?.contributedFrames.get(INSTANCE.instanceId), 0);
	}
});

test('faults latency that keeps moving inside the stability window', () => {
	const time = clock();
	const ledger = createLedger({ now: time.now });
	for (const frames of [64, 128, 192, 256]) {
		time.advance(100);
		assert.equal(ledger.report(INSTANCE.instanceId, frames).status, 'accepted');
	}
	time.advance(100);
	const faulted = ledger.report(INSTANCE.instanceId, 320);
	assert.equal(faulted.fault, 'latency-unstable');
	assert.equal(ledger.pending?.contributedFrames.get(INSTANCE.instanceId), 0);
	ledger.commitAtBlockBoundary(128);
	assert.equal(ledger.authoritative.plan.latencyFrames, 864);
});

test('a settled plug-in that changes slowly is never called unstable', () => {
	const time = clock();
	const ledger = createLedger({ now: time.now });
	for (const frames of [64, 128, 192, 256, 320, 384, 448]) {
		time.advance(4_000);
		assert.equal(ledger.report(INSTANCE.instanceId, frames).status, 'accepted', `latency ${frames}`);
	}
	assert.equal(ledger.report(INSTANCE.instanceId, 448).status, 'unchanged');
	ledger.commitAtBlockBoundary(128);
	assert.equal(ledger.authoritative.contributedFrames.get(INSTANCE.instanceId), 448);
});

test('faults the instance when its staged revision cannot compile', () => {
	let failing = false;
	const ledger = createLedger({
		compile: (value, options) => {
			if (failing) {
				failing = false;
				throw new RangeError('the staged graph was refused');
			}
			return compileProjectPathPdcPlanV21(value, options);
		},
	});
	// The first compile builds revision 0, so arm the failure after construction.
	failing = true;
	const report = ledger.report(INSTANCE.instanceId, 512);
	assert.equal(report.status, 'faulted');
	assert.equal(report.fault, 'plan-rejected');
	assert.equal(ledger.pending?.contributedFrames.get(INSTANCE.instanceId), 0);
	assert.equal(ledger.authoritative.revision, 0);
});

test('an unknown instance changes nothing at all', () => {
	const ledger = createLedger();
	for (const report of [
		ledger.report('ghost', 512),
		ledger.setBypassed('ghost', true),
		ledger.reportHostLoss('ghost'),
		ledger.reinstate('ghost'),
	]) {
		assert.equal(report.status, 'ignored');
		assert.equal(report.detail, 'unknown-instance');
	}
	assert.equal(ledger.pending, null);
	assert.equal(ledger.report(INSTANCE.instanceId, 0).status, 'unchanged');
	assert.equal(ledger.reinstate(INSTANCE.instanceId).detail, 'not-faulted');
});

test('refuses instances that carry a path, collide, or name no effect', () => {
	assert.throws(() => createLedger({
		instances: [{ ...INSTANCE, instanceId: '/opt/vst3/Reverb.vst3' }],
	}), /must not carry a path/u);
	assert.throws(() => createLedger({
		instances: [{ ...INSTANCE, instanceId: 'C:Reverb.vst3' }],
	}), /must not carry a path/u);
	assert.throws(() => createLedger({ instances: [{ ...INSTANCE, instanceId: '' }] }), /1 to 128 characters/u);
	assert.throws(() => createLedger({
		instances: [{ ...INSTANCE, effectId: 'e'.repeat(257) }],
	}), /at most 256 characters/u);
	assert.throws(() => createLedger({ instances: [INSTANCE, INSTANCE] }), /Duplicate native effect instance/u);
	assert.throws(() => createLedger({
		instances: [INSTANCE, { ...INSTANCE, instanceId: 'native-verb-2' }],
	}), /claim effect/u);
	assert.throws(() => createLedger({
		instances: [{ ...INSTANCE, effectId: 'not-here' }],
	}), /names no effect in this project/u);
	assert.throws(() => createLedger({ project: null }), /V21 project is required/u);
	assert.throws(() => createLedger({ blockFrames: 0 }), /blockFrames must be an integer/u);
	assert.throws(() => createLedger({ maxLatencySeconds: 0 }), /positive finite number/u);
});

test('declares an exact frame count at awkward sample rates and leaves the rest untouched', () => {
	for (const sampleRate of [44_100, 48_000, 88_200, 96_000, 192_000]) {
		for (const frames of [0, 1, 97, 4_097, 44_099, 96_000]) {
			const key = nativeEffectLatencyKeyV21(INSTANCE.strip, INSTANCE.effectId);
			const projection = projectNativeEffectLatencyV21(project(), new Map([[key, frames]]), sampleRate);
			assert.deepEqual([...projection.appliedFrames], [[key, frames]]);
			const projected = verbEffects(projection.project)[1];
			assert.equal(effectLatencyFrames(projected, sampleRate), frames, `${frames} at ${sampleRate}`);
			assert.equal(projected[NATIVE_EFFECT_LATENCY_PROJECTION_MARKER], true);
			assert.equal(projected.bypassed, frames === 0);
			assert.equal(projected.id, INSTANCE.effectId);
		}
	}
	const untouched = project();
	const projection = projectNativeEffectLatencyV21(untouched, new Map(), SAMPLE_RATE);
	assert.equal(projection.appliedFrames.size, 0);
	assert.deepEqual(projection.project, untouched);
	assert.throws(() => projectNativeEffectLatencyV21(null, new Map(), SAMPLE_RATE), /V21 project is required/u);
});

test('the PDC error check is not vacuous', () => {
	const value = project({ native: false, sidechainEffectId: 'verb-pre' });
	const plan = compileProjectPathPdcPlanV21(value, { sampleRate: SAMPLE_RATE });
	assert.equal(nativeEffectPdcErrorSamplesV21(value, plan), 0);
	const tampered: ProjectPathPdcPlanV21 = {
		...plan,
		edgeCompensationFrames: new Map([...plan.edgeCompensationFrames, ['music-bus', 0]]),
	};
	assert.equal(nativeEffectPdcErrorSamplesV21(value, tampered), 528);
});

test('the gate the project itself authored keeps a native claim out of the plan', () => {
	for (const gate of ['bypassed', 'disabled'] as const) {
		const value = project({ sidechainEffectId: 'verb-pre' });
		if (gate === 'bypassed') verbEffects(value)[1]!.bypassed = true;
		else verbEffects(value)[1]!.enabled = false;
		const ledger = createLedger({ project: value });
		assert.equal(ledger.report(INSTANCE.instanceId, 512).status, 'accepted', gate);
		assert.equal(ledger.commitAtBlockBoundary(128).status, 'swapped', gate);
		// The user cannot hear this effect, so compensating for it would make the
		// render disagree with playback over an effect that is not in the signal.
		assert.deepEqual(planShape(ledger.authoritative.plan), planShape(withoutNativePlan()), gate);
		assert.equal(ledger.authoritative.contributedFrames.get(INSTANCE.instanceId), 0, gate);
		assert.equal(ledger.authoritative.reportedFrames.get(INSTANCE.instanceId), 512, gate);
		assert.equal(ledger.authoritative.instanceStates.get(INSTANCE.instanceId), 'bypassed', gate);
	}
});

test('a rack the project switched off carries none of the native claim', () => {
	const value = project({ sidechainEffectId: 'verb-pre' });
	value.mixer.edges = value.mixer.edges.filter((candidate) => candidate.id !== 'music-ducks-verb');
	value.mixer.sends[0]!.effectsActive = false;
	const ledger = createLedger({ project: value });
	assert.equal(ledger.report(INSTANCE.instanceId, 512).status, 'accepted');
	assert.equal(ledger.commitAtBlockBoundary(128).status, 'swapped');
	assert.equal(ledger.authoritative.plan.nodeOutputLatencyFrames.get('mixer-node:verb'), 480);
	assert.equal(ledger.authoritative.contributedFrames.get(INSTANCE.instanceId), 0);
	assert.equal(ledger.authoritative.instanceStates.get(INSTANCE.instanceId), 'bypassed');
});

test('a revision that cannot be built is discarded, never published behind the ledger', () => {
	let failures = 0;
	const ledger = createLedger({
		compile: (value, options) => {
			if (failures > 0) {
				failures -= 1;
				throw new RangeError('the staged graph was refused');
			}
			return compileProjectPathPdcPlanV21(value, options);
		},
	});
	assert.equal(ledger.report(INSTANCE.instanceId, 512).status, 'accepted');
	failures = 2;
	const report = ledger.report(INSTANCE.instanceId, 1_024);
	assert.equal(report.status, 'faulted');
	assert.equal(report.fault, 'plan-rejected');
	assert.equal(report.detail, 'plan-unbuildable');
	assert.equal(report.pendingRevision, null);
	// The staged revision no longer matches the ledger, so leaving it where a
	// swap could reach it would publish latency for an instance now faulted.
	assert.equal(ledger.pending, null);
	assert.deepEqual(ledger.commitAtBlockBoundary(128), {
		status: 'idle', atFrame: 128, revision: 0, previousRevision: 0,
	});
	assert.equal(ledger.authoritative.plan.latencyFrames, 864);
	assert.equal(ledger.authoritative.contributedFrames.get(INSTANCE.instanceId), 0);
	assert.equal(ledger.reinstate(INSTANCE.instanceId).status, 'accepted');
	assert.equal(ledger.commitAtBlockBoundary(256).status, 'swapped');
	assert.equal(ledger.authoritative.plan.latencyFrames, 864);
});

test('a fault whose rebuild also fails still reports rather than throwing', () => {
	let failures = 0;
	const ledger = createLedger({
		compile: (value, options) => {
			if (failures > 0) {
				failures -= 1;
				throw new RangeError('the staged graph was refused');
			}
			return compileProjectPathPdcPlanV21(value, options);
		},
	});
	ledger.report(INSTANCE.instanceId, 512);
	assert.equal(ledger.commitAtBlockBoundary(128).status, 'swapped');
	failures = 1;
	const loss = ledger.reportHostLoss(INSTANCE.instanceId);
	assert.deepEqual(loss, {
		status: 'faulted', instanceId: INSTANCE.instanceId, detail: 'plan-unbuildable',
		fault: 'host-lost', pendingRevision: null,
	});
	assert.equal(ledger.pending, null);
	// The last revision that did compile stays authoritative, exactly as it was.
	assert.equal(ledger.authoritative.revision, 1);
	assert.equal(ledger.authoritative.plan.latencyFrames, 1_376);
	// The fault is recorded, so the next buildable stage drops the instance.
	assert.equal(ledger.setBypassed(INSTANCE.instanceId, true).detail, 'faulted-instance');
	assert.equal(ledger.reinstate(INSTANCE.instanceId).status, 'accepted');
	assert.equal(ledger.commitAtBlockBoundary(256).status, 'swapped');
	assert.equal(ledger.authoritative.plan.latencyFrames, 864);
});

test('an id the ledger would not admit is never echoed back as status', () => {
	const ledger = createLedger();
	const redacted = new Set<string>();
	for (const id of [
		'/opt/vst3/Reverb.vst3/Contents/x86_64-linux/Reverb.so',
		'C:\\Program Files\\Common Files\\VST3\\Reverb.vst3',
		'C:Reverb.vst3',
		'x'.repeat(200_000),
	]) {
		const label = id.slice(0, 20);
		const report = ledger.report(id, 512);
		assert.equal(report.status, 'ignored', label);
		assert.ok(!/[\\/]/u.test(report.instanceId), `echoed a path for ${label}`);
		assert.ok(report.instanceId.length <= 128, `echoed ${report.instanceId.length} characters for ${label}`);
		redacted.add(report.instanceId);
	}
	assert.equal(redacted.size, 1);
	const marker = [...redacted][0]!;
	assert.equal(ledger.setBypassed('/etc/passwd', true).instanceId, marker);
	assert.equal(ledger.reportHostLoss('/etc/passwd').instanceId, marker);
	assert.equal(ledger.reinstate('/etc/passwd').instanceId, marker);
	// A benign unknown id carries nothing to leak, so it is still named back.
	assert.equal(ledger.reinstate('ghost').instanceId, 'ghost');
	assert.equal(ledger.pending, null);
});

function createLedger(overrides: Partial<NativeEffectLatencyLedgerOptionsV21> = {}): NativeEffectLatencyLedgerV21 {
	return createNativeEffectLatencyLedgerV21({
		project: project(),
		instances: [INSTANCE],
		sampleRate: SAMPLE_RATE,
		now: () => 0,
		...overrides,
	});
}

function clock(): { now: () => number; advance: (ms: number) => void } {
	let value = 0;
	return { now: () => value, advance(ms: number): void { value += ms; } };
}

function withoutNativePlan(): ProjectPathPdcPlanV21 {
	return compileProjectPathPdcPlanV21(
		project({ native: false, sidechainEffectId: 'verb-pre' }),
		{ sampleRate: SAMPLE_RATE },
	);
}

const AUTOMATION_PROBES: readonly Record<string, unknown>[] = Object.freeze([
	{ kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
	{ kind: 'strip', strip: { kind: 'track', id: 'music' }, parameterId: 'gain' },
	{ kind: 'strip', strip: { kind: 'mixer-node', id: 'verb' }, parameterId: 'pan' },
	{ kind: 'strip', strip: { kind: 'mixer-node', id: 'bus' }, parameterId: 'pan' },
	{ kind: 'strip', strip: { kind: 'master' }, parameterId: 'mute' },
	{ kind: 'edge', edgeId: 'voice-bus', parameterId: 'level' },
	{ kind: 'edge', edgeId: 'music-bus', parameterId: 'level' },
	{ kind: 'edge', edgeId: 'music-ducks-verb', parameterId: 'level' },
	effectAddress('verb', 'verb-pre'),
	effectAddress('bus', 'bus-limit'),
]);

/** Every number the plan publishes, so equality is compared and not sampled. */
function planShape(plan: ProjectPathPdcPlanV21): Record<string, unknown> {
	return {
		nodeInput: [...plan.nodeInputLatencyFrames].sort(byKey),
		nodeOutput: [...plan.nodeOutputLatencyFrames].sort(byKey),
		edges: [...plan.edgeCompensationFrames].sort(byKey),
		outputs: [...plan.outputLatencyFrames].sort(byKey),
		freeze: [...plan.freezeLatencyFramesByTrack].sort(byKey),
		latencyFrames: plan.latencyFrames,
		monitoringLatencyFrames: plan.monitoringLatencyFrames,
		renderLatencyFrames: plan.renderLatencyFrames,
		automation: AUTOMATION_PROBES.map((address) => plan.automationLatencyFrames(address)),
	};
}

function byKey(left: readonly [string, number], right: readonly [string, number]): number {
	return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

function effectAddress(stripId: string, effectId: string): Record<string, unknown> {
	return { kind: 'effect', strip: { kind: 'mixer-node', id: stripId }, effectId, parameterId: 'mix' };
}

function verbEffects(value: unknown): MutableEffect[] {
	const mixer = (value as { mixer: { sends: MutableStrip[] } }).mixer;
	return mixer.sends[0]!.effects;
}

/**
 * voice and music merge at a group, voice also feeds a send whose rack carries a
 * plain limiter ahead of the native effect and a gate after it. Music keys that
 * gate through an explicit sidechain, so one native latency has to align an
 * output, a group, a send and a sidechain at once.
 */
function project(options: { native?: boolean; sidechainEffectId?: string } = {}): MutableProject {
	const verb: MutableEffect[] = [{ id: 'verb-pre', type: 'limiter', enabled: true, params: { lookahead: 0.001 } }];
	if (options.native !== false) verb.push({ id: 'verb-native', type: 'native-effect-host' });
	verb.push({ id: 'verb-gate', type: 'gate', enabled: true, params: { threshold: -30 } });
	return {
		sampleRate: SAMPLE_RATE,
		tracks: [
			{ id: 'voice', type: 'audio', effectsActive: true, effects: [
				{ id: 'voice-limit', type: 'limiter', enabled: true, params: { lookahead: 0.01 } },
			] },
			{ id: 'music', type: 'audio', effectsActive: true, effects: [] },
		],
		master: { effectsActive: true, effects: [
			{ id: 'master-limit', type: 'limiter', enabled: true, params: { lookahead: 0.005 } },
		] },
		mixer: {
			schemaVersion: 1,
			groups: [strip('bus', [{ id: 'bus-limit', type: 'limiter', enabled: true, params: { lookahead: 0.002 } }])],
			sends: [strip('verb', verb)],
			cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('voice-verb', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'verb' }, 'send'),
				edge('voice-bus', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'bus' }),
				edge('music-bus', { kind: 'track', id: 'music' }, { kind: 'mixer-node', id: 'bus' }),
				edge('verb-bus', { kind: 'mixer-node', id: 'verb' }, { kind: 'mixer-node', id: 'bus' }),
				edge('bus-master', { kind: 'mixer-node', id: 'bus' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
				edge('music-ducks-verb', { kind: 'track', id: 'music' }, {
					kind: 'effect-sidechain',
					strip: { kind: 'mixer-node', id: 'verb' },
					effectId: options.sidechainEffectId ?? 'verb-gate',
				}, 'sidechain'),
			],
		},
	};
}

function strip(id: string, effects: MutableEffect[]): MutableStrip {
	return { id, name: id, color: '#4f87c8', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: true, effectsActive: true, effects, channelCount: 2 };
}

function edge(
	id: string,
	source: Record<string, unknown>,
	destination: Record<string, unknown>,
	kind = 'assignment',
): MutableEdge {
	return { id, kind, source, destination, position: 'post-fader', level: 1, enabled: true, channelMap: [] };
}

interface MutableEffect extends Record<string, unknown> { id: string; type: string }
interface MutableStrip { id: string; name: string; color: string; gain: number; pan: number; mute: boolean;
	solo: boolean; collapsed: boolean; effectsActive: boolean; effects: MutableEffect[]; channelCount: number }
interface MutableEdge { id: string; kind: string; source: Record<string, unknown>;
	destination: Record<string, unknown>; position: string; level: number; enabled: boolean; channelMap: number[] }
interface MutableProject {
	sampleRate: number;
	tracks: { id: string; type: string; effectsActive: boolean; effects: MutableEffect[] }[];
	master: { effectsActive: boolean; effects: MutableEffect[] };
	mixer: { schemaVersion: number; groups: MutableStrip[]; sends: MutableStrip[]; cues: MutableStrip[];
		vcas: unknown[]; outputs: unknown[]; edges: MutableEdge[] };
}

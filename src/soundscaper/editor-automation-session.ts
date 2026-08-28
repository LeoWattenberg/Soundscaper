/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUTOMATION_LANE_MAXIMUM_CAPTURE_POINTS_V21,
	evaluateAutomationLaneAtFrameV21,
	type AutomationLanePositionV21,
	type AutomationLaneV21,
} from '../common/editor/automation-lane-v21.ts';
import {
	commitAutomationWriteModeV21,
	resolveAutomationWriteModeV21,
	type AutomationWriteCaptureSampleV21,
	type AutomationWriteModeV21,
	type AutomationWritePhaseV21,
} from '../common/editor/automation-write-mode-v21.ts';
import type { ParameterDescriptor } from '../common/editor/parameter-address.ts';
import { sampleFrameToBeat } from '../common/editor/timeline-tempo-inverse.ts';
import { compareRationals, type HoldTempoMap } from '../common/editor/timeline-time.ts';
import type {
	SoundscaperAutomationAuthority,
	SoundscaperAutomationGestureRelease,
	SoundscaperAutomationGestureToken,
	SoundscaperAutomationPreview,
	SoundscaperAutomationSessionPorts,
	SoundscaperAutomationSessionSnapshot,
	SoundscaperAutomationSession,
	SoundscaperAutomationTarget,
} from './editor-automation-session-types.ts';

export type {
	SoundscaperAutomationAuthority,
	SoundscaperAutomationGestureRelease,
	SoundscaperAutomationGestureToken,
	SoundscaperAutomationLaneSetCommand,
	SoundscaperAutomationPreview,
	SoundscaperAutomationSessionPorts,
	SoundscaperAutomationSessionSnapshot,
	SoundscaperAutomationSession,
	SoundscaperAutomationTarget,
} from './editor-automation-session-types.ts';

interface CaptureSession {
	readonly laneId: string;
	readonly mode: AutomationWriteModeV21;
	readonly lane: AutomationLaneV21;
	readonly descriptor: ParameterDescriptor;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly generation: number;
	readonly samples: AutomationWriteCaptureSampleV21[];
	trimAnchor: number;
	lastControlValue: number;
	phase: AutomationWritePhaseV21;
	gestureActive: boolean;
	ordinal: number;
}

/**
 * Own the transient automation authoring lifecycle for exact-V21 Soundscaper.
 * The only document mutation is the injected complete-value lane command.
 */
export function createSoundscaperAutomationSession<Result = unknown>(
	ports: SoundscaperAutomationSessionPorts<Result>,
): SoundscaperAutomationSession<Result> {
	assertPorts(ports);
	let mode: AutomationWriteModeV21 = 'read';
	let laneId: string | null = null;
	let session: CaptureSession | null = null;
	let generation = 0;
	let disposed = false;
	let committing = false;
	let known = authority(ports.captureAuthority());

	function getSnapshot(): SoundscaperAutomationSessionSnapshot {
		const phase = session?.phase ?? 'readback';
		return Object.freeze({
			mode,
			laneId,
			active: session !== null,
			gestureActive: session?.gestureActive ?? false,
			generation: session?.generation ?? generation,
			owner: resolveAutomationWriteModeV21(session?.mode ?? mode, phase).owner,
			capturePointCount: session?.samples.length ?? 0,
		});
	}

	function setMode(
		nextModeValue: AutomationWriteModeV21,
		nextLaneIdValue: string | null = laneId,
	): SoundscaperAutomationSessionSnapshot {
		assertActive();
		const nextMode = automationMode(nextModeValue);
		const nextLaneId = optionalLaneId(nextLaneIdValue);
		if (nextMode !== 'read') assertWritableTarget(nextLaneId, authority(ports.captureAuthority()));
		if (session && (nextMode !== mode || nextLaneId !== laneId)) finishSession(true);
		mode = nextMode;
		laneId = nextLaneId;
		return getSnapshot();
	}

	function beginGesture(
		requestedLaneId: string | null = laneId,
		controlValue?: number,
	): SoundscaperAutomationGestureToken {
		assertActive();
		synchronize();
		const selectedLaneId = requiredLaneId(requestedLaneId);
		if (laneId !== selectedLaneId) {
			if (session) finishSession(true);
			laneId = selectedLaneId;
		}
		const currentAuthority = authority(ports.captureAuthority());
		const target = assertWritableTarget(selectedLaneId, currentAuthority, mode === 'read');
		if (mode !== 'read' && !transportActive(currentAuthority.transportState)) {
			throw new Error('Automation capture requires an active transport.');
		}
		if (!session) session = createSession(target, currentAuthority, mode, 'gesture');
		else assertSessionLane(session, selectedLaneId);
		session.phase = 'gesture';
		session.gestureActive = true;
		const value = normalizeControlValue(controlValue ?? target.controlValue, session.descriptor);
		session.trimAnchor = value;
		session.lastControlValue = value;
		appendSample(session, currentAuthority, value);
		return token(session);
	}

	function previewGesture(
		gestureToken: SoundscaperAutomationGestureToken,
		controlValue: number,
		frame?: number,
	): SoundscaperAutomationPreview {
		assertActive();
		const activeSession = assertGesture(gestureToken);
		const currentAuthority = frameAuthority(frame);
		assertSessionAuthority(activeSession, currentAuthority);
		const value = normalizeControlValue(controlValue, activeSession.descriptor);
		activeSession.lastControlValue = value;
		return appendSample(activeSession, currentAuthority, value);
	}

	function releaseGesture(
		gestureToken: SoundscaperAutomationGestureToken,
		controlValue?: number,
		frame?: number,
	): SoundscaperAutomationGestureRelease<Result> {
		assertActive();
		const activeSession = assertGesture(gestureToken);
		const currentAuthority = frameAuthority(frame);
		assertSessionAuthority(activeSession, currentAuthority);
		const value = normalizeControlValue(
			controlValue ?? activeSession.lastControlValue,
			activeSession.descriptor,
		);
		activeSession.lastControlValue = value;
		appendSample(activeSession, currentAuthority, value);
		activeSession.gestureActive = false;
		activeSession.phase = 'after-gesture';
		const owner = resolveAutomationWriteModeV21(activeSession.mode, 'after-gesture').owner;
		if (activeSession.mode === 'latch' || activeSession.mode === 'write') {
			return Object.freeze({ owner, committed: false, result: null });
		}
		const result = finishSession(true);
		return Object.freeze({ owner, committed: result !== null, result });
	}

	function cancelGesture(gestureToken?: SoundscaperAutomationGestureToken): boolean {
		assertActive();
		if (!session) return false;
		if (gestureToken) assertToken(session, gestureToken);
		discardSession(true);
		return true;
	}

	function synchronize(): Result | null {
		assertActive();
		const current = authority(ports.captureAuthority());
		if (committing) {
			known = current;
			return null;
		}
		const projectChanged = current.projectId !== known.projectId;
		const revisionChanged = current.projectRevision !== known.projectRevision;
		if (projectChanged || current.projectId === null) {
			resetForAuthority(current, true);
			return null;
		}
		if (current.readOnly || current.lockReadOnly || current.transportState === 'failed') {
			resetForAuthority(current, true);
			return null;
		}
		if (laneId !== null) {
			const target = ports.resolveTarget(laneId);
			if (!target || target.locked) {
				resetForAuthority(current, true);
				return null;
			}
		}
		if (session && revisionChanged) {
			resetForAuthority(current, true);
			return null;
		}

		const wasRunning = transportActive(known.transportState);
		const running = transportActive(current.transportState);
		known = current;
		if (!wasRunning && running && mode === 'write' && laneId !== null) {
			const target = assertWritableTarget(laneId, current);
			session = createSession(target, current, mode, 'readback');
			appendSample(session, current, target.controlValue);
			return null;
		}
		if (wasRunning && !running) return session ? finishSession(true) : null;
		if (running && session && (
			session.mode === 'write'
			|| (session.mode === 'latch' && !session.gestureActive)
		)) appendSample(session, current, session.lastControlValue);
		return null;
	}

	function resetProject(): void {
		assertActive();
		discardSession(true);
		mode = 'read';
		laneId = null;
		known = authority(ports.captureAuthority());
	}

	function dispose(): void {
		if (disposed) return;
		discardSession(true);
		mode = 'read';
		laneId = null;
		disposed = true;
	}

	function createSession(
		target: SoundscaperAutomationTarget,
		current: SoundscaperAutomationAuthority,
		captureMode: AutomationWriteModeV21,
		phase: AutomationWritePhaseV21,
	): CaptureSession {
		if (current.projectId === null || current.projectRevision === null) {
			throw new Error('Automation capture requires an exact current project.');
		}
		generation = safeIncrement(generation, 'automation gesture generation');
		const controlValue = normalizeControlValue(target.controlValue, target.descriptor);
		return {
			laneId: target.lane.id,
			mode: captureMode,
			lane: target.lane,
			descriptor: target.descriptor,
			projectId: current.projectId,
			projectRevision: current.projectRevision,
			generation,
			samples: [],
			trimAnchor: controlValue,
			lastControlValue: controlValue,
			phase,
			gestureActive: phase === 'gesture',
			ordinal: 0,
		};
	}

	function appendSample(
		activeSession: CaptureSession,
		current: SoundscaperAutomationAuthority,
		controlValue: number,
	): SoundscaperAutomationPreview {
		const frame = nonNegativeFrame(current.positionFrame);
		const laneValue = evaluateAutomationLaneAtFrameV21(activeSession.lane, frame, {
			sampleRate: current.sampleRate,
			...(activeSession.lane.timebase === 'musical-beats' ? { tempoMap: requiredTempoMap(current) } : {}),
		});
		const decision = resolveAutomationWriteModeV21(activeSession.mode, activeSession.phase);
		const trimDelta = controlValue - activeSession.trimAnchor;
		const previewValue = normalizeControlValue(decision.owner === 'control'
			? controlValue
			: decision.owner === 'trimmed-lane' ? laneValue + trimDelta : laneValue, activeSession.descriptor);
		if (decision.capture) {
			const sample = Object.freeze({
				id: `automation-capture-${String(activeSession.generation)}-${String(activeSession.ordinal)}`,
				position: lanePosition(activeSession.lane, frame, current),
				phase: activeSession.phase,
				laneValue,
				controlValue,
				trimDelta,
			});
			activeSession.ordinal = safeIncrement(activeSession.ordinal, 'automation capture ordinal');
			try {
				appendOrReplace(activeSession.samples, sample);
			} catch (error) {
				discardSession(true);
				throw error;
			}
		}
		const preview = Object.freeze({
			laneId: activeSession.laneId,
			mode: activeSession.mode,
			phase: activeSession.phase,
			owner: decision.owner,
			capture: decision.capture,
			frame,
			value: previewValue,
		});
		ports.preview?.(preview);
		return preview;
	}

	function finishSession(accept: boolean): Result | null {
		const completed = session;
		if (!completed) return null;
		session = null;
		if (!accept) {
			ports.restoreReadback?.(completed.lane);
			return null;
		}
		try {
			const capture = commitAutomationWriteModeV21(
				completed.lane,
				completed.mode,
				completed.samples,
				{ descriptor: completed.descriptor },
			);
			if (!capture.changed || !capture.capture) {
				ports.restoreReadback?.(completed.lane);
				return null;
			}
			committing = true;
			try {
				return ports.commit(Object.freeze({
					type: 'automation-lane/set',
					laneId: completed.laneId,
					expected: completed.lane as unknown as Readonly<Record<string, unknown>>,
					lane: capture.capture as unknown as Readonly<Record<string, unknown>>,
				}));
			} finally {
				committing = false;
				known = authority(ports.captureAuthority());
				ports.restoreReadback?.(completed.lane);
			}
		} catch (error) {
			ports.restoreReadback?.(completed.lane);
			throw error;
		}
	}

	function discardSession(restore: boolean): void {
		const discarded = session;
		session = null;
		if (restore && discarded) ports.restoreReadback?.(discarded.lane);
	}

	function resetForAuthority(current: SoundscaperAutomationAuthority, restore: boolean): void {
		discardSession(restore);
		mode = 'read';
		laneId = null;
		known = current;
	}

	function frameAuthority(frame?: number): SoundscaperAutomationAuthority {
		const current = authority(ports.captureAuthority());
		return frame === undefined ? current : Object.freeze({ ...current, positionFrame: nonNegativeFrame(frame) });
	}

	function assertWritableTarget(
		selectedLaneId: string | null,
		current: SoundscaperAutomationAuthority,
		allowReadOnly = false,
	): SoundscaperAutomationTarget {
		const id = requiredLaneId(selectedLaneId);
		if (!allowReadOnly && (current.readOnly || current.lockReadOnly)) {
			throw new Error('Automation capture requires writable project authority.');
		}
		const target = ports.resolveTarget(id);
		if (!target) throw new Error(`Automation lane ${id} is no longer available.`);
		if (!allowReadOnly && target.locked) throw new Error(`Automation lane ${id} belongs to a locked target.`);
		if (target.lane.id !== id) throw new Error('Automation target resolution returned a different lane.');
		return target;
	}

	function assertSessionAuthority(
		activeSession: CaptureSession,
		current: SoundscaperAutomationAuthority,
	): void {
		if (current.projectId !== activeSession.projectId
			|| current.projectRevision !== activeSession.projectRevision
			|| current.readOnly || current.lockReadOnly) {
			discardSession(true);
			throw new Error('Automation gesture authority changed.');
		}
		const target = ports.resolveTarget(activeSession.laneId);
		if (!target || target.locked) {
			discardSession(true);
			throw new Error('Automation gesture target changed.');
		}
	}

	function assertGesture(gestureToken: SoundscaperAutomationGestureToken): CaptureSession {
		if (!session) throw new Error('An active automation gesture is required.');
		assertToken(session, gestureToken);
		if (!session.gestureActive) throw new Error('The automation gesture is no longer active.');
		return session;
	}

	function assertActive(): void {
		if (disposed) throw new Error('The automation session coordinator is disposed.');
	}

	return Object.freeze({
		getSnapshot,
		setMode,
		beginGesture,
		previewGesture,
		releaseGesture,
		cancelGesture,
		synchronize,
		resetProject,
		dispose,
	});
}

function assertPorts<Result>(ports: SoundscaperAutomationSessionPorts<Result>): void {
	if (!ports || typeof ports !== 'object'
		|| typeof ports.captureAuthority !== 'function'
		|| typeof ports.resolveTarget !== 'function'
		|| typeof ports.commit !== 'function') {
		throw new TypeError('Soundscaper automation session ports are required.');
	}
}

function authority(value: SoundscaperAutomationAuthority): SoundscaperAutomationAuthority {
	if (!value || typeof value !== 'object') throw new TypeError('Automation authority is required.');
	const projectId = value.projectId === null ? null : requiredLaneId(value.projectId);
	const projectRevision = value.projectRevision === null ? null : nonNegativeFrame(value.projectRevision);
	if (typeof value.readOnly !== 'boolean' || typeof value.lockReadOnly !== 'boolean') {
		throw new TypeError('Automation write authority flags must be boolean.');
	}
	if (typeof value.transportState !== 'string' || !value.transportState) {
		throw new TypeError('Automation transport state is required.');
	}
	const sampleRate = positiveSafeInteger(value.sampleRate, 'automation sample rate');
	return Object.freeze({
		projectId,
		projectRevision,
		readOnly: value.readOnly,
		lockReadOnly: value.lockReadOnly,
		transportState: value.transportState,
		positionFrame: nonNegativeFrame(value.positionFrame),
		sampleRate,
		...(value.tempoMap === undefined ? {} : { tempoMap: value.tempoMap }),
	});
}

function automationMode(value: unknown): AutomationWriteModeV21 {
	if (value !== 'read' && value !== 'trim' && value !== 'touch' && value !== 'latch' && value !== 'write') {
		throw new RangeError('Automation mode must be read, trim, touch, latch, or write.');
	}
	return value;
}

function optionalLaneId(value: unknown): string | null {
	return value === null || value === undefined ? null : requiredLaneId(value);
}

function requiredLaneId(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new TypeError('An automation lane ID is required.');
	return value;
}

function token(session: CaptureSession): SoundscaperAutomationGestureToken {
	return Object.freeze({
		type: 'soundscaper-automation-gesture-v21',
		laneId: session.laneId,
		generation: session.generation,
	});
}

function assertToken(session: CaptureSession, value: SoundscaperAutomationGestureToken): void {
	if (!value || value.type !== 'soundscaper-automation-gesture-v21'
		|| value.laneId !== session.laneId || value.generation !== session.generation) {
		throw new Error('The automation gesture generation is stale.');
	}
}

function assertSessionLane(session: CaptureSession, laneId: string): void {
	if (session.laneId !== laneId) throw new Error('Only one automation target may own a gesture.');
}

function appendOrReplace(
	samples: AutomationWriteCaptureSampleV21[],
	sample: AutomationWriteCaptureSampleV21,
): void {
	const previous = samples.at(-1);
	if (previous) {
		const order = compareRationals(previous.position, sample.position);
		if (order > 0) {
			throw new RangeError(
				'Automation capture is non-monotonic after a backward seek or loop boundary.',
			);
		}
		if (order === 0) {
			samples[samples.length - 1] = sample;
			return;
		}
	}
	if (samples.length >= AUTOMATION_LANE_MAXIMUM_CAPTURE_POINTS_V21) {
		throw new RangeError('Automation gesture capture exceeded its bounded session-memory limit.');
	}
	samples.push(sample);
}

function lanePosition(
	lane: AutomationLaneV21,
	frame: number,
	current: SoundscaperAutomationAuthority,
): AutomationLanePositionV21 {
	return lane.timebase === 'absolute-samples'
		? frame
		: sampleFrameToBeat(frame, requiredTempoMap(current), current.sampleRate);
}

function requiredTempoMap(current: SoundscaperAutomationAuthority): HoldTempoMap {
	if (!current.tempoMap) throw new TypeError('Musical automation capture requires the authoritative tempo map.');
	return current.tempoMap;
}

function normalizeControlValue(value: unknown, descriptor: ParameterDescriptor): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError('Automation control value must be a finite canonical number.');
	}
	if (value < descriptor.minimum || value > descriptor.maximum) {
		throw new RangeError('Automation control value is outside its parameter range.');
	}
	return value;
}

function transportActive(value: string): boolean {
	return value === 'playing' || value === 'recording';
}

function nonNegativeFrame(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('Automation frame authority must be a non-negative safe integer.');
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function safeIncrement(value: number, name: string): number {
	const next = value + 1;
	if (!Number.isSafeInteger(next)) throw new RangeError(`${name} overflowed.`);
	return next;
}

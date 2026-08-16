/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The renderer-side native audio session: which device is open, which mode is
 * actually running, and what happens when the hardware disappears underneath
 * it. The device inventory it adapts lives in native-audio-inventory.ts, which
 * this module re-exports so callers have one native audio surface.
 *
 * The session owns no device and no path. Main publishes an opaque handle per
 * device and a grant describing what the backend actually gave; the rules kept
 * here are the ones this milestone requires. Requested and granted mode are
 * separate fields, and a denial is answered by a recorded policy or by a user
 * choice rather than by a quiet substitution. Close settles exactly once even
 * when it races an open, and an abort settles its operation once with a typed
 * reason. Input loss while recording commits what was actually read, because a
 * device that vanished did not record silence. A fall back to Web Core is a
 * status change that carries the reason it happened.
 */

import {
	PLATFORM_TRANSFER_HARD_LIMITS, type AbortablePortOperation,
	type AudioTransferFormat, type BoundedAudioChunk, type BoundedPortMessage,
} from '../platform/bounded-transfer.ts';
import type { AudioDeviceOpenRequest, AudioInputStreamPort, AudioOutputStreamPort } from '../platform/audio-device-port.ts';
import { NATIVE_AUDIO_CALIBRATION_LIMITS as LIMITS, NATIVE_AUDIO_MODES, type NativeAudioCalibrationIdentity, type NativeAudioMode } from './native-audio-calibration.ts';
import { adaptNativeAudioInventory, isOpaqueNativeAudioHandle, type NativeAudioDirection, type NativeAudioInventory, type NativeAudioInventoryReport } from './native-audio-inventory.ts';

export {
	NATIVE_AUDIO_DEVICE_ID_PREFIX, NATIVE_AUDIO_MAXIMUM_DEVICES, NATIVE_AUDIO_MAXIMUM_LABEL_LENGTH, adaptNativeAudioInventory,
	isOpaqueNativeAudioHandle, nativeAudioChannelMap, nativeAudioDeviceGroupId, nativeAudioDeviceId,
	type NativeAudioChannel, type NativeAudioDeviceReport, type NativeAudioDirection, type NativeAudioInputRow,
	type NativeAudioInventory, type NativeAudioInventoryReport, type NativeAudioOutputRow, type NativeAudioRejectedDevice,
} from './native-audio-inventory.ts';

export const NATIVE_AUDIO_ACTIVITIES = Object.freeze(['idle', 'recording', 'monitoring', 'playing'] as const);
export const NATIVE_AUDIO_FALLBACK_REASONS = Object.freeze(['output-lost', 'helper-unavailable', 'user-request'] as const);

export type NativeAudioActivity = (typeof NATIVE_AUDIO_ACTIVITIES)[number];
export type NativeAudioFallbackReason = (typeof NATIVE_AUDIO_FALLBACK_REASONS)[number];
export type NativeAudioFailureCode = 'aborted' | 'already-open' | 'closed' | 'contract-violation' | 'device-lost' | 'host-failed' | 'invalid-request' | 'mode-denied' | 'not-open';
export type NativeAudioSessionState = 'closed' | 'opening' | 'open' | 'closing';
export type NativeAudioTransport = 'native' | 'web-core';
export type NativeAudioNegotiation = 'granted' | 'downgraded' | 'awaiting-choice';
export type NativeAudioExclusivePolicy = 'ask' | 'accept-shared' | 'refuse';
export type NativeAudioOutputLossPolicy = 'stop' | 'web-core';
export type NativeAudioLossDisposition = 'ignored' | 'stream-closed' | 'prefix-committed' | 'monitoring-stopped' | 'playback-stopped';

export class NativeAudioSessionError extends Error {
	readonly code: NativeAudioFailureCode;
	constructor(code: NativeAudioFailureCode, message: string) {
		super(message);
		this.name = 'NativeAudioSessionError';
		this.code = code;
	}
}

/** What the backend actually gave, as opposed to what was asked for. */
export type NativeAudioStreamGrant = Readonly<{ backend: string; requestedMode: NativeAudioMode; grantedMode: NativeAudioMode; sampleRate: number; bufferFrames: number; channelCount: number; latencyFrames: number }>;
export type NativeAudioCapturedPrefix = Readonly<{ deviceId: string; frames: number; channelCount: number; sampleRate: number; reason: 'device-lost' }>;
export type NativeAudioEndpointStatus = Readonly<{ deviceId: string; channelCount: number; live: boolean; lost: boolean }>;
export type NativeAudioFallback = Readonly<{ from: 'native'; to: 'web-core'; reason: NativeAudioFallbackReason; backend: string; requestedMode: NativeAudioMode | null; grantedMode: NativeAudioMode | null }>;
export type NativeAudioLossOutcome = Readonly<{ direction: NativeAudioDirection; activity: NativeAudioActivity; disposition: NativeAudioLossDisposition; committedFrames: number; fallback: NativeAudioFallback | null }>;
export type NativeAudioModeChoice = Readonly<{ backend: string; requestedMode: NativeAudioMode; grantedMode: NativeAudioMode }>;
export type NativeAudioModeDecision = Readonly<{ accept: boolean; remember?: boolean }>;
export type NativeAudioSessionStatus = Readonly<{
	state: NativeAudioSessionState; transport: NativeAudioTransport; activity: NativeAudioActivity; backend: string;
	requestedMode: NativeAudioMode | null; grantedMode: NativeAudioMode | null; negotiation: NativeAudioNegotiation | null;
	exclusivePolicy: NativeAudioExclusivePolicy; sampleRate: number; bufferFrames: number; latencyFrames: number;
	capturedFrames: number; input: NativeAudioEndpointStatus; output: NativeAudioEndpointStatus;
	fallback: NativeAudioFallback | null; lastLoss: NativeAudioLossOutcome | null;
}>;
export type NativeAudioSessionOptions = Readonly<{
	host: NativeAudioSessionHostPort; exclusivePolicy?: NativeAudioExclusivePolicy; outputLossPolicy?: NativeAudioOutputLossPolicy;
	onStatus?: (status: NativeAudioSessionStatus) => void; onExclusivePolicy?: (policy: NativeAudioExclusivePolicy) => void;
	commitCapturedPrefix?: (commit: NativeAudioCapturedPrefix) => void;
}>;
export type NativeAudioOpenRequest = Readonly<{
	backend: string; mode: NativeAudioMode; sampleRate: number; bufferFrames: number; channelCount: number;
	inputDeviceId?: string; outputDeviceId?: string; signal?: AbortSignal;
}>;

export interface NativeAudioOpenPortRequest extends AudioDeviceOpenRequest {
	readonly backend: string;
	readonly mode: NativeAudioMode;
	readonly bufferFrames: number;
}
export interface NativeAudioInputStreamPort extends AudioInputStreamPort { readonly grant: NativeAudioStreamGrant }
export interface NativeAudioOutputStreamPort extends AudioOutputStreamPort { readonly grant: NativeAudioStreamGrant }
export interface NativeAudioSessionHostPort {
	enumerate(request: AbortablePortOperation): Promise<BoundedPortMessage<NativeAudioInventoryReport>>;
	openInput(request: NativeAudioOpenPortRequest): Promise<NativeAudioInputStreamPort>;
	openOutput(request: NativeAudioOpenPortRequest): Promise<NativeAudioOutputStreamPort>;
}

type Failure = Readonly<{ status: 'failed'; code: NativeAudioFailureCode; message: string }>;
type StreamPort = NativeAudioInputStreamPort | NativeAudioOutputStreamPort;

export type NativeAudioEnumerateOutcome = Readonly<{ status: 'described'; inventory: NativeAudioInventory }> | Failure;
export type NativeAudioOpenOutcome = Failure
	| Readonly<{ status: 'opened'; session: NativeAudioSessionStatus }>
	| Readonly<{ status: 'choice-required'; choice: NativeAudioModeChoice; session: NativeAudioSessionStatus }>;
export type NativeAudioReadOutcome = Readonly<{ status: 'read'; chunk: BoundedAudioChunk }> | Readonly<{ status: 'ended' }> | Failure;
export type NativeAudioWriteOutcome = Readonly<{ status: 'written' }> | Failure;
export type NativeAudioActivityOutcome = Readonly<{ status: 'started' }> | Failure;

export interface NativeAudioSession {
	status(): NativeAudioSessionStatus;
	enumerate(request?: Readonly<{ signal?: AbortSignal }>): Promise<NativeAudioEnumerateOutcome>;
	open(request: NativeAudioOpenRequest): Promise<NativeAudioOpenOutcome>;
	resolveModeChoice(decision: NativeAudioModeDecision): NativeAudioOpenOutcome;
	beginActivity(activity: NativeAudioActivity): NativeAudioActivityOutcome;
	endActivity(): NativeAudioSessionStatus;
	readInput(request?: Readonly<{ signal?: AbortSignal }>): Promise<NativeAudioReadOutcome>;
	writeOutput(request: Readonly<{ chunk: BoundedAudioChunk; signal?: AbortSignal }>): Promise<NativeAudioWriteOutcome>;
	reportDeviceLoss(request: Readonly<{ direction: NativeAudioDirection }>): NativeAudioLossOutcome;
	fallBackToWebCore(reason: NativeAudioFallbackReason): NativeAudioSessionStatus;
	calibrationIdentity(): Readonly<NativeAudioCalibrationIdentity> | null;
	close(): Promise<void>;
}

export function createNativeAudioSession(options: NativeAudioSessionOptions): NativeAudioSession {
	const host = options?.host;
	if (!host || typeof host.enumerate !== 'function' || typeof host.openInput !== 'function' || typeof host.openOutput !== 'function') {
		throw new TypeError('A native audio session requires an audio device host port.');
	}
	const outputLossPolicy: NativeAudioOutputLossPolicy = options.outputLossPolicy ?? 'stop';
	const controller = new AbortController();
	const pending = new Set<Promise<void>>();
	let exclusivePolicy: NativeAudioExclusivePolicy = options.exclusivePolicy ?? 'ask';
	let input: NativeAudioInputStreamPort | null = null;
	let output: NativeAudioOutputStreamPort | null = null;
	// The admitted grants, never the records the host kept. Everything the
	// session publishes about width, clock and latency is read from these.
	const grants: { input: NativeAudioStreamGrant | null; output: NativeAudioStreamGrant | null } = { input: null, output: null };
	let awaitingChoice: NativeAudioModeChoice | null = null;
	let closing: Promise<void> | null = null;
	const live = {
		state: 'closed' as NativeAudioSessionState, transport: 'native' as NativeAudioTransport,
		activity: 'idle' as NativeAudioActivity, negotiation: null as NativeAudioNegotiation | null,
		requestedMode: null as NativeAudioMode | null, grantedMode: null as NativeAudioMode | null,
		fallback: null as NativeAudioFallback | null, lastLoss: null as NativeAudioLossOutcome | null,
		backend: '', inputDeviceId: '', outputDeviceId: '', inputLost: false, outputLost: false,
		sampleRate: 0, bufferFrames: 0, latencyFrames: 0, capturedFrames: 0,
	};

	return Object.freeze({
		status, enumerate, open, resolveModeChoice, beginActivity, endActivity, readInput,
		writeOutput, reportDeviceLoss, fallBackToWebCore, calibrationIdentity, close });

	function status(): NativeAudioSessionStatus {
		const { inputDeviceId, outputDeviceId, inputLost, outputLost, ...published } = live;
		return Object.freeze({
			...published, exclusivePolicy,
			input: Object.freeze({ deviceId: inputDeviceId, channelCount: grants.input?.channelCount ?? 0, live: Boolean(input), lost: inputLost }),
			output: Object.freeze({ deviceId: outputDeviceId, channelCount: grants.output?.channelCount ?? 0, live: Boolean(output), lost: outputLost }),
		});
	}

	async function enumerate(request: Readonly<{ signal?: AbortSignal }> = {}): Promise<NativeAudioEnumerateOutcome> {
		const settlement = await track(abortable([request.signal, controller.signal], (signal) => host.enumerate({ signal }), () => undefined));
		if (settlement.status !== 'value') return settlementFailure(settlement);
		try {
			return Object.freeze({ status: 'described' as const, inventory: adaptNativeAudioInventory(settlement.value?.payload) });
		} catch (error) {
			return failure(codeOf(error, 'contract-violation'), messageOf(error));
		}
	}

	function open(request: NativeAudioOpenRequest): Promise<NativeAudioOpenOutcome> {
		return track(runOpen(request));
	}

	async function runOpen(request: NativeAudioOpenRequest): Promise<NativeAudioOpenOutcome> {
		if (closing) return failure('closed', 'The native audio session is closed.');
		if (live.state !== 'closed') return failure('already-open', 'This native audio session is already open.');
		let parsed: NativeAudioOpenRequest;
		try {
			parsed = parseOpenRequest(request);
		} catch (error) {
			return failure(codeOf(error, 'invalid-request'), messageOf(error));
		}
		// A session that reopens is running natively again; leaving the previous
		// fallback standing would publish this one as the Web Core it is not.
		Object.assign(live, {
			state: 'opening', backend: parsed.backend, requestedMode: parsed.mode, grantedMode: null, negotiation: null,
			inputDeviceId: parsed.inputDeviceId ?? '', outputDeviceId: parsed.outputDeviceId ?? '',
			capturedFrames: 0, inputLost: false, outputLost: false,
			transport: 'native', fallback: null, lastLoss: null,
		});
		emit();
		if (live.inputDeviceId) {
			const opened = await openStream(parsed, live.inputDeviceId, 'input');
			if (opened.status === 'failed') return abandon(opened);
			input = opened.port as NativeAudioInputStreamPort;
			grants.input = opened.grant;
		}
		if (live.outputDeviceId) {
			const opened = await openStream(parsed, live.outputDeviceId, 'output');
			if (opened.status === 'failed') return abandon(opened);
			output = opened.port as NativeAudioOutputStreamPort;
			grants.output = opened.grant;
		}
		return settleNegotiation(parsed);
	}

	async function openStream(parsed: NativeAudioOpenRequest, deviceId: string, direction: NativeAudioDirection):
	Promise<Readonly<{ status: 'opened'; port: StreamPort; grant: NativeAudioStreamGrant }> | Failure> {
		const format: AudioTransferFormat = Object.freeze({ sampleRate: parsed.sampleRate, channelCount: parsed.channelCount, sampleFormat: 'f32-planar' as const });
		const portRequest = { deviceId, format, maximumChunkFrames: parsed.bufferFrames, backend: parsed.backend, mode: parsed.mode, bufferFrames: parsed.bufferFrames };
		const settlement = await abortable<StreamPort>([parsed.signal, controller.signal],
			(signal) => (direction === 'input'
				? host.openInput({ ...portRequest, signal })
				: host.openOutput({ ...portRequest, signal })),
			(port) => { closeQuietly(port); });
		if (settlement.status !== 'value') return settlementFailure(settlement);
		let grant: NativeAudioStreamGrant;
		try {
			grant = admitGrant(settlement.value?.grant, parsed, direction);
		} catch (error) {
			closeQuietly(settlement.value);
			return failure(codeOf(error, 'contract-violation'), messageOf(error));
		}
		return Object.freeze({ status: 'opened' as const, port: settlement.value, grant });
	}

	/**
	 * The mode the session reports is the one every open stream actually got. A
	 * backend that granted exclusive on one endpoint and shared on the other is
	 * a shared session, because shared is what the user would hear.
	 */
	function settleNegotiation(parsed: NativeAudioOpenRequest): NativeAudioOpenOutcome {
		const admitted = [grants.input, grants.output].filter(Boolean) as readonly NativeAudioStreamGrant[];
		const first = admitted[0];
		if (!first) return abandon(failure('invalid-request', 'A native audio session requires at least one endpoint.'));
		if (admitted.some((grant) => grant.sampleRate !== first.sampleRate || grant.bufferFrames !== first.bufferFrames)) {
			return abandon(failure('contract-violation', 'A native audio session cannot span two clocks or buffer sizes.'));
		}
		live.sampleRate = first.sampleRate;
		live.bufferFrames = first.bufferFrames;
		live.latencyFrames = admitted.reduce((total, grant) => total + grant.latencyFrames, 0);
		live.grantedMode = admitted.every((grant) => grant.grantedMode === 'exclusive') ? 'exclusive' : 'shared';
		if (live.grantedMode === parsed.mode) return finishOpen('granted');
		if (exclusivePolicy === 'refuse') {
			return abandon(failure('mode-denied', 'The requested exclusive mode was denied and the recorded policy refuses sharing.'));
		}
		if (exclusivePolicy === 'accept-shared') return finishOpen('downgraded');
		// No recorded policy: the streams stay open but the session does not,
		// so nothing records or plays in a mode the user has not agreed to.
		live.negotiation = 'awaiting-choice';
		awaitingChoice = Object.freeze({ backend: live.backend, requestedMode: parsed.mode, grantedMode: live.grantedMode });
		emit();
		return Object.freeze({ status: 'choice-required' as const, choice: awaitingChoice, session: status() });
	}

	function finishOpen(outcome: NativeAudioNegotiation): NativeAudioOpenOutcome {
		live.negotiation = outcome;
		live.state = 'open';
		emit();
		return Object.freeze({ status: 'opened' as const, session: status() });
	}

	function resolveModeChoice(decision: NativeAudioModeDecision): NativeAudioOpenOutcome {
		if (!awaitingChoice) return failure('invalid-request', 'No native audio mode choice is pending.');
		// The endpoints the choice was about can vanish while it is on screen.
		// Answering then would open a session that has nothing left to run on.
		if (!input && !output) {
			awaitingChoice = null;
			return abandon(failure('device-lost', 'The native audio device was lost before the mode choice was answered.'));
		}
		const accepted = decision?.accept === true;
		if (decision?.remember === true) {
			exclusivePolicy = accepted ? 'accept-shared' : 'refuse';
			options.onExclusivePolicy?.(exclusivePolicy);
		}
		awaitingChoice = null;
		if (!accepted) return abandon(failure('mode-denied', 'The requested exclusive mode was denied and sharing was declined.'));
		return finishOpen('downgraded');
	}

	function beginActivity(next: NativeAudioActivity): NativeAudioActivityOutcome {
		if (!(NATIVE_AUDIO_ACTIVITIES as readonly string[]).includes(next) || next === 'idle') {
			return failure('invalid-request', 'A native audio activity must be recording, monitoring or playing.');
		}
		if (live.state !== 'open') return failure('not-open', 'No native audio session is open.');
		if (next !== 'playing' && !input) return failure('not-open', 'That native audio activity requires a live input.');
		if (next !== 'recording' && !output) return failure('not-open', 'That native audio activity requires a live output.');
		if (next === 'recording') live.capturedFrames = 0;
		live.activity = next;
		emit();
		return Object.freeze({ status: 'started' as const });
	}

	function endActivity(): NativeAudioSessionStatus {
		if (live.activity === 'idle') return status();
		live.activity = 'idle';
		emit();
		return status();
	}

	async function readInput(request: Readonly<{ signal?: AbortSignal }> = {}): Promise<NativeAudioReadOutcome> {
		if (live.inputLost) return failure('device-lost', 'The native audio input was lost.');
		const port = input;
		if (live.state !== 'open' || !port) return failure('not-open', 'No native audio input is open.');
		const settlement = await track(abortable([request.signal, controller.signal], (signal) => port.read({ signal }), () => undefined));
		if (settlement.status !== 'value') return settlementFailure(settlement);
		if (!settlement.value) return Object.freeze({ status: 'ended' as const });
		// Only frames the caller actually receives count towards the prefix a
		// device loss would commit.
		live.capturedFrames += settlement.value.frameCount;
		return Object.freeze({ status: 'read' as const, chunk: settlement.value });
	}

	async function writeOutput(request: Readonly<{ chunk: BoundedAudioChunk; signal?: AbortSignal }>): Promise<NativeAudioWriteOutcome> {
		if (live.outputLost) return failure('device-lost', 'The native audio output was lost.');
		const port = output;
		if (live.state !== 'open' || !port) return failure('not-open', 'No native audio output is open.');
		if (!request?.chunk) return failure('invalid-request', 'A native audio write requires a bounded chunk.');
		const settlement = await track(abortable([request.signal, controller.signal], (signal) => port.write({ signal, chunk: request.chunk }), () => undefined));
		return settlement.status === 'value' ? Object.freeze({ status: 'written' as const }) : settlementFailure(settlement);
	}

	function reportDeviceLoss(request: Readonly<{ direction: NativeAudioDirection }>): NativeAudioLossOutcome {
		const direction = request?.direction;
		if (direction !== 'input' && direction !== 'output') {
			throw new NativeAudioSessionError('invalid-request', 'A native audio device loss names an input or an output.');
		}
		const at = live.activity;
		const port = direction === 'input' ? input : output;
		if (!port) return loss(direction, at, 'ignored', 0, null);
		const channelCount = grants[direction]?.channelCount ?? 0;
		grants[direction] = null;
		if (direction === 'input') { input = null; live.inputLost = true; } else { output = null; live.outputLost = true; }
		closeQuietly(port);
		const outcome = direction === 'input' ? loseInput(at, channelCount) : loseOutput(at);
		if (!input && !output && live.state !== 'closing') live.state = 'closed';
		emit();
		return outcome;
	}

	/**
	 * The prefix that was read is what the project gets. The session emits no
	 * frames of its own, so a lost input cannot contribute silence it never
	 * captured, and nothing else about the project is touched.
	 */
	function loseInput(at: NativeAudioActivity, channelCount: number): NativeAudioLossOutcome {
		if (at === 'recording') {
			const frames = live.capturedFrames;
			live.activity = 'idle';
			options.commitCapturedPrefix?.(Object.freeze({
				deviceId: live.inputDeviceId, frames, channelCount, sampleRate: live.sampleRate, reason: 'device-lost' as const,
			}));
			return loss('input', at, 'prefix-committed', frames, null);
		}
		if (at === 'monitoring') { live.activity = 'idle'; return loss('input', at, 'monitoring-stopped', 0, null); }
		// Playback is an output path, so losing the input does not interrupt it.
		return loss('input', at, 'stream-closed', 0, null);
	}

	function loseOutput(at: NativeAudioActivity): NativeAudioLossOutcome {
		// A recording in progress keeps its input; only what was audible stops.
		if (at !== 'monitoring' && at !== 'playing') return loss('output', at, 'stream-closed', 0, null);
		live.activity = 'idle';
		if (at === 'monitoring') return loss('output', at, 'monitoring-stopped', 0, null);
		return loss('output', at, 'playback-stopped', 0,
			outputLossPolicy === 'web-core' ? recordFallback('output-lost') : null);
	}

	function fallBackToWebCore(reason: NativeAudioFallbackReason): NativeAudioSessionStatus {
		if (!(NATIVE_AUDIO_FALLBACK_REASONS as readonly string[]).includes(reason)) {
			throw new NativeAudioSessionError('invalid-request', 'A Web Core fallback must name why it happened.');
		}
		recordFallback(reason);
		const port = output;
		output = null;
		grants.output = null;
		closeQuietly(port);
		if (live.activity !== 'recording') live.activity = 'idle';
		if (!input && !output && live.state !== 'closing') live.state = 'closed';
		emit();
		return status();
	}

	function recordFallback(reason: NativeAudioFallbackReason): NativeAudioFallback {
		live.transport = 'web-core';
		live.fallback = Object.freeze({
			from: 'native' as const, to: 'web-core' as const, reason,
			backend: live.backend, requestedMode: live.requestedMode, grantedMode: live.grantedMode,
		});
		return live.fallback;
	}

	function calibrationIdentity(): Readonly<NativeAudioCalibrationIdentity> | null {
		if (live.state !== 'open' || !live.grantedMode || !live.backend) return null;
		return Object.freeze({
			inputDeviceId: live.inputDeviceId, outputDeviceId: live.outputDeviceId, backend: live.backend,
			mode: live.grantedMode, sampleRate: live.sampleRate, bufferFrames: live.bufferFrames,
		});
	}

	function close(): Promise<void> {
		closing ??= runClose();
		return closing;
	}

	async function runClose(): Promise<void> {
		if (live.state !== 'closed') live.state = 'closing';
		awaitingChoice = null;
		emit();
		controller.abort(new NativeAudioSessionError('closed', 'The native audio session closed.'));
		while (pending.size > 0) await Promise.allSettled([...pending]);
		await Promise.allSettled(takePorts().map(closeSafely));
		Object.assign(live, { state: 'closed', activity: 'idle', negotiation: null });
		emit();
	}

	/** Takes both ports out of the session, so each one is closed exactly once. */
	function takePorts(): readonly StreamPort[] {
		const ports = [input, output].filter(Boolean) as readonly StreamPort[];
		input = null; grants.input = null;
		output = null; grants.output = null;
		return ports;
	}

	function abandon(outcome: Failure): Failure {
		for (const port of takePorts()) closeQuietly(port);
		Object.assign(live, { state: 'closed', activity: 'idle', grantedMode: null, negotiation: null });
		awaitingChoice = null;
		emit();
		return outcome;
	}

	function emit(): void {
		try {
			options.onStatus?.(status());
		} catch { /* A status listener must never break device teardown. */ }
	}

	function loss(direction: NativeAudioDirection, at: NativeAudioActivity,
		disposition: NativeAudioLossDisposition, committedFrames: number, chosen: NativeAudioFallback | null): NativeAudioLossOutcome {
		live.lastLoss = Object.freeze({ direction, activity: at, disposition, committedFrames, fallback: chosen });
		return live.lastLoss;
	}

	function closeQuietly(port: StreamPort | null | undefined): void {
		if (port) void track(closeSafely(port));
	}

	/**
	 * The device most likely to fail its own close is the one that has already
	 * been unplugged, and it throws where a healthy port would reject. Neither
	 * may stop the caller: teardown, the loss report and the prefix commit all
	 * run after this and none of them is conditional on the device agreeing.
	 */
	function closeSafely(port: StreamPort): Promise<void> {
		try {
			return port.close({ signal: new AbortController().signal }).catch(() => undefined);
		} catch { return Promise.resolve(); }
	}

	/** Close waits on everything in flight, so no port outlives the session. */
	function track<Value>(work: Promise<Value>): Promise<Value> {
		const settled: Promise<void> = work.then(() => { pending.delete(settled); }, () => { pending.delete(settled); });
		pending.add(settled);
		return work;
	}
}

type FailedSettlement = Readonly<{ status: 'aborted'; error: NativeAudioSessionError } | { status: 'failed'; error: unknown }>;
type Settlement<Value> = Readonly<{ status: 'value'; value: Value }> | FailedSettlement;

/**
 * Settles exactly once. A host answer that arrives after an abort is handed to
 * `discard` instead of resolving a settled operation, so an aborted open cannot
 * leak the device it opened a moment too late.
 */
function abortable<Value>(
	signals: readonly (AbortSignal | undefined)[],
	start: (signal: AbortSignal) => Promise<Value>,
	discard: (value: Value) => void,
): Promise<Settlement<Value>> {
	return new Promise<Settlement<Value>>((resolve) => {
		const controller = new AbortController();
		const detach: (() => void)[] = [];
		let settled = false;
		const finish = (settlement: Settlement<Value>): void => {
			if (settled) return;
			settled = true;
			for (const off of detach) off();
			resolve(settlement);
		};
		for (const signal of signals) {
			if (!signal) continue;
			const onAbort = (): void => {
				controller.abort(signal.reason);
				finish({ status: 'aborted', error: asSessionError(signal.reason) });
			};
			if (signal.aborted) { onAbort(); break; }
			signal.addEventListener('abort', onAbort, { once: true });
			detach.push(() => { signal.removeEventListener('abort', onAbort); });
		}
		if (settled) return;
		void start(controller.signal).then((value) => { if (settled) discard(value); else finish({ status: 'value', value }); },
			(error: unknown) => { finish({ status: 'failed', error }); });
	});
}

function settlementFailure(settlement: FailedSettlement): Failure {
	if (settlement.status === 'aborted') return failure(settlement.error.code, settlement.error.message);
	return failure(codeOf(settlement.error, 'host-failed'), messageOf(settlement.error));
}

function refuse(message: string): never {
	throw new NativeAudioSessionError('invalid-request', message);
}

function parseOpenRequest(request: NativeAudioOpenRequest): NativeAudioOpenRequest {
	if (!request || typeof request !== 'object' || Array.isArray(request)) refuse('A native audio open request must be a plain record.');
	const record = request as Readonly<Record<string, unknown>>;
	const backend = typeof record.backend === 'string' ? record.backend : '';
	if (!backend || backend.length > LIMITS.maximumBackendLength) refuse('A native audio open request must name a bounded backend.');
	if (typeof record.mode !== 'string' || !(NATIVE_AUDIO_MODES as readonly string[]).includes(record.mode)) {
		refuse('A native audio open request must name a shared or exclusive mode.');
	}
	const inputDeviceId = deviceIdOf(record.inputDeviceId);
	const outputDeviceId = deviceIdOf(record.outputDeviceId);
	if (!inputDeviceId && !outputDeviceId) refuse('A native audio open request must name at least one device.');
	return Object.freeze({
		backend, mode: record.mode as NativeAudioMode, inputDeviceId, outputDeviceId, signal: request.signal,
		sampleRate: bounded(record.sampleRate, LIMITS.minimumSampleRate, LIMITS.maximumSampleRate, 'sample rate'),
		bufferFrames: bounded(record.bufferFrames, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames, 'buffer frames'),
		channelCount: bounded(record.channelCount, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels, 'channel count'),
	});
}

/**
 * The port must restate what it was asked for and name what it gave. A port
 * that rewrites the request has substituted a mode on its own, which is exactly
 * the substitution this session exists to prevent.
 */
function admitGrant(value: unknown, parsed: NativeAudioOpenRequest, direction: NativeAudioDirection): NativeAudioStreamGrant {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NativeAudioSessionError('contract-violation', `A native audio ${direction} grant must be a plain record.`);
	}
	const grant = value as Readonly<Record<string, unknown>>;
	if (grant.backend !== parsed.backend || grant.requestedMode !== parsed.mode) {
		throw new NativeAudioSessionError('contract-violation', `A native audio ${direction} grant must restate the request it answers.`);
	}
	if (typeof grant.grantedMode !== 'string' || !(NATIVE_AUDIO_MODES as readonly string[]).includes(grant.grantedMode)) {
		throw new NativeAudioSessionError('contract-violation', `A native audio ${direction} grant must name the mode it granted.`);
	}
	return Object.freeze({
		backend: parsed.backend, requestedMode: parsed.mode, grantedMode: grant.grantedMode as NativeAudioMode,
		sampleRate: bounded(grant.sampleRate, LIMITS.minimumSampleRate, LIMITS.maximumSampleRate, 'granted sample rate'),
		bufferFrames: bounded(grant.bufferFrames, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames, 'granted buffer frames'),
		channelCount: bounded(grant.channelCount, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels, 'granted channel count'),
		latencyFrames: bounded(grant.latencyFrames, 0, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames, 'granted latency'),
	});
}

function failure(code: NativeAudioFailureCode, message: string): Failure {
	return Object.freeze({ status: 'failed' as const, code, message });
}

/**
 * The identifier is republished in the status, in the calibration tuple and in
 * the prefix a lost recording commits, so it is held to the same opacity the
 * inventory holds a handle to. Refusing it here is what keeps a path out of
 * renderer state when the caller did not get its id from the inventory.
 */
function deviceIdOf(value: unknown): string {
	if (value == null || value === '') return '';
	if (typeof value !== 'string' || value.length > LIMITS.maximumDeviceIdLength) refuse('A native audio device identifier must be bounded text.');
	if (!isOpaqueNativeAudioHandle(value)) refuse('A native audio device identifier must be opaque, never a path.');
	return value;
}

function bounded(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		refuse(`A native audio ${label} is outside its admitted bounds.`);
	}
	return value as number;
}

function asSessionError(reason: unknown): NativeAudioSessionError {
	if (reason instanceof NativeAudioSessionError) return reason;
	return new NativeAudioSessionError('aborted', messageOf(reason) || 'The native audio operation was aborted.');
}

function codeOf(error: unknown, fallbackCode: NativeAudioFailureCode): NativeAudioFailureCode {
	return error instanceof NativeAudioSessionError ? error.code : fallbackCode;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

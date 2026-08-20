/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CaptureEncodedVideoPacket } from '../framescaper-capture-domain.ts';

// MediaAssetChunkRecords splits this bounded logical event into 4 MiB physical
// records and acknowledges the complete event atomically in the capture spool.
const DEFAULT_MAXIMUM_PACKET_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAXIMUM_PENDING_EVENTS = 8;
const DEFAULT_TIMESLICE_MS = 1_000;

type VideoRole = 'camera' | 'display';
type RecorderState = 'ready' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'failed' | 'disposed';

interface MediaRecorderEvent {
	readonly data: Blob;
	readonly timecode?: number;
}

interface MediaRecorderErrorEvent {
	readonly error?: unknown;
}

export interface FramescaperMediaRecorderLike {
	readonly mimeType: string;
	readonly state: string;
	ondataavailable: ((event: MediaRecorderEvent) => void) | null;
	onerror: ((event: MediaRecorderErrorEvent) => void) | null;
	onstop: (() => void) | null;
	start(timeslice?: number): void;
	pause(): void;
	resume(): void;
	requestData?(): void;
	stop(): void;
}

interface MediaRecorderConstructor<Recorder extends FramescaperMediaRecorderLike> {
	new(stream: unknown, options?: Readonly<{ mimeType?: string }>): Recorder;
}

export interface FramescaperBrowserVideoRecorderOptions<Recorder extends FramescaperMediaRecorderLike> {
	readonly MediaRecorder: MediaRecorderConstructor<Recorder>;
	readonly stream: unknown;
	readonly sessionId: string;
	readonly streamId: string;
	readonly role: VideoRole;
	readonly selectedMimeType: string;
	readonly maximumPacketBytes?: number;
	readonly maximumPendingEvents?: number;
	readonly timesliceMs?: number;
	readonly receiptTime?: () => number;
	readonly onPacket: (packet: Readonly<CaptureEncodedVideoPacket>) => PromiseLike<void> | void;
	readonly onBackpressure?: (pendingEvents: number) => PromiseLike<void> | void;
	readonly onError?: (error: unknown) => void;
}

export interface FramescaperBrowserVideoRecorder<Recorder extends FramescaperMediaRecorderLike> {
	readonly state: RecorderState;
	readonly mimeType: string;
	/** Exposed as a narrow test/diagnostic port; callers must use this wrapper. */
	readonly mediaRecorder: Recorder;
	start(): void;
	pause(): boolean;
	resume(): boolean;
	stop(): Promise<void>;
	dispose(): Promise<void>;
}

/**
 * Serializes MediaRecorder output into bounded timestamped packets. The
 * session controller owns whole-session backpressure and pause policy.
 */
export function createFramescaperBrowserVideoRecorder<Recorder extends FramescaperMediaRecorderLike>(
	options: FramescaperBrowserVideoRecorderOptions<Recorder>,
): FramescaperBrowserVideoRecorder<Recorder> {
	const maximumPacketBytes = positiveIntegerAtMost(
		options.maximumPacketBytes ?? DEFAULT_MAXIMUM_PACKET_BYTES,
		DEFAULT_MAXIMUM_PACKET_BYTES,
		'Capture video packet byte limit',
	);
	const maximumPendingEvents = positiveIntegerAtMost(
		options.maximumPendingEvents ?? DEFAULT_MAXIMUM_PENDING_EVENTS,
		128,
		'Capture video pending-event limit',
	);
	const timesliceMs = positiveIntegerAtMost(
		options.timesliceMs ?? DEFAULT_TIMESLICE_MS,
		10_000,
		'Capture video timeslice',
	);
	const sessionId = canonicalId(options.sessionId, 'Capture session ID');
	const streamId = canonicalId(options.streamId, 'Capture stream ID');
	if (options.role !== 'camera' && options.role !== 'display') {
		throw new TypeError('Capture video role must be camera or display.');
	}
	if (typeof options.onPacket !== 'function') throw new TypeError('Capture video requires a packet sink.');
	const recorder = new options.MediaRecorder(
		options.stream,
		options.selectedMimeType ? { mimeType: options.selectedMimeType } : undefined,
	);
	const mimeType = canonicalMimeType(recorder.mimeType);
	const receiptTime = options.receiptTime ?? (() => globalThis.performance?.now?.() ?? Date.now());
	let state: RecorderState = 'ready';
	let sequence = 0;
	let previousTimecodeMs = 0;
	let pendingEvents = 0;
	let pressureReported = false;
	let queue = Promise.resolve();
	let failure: unknown = null;
	let failureReported = false;
	let stopPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;

	recorder.ondataavailable = (event) => { void enqueue(event); };
	recorder.onerror = (event) => {
		fail(event.error ?? new Error('The capture video encoder failed.'));
	};

	function start(): void {
		if (state !== 'ready') throw new Error('Capture video recorder can start only once.');
		recorder.start(timesliceMs);
		state = 'recording';
	}

	function pause(): boolean {
		if (state !== 'recording') return false;
		recorder.pause();
		state = 'paused';
		return true;
	}

	function resume(): boolean {
		if (state !== 'paused') return false;
		recorder.resume();
		state = 'recording';
		pressureReported = false;
		return true;
	}

	function stop(): Promise<void> {
		if (stopPromise) return stopPromise;
		if (state === 'disposed') return Promise.resolve();
		if (state === 'ready' || state === 'stopped') {
			state = 'stopped';
			stopPromise = settleQueue();
			return stopPromise;
		}
		state = failure ? 'failed' : 'stopping';
		const stopped = new Promise<void>((resolve) => {
			if (recorder.state === 'inactive') {
				resolve();
				return;
			}
			recorder.onstop = () => { resolve(); };
			try { recorder.requestData?.(); } catch { /* Some recorders flush implicitly. */ }
			try { recorder.stop(); } catch (error) { fail(error); resolve(); }
		});
		stopPromise = stopped
			.then(() => settleQueue())
			.then(() => {
				if (failure) throw failure;
				state = 'stopped';
			}, (error: unknown) => {
				fail(error);
				throw failure;
			});
		return stopPromise;
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposePromise = stop().finally(() => {
			recorder.ondataavailable = null;
			recorder.onerror = null;
			recorder.onstop = null;
			state = 'disposed';
		});
		return disposePromise;
	}

	async function enqueue(event: MediaRecorderEvent): Promise<void> {
		if (state === 'ready' || state === 'stopped' || state === 'disposed' || failure) return;
		if (!(event.data instanceof Blob) || event.data.size === 0) return;
		pendingEvents += 1;
		if (pendingEvents > maximumPendingEvents && !pressureReported) {
			pressureReported = true;
			try {
				if (recorder.state === 'recording') recorder.pause();
				if (state === 'recording') state = 'paused';
				void Promise.resolve(options.onBackpressure?.(pendingEvents)).catch(fail);
			} catch (error) {
				fail(error);
			}
		}
		if (event.data.size > maximumPacketBytes) {
			pendingEvents -= 1;
			fail(new RangeError('Capture video encoder emitted an oversized logical packet.'));
			return;
		}
		const reportedTimecodeMs = finiteTimecode(event.timecode, previousTimecodeMs + timesliceMs);
		const eventTimecodeMs = reportedTimecodeMs > previousTimecodeMs
			? reportedTimecodeMs
			: previousTimecodeMs + timesliceMs;
		const presentationTimeUs = millisecondsToMicroseconds(previousTimecodeMs);
		const durationUs = millisecondsToMicroseconds(Math.max(0, eventTimecodeMs - previousTimecodeMs));
		previousTimecodeMs = Math.max(previousTimecodeMs, eventTimecodeMs);
		queue = queue.then(async () => {
			const bytes = new Uint8Array(await event.data.arrayBuffer());
			if (bytes.byteLength < 1 || bytes.byteLength > maximumPacketBytes) {
				throw new RangeError('Capture video encoder emitted an invalid bounded packet.');
			}
			const packet: CaptureEncodedVideoPacket = Object.freeze({
				kind: 'encoded-video', sessionId, streamId, role: options.role,
				sequence: sequence++,
				presentationTimeUs,
				durationUs,
				receiptTimeMs: finiteReceiptTime(receiptTime()),
				droppedBefore: Object.freeze({ value: null, confidence: 'unavailable' }),
				byteLength: bytes.byteLength,
				bytes,
				mimeType,
				keyFrame: null,
			});
			await options.onPacket(packet);
		}).catch((error: unknown) => {
			fail(error);
			throw error;
		}).finally(() => {
			pendingEvents -= 1;
		});
		// Mark this promise handled; stop/dispose still observe the retained queue.
		void queue.catch(() => undefined);
	}

	async function settleQueue(): Promise<void> {
		await queue;
		if (failure) throw failure;
	}

	function fail(error: unknown): void {
		failure ??= error instanceof Error ? error : new Error(String(error || 'Capture video encoder failed.'));
		if (state !== 'disposed') state = 'failed';
		if (!failureReported) {
			failureReported = true;
			options.onError?.(failure);
		}
	}

	return Object.freeze({
		get state(): RecorderState { return state; },
		mimeType,
		mediaRecorder: recorder,
		start,
		pause,
		resume,
		stop,
		dispose,
	});
}

function positiveIntegerAtMost(value: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(`${name} must be between 1 and ${String(maximum)}.`);
	}
	return value;
}

function canonicalId(value: string, name: string): string {
	if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

function canonicalMimeType(value: string): string {
	if (typeof value !== 'string' || !value || value.length > 256 || !/^video\//u.test(value)) {
		throw new TypeError('The capture video recorder did not report an actual video MIME type.');
	}
	return value;
}

function finiteTimecode(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finiteReceiptTime(value: number): number {
	if (!Number.isFinite(value) || value < 0) throw new RangeError('Capture receipt time must be finite and non-negative.');
	return value;
}

function millisecondsToMicroseconds(value: number): number {
	const result = Math.round(value * 1_000);
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError('Capture video time exceeds the safe range.');
	return result;
}

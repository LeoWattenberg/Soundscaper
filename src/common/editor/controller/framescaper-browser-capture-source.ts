/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCaptureRuntimeAvailability,
	type CaptureRuntimeAvailability,
} from '../framescaper-capture-domain.ts';
import type {
	CapturePreviewLease,
	CapturePreviewSource,
	CaptureSourcePortV1,
} from '../platform/capture-source-port.ts';

const VIDEO_MIME_CANDIDATES = Object.freeze([
	'video/webm;codecs=vp9',
	'video/webm;codecs=vp8',
	'video/webm',
	'video/mp4;codecs=avc1.42E01E',
	'video/mp4',
]);

export type BrowserCaptureSourceRole = 'camera' | 'microphone' | 'display' | 'system-audio';

export interface BrowserCaptureTrack {
	readonly id?: string;
	readonly kind: string;
	readonly label?: string;
	getCapabilities?(): Readonly<Record<string, unknown>>;
	getSettings?(): Readonly<Record<string, unknown>>;
	stop(): void;
}

export interface BrowserCaptureStream {
	getTracks(): readonly BrowserCaptureTrack[];
	getAudioTracks(): readonly BrowserCaptureTrack[];
	getVideoTracks(): readonly BrowserCaptureTrack[];
}

interface BrowserCaptureDevice {
	readonly deviceId?: string;
	readonly kind?: string;
	readonly label?: string;
}

interface BrowserCaptureMediaDevices {
	getUserMedia?(constraints: Readonly<Record<string, unknown>>): Promise<BrowserCaptureStream>;
	getDisplayMedia?(constraints: Readonly<Record<string, unknown>>): Promise<BrowserCaptureStream>;
	enumerateDevices?(): Promise<readonly BrowserCaptureDevice[]>;
}

export interface BrowserCaptureSourceDescriptor extends CapturePreviewSource<BrowserCaptureStream, BrowserCaptureTrack> {
	readonly sourceId: string;
	readonly role: BrowserCaptureSourceRole;
	readonly track: BrowserCaptureTrack;
	readonly stream: BrowserCaptureStream;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly capabilities: Readonly<Record<string, unknown>>;
}

export interface BrowserCapturePreviewLease extends CapturePreviewLease<BrowserCaptureStream, BrowserCaptureTrack> {
	readonly sources: readonly BrowserCaptureSourceDescriptor[];
	dispose(): Promise<void>;
}

export interface BrowserCapturePreviewRequest {
	readonly signal: AbortSignal;
	readonly userActionGeneration: number;
	readonly roles: readonly BrowserCaptureSourceRole[];
	readonly cameraDeviceId?: string;
	readonly microphoneDeviceId?: string;
	readonly cameraConstraints?: Readonly<Record<string, unknown>>;
	readonly microphoneConstraints?: Readonly<Record<string, unknown>>;
	readonly displayConstraints?: Readonly<Record<string, unknown>>;
}

export interface BrowserCaptureSourcePortDependencies {
	readonly mediaDevices?: BrowserCaptureMediaDevices | null;
	readonly consumeUserAction: (generation: number) => boolean;
	readonly createStream?: (tracks: readonly BrowserCaptureTrack[]) => BrowserCaptureStream;
}

interface MediaRecorderCapability {
	isTypeSupported(mimeType: string): boolean;
}

export function selectFramescaperVideoMimeType(
	mediaRecorder: MediaRecorderCapability | null | undefined,
): string | null {
	if (!mediaRecorder || typeof mediaRecorder.isTypeSupported !== 'function') return null;
	for (const candidate of VIDEO_MIME_CANDIDATES) {
		if (mediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	// An empty MIME type deliberately requests the user agent's advertised
	// default. The instantiated recorder's mimeType remains authoritative.
	return '';
}

export function createBrowserFramescaperCaptureSourcePort(
	dependencies: BrowserCaptureSourcePortDependencies,
): CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack> {
	const mediaDevices = dependencies.mediaDevices;
	const createStream = dependencies.createStream ?? ((tracks) => {
		if (typeof globalThis.MediaStream !== 'function') {
			throw new Error('MediaStream construction is unavailable in this runtime.');
		}
		return new globalThis.MediaStream([...tracks] as unknown as MediaStreamTrack[]) as unknown as BrowserCaptureStream;
	});

	return Object.freeze({
		probe({ signal, embedded }: Readonly<{ signal: AbortSignal; embedded: boolean }>): Promise<CaptureRuntimeAvailability> {
			throwIfAborted(signal);
			if (embedded) return Promise.resolve(createCaptureRuntimeAvailability({
				status: 'unavailable', reason: 'embedded-route', detail: null,
			}));
			const roles: BrowserCaptureSourceRole[] = [];
			if (typeof mediaDevices?.getUserMedia === 'function') roles.push('camera', 'microphone');
			if (typeof mediaDevices?.getDisplayMedia === 'function') roles.push('display', 'system-audio');
			return Promise.resolve(roles.length
				? createCaptureRuntimeAvailability({ status: 'available', sourceRoles: roles })
				: createCaptureRuntimeAvailability({
					status: 'unavailable', reason: 'media-devices-unavailable', detail: null,
				}));
		},
		async enumerate(request: Readonly<{ signal: AbortSignal; permissionGranted: boolean }>) {
			throwIfAborted(request.signal);
			if (!request.permissionGranted) return Object.freeze({ devices: Object.freeze([]) });
			if (typeof mediaDevices?.enumerateDevices !== 'function') {
				throw new Error('Capture device enumeration is unavailable in this runtime.');
			}
			const devices = await mediaDevices.enumerateDevices();
			throwIfAborted(request.signal);
			return Object.freeze({
				devices: Object.freeze(devices.flatMap((device) => {
					const kind = device.kind === 'audioinput'
						? 'microphone'
						: device.kind === 'videoinput' ? 'camera' : null;
					const id = typeof device.deviceId === 'string' ? device.deviceId : '';
					if (!kind || !id) return [];
					return [Object.freeze({
						id,
						kind,
						label: typeof device.label === 'string' ? device.label : '',
					})];
				})),
			});
		},
		async openPreview(requestValue: BrowserCapturePreviewRequest): Promise<BrowserCapturePreviewLease> {
			const request = normalizePreviewRequest(requestValue);
			throwIfAborted(request.signal);
			if (!dependencies.consumeUserAction(request.userActionGeneration)) {
				throw new Error('Capture preview requires a fresh direct user action.');
			}
			const openedStreams: BrowserCaptureStream[] = [];
			try {
				let displayStream: BrowserCaptureStream | null = null;
				if (request.roles.includes('display')) {
					if (typeof mediaDevices?.getDisplayMedia !== 'function') {
						throw new Error('Display capture is unavailable in this runtime.');
					}
					displayStream = await mediaDevices.getDisplayMedia({
						...request.displayConstraints,
						video: true,
						audio: true,
						selfBrowserSurface: 'exclude',
						systemAudio: 'include',
						windowAudio: 'system',
					});
					openedStreams.push(displayStream);
					throwIfAborted(request.signal);
				}

				let userStream: BrowserCaptureStream | null = null;
				if (request.roles.includes('camera') || request.roles.includes('microphone')) {
					if (typeof mediaDevices?.getUserMedia !== 'function') {
						throw new Error('Camera and microphone capture are unavailable in this runtime.');
					}
					userStream = await mediaDevices.getUserMedia({
						video: request.roles.includes('camera')
							? deviceConstraints(request.cameraConstraints, request.cameraDeviceId)
							: false,
						audio: request.roles.includes('microphone')
							? deviceConstraints({
								echoCancellation: false,
								noiseSuppression: false,
								autoGainControl: false,
								...request.microphoneConstraints,
							}, request.microphoneDeviceId)
							: false,
					});
					openedStreams.push(userStream);
					throwIfAborted(request.signal);
				}

				const camera = request.roles.includes('camera')
					? requiredTrack(userStream?.getVideoTracks(), 'camera')
					: null;
				const microphone = request.roles.includes('microphone')
					? requiredTrack(userStream?.getAudioTracks(), 'microphone')
					: null;
				const display = request.roles.includes('display')
					? requiredTrack(displayStream?.getVideoTracks(), 'display')
					: null;
				const systemAudio = displayStream?.getAudioTracks()[0] ?? null;
				const selected = [
					camera ? descriptor('camera', camera, createStream) : null,
					microphone ? descriptor('microphone', microphone, createStream) : null,
					display ? descriptor('display', display, createStream) : null,
					systemAudio ? descriptor('system-audio', systemAudio, createStream) : null,
				].filter((value): value is BrowserCaptureSourceDescriptor => Boolean(value));
				let disposed = false;
				return Object.freeze({
					sources: Object.freeze(selected),
					async dispose() {
						if (disposed) return;
						disposed = true;
						stopStreams(openedStreams);
					},
				});
			} catch (error) {
				stopStreams(openedStreams);
				throw error;
			}
		},
	});
}

function normalizePreviewRequest(request: BrowserCapturePreviewRequest): BrowserCapturePreviewRequest {
	if (!request || typeof request !== 'object') throw new TypeError('A capture preview request is required.');
	if (!(request.signal instanceof AbortSignal)) throw new TypeError('Capture preview requires an AbortSignal.');
	if (!Number.isSafeInteger(request.userActionGeneration) || request.userActionGeneration < 1) {
		throw new TypeError('Capture preview requires a positive user-action generation.');
	}
	if (!Array.isArray(request.roles) || request.roles.length < 1) {
		throw new TypeError('Capture preview requires at least one source role.');
	}
	const roles = Object.freeze([...new Set(request.roles)]);
	if (roles.length !== request.roles.length
		|| roles.some((role) => !['camera', 'microphone', 'display', 'system-audio'].includes(role))) {
		throw new TypeError('Capture preview source roles must be unique and supported.');
	}
	if (roles.includes('system-audio') && !roles.includes('display')) {
		throw new TypeError('System audio is available only with display capture.');
	}
	return Object.freeze({ ...request, roles });
}

function deviceConstraints(
	constraints: Readonly<Record<string, unknown>> | undefined,
	deviceId: string | undefined,
) {
	const result: Record<string, unknown> = { ...(constraints ?? {}) };
	if (typeof deviceId === 'string' && deviceId) result.deviceId = { exact: deviceId };
	return Object.freeze(result);
}

function requiredTrack(
	tracks: readonly BrowserCaptureTrack[] | undefined,
	role: BrowserCaptureSourceRole,
): BrowserCaptureTrack {
	const selected = tracks?.[0];
	if (!selected) throw new Error(`The capture runtime did not return the required ${role} track.`);
	return selected;
}

function descriptor(
	role: BrowserCaptureSourceRole,
	track: BrowserCaptureTrack,
	createStream: (tracks: readonly BrowserCaptureTrack[]) => BrowserCaptureStream,
): BrowserCaptureSourceDescriptor {
	return Object.freeze({
		sourceId: typeof track.id === 'string' && track.id ? track.id : role,
		role,
		track,
		stream: createStream([track]),
		settings: frozenRecord(track.getSettings?.()),
		capabilities: frozenRecord(track.getCapabilities?.()),
	});
}

function frozenRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
	return Object.freeze(structuredClone(value) as Record<string, unknown>);
}

function stopStreams(streams: readonly BrowserCaptureStream[]): void {
	const stopped = new Set<BrowserCaptureTrack>();
	for (const stream of streams) {
		for (const track of stream.getTracks()) {
			if (stopped.has(track)) continue;
			stopped.add(track);
			try { track.stop(); } catch { /* A revoked track may already be stopped. */ }
		}
	}
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw signal.reason ?? new DOMException('Capture aborted.', 'AbortError');
}

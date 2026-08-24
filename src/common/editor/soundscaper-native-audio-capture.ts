/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Browser recording APIs require a MediaStream-shaped lease, while native
 * capture already arrives as an AudioNode in the engine's AudioContext. This
 * registry keeps the lease pathless and routes the exact node directly into
 * recording/meter graphs; its MediaStream tracks are lifecycle tokens only.
 */

interface CaptureStream extends MediaStream {
	clone(): MediaStream;
}

interface CaptureRoute {
	readonly sessionId: string;
	readonly context: BaseAudioContext;
	readonly node: AudioNode;
	readonly stream: CaptureStream;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly deviceId: string;
	readonly leases: Set<MediaStream>;
	readonly listeners: Set<(reason: string) => void>;
	active: boolean;
	revoked: boolean;
}

const leases = new WeakMap<MediaStream, CaptureRoute>();
let route: CaptureRoute | null = null;

export function claimSoundscaperNativeAudioCapture(value: Readonly<{
	sessionId: string;
	context: AudioContext;
	node: AudioNode;
	channelCount: number;
	sampleRate: number;
	deviceId?: string;
}>): Readonly<{ activate(): void; revoke(reason?: string): void }> {
	const destination = value.context.createMediaStreamDestination?.();
	if (!destination?.stream?.clone) {
		throw new Error('This AudioContext cannot expose a native capture lifecycle stream.');
	}
	if (route && !route.revoked) revoke(route, 'replaced');
	configureChannels(value.node, value.channelCount);
	const claimed: CaptureRoute = {
		sessionId: value.sessionId,
		context: value.context,
		node: value.node,
		stream: destination.stream as CaptureStream,
		channelCount: boundedChannelCount(value.channelCount),
		sampleRate: boundedSampleRate(value.sampleRate),
		deviceId: value.deviceId ?? 'default',
		leases: new Set(),
		listeners: new Set(),
		active: false,
		revoked: false,
	};
	route = claimed;
	return Object.freeze({
		activate(): void { if (!claimed.revoked) claimed.active = true; },
		revoke(reason = 'device-loss'): void { revoke(claimed, reason); },
	});
}

/** Returns null only when no bound native input owns the default route. */
export function acquireSoundscaperNativeAudioCapture(options: Readonly<{
	deviceId?: unknown;
	channelCount?: unknown;
	sampleRate?: unknown;
}> = {}): MediaStream | null {
	const current = route;
	if (!current?.active || current.revoked || !isSelectedDevice(options.deviceId, current.deviceId)) return null;
	const requestedChannels = boundedChannelCount(options.channelCount ?? 1);
	if (requestedChannels > current.channelCount) {
		throw new RangeError(`Native capture exposes ${current.channelCount} channels, not ${requestedChannels}.`);
	}
	if (options.sampleRate != null && boundedSampleRate(options.sampleRate) !== current.sampleRate) {
		throw new RangeError(`Native capture is bound at ${current.sampleRate} Hz.`);
	}
	const stream = current.stream.clone();
	current.leases.add(stream);
	leases.set(stream, current);
	return stream;
}

export function soundscaperNativeAudioCaptureSource(
	stream: MediaStream,
	context: BaseAudioContext,
): AudioNode | null {
	const current = leases.get(stream);
	return current && current.active && !current.revoked && current.context === context
		? current.node
		: null;
}

export function soundscaperNativeAudioCaptureChannelCount(stream: MediaStream): number | null {
	const current = leases.get(stream);
	return current && !current.revoked ? current.channelCount : null;
}

export function soundscaperNativeAudioCaptureHasActiveLease(): boolean {
	const current = route;
	if (!current?.active || current.revoked) return false;
	for (const stream of current.leases) {
		const tracks = stream.getTracks?.() ?? [];
		if (tracks.length > 0 && tracks.every((track) => track.readyState === 'ended')) {
			current.leases.delete(stream);
			leases.delete(stream);
		}
	}
	return current.leases.size > 0;
}

export function subscribeSoundscaperNativeAudioCaptureLoss(
	stream: MediaStream,
	listener: (reason: string) => void,
): () => void {
	const current = leases.get(stream);
	if (!current || current.revoked) {
		queueMicrotask(() => listener('device-loss'));
		return () => undefined;
	}
	current.listeners.add(listener);
	return () => current.listeners.delete(listener);
}

function revoke(current: CaptureRoute, reason: string): void {
	if (current.revoked) return;
	current.revoked = true;
	current.active = false;
	if (route === current) route = null;
	for (const listener of current.listeners) {
		try { listener(reason); } catch { /* observers cannot delay revocation */ }
	}
	current.listeners.clear();
	for (const stream of current.leases) {
		for (const track of stream.getTracks?.() ?? []) {
			try { track.stop(); } catch { /* already ended */ }
		}
	}
	current.leases.clear();
}

function configureChannels(node: AudioNode, value: unknown): void {
	const channelCount = boundedChannelCount(value);
	node.channelCount = channelCount;
	node.channelCountMode = 'explicit';
	node.channelInterpretation = 'discrete';
}

function boundedChannelCount(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 32) {
		throw new RangeError('Native capture channel count must be between 1 and 32.');
	}
	return Number(value);
}

function boundedSampleRate(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 8_000 || Number(value) > 768_000) {
		throw new RangeError('Native capture sample rate is outside its supported range.');
	}
	return Number(value);
}

function isSelectedDevice(value: unknown, deviceId: string): boolean {
	return value == null || value === '' || value === 'default' || value === deviceId;
}

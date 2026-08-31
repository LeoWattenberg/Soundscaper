/* SPDX-License-Identifier: AGPL-3.0-only */

export type FramescaperVideoProxyModeRetime = 'original' | 'proxy' | 'auto';
export type FramescaperVideoProxyTrustRetime = 'unavailable' | 'verified' | 'offline-verified';
export type FramescaperVideoProxyPurposeRetime = 'preview' | 'export' | 'delivery';

export const FRAMESCAPER_VIDEO_PROXY_ADAPTIVE_POLICY_RETIME = Object.freeze({
	minimumDroppedFrameRatio: 0.02,
	minimumDecodeQueueDepth: 2,
	maximumViewportScale: 0.5,
});

export interface FramescaperVideoProxyPressureRetime {
	readonly droppedFrameRatio: number;
	readonly decodeQueueDepth: number;
	readonly viewportScale: number;
}

export interface FramescaperVideoProxyUseRequestRetime {
	readonly purpose: FramescaperVideoProxyPurposeRetime;
	readonly mode: FramescaperVideoProxyModeRetime;
	readonly originalAvailable: boolean;
	readonly proxyTrust: FramescaperVideoProxyTrustRetime;
	readonly pressure: FramescaperVideoProxyPressureRetime | null;
}

export type FramescaperVideoProxyUseRetime = Readonly<{
	readonly kind: 'original' | 'proxy' | 'unavailable';
	readonly reason:
		| 'delivery-original'
		| 'delivery-original-unavailable'
		| 'original-mode'
		| 'original-unavailable'
		| 'proxy-mode'
		| 'proxy-unavailable'
		| 'adaptive-pressure'
		| 'auto-original'
		| 'auto-unavailable';
	readonly offline: boolean;
}>;

/** Select source-domain pictures before any occurrence retime is evaluated. */
export function resolveFramescaperVideoProxyUseRetime(
	requestValue: FramescaperVideoProxyUseRequestRetime | unknown,
): FramescaperVideoProxyUseRetime {
	const request = snapshotRequest(requestValue);
	const offline = !request.originalAvailable;
	if (request.purpose !== 'preview') {
		return Object.freeze(request.originalAvailable
			? { kind: 'original', reason: 'delivery-original', offline }
			: { kind: 'unavailable', reason: 'delivery-original-unavailable', offline });
	}
	const proxyAvailable = request.proxyTrust !== 'unavailable';
	if (request.mode === 'original') {
		return Object.freeze(request.originalAvailable
			? { kind: 'original', reason: 'original-mode', offline }
			: { kind: 'unavailable', reason: 'original-unavailable', offline });
	}
	if (request.mode === 'proxy') {
		return Object.freeze(proxyAvailable
			? { kind: 'proxy', reason: 'proxy-mode', offline }
			: { kind: 'unavailable', reason: 'proxy-unavailable', offline });
	}
	if (proxyAvailable && (offline || underPressure(request.pressure))) {
		return Object.freeze({
			kind: 'proxy',
			reason: offline ? 'proxy-mode' : 'adaptive-pressure',
			offline,
		});
	}
	return Object.freeze(request.originalAvailable
		? { kind: 'original', reason: 'auto-original', offline }
		: { kind: 'unavailable', reason: 'auto-unavailable', offline });
}

function underPressure(pressure: FramescaperVideoProxyPressureRetime | null): boolean {
	return Boolean(pressure && (
		pressure.droppedFrameRatio >= FRAMESCAPER_VIDEO_PROXY_ADAPTIVE_POLICY_RETIME.minimumDroppedFrameRatio
		|| pressure.decodeQueueDepth >= FRAMESCAPER_VIDEO_PROXY_ADAPTIVE_POLICY_RETIME.minimumDecodeQueueDepth
		|| pressure.viewportScale <= FRAMESCAPER_VIDEO_PROXY_ADAPTIVE_POLICY_RETIME.maximumViewportScale
	));
}

function snapshotRequest(value: unknown): Readonly<FramescaperVideoProxyUseRequestRetime> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A Framescaper retime proxy-use request is required.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	const fields = ['purpose', 'mode', 'originalAvailable', 'proxyTrust', 'pressure'] as const;
	assertClosed(record, fields, 'Framescaper retime proxy-use request');
	if (record.purpose !== 'preview' && record.purpose !== 'export' && record.purpose !== 'delivery') {
		throw new RangeError('The Framescaper retime proxy-use purpose is unsupported.');
	}
	if (record.mode !== 'original' && record.mode !== 'proxy' && record.mode !== 'auto') {
		throw new RangeError('The Framescaper retime proxy preview mode is unsupported.');
	}
	if (typeof record.originalAvailable !== 'boolean') {
		throw new TypeError('The Framescaper retime original availability must be boolean.');
	}
	if (record.proxyTrust !== 'unavailable' && record.proxyTrust !== 'verified'
		&& record.proxyTrust !== 'offline-verified') {
		throw new RangeError('The Framescaper retime proxy trust state is unsupported.');
	}
	return Object.freeze({
		purpose: record.purpose,
		mode: record.mode,
		originalAvailable: record.originalAvailable,
		proxyTrust: record.proxyTrust,
		pressure: pressure(record.pressure),
	});
}

function pressure(value: unknown): Readonly<FramescaperVideoProxyPressureRetime> | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper retime adaptive proxy pressure must be a record or null.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	const fields = ['droppedFrameRatio', 'decodeQueueDepth', 'viewportScale'] as const;
	assertClosed(record, fields, 'Framescaper retime adaptive proxy pressure');
	const droppedFrameRatio = finite(record.droppedFrameRatio, 'dropped-frame ratio');
	const decodeQueueDepth = finite(record.decodeQueueDepth, 'decode queue depth');
	const viewportScale = finite(record.viewportScale, 'viewport scale');
	if (droppedFrameRatio < 0 || droppedFrameRatio > 1 || !Number.isSafeInteger(decodeQueueDepth)
		|| decodeQueueDepth < 0 || viewportScale <= 0 || viewportScale > 1) {
		throw new RangeError('Framescaper retime adaptive proxy pressure is outside its bounds.');
	}
	return Object.freeze({ droppedFrameRatio, decodeQueueDepth, viewportScale });
}

function assertClosed(
	value: Readonly<Record<string, unknown>>,
	fields: readonly string[],
	name: string,
): void {
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be closed.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own data property.`);
		}
	}
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`Framescaper retime proxy ${name} must be finite.`);
	}
	return value;
}

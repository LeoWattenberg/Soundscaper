/* SPDX-License-Identifier: AGPL-3.0-only */
/** Closed wire vocabulary. No project metadata, local paths or storage capabilities belong in control packets. */
export const MOTION_LINK_WIRE_OFFER_BYTES = 32 * 1024 * 1024;
export const MOTION_LINK_WIRE_CHUNK_BYTES = 4 * 1024 * 1024;
export type MotionLinkRequest =
	| Readonly<{ kind: 'offer-start'; byteLength: number }>
	| Readonly<{ kind: 'offer-chunk'; offset: number; bytes: ArrayBuffer }>
	| Readonly<{ kind: 'publish' }>
	| Readonly<{ kind: 'asset-open'; digest: string }>
	| Readonly<{ kind: 'asset-next'; offset: number }>
	| Readonly<{ kind: 'asset-close' }>;
export type MotionLinkResponse = Readonly<{ kind: 'ack' }> | Readonly<{ kind: 'published'; digest: string }>
	| Readonly<{ kind: 'asset-size'; byteLength: number }>
	| Readonly<{ kind: 'asset-chunk'; offset: number; bytes: ArrayBuffer | null }>;
export type MotionLinkPacket = Readonly<{ protocol: 'motion-link-port'; version: 1; session: string }> & (
	Readonly<{ type: 'request'; id: number; request: MotionLinkRequest }>
	| Readonly<{ type: 'response'; id: number; response: MotionLinkResponse }>
	| Readonly<{ type: 'close' }>);

export function motionLinkNonce(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Motion link session must be a 256-bit nonce.'); return value;
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError('Malformed Motion link packet.');
	return value as Record<string, unknown>;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Motion link packet number is outside its range.'); return value;
}
function chunk(value: unknown): ArrayBuffer {
	if (!(value instanceof ArrayBuffer) || value.byteLength < 1 || value.byteLength > MOTION_LINK_WIRE_CHUNK_BYTES || Reflect.get(value, 'resizable') === true) throw new RangeError('Motion link packet chunk exceeds its fixed byte bound.'); return value;
}
function request(value: unknown): MotionLinkRequest {
	const kind: unknown = value && typeof value === 'object' ? Reflect.get(value, 'kind') : null;
	if (kind === 'offer-start') { const r = record(value, ['kind', 'byteLength']); return { kind, byteLength: integer(r.byteLength, MOTION_LINK_WIRE_OFFER_BYTES, 1) }; }
	if (kind === 'offer-chunk') { const r = record(value, ['kind', 'offset', 'bytes']); return { kind, offset: integer(r.offset, MOTION_LINK_WIRE_OFFER_BYTES), bytes: chunk(r.bytes) }; }
	if (kind === 'asset-open') { const r = record(value, ['kind', 'digest']); return { kind, digest: motionLinkNonce(r.digest) }; }
	if (kind === 'asset-next') { const r = record(value, ['kind', 'offset']); return { kind, offset: integer(r.offset) }; }
	if (kind === 'publish' || kind === 'asset-close') { record(value, ['kind']); return { kind }; }
	throw new TypeError('Unsupported Motion link request.');
}
function response(value: unknown): MotionLinkResponse {
	const kind: unknown = value && typeof value === 'object' ? Reflect.get(value, 'kind') : null;
	if (kind === 'ack') { record(value, ['kind']); return { kind }; }
	if (kind === 'published') { const r = record(value, ['kind', 'digest']); return { kind, digest: motionLinkNonce(r.digest) }; }
	if (kind === 'asset-size') { const r = record(value, ['kind', 'byteLength']); return { kind, byteLength: integer(r.byteLength) }; }
	if (kind === 'asset-chunk') { const r = record(value, ['kind', 'offset', 'bytes']); return { kind, offset: integer(r.offset), bytes: r.bytes === null ? null : chunk(r.bytes) }; }
	throw new TypeError('Unsupported Motion link response.');
}
export function normalizeMotionLinkPacket(value: unknown, session: string): MotionLinkPacket {
	const type: unknown = value && typeof value === 'object' ? Reflect.get(value, 'type') : null;
	const r = record(value, type === 'close' ? ['protocol', 'version', 'session', 'type'] : ['protocol', 'version', 'session', 'type', 'id', type === 'request' ? 'request' : 'response']);
	if (r.protocol !== 'motion-link-port' || r.version !== 1 || motionLinkNonce(r.session) !== session) throw new TypeError('Motion link protocol/version/session mismatch.');
	const base = { protocol: 'motion-link-port' as const, version: 1 as const, session };
	if (type === 'close') return { ...base, type };
	if (type === 'request') return { ...base, type, id: integer(r.id, Number.MAX_SAFE_INTEGER, 1), request: request(r.request) };
	if (type === 'response') return { ...base, type, id: integer(r.id, Number.MAX_SAFE_INTEGER, 1), response: response(r.response) };
	throw new TypeError('Unsupported Motion link packet.');
}
export function motionLinkPacketTransfers(packet: MotionLinkPacket): ArrayBuffer[] {
	const bytes = packet.type === 'request' && packet.request.kind === 'offer-chunk' ? packet.request.bytes : packet.type === 'response' && packet.response.kind === 'asset-chunk' ? packet.response.bytes : null;
	return bytes ? [bytes] : [];
}

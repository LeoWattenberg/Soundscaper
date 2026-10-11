/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { MOTION_DELIVERY_CHUNK_BYTES, type MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
export async function dispatchMotionscaperDeliveryCall(authority: MotionDesktopDelivery, method: unknown, payload: unknown): Promise<unknown> {
	if (typeof method !== 'string') throw new Error('Unsupported Motionscaper delivery method.');
	if (method === 'getProfile') { record(payload, []); return authority.getProfile(); }
	if (method === 'begin') {
		const request = record(payload, ['plan', 'suggestedName']);
		if (typeof request.suggestedName !== 'string' || request.suggestedName.length > 512) throw new Error('Invalid Motionscaper delivery name.');
		return authority.begin({ plan: normalizeMotionRenderPlan(request.plan), suggestedName: request.suggestedName });
	}
	if (method === 'write') {
		const request = record(payload, ['token', 'offset', 'bytes']);
		if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength < 1 || request.bytes.byteLength > MOTION_DELIVERY_CHUNK_BYTES) throw new Error('Motionscaper delivery chunk exceeds its bridge limit.');
		return authority.write({ token: token(request.token), offset: integer(request.offset), bytes: request.bytes });
	}
	if (method === 'commit') {
		const request = record(payload, ['token', 'byteLength', 'sha256']);
		if (typeof request.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(request.sha256)) throw new Error('Invalid Motionscaper delivery digest.');
		return authority.commit({ token: token(request.token), byteLength: integer(request.byteLength), sha256: request.sha256 });
	}
	if (method === 'cancel') { const request = record(payload, ['token']); return authority.cancel({ token: token(request.token) }); }
	throw new Error('Unsupported Motionscaper delivery method.');
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error('Motionscaper delivery payload fields are not closed.'); return value as Record<string, unknown>;
}
function token(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new Error('Invalid Motionscaper delivery token.'); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Motionscaper delivery offset or length.'); return value; }

/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { MOTION_DELIVERY_CHUNK_BYTES, type MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
import { motionNativePcmPlan } from '../src/common/editor/motion-native-pcm-carrier-v1.ts';
export async function dispatchMotionscaperDeliveryCall(authority: MotionDesktopDelivery, method: unknown, payload: unknown): Promise<unknown> {
	if (typeof method !== 'string') throw new Error('Unsupported Motionscaper delivery method.');
	if (method === 'getProfile') { record(payload, []); return authority.getProfile(); }
	if (method === 'begin') {
		const request = record(payload, ['plan', 'suggestedName'], ['audio']);
		if (typeof request.suggestedName !== 'string' || request.suggestedName.length > 512) throw new Error('Invalid Motionscaper delivery name.');
		const plan = normalizeMotionRenderPlan(request.plan);
		const audio = request.audio === undefined ? null : record(request.audio, ['sampleRate', 'channels']);
		const pcm = audio ? motionNativePcmPlan(plan, { sampleRate: integer(audio.sampleRate), channels: integer(audio.channels) as 1 | 2 }) : null;
		return authority.begin({ plan, suggestedName: request.suggestedName, ...(pcm ? { audio: { sampleRate: pcm.sampleRate, channels: pcm.channels } } : {}) });
	}
	if (method === 'write') {
		const request = record(payload, ['token', 'offset', 'bytes'], ['stream']);
		if (request.stream !== undefined && request.stream !== 'audio') throw new Error('Unsupported Motionscaper delivery stream.');
		if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength < 1 || request.bytes.byteLength > MOTION_DELIVERY_CHUNK_BYTES) throw new Error('Motionscaper delivery chunk exceeds its bridge limit.');
		return authority.write({ token: token(request.token), offset: integer(request.offset), bytes: request.bytes, ...(request.stream ? { stream: request.stream } : {}) });
	}
	if (method === 'commit') {
		const request = record(payload, ['token', 'byteLength', 'sha256'], ['audio']);
		const audio = request.audio === undefined ? null : record(request.audio, ['byteLength', 'sha256', 'sampleCount']);
		return authority.commit({ token: token(request.token), byteLength: integer(request.byteLength), sha256: digest(request.sha256),
			...(audio ? { audio: { byteLength: integer(audio.byteLength), sha256: digest(audio.sha256), sampleCount: integer(audio.sampleCount) } } : {}) });
	}
	if (method === 'cancel') { const request = record(payload, ['token']); return authority.cancel({ token: token(request.token) }); }
	throw new Error('Unsupported Motionscaper delivery method.');
}
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !keys.every(key => Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) throw new Error('Motionscaper delivery payload fields are not closed.'); return value as Record<string, unknown>;
}
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) throw new Error('Invalid Motionscaper delivery digest.'); return value; }
function token(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new Error('Invalid Motionscaper delivery token.'); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Motionscaper delivery offset or length.'); return value; }

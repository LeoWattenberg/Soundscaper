/* SPDX-License-Identifier: AGPL-3.0-only */

import { generateAudioEditorSignal } from './generators.js';

export interface GeneratedWorkerSignal {
	readonly type: string;
	readonly sampleRate: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly channels: readonly Float32Array[];
}

export type SignalGeneratorResponse = Readonly<{
	type: 'result'; requestId: string; result: GeneratedWorkerSignal;
}> | Readonly<{
	type: 'error'; requestId: string | null; error: Readonly<{ name: string; message: string }>;
}>;

export function executeSignalGeneratorRequest(value: unknown): SignalGeneratorResponse {
	let requestId: string | null = null;
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A generator request is required.');
		const request = value as Record<string, unknown>;
		if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 160) {
			throw new TypeError('A bounded generator request id is required.');
		}
		requestId = request.requestId;
		if (request.type !== 'generate-signal/v1' || typeof request.generator !== 'string') {
			throw new TypeError('Unsupported generator request.');
		}
		if (!request.options || typeof request.options !== 'object' || Array.isArray(request.options)) {
			throw new TypeError('Generator options must be an object.');
		}
		return { type: 'result', requestId, result: generateAudioEditorSignal(request.generator, request.options) as GeneratedWorkerSignal };
	} catch (error) {
		return { type: 'error', requestId, error: {
			name: error instanceof Error ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
		} };
	}
}

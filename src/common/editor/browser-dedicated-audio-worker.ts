/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	decodeDedicatedAudioFile,
	encodeDedicatedAudioPcm,
	type DedicatedAudioDecodeRequest,
	type DedicatedAudioEncodeRequest,
} from './browser-dedicated-audio-codec.ts';

type WorkerRequest = Readonly<{
	readonly id: number; readonly operation: 'encode'; readonly request: DedicatedAudioEncodeRequest;
}> | Readonly<{
	readonly id: number; readonly operation: 'decode'; readonly request: DedicatedAudioDecodeRequest;
}>;

interface WorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
	postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', ({ data }) => {
	void execute(data);
});

async function execute(message: WorkerRequest): Promise<void> {
	const id = message?.id;
	try {
		if (!Number.isSafeInteger(id) || !message.request || typeof message.request !== 'object') {
			throw new TypeError('The dedicated audio worker request is malformed.');
		}
		if (message.operation === 'encode') {
			const bytes = await encodeDedicatedAudioPcm(message.request);
			scope.postMessage({ id, status: 'ok', operation: 'encode', bytes: bytes.buffer }, [bytes.buffer]);
		} else if (message.operation === 'decode') {
			const decoded = await decodeDedicatedAudioFile(message.request);
			scope.postMessage({
				id,
				status: 'ok',
				operation: 'decode',
				bytes: decoded.interleaved.buffer,
				frameCount: decoded.frameCount,
				channelCount: decoded.channelCount,
				sampleRate: decoded.sampleRate,
			}, [decoded.interleaved.buffer]);
		} else {
			throw new TypeError('The dedicated audio worker operation is unsupported.');
		}
	} catch (error) {
		const failure = error instanceof Error ? error : new Error(String(error));
		const code = (failure as Error & { readonly code?: unknown }).code;
		scope.postMessage({
			id,
			status: 'error',
			name: failure.name,
			message: failure.message,
			...(typeof code === 'string' ? { code } : {}),
		}, []);
	}
}

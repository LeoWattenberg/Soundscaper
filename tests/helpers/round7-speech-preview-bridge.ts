/* SPDX-License-Identifier: AGPL-3.0-only */

/** A normal installed Kokoro response with authenticated, playable mono speech bytes. */
export function createRound7SpeechPreviewBridge(installDesktop = false): Readonly<Record<string, unknown>> {
	const sampleRate = 24_000;
	const frameCount = sampleRate * 2;
	const bytes = new Uint8Array(44 + frameCount * 2);
	const view = new DataView(bytes.buffer);
	const word = (offset: number, value: string): void => {
		for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
	};
	word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE');
	word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
	view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
	word(36, 'data'); view.setUint32(40, frameCount * 2, true);
	for (let frame = 0; frame < frameCount; frame += 1) {
		view.setInt16(44 + frame * 2, Math.round(0.2 * 32767 * Math.sin(2 * Math.PI * 220 * frame / sampleRate)), true);
	}
	const wave = new Blob([bytes], { type: 'audio/wav' });
	const hash = async (): Promise<string> => Array.from(new Uint8Array(
		await crypto.subtle.digest('SHA-256', await wave.arrayBuffer()),
	)).map(value => value.toString(16).padStart(2, '0')).join('');
	const model = Object.freeze({ modelId: 'kokoro-82m', version: '1.0.0', task: 'text-to-speech',
		artifactSha256s: Object.freeze(['a'.repeat(64)]) });
	let nextJob = 100;
	const localAssistance = Object.freeze({
		models: async () => [model],
		createJob: async () => ({ contractVersion: 1, jobId: (nextJob++).toString(16).padStart(40, '0') }),
		stageInput: async (request: Readonly<Record<string, unknown>>) => {
			if (!(request.bytes instanceof Blob)) throw new Error('The speech input needs its actual text body.');
			return { claimVersion: 1, claimId: 'b'.repeat(40), jobId: request.jobId,
				role: request.role, mediaType: request.mediaType, byteLength: request.bytes.size, sha256: request.sha256 };
		},
		reserveOutput: async (request: Readonly<Record<string, unknown>>) => ({
			claimVersion: 1, claimId: 'c'.repeat(40), jobId: request.jobId,
			role: request.role, mediaType: request.mediaType, maximumByteLength: request.maximumByteLength,
		}),
		run: async (request: Readonly<Record<string, unknown>>) => ({
			contractVersion: 1, jobId: request.jobId, operation: request.operation, outcome: 'completed',
			result: { contractVersion: 1, jobId: request.jobId, operation: request.operation,
				outputs: [{ claimVersion: 1, claimId: 'c'.repeat(40), jobId: request.jobId,
					role: 'synthesized-audio', mediaType: 'audio/wav', byteLength: wave.size, sha256: await hash() }] },
		}),
		cancel: async (jobId: string) => ({ contractVersion: 1, jobId, outcome: 'not-active' }),
		readOutput: async () => wave,
		release: async () => true,
		onProgress: () => () => undefined,
	});
	const scope = globalThis as typeof globalThis & { soundscaperDesktop?: { readonly v1?: Readonly<Record<string, unknown>> } };
	const bridge = Object.freeze({ ...scope.soundscaperDesktop?.v1, localAssistance,
		listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null,
			models: [{ modelId: model.modelId, version: model.version, task: model.task,
				availability: 'installed', downloadBytes: 4096, installedBytes: 4096, attributionRequired: true }] }),
	});
	if (installDesktop) Object.defineProperty(scope, 'soundscaperDesktop', {
		configurable: true, value: Object.freeze({ v1: bridge }),
	});
	return bridge;
}

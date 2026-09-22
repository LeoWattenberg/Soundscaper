/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-owned source-free speech job; a reviewed result is valid only in this session. */

import { resolveLocalAssistanceBridge } from '../../assistance/local-assistance-bridge.ts';
import { KOKORO_VOICES_BY_LANGUAGE, isKokoroLanguage, isKokoroVoiceForLanguage } from
	'../../assistance/kokoro-voices-v1.ts';
import { inspectWavBlobPcm } from '../../wav-import.js';
import type { TextToSpeechPort, TextToSpeechProjectPort, TextToSpeechRequest, TextToSpeechReviewed } from '../text-to-speech-port.ts';

export type { TextToSpeechProjectPort } from '../../assistance/text-to-speech-port-contract.ts';

const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const MAXIMUM_TEXT_CODE_UNITS = 10_000;

export function createTextToSpeechPort(
	bridgeScope: unknown,
	projectPort: TextToSpeechProjectPort | null,
): TextToSpeechPort | null {
	const bridge = resolveLocalAssistanceBridge(bridgeScope);
	if (!bridge || !projectPort) return null;
	const pending = new WeakSet<TextToSpeechReviewed>();
	const voices = Object.freeze(Object.entries(KOKORO_VOICES_BY_LANGUAGE).flatMap(([language, names]) =>
		names.map((id) => Object.freeze({ id, language, label: id }))));
	return Object.freeze({
		async load() {
			const [models, initial] = await Promise.all([bridge.models(), projectPort.loadInitial()]);
			return Object.freeze({ installed: models.some(({ task }) => task === 'text-to-speech'),
				voices, initial, placement: initial ? 'regenerate-selected' as const : 'new-track' as const });
		},
		async generate(request: TextToSpeechRequest, signal: AbortSignal): Promise<TextToSpeechReviewed> {
			if (!isKokoroLanguage(request.language)
				|| !isKokoroVoiceForLanguage(request.language, request.voiceId)
				|| typeof request.text !== 'string' || !request.text.trim()
				|| request.text.length > MAXIMUM_TEXT_CODE_UNITS
				|| /[\p{Cc}\p{Cf}]/u.test(request.text.replaceAll('\n', ''))
				|| !Number.isFinite(request.speed) || request.speed < 0.5 || request.speed > 2) {
				throw new TypeError('Text-to-speech settings are invalid.');
			}
			if (signal.aborted) throw signal.reason;
			const model = (await bridge.models()).find(({ task }) => task === 'text-to-speech');
			if (!model) throw new Error('Install the Kokoro speech model before generating audio.');
			const { jobId } = await bridge.createJob();
			const abort = (): void => { void bridge.cancel(jobId).catch(() => undefined); };
			signal.addEventListener('abort', abort, { once: true });
			try {
				if (signal.aborted) throw signal.reason;
				const bytes = new Blob([request.text], { type: 'text/plain' });
				const input = await bridge.stageInput({ jobId, role: 'text', mediaType: 'text/plain',
					byteLength: bytes.size, bytes });
				const output = await bridge.reserveOutput({ jobId, role: 'synthesized-audio',
					mediaType: 'audio/wav', maximumByteLength: MAXIMUM_OUTPUT_BYTES });
				if (signal.aborted) throw signal.reason;
				const outcome = await bridge.run({ contractVersion: 1, jobId,
					operation: 'text-to-speech', selectionFence: null,
					settings: { settingsVersion: 1, language: request.language,
						voice: request.voiceId, speed: request.speed },
					models: [{ modelId: model.modelId, version: model.version,
						artifactSha256s: model.artifactSha256s }],
					inputs: [input], outputs: [output] });
				if (signal.aborted) throw signal.reason;
				if (outcome.outcome !== 'completed') {
					throw new Error(`Text-to-speech is unavailable: ${outcome.outcome === 'unavailable'
						? outcome.reason : outcome.outcome}.`);
				}
				const claim = outcome.result.outputs[0];
				if (outcome.result.outputs.length !== 1 || !claim
					|| claim.role !== 'synthesized-audio' || claim.mediaType !== 'audio/wav') {
					throw new TypeError('The speech job returned an unexpected output.');
				}
				const audio = await bridge.readOutput({ jobId, claim });
				const wav = await inspectWavBlobPcm(audio) as Readonly<{
					sampleRate: number; channelCount: number; frameCount: number; sampleFormat: string;
				}>;
				if (wav.sampleRate !== 24_000 || wav.channelCount !== 1
					|| wav.frameCount < 1 || !['int16', 'float32'].includes(wav.sampleFormat)) {
					throw new TypeError('The speech WAV has invalid audio geometry.');
				}
				if (signal.aborted) throw signal.reason;
				const reviewed = Object.freeze({ audio, request: Object.freeze({ ...request }),
					modelId: model.modelId, modelVersion: model.version,
					artifactSha256s: Object.freeze([...model.artifactSha256s].sort()) });
				pending.add(reviewed);
				return reviewed;
			} finally {
				signal.removeEventListener('abort', abort);
				await bridge.release(jobId);
			}
		},
		async accept(reviewed: TextToSpeechReviewed): Promise<void> {
			if (!pending.has(reviewed)) throw new TypeError('Only this dialog’s reviewed speech may be accepted.');
			await projectPort.accept(reviewed);
			pending.delete(reviewed);
		},
	});
}

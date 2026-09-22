/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU ONNX Kokoro v1.0 synthesis from offline phoneme chunks. */

import { readFile } from 'node:fs/promises';

import {
	isKokoroLanguage,
	isKokoroVoiceForLanguage,
	type KokoroLanguage,
	type KokoroVoice,
} from '../src/common/editor/assistance/kokoro-voices-v1.ts';
import {
	assertAssistanceOnnxCpuJobV1,
	createAssistanceOnnxCpuSessionV1,
	publishAssistanceOnnxOutputV1,
	reviewAssistanceOnnxRuntimeModuleV1,
} from './assistance-onnx-worker-common.ts';
import type {
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import {
	AssistanceRuntimeFamilyAdapterUnavailableError,
	type AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import type { AssistanceRuntimeFamilyModelGrantV1 } from './assistance-runtime-family-job-contract.ts';

type RuntimeLoader = (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;

export interface KokoroPhonemizeRequestV1 {
	readonly language: KokoroLanguage;
	readonly voice: KokoroVoice;
	readonly text: string;
	readonly signal?: AbortSignal;
}

/** The port must use a separately authenticated offline G2P runtime. */
export type KokoroOfflinePhonemizerV1 = (
	request: KokoroPhonemizeRequestV1,
) => PromiseLike<readonly string[]>;

const MODEL_ID = 'kokoro-82m-v1.0';
const MODEL_VERSION = '1.0.0';
const INPUT_NAMES = Object.freeze(['input_ids', 'style', 'speed']);
const OUTPUT_NAMES = Object.freeze(['waveform']);
const SAMPLE_RATE = 24_000;
const WAV_HEADER_BYTES = 44;
const MAXIMUM_TEXT_BYTES = 64 * 1024;
const MAXIMUM_CHUNKS = 128;
const MAXIMUM_TOKENS = 510;
const MAXIMUM_WAV_BYTES = 128 * 1024 * 1024;
const STYLE_DIMENSIONS = 256;
const RUNTIME_ERRORS = Object.freeze({
	value: 'The Kokoro ONNX runtime is invalid.',
	surface: 'The Kokoro ONNX runtime surface is invalid.',
});
const SESSION_ERRORS = Object.freeze({
	value: 'The Kokoro ONNX session is invalid.',
	surface: 'The Kokoro ONNX session surface is invalid.',
});

export function createAssistanceOnnxKokoroWorkerAdapterV1(
	loadRuntime: RuntimeLoader,
	phonemize?: KokoroOfflinePhonemizerV1,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function'
		|| phonemize !== undefined && typeof phonemize !== 'function') {
		throw new TypeError('The Kokoro runtime and offline phonemizer ports are invalid.');
	}
	return async (context) => executeKokoro(context, loadRuntime, phonemize);
}

async function executeKokoro(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
	phonemize: KokoroOfflinePhonemizerV1 | undefined,
): Promise<unknown> {
	assertAssistanceOnnxCpuJobV1(context, 'text-to-speech',
		'The Kokoro adapter received a foreign authenticated CPU job.');
	const { language, voice, speed, models } = reviewRequest(context);
	if (!phonemize) throw new AssistanceRuntimeFamilyAdapterUnavailableError();
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const [textBytes, vocabularyBytes, voiceBytes] = await Promise.all([
		readFile(context.grant.inputs[0]!.path),
		readFile(models.vocabulary.path),
		readFile(models.voice.path),
	]);
	context.signal?.throwIfAborted();
	const text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes).trim();
	if (!text || text.includes('\0')) throw new TypeError('Kokoro needs nonempty UTF-8 text.');
	const vocabulary = reviewVocabulary(vocabularyBytes);
	const phonemeChunks = reviewPhonemeChunks(await phonemize({
		language, voice, text, signal: context.signal,
	}), vocabulary);
	const styleRows = reviewVoiceStyles(voiceBytes);
	const tokenChunks = phonemeChunks.map((chunk) => {
		const ids = Array.from(chunk, (symbol) => vocabulary.get(symbol)!);
		if (ids.length >= styleRows.length) {
			throw new RangeError('The Kokoro voice has no style row for a phoneme chunk.');
		}
		return ids;
	});
	context.signal?.throwIfAborted();
	const runtime = reviewAssistanceOnnxRuntimeModuleV1(
		await loadRuntime(context.job.descriptor.entrypoint), RUNTIME_ERRORS,
	);
	const session = await createAssistanceOnnxCpuSessionV1(
		runtime, models.network.path, SESSION_ERRORS,
	);
	const chunks: Float32Array[] = [];
	let samples = 0;
	try {
		assertNames(session.inputNames, INPUT_NAMES, 'input');
		assertNames(session.outputNames, OUTPUT_NAMES, 'output');
		for (const [index, tokens] of tokenChunks.entries()) {
			context.signal?.throwIfAborted();
			const ids = BigInt64Array.from([0, ...tokens, 0].map(BigInt));
			const style = styleRows[indexStyleRow(tokens.length, styleRows)]!;
			const output = await session.run({
				input_ids: new runtime.Tensor('int64', ids, [1, ids.length]),
				style: new runtime.Tensor('float32', style, [1, STYLE_DIMENSIONS]),
				speed: new runtime.Tensor('float32', Float32Array.of(speed), [1]),
			});
			const audio = reviewWaveform(output);
			samples += audio.length;
			if (WAV_HEADER_BYTES + samples * 2 > context.grant.outputs[0]!.maximumByteLength
				|| WAV_HEADER_BYTES + samples * 2 > MAXIMUM_WAV_BYTES) {
				throw new RangeError('Kokoro audio exceeds its authenticated output reservation.');
			}
			chunks.push(audio);
			context.onProgress((index + 1) / (tokenChunks.length + 1));
		}
		return await publishAssistanceOnnxOutputV1(context,
			() => encodePcm16Wave(chunks, samples),
			'Kokoro audio exceeds its authenticated output reservation.',
			{ exactOutputCount: 1 });
	} finally {
		await session.release?.();
	}
}

function reviewRequest(context: AssistanceRuntimeFamilyWorkerExecutionContext): {
	readonly language: KokoroLanguage;
	readonly voice: KokoroVoice;
	readonly speed: number;
	readonly models: Readonly<Record<'network' | 'vocabulary' | 'voice', AssistanceRuntimeFamilyModelGrantV1>>;
} {
	const { grant, settings } = context;
	const input = grant.inputs[0];
	const output = grant.outputs[0];
	if (grant.inputs.length !== 1 || input?.role !== 'text' || input.mediaType !== 'text/plain'
		|| input.byteLength < 1 || input.byteLength > MAXIMUM_TEXT_BYTES
		|| grant.outputs.length !== 1 || output?.role !== 'synthesized-audio'
		|| output.mediaType !== 'audio/wav'
		|| output.maximumByteLength < WAV_HEADER_BYTES + 2
		|| output.maximumByteLength > MAXIMUM_WAV_BYTES) {
		throw new TypeError('Kokoro requires one bounded text input and one WAV output.');
	}
	if (settings.schemaVersion !== 1 || settings.operation !== 'text-to-speech'
		|| JSON.stringify(settings.inputRoles) !== '["text"]'
		|| JSON.stringify(settings.outputRoles) !== '["synthesized-audio"]'
		|| !isKokoroLanguage(settings.language)
		|| !isKokoroVoiceForLanguage(settings.language, settings.voice)
		|| typeof settings.speed !== 'number' || !Number.isFinite(settings.speed)
		|| settings.speed < 0.5 || settings.speed > 2) {
		throw new TypeError('Kokoro settings need one published language, voice, and bounded speed.');
	}
	const models = grant.models;
	const roles = ['network', 'vocabulary', `voice-${settings.voice}`];
	if (models.length !== roles.length || models.some(({ modelId, version, artifactRole }) =>
		modelId !== MODEL_ID || version !== MODEL_VERSION || !roles.includes(artifactRole))
		|| new Set(models.map(({ artifactRole }) => artifactRole)).size !== roles.length) {
		throw new TypeError('Kokoro needs its exact graph, vocabulary, and selected voice artifacts.');
	}
	return {
		language: settings.language,
		voice: settings.voice,
		speed: settings.speed,
		models: Object.freeze({
			network: models.find(({ artifactRole }) => artifactRole === 'network')!,
			vocabulary: models.find(({ artifactRole }) => artifactRole === 'vocabulary')!,
			voice: models.find(({ artifactRole }) => artifactRole === `voice-${settings.voice}`)!,
		}),
	};
}

function reviewVocabulary(bytes: Uint8Array): ReadonlyMap<string, number> {
	if (bytes.byteLength < 2 || bytes.byteLength > 256 * 1024) {
		throw new RangeError('The Kokoro vocabulary byte length is invalid.');
	}
	const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)
		|| !Object.hasOwn(decoded, 'model')) {
		throw new TypeError('The Kokoro vocabulary is invalid.');
	}
	const model = (decoded as { model: unknown }).model;
	if (!model || typeof model !== 'object' || Array.isArray(model)
		|| !Object.hasOwn(model, 'vocab')) {
		throw new TypeError('The Kokoro tokenizer model is invalid.');
	}
	const vocab = (model as { vocab: unknown }).vocab;
	if (!vocab || typeof vocab !== 'object' || Array.isArray(vocab)) {
		throw new TypeError('The Kokoro vocabulary map is invalid.');
	}
	if ((vocab as Record<string, unknown>)['$'] !== 0) {
		throw new TypeError('The Kokoro tokenizer pad token is invalid.');
	}
	const entries = Object.entries(vocab).filter(([symbol]) => symbol !== '$');
	if (entries.length < 3 || entries.length > 512 || entries.some(([symbol, id]) =>
		Array.from(symbol).length !== 1 || !Number.isSafeInteger(id) || Number(id) < 1
		|| Number(id) > 1_024)) {
		throw new TypeError('The Kokoro vocabulary entries are invalid.');
	}
	return new Map(entries as [string, number][]);
}

function reviewPhonemeChunks(
	value: unknown,
	vocabulary: ReadonlyMap<string, number>,
): readonly string[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_CHUNKS
		|| value.some((chunk) => typeof chunk !== 'string' || chunk.length < 1
			|| Array.from(chunk).length > MAXIMUM_TOKENS
			|| Array.from(chunk).some((symbol) => !vocabulary.has(symbol)))) {
		throw new TypeError('The offline Kokoro phonemizer returned invalid vocabulary chunks.');
	}
	return Object.freeze([...value] as string[]);
}

function reviewVoiceStyles(bytes: Uint8Array): readonly Float32Array[] {
	const rowBytes = STYLE_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT;
	if (bytes.byteLength < 2 * rowBytes || bytes.byteLength % rowBytes !== 0
		|| bytes.byteLength > 1_024 * rowBytes) {
		throw new RangeError('The Kokoro voice style blob is invalid.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const styles: Float32Array[] = [];
	for (let offset = 0; offset < bytes.byteLength; offset += rowBytes) {
		const row = new Float32Array(STYLE_DIMENSIONS);
		for (let index = 0; index < STYLE_DIMENSIONS; index += 1) {
			const sample = view.getFloat32(offset + index * 4, true);
			if (!Number.isFinite(sample)) throw new TypeError('The Kokoro voice contains a nonfinite style.');
			row[index] = sample;
		}
		styles.push(row);
	}
	return styles;
}

function indexStyleRow(length: number, rows: readonly Float32Array[]): number {
	if (length < 1 || length >= rows.length) {
		throw new RangeError('The Kokoro voice has no style row for the token count.');
	}
	return length;
}

function reviewWaveform(value: Readonly<Record<string, AssistanceOnnxTensorV1>>): Float32Array {
	if (Object.keys(value).length !== 1) throw new TypeError('The Kokoro ONNX output is ambiguous.');
	const output = value.waveform;
	if (output?.type !== 'float32' || !(output.data instanceof Float32Array)
		|| output.data.length < 1 || output.data.length > SAMPLE_RATE * 120
		|| JSON.stringify(output.dims) !== JSON.stringify([1, output.data.length])
		|| output.data.some((sample) => !Number.isFinite(sample))) {
		throw new TypeError('The Kokoro ONNX waveform is invalid.');
	}
	return output.data;
}

function assertNames(actual: readonly string[], expected: readonly string[], label: string): void {
	if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
		throw new TypeError(`The Kokoro ONNX ${label} graph signature is invalid.`);
	}
}

function encodePcm16Wave(chunks: readonly Float32Array[], samples: number): Uint8Array {
	const output = Buffer.alloc(WAV_HEADER_BYTES + samples * 2);
	output.write('RIFF', 0, 'ascii');
	output.writeUInt32LE(output.byteLength - 8, 4);
	output.write('WAVEfmt ', 8, 'ascii');
	output.writeUInt32LE(16, 16);
	output.writeUInt16LE(1, 20);
	output.writeUInt16LE(1, 22);
	output.writeUInt32LE(SAMPLE_RATE, 24);
	output.writeUInt32LE(SAMPLE_RATE * 2, 28);
	output.writeUInt16LE(2, 32);
	output.writeUInt16LE(16, 34);
	output.write('data', 36, 'ascii');
	output.writeUInt32LE(samples * 2, 40);
	let offset = WAV_HEADER_BYTES;
	for (const chunk of chunks) {
		for (const value of chunk) {
			const clamped = Math.max(-1, Math.min(1, value));
			output.writeInt16LE(Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767), offset);
			offset += 2;
		}
	}
	return output;
}

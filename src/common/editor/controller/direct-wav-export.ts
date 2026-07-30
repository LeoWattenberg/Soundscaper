/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = PromiseLike<Value> | Value;

export const DIRECT_WAV_MAXIMUM_FILE_BYTES = 65 * 1024 ** 3;

const WAV_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'WAV audio',
	accept: Object.freeze({ 'audio/wav': Object.freeze(['.wav']) }),
})]);

interface DirectWavPlan {
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputs?: unknown;
	readonly render?: Readonly<{ readonly strategy?: unknown }>;
}

interface PreparedWavStream {
	readonly mode: 'stream';
	createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>>;
	bytesWritten(): number;
	commit(): Awaitable<Readonly<Record<string, unknown>>>;
	abort(reason?: unknown): Awaitable<unknown>;
}

interface WavEncoder {
	write(channels: readonly Float32Array[]): unknown;
	finalize(): unknown;
}

export interface DirectWavDestination {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<void>;
	abort(reason?: unknown): Promise<void>;
	bytesWritten(): number;
	commit(): Promise<Readonly<Record<string, unknown>>>;
}

export interface DirectWavEncoder {
	write(channels: readonly Float32Array[]): Promise<void>;
	finalize(): Promise<number>;
}

export type DirectWavPreparation = Readonly<{
	cancelled: Readonly<Record<string, unknown>> | null;
	destination: DirectWavDestination | null;
}>;

export async function prepareDirectWavDestination(
	fileService: Readonly<{
		prepareSave?: (request: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	}>,
	plan: DirectWavPlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectWavPreparation> {
	if (!directWavPlan(plan) || typeof fileService.prepareSave !== 'function') return emptyPreparation();
	const fileName = String((plan.outputs as readonly Readonly<{ fileName?: unknown }>[])[0]?.fileName || 'mix.wav');
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio-pcm-mix',
		suggestedName: fileName,
		mimeType: String(plan.mimeType || 'audio/wav'),
		target: settings.saveTarget,
		types: WAV_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	if (!prepared || typeof prepared !== 'object') throw new TypeError('The prepared WAV destination is invalid.');
	const mode = (prepared as Readonly<{ mode?: unknown }>).mode;
	if (mode === 'cancelled') {
		return Object.freeze({
			cancelled: prepared as Readonly<Record<string, unknown>>,
			destination: null,
		});
	}
	if (mode === 'blob') return emptyPreparation();
	if (mode !== 'stream') throw new TypeError('The prepared WAV destination has an unsupported mode.');
	const stream = prepared as PreparedWavStream;
	assertPreparedStream(stream);
	try {
		const writable = await stream.createWritable(plan.outputFileBytesPerRender as number, 'exact');
		if (!writable || typeof writable.getWriter !== 'function') {
			throw new TypeError('The prepared WAV destination is not writable.');
		}
		return Object.freeze({ cancelled: null, destination: directDestination(stream, writable.getWriter()) });
	} catch (error) {
		try {
			await stream.abort(error);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'The WAV destination open and cleanup both failed.',
			);
		}
		throw error;
	}
}

/**
 * Adapt the synchronous WAV encoder to one destination write at a time.
 * `onChunk` stays synchronous, so the encoder retains no Promise list; each
 * bounded emission is drained before the next PCM block is accepted.
 */
export async function createDirectWavEncoder(
	destination: DirectWavDestination,
	createEncoder: (options: Readonly<Record<string, unknown>>) => WavEncoder,
	options: Readonly<Record<string, unknown>>,
): Promise<DirectWavEncoder> {
	let emitted: Uint8Array[] = [];
	let active = false;
	let finalized = false;
	const encoder = createEncoder({
		...options,
		collect: false,
		onChunk(chunk: unknown) {
			if (!(chunk instanceof Uint8Array)) throw new TypeError('The WAV encoder emitted invalid bytes.');
			if (emitted.length >= 3) throw new RangeError('The WAV encoder emitted too many undrained chunks.');
			emitted.push(chunk);
		},
	});
	if (emitted.length !== 1) throw new Error('The WAV encoder must emit exactly one initial header.');
	await drain();

	return Object.freeze({
		async write(channels: readonly Float32Array[]): Promise<void> {
			if (active || finalized) throw new Error('The direct WAV encoder is not writable.');
			active = true;
			try {
				encoder.write(channels);
				if (emitted.length !== 1) throw new Error('Each WAV PCM block must emit exactly one chunk.');
				await drain();
			} finally {
				active = false;
			}
		},
		async finalize(): Promise<number> {
			if (active || finalized) throw new Error('The direct WAV encoder cannot be finalized.');
			finalized = true;
			const result = encoder.finalize() as Readonly<{ readonly byteLength?: unknown }> | null;
			if (!Number.isSafeInteger(result?.byteLength) || Number(result?.byteLength) <= 0) {
				throw new Error('The WAV encoder did not report a valid final byte length.');
			}
			await drain();
			await destination.close();
			return result!.byteLength as number;
		},
	});

	async function drain(): Promise<void> {
		const chunks = emitted;
		emitted = [];
		for (const chunk of chunks) await destination.write(chunk);
	}
}

export async function commitDirectWavDestination(
	destination: DirectWavDestination,
	plannedByteLength: number,
	encodedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	if (encodedByteLength !== plannedByteLength) {
		throw new Error('The streamed WAV encoder byte count does not match its planned file size.');
	}
	if (destination.bytesWritten() !== plannedByteLength) {
		throw new Error('The streamed WAV destination byte count does not match its planned file size.');
	}
	assertReadyToCommit();
	const published = await destination.commit();
	if (published.size !== plannedByteLength) {
		throw new Error('The committed WAV file byte count does not match its planned file size.');
	}
	return published;
}

function directWavPlan(plan: DirectWavPlan): plan is DirectWavPlan & {
	readonly outputFileBytesPerRender: number;
	readonly outputs: readonly [Readonly<{ readonly fileName?: unknown }>];
} {
	return plan?.format === 'wav'
		&& plan.mimeType === 'audio/wav'
		&& plan.mode === 'mix'
		&& plan.render?.strategy === 'realtime-stream'
		&& Array.isArray(plan.outputs)
		&& plan.outputs.length === 1
		&& typeof plan.outputs[0]?.fileName === 'string'
		&& plan.outputs[0].fileName.toLowerCase().endsWith('.wav')
		&& Number.isSafeInteger(plan.outputFileBytesPerRender)
		&& Number(plan.outputFileBytesPerRender) > 0
		&& Number(plan.outputFileBytesPerRender) <= DIRECT_WAV_MAXIMUM_FILE_BYTES;
}

function directDestination(
	prepared: PreparedWavStream,
	writer: WritableStreamDefaultWriter<Uint8Array>,
): DirectWavDestination {
	let closed = false;
	let committed = false;
	let abortPromise: Promise<void> | null = null;
	return Object.freeze({
		async write(chunk: Uint8Array): Promise<void> {
			if (closed || committed || abortPromise) throw new Error('The direct WAV destination is not writable.');
			await writer.write(chunk);
		},
		async close(): Promise<void> {
			if (closed) return;
			if (committed || abortPromise) throw new Error('The direct WAV destination cannot be closed.');
			await writer.close();
			closed = true;
		},
		abort(reason?: unknown): Promise<void> {
			if (committed) return Promise.resolve();
			abortPromise ??= Promise.resolve(prepared.abort(reason)).then(() => undefined);
			return abortPromise;
		},
		bytesWritten(): number {
			return prepared.bytesWritten();
		},
		async commit(): Promise<Readonly<Record<string, unknown>>> {
			if (!closed || committed || abortPromise) throw new Error('The direct WAV destination is not ready to commit.');
			const result = await prepared.commit();
			committed = true;
			return result;
		},
	});
}

function assertPreparedStream(value: PreparedWavStream): void {
	for (const method of ['createWritable', 'bytesWritten', 'commit', 'abort'] as const) {
		if (typeof value[method] !== 'function') throw new TypeError(`The prepared WAV destination lacks ${method}.`);
	}
}

function emptyPreparation(): DirectWavPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}

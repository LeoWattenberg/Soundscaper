/* SPDX-License-Identifier: AGPL-3.0-only */

/** No-consent execution of one session-authorized query against installed text towers. */

import { readFile } from 'node:fs/promises';

import {
	resolveAssistanceSemanticQueryRuntimeModelV1,
	type AssistanceRuntimeFamilyModelService,
} from './assistance-operation-family-execution.ts';
import type {
	AssistanceRuntimeFamilyOperationAdapter,
} from './assistance-runtime-family-operation-adapter.ts';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import {
	reviewAssistanceEmbeddingMatrixV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';

export const ASSISTANCE_SEMANTIC_QUERY_RESULT_VERSION = 1 as const;

const OUTPUT_MEDIA_TYPE = 'application/vnd.soundscaper.embedding-matrix-v1';
const MAXIMUM_QUERY_LENGTH = 512;
const MAXIMUM_OUTPUT_BYTES = 64 * 1024;
const EMBEDDING_DIMENSIONS = 768;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const GIB = 1024 ** 3;

export type AssistanceSemanticQueryProviderV1 = 'transcript' | 'visual';

export interface AssistanceSemanticQueryExecutorRequestV1 {
	readonly provider: AssistanceSemanticQueryProviderV1;
	readonly query: string;
	readonly signal: AbortSignal;
}

export type AssistanceSemanticQueryExecutorResultV1 = Readonly<{
	readonly queryResultVersion: typeof ASSISTANCE_SEMANTIC_QUERY_RESULT_VERSION;
	readonly outcome: 'completed';
	readonly provider: AssistanceSemanticQueryProviderV1;
	readonly embedding: readonly number[];
}> | Readonly<{
	readonly queryResultVersion: typeof ASSISTANCE_SEMANTIC_QUERY_RESULT_VERSION;
	readonly outcome: 'unavailable';
	readonly reason: 'model-unavailable' | 'runtime-unavailable';
}>;

export interface AssistanceSemanticQueryExecutorV1 {
	embed(request: AssistanceSemanticQueryExecutorRequestV1):
		Promise<AssistanceSemanticQueryExecutorResultV1>;
}

export function createAssistanceSemanticQueryExecutorV1(options: Readonly<{
	readonly registry: AssistanceStagingRegistry;
	readonly models: AssistanceRuntimeFamilyModelService;
	readonly runtime: AssistanceRuntimeFamilyOperationAdapter;
}>): AssistanceSemanticQueryExecutorV1 {
	if (!options || !options.registry || typeof options.registry.createJob !== 'function'
		|| !options.models || typeof options.models.status !== 'function'
		|| typeof options.models.listInstalled !== 'function'
		|| typeof options.models.resolveModelPaths !== 'function'
		|| !options.runtime || typeof options.runtime.run !== 'function') {
		throw new TypeError('Semantic-query execution requires exact staging, model, and runtime ports.');
	}
	return Object.freeze({ async embed(requestValue: AssistanceSemanticQueryExecutorRequestV1) {
		const request = queryRequest(requestValue);
		request.signal.throwIfAborted();
		const model = await resolveAssistanceSemanticQueryRuntimeModelV1(
			request.provider, options.models, request.signal,
		);
		if (!model) return unavailable('model-unavailable');
		const operation = request.provider === 'transcript'
			? 'text-embedding' as const : 'image-text-embedding' as const;
		const input = new TextEncoder().encode(request.query);
		const jobId = await options.registry.createJob();
		try {
			const claim = await options.registry.stageInput({
				jobId, role: 'text', mediaType: 'text/plain', byteLength: input.byteLength,
				bytes: bytesOf(input), signal: request.signal,
			});
			const reservation = await options.registry.reserveOutput({
				jobId, role: 'embeddings', mediaType: OUTPUT_MEDIA_TYPE,
				maximumByteLength: MAXIMUM_OUTPUT_BYTES,
			});
			const [inputPath, outputPath] = await Promise.all([
				options.registry.resolveInputPathForMain(jobId, claim, request.signal),
				options.registry.resolveOutputReservationPathForMain(
					jobId, reservation, request.signal,
				),
			]);
			const executed = await options.runtime.run({
				jobId, task: model.task,
				settings: Object.freeze({
					schemaVersion: 1, operation, inputRoles: Object.freeze(['text']),
					outputRoles: Object.freeze(['embeddings']),
				}),
				maximumRssBytes: 8 * GIB, maximumDurationMs: 5 * 60_000,
				inputs: Object.freeze([Object.freeze({ claim, path: inputPath })]),
				models: model.captures,
				outputs: Object.freeze([Object.freeze({ reservation, path: outputPath })]),
				signal: request.signal,
			});
			request.signal.throwIfAborted();
			if (executed.outcome === 'unavailable') return unavailable('runtime-unavailable');
			const output = await options.registry.authenticateOutput(
				jobId, reservation, request.signal,
			);
			const summary = executed.outputs[0];
			if (executed.outputs.length !== 1 || !summary
				|| summary.claimId !== output.claimId || summary.role !== output.role
				|| summary.mediaType !== output.mediaType || summary.byteLength !== output.byteLength
				|| summary.sha256 !== output.sha256) {
				throw new Error('The semantic-query output changed after worker authentication.');
			}
			const authenticatedPath = await options.registry.resolveOutputClaimPathForMain(
				jobId, output, request.signal,
			);
			const matrix = reviewAssistanceEmbeddingMatrixV1(await readFile(authenticatedPath));
			request.signal.throwIfAborted();
			if (matrix.rowCount !== 1 || matrix.dimensions !== EMBEDDING_DIMENSIONS) {
				throw new RangeError('A semantic query must return one exact 768-dimensional vector.');
			}
			return Object.freeze({
				queryResultVersion: ASSISTANCE_SEMANTIC_QUERY_RESULT_VERSION,
				outcome: 'completed' as const, provider: request.provider,
				embedding: Object.freeze(Array.from(matrix.vector(0))),
			});
		} finally {
			await options.registry.releaseJob(jobId).catch(() => undefined);
		}
	} });
}

function queryRequest(value: unknown): AssistanceSemanticQueryExecutorRequestV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 3
		|| !Object.hasOwn(value, 'provider') || !Object.hasOwn(value, 'query')
		|| !Object.hasOwn(value, 'signal')) {
		throw new TypeError('The semantic-query executor request fields are invalid.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	if (row.provider !== 'transcript' && row.provider !== 'visual') {
		throw new TypeError('The semantic-query provider is invalid.');
	}
	if (typeof row.query !== 'string' || row.query.trim() === ''
		|| row.query.length > MAXIMUM_QUERY_LENGTH || CONTROL.test(row.query)) {
		throw new TypeError('The semantic-query text is invalid.');
	}
	if (!(row.signal instanceof AbortSignal)) {
		throw new TypeError('The semantic query requires cancellation authority.');
	}
	return Object.freeze({ provider: row.provider, query: row.query, signal: row.signal });
}

function unavailable(
	reason: 'model-unavailable' | 'runtime-unavailable',
): AssistanceSemanticQueryExecutorResultV1 {
	return Object.freeze({
		queryResultVersion: ASSISTANCE_SEMANTIC_QUERY_RESULT_VERSION,
		outcome: 'unavailable' as const, reason,
	});
}

function bytesOf(value: Uint8Array): AsyncIterable<Uint8Array> {
	return Object.freeze({ async *[Symbol.asyncIterator]() { yield value; } });
}

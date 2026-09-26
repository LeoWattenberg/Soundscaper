/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FreesoundOAuthContractError,
	normalizeDescribedSound,
	normalizePendingUploads,
	normalizeUploadedFilename,
	parseDescribeInput,
	type FreesoundDescribeInput,
} from './oauth-contracts.ts';
import {
	accessTokenForSession,
	invalidateAuthorizedFreesoundSession,
	type AuthorizedFreesoundSession,
	type OAuthHandlerDependencies,
} from './oauth-handlers.ts';
import {
	handleOAuthEndpoint,
	oauthJson,
	OAuthHttpError,
	oauthResponseHeaders,
	readJsonBody,
	readUpstreamJson,
	type FreesoundOAuthFunctionContext,
} from './oauth-http.ts';

export type ProtectedHandlerDependencies = OAuthHandlerDependencies;

const API_ORIGIN = 'https://freesound.org';
export const MAX_FREESOUND_UPLOAD_BYTES = 100_000_000;
export const MAX_FREESOUND_ORIGINAL_BYTES = 128 * 1024 * 1024;
const MAX_PENDING_JSON_BYTES = 2 * 1024 * 1024;
const SUPPORTED_UPLOADS = Object.freeze({
	wav: new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
	aif: new Set(['audio/aiff', 'audio/x-aiff']),
	aiff: new Set(['audio/aiff', 'audio/x-aiff']),
	flac: new Set(['audio/flac', 'audio/x-flac']),
	ogg: new Set(['audio/ogg', 'application/ogg']),
	mp3: new Set(['audio/mpeg', 'audio/mp3']),
});
const LICENSE_LABELS = Object.freeze({
	cc0: 'Creative Commons 0',
	'cc-by': 'Attribution',
	'cc-by-nc': 'Attribution NonCommercial',
});

export async function handleFreesoundOriginalRequest(
	context: FreesoundOAuthFunctionContext,
	dependencies: ProtectedHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD'], async (admission) => {
		const id = soundId(context.params.id);
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const range = byteRange(context.request.headers.get('range'));
		// Freesound's API negotiates a JSON renderer before its download view returns audio.
		const headers = new Headers({ Accept: '*/*' });
		headers.set('Authorization', `Bearer ${accessToken}`);
		if (range !== null) headers.set('Range', range);
		const response = await protectedFetch(
			dependencies,
			new URL(`/apiv2/sounds/${String(id)}/download/`, API_ORIGIN),
			{
				method: admission.head ? 'HEAD' : 'GET',
				headers,
				redirect: 'manual',
				signal: context.request.signal,
			},
		);
		if (response.status !== 200 && response.status !== 206 && response.status !== 416) {
			await throwProtectedUpstreamError(response, 'download', authorized, dependencies);
		}
		if (response.status === 416) {
			return new Response(null, {
				status: 416,
				headers: streamedAudioHeaders(response.headers, admission.corsOrigin, id, null),
			});
		}
		const originalBytes = assertOriginalResponse(response);
		const responseHeaders = streamedAudioHeaders(response.headers, admission.corsOrigin, id, originalBytes);
		const body = admission.head || response.body === null
			? null
			: boundedStream(response.body, MAX_FREESOUND_ORIGINAL_BYTES);
		return new Response(body, { status: response.status, headers: responseHeaders });
	});
}

export async function handleFreesoundUploadRequest(
	context: FreesoundOAuthFunctionContext,
	dependencies: ProtectedHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['POST'], async (admission) => {
		const upload = uploadInput(context.request);
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const boundary = `soundscaper-${crypto.randomUUID().replace(/-/gu, '')}`;
		const prefix = new TextEncoder().encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="audiofile"; filename="upload.${upload.extension}"; filename*=UTF-8''${upload.encodedFilename}\r\nContent-Type: ${upload.contentType}\r\n\r\n`,
		);
		const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
		const multipartBytes = prefix.byteLength + upload.byteLength + suffix.byteLength;
		const body = fixedLengthBody(
			multipartStream(context.request.body, prefix, suffix, upload.byteLength),
			multipartBytes,
		);
		const response = await protectedFetch(dependencies, new URL('/apiv2/sounds/upload/', API_ORIGIN), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Content-Length': String(multipartBytes),
			},
			body,
			redirect: 'manual',
			signal: context.request.signal,
		});
		if (!response.ok) await throwProtectedUpstreamError(response, 'upload', authorized, dependencies);
		const uploadFilename = normalizeUpstream(normalizeUploadedFilename, await readUpstreamJson(response));
		return oauthJson({ data: { uploadFilename } }, 201, admission);
	});
}

export async function handleFreesoundDescribeRequest(
	context: FreesoundOAuthFunctionContext,
	dependencies: ProtectedHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['POST'], async (admission) => {
		const input = parseDescribeInput(await readJsonBody(context.request));
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const response = await protectedFetch(dependencies, new URL('/apiv2/sounds/describe/', API_ORIGIN), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: describeForm(input).toString(),
			redirect: 'manual',
			signal: context.request.signal,
		});
		if (!response.ok) await throwProtectedUpstreamError(response, 'describe', authorized, dependencies);
		const described = normalizeUpstream(normalizeDescribedSound, await readUpstreamJson(response));
		return oauthJson({ data: { soundId: described.id, status: 'submitted' } }, 202, admission);
	});
}

export async function handleFreesoundPendingUploadsRequest(
	context: FreesoundOAuthFunctionContext,
	dependencies: ProtectedHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET'], async (admission) => {
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const response = await protectedFetch(dependencies, new URL('/apiv2/sounds/pending_uploads/', API_ORIGIN), {
			headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
			redirect: 'manual',
			signal: context.request.signal,
		});
		if (!response.ok) await throwProtectedUpstreamError(response, 'pending uploads', authorized, dependencies);
		const data = normalizeUpstream(
			normalizePendingUploads,
			await readUpstreamJson(response, MAX_PENDING_JSON_BYTES),
		);
		return oauthJson({ data }, 200, admission);
	});
}

export async function handleFreesoundUsageRequest(
	context: FreesoundOAuthFunctionContext,
	dependencies: ProtectedHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET'], async (admission) => {
		const { authorized } = await accessTokenForSession(context, dependencies);
		return oauthJson({ data: {
			user: authorized.session.grant.user,
			maximumUploadBytes: MAX_FREESOUND_UPLOAD_BYTES,
			maximumOriginalBytes: MAX_FREESOUND_ORIGINAL_BYTES,
			acceptedUploadExtensions: Object.keys(SUPPORTED_UPLOADS),
			licenses: Object.keys(LICENSE_LABELS),
		} }, 200, admission);
	});
}

function uploadInput(request: Request): Readonly<{
	encodedFilename: string;
	filename: string;
	extension: keyof typeof SUPPORTED_UPLOADS;
	contentType: string;
	byteLength: number;
}> {
	const encodedFilename = request.headers.get('x-freesound-filename');
	if (encodedFilename === null || encodedFilename.length === 0 || encodedFilename.length > 1_024
		|| !/^[\x21-\x7e]+$/u.test(encodedFilename)) {
		throw new OAuthHttpError(400, 'invalid_upload', 'The percent-encoded upload filename is invalid.');
	}
	let filename: string;
	try {
		filename = decodeURIComponent(encodedFilename);
	} catch {
		throw new OAuthHttpError(400, 'invalid_upload', 'The percent-encoded upload filename is invalid.');
	}
	if (encodeURIComponent(filename) !== encodedFilename || filename.length > 255 || filename.trim() !== filename
		|| filename === '.' || filename === '..' || hasControlCharacter(filename) || /[/\\]/u.test(filename)) {
		throw new OAuthHttpError(400, 'invalid_upload', 'The percent-encoded upload filename is invalid.');
	}
	const extension = filename.split('.').at(-1)?.toLocaleLowerCase('en-US');
	if (extension === undefined || !Object.hasOwn(SUPPORTED_UPLOADS, extension)) {
		throw new OAuthHttpError(415, 'unsupported_audio', 'Freesound does not accept this audio format.');
	}
	const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
	if (contentType === undefined || !SUPPORTED_UPLOADS[extension as keyof typeof SUPPORTED_UPLOADS].has(contentType)) {
		throw new OAuthHttpError(415, 'unsupported_audio', 'The audio type does not match its filename.');
	}
	const contentLength = request.headers.get('content-length');
	const ownedLength = request.headers.get('x-freesound-content-length');
	const lengths = [contentLength, ownedLength].filter((value): value is string => value !== null);
	if (lengths.length === 0 || lengths.some((value) => !/^\d{1,9}$/u.test(value))) {
		throw new OAuthHttpError(411, 'length_required', 'The audio upload length is required.');
	}
	const parsedLengths = lengths.map(Number);
	if (parsedLengths.some((value) => value !== parsedLengths[0])) {
		throw new OAuthHttpError(400, 'invalid_upload', 'The audio upload length declarations do not match.');
	}
	const byteLength = parsedLengths[0] as number;
	if (byteLength < 1 || byteLength > MAX_FREESOUND_UPLOAD_BYTES) {
		throw new OAuthHttpError(413, 'upload_too_large', 'The audio upload exceeds the 100 MB limit.');
	}
	if (request.body === null) throw new OAuthHttpError(400, 'invalid_upload', 'The audio upload is empty.');
	return {
		encodedFilename,
		filename,
		extension: extension as keyof typeof SUPPORTED_UPLOADS,
		contentType,
		byteLength,
	};
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 0x1f || code === 0x7f;
	});
}

function multipartStream(
	source: ReadableStream<Uint8Array> | null,
	prefix: Uint8Array,
	suffix: Uint8Array,
	expectedBytes: number,
): ReadableStream<Uint8Array> {
	if (source === null) throw new OAuthHttpError(400, 'invalid_upload', 'The audio upload is empty.');
	const reader = source.getReader();
	let state: 'prefix' | 'source' | 'suffix' | 'done' = 'prefix';
	let observedBytes = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (state === 'prefix') {
				state = 'source';
				controller.enqueue(prefix);
				return;
			}
			if (state === 'source') {
				const next = await reader.read();
				if (!next.done) {
					observedBytes += next.value.byteLength;
					if (observedBytes > expectedBytes || observedBytes > MAX_FREESOUND_UPLOAD_BYTES) {
						await reader.cancel('Upload exceeded its declared byte length.');
						controller.error(new Error('Upload exceeded its declared byte length.'));
						state = 'done';
						return;
					}
					controller.enqueue(next.value);
					return;
				}
				if (observedBytes !== expectedBytes) {
					controller.error(new Error('Upload did not match its declared byte length.'));
					state = 'done';
					return;
				}
				state = 'suffix';
			}
			if (state === 'suffix') {
				state = 'done';
				controller.enqueue(suffix);
				controller.close();
			}
		},
		async cancel(reason) {
			state = 'done';
			await reader.cancel(reason);
		},
	});
}

function fixedLengthBody(source: ReadableStream<Uint8Array>, byteLength: number): ReadableStream<Uint8Array> {
	const FixedLength = (globalThis as typeof globalThis & {
		FixedLengthStream?: new (length: number) => ReadableWritablePair<Uint8Array, Uint8Array>;
	}).FixedLengthStream;
	if (!FixedLength) return source; // Node's test host does not provide the Workers stream constructor.
	const target = new FixedLength(byteLength);
	void source.pipeTo(target.writable).catch(() => {
		// The fetch consumer observes an aborted fixed-length readable stream.
	});
	return target.readable;
}

function boundedStream(source: ReadableStream<Uint8Array>, maximumBytes: number): ReadableStream<Uint8Array> {
	let bytes = 0;
	return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			bytes += chunk.byteLength;
			if (bytes > maximumBytes) throw new Error('The Freesound original exceeded its byte limit.');
			controller.enqueue(chunk);
		},
	}));
}

function assertOriginalResponse(response: Response): number | null {
	const byteLength = response.status === 206
		? partialOriginalByteLength(response.headers)
		: originalContentLength(response.headers.get('content-length'));
	if (byteLength !== null && byteLength > MAX_FREESOUND_ORIGINAL_BYTES) throw originalTooLargeError();
	const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
	if (type === undefined || (!type.startsWith('audio/') && type !== 'application/ogg'
		&& type !== 'application/octet-stream')) {
		throw new OAuthHttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid original file.');
	}
	return byteLength;
}

function partialOriginalByteLength(headers: Headers): number {
	const match = /^bytes (\d+)-(\d+)\/(\d+)$/iu.exec(headers.get('content-range') ?? '');
	if (match === null) throw invalidOriginalResponseError();
	const start = Number(match[1]);
	const end = Number(match[2]);
	const total = Number(match[3]);
	if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total < 1 || end >= total) {
		throw invalidOriginalResponseError();
	}
	const contentLength = originalContentLength(headers.get('content-length'));
	if (contentLength !== null && contentLength !== end - start + 1) throw invalidOriginalResponseError();
	return total;
}

function originalContentLength(value: string | null): number | null {
	if (value === null) return null;
	if (!/^\d+$/u.test(value)) throw invalidOriginalResponseError();
	const length = Number(value);
	if (!Number.isSafeInteger(length)) throw invalidOriginalResponseError();
	return length;
}

function originalTooLargeError(): OAuthHttpError {
	return new OAuthHttpError(413, 'original_too_large', 'The original exceeds Soundscaper’s 128 MiB import limit.');
}

function invalidOriginalResponseError(): OAuthHttpError {
	return new OAuthHttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid original file.');
}

function streamedAudioHeaders(
	source: Headers,
	corsOrigin: string | null,
	id: number,
	originalBytes: number | null,
): Headers {
	const headers = oauthResponseHeaders(corsOrigin);
	for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
		const value = source.get(name);
		if (value !== null) headers.set(name, value);
	}
	const disposition = source.get('content-disposition');
	if (disposition !== null && disposition.length <= 1_024 && !/[\r\n]/u.test(disposition)) {
		headers.set('Content-Disposition', disposition);
	} else {
		headers.set('Content-Disposition', `attachment; filename="freesound-${String(id)}-original"`);
	}
	if (originalBytes !== null) headers.set('X-Freesound-Original-Bytes', String(originalBytes));
	headers.set('Cache-Control', 'private, no-store');
	headers.set('Vary', 'Origin, Range');
	return headers;
}

function describeForm(input: FreesoundDescribeInput): URLSearchParams {
	return new URLSearchParams({
		upload_filename: input.uploadFilename,
		name: input.title,
		bst_category: input.categoryId,
		tags: input.tags.join(' '),
		description: input.description,
		license: LICENSE_LABELS[input.license],
	});
}

function soundId(value: string | string[] | undefined): number {
	if (typeof value !== 'string' || !/^[1-9]\d{0,14}$/u.test(value)) {
		throw new OAuthHttpError(400, 'invalid_request', 'The Freesound sound ID is invalid.');
	}
	const id = Number(value);
	if (!Number.isSafeInteger(id)) throw new OAuthHttpError(400, 'invalid_request', 'The Freesound sound ID is invalid.');
	return id;
}

function byteRange(value: string | null): string | null {
	if (value === null) return null;
	const match = value.length <= 80 ? /^bytes=(\d*)-(\d*)$/u.exec(value) : null;
	if (match === null || (match[1] === '' && match[2] === '')) {
		throw new OAuthHttpError(416, 'invalid_range', 'The original byte range is invalid.');
	}
	const start = match[1] === '' ? null : Number(match[1]);
	const end = match[2] === '' ? null : Number(match[2]);
	if ((start !== null && !Number.isSafeInteger(start))
		|| (end !== null && !Number.isSafeInteger(end))
		|| (start === null && end === 0)
		|| (start !== null && end !== null && start > end)) {
		throw new OAuthHttpError(416, 'invalid_range', 'The original byte range is invalid.');
	}
	return value;
}

async function protectedFetch(
	dependencies: ProtectedHandlerDependencies,
	url: URL,
	init: RequestInit,
): Promise<Response> {
	const fetchImpl = dependencies.fetchImpl ?? ((input, requestInit) => globalThis.fetch(input, requestInit));
	try {
		return await fetchImpl(url, init);
	} catch {
		throw new OAuthHttpError(502, 'upstream_unavailable', 'Freesound is temporarily unavailable.');
	}
}

function protectedUpstreamError(status: number, headers: Headers, operation: string): OAuthHttpError {
	if (status === 401 || status === 403) {
		return new OAuthHttpError(401, 'authentication_expired', 'Reconnect Freesound to continue.');
	}
	if (status === 404 && operation === 'download') {
		return new OAuthHttpError(404, 'sound_not_found', 'The Freesound sound was not found.');
	}
	if (status === 400 && operation === 'describe') {
		return new OAuthHttpError(400, 'publish_rejected', 'Freesound rejected the sound metadata.');
	}
	if (status === 400 && operation === 'upload') {
		return new OAuthHttpError(400, 'upload_rejected', 'Freesound rejected the audio upload.');
	}
	if (status === 413) return new OAuthHttpError(413, 'upload_too_large', 'Freesound rejected the upload size.');
	if (status === 429) {
		const retry = headers.get('retry-after');
		const safeRetry = retry !== null && /^\d{1,5}$/u.test(retry) ? retry : null;
		return new OAuthHttpError(503, 'upstream_rate_limited', 'Freesound is temporarily rate limited.',
			safeRetry === null ? undefined : { 'Retry-After': safeRetry });
	}
	return new OAuthHttpError(502, 'upstream_error', `Freesound could not complete the ${operation}.`);
}

async function throwProtectedUpstreamError(
	response: Response,
	operation: string,
	authorized: AuthorizedFreesoundSession,
	dependencies: ProtectedHandlerDependencies,
): Promise<never> {
	if (response.status === 401 || response.status === 403) {
		await invalidateAuthorizedFreesoundSession(authorized, dependencies);
	}
	throw protectedUpstreamError(response.status, response.headers, operation);
}

function normalizeUpstream<T>(normalizer: (value: unknown) => T, value: unknown): T {
	try {
		return normalizer(value);
	} catch (error) {
		if (error instanceof FreesoundOAuthContractError) {
			throw new OAuthHttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
		}
		throw error;
	}
}

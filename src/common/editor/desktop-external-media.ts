/* SPDX-License-Identifier: AGPL-3.0-only */

/** File references are document metadata; decoded PCM and previews remain local caches. */
export const EXTERNAL_MEDIA_EXTENSION = 'desktopExternalMedia';
export const EXTERNAL_MEDIA_ENCODING = 'external-file-v1';

export interface ExternalMediaReference {
	readonly reference: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly decodeSampleRate?: number;
}

export interface ExternalMedia extends ExternalMediaReference {
	readonly version: 1;
	readonly role: 'audio' | 'video' | 'video-audio';
	readonly contentSha256: string | null;
	readonly frameCount: number;
	readonly sampleRate: number | null;
	readonly channelCount: number | null;
	readonly chunkFrames: number | null;
}

const fileReferences = new WeakMap<object, string>();

export function registerExternalMediaFile(file: object, reference: string): void {
	if (typeof reference !== 'string' || !reference || reference.length > 32_768) {
		throw new TypeError('The native external-file reference is invalid.');
	}
	fileReferences.set(file, reference);
}

export function externalMediaFileReference(file: object): string | null {
	return fileReferences.get(file) ?? null;
}

export function normalizeExternalMedia(value: unknown): Readonly<ExternalMedia> {
	if (!record(value) || value.version !== 1
		|| !['audio', 'video', 'video-audio'].includes(String(value.role))
		|| typeof value.reference !== 'string' || !value.reference || value.reference.length > 32_768
		|| !Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 1
		|| !Number.isSafeInteger(value.frameCount) || Number(value.frameCount) < 1
		|| !nullablePositiveInteger(value.sampleRate) || !nullablePositiveInteger(value.channelCount)
		|| !nullablePositiveInteger(value.chunkFrames)
		|| (value.decodeSampleRate !== undefined && (!Number.isSafeInteger(value.decodeSampleRate) || Number(value.decodeSampleRate) < 1))
		|| !digest(value.sha256) || (value.contentSha256 !== null && !digest(value.contentSha256))) {
		throw new TypeError('The external media reference is invalid.');
	}
	return Object.freeze({ version: 1, reference: value.reference, byteLength: Number(value.byteLength),
		sha256: value.sha256, role: value.role as ExternalMedia['role'],
		contentSha256: value.contentSha256 as string | null, frameCount: Number(value.frameCount),
		sampleRate: value.sampleRate as number | null, channelCount: value.channelCount as number | null,
		chunkFrames: value.chunkFrames as number | null,
		...(value.decodeSampleRate === undefined ? {} : { decodeSampleRate: Number(value.decodeSampleRate) }) });
}

export function externalMediaForSource(value: unknown): Readonly<ExternalMedia> | null {
	if (!record(value) || !record(value.opaqueExtensions)) return null;
	const raw = value.opaqueExtensions[EXTERNAL_MEDIA_EXTENSION];
	if (raw == null) return null;
	const external = normalizeExternalMedia(raw);
	// A destructive edit creates different media. Its inherited import metadata
	// must never cause a subsequent save to revert to the original recording.
	if (external.frameCount !== (value.sampleFrameCount ?? value.frameCount) || external.contentSha256 !== (value.contentSha256 ?? null)
		|| external.sampleRate !== (value.sampleRate ?? null) || external.channelCount !== (value.channelCount ?? null)
		|| external.chunkFrames !== (value.chunkFrames ?? null)) return null;
	if ((value.kind === 'video') !== (external.role === 'video')) {
		throw new TypeError('The external media role does not match its source.');
	}
	return external;
}

export function attachExternalMedia<Source extends Readonly<Record<string, unknown>>>(
	source: Source,
	reference: ExternalMediaReference | null | undefined,
	role: ExternalMedia['role'],
): Source {
	if (!reference) return source;
	const external = normalizeExternalMedia({ ...reference, version: 1, role,
		contentSha256: source.contentSha256 ?? null, frameCount: source.sampleFrameCount ?? source.frameCount,
		sampleRate: source.sampleRate ?? null, channelCount: source.channelCount ?? null, chunkFrames: source.chunkFrames ?? null });
	return { ...source, opaqueExtensions: { ...(record(source.opaqueExtensions) ? source.opaqueExtensions : {}),
		[EXTERNAL_MEDIA_EXTENSION]: external } };
}

export function withoutExternalMedia<Source extends Readonly<Record<string, unknown>>>(source: Source): Source {
	if (!record(source.opaqueExtensions) || !(EXTERNAL_MEDIA_EXTENSION in source.opaqueExtensions)) return source;
	const extensions = { ...source.opaqueExtensions };
	delete extensions[EXTERNAL_MEDIA_EXTENSION];
	return { ...source, opaqueExtensions: extensions };
}

export function consolidateExternalMediaCommands(
	sources: readonly unknown[],
	managedSourceIds: ReadonlySet<string>,
): Readonly<{ type: 'source/update'; sourceId: string; changes: { opaqueExtensions: unknown } }>[] {
	return sources.flatMap((source) => {
		if (!record(source) || typeof source.id !== 'string' || !managedSourceIds.has(source.id)
			|| !externalMediaForSource(source)) return [];
		return [{ type: 'source/update' as const, sourceId: source.id,
			changes: { opaqueExtensions: withoutExternalMedia(source).opaqueExtensions } }];
	});
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function digest(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function nullablePositiveInteger(value: unknown): boolean {
	return value === null || (Number.isSafeInteger(value) && Number(value) > 0);
}

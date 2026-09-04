/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any --
   Legacy JavaScript project shapes are narrowed as their owning services migrate. */

import type { SourceLifecycleLoadOptions } from './source-lifecycle-service.ts';

/**
 * What a render may require of the sources it is about to read.
 *
 * A rendered fallback names the exact sources it was produced from, so the render must
 * refuse rather than substitute: a named source that is missing, duplicated, of the wrong
 * kind, or whose stored geometry no longer matches the project would each produce audio
 * that is not what the fallback promised. Every check here therefore says which source
 * failed and how, so the surface can tell the user what to relink.
 */

export function requiredAudioSourceIdSet(project: any, options: SourceLifecycleLoadOptions) {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Source lifecycle load options must be an object.');
	}
	if (options.onlyRequiredAudioSources != null && typeof options.onlyRequiredAudioSources !== 'boolean') {
		throw new TypeError('Only-required-audio-sources must be a boolean.');
	}
	const ids = sourceIdSet(options.requiredAudioSourceIds ?? [], 'required audio source');
	if (!ids.size) return ids;
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	for (const sourceId of ids) {
		const matches = sources.filter((source: any) => source?.id === sourceId);
		if (matches.length !== 1) {
			throw new Error(`Required rendered fallback source ${sourceId} is unavailable.`);
		}
		if (matches[0]?.kind !== 'audio') {
			throw new TypeError(`Required rendered fallback source ${sourceId} must be audio.`);
		}
	}
	return ids;
}

export function requiredVideoSourceIdSet(project: any, options: SourceLifecycleLoadOptions) {
	const ids = sourceIdSet(options.requiredVideoSourceIds ?? [], 'required video source');
	if (!ids.size) return ids;
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	for (const sourceId of ids) {
		const matches = sources.filter((source: any) => source?.id === sourceId);
		if (matches.length !== 1) {
			throw new Error(`Required rendered fallback source ${sourceId} is unavailable.`);
		}
		if (matches[0]?.kind !== 'video') {
			throw new TypeError(`Required rendered fallback source ${sourceId} must be video.`);
		}
	}
	return ids;
}

export function sourceIdSet(values: readonly string[], label: string): Set<string> {
	if (!Array.isArray(values)) throw new TypeError(`${label} IDs must be an array.`);
	const ids = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string' || !value || value !== value.trim()) {
			throw new TypeError(`A ${label} ID must be a non-empty canonical string.`);
		}
		ids.add(value);
	}
	return ids;
}

export function assertRequiredSourceMetadata(source: any, metadata: any) {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		throw new Error(`Required rendered fallback source ${source.id} has no stored metadata.`);
	}
	if ((metadata.frameCount ?? metadata.frameLength) !== source.frameCount
		|| metadata.channelCount !== source.channelCount
		|| (metadata.sampleRate != null && metadata.sampleRate !== source.sampleRate)) {
		throw new Error(`Required rendered fallback source ${source.id} metadata geometry changed.`);
	}
}

export function assertRequiredSourceBuffer(source: any, buffer: any) {
	if (!buffer) throw new Error(`Required rendered fallback source ${source.id} is unavailable.`);
	if (buffer.length !== source.frameCount
		|| buffer.numberOfChannels !== source.channelCount
		|| buffer.sampleRate !== source.sampleRate) {
		throw new Error(`Required rendered fallback source ${source.id} buffer geometry changed.`);
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

const CANONICAL_AIFF_MIME_TYPE = 'audio/aiff';

/**
 * MIME spellings a platform file picker may report for a classic AIFF file.
 * Chromium derives `File.type` from the shared-mime-info database on Linux,
 * which names `audio/x-aiff`, from the UTI on macOS, and leaves it empty when
 * Windows has no registry content type.
 */
const PLATFORM_AIFF_MIME_TYPES: ReadonlySet<string> = new Set([
	'', 'audio/aiff', 'audio/x-aiff', 'audio/aif', 'audio/x-aif',
]);

interface NamedAudioFile {
	readonly name?: unknown;
	readonly type?: unknown;
}

/** The canonical MIME type of one maintained AIFF file identity, or null. */
export function maintainedAiffMimeType(value: unknown): 'audio/aiff' | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const file = value as NamedAudioFile;
	if (typeof file.name !== 'string' || !/\.(?:aif|aiff)$/iu.test(file.name)) return null;
	if (file.type === undefined) return CANONICAL_AIFF_MIME_TYPE;
	if (typeof file.type !== 'string') return null;
	const type = file.type.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	return PLATFORM_AIFF_MIME_TYPES.has(type) ? CANONICAL_AIFF_MIME_TYPE : null;
}

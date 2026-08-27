/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Every product writes its own project-file suffix and reads all of them.
 *
 * The archive behind each suffix is the same Scape ZIP with the same manifest,
 * MIME type, and format version, so a suffix is only ever a routing hint: what
 * a file really is stays decided by its manifest, schema, capability, and
 * digest validation. Nothing here may be used to admit an archive that those
 * checks would refuse, and nothing here may be used to refuse one they accept.
 */

export const PROJECT_FILE_EXTENSION_BY_PRODUCT = Object.freeze({
	soundscaper: '.sscape',
	framescaper: '.fscape',
	// Lightscaper is roadmap-only. Its suffix is reserved here so that the
	// products that ship today already open what it will one day write, and so
	// that no later product can claim it by accident.
	lightscaper: '.liscape',
} as const);

/**
 * The suffix both current products emitted before they had one of their own.
 * It is still opened everywhere and is never written by production code.
 */
export const LEGACY_PROJECT_FILE_EXTENSION = '.scape';

/**
 * @deprecated The legacy-import alias re-exported by `editor/scape-project.js`,
 * kept so existing importers keep resolving. New code names the suffix a
 * product writes with `projectFileExtensionForProduct` and classifies an
 * incoming file with `isProjectFileName`.
 */
export const SCAPE_FILE_EXTENSION = LEGACY_PROJECT_FILE_EXTENSION;

export const ACCEPTED_PROJECT_FILE_EXTENSIONS = Object.freeze([
	'.sscape',
	'.fscape',
	'.liscape',
	'.scape',
] as const);

export type ProjectFileProductId = keyof typeof PROJECT_FILE_EXTENSION_BY_PRODUCT;
export type ProjectFileExtension = typeof ACCEPTED_PROJECT_FILE_EXTENSIONS[number];

const ACCEPTED_EXTENSION_SET: ReadonlySet<string> = new Set(ACCEPTED_PROJECT_FILE_EXTENSIONS);

/** Anchored so a disguised suffix such as `mix.sscape.zip` is never a project. */
const TERMINAL_EXTENSION_PATTERN = new RegExp(
	`(${ACCEPTED_PROJECT_FILE_EXTENSIONS.map((extension) => `\\${extension}`).join('|')})$`,
	'iu',
);

/** The comma-joined `accept` list a browser file input advertises. */
export const ACCEPTED_PROJECT_FILE_EXTENSION_LIST = ACCEPTED_PROJECT_FILE_EXTENSIONS.join(',');

/** The suffix `product` writes. Unknown products are a programming error. */
export function projectFileExtensionForProduct(product: unknown): ProjectFileExtension {
	const productId = String(product ?? '').toLowerCase();
	if (!Object.hasOwn(PROJECT_FILE_EXTENSION_BY_PRODUCT, productId)) {
		throw new RangeError(`No project file extension is registered for product: ${productId || '(none)'}.`);
	}
	return PROJECT_FILE_EXTENSION_BY_PRODUCT[productId as ProjectFileProductId];
}

export function isAcceptedProjectFileExtension(value: unknown): value is ProjectFileExtension {
	return typeof value === 'string' && ACCEPTED_EXTENSION_SET.has(value.toLowerCase());
}

/**
 * The canonical accepted suffix a file name ends with, or null when it ends
 * with none. Only the terminal path segment is examined, so a directory named
 * `takes.sscape` never lends its suffix to the files inside it.
 */
export function projectFileExtensionOf(fileName: unknown): ProjectFileExtension | null {
	const match = TERMINAL_EXTENSION_PATTERN.exec(terminalSegment(fileName));
	return match === null ? null : match[1].toLowerCase() as ProjectFileExtension;
}

export function isProjectFileName(fileName: unknown): boolean {
	return projectFileExtensionOf(fileName) !== null;
}

export function isLegacyProjectFileName(fileName: unknown): boolean {
	return projectFileExtensionOf(fileName) === LEGACY_PROJECT_FILE_EXTENSION;
}

/**
 * Name a file for the product that is saving it: a recognized project suffix
 * is replaced, anything else keeps its name and gains the suffix. A Soundscaper
 * `Mix.sscape` opened in Framescaper is therefore saved as `Mix.fscape`, and a
 * foreign or future archive copied byte-for-byte is renamed but never rewritten.
 */
export function withProjectFileExtension(fileName: unknown, extension: unknown): string {
	if (!isAcceptedProjectFileExtension(extension)) {
		throw new RangeError(`Unsupported project file extension: ${String(extension)}.`);
	}
	const suffix = extension.toLowerCase();
	const base = String(fileName ?? '').trim() || 'project';
	const recognized = projectFileExtensionOf(base);
	return recognized === null
		? `${base}${suffix}`
		: `${base.slice(0, base.length - recognized.length)}${suffix}`;
}

function terminalSegment(value: unknown): string {
	const text = typeof value === 'string' ? value : '';
	const boundary = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
	return boundary === -1 ? text : text.slice(boundary + 1);
}

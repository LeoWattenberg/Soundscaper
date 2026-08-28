/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Per-format plug-in consent and the main-private roots it authorizes.
 *
 * Nothing here scans, and nothing here runs at startup: a fresh store grants
 * no format and admits no root, so the only way a scan target exists is that
 * the user granted a format and then admitted a specific folder. Standard
 * operating-system roots are *offered* — they are visible, named, and inert
 * until admitted — and custom roots arrive only through a main-owned directory
 * picker injected as a seam, never from anything the renderer says.
 *
 * The raw paths stay on this side of the bridge. `describe()` is the entire
 * renderer-facing projection and carries opaque root ids, an origin, and a
 * display name that is provably free of path separators; `scanTargets()` and
 * `resolveRoot()` are the main-private accessors that hold the real path, and
 * both refuse a format the user has not granted.
 */

import { createHash } from 'node:crypto';

import { HELPER_PLUGIN_FORMATS, type HelperPluginFormat } from './helper-job-grant.ts';
import { isAdmissiblePluginPath } from './plugin-scan-results.ts';

export { HELPER_PLUGIN_FORMATS as PLUGIN_FORMATS } from './helper-job-grant.ts';

export type PluginFormat = HelperPluginFormat;

export type PluginRootOrigin = 'standard' | 'custom';

/** At most this many custom folders per format; the picker is not a firehose. */
export const MAXIMUM_CUSTOM_PLUGIN_ROOTS = 32;

export const PLUGIN_CONSENT_STATE_VERSION = 1;

/**
 * Audio Units is a macOS-only format and LV2 a Linux-only one, so neither is
 * grantable elsewhere. Refusing the grant — rather than offering it with an
 * empty root list — keeps a nonsensical custom root from ever being picked.
 *
 * `fixture` names only our own proof binaries, so it has no operating-system
 * folder to offer and every root it ever scans is one the user picked.
 *
 * The key type is the closed format set the helper contract owns rather than a
 * private copy, so adding a format there is a compile error here instead of a
 * table this module quietly disagrees with.
 */
const FORMAT_PLATFORMS: Readonly<Record<PluginFormat, readonly string[]>> = Object.freeze({
	vst3: Object.freeze(['darwin', 'linux', 'win32']),
	clap: Object.freeze(['darwin', 'linux', 'win32']),
	au: Object.freeze(['darwin']),
	lv2: Object.freeze(['linux']),
	fixture: Object.freeze(['darwin', 'linux', 'win32']),
});

interface StandardRootTemplate {
	readonly name: string;
	readonly base: 'system' | 'home';
	readonly path: string;
}

function templates(...entries: StandardRootTemplate[]): readonly StandardRootTemplate[] {
	return Object.freeze(entries);
}

/** Keyed `${platform}:${format}`; an absent key offers nothing, never throws. */
const STANDARD_ROOTS: Readonly<Record<string, readonly StandardRootTemplate[]>> = Object.freeze({
	'darwin:vst3': templates(
		{ name: 'System VST3 folder', base: 'system', path: '/Library/Audio/Plug-Ins/VST3' },
		{ name: 'User VST3 folder', base: 'home', path: 'Library/Audio/Plug-Ins/VST3' },
	),
	'darwin:clap': templates(
		{ name: 'System CLAP folder', base: 'system', path: '/Library/Audio/Plug-Ins/CLAP' },
		{ name: 'User CLAP folder', base: 'home', path: 'Library/Audio/Plug-Ins/CLAP' },
	),
	'darwin:au': templates(
		{ name: 'System Audio Units folder', base: 'system', path: '/Library/Audio/Plug-Ins/Components' },
		{ name: 'User Audio Units folder', base: 'home', path: 'Library/Audio/Plug-Ins/Components' },
	),
	'linux:vst3': templates(
		{ name: 'System VST3 folder', base: 'system', path: '/usr/lib/vst3' },
		{ name: 'Local VST3 folder', base: 'system', path: '/usr/local/lib/vst3' },
		{ name: 'User VST3 folder', base: 'home', path: '.vst3' },
	),
	'linux:clap': templates(
		{ name: 'System CLAP folder', base: 'system', path: '/usr/lib/clap' },
		{ name: 'Local CLAP folder', base: 'system', path: '/usr/local/lib/clap' },
		{ name: 'User CLAP folder', base: 'home', path: '.clap' },
	),
	'linux:lv2': templates(
		{ name: 'System LV2 folder', base: 'system', path: '/usr/lib/lv2' },
		{ name: 'Local LV2 folder', base: 'system', path: '/usr/local/lib/lv2' },
		{ name: 'User LV2 folder', base: 'home', path: '.lv2' },
	),
	'win32:vst3': templates(
		{ name: 'Common VST3 folder', base: 'system', path: 'C:\\Program Files\\Common Files\\VST3' },
	),
	'win32:clap': templates(
		{ name: 'Common CLAP folder', base: 'system', path: 'C:\\Program Files\\Common Files\\CLAP' },
	),
});

export type PluginConsentErrorCode =
	| 'unknown-format'
	| 'unsupported-format'
	| 'consent-withheld'
	| 'unknown-root'
	| 'unsafe-root'
	| 'duplicate-root'
	| 'root-capacity'
	| 'malformed-state';

export class PluginConsentError extends Error {
	readonly code: PluginConsentErrorCode;

	constructor(code: PluginConsentErrorCode, message: string) {
		super(message);
		this.name = 'PluginConsentError';
		this.code = code;
	}
}

/** Main-private. The only shape in this module that holds a real path. */
export interface PluginRoot {
	readonly rootId: string;
	readonly format: PluginFormat;
	readonly origin: PluginRootOrigin;
	readonly name: string;
	readonly path: string;
}

/** Renderer-facing. Opaque id, origin, display name — never a path. */
export interface PluginRootView {
	readonly rootId: string;
	readonly origin: PluginRootOrigin;
	readonly name: string;
	readonly admitted: boolean;
}

export interface PluginFormatConsentView {
	readonly format: PluginFormat;
	readonly supported: boolean;
	readonly granted: boolean;
	readonly roots: readonly PluginRootView[];
}

export interface PluginConsentView {
	readonly scanningEnabled: boolean;
	readonly formats: readonly PluginFormatConsentView[];
}

export type PluginCustomRootOutcome =
	| Readonly<{ status: 'admitted'; root: PluginRootView }>
	| Readonly<{ status: 'declined' }>
	| Readonly<{ status: 'refused'; code: PluginConsentErrorCode; message: string }>;

export interface PluginConsentFormatState {
	readonly format: PluginFormat;
	readonly granted: boolean;
	readonly roots: readonly Readonly<{
		rootId: string;
		origin: PluginRootOrigin;
		name: string;
		path: string;
	}>[];
}

/** Main-private persisted form; it holds paths and never reaches a renderer. */
export interface PluginConsentState {
	readonly schemaVersion: typeof PLUGIN_CONSENT_STATE_VERSION;
	readonly formats: readonly PluginConsentFormatState[];
}

export interface DesktopPluginConsentOptions {
	/** The main-owned directory picker; resolves null when the user cancels. */
	readonly pickDirectory: (format: PluginFormat) => Promise<string | null>;
	readonly platform?: string;
	readonly homeDirectory?: string | null;
	readonly state?: PluginConsentState;
}

interface FormatState {
	granted: boolean;
	readonly admitted: Map<string, PluginRoot>;
}

type AdmissibleState =
	| Readonly<{ status: 'ready'; state: FormatState }>
	| Readonly<{ status: 'refused'; refusal: PluginCustomRootOutcome }>;

export class DesktopPluginConsent {
	readonly #pickDirectory: (format: PluginFormat) => Promise<string | null>;
	readonly #platform: string;
	readonly #home: string | null;
	readonly #formats = new Map<PluginFormat, FormatState>();

	constructor(options: DesktopPluginConsentOptions) {
		this.#pickDirectory = options.pickDirectory;
		this.#platform = options.platform ?? process.platform;
		const home = options.homeDirectory ?? null;
		this.#home = isAdmissiblePluginPath(home) ? home : null;
		if (options.state) this.#restore(options.state);
	}

	/** The complete renderer-facing projection. */
	describe(): PluginConsentView {
		const formats = HELPER_PLUGIN_FORMATS.map((format) => this.#describeFormat(format));
		return Object.freeze({
			scanningEnabled: formats.some((entry) => entry.granted && entry.roots.some((root) => root.admitted)),
			formats: Object.freeze(formats),
		});
	}

	/**
	 * A format with no row is unsupported rather than a crash: `describe()` is
	 * the renderer-facing projection, and an untabulated format must leave it
	 * inert and visibly unsupported instead of throwing out of the whole view.
	 */
	supports(format: PluginFormat): boolean {
		const key = assertFormat(format);
		const platforms = Object.hasOwn(FORMAT_PLATFORMS, key) ? FORMAT_PLATFORMS[key] : [];
		return platforms.includes(this.#platform);
	}

	isGranted(format: PluginFormat): boolean {
		return this.#formats.get(assertFormat(format))?.granted === true;
	}

	grant(format: PluginFormat): void {
		this.#ensureState(format).granted = true;
	}

	/**
	 * Revoking stops every scan for the format but keeps the folders the user
	 * chose: consent is the gate, and forgetting a deliberate choice would make
	 * re-enabling the format a re-picking chore rather than one switch.
	 */
	revoke(format: PluginFormat): void {
		const state = this.#formats.get(assertFormat(format));
		if (state) state.granted = false;
	}

	/** Admits one of the roots this platform offers for an already-granted format. */
	admitStandardRoot(format: PluginFormat, rootId: string): PluginRootView {
		const state = this.#grantedState(format);
		const offer = this.#standardOffers(format).find((root) => root.rootId === rootId);
		if (!offer) {
			throw new PluginConsentError('unknown-root', 'That standard plug-in folder is not offered on this platform.');
		}
		state.admitted.set(offer.rootId, offer);
		return projectRoot(offer, true);
	}

	/**
	 * The only path by which a custom root is created. The picker is a main-side
	 * seam and is not even invoked until the format is granted, so a renderer
	 * cannot cause a folder dialog for a format the user has not enabled — and
	 * the same authority is asked again once the dialog answers, because a
	 * dialog is open for as long as the user cares to leave it open.
	 */
	async addCustomRoot(format: PluginFormat): Promise<PluginCustomRootOutcome> {
		const beforeDialog = this.#admissibleState(format);
		if (beforeDialog.status !== 'ready') return beforeDialog.refusal;
		const picked = await this.#pickDirectory(format);
		if (picked === null || picked === '') return Object.freeze({ status: 'declined' as const });
		// Everything checked before the dialog opened is stale now: the user may
		// have revoked the format, and a second dialog may have taken the last
		// slot, while this one was up. The state captured before the await is not
		// authority any more, so consent and capacity are both asked again.
		const admissible = this.#admissibleState(format);
		if (admissible.status !== 'ready') return admissible.refusal;
		let root: PluginRoot;
		try {
			root = customRoot(format, picked);
		} catch (error) {
			return refused(error);
		}
		const { state } = admissible;
		if (state.admitted.has(root.rootId)) {
			return refused(new PluginConsentError('duplicate-root', 'That folder is already an admitted plug-in root.'));
		}
		state.admitted.set(root.rootId, root);
		return Object.freeze({ status: 'admitted' as const, root: projectRoot(root, true) });
	}

	removeRoot(format: PluginFormat, rootId: string): boolean {
		return this.#formats.get(assertFormat(format))?.admitted.delete(rootId) === true;
	}

	/**
	 * Main-private. Throws rather than returning an empty list when consent is
	 * withheld, so a caller that forgets the gate fails loudly instead of
	 * quietly scanning nothing and looking like a working feature.
	 */
	scanTargets(format: PluginFormat): readonly PluginRoot[] {
		return Object.freeze([...this.#grantedState(format).admitted.values()]);
	}

	/** Main-private resolution of an opaque root id back to its real path. */
	resolveRoot(format: PluginFormat, rootId: string): PluginRoot {
		const root = this.#grantedState(format).admitted.get(rootId);
		if (!root) throw new PluginConsentError('unknown-root', 'That plug-in root is not admitted for this format.');
		return root;
	}

	exportState(): PluginConsentState {
		return Object.freeze({
			schemaVersion: PLUGIN_CONSENT_STATE_VERSION,
			formats: Object.freeze([...this.#formats].map(([format, state]) => Object.freeze({
				format,
				granted: state.granted,
				roots: Object.freeze([...state.admitted.values()].map((root) => Object.freeze({
					rootId: root.rootId,
					origin: root.origin,
					name: root.name,
					path: root.path,
				}))),
			}))),
		});
	}

	/** Consent and custom-root capacity together, asked on both sides of the picker. */
	#admissibleState(format: PluginFormat): AdmissibleState {
		let state: FormatState;
		try {
			state = this.#grantedState(format);
		} catch (error) {
			return { status: 'refused', refusal: refused(error) };
		}
		if (customRootCount(state) >= MAXIMUM_CUSTOM_PLUGIN_ROOTS) {
			return {
				status: 'refused',
				refusal: refused(new PluginConsentError('root-capacity',
					`At most ${String(MAXIMUM_CUSTOM_PLUGIN_ROOTS)} custom folders are kept per plug-in format.`)),
			};
		}
		return { status: 'ready', state };
	}

	#describeFormat(format: PluginFormat): PluginFormatConsentView {
		const state = this.#formats.get(format);
		const views = new Map<string, PluginRootView>();
		for (const offer of this.#standardOffers(format)) {
			views.set(offer.rootId, projectRoot(offer, state?.admitted.has(offer.rootId) === true));
		}
		for (const root of state?.admitted.values() ?? []) views.set(root.rootId, projectRoot(root, true));
		return Object.freeze({
			format,
			supported: this.supports(format),
			granted: state?.granted === true,
			roots: Object.freeze([...views.values()]),
		});
	}

	#standardOffers(format: PluginFormat): readonly PluginRoot[] {
		if (!this.supports(format)) return Object.freeze([]);
		const key = `${this.#platform}:${format}`;
		const templates = Object.hasOwn(STANDARD_ROOTS, key) ? (STANDARD_ROOTS[key] ?? []) : [];
		const separator = this.#platform === 'win32' ? '\\' : '/';
		const home = this.#home;
		const roots: PluginRoot[] = [];
		for (const template of templates) {
			if (template.base === 'home' && home === null) continue;
			const path = template.base === 'home' && home !== null
				? `${trimTrailingSeparator(home, separator)}${separator}${template.path}`
				: template.path;
			roots.push(Object.freeze({
				rootId: rootIdFor(format, path),
				format,
				origin: 'standard' as const,
				name: template.name,
				path,
			}));
		}
		return Object.freeze(roots);
	}

	#grantedState(format: PluginFormat): FormatState {
		const state = this.#supportedState(format);
		if (!state?.granted) {
			throw new PluginConsentError('consent-withheld',
				`The user has not consented to ${format} plug-in scanning.`);
		}
		return state;
	}

	#ensureState(format: PluginFormat): FormatState {
		const existing = this.#supportedState(format);
		if (existing) return existing;
		const created: FormatState = { granted: false, admitted: new Map() };
		this.#formats.set(format, created);
		return created;
	}

	#supportedState(format: PluginFormat): FormatState | undefined {
		if (!this.supports(assertFormat(format))) {
			throw new PluginConsentError('unsupported-format',
				`The ${format} plug-in format is not available on ${this.#platform}.`);
		}
		return this.#formats.get(format);
	}

	#restore(state: PluginConsentState): void {
		if (!plainRecord(state) || state.schemaVersion !== PLUGIN_CONSENT_STATE_VERSION || !Array.isArray(state.formats)) {
			throw new PluginConsentError('malformed-state', 'The persisted plug-in consent state is not a supported record.');
		}
		for (const entry of state.formats) {
			if (!plainRecord(entry) || typeof entry.granted !== 'boolean' || !Array.isArray(entry.roots)) {
				throw new PluginConsentError('malformed-state', 'A persisted plug-in consent entry is malformed.');
			}
			const format = assertFormat(entry.format);
			if (!this.supports(format)) continue; // A state file carried over from another platform.
			const admitted = new Map<string, PluginRoot>();
			for (const root of entry.roots) {
				if (!plainRecord(root) || (root.origin !== 'standard' && root.origin !== 'custom')) {
					throw new PluginConsentError('malformed-state', 'A persisted plug-in root is malformed.');
				}
				const path = assertPluginRootPath(root.path);
				const rootId = rootIdFor(format, path);
				admitted.set(rootId, Object.freeze({
					rootId,
					format,
					origin: root.origin,
					name: displayName(root.name, path),
					path,
				}));
			}
			// The ceiling is a property of the store, not of the picker: a state
			// file that carries more custom roots than the live path would ever
			// accept is refused rather than restored past the bound.
			if (customRootCount({ granted: entry.granted, admitted }) > MAXIMUM_CUSTOM_PLUGIN_ROOTS) {
				throw new PluginConsentError('root-capacity',
					`A persisted format may hold at most ${String(MAXIMUM_CUSTOM_PLUGIN_ROOTS)} custom folders.`);
			}
			this.#formats.set(format, { granted: entry.granted, admitted });
		}
	}
}

/** Deterministic so the same folder keeps its id across restarts and pickers. */
export function rootIdFor(format: PluginFormat, path: string): string {
	return `r${createHash('sha256').update(`${format}\u0000${path}`).digest('hex').slice(0, 15)}`;
}

function customRootCount(state: FormatState): number {
	let count = 0;
	for (const root of state.admitted.values()) {
		if (root.origin === 'custom') count += 1;
	}
	return count;
}

function projectRoot(root: PluginRoot, admitted: boolean): PluginRootView {
	return Object.freeze({ rootId: root.rootId, origin: root.origin, name: root.name, admitted });
}

function customRoot(format: PluginFormat, picked: string): PluginRoot {
	const path = assertPluginRootPath(picked);
	return Object.freeze({
		rootId: rootIdFor(format, path),
		format,
		origin: 'custom' as const,
		name: displayName(null, path),
		path,
	});
}

function refused(error: unknown): PluginCustomRootOutcome {
	if (!(error instanceof PluginConsentError)) throw error;
	return Object.freeze({ status: 'refused' as const, code: error.code, message: error.message });
}

function assertFormat(value: unknown): PluginFormat {
	if (typeof value !== 'string' || !(HELPER_PLUGIN_FORMATS as readonly string[]).includes(value)) {
		throw new PluginConsentError('unknown-format', 'That plug-in format is not part of the supported set.');
	}
	return value as PluginFormat;
}

export function assertPluginRootPath(value: unknown): string {
	if (!isAdmissiblePluginPath(value)) {
		throw new PluginConsentError('unsafe-root', 'A plug-in root must be one absolute, traversal-free path.');
	}
	return value;
}

/**
 * The renderer-visible name for a folder. A path segment is not a path, but a
 * bare drive letter still names one, and control characters have no business
 * in a label — anything that survives neither is replaced by a generic name.
 */
function displayName(persisted: unknown, path: string): string {
	if (typeof persisted === 'string') {
		const kept = sanitizeSegment(persisted);
		if (kept) return kept;
	}
	const segments = path.split(/[\\/]/u).filter((segment) => segment.length > 0);
	return sanitizeSegment(segments.at(-1) ?? '') ?? 'Chosen folder';
}

function sanitizeSegment(value: string): string | null {
	const cleaned = value.replace(/[\u0000-\u001f\u007f\\/]/gu, ' ').trim();
	if (cleaned.length === 0 || /^[A-Za-z]:$/u.test(cleaned)) return null;
	return cleaned.slice(0, 64);
}

function trimTrailingSeparator(value: string, separator: string): string {
	return value.endsWith(separator) && value.length > 1 ? value.slice(0, -1) : value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

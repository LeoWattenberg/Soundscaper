/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which eagerly loaded modules statically import a lazily owned one.
 *
 * This is the machinery behind the chunk-ownership invariant, kept beside the
 * test rather than inside it: a static import across the eager/lazy boundary
 * makes the importer's chunk depend on the lazy chunk, so the whole optional
 * feature is downloaded during startup and the product-ready graph blows its
 * byte budget for code the user never opened.
 *
 * `EAGER_CHUNK_GROUPS` is the list of groups whose chunks the shell loads at
 * startup. A group missing from it is treated as lazy, so adding a group here
 * is a deliberate claim that its chunk is already paid for during boot.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunkGroupForModulePath } from '../../scripts/lib/build-chunk-groups.mjs';
import { PRODUCT_BOOTSTRAPS } from '../../scripts/lib/startup-graph-budget.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The modules a page runs before it can show anything, taken from the build's own list.
 *
 * `src/main.jsx` is what `index.html` loads. The two product bootstraps are the dynamic
 * entries the site shell mounts a route with, and each is a graph root in its own right -
 * they are the exact module ids the startup budgets are measured against, so they are read
 * from `PRODUCT_BOOTSTRAPS` rather than restated here.
 */
const EAGER_ENTRY_MODULES: readonly string[] = [
	'src/main.jsx',
	...Object.values(PRODUCT_BOOTSTRAPS).map((moduleId) => moduleId.replace(/^\//u, '')),
];

export const EAGER_CHUNK_GROUPS: ReadonlySet<string> = new Set([
	'editor-codec-foundations',
	'editor-copy',
	'editor-controller-core',
	'editor-domain',
	'editor-effect-contracts',
	'editor-engine',
	'editor-production-meter',
	'editor-shell',
	'editor-shell-design-components',
	'editor-storage-model',
	'editor-timeline',
	'framescaper-project-foundations',
	// The four groups below are the rest of the two products' boot-time composition, split
	// off their foundations for chunk size rather than to defer them. Each is reached
	// statically from a product bootstrap while it builds its controller - the Framescaper
	// bootstrap's static import of the timeline-image chunk is written into
	// `assertFramescaperBootstrapChunkIsAcyclic` - so treating them as lazy said the boot
	// graph contained neither the Soundscaper project foundations nor any Framescaper
	// command, clipboard or timeline-image code, which is the opposite of what ships.
	'framescaper-project-commands',
	'framescaper-session-clipboard',
	'framescaper-timeline-images',
	'soundscaper-project-foundations',
	// Owned apart from `editor-domain` so the standalone transfer pages can read the
	// identity tuple without loading an editor chunk. These facades have no static
	// editor dependencies, and the shell loads them at startup, so they are eager.
	'project-interchange-foundations',
	'vendor-design-system',
	'vendor-react',
]);

const WORKER_ENTRY_PATTERN = /new Worker\(\s*new URL\(\s*'(\.[^']+)'/gu;
// Both quote styles: `nyquist/plugin-registry.js` writes its specifiers with double
// quotes, and while this pattern read single quotes only, every dependency that
// eagerly owned module declares was invisible here.
const STATIC_IMPORT_PATTERN = /^import\s+(?!type\b)([\s\S]*?)from\s+(?:'(\.[^']+)'|"(\.[^"]+)")/gmu;
// A barrel's re-exports are static dependencies exactly like its imports: `export { X }
// from './x.ts'` puts `./x.ts` in the importer's chunk graph. The pattern spells the whole
// re-export grammar out rather than reusing the lazy `[\s\S]*?` clause above, because
// `export function`, `export const` and `export class` open a line in nearly every module
// and a lazy clause would happily run from one of those to the `from` of a later statement.
const RE_EXPORT_PATTERN = /^export\s+(?!type\b)(\*(?:\s+as\s+[\p{ID_Start}$_][\p{ID_Continue}$]*)?|\{[^}]*\})\s*from\s*(?:'(\.[^']+)'|"(\.[^"]+)")/gmu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*(?:'(\.[^']+)'|"(\.[^"]+)")/gu;

/**
 * Unowned targets whose reachability placement has been reasoned about, and why.
 *
 * A module with no owner is placed by reachability, so an eagerly owned importer
 * of one is normally a defect waiting to happen: a lazily imported dialog that
 * also reads the leaf can take it into its own chunk, and the shell then
 * statically imports that chunk. Each entry here is a claim that this cannot
 * happen for that module, with the reason it cannot. `tests/audio-editor-build-
 * chunk-unowned-targets.test.ts` fails when an entry gains an owner or vanishes.
 *
 * The two recurring reasons are worth stating once. A module the static site
 * entry graph also imports cannot be given an editor owner at all: the initial
 * graph is budgeted at ten requests and six modulepreloads, and an editor chunk
 * inside it is the regression the transfer-page guards exist to catch. And a
 * module reached only through a worker or AudioWorklet entry is not in the
 * page's startup graph in the first place, whatever its importer's owner says -
 * the entry module is its own bundle root.
 */
export const REACHABILITY_PLACED_TARGETS: ReadonlyMap<string, string> = new Map([
	[
		'src/common/i18n/locale.js',
		'Site copy leaf: `src/common/site/BrandSidebar.jsx` reads it, so an editor owner would put an editor chunk in the initial graph.',
	],
	[
		'src/common/i18n/locales.js',
		'Site copy leaf: `src/common/site/route.js` builds its locale routes from it, so it stays outside every editor group.',
	],
	[
		'src/common/offline/lazy-module.tsx',
		'The shared React.lazy wrapper the site shell (`src/common/site/App.jsx`) mounts its routes with, so it is site-entry code the editor reuses.',
	],
	[
		'src/common/offline/stale-build-runtime.ts',
		'The stale-build check `src/main.jsx` runs before any product mounts, so it is in the initial graph before the editor asks for it.',
	],
	[
		'src/common/offline/ffmpeg-runtime-public-policy.ts',
		'A frozen table read from `config/ffmpeg-runtime-publication-policy.json` that the site-shared offline runtime slice owns; the editor facade only reads the same policy.',
	],
	[
		'src/common/site/document-theme.js',
		'Site chrome the workspace theme hook reuses so both worlds agree on one stored preference; `src/common/site/App.jsx` reaches it first.',
	],
	[
		'src/common/site/privacy-policy-links.js',
		'Site route table the editor privacy surface reuses; `src/common/site/privacy-policy.js` is in the initial graph.',
	],
	[
		'src/common/product-identities.js',
		'Product identity vocabulary shared with `src/common/site/route.js` and both product entries, so it belongs to no single product graph.',
	],
	[
		'src/common/product-profiles.js',
		'Product capability profiles shared with the site routes and the transfer pages, which is why they stay outside every editor group.',
	],
	[
		'src/common/project-file-extensions.ts',
		'Dependency-free suffix table shared by the site profiles, the transfer pages, the desktop shell and both editors; any owner adds a chunk to the ten-request initial graph.',
	],
	[
		'src/common/editor/aup4-profile.js',
		'AUP4 archive implementation, deliberately unowned, reached from the page only through the `aup4-worker.js` worker entry and the lazy file-menu archive actions.',
	],
	[
		'src/common/editor/aup4-profile-values.js',
		'AUP4 archive value tables re-exported by `aup4-profile.js`, on the same worker-entry and lazy-action side of the boundary.',
	],
	[
		'src/common/editor/aup4-sanitization.js',
		'AUP4 archive sanitization, reached only from the AUP4 worker entry and the lazy archive actions that own the conversion.',
	],
	[
		'src/common/editor/aup4-opaque-persistence.ts',
		'AUP4 opaque-node persistence, reached only from the AUP4 worker entry and the lazy archive actions that own the conversion.',
	],
	[
		'src/common/editor/audacity-annotation-interchange.ts',
		'Audacity annotation interchange for the archive readers, reached only from the AUP4 worker entry and the lazy legacy-conversion action.',
	],
	[
		'src/common/editor/audacity-tempo-import.ts',
		'Audacity tempo import for the archive readers, reached only from the AUP4 worker entry and the lazy legacy-conversion action.',
	],
	[
		'src/common/editor/first-party-effects/bitcrusher/dsp.js',
		'Bitcrusher DSP shared by the `bitcrusher-worklet.js` AudioWorklet entry, which the engine loads by URL as its own bundle root, and the lazy selection-effect runtime.',
	],
	[
		'desktop/bundled-flac-stream.ts',
		'Bundled desktop FLAC stream parser reached only through `browser-dedicated-audio-codec.ts` inside the dedicated audio worker entry.',
	],
	[
		'desktop/bundled-mpeg-audio-stream.ts',
		'Bundled desktop MPEG audio stream parser reached only through `browser-dedicated-audio-codec.ts` inside the dedicated audio worker entry.',
	],
	[
		'desktop/bundled-opus-stream.ts',
		'Bundled desktop Opus stream parser reached only through `browser-dedicated-audio-codec.ts` inside the dedicated audio worker entry.',
	],
	[
		'desktop/bundled-vorbis-stream.ts',
		'Bundled desktop Vorbis stream parser reached only through `browser-dedicated-audio-codec.ts` inside the dedicated audio worker entry.',
	],
	[
		'desktop/bundled-wavpack-stream.ts',
		'Bundled desktop WavPack stream parser reached only through `browser-dedicated-audio-codec.ts` inside the dedicated audio worker entry.',
	],
	// The six leaves below became visible when the Framescaper command, clipboard and
	// timeline-image groups were classified eager, which is what they are. Each is a shared
	// leaf of the Framescaper bootstrap's own composition: `FRAMESCAPER_BOOTSTRAP_COMPOSITION_LEAVES`
	// pins the property that makes their placement safe, so these reasons are measured
	// rather than asserted.
	[
		'src/framescaper/editor-project-retime-runtime.ts',
		'Retime runtime projection the finishing runtime and the eagerly composed retime export chain share; no dynamic import reaches it.',
	],
	[
		'src/framescaper/editor-project-finishing-source-rebind.ts',
		'Finishing half of the source rebind the timeline-image rebind extends, reached only from that eagerly composed module.',
	],
	[
		'src/framescaper/editor-scape-asset-import-finishing.ts',
		'Finishing asset import the eagerly composed timeline-image asset import extends, reached only from it and its finishing sibling.',
	],
	[
		'src/framescaper/editor-scape-assets-finishing.ts',
		'Finishing asset inventory the eagerly composed timeline-image asset inventory extends, reached only from it.',
	],
	[
		'src/framescaper/selected-finishing-exact-frame-support.ts',
		'Exact-frame support shared by the finishing execution and the eagerly composed timeline-image export execution; no dynamic import reaches it.',
	],
]);

/**
 * The unowned Framescaper leaves whose placement rests on one measured fact.
 *
 * Each is reached only by modules the Framescaper bootstrap composes eagerly, and by no
 * dynamic import anywhere in the tree, so no lazy entry can claim it and pull an eagerly
 * owned importer's chunk in behind it. `tests/audio-editor-build-chunk-eager-reachability.test.ts`
 * re-measures that on every run, which is what keeps the reasons above from decaying into
 * a comment that used to be true.
 */
export const FRAMESCAPER_BOOTSTRAP_COMPOSITION_LEAVES: readonly string[] = [
	'src/framescaper/editor-project-retime-runtime.ts',
	'src/framescaper/editor-project-finishing-source-rebind.ts',
	'src/framescaper/editor-scape-asset-import-finishing.ts',
	'src/framescaper/editor-scape-assets-finishing.ts',
	'src/framescaper/selected-finishing-exact-frame-support.ts',
];

/** The relative specifiers one module's source imports for value, in source order. */
export function staticRelativeImports(source: string): readonly string[] {
	return matchedSpecifiers(source, STATIC_IMPORT_PATTERN);
}

/**
 * The relative specifiers one module's source re-exports for value, in source order.
 *
 * `export { X } from './x.ts'` is a static dependency the guard used to be blind to, and a
 * barrel is where it matters most: an eagerly owned barrel that re-exports a lazily owned
 * panel makes that whole optional chunk a static dependency of the shell's chunk, so it is
 * downloaded during boot for a dialog nobody opened. `export type { X } from` is not an
 * edge, and neither is a clause whose every name is `type`-qualified.
 */
export function staticRelativeReexports(source: string): readonly string[] {
	return matchedSpecifiers(source, RE_EXPORT_PATTERN);
}

/** Every relative specifier one module's source depends on statically, imports then re-exports. */
export function staticRelativeDependencies(source: string): readonly string[] {
	return [...staticRelativeImports(source), ...staticRelativeReexports(source)];
}

function matchedSpecifiers(source: string, pattern: RegExp): readonly string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(pattern)) {
		if (importsOnlyTypes(match[1]!)) continue;
		specifiers.push((match[2] ?? match[3])!);
	}
	return specifiers;
}

/** Every source module under one directory, recursively. */
export function sourceModules(directory: string): readonly string[] {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(?:[jt]sx?)$/u.test(entry.name))
		.map((entry) => `${entry.parentPath}/${entry.name}`)
		.sort();
}

/**
 * Every module the eager entries reach through static imports and re-exports alone.
 *
 * Ownership answers "which chunk is this module emitted into", never "is this module
 * downloaded during boot". For a module with an owner the two coincide, because the owner
 * is a named group the eager set classifies. For a module with no owner they do not: it is
 * placed by reachability, so the only way to know whether it boots is to walk the graph the
 * bundler walks. A dynamic import is deliberately not followed - that is the boundary this
 * whole helper exists to police.
 */
export function eagerlyReachableModules(): ReadonlySet<string> {
	if (eagerlyReachable) return eagerlyReachable;
	const reached = new Set<string>();
	const pending = EAGER_ENTRY_MODULES.map((path) => resolve(REPOSITORY_ROOT, path))
		.filter((absolute) => existsSync(absolute));
	for (const entry of pending) reached.add(entry);
	while (pending.length > 0) {
		const current = pending.pop()!;
		for (const specifier of staticRelativeDependencies(readFileSync(current, 'utf8'))) {
			const target = resolveRelativeModule(current, specifier);
			if (!target || reached.has(target)) continue;
			reached.add(target);
			pending.push(target);
		}
	}
	eagerlyReachable = reached;
	return reached;
}

let eagerlyReachable: ReadonlySet<string> | null = null;

/**
 * Whether one module's code is downloaded during startup, by ownership or by reachability.
 *
 * An owned module answers from its group. An unowned one has to be walked to, because
 * nothing about its filename says which side of the boundary it landed on.
 */
export function isEagerlyLoadedModule(path: string): boolean {
	const owner = ownerName(path);
	if (owner !== null) return EAGER_CHUNK_GROUPS.has(owner);
	return eagerlyReachableModules().has(resolve(REPOSITORY_ROOT, path));
}

/**
 * The `importer [group] -> target [group]` crossings found under `roots`.
 *
 * A target with no owner is reported as `[unowned]` rather than skipped: it is
 * the half of the boundary reachability decides, so it is the half that fails
 * silently. `reasoned` names the unowned targets whose placement has been argued
 * through; pass an empty set to see the whole list.
 *
 * An importer with no owner counts as eager when the eager entries reach it statically.
 * Skipping those was how `src/soundscaper/video-export-strategy.ts` could statically import
 * the lazily owned export projection unseen: the strategy is composed while the Soundscaper
 * controller is built, so the whole optional export chunk was a boot dependency, and the
 * guard could not say so because the strategy itself has no owner. Between two unowned
 * modules there is nothing to report - neither has a chunk of its own for the other to drag
 * in, and reachability places them together.
 */
export function eagerImportsOfLazyOwners(
	roots: readonly string[],
	reasoned: ReadonlySet<string> = new Set(REACHABILITY_PLACED_TARGETS.keys()),
): readonly string[] {
	const modules = [...new Set(roots.flatMap((root) => sourceModules(root).map((path) => resolve(path))))];
	// A module the runtime hands to `new Worker(new URL(...))` is its own bundle root, so it
	// never joins the page's startup graph and may reach lazily owned code directly.
	const workerEntries = workerEntryModules(modules);
	const crossings: string[] = [];
	for (const absolute of modules) {
		if (workerEntries.has(absolute)) continue;
		const path = relative(REPOSITORY_ROOT, absolute).split(sep).join('/');
		const owner = ownerName(path);
		if (!isEagerlyLoadedModule(path)) continue;
		for (const specifier of staticRelativeDependencies(readFileSync(absolute, 'utf8'))) {
			const target = resolveRelativeModule(absolute, specifier);
			if (!target) continue;
			const targetPath = relative(REPOSITORY_ROOT, target).split(sep).join('/');
			if (reasoned.has(targetPath)) continue;
			const targetOwner = ownerName(targetPath);
			if (targetOwner !== null && EAGER_CHUNK_GROUPS.has(targetOwner)) continue;
			if (owner === null && targetOwner === null) continue;
			crossings.push(`${path} [${owner ?? 'unowned, eagerly reachable'}] -> ${targetPath} [${targetOwner ?? 'unowned'}]`);
		}
	}
	return [...new Set(crossings)].sort();
}

/** The relative specifiers one module's source reaches through `import(...)`, in source order. */
export function dynamicRelativeImports(source: string): readonly string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) specifiers.push((match[1] ?? match[2])!);
	return specifiers;
}

/** The module one relative specifier names, resolved the way the bundler resolves it. */
export function resolveRelativeModule(fromPath: string, specifier: string): string | null {
	const base = resolve(dirname(fromPath), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

export function importsOnlyTypes(clause: string): boolean {
	const braces = /\{([\s\S]*)\}/u.exec(clause);
	if (!braces) return false;
	if (clause.slice(0, braces.index).trim() !== '') return false;
	const names = braces[1].split(',').map((name) => name.trim()).filter(Boolean);
	return names.length > 0 && names.every((name) => name.startsWith('type '));
}

function workerEntryModules(modules: readonly string[]): ReadonlySet<string> {
	const entries = new Set<string>();
	for (const absolute of modules) {
		for (const match of readFileSync(absolute, 'utf8').matchAll(WORKER_ENTRY_PATTERN)) {
			const target = resolveRelativeModule(absolute, match[1]!);
			if (target) entries.add(target);
		}
	}
	return entries;
}

function ownerName(path: string): string | null {
	const owner = chunkGroupForModulePath(path);
	return typeof owner === 'string' ? owner : null;
}

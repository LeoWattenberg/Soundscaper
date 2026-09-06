/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Browser coverage needs the maps that lead a bundled chunk back to `src/`, and
// the deployed site must never carry them: a map is both a debugging aid and a
// verbatim copy of the sources. So the build emits `hidden` maps — no
// `sourceMappingURL` comment, so the emitted JavaScript is byte-for-byte what a
// map-free build emits — and this moves every map out of the output directory
// before anything reads it. `dist/` and the evidence-digested browser test sites
// therefore hold exactly the files they held before, and the maps wait in a
// sibling directory that only the coverage run looks at.
const SOURCE_MAP_SUFFIX = '.map';

/** Whether this build was asked for the maps the browser coverage run reads. */
export function buildSourceMapsRequested(environment = process.env) {
	return environment.SCAPE_BUILD_SOURCE_MAPS === '1';
}

/**
 * The sibling directory that holds one build's relocated maps.
 *
 * @param {string} outputDirectory
 * @returns {string}
 */
export function sourceMapDirectoryFor(outputDirectory) {
	const trimmed = outputDirectory.replace(/[\\/]+$/u, '');
	if (trimmed === '') throw new Error('A build output directory is needed to name its source-map directory.');
	return `${trimmed}-source-maps`;
}

/**
 * Rewrite a map's `sources` to absolute `file://` URLs.
 *
 * Rolldown writes each source as a path relative to the map's own location, so a
 * map only resolves from where it was emitted. Both consumers move it: the
 * Soundscaper test site is a copy of `dist/`, and CI hands the maps to a
 * container that checks the repository out at another path. Absolute URLs
 * survive both, and they are the shape Node's own source-map cache records, so
 * c8 resolves them with no extra rules.
 *
 * @param {Record<string, unknown>} map
 * @param {string} mapDirectory the directory the map was emitted into
 * @returns {Record<string, unknown>}
 */
export function absoluteSourceMapSources(map, mapDirectory) {
	if (!Array.isArray(map.sources)) return map;
	const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
	// The embedded source text is dropped: it doubles the size of every map and
	// of every coverage shard that carries one, and c8 reads a source it is not
	// given straight from the checkout the absolute URLs below point at.
	const { sourcesContent: _embedded, ...rest } = map;
	return {
		...rest,
		sourceRoot: '',
		sources: map.sources.map((source) => absoluteSource(source, sourceRoot, mapDirectory)),
	};
}

/**
 * Move every `.map` under a finished build into its sibling directory.
 *
 * @param {string} outputDirectory
 * @returns {Promise<string[]>} the relocated file names, sorted
 */
export async function relocateEmittedSourceMaps(outputDirectory) {
	const built = resolve(outputDirectory);
	const maps = await emittedSourceMaps(built);
	const destination = sourceMapDirectoryFor(built);
	await rm(destination, { recursive: true, force: true });
	if (maps.length === 0) return [];
	await mkdir(destination, { recursive: true });

	const relocated = new Map();
	for (const mapPath of maps) {
		const name = basename(mapPath);
		const previous = relocated.get(name);
		if (previous !== undefined) {
			throw new Error(`Two emitted source maps share the file name ${name}: ${previous} and ${mapPath}.`);
		}
		relocated.set(name, mapPath);
		const map = parseSourceMap(await readFile(mapPath, 'utf8'), mapPath);
		await writeFile(join(destination, name), JSON.stringify(absoluteSourceMapSources(map, dirname(mapPath))));
		await unlink(mapPath);
	}
	return [...relocated.keys()].sort();
}

/**
 * The build plugin that performs the relocation.
 *
 * It runs on `writeBundle`, after Rolldown has written the maps beside their
 * chunks, because that is the one point where every map exists on disk no matter
 * which build stage emitted it — the main output, a worker chunk, or a plugin.
 * Everything that reads the output directory afterwards (the chunk-size guard,
 * the offline shell, the browser-site evidence digest) runs later still.
 *
 * @returns {import('vite').Plugin}
 */
export function relocateBuildSourceMaps() {
	return {
		name: 'kw-relocate-build-source-maps',
		apply: 'build',
		enforce: 'post',
		async writeBundle(options) {
			const outputDirectory = options?.dir;
			if (typeof outputDirectory !== 'string') {
				throw new Error('Source-map relocation needs the build output directory.');
			}
			const relocated = await relocateEmittedSourceMaps(outputDirectory);
			console.log(
				`Relocated ${relocated.length} source maps to ${sourceMapDirectoryFor(outputDirectory)}.`,
			);
		},
	};
}

function absoluteSource(source, sourceRoot, mapDirectory) {
	// A virtual module has no file behind it, and an absolute URL already says
	// where it lives; neither is a path this can make more resolvable.
	if (typeof source !== 'string' || source === '' || source.startsWith('\0')) return source;
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source)) return source;
	const rooted = sourceRoot === '' ? source : `${sourceRoot.replace(/\/+$/u, '')}/${source}`;
	return pathToFileURL(resolve(mapDirectory, rooted)).href;
}

function parseSourceMap(text, mapPath) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`The emitted source map ${mapPath} is not readable JSON.`, { cause: error });
	}
}

async function emittedSourceMaps(directory) {
	const found = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...await emittedSourceMaps(path));
		} else if (entry.isFile() && entry.name.endsWith(SOURCE_MAP_SUFFIX)) {
			found.push(path);
		}
	}
	return found.sort();
}

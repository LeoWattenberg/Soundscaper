/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import {
	isEagerlyLoadedModule,
	resolveRelativeModule,
	sourceModules,
	staticRelativeDependencies,
} from './helpers/eager-chunk-group-crossings.ts';

/**
 * Six delivery leaves that rode the boot graph for a feature nobody had opened.
 *
 * A flat editor module is claimed by `editor-domain` by default, and `editor-domain` is
 * eager, so a module split out of an export or analysis slice keeps riding the startup
 * graph until someone remembers it into a lazy alternation. These six were the remainder of
 * that class after `loudness-normalization-render.ts` named it: conformance findings and the
 * video conversion inventory the export service builds its report from, the burn-in font
 * loader and encoder tier the video export service resolves, the loudness report the
 * analysis service formats, and the AUP4 time-signature denominator the archive profile
 * reads. None is reachable from a product bootstrap, and every module that imports one for
 * value is lazily loaded, so each now sits with the slice that alone renders through it.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The owner each passenger takes from the importers it already has, or none. */
const DELIVERY_PASSENGERS: readonly (readonly [string, string | null])[] = [
	['src/common/editor/delivery-conformance.ts', 'editor-optional-export'],
	['src/common/editor/delivery-video-conversion-inventory.ts', 'editor-optional-export'],
	['src/common/editor/video-burn-in-font.ts', 'editor-optional-export'],
	['src/common/editor/video-delivery-encoder-tier.ts', 'editor-optional-export'],
	['src/common/editor/loudness-measurement-report.ts', 'editor-optional-execution'],
	// The archive slice has no group of its own: its modules are deliberately unowned so
	// dynamic reachability places them with the lazy action that opened them.
	['src/common/editor/aup4-time-signature.ts', null],
];

test('each delivery passenger sits with the slice that alone renders through it', () => {
	for (const [path, owner] of DELIVERY_PASSENGERS) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.equal(isEagerlyLoadedModule(path), false, `${path} must not be in a boot graph`);
	}
});

test('a passenger keeps its lazy owner only while every value importer is lazy too', () => {
	// The owner is a claim about the importers, so it has to be re-measured rather than
	// remembered: an eagerly loaded module that starts reading one of these would make its
	// whole optional chunk a boot dependency, which is worse than the passenger ever was.
	const passengers = new Map(DELIVERY_PASSENGERS
		.map(([path]) => [resolve(REPOSITORY_ROOT, path), path] as const));
	const eagerImporters: string[] = [];
	for (const directory of ['src', 'desktop', 'native']) {
		for (const absolute of sourceModules(resolve(REPOSITORY_ROOT, directory)).map((path) => resolve(path))) {
			const importer = relative(REPOSITORY_ROOT, absolute).split(sep).join('/');
			for (const specifier of staticRelativeDependencies(readFileSync(absolute, 'utf8'))) {
				const target = resolveRelativeModule(absolute, specifier);
				if (!target || !passengers.has(target)) continue;
				if (isEagerlyLoadedModule(importer)) eagerImporters.push(`${importer} -> ${passengers.get(target)!}`);
			}
		}
	}
	assert.deepEqual(eagerImporters, [], 'these importers put an optional chunk in the boot graph');
});

test('the burn-in font subsets stay eager, because the caption pipeline reads them', () => {
	// `video-burn-in-font-subsets.ts` is a different module from `video-burn-in-font.ts`,
	// one alternation character away, and `native-media-graph-plan-admission.ts` and
	// `video-caption-burn-in.ts` both read it outside the export slice.
	assert.equal(
		chunkGroupForModulePath('src/common/editor/video-burn-in-font-subsets.ts'),
		'editor-domain',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/delivery-conversion-inventory.ts'),
		'editor-domain',
	);
});

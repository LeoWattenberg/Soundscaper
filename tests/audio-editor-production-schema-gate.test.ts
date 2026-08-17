/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	isSoundscaperProductionProjectSchema,
} from '../src/common/editor/project-schema-version.ts';

test('the production authority is asked about, not compared against a revision', () => {
	assert.equal(isSoundscaperProductionProjectSchema(SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION), true);
	for (const value of [17, 19, 20, 12, 0, -21, 21.5, '21', null, undefined, {}, NaN]) {
		assert.equal(
			isSoundscaperProductionProjectSchema(value),
			false,
			`${String(value)} does not carry the production authority`,
		);
	}
});

/**
 * The guard that keeps the class of defect this predicate was extracted to fix
 * from coming back.
 *
 * Shared code used to decide "is this a production document" by comparing
 * against revision 21 exactly, in twenty places. Six of them sat on the shared
 * playback-and-export path, and none of them threw: the next Soundscaper
 * revision would simply have had its automation unscheduled, its mixer graph
 * unbuilt, and its per-track envelopes wiped mid-render, silently and only on
 * one of the two paths that must stay identical.
 *
 * Per-revision code inside a product directory is exempt, and correctly so — a
 * V21 validator must accept V21 and nothing else.
 */
test('no shared module gates behaviour on one exact production revision', () => {
	const offenders: string[] = [];
	const gate = /schemaVersion['"]?\s*\)?\s*[=!]==\s*(?:21\b|SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION)|[=!]==\s*SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION/u;

	for (const file of sourceFiles('src/common')) {
		// The predicate's own home is where the enumeration is allowed to live.
		if (file.endsWith('project-schema-version.ts')) continue;
		const source = readFileSync(file, 'utf8');
		source.split('\n').forEach((line, index) => {
			if (gate.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
		});
	}

	assert.deepEqual(
		offenders,
		[],
		`Use isSoundscaperProductionProjectSchema instead of comparing against one revision:\n${offenders.join('\n')}`,
	);
});

test('the render path in particular asks the predicate', () => {
	// Named explicitly because these are the files where getting it wrong makes
	// playback and export disagree, which is a defect rather than a gap.
	for (const file of [
		'src/common/editor/engine/project-graph.ts',
		'src/common/editor/engine/project-automation-scheduler-v21.ts',
		'src/common/editor/engine/transport-scheduler.ts',
		'src/common/editor/controller/mix-render-model.ts',
		'src/common/editor/controller/effect-audio-service.ts',
		'src/common/editor/controller/effect-macro-service.ts',
		'src/common/editor/controller/isolated-track-render-project-v21.ts',
	]) {
		assert.match(
			readFileSync(file, 'utf8'),
			/isSoundscaperProductionProjectSchema/u,
			`${file} decides render behaviour and must ask the shared predicate`,
		);
	}
});

function sourceFiles(root: string): string[] {
	const found: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory)) {
			const path = join(directory, entry);
			if (statSync(path).isDirectory()) {
				walk(path);
			} else if (/\.(?:ts|tsx|js|jsx)$/u.test(entry)) {
				found.push(path);
			}
		}
	};
	walk(root);
	return found;
}

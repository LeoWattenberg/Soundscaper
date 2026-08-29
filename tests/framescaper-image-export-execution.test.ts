/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperVideoExportImageExecutionTimelineImage as createExecution,
} from '../src/framescaper/video-export-image-execution-timeline-image.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectTimelineImage(PROFILE, {} as never) as unknown as Data;
}

function options(overrides: Data = {}): never {
	return {
		profile: PROFILE,
		project: project(),
		foundationPlan: unifiedExactPlanFixture(13),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		...overrides,
	} as unknown as never;
}

test('a project with no visible image clips composes no supplemental execution', async () => {
	assert.equal(
		await createExecution(options()),
		null,
		'an export with nothing supplemental to draw must not demand an asset store',
	);
});

test('a supplemental execution requires the authenticated runtime profile', async () => {
	await assert.rejects(() => createExecution(options({ profile: {} })), TypeError);
});

test('an already-cancelled export surfaces the caller abort reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the export');
	controller.abort(reason);

	await assert.rejects(
		() => createExecution(options({ signal: controller.signal })),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
});

test('a project that moved under the export is refused before any asset work', async () => {
	const stale = new RangeError('the project advanced under the export');

	await assert.rejects(
		() => createExecution(options({ assertCurrent: () => { throw stale; } })),
		(error: unknown) => {
			assert.equal(error, stale);
			return true;
		},
	);
});

test('cancellation is checked after the project is cloned, not before', async () => {
	const controller = new AbortController();
	controller.abort(new Error('cancelled'));

	await assert.rejects(
		() => createExecution(options({ profile: {}, signal: controller.signal })),
		TypeError,
		'an inexact profile is refused even when the export was already cancelled',
	);
});

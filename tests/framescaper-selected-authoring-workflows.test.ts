/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperCandidateAuthoringActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import {
	bindFramescaperSelectedAuthoringController,
	FRAMESCAPER_SELECTED_AUTHORING_SURFACES,
} from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import {
	FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES,
} from '../src/framescaper/editor-selected-finishing-authoring-workflows.ts';
import {
	FRAMESCAPER_SELECTED_FINISHING_DIALOG_AUTHORING_SURFACES,
} from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

function harness() {
	const commits: unknown[] = [];
	const controller = {
		project: createFramescaperProjectFinishing(PROFILE, framescaperV20Options() as never),
		getSnapshot: () => ({ selectedClipId: null }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		actions: { edit: { commit: async (command: unknown): Promise<void> => {
			commits.push(command);
		} } },
	};
	bindFramescaperSelectedAuthoringController({ controller, store: {} as never });
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(runtime);
	return { commits, runtime };
}

test('the selected binding advertises dialog and generator routes but leaves stills to image import', () => {
	const { runtime } = harness();

	assert.deepEqual(runtime.surfaces, FRAMESCAPER_SELECTED_AUTHORING_SURFACES);
	assert.deepEqual(new Set(runtime.surfaces), new Set([
		...FRAMESCAPER_SELECTED_FINISHING_DIALOG_AUTHORING_SURFACES,
		...FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES,
	]));
	assert.equal((runtime.surfaces as readonly string[]).includes('video-still'), false);
});

test('dialog-owned authoring routes cannot fall through to the legacy serialized workflow', async () => {
	const { commits, runtime } = harness();

	for (const surface of FRAMESCAPER_SELECTED_FINISHING_DIALOG_AUTHORING_SURFACES) {
		await assert.rejects(
			() => runtime.run(surface),
			/Selected visual authoring requires its menu-opened dialog/u,
		);
	}
	assert.deepEqual(commits, []);
});

test('the serialized candidate runtime commits only the directly owned generator routes', async () => {
	const { commits, runtime } = harness();

	for (const surface of FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES) {
		await runtime.run(surface);
	}

	assert.equal(commits.length, FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES.length);
	assert.ok(commits.every((command) => (
		command !== null && typeof command === 'object'
		&& (command as Record<string, unknown>).type === 'batch'
	)));
});

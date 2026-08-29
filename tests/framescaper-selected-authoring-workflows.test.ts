/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperProjectFinishing,
} from '../src/framescaper/editor-project-finishing.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	prepareFramescaperSelectedAuthoringFinishing as prepare,
} from '../src/framescaper/editor-selected-finishing-authoring-workflows.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectFinishing(
		PROFILE,
		framescaperV20Options() as never,
	) as unknown as Data;
}

function store(): never {
	return { loadSource: async () => null, saveSource: async () => undefined } as unknown as never;
}

function authored(surface: string): Promise<Data> {
	return prepare(surface as never, project(), store()) as unknown as Promise<Data>;
}

test('every generator surface prepares an authoring command', async () => {
	for (const surface of ['video-title', 'video-text', 'video-shape', 'video-solid']) {
		const prepared = await authored(surface);
		assert.ok(prepared.command, `${surface} must prepare a command`);
	}
});

test('adjustment layer and mask surfaces prepare their own commands', async () => {
	assert.ok((await authored('video-adjustment-layer')).command);
	assert.ok((await authored('video-mask-matte')).command);
});

test('a transition needs two adjacent unlinked clips before it can be authored', async () => {
	for (const surface of ['video-transition', 'video-transition-dissolve']) {
		await assert.rejects(
			() => authored(surface),
			/two adjacent unlinked video clips/u,
		);
	}
});

test('saving a visual preset needs something authored to save', async () => {
	await assert.rejects(
		() => authored('video-visual-preset'),
		/Create a generator, adjustment layer, or mask before saving a preset/u,
	);
});

test('still import is refused outside the browser editor', async () => {
	await assert.rejects(() => authored('video-still'), /requires the browser editor/u);
});

test('an unknown authoring surface is refused by name', async () => {
	await assert.rejects(
		() => authored('video-nonsense'),
		/does not activate video-nonsense/u,
	);
});

test('a project outside the Framescaper schema family cannot author anything', async () => {
	await assert.rejects(
		() => prepare('video-title' as never, { schemaFamily: 'soundscaper' } as never, store()),
		TypeError,
	);
});

test('a prepared generator command carries a fresh source and clip identity', async () => {
	const first = await authored('video-title');
	const second = await authored('video-title');

	assert.notDeepEqual(
		first.command,
		second.command,
		'each authoring pass must mint its own identities rather than reuse one',
	);
});

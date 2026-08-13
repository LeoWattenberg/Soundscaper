/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createMissingEffect } from '../src/common/editor/effects.js';
import {
	cloneFramescaperProjectHistoryV20,
	createFramescaperProjectHistoryV20,
	executeFramescaperProjectCommandV20,
	validateFramescaperProjectHistoryV20,
} from '../src/framescaper/editor-project-v20-history.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('V20 history remains total and detached for admitted binary project and command state', () => {
	const projectEffect = missingEffect('project-binary', Uint8Array.of(1, 2));
	const options = framescaperV20Options();
	(options.tracks as Record<string, unknown>[])[1]!.effects = [projectEffect];
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, options);
	let history = createFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, project,
	);
	assert.equal(validateFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history,
	), true);
	const originalProjectBytes = effectBinary(trackEffect(project, 0));
	originalProjectBytes[0] = 9;
	assert.deepEqual(effectBinary(trackEffect(history.present, 0)), Uint8Array.of(1, 2));

	const commandEffect = missingEffect('command-binary', Uint8Array.of(3, 4).buffer);
	const command: AudioEditorCommand = {
		type: 'effect/add', scope: 'track', trackId: 'audio-track', effect: commandEffect,
	};
	history = executeFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history, command,
	);
	effectBinary(commandEffect)[0] = 8;
	assert.deepEqual(effectBinary(trackEffect(history.present, 1)), Uint8Array.of(3, 4));
	assert.equal(validateFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history,
	), true);

	const clone = cloneFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history,
	);
	effectBinary(trackEffect(history.present, 1))[1] = 7;
	assert.deepEqual(effectBinary(trackEffect(clone.present, 1)), Uint8Array.of(3, 4));

	const unsupported = structuredClone(clone) as unknown as Record<string, unknown>;
	const unsupportedEffect = ((unsupported.present as { tracks: Array<{ effects: unknown[] }> })
		.tracks[1]!.effects[1]) as { opaqueAudacityNode: { node: { content: Array<{ value: unknown }> } } };
	unsupportedEffect.opaqueAudacityNode.node.content[0]!.value = new Uint16Array([1]);
	assert.throws(
		() => validateFramescaperProjectHistoryV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, unsupported),
		/supports only Uint8Array and ArrayBuffer/iu,
	);
});

function missingEffect(id: string, value: Uint8Array | ArrayBuffer) {
	return createMissingEffect({
		id,
		missing: {
			name: id, nativeId: id, reason: 'plugin-unavailable', source: 'aup4',
		},
		opaqueAudacityNode: {
			kind: 'node',
			node: { name: 'effect', content: [{ kind: 'blob', name: 'state', value }] },
		},
	});
}

function effectBinary(value: unknown): Uint8Array {
	const effect = value as {
		opaqueAudacityNode: { node: { content: Array<{ value: Uint8Array | ArrayBuffer }> } };
	};
	const result = effect.opaqueAudacityNode.node.content[0]?.value;
	assert.ok(result instanceof Uint8Array || result instanceof ArrayBuffer);
	return result instanceof Uint8Array ? result : new Uint8Array(result);
}

function trackEffect(project: unknown, index: number): unknown {
	const value = project as { tracks: Array<{ effects: unknown[] }> };
	return value.tracks[1]!.effects[index];
}

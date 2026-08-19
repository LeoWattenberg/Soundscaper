/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	rebindFramescaperMulticameraSourceIdentitiesV18,
} from '../src/framescaper/editor-multicamera-source-rebind-v18.ts';

/**
 * A reassigned source identity reaches the groups that name it.
 *
 * Importing a `.scape` into a store that already holds a source with the same id
 * reassigns the incoming one, and the generic remapper rewrites the references
 * the shared schema owns: clips, Project Bin clips, freeze roots, take groups. A
 * multicamera member's `sourceId` is Framescaper's own, and nothing rebound it —
 * so the imported group named sources the document no longer contained. Every
 * angle but the one the output clip carries became unresolvable, and switching
 * to one refused.
 */

test('a rebound source identity follows into every multicamera member', () => {
	const project = projectWithGroups();
	rebindFramescaperMulticameraSourceIdentitiesV18(project, new Map([
		['source-a', 'source-a-copy'],
		['source-b', 'source-b'],
	]));

	assert.deepEqual(
		project.multicameraGroups.map(({ members }) => members.map(({ sourceId }) => sourceId)),
		[['source-a-copy', 'source-b'], ['source-a-copy']],
	);
	// Everything else about a member is left exactly as it was.
	assert.equal(project.multicameraGroups[0]?.members[0]?.syncOffsetSamples, 8_008);
	assert.equal(project.multicameraGroups[0]?.members[0]?.id, 'camera-a');
});

test('an import that reassigned nothing leaves the groups untouched', () => {
	const project = projectWithGroups();
	const before = structuredClone(project.multicameraGroups);
	rebindFramescaperMulticameraSourceIdentitiesV18(project, new Map([
		['source-a', 'source-a'],
		['source-b', 'source-b'],
	]));
	assert.deepEqual(project.multicameraGroups, before);
});

test('a document with no groups is not a special case', () => {
	const project = { multicameraGroups: [] } as Record<string, unknown>;
	assert.doesNotThrow(() => rebindFramescaperMulticameraSourceIdentitiesV18(
		project, new Map([['source-a', 'source-a-copy']]),
	));
	assert.doesNotThrow(() => rebindFramescaperMulticameraSourceIdentitiesV18(
		{}, new Map([['source-a', 'source-a-copy']]),
	));
});

function projectWithGroups() {
	return {
		multicameraGroups: [
			{
				id: 'group-a', projectId: 'p', sequenceId: 'main-sequence',
				outputClipId: 'output-clip', activeMemberId: 'camera-a',
				members: [
					{ id: 'camera-a', groupId: 'group-a', sourceId: 'source-a', syncOffsetSamples: 8_008 },
					{ id: 'camera-b', groupId: 'group-a', sourceId: 'source-b', syncOffsetSamples: 0 },
				],
			},
			{
				id: 'group-b', projectId: 'p', sequenceId: 'main-sequence',
				outputClipId: 'second-clip', activeMemberId: 'camera-c',
				members: [
					{ id: 'camera-c', groupId: 'group-b', sourceId: 'source-a', syncOffsetSamples: 0 },
				],
			},
		],
	} as unknown as {
		multicameraGroups: {
			members: { id: string; sourceId: string; syncOffsetSamples: number }[];
		}[];
	};
}

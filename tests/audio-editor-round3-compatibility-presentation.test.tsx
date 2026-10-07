/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useCompatibilityOwnerLookup, useFeatureAffectedLookup } from '../src/common/editor/ui/dialogs/useCompatibilityPresentation.ts';
import type { ProjectFeatureAffectedObjectIndex } from '../src/common/editor/project-feature-affected-objects.ts';

void test('compatibility owner and requirement queries use prepared indexes and retain authored first-match order', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let ownerReads = 0, requirementReads = 0, objectReads = 0;
	const tracks = Array.from({ length: 4000 }, (_, index) => ({ get id() { ownerReads++; return `track${index}`; }, name: `Track ${index}` }));
	const project = { tracks: [...tracks, { id: 'track1', name: 'Duplicate' }] };
	let index: ProjectFeatureAffectedObjectIndex = { schemaVersion: 1, truncated: false, requirements: Array.from({ length: 1000 }, (_, value) => ({
		get requirementId() { requirementReads++; return `requirement${value}`; }, featureId: 'future', availability: 'unknown', attributable: true, omittedObjectCount: 0,
		objects: [{ channel: 'audio-effect', location: 'mixer', scope: 'track', ownerId: 'track1', objectId: 'effect', objectType: 'foreign', get registered() { objectReads++; return false; } }],
	})) };
	let owners: ReturnType<typeof useCompatibilityOwnerLookup>, affected: ReturnType<typeof useFeatureAffectedLookup>;
	function Harness({ revision }: { revision: number }) { owners = useCompatibilityOwnerLookup(project); affected = useFeatureAffectedLookup(index); return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); assert.equal(owners!('track', 'track1')?.name, 'Track 1');
		const work = { ownerReads, requirementReads, objectReads };
		for (let revision = 1; revision <= 30; revision++) { await act(async () => root.render(<Harness revision={revision} />)); assert.equal(owners!('track', 'track3999')?.name, 'Track 3999'); assert.equal(affected!.get('requirement999')?.objects.length, 1); }
		assert.deepEqual({ ownerReads, requirementReads, objectReads }, work); assert.equal(owners!('timeline', 'missing'), undefined);
		index = { ...index, requirements: [{ ...index.requirements[0]!, omittedObjectCount: 3 }] }; await act(async () => root.render(<Harness revision={31} />));
		assert.equal(affected!.get('requirement0')?.omittedObjectCount, 3);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

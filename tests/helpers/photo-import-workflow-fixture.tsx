/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import React from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibrarySessionPortV1 } from '../../src/common/editor/photo-library-session-port-v1.ts';
import { usePhotoLibraryWorkflow } from '../../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { mountPhotoImportUi } from './photo-import-options-react-fixture.tsx';

export function createImportTestPort(): PhotoLibrarySessionPortV1 {
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected photo operation in import fixture.'); };
	return { readPage: async () => ({ catalogName: 'Library', totalCount: 0, rows: [], cursor: null }),
		readQueryStep: unexpected, rebuildQueryStep: unexpected, readDefinitionPage: unexpected, readDefinition: unexpected,
		applyDefinition: unexpected, readMemberships: unexpected, applyMemberships: unexpected, readPreview: unexpected,
		importFiles: unexpected, setRating: unexpected, applyAttributes: unexpected, readMetadata: unexpected, applyMetadata: unexpected,
		readImportPresets: unexpected, applyImportPreset: unexpected, close: async () => undefined };
}

export async function mountImportWorkflow(initialFactory: CreatePhotoLibrarySessionV1) {
	let factory = initialFactory, state: ReturnType<typeof usePhotoLibraryWorkflow> | undefined;
	function Harness() { state = usePhotoLibraryWorkflow(factory); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	return { ...mounted, get current() { assert.ok(state); return state; },
		async replace(next: CreatePhotoLibrarySessionV1) { factory = next; await mounted.render(); } };
}

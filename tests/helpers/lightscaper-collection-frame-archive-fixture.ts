/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeFramescaperImageSourceV2 } from '../../src/common/editor/timeline-image-model-v2.ts';
import { openFramescaperCurrentImageFrameSource } from '../../src/framescaper/timeline-image-current-frame-source.ts';

/** Native browser recipient for a real menu-produced collection archive.
 * Imports through Frame's current Scape/storage owners, then reads its saved
 * project and actual recipe-rendered frames. This exercises those owners in
 * the Light origin; it makes no separate-origin Frame application UI claim. */
export async function inspectCollectionFramescaperArchiveFixture(bytes: readonly number[]) {
	if (bytes.length < 1 || bytes.length > 256 * 1024 * 1024) throw new RangeError('Collection fixture archive exceeds its input bound.');
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: globalThis.indexedDB }), signal = new AbortController().signal;
	try {
		const result = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(new Blob([new Uint8Array(bytes)]), store, { signal });
		if (result.readOnly) throw new Error('The collection must remain editable in the current recipient.');
		const project = cloneFramescaperProject(PROFILE, result.project);
		if (project.sources.length > 16) throw new RangeError('Collection fixture exceeds its observation bound.');
		const images = [];
		for (const value of project.sources) {
			const source = normalizeFramescaperImageSourceV2(value), reader = await openFramescaperCurrentImageFrameSource(store, source, signal);
			try {
				const original = await reader.readOriginal();
				try {
					const pixels = await reader.readFrame(0);
					try { images.push({ sourceId: source.id, original: [...original], pixels: [...pixels] }); }
					finally { pixels.fill(0); }
				} finally { original.fill(0); }
			} finally { await reader.closeAndJoin(); }
		}
		const saved = await store.loadProject(project.id);
		if (!saved) throw new ReferenceError('The recipient did not retain its collection project.');
		return { project, saved: cloneFramescaperProject(PROFILE, saved), images };
	} finally { await store.close(); }
}

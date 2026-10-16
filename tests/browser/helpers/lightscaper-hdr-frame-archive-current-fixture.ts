/* SPDX-License-Identifier: AGPL-3.0-only */
import { createFramescaperProjectStore } from '../../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-project-runtime-profile.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { hdrFrameFixtureCurrentV1, HDR_FRAME_SAMPLES } from '../../helpers/lightscaper-hdr-frame-current-fixture.ts';
import { createInstrumentedIndexedDB } from '../../helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from '../../helpers/instrumented-indexeddb-keys.ts';

/** Node-only fixture creation uses the actual Source5/FramePack and native
 * Scape exporter over an explicitly modeled IDB transport. This fixture is
 * not evidence of menu-driven HDR creation or exposure reconstruction. */
export async function createHdrFrameArchiveCurrentV1() {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try {
		const f = await hdrFrameFixtureCurrentV1(normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [
			{ id: 'hdr-exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: -2 } },
		] }));
		await store.writeMediaAsset(f.source.storageKey, f.body, { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
		const project = f.project();
		if (!await store.createScapeProjectIfAbsent(project)) throw new Error('HDR browser fixture project was not published.');
		const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
		if (!archive.blob) throw new Error('HDR browser fixture export did not produce a native archive.');
		return { archive: new Uint8Array(await archive.blob.arrayBuffer()), source: f.source, projectId: project.id,
			clipId: 'hdr-clip', original: new Uint8Array(f.original), samples: [...Float32Array.from(HDR_FRAME_SAMPLES)],
			cache: [1, 2, 3, 255, 4, 5, 6, 255] };
	} finally {
		try { await store.close(); }
		finally { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); }
	}
}

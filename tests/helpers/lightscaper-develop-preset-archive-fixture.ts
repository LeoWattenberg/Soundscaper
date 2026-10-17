/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from '../../src/common/editor/scape-byte-stream.ts';
import type { ScapeManifest } from '../../src/common/editor/scape-archive-envelope.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND, PHOTO_DEVELOP_PRESET_PACK_ENCODING } from '../../src/common/editor/scape-photo-develop-preset-pack.ts';
import { createImageDevelopPresetV1 } from '../../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizePhotoDevelopPresetRowV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { savedArchiveFixtureV3, savedArchiveDefinitionV3, savedArchiveDestinationV3 } from './lightscaper-saved-collection-archive-fixture.ts';
import { rewriteStackArchive, editStackArchiveDocument } from './lightscaper-stack-archive-fixture.ts';

export function developPresetArchiveRow(revision = 91, count = 2, name = 'Night 界') {
	const settings = copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(),
		selection: { effectTypes: 'all', geometry: true, localAdjustments: true } });
	return normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog-1', revision,
		presets: Array.from({ length: count }, (_, index) => createImageDevelopPresetV1({ schemaVersion: 1,
			id: `preset-${String(index + 1)}`, name: `${name} ${String(index + 1)}`, settings })) }, 'catalog-1');
}

export function developPresetArchiveRichRow() {
	const develop = normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(),
		effects: [{ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 23, tint: -17 } },
			{ id: 'tone', type: 'tone-ladder-v1', enabled: false, params: { exposure: 1.25, shadows: 32 } }],
		geometry: { crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, rotationDegrees: 15, flipHorizontal: true, flipVertical: false },
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'shape',
			nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'ellipse', x: 0.2, y: 0, width: 0.5, height: 1 }] }],
		maskBindings: [{ effectId: 'tone', maskId: 'mask' }] });
	return normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog-1', revision: 51,
		presets: ['all', ['tone-ladder-v1']].map((effectTypes, index) => createImageDevelopPresetV1({ schemaVersion: 1,
			id: `rich-${String(index)}`, name: 'Shared local recipe', settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop,
				selection: { effectTypes, geometry: index === 0, localAdjustments: true } }) })) }, 'catalog-1');
}

/** Authenticated synthetic ZIPs exercise codec authority; they are not production export evidence. */
export async function developPresetArchiveFixture(row: unknown = developPresetArchiveRow(),
	header?: Readonly<{ revision: number; presetCount: number }>): Promise<Blob> {
	return rewriteStackArchive(await savedArchiveFixtureV3([[savedArchiveDefinitionV3()]]), entries => {
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as ScapeManifest;
		const entry = 'assets/develop-presets-v1.bin';
		if (row !== null) {
			const bytes = new TextEncoder().encode(JSON.stringify(row)); entries.set(entry, bytes);
			manifest.assets.push({ sourceId: 'develop-presets', entry, kind: PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND,
				encoding: PHOTO_DEVELOP_PRESET_PACK_ENCODING, size: bytes.byteLength, sha256: digestScapeBytes(bytes) });
		}
		entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
		editStackArchiveDocument(entries, document => {
			const value = row as ReturnType<typeof developPresetArchiveRow>;
			document.schemaVersion = 4; document.developPresetPack = row === null ? null : {
				id: 'develop-presets', entry, revision: header?.revision ?? value.revision,
				presetCount: header?.presetCount ?? value.presets.length,
			};
		});
	});
}

export function developPresetArchiveDestination() {
	const target = savedArchiveDestinationV3(); let row: ReturnType<typeof developPresetArchiveRow> | null = null;
	return { ...target, get row() { return row; }, stage: { ...target.stage,
		async writeDevelopPresets(value: ReturnType<typeof developPresetArchiveRow>) { row = value; target.events.push('presets'); },
		async rollback() { row = null; await target.stage.rollback(); },
	} };
}

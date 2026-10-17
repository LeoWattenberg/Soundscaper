/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import PhotoDevelopSettingsMenu from '../src/common/editor/ui/lightscaper/PhotoDevelopSettingsMenu.tsx';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { PhotoLibraryDevelopSettingsWorkflowV1 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import type { PhotoDevelopResolutionV1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const locale of ['en', 'de']) test(`${locale}: full resolution is opt-in through the existing Settings menu and cannot author catalog settings`, async () => {
	let operations = 0, changes = 0, live = true, available = true, disabled = false;
	const owner = new PhotoLibraryDevelopSettingsWorkflowV1({ execute: async () => { operations++; throw Error('Zoom cannot author a recipe'); } });
	const copy = photoDevelopSettingsCopy(locale), full = locale === 'de' ? 'Volle Auflösung (100 %)' : 'Full resolution (100%)';
	const fit = locale === 'de' ? 'Vorschaubild einpassen' : 'Fit-screen proxy';
	function View() {
		const [resolution, setResolution] = useState<PhotoDevelopResolutionV1>('proxy');
		return <PhotoDevelopSettingsMenu locale={locale} owner={owner} snapshot={owner.snapshot()}
			source={{ catalogId: 'catalog', photoId: 'photo', versionId: 'master', revision: 0, develop: defaultImageDevelopStateV1() }}
			selectedIds={['photo']} disabled={disabled} dirty={false} isCurrent={() => live} onChanged={async () => { throw Error('Zoom cannot refresh authored state'); }}
			resolution={{ value: resolution, fullAvailable: available, onChange: next => { changes++; setResolution(next); } }} />;
	}
	const mounted = await mountPhotoImportUi(() => <View />);
	const button = (label: string): ReactTestElement => {
		const target = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(target, label); return target;
	};
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); }); };
	try {
		assert.equal(button(full).closest('details')?.querySelector('summary')?.textContent, copy.menu);
		assert.equal(button(full).closest('details')?.hasAttribute('open'), false);
		assert.equal(button(fit).getAttribute('aria-pressed'), 'true'); assert.equal(button(full).getAttribute('aria-pressed'), 'false');
		await click(full); assert.equal(button(full).getAttribute('aria-pressed'), 'true');
		await click(fit); assert.equal(button(fit).getAttribute('aria-pressed'), 'true');
		assert.equal(changes, 2); assert.equal(operations, 0);
		available = false; await mounted.render(); assert.ok(button(full).hasAttribute('disabled')); await click(full); assert.equal(changes, 2);
		available = true; disabled = true; await mounted.render(); await click(full); assert.equal(changes, 2);
		disabled = false; live = false; await mounted.render(); await click(full); assert.equal(changes, 2);
	} finally { await mounted.dispose(); await owner.close(); }
});

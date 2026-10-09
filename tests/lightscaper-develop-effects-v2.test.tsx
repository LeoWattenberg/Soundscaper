/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopEffectsV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopEffectsV2.tsx';
import { PhotoLibraryDevelopWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';

for (const locale of ['en', 'de']) test(`${locale}: current effect picker authors null/ref profiles without a V1 cast and preserves accepted numeric cancellation`, async () => {
	const fixture = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => fixture.develop, isCurrent: () => true, refresh: async () => undefined });
	} });
	await owner.open(fixture.photos[0]!.id); const messages = photoDevelopCopy(locale), before = await fixture.repository.loadPhoto('catalog-1', fixture.photos[0]!.id);
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopEffectsV2 effects={owner.snapshot().draft!.effects} owner={owner}
		messages={messages} disabled={false} isCurrent={() => true} onImportPending={() => undefined} registerImportRetirement={() => () => undefined} />);
	const click = async (text: string) => { const button = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === text); assert.ok(button, text);
		await act(async () => { reactProps(button).onClick?.({}); await settle(); }); await mounted.render(); };
	try {
		await mounted.event('select', 'onChange', { currentTarget: { value: 'cube-lut-profile-v1' } }); await click(messages.add);
		assert.equal(owner.snapshot().draft!.processVersion, 2); assert.equal(owner.snapshot().draft!.effects[0]!.params.lut, null);
		const ref = currentRecipe().effects[0]!.params.lut; owner.setEffects([{ ...owner.snapshot().draft!.effects[0]!, enabled: false, params: { lut: ref } }]); await mounted.render();
		await mounted.event('select', 'onChange', { currentTarget: { value: 'white-balance-v1' } }); await click(messages.add);
		const label = `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamTemperature}`;
		const input = mounted.dom.container.querySelectorAll('input').find(element => element.getAttribute('aria-label') === label); assert.ok(input);
		await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value: '101', valueAsNumber: 101 } });
			reactProps(input).onKeyDown?.({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); }); await mounted.render();
		assert.equal(mounted.dom.find('[role="alert"]'), null); assert.deepEqual(owner.snapshot().draft!.effects[0]!.params.lut, ref);
		assert.equal(owner.snapshot().draft!.effects[1]!.params.temperature, 0); assert.deepEqual(await fixture.repository.loadPhoto('catalog-1', fixture.photos[0]!.id), before);
	} finally { await mounted.dispose(); await owner.close(); await fixture.close(); }
});

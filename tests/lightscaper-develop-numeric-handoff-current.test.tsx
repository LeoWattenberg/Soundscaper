/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect, useState } from 'react';
import PhotoDevelopEffectsV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopEffectsV2.tsx';
import { PhotoLibraryDevelopWorkflowCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

for (const locale of ['en', 'de'] as const) {
	test(`${locale}: Current mounted numeric controls retain rapid crop, rotation and flip through native Save`, async () => {
		const f = await fixture(locale), before = await f.native.read(), original = (await f.native.inspect())[0]!;
		try {
			const crop = reactProps(f.number('videoEffectParamCropY')), rotation = reactProps(f.number('videoEffectParamGeometryRotation')),
				flip = reactProps(f.select('videoEffectParamFlipHorizontal'));
			// These are distinct still-mounted controls from one committed render.
			// The real workflow publishes synchronously; React's parent update is
			// intentionally batched until the complete keyboard/focus handoff ends.
			await act(async () => {
				crop.onFocus?.({}); crop.onChange?.({ currentTarget: { value: '0.5', valueAsNumber: .5 } }); enter(crop);
				rotation.onFocus?.({}); rotation.onChange?.({ currentTarget: { value: '90', valueAsNumber: 90 } }); enter(rotation);
				flip.onChange?.({ currentTarget: { value: '1' } });
			});
			const expected = createVideoEffectV2('develop-geometry-v1', { id: 'geometry', params: {
				cropX: .5, cropY: .5, cropWidth: .5, cropHeight: .25, rotationDegrees: 90, flipHorizontal: 1,
			} });
			assert.deepEqual(f.owner.snapshot().draft!.effects, [expected], 'Every mounted control must update the same owned draft.');
			assert.equal(f.number('videoEffectParamGeometryRotation').value, '90');
			// The minimal tree marks OPTION.selected but does not derive SELECT.value.
			assert.equal(reactProps(f.select('videoEffectParamFlipHorizontal')).value, 1);
			assert.deepEqual(await f.native.read(), before, 'Rapid controls cannot publish before Save.');
			let acknowledged = false;
			await act(async () => { acknowledged = await f.owner.save('Crop, rotate and flip') !== null; });
			assert.equal(acknowledged, true);
			const saved = await f.native.read();
			assert.equal(saved.revision, before.revision + 1);
			assert.equal(saved.history.entries.length, before.history.entries.length + 1);
			assert.equal(saved.history.cursor, saved.history.entries.length - 1);
			assert.deepEqual(saved.develop, { ...before.develop, effects: [expected] });
			const custody = (await f.native.inspect())[0]!;
			assert.deepEqual(custody.photo.original, original.photo.original);
			assert.deepEqual(custody.photo.metadata, original.photo.metadata);
			assert.deepEqual(custody.bytes, original.bytes);
		} finally { await f.close(); }
	});

	test(`${locale}: disabling a Current effect refuses its retained same-render numeric and select callbacks`, async () => {
		const f = await fixture(locale), before = await f.native.read(), custody = await f.native.inspect();
		try {
			const original = f.owner.snapshot().draft!.effects[0]!, checkbox = reactProps(f.checkbox()),
				numeric = reactProps(f.number('videoEffectParamGeometryRotation')), flip = reactProps(f.select('videoEffectParamFlipHorizontal'));
			await act(async () => {
				checkbox.onChange?.({ currentTarget: { checked: false } });
				numeric.onFocus?.({}); numeric.onChange?.({ currentTarget: { value: '90', valueAsNumber: 90 } }); enter(numeric);
				flip.onChange?.({ currentTarget: { value: '1' } });
			});
			assert.deepEqual(f.owner.snapshot().draft!.effects, [{ ...original, enabled: false }],
				'Disabling the effect must revoke its numeric and select edits before React disables the DOM controls.');
			assert.deepEqual(await f.native.read(), before, 'Disabling and refused callbacks remain local until Save.');
			assert.deepEqual(await f.native.inspect(), custody);
		} finally { await f.close(); }
	});

	test(`${locale}: Current numeric handoff refuses superseded render callbacks and external draft changes`, async () => {
		const f = await fixture(locale), before = await f.native.read();
		try {
			const superseded = reactProps(f.number('videoEffectParamGeometryRotation'));
			const crop = reactProps(f.number('videoEffectParamCropY'));
			await act(async () => { crop.onFocus?.({}); crop.onChange?.({ currentTarget: { value: '0.5', valueAsNumber: .5 } }); });
			const accepted = f.owner.snapshot().draft;
			await act(async () => { superseded.onFocus?.({}); superseded.onChange?.({ currentTarget: { value: '90', valueAsNumber: 90 } }); enter(superseded); });
			assert.strictEqual(f.owner.snapshot().draft, accepted, 'An older rendered handler cannot join a newer rendered draft.');
			const numeric = reactProps(f.number('videoEffectParamGeometryRotation')), flip = reactProps(f.select('videoEffectParamFlipHorizontal'));
			let external = accepted;
			await act(async () => {
				const draft = f.owner.snapshot().draft; assert.ok(draft && draft.processVersion !== 1);
				f.owner.edit({ ...draft, effects: [createVideoEffectV2('white-balance-v1', { id: 'external', params: { temperature: 20 } })] });
				external = f.owner.snapshot().draft;
				numeric.onFocus?.({}); numeric.onChange?.({ currentTarget: { value: '90', valueAsNumber: 90 } }); enter(numeric);
				flip.onChange?.({ currentTarget: { value: '1' } });
			});
			assert.strictEqual(f.owner.snapshot().draft, external, 'Only edits published by these mounted controls may advance their handoff.');
			assert.equal(f.owner.snapshot().draft!.effects[0]!.type, 'white-balance-v1');
			assert.deepEqual(await f.native.read(), before);
		} finally { await f.close(); }
	});

	test(`${locale}: Escape clears a rejected rotation after the same-render accepted crop`, async () => {
		const f = await fixture(locale), before = await f.native.read();
		try {
			assert.throws(() => createVideoEffectV2('develop-geometry-v1', { id: 'invalid', params: { rotationDegrees: 181 } }),
				'181 must exercise the actual bounded geometry validator.');
			const crop = reactProps(f.number('videoEffectParamCropY')), rotation = reactProps(f.number('videoEffectParamGeometryRotation'));
			let accepted = f.owner.snapshot().draft;
			await act(async () => {
				crop.onFocus?.({}); crop.onChange?.({ currentTarget: { value: '0.5', valueAsNumber: .5 } }); enter(crop);
				accepted = f.owner.snapshot().draft;
				rotation.onFocus?.({}); rotation.onChange?.({ currentTarget: { value: '181', valueAsNumber: 181 } });
			});
			assert.equal(accepted!.effects[0]!.params.cropY, .5);
			assert.equal(accepted!.effects[0]!.params.rotationDegrees, 0);
			assert.strictEqual(f.owner.snapshot().draft, accepted, 'Invalid rotation cannot replace the accepted crop draft.');
			assert.ok(f.dom.find('[role="alert"]'), 'The invalid rotation must report a validation refusal first.');
			// The parent has now committed its accepted crop; Escape belongs to
			// the current control rather than the retained pre-crop callback.
			await act(async () => { reactProps(f.number('videoEffectParamGeometryRotation')).onKeyDown?.({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
			assert.strictEqual(f.owner.snapshot().draft, accepted, 'Cancel restores only the rotation gesture and retains the accepted crop.');
			assert.equal(f.number('videoEffectParamGeometryRotation').value, '0');
			assert.equal(f.dom.find('[role="alert"]'), null, 'Escape must clear the refusal attached to this cancelled rotation gesture.');
			assert.deepEqual(await f.native.read(), before, 'The draft and its cancelled invalid gesture cannot publish without Save.');
		} finally { await f.close(); }
	});
}

function enter(props: ReturnType<typeof reactProps>) {
	props.onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
}

async function fixture(locale: 'en' | 'de') {
	const native = await repairSettingsFixture(1), owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: native.execute });
	await owner.open(native.photos[0]!.id);
	owner.setEffects([createVideoEffectV2('develop-geometry-v1', { id: 'geometry', params: { cropX: .5, cropWidth: .5, cropHeight: .25 } })]);
	const messages = photoDevelopCopy(locale);
	function Harness() {
		const [view, setView] = useState(owner.snapshot());
		useEffect(() => owner.subscribe(setView), []);
		return <PhotoDevelopEffectsV2 effects={view.draft!.effects} owner={owner} messages={messages} disabled={view.busy} isCurrent={() => true}
			onImportPending={() => undefined} registerImportRetirement={() => () => undefined} />;
	}
	const mounted = await mountPhotoImportUi(() => <Harness />);
	const control = (tag: 'input' | 'select', key: string) => {
		const label = `${messages.shared.videoEffectExactValue}: ${messages.shared[key]}`;
		const node = mounted.dom.container.querySelectorAll(tag).find(value => value.getAttribute('aria-label') === label);
		assert.ok(node, label); return node;
	};
	return { native, owner, dom: mounted.dom, number: (key: string) => control('input', key), select: (key: string) => control('select', key),
		checkbox() { const node = mounted.dom.container.querySelectorAll('input').find(value => value.type === 'checkbox'); assert.ok(node); return node; },
		async close() { try { await mounted.dispose(); } finally { try { await owner.close(); } finally { await native.close(); } } },
	};
}

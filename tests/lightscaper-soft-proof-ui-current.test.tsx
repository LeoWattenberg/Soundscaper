/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopWorkspaceCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import PhotoDevelopSoftProofDialogCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopSoftProofDialogCurrentV1.tsx';
import { usePhotoDevelopSettingsCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-develop-settings-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';
import type { ImageOutputSoftProofCurrentV1 } from '../src/common/editor/imaging/image-output-soft-proof-current-v1.ts';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';

for (const locale of ['en', 'de']) test(`${locale}: actual Current Develop opens temporary soft proof from Settings and keeps the native document unchanged`, async () => {
	const f = await repairSettingsFixture(1), canvas = currentAppCanvasBoundary(), before = await f.inspect();
	const generation = {}, readPreview = async () => ({ outcome: 'missing' as const }), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const loadProxy = async () => runtime, beforePresent = Promise.resolve(), retirements = new Set<() => Promise<void>>();
	const registerRetirement = (retire: () => Promise<void>) => { retirements.add(retire); return () => { retirements.delete(retire); }; };
	function View() {
		const settings = usePhotoDevelopSettingsCurrentV1({ generation, execute: f.execute });
		return <PhotoDevelopWorkspaceCurrentV1 locale={locale} photoId={f.photos[0]!.id} catalogId={f.photos[0]!.catalogId}
			label="Selected photo" generation={generation} execute={f.execute} readPreview={readPreview} loadProxy={loadProxy}
			settingsCurrent={settings} beforePresent={beforePresent} registerRetirement={registerRetirement} onClose={() => undefined} />;
	}
	const mounted = await mountPhotoImportUi(() => <View />);
	const label = locale === 'de' ? 'Softproof…' : 'Soft proof…', title = locale === 'de' ? 'Softproof' : 'Soft proof';
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-develop-workspace]') !== null
			&& mounted.dom.container.querySelectorAll('details').some(node => node.getAttribute('class')?.includes('lightscaper-develop-settings-menu')); }, 'actual Current Settings menu');
		const button = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(button, 'Soft proof must be reachable through the existing Settings menu.');
		assert.equal(button.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Einstellungen' : 'Settings');
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').some(node => node.getAttribute('aria-label') === title), false);
		const staleProof = reactProps(button).onClick!, masks = photoDevelopMaskManagementCopy(locale);
		const manage = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === masks.menu); assert.ok(manage);
		await act(async () => { reactProps(manage).onClick?.({}); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-develop-mask-manager]') !== null; }, 'existing mask modal');
		await act(async () => { staleProof({}); await settle(); });
		assert.ok(mounted.dom.find('[data-photo-develop-mask-manager]'), 'A retained soft-proof menu handler cannot replace another local modal.');
		assert.equal(mounted.dom.find('[data-photo-develop-soft-proof-profile]'), null);
		const maskDialog = mounted.dom.container.querySelectorAll('[role="dialog"]').find(node => node.getAttribute('aria-label') === masks.title)!;
		const maskClose = maskDialog.querySelectorAll('button').find(node => node.textContent === masks.close); assert.ok(maskClose);
		await act(async () => { reactProps(maskClose).onClick?.({}); await settle(); });
		await act(async () => { reactProps(button).onClick?.({}); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.container.querySelectorAll('[role="dialog"]').some(node => node.getAttribute('aria-label') === title); }, 'menu-owned soft-proof dialog');
		const dialog = mounted.dom.container.querySelectorAll('[role="dialog"]').find(node => node.getAttribute('aria-label') === title)!;
		const select = dialog.querySelector('[data-photo-develop-soft-proof-profile]'); assert.ok(select);
		assert.equal(reactProps(select).value, 'off');
		await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: 'srgb' } }); await settle(); });
		const depth = dialog.querySelector('[data-photo-develop-soft-proof-depth]'); assert.ok(depth);
		await act(async () => { reactProps(depth).onChange?.({ currentTarget: { value: '16' } }); await settle(); });
		const apply = dialog.querySelector('[data-photo-develop-soft-proof-apply]'); assert.ok(apply);
		await act(async () => { reactProps(apply).onClick?.({}); await settle(); });
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').some(node => node.getAttribute('aria-label') === title), false);
		assert.deepEqual(await f.inspect(), before, 'Temporary proof does not save a recipe, history entry, preset or Original.');
		await act(async () => { reactProps(button).onClick?.({}); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-develop-soft-proof-profile]') !== null; }, 'retained temporary proof choice');
		assert.equal(reactProps(mounted.dom.one('[data-photo-develop-soft-proof-profile]')).value, 'srgb');
		assert.equal(reactProps(mounted.dom.one('[data-photo-develop-soft-proof-depth]')).value, 16);
	} finally { const joins = [...retirements]; await mounted.dispose(); await Promise.allSettled(joins.map(retire => retire())); canvas.restore(); await f.close(); }
});

test('soft-proof dialog refuses unsupported native P3, allows explicit sRGB/Off and never silently substitutes a profile', async () => {
	// This boundary reports only sRGB. The production capability probe runs;
	// the test supplies no approval flag or replacement probe implementation.
	const canvas = currentAppCanvasBoundary(), applied: (Readonly<ImageOutputSoftProofCurrentV1> | undefined)[] = [];
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopSoftProofDialogCurrentV1 locale="en" isCurrent={() => true}
		onApply={value => { applied.push(value); }} onClose={() => undefined} />);
	const choose = async (selector: string, value: string) => { await act(async () => { reactProps(mounted.dom.one(selector)).onChange?.({ currentTarget: { value } }); await settle(); }); };
	const apply = async () => { await act(async () => { reactProps(mounted.dom.one('[data-photo-develop-soft-proof-apply]')).onClick?.({}); await settle(); }); };
	try {
		await choose('[data-photo-develop-soft-proof-profile]', 'display-p3'); await choose('[data-photo-develop-soft-proof-depth]', '16'); await apply();
		assert.deepEqual(applied, []); assert.ok(mounted.dom.find('[role="alert"]'));
		assert.equal(reactProps(mounted.dom.one('[data-photo-develop-soft-proof-profile]')).value, 'display-p3');
		await choose('[data-photo-develop-soft-proof-profile]', 'srgb'); assert.equal(mounted.dom.find('[role="alert"]'), null); await apply();
		assert.deepEqual(applied, [{ profile: 'srgb', bitDepth: 16 }]); assert.ok(Object.isFrozen(applied[0]));
		await choose('[data-photo-develop-soft-proof-profile]', 'off'); await apply(); assert.deepEqual(applied, [{ profile: 'srgb', bitDepth: 16 }, undefined]);
	} finally { await mounted.dispose(); canvas.restore(); }
});

test('retained soft-proof dialog handlers cannot apply after presentation replacement, disabled state or source retirement', async () => {
	let disabled = false, live = true, applications = 0, closes = 0, disposed = false;
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopSoftProofDialogCurrentV1 locale="en" disabled={disabled}
		isCurrent={() => live} onApply={() => { applications++; }} onClose={() => { closes++; }} />);
	try {
		const stale = reactProps(mounted.dom.one('[data-photo-develop-soft-proof-apply]')).onClick!;
		disabled = true; await mounted.render();
		await act(async () => { stale({}); reactProps(mounted.dom.one('[data-photo-develop-soft-proof-apply]')).onClick?.({}); await settle(); }); assert.equal(applications, 0);
		const close = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === 'Close'); assert.ok(close);
		await act(async () => { reactProps(close).onClick?.({}); }); assert.equal(closes, 1, 'Close remains available while presentation controls are disabled.');
		disabled = false; await mounted.render(); live = false;
		await act(async () => { reactProps(mounted.dom.one('[data-photo-develop-soft-proof-apply]')).onClick?.({}); await settle(); }); assert.equal(applications, 0);
		live = true; const retired = reactProps(mounted.dom.one('[data-photo-develop-soft-proof-apply]')).onClick!;
		await mounted.dispose(); disposed = true; retired({}); assert.equal(applications, 0, 'Unmount retires retained handlers even if a caller still reports current.');
	} finally { if (!disposed) await mounted.dispose(); }
});

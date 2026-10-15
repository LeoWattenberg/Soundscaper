/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopMaskManagerV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopMaskManagerV1.tsx';
import PhotoDevelopRangeMaskDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopRangeMaskDialogV1.tsx';
import PhotoDevelopGradientDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopGradientDialogV1.tsx';
import PhotoDevelopBrushMaskDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopBrushMaskDialogV1.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopBrushMaskCopy } from '../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from '../src/common/editor/photo-library-develop-mask-raster-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { gradientGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import { settle } from './helpers/async-test-control.ts';

for (const locale of ['en', 'de']) for (const kind of ['manager', 'luminance-range', 'color-range', 'brush', 'linear-gradient', 'radial-gradient'] as const) {
	test(`${locale}: ${kind} offers color adjustments and excludes manual lens and projective geometry from mask bindings`, async () => {
		const develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: [
			createVideoEffect('white-balance-v1', { id: 'color' }), createVideoEffect('develop-geometry-v1', { id: 'geometry' }),
			createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 25 } }),
		], masks: [gradientGraph()], maskBindings: [{ effectId: 'color', maskId: 'mask' }] });
		const before = JSON.stringify(develop), retirements = new Set<() => Promise<void>>(); let calls = 0;
		const port: PhotoLibraryDevelopMaskRasterPortV1 = { schemaVersion: 1,
			source: { async withBytes() { calls++; assert.fail('A new empty brush must not acquire a saved resource.'); } },
			async install() { calls++; assert.fail('Merely viewing binding choices cannot install a brush.'); },
		};
		const common = { develop, locale, isCurrent: () => true, onApply: () => assert.fail('Viewing a picker cannot apply a recipe.'), onClose: () => undefined };
		const mounted = await mountPhotoImportUi(() => kind === 'manager' ? <PhotoDevelopMaskManagerV1 {...common} />
			: kind === 'brush' ? <PhotoDevelopBrushMaskDialogV1 {...common} port={port}
				registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />
				: kind === 'linear-gradient' || kind === 'radial-gradient' ? <PhotoDevelopGradientDialogV1 {...common} kind={kind} />
					: <PhotoDevelopRangeMaskDialogV1 {...common} kind={kind} />);
		try {
			await act(async () => { await settle(); });
			if (kind === 'manager') {
				assert.deepEqual(mounted.dom.container.querySelectorAll('input').filter(node => node.hasAttribute('data-photo-develop-mask-binding'))
					.map(node => node.getAttribute('data-photo-develop-mask-binding')), ['color']);
			} else {
				const bind = kind === 'brush' ? photoDevelopBrushMaskCopy(locale).bind : photoDevelopLocalAdjustmentsCopy(locale, kind).bind;
				const labels = mounted.dom.container.querySelectorAll('input').map(node => node.getAttribute('aria-label'))
					.filter((label): label is string => label !== null && label.startsWith(`${bind}: `));
				assert.equal(labels.length, 1); assert.match(labels[0]!, locale === 'de' ? /Weißabgleich/u : /White balance/u);
			}
			assert.equal(calls, 0); assert.equal(JSON.stringify(develop), before);
		} finally {
			const pending = [...retirements].map(retire => retire());
			await joinRetirements([mounted.dispose(), ...pending]);
		}
	});
}

async function joinRetirements(work: readonly Promise<unknown>[]): Promise<void> {
	const results = await Promise.allSettled(work);
	const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (failures.length === 1) throw failures[0]; if (failures.length) throw new AggregateError(failures, 'Mask picker retirement failed.');
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useState } from 'react';
import PhotoNameTemplateFields from '../src/common/editor/ui/lightscaper/PhotoNameTemplateFields.tsx';
import type { PhotoLibraryImportSettingsV1 } from '../src/common/editor/photo-library-import-settings-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

type Rename = NonNullable<PhotoLibraryImportSettingsV1['rename']>;
const initial: Rename = { template: '{stem}-{sequence}.{extension}', sequenceStart: 1, sequencePadding: 3 };
const copy = { photoImportNameTemplate: 'Template', photoImportSequenceStart: 'Start', photoImportSequencePadding: 'Padding' };

test('both menu workflows preserve exact Unicode and detached numeric drafts through shared fields', async () => {
	for (const dataPrefix of ['import', 'batch-rename'] as const) {
		let value = initial;
		function Harness() { const [current, update] = useState(initial); value = current;
			return <PhotoNameTemplateFields value={current} onChange={update} busy={false} copy={copy} dataPrefix={dataPrefix} />; }
		const mounted = await mountPhotoImportUi(() => <Harness />);
		try {
			const template = '{stem}-原本 e\u0301-{sequence}.{extension}';
			await mounted.event(`[data-${dataPrefix}-template]`, 'onChange', { currentTarget: { value: template } });
			await mounted.event(`[data-${dataPrefix}-sequence-start]`, 'onChange', { currentTarget: { valueAsNumber: 7 } });
			await mounted.event(`[data-${dataPrefix}-sequence-padding]`, 'onChange', { currentTarget: { valueAsNumber: 6 } });
			assert.deepEqual(value, { template, sequenceStart: 7, sequencePadding: 6 });
			assert.equal(Object.isFrozen(value), true); assert.equal(initial.sequenceStart, 1);
			assert.equal(reactProps(mounted.dom.one(`[data-${dataPrefix}-template]`)).maxLength, 256);
			assert.equal(reactProps(mounted.dom.one(`[data-${dataPrefix}-sequence-padding]`)).max, 16);
		} finally { await mounted.dispose(); }
	}
});

test('cleared numeric input remains an unadmitted draft rather than fabricating a valid sequence', async () => {
	let value = initial;
	function Harness() { const [current, update] = useState(initial); value = current;
		return <PhotoNameTemplateFields value={current} onChange={update} busy={false} copy={copy} dataPrefix="batch-rename" />; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await mounted.event('[data-batch-rename-sequence-start]', 'onChange', { currentTarget: { valueAsNumber: NaN } });
		assert.equal(Number.isNaN(value.sequenceStart), true);
		assert.equal(mounted.dom.one('[data-batch-rename-sequence-start]').value, '');
	} finally { await mounted.dispose(); }
});

test('busy fields refuse programmatic handlers as well as native user interaction', async () => {
	let writes = 0;
	const mounted = await mountPhotoImportUi(() => <PhotoNameTemplateFields value={initial} onChange={() => { writes++; }}
		busy copy={copy} dataPrefix="batch-rename" />);
	try {
		await mounted.event('[data-batch-rename-template]', 'onChange', { currentTarget: { value: 'Overwrite' } });
		await mounted.event('[data-batch-rename-sequence-start]', 'onChange', { currentTarget: { valueAsNumber: 9 } });
		await mounted.event('[data-batch-rename-sequence-padding]', 'onChange', { currentTarget: { valueAsNumber: 9 } });
		assert.equal(writes, 0); assert.equal(reactProps(mounted.dom.one('[data-batch-rename-template]')).disabled, true);
	} finally { await mounted.dispose(); }
});

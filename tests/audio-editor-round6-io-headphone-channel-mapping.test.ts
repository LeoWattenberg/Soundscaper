/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';

import { createDefaultAdmMetadata } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { elementByTag, mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import { reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const requested of ['mono', 'custom', 'empty-custom']) test(`headphone routing states stereo and preserves the prior ${requested} mapping`, async () => {
	const mapping = requested === 'empty-custom' ? 'custom' : requested;
	const fixture = await mountedExportDialog({ metadata: { adm: createDefaultAdmMetadata({ title: 'Programme', tracks: [] }) } });
	const radio = (value: string) => elementByTag(fixture.dom.one(`[data-export-channel-option="${value}"]`), 'input');
	const headphones = (): ReactTestElement => {
		const pending = [...fixture.dom.one('[data-export-field="binaural"]').childNodes];
		while (pending.length) {
			const node = pending.shift();
			if (node instanceof ReactTestElement && node.getAttribute('role') === 'checkbox') return node;
			if (node) pending.push(...node.childNodes);
		}
		throw new Error('Missing headphone checkbox.');
	};
	try {
		await fixture.chooseChannels(mapping);
		if (requested === 'custom') {
			await fixture.click(fixture.editMappingButton());
			await fixture.click(elementByTag(fixture.dom.one('[data-export-channel-mapping-action="apply"]'), 'button'));
		}
		const chosen = radio(mapping);
		assert.equal(chosen.checked, true);
		assert.equal(chosen.hasAttribute('disabled'), false);
		await fixture.click(headphones());
		assert.equal(radio('preserve').checked, true);
		assert.equal(radio(mapping).checked, false);
		for (const value of ['preserve', 'mono', 'stereo', 'custom']) assert.equal(radio(value).hasAttribute('disabled'), true);
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), true);
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.binaural, true);
		assert.equal(fixture.requests[0]?.channelMapping, 'preserve');
		await fixture.click(headphones());
		assert.equal(radio(mapping).checked, true);
		assert.equal(radio(mapping).hasAttribute('disabled'), false);
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), mapping !== 'custom');
		if (requested !== 'empty-custom') {
			await fixture.startExport();
			assert.deepEqual(fixture.requests[1]?.channelMapping, mapping === 'mono' ? 'mono' : {
				channels: [{ inputs: [{ channel: 0, gain: 1 }] }, { inputs: [{ channel: 1, gain: 1 }] }],
			});
		}
		await act(async () => reactProps(radio('stereo')).onChange({}));
		assert.equal(radio('stereo').checked, true);
	} finally { await fixture.unmount(); }
});

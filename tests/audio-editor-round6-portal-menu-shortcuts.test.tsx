/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FadeShapeMenu } from '../src/common/editor/ui/timeline/FadeShapeMenu.tsx';
import { LabelContextMenu } from '../src/common/editor/ui/timeline/LabelContextMenu.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const owner of ['fade', 'label'] as const) test(`native ${owner} popup preserves modified project commands and plain local ownership`, async () => {
	const dom = installReactTestDom();
	dom.container.setAttribute('id', 'kw-audio-editor-design-system');
	const mount = dom.container.ownerDocument.createElement('div');
	const trigger = dom.container.ownerDocument.createElement('button');
	dom.container.appendChild(mount); dom.container.appendChild(trigger);
	const root = createRoot(mount as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		const position = { x: 0, y: 0, target: trigger as unknown as HTMLElement };
		await act(async () => { root.render(owner === 'fade'
			? <FadeShapeMenu position={position} presets={[{ id: 'linear', shape: undefined }]} selectedId="linear"
				copy={{}} onSelect={() => undefined} onClose={() => undefined} />
			: <LabelContextMenu position={position} copy={ENGLISH_COPY} blocked={false} audioBlocked={false}
				point={false} audioEditing={true} run={(operation) => operation()} editActions={{}}
				onEdit={() => undefined} onRemove={() => undefined} onClose={() => undefined} />); });
		const surface = dom.container.ownerDocument.body.querySelector('[role="presentation"]');
		assert.ok(surface);
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'plain'] as const) {
			let stopped = false;
			await act(async () => { reactProps(surface).onKeyDown?.({
				key: modifier === 'plain' ? 'ArrowDown' : 'b', [modifier]: modifier !== 'plain',
				stopPropagation: () => { stopped = true; },
			}); });
			assert.equal(stopped, modifier === 'plain', modifier);
		}
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

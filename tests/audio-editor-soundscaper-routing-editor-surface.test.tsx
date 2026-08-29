/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import SoundscaperRoutingEditor from '../src/common/editor/ui/dialogs/SoundscaperRoutingEditor.tsx';
import { SOUNDSCAPER_PRODUCTION_COPY } from '../src/common/editor/ui/soundscaper-production-copy.ts';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

const EDGE = Object.freeze({
	id: 'master-main', kind: 'assignment' as const,
	source: Object.freeze({ kind: 'master' as const }),
	destination: Object.freeze({ kind: 'output' as const, id: 'main' }),
	position: 'post-fader' as const, level: 1, enabled: true,
	channelMap: Object.freeze([0, 1]),
});
const PROJECT = Object.freeze({
	schemaVersion: 21,
	masterChannels: 2,
	master: Object.freeze({ effects: Object.freeze([]) }),
	tracks: Object.freeze([]),
	mixer: graph('Main output'),
});

test('an existing output form refreshes when a same-id routing draft changes', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const props = {
		copy: SOUNDSCAPER_PRODUCTION_COPY,
		project: PROJECT,
		disabled: false,
		onDraft: () => undefined,
		onApply: () => undefined,
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperRoutingEditor
			{...props}
			draft={JSON.stringify(graph('Main output'))}
		/>));
		const staleForm = dom.one('[aria-label="Update output Main output"]');
		const staleName = namedControl(staleForm, 'name');
		staleName.value = 'Unsubmitted local name';

		await act(async () => root.render(<SoundscaperRoutingEditor
			{...props}
			draft={JSON.stringify(graph('Broadcast output'))}
		/>));

		const updatedForm = dom.one('[aria-label="Update output Broadcast output"]');
		assert.equal(namedControl(updatedForm, 'name').value, 'Broadcast output',
			'a same-id graph update must not retain the stale uncontrolled value');
		assert.notEqual(updatedForm, staleForm,
			'the updated graph owns a fresh form rather than the stale same-id form');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function graph(outputName: string) {
	return Object.freeze({
		schemaVersion: 1 as const,
		groups: Object.freeze([]), sends: Object.freeze([]), cues: Object.freeze([]),
		vcas: Object.freeze([]),
		outputs: Object.freeze([Object.freeze({
			id: 'main', name: outputName, role: 'main' as const, channelCount: 2,
		})]),
		edges: Object.freeze([EDGE]),
	});
}

function namedControl(root: ReactTestElement, name: string): ReactTestElement {
	const pending = [...root.childNodes];
	while (pending.length > 0) {
		const node = pending.shift()!;
		if (node instanceof ReactTestElement && node.name === name) return node;
		pending.unshift(...node.childNodes);
	}
	throw new Error(`Missing mounted control ${name}`);
}

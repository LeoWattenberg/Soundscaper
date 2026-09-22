/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { resolveDesktopMcpCopy } from '../src/common/editor/ui/desktop-mcp-copy.ts';
import DesktopMcpDialog from '../src/common/editor/ui/dialogs/DesktopMcpDialog.tsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('desktop MCP dialog reads status and starts and stops its session', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	const copied: string[] = [];
	Object.assign(globalThis.navigator, { clipboard: { writeText: async (value: string) => { copied.push(value); } } });
	const off = { enabled: false, url: null, token: null };
	const on = { enabled: true, url: 'http://127.0.0.1:4343/mcp', token: 'private-token' };
	try {
		await act(async () => root.render(<DesktopMcpDialog
			copy={ENGLISH_COPY}
			fileService={{
				readMcpStatus: async () => { calls.push('read'); return off; },
				startMcp: async () => { calls.push('start'); return on; },
				stopMcp: async () => { calls.push('stop'); return off; },
			}}
			onClose={() => undefined}
		/>));
		assert.deepEqual(calls, ['read']);
		assert.match(dom.container.textContent, /local clients can read project metadata/iu);
		assert.match(dom.container.textContent, /without confirmation for each edit/iu);
		assert.match(dom.container.textContent, /Authorization: Bearer <token>/u);
		await press(dom.container, 'Start MCP');
		assert.deepEqual(calls, ['read', 'start']);
		assert.deepEqual(dom.container.querySelectorAll('input').map(({ value }) => value), [on.url, on.token]);
		await press(dom.container, 'Copy endpoint');
		await press(dom.container, 'Copy token');
		assert.deepEqual(copied, [on.url, on.token]);
		await press(dom.container, 'Stop MCP');
		assert.deepEqual(calls, ['read', 'start', 'stop']);
		assert.equal(dom.container.querySelectorAll('input').length, 0);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('desktop MCP connection copy has German source text', () => {
	assert.equal(ENGLISH_COPY.desktopMcpConnection, undefined);
	assert.equal(EDITOR_ENGLISH_COPY['ui.desktopMcp.connection'], 'MCP connection');
	assert.equal(EDITOR_GERMAN_COPY['ui.desktopMcp.connection'], 'MCP-Verbindung');
	assert.match(resolveDesktopMcpCopy(EDITOR_GERMAN_COPY).disclosure, /ohne.*Bestätigung/iu);
});

async function press(root: ReactTestElement, label: string) {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === label);
	assert.ok(button, `Missing ${label}`);
	await act(async () => { void reactProps(button).onClick({}); await Promise.resolve(); });
}

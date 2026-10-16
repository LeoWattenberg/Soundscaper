/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import LocalDiagnosticsDialog from '../src/common/editor/ui/dialogs/LocalDiagnosticsDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { serializeLocalDiagnosticsReport } from '../src/common/editor/local-diagnostics-report.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the actual Diagnostics surface snapshots native Navigator accessors before its data-only report boundary', async () => {
	const nativeNavigator = globalThis.navigator;
	assert.equal(Object.hasOwn(nativeNavigator, 'platform'), false);
	assert.match(nativeNavigator.platform, /Linux|Mac|Win/u);
	const dom = installReactTestDom();
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nativeNavigator });
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const reports: unknown[] = [];
	const errors: unknown[] = [];
	let desktop = true;
	const render = async () => {
		await act(async () => root.render(<LocalDiagnosticsDialog copy={ENGLISH_COPY} locale="en"
			productId="soundscaper" onClose={() => undefined} controller={{
				getSnapshot: () => ({ project: null, projects: [], projectTabs: [], storage: {} }),
				getLocalDiagnosticsSnapshot: () => ({ recentErrors: [] }),
				recordLocalDiagnosticError: error => { errors.push(error); },
			}} fileService={{ isDesktop: desktop,
				getEnvironment: () => ({ platform: 'linux', arch: 'x64', locale: 'en',
					runtimeVersions: { electron: '43.0.0', chromium: '150.0.0', node: '26.5.0' } }),
				saveFile: async request => {
					assert.ok(request.blob instanceof Blob);
					const report: unknown = JSON.parse(await request.blob.text());
					serializeLocalDiagnosticsReport(report);
					reports.push(report);
				},
			}} />));
	};
	const generateAndExport = async () => {
		await act(async () => { reactProps(dom.one('[data-local-diagnostics-generate]')).onClick(); });
		assert.ok(dom.find('[data-local-diagnostics-summary]'));
		await act(async () => { reactProps(dom.one('[data-local-diagnostics-export]')).onClick(); });
		const report = reports.at(-1) as Readonly<{ environment: Readonly<Record<string, unknown>> }>;
		assert.ok(report);
		return report.environment;
	};
	try {
		await render();
		const healthy = await generateAndExport();
		assert.equal(healthy.kind, 'desktop');
		assert.equal(healthy.platform, 'linux');
		assert.equal(healthy.architecture, 'x64');
		desktop = false;
		await render();
		const environment = await generateAndExport();
		assert.equal(environment.kind, 'browser');
		const expectedPlatform = process.platform === 'darwin' ? 'darwin'
			: process.platform === 'win32' ? 'win32' : 'linux';
		assert.equal(environment.platform, expectedPlatform);
		if (process.arch === 'x64') assert.equal(environment.architecture, 'x64');
		assert.equal(environment.locale, 'en');
		assert.deepEqual(errors, []);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

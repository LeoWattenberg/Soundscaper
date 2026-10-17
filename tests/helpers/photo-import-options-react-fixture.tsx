/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installReactTestDom, reactProps } from './react-test-dom.ts';

export async function mountPhotoImportUi(render: () => ReactNode) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const update = async (next = render) => { await act(async () => { root.render(<>{next()}</>); }); };
	try { await update(); } catch (error) {
		try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; }
		throw error;
	}
	return { dom, render: update,
		async event(selector: string, handler: string, value: unknown = {}) {
			await act(async () => { reactProps(dom.one(selector))[handler]?.(value); });
		},
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } },
	};
}

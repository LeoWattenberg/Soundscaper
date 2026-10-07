/* SPDX-License-Identifier: AGPL-3.0-only */
import { installReactTestDom, type ReactTestDom } from './react-test-dom.ts';

export function installResponsivenessTestDom(): ReactTestDom {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	return { ...dom, restore() { globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore(); } };
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';

const EffectParameterEditor = lazyEditorModule(() => import('./EffectParameterEditor.jsx'));

export default function LazyEffectParameterEditor(props) {
	return <Suspense fallback={null}><EffectParameterEditor {...props} /></Suspense>;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense } from 'react';
import type { FramescaperImageDevelopDialogPropsV1 } from './FramescaperImageDevelopDialogV1.tsx';
import './image-develop-editor-v1.css';

const Dialog = lazy(() => import('./FramescaperImageDevelopDialogV1.tsx'));
export type FramescaperImageDevelopSurfacePropsV1 = FramescaperImageDevelopDialogPropsV1;
/** Menu-only lazy surface. The selected source owner joins every registered child. */
export default function FramescaperImageDevelopSurfaceV1(props: FramescaperImageDevelopSurfacePropsV1) {
	return <div data-frame-image-develop-surface><Suspense fallback={null}><Dialog {...props} /></Suspense></div>;
}

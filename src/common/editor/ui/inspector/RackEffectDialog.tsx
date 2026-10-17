/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense } from 'react';
import AudioEditorDialogShell, { type AudioEditorDialogShellProps } from '../AudioEditorDialogShell.tsx';

/** Mount the centered header and controls together so loading cannot move an active Close target. */
export default function RackEffectDialog(props: AudioEditorDialogShellProps) {
	return <Suspense fallback={null}><AudioEditorDialogShell {...props} /></Suspense>;
}

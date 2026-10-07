/* SPDX-License-Identifier: AGPL-3.0-only */

import LightscaperApp, { type LightscaperAppProps } from '../../common/editor/ui/lightscaper/LightscaperApp.tsx';

// This product composition deliberately has no audio/timeline controller.
export default function LightscaperBootstrap(props: LightscaperAppProps) {
	return <LightscaperApp {...props} />;
}

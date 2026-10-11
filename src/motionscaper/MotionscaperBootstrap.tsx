/* SPDX-License-Identifier: AGPL-3.0-only */

import MotionscaperShell from '../common/editor/ui/motionscaper/MotionscaperShell.tsx';
import { motionscaperCopy } from '../common/editor/ui/motionscaper/motionscaper-copy.ts';

export interface MotionscaperBootstrapProps {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, string>>;
}

/** Independent product shell; M02 supplies its own project runtime. */
export default function MotionscaperBootstrap({ locale, fallbackCopy }: MotionscaperBootstrapProps) {
	const copy = { ...fallbackCopy, ...motionscaperCopy(locale) };
	return <MotionscaperShell locale={locale} copy={copy} />;
}

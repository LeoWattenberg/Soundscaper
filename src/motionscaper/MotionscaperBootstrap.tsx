/* SPDX-License-Identifier: AGPL-3.0-only */

import MotionscaperShell from '../common/editor/ui/motionscaper/MotionscaperShell.tsx';
import { bundledSiteCopyForLocale } from '../common/i18n/site-copy.js';

export interface MotionscaperBootstrapProps {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, string>>;
}

/** Independent product shell; M02 supplies its own project runtime. */
export default function MotionscaperBootstrap({ locale, fallbackCopy }: MotionscaperBootstrapProps) {
	const copy = { ...bundledSiteCopyForLocale(locale), ...fallbackCopy };
	return <MotionscaperShell locale={locale} copy={copy} />;
}

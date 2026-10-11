/* SPDX-License-Identifier: AGPL-3.0-only */
export interface MotionDesktopDocumentation {
	open(request: Readonly<{ destination: 'manual' | 'tutorials'; locale?: string }>): Promise<void>;
}

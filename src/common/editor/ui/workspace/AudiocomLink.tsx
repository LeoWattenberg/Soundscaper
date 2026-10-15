/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReactNode } from 'react';

export default function AudiocomLink({ href, className, onOpen, children }: Readonly<{
	href: string;
	className?: string;
	onOpen?: (url: string) => void;
	children: ReactNode;
}>) {
	return <a href={href} className={className} target="_blank" rel="noreferrer" onClick={(event) => {
		if (!onOpen) return;
		event.preventDefault();
		onOpen(href);
	}}>{children}</a>;
}

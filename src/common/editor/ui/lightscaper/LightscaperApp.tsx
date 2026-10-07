/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { otherProductIds, productIdentity } from '../../../product-identities.js';
import { productHref } from '../../../product-web-links.js';
import { useSiteCopy } from '../../../site/use-site-copy.js';
import '../../../../../vendor/audacity-design-system/components/src/ApplicationHeader/ApplicationHeader.css';
import './lightscaper.css';

export interface LightscaperAppProps {
	readonly locale: string;
}

export default function LightscaperApp({ locale }: LightscaperAppProps) {
	const copy = useSiteCopy(locale);
	const app = useRef<HTMLElement>(null);
	const [libraryVisible, setLibraryVisible] = useState(false);
	useEffect(() => {
		const dismiss = (event: PointerEvent) => {
			const menu = app.current?.querySelector<HTMLDetailsElement>('details[open]');
			if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
		};
		document.addEventListener('pointerdown', dismiss);
		return () => { document.removeEventListener('pointerdown', dismiss); };
	}, []);
	useEffect(() => {
		const publish = () => window.dispatchEvent(new CustomEvent('scape:workspace-state', {
			detail: {
				productId: 'lightscaper', activeId: 'photo-library',
				workspaces: [{ id: 'photo-library', name: copy.workspacePhoto }],
			},
		}));
		const request = (event: Event) => {
			const detail: unknown = (event as CustomEvent<unknown>).detail;
			if (!detail || typeof detail !== 'object') return;
			if (Reflect.get(detail, 'productId') === 'lightscaper'
				&& Reflect.get(detail, 'workspaceId') === 'photo-library') setLibraryVisible(true);
		};
		publish();
		window.addEventListener('scape:workspace-ready', publish);
		window.addEventListener('scape:workspace-request', request);
		return () => {
			window.removeEventListener('scape:workspace-ready', publish);
			window.removeEventListener('scape:workspace-request', request);
		};
	}, [copy.workspacePhoto]);

	const toggleLibrary = (event: MouseEvent<HTMLButtonElement>) => {
		setLibraryVisible((visible) => !visible);
		const menu = event.currentTarget.closest('details');
		if (menu) menu.open = false;
		menu?.querySelector('summary')?.focus();
	};
	const menuKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
		if (event.key !== 'Escape' || !event.currentTarget.open) return;
		event.preventDefault();
		event.currentTarget.open = false;
		event.currentTarget.querySelector('summary')?.focus();
	};
	const menuBlur = (event: FocusEvent<HTMLDetailsElement>) => {
		if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
			event.currentTarget.open = false;
		}
	};

	return <section ref={app} className="lightscaper-app" data-lightscaper-bound="true" aria-label={copy.lightscaperTitle}>
		<header className="lightscaper-header application-header">
			<h2>{copy.lightscaperTitle}</h2>
			<nav className="lightscaper-menus" aria-label={copy.photoMenuLabel}>
				<details name="lightscaper-application-menu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
					<summary className="application-header__menu-item">{copy.photoFileMenu}</summary>
					<div className="lightscaper-menu-items">
						{otherProductIds('lightscaper').map((id) => <a key={id} href={productHref(id, locale, { builtProductId: 'lightscaper' })}>
							{productIdentity(id).name}
						</a>)}
					</div>
				</details>
				<details name="lightscaper-application-menu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
					<summary className="application-header__menu-item">{copy.photoViewMenu}</summary>
					<div className="lightscaper-menu-items">
						<button type="button" aria-pressed={libraryVisible} onClick={toggleLibrary}>
							{libraryVisible ? copy.photoHideLibrary : copy.photoShowLibrary}
						</button>
					</div>
				</details>
			</nav>
		</header>
		{libraryVisible && <section className="lightscaper-library" data-photo-library="true" aria-label={copy.workspacePhoto}>
			<h3>{copy.workspacePhoto}</h3>
			<p role="status">{copy.photoEmptyLibrary}</p>
		</section>}
	</section>;
}

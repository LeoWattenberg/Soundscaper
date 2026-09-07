import { useEffect, useMemo, useState } from 'react';

import { localeLanguage } from '../i18n/locale.js';
import { DEFAULT_LOCALE_TAGS, getLocaleDescriptor, ROUTE_LOCALES } from '../i18n/locales.js';
import { TRANSLATION_CATALOG_LOCALES } from '../i18n/translations/index.js';
import { useSiteCopy } from './use-site-copy.js';
import { otherProductId, productIdentity } from '../product-identities.js';
import { productHref } from '../product-web-links.js';
import { storeDocumentTheme } from './document-theme.js';
import {
	PRIVACY_POLICY_REQUEST_EVENT,
	privacyPolicyUrl,
} from './privacy-policy-links.js';

export default function BrandSidebar({ locale, productId = 'soundscaper' }) {
	const profile = productIdentity(productId);
	const otherProduct = productIdentity(otherProductId(productId));
	const localeDescriptor = getLocaleDescriptor(locale);
	if (!localeDescriptor) throw new Error(`Unknown editor locale: ${locale}`);
	const chromeLocale = localeLanguage(localeDescriptor.locale) === 'de' ? 'de' : 'en';
	const catalog = useSiteCopy(localeDescriptor.locale);
	const copy = sidebarCopy(catalog);
	const [collapsed, setCollapsed] = useState(() => storedCollapsed(productId));
	const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
	const [workspace, setWorkspace] = useState({ activeId: profile.defaultWorkspace, workspaces: [] });
	// Every routed locale a bundled or committed translation catalog serves is
	// offered; nothing is fetched to know that.
	const localeOptions = useMemo(() => {
		const localeTags = new Set([...DEFAULT_LOCALE_TAGS, ...TRANSLATION_CATALOG_LOCALES, localeDescriptor.locale]);
		return ROUTE_LOCALES
			.filter(({ locale: routeLocale }) => localeTags.has(routeLocale))
			.map((descriptor) => ({ ...descriptor, name: descriptor.nativeName }))
			.sort((left, right) => left.name.localeCompare(right.name, localeDescriptor.locale));
	}, [localeDescriptor.locale]);

	useEffect(() => {
		const handleWorkspaceState = (event) => {
			if (event.detail?.productId && event.detail.productId !== productId) return;
			const workspaces = Array.isArray(event.detail?.workspaces)
				? event.detail.workspaces.filter(({ id, name }) => typeof id === 'string' && id && typeof name === 'string' && name)
				: [];
			setWorkspace({ activeId: event.detail?.activeId || profile.defaultWorkspace, workspaces });
		};
		window.addEventListener('scape:workspace-state', handleWorkspaceState);
		window.addEventListener('soundscaper:workspace-state', handleWorkspaceState);
		window.dispatchEvent(new CustomEvent('scape:workspace-ready', { detail: { productId } }));
		return () => {
			window.removeEventListener('scape:workspace-state', handleWorkspaceState);
			window.removeEventListener('soundscaper:workspace-state', handleWorkspaceState);
		};
	}, [productId, profile.defaultWorkspace]);

	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		try { localStorage.setItem(`${productId}_sidebar_collapsed`, String(next)); } catch {}
	};
	const toggleTheme = () => {
		const next = theme === 'dark' ? 'light' : 'dark';
		setTheme(next);
		document.documentElement.dataset.theme = next;
		document.documentElement.style.colorScheme = next;
		storeDocumentTheme(productId, next);
	};
	const selectWorkspace = (event) => {
		window.dispatchEvent(new CustomEvent('scape:workspace-request', {
			detail: { productId, workspaceId: event.target.value },
		}));
	};
	const selectLocale = (event) => {
		if (ROUTE_LOCALES.some(({ locale: routeLocale }) => routeLocale === event.target.value)) {
			window.location.assign(productHref(productId, event.target.value));
		}
	};
	const openPrivacyPolicy = (event) => {
		if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (!document.querySelector('[data-audio-editor-bound="true"]')) return;
		event.preventDefault();
		window.dispatchEvent(new CustomEvent(PRIVACY_POLICY_REQUEST_EVENT, { detail: { productId } }));
	};
	const workspaces = workspace.workspaces.length ? workspace.workspaces : defaultWorkspaces(productId, copy);
	const darkTheme = theme === 'dark';

	return (
		<aside className="site-sidebar" data-sidebar data-product={productId} data-locale={localeDescriptor.locale} data-collapsed={String(collapsed)} aria-label={copy.label}>
			<a className="brand" href={productHref(productId, locale)} aria-label={profile.name}>
				<img className="logo-wide" src={darkTheme ? '/logo/logo-weiß.svg' : '/logo/logo-schwarz.svg'} alt="kw.media" width="230" height="91" />
				<img className="logo-small" src={darkTheme ? '/logo/logo-klein-weiß.svg' : '/logo/logo-klein-schwarz.svg'} alt="" width="48" height="48" />
				<strong>{profile.name}</strong>
			</a>
			<button className="sidebar-collapse" type="button" data-sidebar-collapse aria-label={collapsed ? copy.expand : copy.collapse} aria-expanded={String(!collapsed)} onClick={toggleCollapsed}>
				<span aria-hidden="true">‹</span>
			</button>
			<div className="sidebar-content" data-sidebar-content>
				<nav className="sidebar-nav" aria-label={copy.label}>
						<a className="sidebar-link is-active" href={productHref(productId, locale)} aria-current="page">{productId === 'framescaper' ? profile.name : copy.editor}</a>
						<a className="sidebar-link" href={productHref(otherProduct.id, locale)}>{otherProduct.name}</a>
						<a className="sidebar-link" href={`https://kw.media/${chromeLocale}/tools/`}>{copy.tools}</a>
						<a className="sidebar-link" href={`https://kw.media/${chromeLocale}/audacity/`}>{copy.guides}</a>
						<a className="sidebar-link" href={privacyPolicyUrl(productId, locale)} onClick={openPrivacyPolicy}>{copy.legal}</a>
						<a className="sidebar-link" href="https://github.com/LeoWattenberg/Soundscaper/issues/new" target="_blank" rel="noreferrer">{copy.reportIssue}</a>
						<a className="sidebar-link" href="https://github.com/LeoWattenberg/Soundscaper" target="_blank" rel="noreferrer">{copy.github}</a>
				</nav>
				<section className="sidebar-settings" aria-labelledby="sidebar-settings-title">
					<h2 id="sidebar-settings-title">{copy.settings}</h2>
					<label className="sidebar-workspace">
						<span>{copy.workspace}</span>
						<select data-workspace-select aria-label={copy.workspace} value={workspace.activeId} disabled={!workspace.workspaces.length} onChange={selectWorkspace}>
							{workspaces.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
						</select>
					</label>
					<div className="sidebar-actions">
						<button className="theme-toggle" type="button" data-theme-toggle aria-label={copy.theme} aria-pressed={String(theme === 'dark')} onClick={toggleTheme}>
							<span className="theme-toggle-track" aria-hidden="true"><span className="theme-toggle-thumb"></span></span>
							<span data-theme-label>{theme === 'dark' ? copy.dark : copy.light}</span>
						</button>
						<label className="language-picker">
							<span>{copy.language}</span>
							<select data-locale-select aria-label={copy.language} value={localeDescriptor.locale} onChange={selectLocale}>
								{localeOptions.map(({ locale: optionLocale, name }) => <option key={optionLocale} value={optionLocale}>{name}</option>)}
							</select>
						</label>
					</div>
				</section>
			</div>
		</aside>
	);
}

function storedCollapsed(productId) {
	try {
		return (localStorage.getItem(`${productId}_sidebar_collapsed`) || localStorage.getItem('soundscaper_sidebar_collapsed')) === 'true';
	} catch {
		return false;
	}
}

function defaultWorkspaces(productId, copy) {
	return productId === 'framescaper'
		? [{ id: 'video-editor', name: copy.workspaceVideo }]
		: [
			{ id: 'modern', name: copy.workspaceModern },
			{ id: 'audacity', name: copy.workspaceAudacity },
			{ id: 'music', name: copy.workspaceMusic },
			{ id: 'classic', name: copy.workspaceClassic },
		];
}

function sidebarCopy(catalog) {
	return {
		label: catalog.sidebarNavigation,
		editor: catalog.audioEditorLink,
		tools: catalog.moreToolsLink,
		guides: catalog.audacityGuidesLink,
		legal: catalog.legalLink,
		github: catalog.githubProjectLink,
		theme: catalog.themeToggle,
		light: catalog.lightTheme,
		dark: catalog.darkTheme,
		collapse: catalog.collapseNavigation,
		expand: catalog.expandNavigation,
		language: catalog.languageLabel,
		workspace: catalog.workspace,
		workspaceModern: catalog.workspaceModern,
		workspaceAudacity: catalog.workspaceAudacity,
		workspaceMusic: catalog.workspaceMusic,
		workspaceClassic: catalog.workspaceClassic,
		workspaceVideo: catalog.workspaceVideo,
		reportIssue: catalog.reportIssueLink,
		settings: catalog.sidebarSettings,
	};
}

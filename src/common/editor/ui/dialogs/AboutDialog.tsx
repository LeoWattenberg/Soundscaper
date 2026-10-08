/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { type KeyboardEvent, useId, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { resolveAboutDialogCopy } from '../about-dialog-copy.ts';
import {
	ABOUT_CONTRIBUTORS,
	ABOUT_NOTICES_URL,
	ABOUT_SOURCE_URL,
	ABOUT_TABS,
	type AboutTab,
	aboutDialogInformation,
} from './about-dialog-model.ts';
import './AboutDialog.css';

const AboutLicenseText = lazyEditorModule(() => import('./AboutLicenseText.tsx'));

export interface AboutDialogProps {
	readonly title: string;
	readonly productId: string;
	readonly copy: Readonly<Record<string, unknown>>;
	readonly onClose: () => void;
}

export default function AboutDialog({ title, productId, copy: editorCopy, onClose }: AboutDialogProps) {
	const copy = resolveAboutDialogCopy(editorCopy);
	const information = aboutDialogInformation(productId);
	const [activeTab, setActiveTab] = useState<AboutTab>('about');
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const prefix = useId();
	const tabId = (tab: AboutTab) => `${prefix}-${tab}-tab`;
	const panelId = (tab: AboutTab) => `${prefix}-${tab}-panel`;
	const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		let nextIndex: number;
		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
			const forward = window.getComputedStyle(event.currentTarget).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
			nextIndex = (index + (event.key === forward ? 1 : -1) + ABOUT_TABS.length) % ABOUT_TABS.length;
		} else if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = ABOUT_TABS.length - 1;
		else return;
		event.preventDefault();
		setActiveTab(ABOUT_TABS[nextIndex]!);
		tabRefs.current[nextIndex]?.focus({ preventScroll: true });
	};

	return <AudioEditorDialogShell
		title={title}
		onClose={onClose}
		width={640}
		initialFocus="[data-about-tab=about]"
		className="kw-audio-editor-about"
		bodyClassName="kw-audio-editor-dialog__body kw-audio-editor-about__body"
		dataAttributes={{ 'data-about-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={
			<Button variant="primary" onClick={onClose}>{copy.close}</Button>
		} />}
	>
		<div className="kw-audio-editor-about__tabs" role="tablist" aria-label={title}>
			{ABOUT_TABS.map((tab, index) => <button
				key={tab}
				ref={(element) => { tabRefs.current[index] = element; }}
				id={tabId(tab)}
				type="button"
				role="tab"
				aria-controls={panelId(tab)}
				aria-selected={activeTab === tab}
				tabIndex={activeTab === tab ? 0 : -1}
				data-about-tab={tab}
				onClick={() => setActiveTab(tab)}
				onKeyDown={(event) => handleTabKey(event, index)}
			>{copy[tab]}</button>)}
		</div>
		{ABOUT_TABS.map((tab) => <section
			key={tab}
			id={panelId(tab)}
			role="tabpanel"
			aria-labelledby={tabId(tab)}
			hidden={activeTab !== tab}
			tabIndex={0}
			className="kw-audio-editor-about__panel"
		>
			{tab === 'about' && <>
				<h2 className="kw-audio-editor-about__name">{information.name}</h2>
				<p data-about-version>{copy.version} {information.version}</p>
				<p>{copy[information.descriptionKey]}</p>
				<p>{copy.localFirst}</p>
				<p className="kw-audio-editor-about__links">
					<a href={information.websiteUrl} target="_blank" rel="noreferrer">{copy.website}</a>
					<a href={ABOUT_SOURCE_URL} target="_blank" rel="noreferrer">{copy.sourceCode}</a>
				</p>
			</>}
			{tab === 'contributors' && <>
				<ul className="kw-audio-editor-about__contributors">
					{ABOUT_CONTRIBUTORS.map((contributor) => <li key={contributor.url}>
						<a href={contributor.url} target="_blank" rel="noreferrer">
							{contributor.name ?? copy.audacityContributors}
						</a>
						<span>{copy[contributor.role]}</span>
					</li>)}
				</ul>
				<p><a href={ABOUT_NOTICES_URL} target="_blank" rel="noreferrer">{copy.additionalCredits}</a></p>
			</>}
			{tab === 'license' && <>
				<p><strong>{copy.licenseName}</strong></p>
				<p>{copy.licenseDescription}</p>
				<p>{copy.licenseWarranty}</p>
				{activeTab === 'license' && <details>
					<summary>{copy.fullLicense}</summary>
					<React.Suspense fallback={null}><AboutLicenseText /></React.Suspense>
				</details>}
				<p><a href={ABOUT_NOTICES_URL} target="_blank" rel="noreferrer">{copy.thirdPartyNotices}</a></p>
			</>}
			{tab === 'enabledModules' && <>
				<p>{copy.modulesDescription}</p>
				<ul className="kw-audio-editor-about__modules">
					{information.modules.map((module) => <li key={module.id}>{copy[module.copyKey]}</li>)}
				</ul>
			</>}
		</section>)}
	</AudioEditorDialogShell>;
}

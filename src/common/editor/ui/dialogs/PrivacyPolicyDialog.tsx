/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import { privacyPolicyContent } from '../../../site/privacy-policy.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './PrivacyPolicyDialog.css';

export interface PrivacyPolicyDialogProps {
	readonly locale: string;
	readonly onClose: () => void;
}

export default function PrivacyPolicyDialog({ locale, onClose }: PrivacyPolicyDialogProps) {
	const policy = privacyPolicyContent(locale);
	return <AudioEditorDialogShell
		title={policy.title}
		onClose={onClose}
		initialFocus="dialog"
		width={900}
		className="kw-audio-editor-privacy-policy"
		bodyClassName="kw-audio-editor-dialog__body kw-audio-editor-privacy-policy__body"
		dataAttributes={{ 'data-privacy-policy-dialog': 'true' }}
		footer={<DialogFooter
			className="audio-editor-dialog-footer"
			rightContent={<Button variant="primary" onClick={onClose}>{policy.closeLabel}</Button>}
		/>}
	>
		<p className="kw-audio-editor-privacy-policy__effective">
			<strong>{policy.effectiveLabel}:</strong> {policy.effectiveDate}
		</p>
		<p className="kw-audio-editor-privacy-policy__summary">{policy.summary}</p>
		{policy.sections.map((section) => <section key={section.id} id={section.id}>
			<h2>{section.heading}</h2>
			{/* Policy prose is repository-owned static markup, never user input. */}
			<div dangerouslySetInnerHTML={{ __html: section.body }} />
		</section>)}
	</AudioEditorDialogShell>;
}

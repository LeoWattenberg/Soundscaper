# Fourth audit: 100 additional user-reproducible bugs

This audit fixes 100 distinct defects beyond the previous audits' 303. Each
counted entry has ordinary public steps in Soundscaper or Framescaper: menus,
keyboard input, recording, supported editing controls, or import and export.
The detailed registers record each reproduction, observed failure, correction
and regression evidence.

| Area | IDs | Count | Detailed register |
| --- | --- | ---: | --- |
| Effects, generators, macros, mixer, analysis and toolbar commands | R4-ROOT-001–025 | 25 | [Effects and analysis](bugfix-round4-effects-analysis.md) |
| Timeline editing, selection, native visual commands and routing | R4-EDIT-001–030 | 30 | [Editing](bugfix-round4-editing.md) |
| Dialogs, preferences, field commits, focus and workspace geometry | R4-DIALOG-001–029 | 29 | [Dialogs and controls](bugfix-round4-dialogs.md) |
| Import, export, source timing, delivery and project copies | R4-IO-001–016 | 16 | [Import and export](bugfix-round4-io.md) |
| Total | | **100** | |

Public browser workflows first failed against the immutable pre-fix baseline
`a0322d6e4`. Independently implemented owners were also checked against snapshots
containing related corrections when needed to establish that a candidate remained
broken. Corrected workflows were exercised in Chromium, Firefox and WebKit,
subject to the capability exclusions explicitly recorded in their registers.
Focused domain or faithfully mounted production-control tests accompany the fixes.

The count excludes malicious prepared files, private-state injection, inaccessible
controls, passing hypotheses, unsupported operations without an exposed erroneous
entry point, and test-harness or timing failures. Media comes from normal editor
output or established recording/writing tools. Read-only observers measure actual
downloads, sample values, rendered output and public control state; they do not
provide inaccessible steps for causing a defect.

Variants sharing one cause count once. The owners' cross-audit review distinguishes
independent handlers, command planners and delivery boundaries from variants of
the same implementation. Additional corrections for a recorded cause add no ID,
including bus-profile capture with Master muted, integer keyframe bridge policy,
native visual mapper follow-through, ADM archive copies, consumer registration and
the desktop application's JavaScript runtime inventory. Failed setup attempts and
invalid secondary expectations remain excluded rather than being converted into
counted defects.

Changes are committed atomically with explicit owned paths. The closing gate and
full browser verification are recorded below when complete; focused public green
runs alone are not described as an uninterrupted full-suite pass.

Manual **Update AI assets** is not required. These fixes retain the assistance
engine closure, source pins, recipes, archives, signing logic and engine targets.
The desktop inventory correction concerns the application's project-library
JavaScript, not assistance runtime publication.

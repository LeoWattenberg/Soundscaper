# Round six import and export bugs

Only distinct defects reachable through ordinary menus, pickers and authored
projects qualify. Variants of one broken owner count once; setup failures and
unreachable internal inputs are excluded.

| ID | Ordinary user workflow | Defect and repair | Evidence |
| --- | --- | --- | --- |
| R6-IO-001 | Import a normal WAV, then import an Audacity TXT label file with Interview and Transcript point labels at zero and Conclusion at 0.4 seconds. Export audio → Chapters (split by labels) → Export; inspect the downloaded ZIP. | The archive silently omitted Interview because its chapter ended at Transcript's identical start. Coincident boundaries now share the next distinct start, retaining each named output. A coincident region still constrains a point's end; original document and distinct boundaries retain their behavior. Label/marker and point/region manifestations share this boundary resolver root. | Actual public Chromium RED: `/tmp/soundscaper-r6-io-coincident-red.log`, two archived files instead of three. Public GREEN on immutable green1: `/tmp/soundscaper-r6-io-public-green1b.log`, exact Interview/Transcript/Conclusion filenames and three valid WAV bodies. Strict causal tests: 2 RED plus passing distinct-boundary control → GREEN; chapter and embedded-chapter support: 36/36 pass (`/tmp/soundscaper-r6-io-coincident-node-green.log`). Targeted type-aware ESLint passes. |

No assistance runtime source pins, recipes, archive logic, dependencies or target
inventories changed. A manual **Update AI assets** run is not required.

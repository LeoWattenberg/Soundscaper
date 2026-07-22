# Audacity bundled Nyquist plug-ins

The 25 `.ny` files in this directory are unmodified copies of Audacity 3.7.7's
`plug-ins/` directory at commit
`5ef610ed23260d6d648175735bb16b32536eb30b`. Their exact SHA-256 digests are
recorded in `source-manifest.json`; the copyright and license declarations in
each plug-in remain intact.

Three bundled scripts are intentionally not shipped because browser Nyquist
does not expose host file access:

- `nyquist-plug-in-installer.ny`
- `sample-data-export.ny`
- `sample-data-import.ny`

The registry assigns every `process` plug-in to the `legacy` category. Generate
and analyze plug-ins retain their corresponding menu categories.

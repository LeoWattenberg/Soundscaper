# Controller domain ownership

- Put every controller source in one of the existing domain directories.
- A file directly under a domain is public and must be listed in
  `config/controller-domain-public-modules.json`. Put implementation used only by
  its owner under that domain's `internal/` directory.
- Other domains and product code may import public modules only. Import the owning
  file directly; do not add index modules, barrels, or value wildcard exports.
- Treat a public-list addition as an API decision. Prefer a narrow contract, state
  capability, facade, or composition entry point over exposing a service implementation.

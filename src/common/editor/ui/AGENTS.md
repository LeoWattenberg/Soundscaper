# Editor UI guidance

- Keep React presentation independent from editor domain ownership; move reusable
  state and browser lifecycles into the narrow domain/controller module.
- `audio-editor-design-system.css` is an ordered import manifest. Add rules to
  the matching feature module without reordering imports or weakening the
  `#kw-audio-editor-design-system` scope. Every maintained CSS module must stay
  within the 600-line limit.
- Put cross-feature responsive/accessibility overrides in the final module;
  keep feature-local media queries beside the feature when cascade order matters.
- Prefer a focused component or lazy Inspector entry over extending the editor
  shell. Add focused Node tests for extracted logic and browser coverage for
  user-visible interaction changes.

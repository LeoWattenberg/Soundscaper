# Translation catalog build ownership

Each locale retains one committed JSON catalog with complete origin-tagged
translation tuples, provenance and community attribution. The generated loader
index and runtime staleness checks continue to own locale selection and English
fallback. A changed English string retires its old translation until an official
writer updates it.

The production build's compact-catalog plugin partitions large generated entry
objects into modules bounded at 200,000 source bytes. It uses contiguous groups
of entries, compacts each group through the existing renderer, and imports them
statically from the catalog's existing lazy root. Each part has a separate locale
and ordinal chunk owner, preventing the bundler from recombining the entire
catalog into one oversized JavaScript chunk. Small catalogs keep one module.
The production 500,000-byte chunk ceiling remains authoritative.

Vite's speculative preload lists omit these part filenames and the redundant
catalog-root entry. Otherwise the eager loader's preload table names every
locale's parts even before any locale is selected. The root's native static
imports still fetch every part before its import resolves, and unrelated
JavaScript and CSS preload dependencies remain unchanged. Startup byte and
request ceilings continue to apply without adjustments.

The lazy root retains the original field order and populates its existing entries
object with data properties. Named `entries` and default-catalog exports therefore
refer to the same object. Numeric and prototype-like keys, malformed JSON rows
and complete attribution remain available to the unchanged runtime validator;
partitioning does not filter or reinterpret catalog contents. An indivisible
oversized entry or metadata payload fails the build explicitly.

Generated parts are scoped to their own catalog root, watch the original JSON,
and are discarded when a catalog reloads or a new build begins. They are build
artifacts rather than new committed catalogs. Development continues to use the
original JSON imports. A read belongs to both its build and its catalog-load
generation; superseded reads refuse publication before replacing any parts.
Source-map qualification must retain the provenance
normalizer's classification for generated virtual modules.

The focused Vite build tests exercise the real plugin and production chunk groups
on the complete Hindi catalog and a grown fixture. They check emitted chunk
sizes, absence from the entry's static dependency graph, exact lazy-loaded data,
named-export identity and runtime staleness. The fixture disables browser module
preloading so Node can execute its output; full product builds and browser tests
remain separate validation. A separate fixture builds with the production
preload configuration and checks that part filenames stay out of the eager
loader while its lazy root retains every native dependency. Renderer tests also evaluate every published locale,
and watch tests cover replacement and cross-locale ownership.

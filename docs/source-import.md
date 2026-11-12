# Static source import

The importer parses text in a terminable Worker with TypeScript's TSX AST parser. It does not evaluate expressions, resolve imports, run constructors/handlers, load URLs or retain the original text in the project/archive. Maximum source size: 256 KiB; AST traversal: 50,000 nodes / depth 128; declarative elements: 256 / depth 64.

Supported: explicit `group`, `mesh`, JSX fragments, box/sphere/torus/cylinder/cone/plane geometry with the supported leading constructor arguments, and scalar `meshStandardMaterial` / `meshPhysicalMaterial` PBR fields. Positions/rotations/scales are literal vectors; scalar scale is supported. Colors use six-digit HEX converted to Linear-sRGB. Omitted constructor values follow Three.js defaults rather than editor primitive defaults.

HTML means JSX-compatible fragments and structural html/body/main/div/section wrappers. Ordinary HTML/canvas rendering, scripts, imperative Three.js, custom components, conditions, loops, dynamic children/attributes, resource loading, textures and animation are not converted. They are skipped with range/type/cause diagnostics or rejected for invalid syntax. This is deliberately partial static extraction, not execution or universal conversion.

The report precedes an explicit “Добавить поддержанные объекты” action. That action commits all supported nodes/materials in one transaction; failure leaves the document unchanged. Hidden parents are applied after their descendants. Undo/Redo treats the import as one operation. Unsupported content is skipped; arbitrary replacement and attachment of the original source are not offered in this version.

Validation: parser/domain transaction tests include literal hierarchy/materials, source defaults, hidden groups, fragments, calls/imports/handlers/conditions, size/syntax/geometry failures. Browser smoke confirmed dry-run report, cube+torus rendering, and whole-import Undo/Redo with no console errors; proof `qa/source-import.png`.

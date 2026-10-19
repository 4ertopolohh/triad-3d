# TRIAD-3D — Codex instructions

You are implementing TRIAD-3D based on the approved engineering specification, not improvising product functionality.

## Workflow
1. Read docs/architecture.md, docs/data-contracts.md and the chosen task from docs/implementation-plan.md.
2. Check task dependencies and current repository state; do not assume the code exists.
3. Execute a single coherent task or a tightly coupled set; avoid scope creep.
4. Keep `domain` as source of truth, with commands/transactions for writes.
5. Run build/typecheck and targeted tests relevant to the modified code; full suite at milestones.
6. Report changed paths, concise behavior summary, tests, and known limitations; no long repetitive reports.

## Hard constraints
- One primary Model and one Scene per project; nested detail groups allowed.
- In-memory-only session; no localStorage, IndexedDB or server persistence of document/history.
- Explicit manual project save/reopen via versioned archive.
- Never eval untrusted TSX/JSX/HTML; static allowlist with diagnostic partial import (NEXT).
- All geometry modifications rollback on failure.
- Editor UI Russian, desktop-first, reference Triad Studio visual tokens but respect font licenses.
- TSX exporter must build in clean Vite/React harness; do not claim glTF preserves arbitrary runtime interactions.
- Heavy jobs block editing but status and supported cancellation stay responsive.
- All model modifications derive from user-approved domain state, not direct uncontrolled Three.Object3D mutation.

## Autonomy
You may create/edit files, install needed libraries, refactor local task implementation and correct errors. You must not silently change domain invariants, delete unrelated data, modify approved scope, ship unsupported features as complete, or alter security/privacy rules without approval.

## Priority
Geometry → Materials → Animation → TSX/ZIP export; NEXT only after MVP gate.

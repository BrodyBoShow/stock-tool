## Summary

<!-- What changed and why. -->

## Type
- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / cleanup
- [ ] CI / tooling / docs

## Checklist
- [ ] `ruff check engine api scripts` passes
- [ ] `npm run build` (tsc + vite) passes in `frontend/`
- [ ] No new duplication — reused existing helpers in `lib/format.ts`,
      `components/ui/`, `engine/` instead of copy-pasting
- [ ] Hardcoded values went into a constant/config (not scattered literals)
- [ ] Behaviour preserved (refactors are behaviour-neutral) / called out if not
- [ ] Screenshot attached if the UI changed

## Screenshots (if UI)

# AGENTS.md

StartOS 0.4 service package for stock upstream Mealie. Builds a `.s9pk`. Packaging guide: <https://docs.start9.com/packaging>.

- Don't fork or patch Mealie. Configure it only through env vars in `startos/main.ts`.
- Keep `README.md` (technical reference) and `instructions.md` (shown to the user on the box) in sync with changes.
- i18n keys in `startos/i18n/dictionaries/default.ts` must match every `i18n('...')` string exactly. Only `en_US` exists.
- Version bumps: follow `UPDATING.md`.
- Check with `npx tsc --noEmit` before building.

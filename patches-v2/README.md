# Rakazo patches v2 (tip-as-base)

**IT / EN**

## Modello dopo il cutover 2026-10-27 / Model after the 2026-10-27 cutover

| | Prima / Before | Ora / Now |
|--|----------------|-----------|
| Base | Upstream pin `0723154` + `series/0001`–`0050` | Tip fork `REBASE_TIP` (`7c1067d…`) |
| Image tag | `0723154-nk50` | `rebase-7c1067d` |
| `series/` | 50 patch applicate in build | **Vuota** — solo delta *futuri* vs tip / **Empty** — future deltas vs tip only |

IT: L’immagine di produzione è già il tip rebase. **Non** rigiocare la serie storica sul pin vecchio.  
EN: Production already runs the rebase tip. **Do not** replay the historic series onto the old pin.

Pins: `PINS`. Compose host tweak (idle/timeout): `compose/0001-*.patch` (optional; tip compose already exposes `SANDBOX_IDLE_MS`).

## Generare la serie di audit (non per apply sul tip) / Audit series (not for apply onto tip)

```bash
# vs upstream-at-merge (includes synthetic pin tree + post-merge fixups)
git format-patch a0e57811172f5286d3d113e3117470d3762e2b99..HEAD -o series-post-rebase/vs-upstream-a0e5781

# post-merge fixups only
git format-patch ac1f18f76..HEAD -o series-post-rebase/post-merge-fixups
```

Copies of the 2026-10-27 regen live under the operator logs dir `series-post-rebase/` (not required in-tree).

## Serie storica / Historic series

IT: `0001`–`0050` sul pin `0723154` resta su branch `selfhost-v2` e negli archivi operatore. Vedi `HISTORIC.md`.  
EN: `0001`–`0050` on pin `0723154` remains on branch `selfhost-v2` and in operator archives. See `HISTORIC.md`.

## update-rakazo-v2.sh

IT: `check` / `build` / `cutover` leggono `CURRENT_TAG` + `REBASE_TIP` (mode **tip-as-base**).  
Se mancano, resta il legacy **pin-series** (`UPSTREAM_COMMIT` + `nkN`).  
`./update-rakazo-v2.sh check` stampa mode, tip, tag target e conteggio series.

EN: `check` / `build` / `cutover` honour `CURRENT_TAG` + `REBASE_TIP` (**tip-as-base**).  
If unset, legacy **pin-series** (`UPSTREAM_COMMIT` + `nkN`) remains.  
`./update-rakazo-v2.sh check` prints mode, tip, target tag, and series count.

See `NOTE-update-script.md`.

## Build futuri / Future builds

1. Commit deltas on `rebase/onto-upstream-main` (or successor).
2. `git format-patch <REBASE_TIP>..<new-tip> -o patches-v2/series/` (or squash).
3. Update `PINS` (`REBASE_TIP`, `CURRENT_TAG`, `APP_DIGEST` after build).
4. `./update-rakazo-v2.sh build` then `cutover --yes` when authorized.

## Scrub

IT/EN: No personal hostnames, IPs, or private namespaces in files committed here.

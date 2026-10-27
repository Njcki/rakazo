# Changelog — patches-v2

## 2026-10-27 — update-rakazo-v2 tip-as-base

**IT:** `update-rakazo-v2.sh` risolve `TAG` da `CURRENT_TAG` / `REBASE_TIP` (compat pin-series se assenti).  
`check` mostra pin mode; `build` con series vuota = verifica immagine locale.

**EN:** `update-rakazo-v2.sh` resolves `TAG` from `CURRENT_TAG` / `REBASE_TIP` (pin-series fallback).  
`check` prints pin mode; empty-series `build` verifies the local tip image.

## 2026-10-27 — tip-as-base (post cutover)

**IT:** Cutover produzione su `rakazo-app-nk:rebase-7c1067d` (tip `7c1067d20`).  
Nuovo modello: base = tip rebase; `series/` vuota per delta futuri.  
Serie storica `0001`–`0050` su pin `0723154` archiviata (`HISTORIC.md`, branch `selfhost-v2`).  
Regen format-patch di audit in logs `series-post-rebase/`.  
`PINS` aggiornato: `UPSTREAM_COMMIT=a0e578111…`, `REBASE_TIP=7c1067d…`, `CURRENT_TAG=rebase-7c1067d`.

**EN:** Production cut over to `rakazo-app-nk:rebase-7c1067d` (tip `7c1067d20`).  
New model: base = rebase tip; empty `series/` for future deltas.  
Historic `0001`–`0050` on pin `0723154` archived (`HISTORIC.md`, branch `selfhost-v2`).  
Audit format-patch regen in operator logs `series-post-rebase/`.  
`PINS` updated: `UPSTREAM_COMMIT=a0e578111…`, `REBASE_TIP=7c1067d…`, `CURRENT_TAG=rebase-7c1067d`.

## Historic (pin 0723154 / nk50)

See branch `selfhost-v2` `patches-v2/CHANGELOG.md` for entries through patch 0050 / nk50.

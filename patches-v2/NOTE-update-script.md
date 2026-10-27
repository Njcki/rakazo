# update-rakazo-v2.sh and tip-as-base

**IT:** Lo script risolve il tag così:

1. Se `CURRENT_TAG` è impostato → `TAG=$CURRENT_TAG` (mode `tip-as-base`)
2. Altrimenti se `REBASE_TIP` → `TAG=rebase-<7 hex>` (mode `tip-as-base`)
3. Altrimenti legacy → `TAG=<UPSTREAM:0:7>-nk<N>` (mode `pin-series`)

Con `series/` vuota, `build` verifica che `rakazo-app-nk:$TAG` esista in locale (no-op).  
Con patch in `series/`, `build` fa `FROM` quell’immagine tip e applica le patch.

**EN:** Tag resolution:

1. `CURRENT_TAG` set → `TAG=$CURRENT_TAG` (`tip-as-base`)
2. Else `REBASE_TIP` → `TAG=rebase-<7 hex>` (`tip-as-base`)
3. Else legacy → `TAG=<UPSTREAM:0:7>-nk<N>` (`pin-series`)

Empty `series/`: `build` checks the local tip tag (no-op).  
Non-empty `series/`: `build` uses that tip image as `BASE` and applies patches.

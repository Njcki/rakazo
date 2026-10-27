# update-rakazo-v2.sh and tip-as-base

**IT:** Lo script su host (`update-rakazo-v2.sh`) calcola ancora  
`TAG="${UPSTREAM_COMMIT:0:7}-nk${NSERIES}"` e fa `build` applicando `series/` sul digest in `PINS`.  
Con tip-as-base e `series/` vuota **non** lanciare `build`/`cutover` finché lo script non legge `CURRENT_TAG` / `REBASE_TIP`.

**EN:** The host script (`update-rakazo-v2.sh`) still derives  
`TAG="${UPSTREAM_COMMIT:0:7}-nk${NSERIES}"` and `build`s by applying `series/` onto the pinned digest.  
With tip-as-base and an empty `series/`, **do not** run `build`/`cutover` until the script honours `CURRENT_TAG` / `REBASE_TIP`.

require "pagy"

# Page size defaults for admin index tables. Override per-request with
# ?per_page=N (clamped to MAX). Stays headless — no view helpers loaded.
Pagy::DEFAULT[:limit]     = 50
Pagy::DEFAULT[:max_limit] = 200
Pagy::DEFAULT[:size]      = 7

# Quantum Error Correction Made Simple

An interactive homepage and toolkit for quantum error correction. It is a static site with no build step, no runtime dependencies, and no network calls apart from Google Fonts.

## Tools

| Tool | What it does |
| --- | --- |
| **Surface code lab** | Rotated surface code at distance 3 to 9. Click qubits to inject X, Z or Y errors, see the defects light up, decode with minimum-weight matching, and apply the correction. |
| **Threshold simulator** | Monte Carlo of logical error rate against physical error rate for d = 3, 5, 7 under bit-flip, phase-flip or depolarizing code-capacity noise, with 95% Wilson intervals. Seeded and reproducible. |
| **Syndrome calculator** | Stabilizer syndromes for the 3-qubit bit-flip, five-qubit, Steane and Shor codes, with single-qubit error lookup. |
| **Resource estimator** | Required code distance and physical qubit count from the scaling rule p_L ≈ A·(p/p_th)^((d+1)/2). |

The page also has a code atlas, a timeline, and links to Stim, PyMatching, Qiskit and key papers.

## Layout

```
site/                  static site (deployed as-is)
  index.html
  assets/css/site.css
  assets/js/qec.js     pure QEC logic (Pauli algebra, surface code, decoder, simulation, estimator)
  assets/js/app.js     DOM wiring
tests/qec.test.mjs     unit tests for qec.js (node:test)
scripts/serve.mjs      local static server
.github/workflows/     CI (tests) and GitHub Pages deployment
```

## Local development

Requires Node.js 20 or later. No `npm install` is needed.

```bash
npm start        # http://127.0.0.1:8080
npm test         # unit tests
npm run check    # syntax check + unit tests (what CI runs)
```

## Decoder

The decoder builds one matching graph per error type (Z checks for X errors, X checks for Z errors) with a single virtual boundary node. It runs exact minimum-weight perfect matching by bitmask dynamic programming for up to 12 defects, and falls back to greedy shortest-pair matching above that. The UI says when the fallback was used. The tests confirm that every error of weight up to (d−1)/2 is corrected at d = 3 and d = 5.

The simulator models code-capacity noise, meaning perfect syndrome measurement. Thresholds are therefore much higher than the roughly 1% circuit-level threshold that matters on hardware.

## Deployment

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on every push to `main` that touches the site. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Security

- A strict Content-Security-Policy allows only same-origin scripts and Google Fonts. There are no inline scripts or styles and no third-party JavaScript.
- Workflows run with `contents: read` by default. Only the deploy job gets `pages: write` and `id-token: write`.
- The site collects no data. The only browser storage is the theme preference.

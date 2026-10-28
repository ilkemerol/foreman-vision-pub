# Lottie animations

These animation files were downloaded from [LottieFiles](https://lottiefiles.com). They are distributed under the **Lottie Simple License** ([LICENSE.md](LICENSE.md)), **not** under the repository's MIT license. The files are unmodified.

Nothing is fetched from the network at runtime: the browser loads them from `/lottie/<file>.json` (see `web/src/lottie.ts`), and lottie-web plays them.

| File | Name in code | Where it plays | Author |
|---|---|---|---|
| `a-confetti-burst.json` | `confetti` | Once over a floor's card when a new floor appears in the sidebar | unknown |
| `b-ring-the-bell.json` | `bell` | Balloon icon of an agent that needs you to act (for example a permission request) | unknown |
| `b-question-mark.json` | `question` | Balloon icon of a wait the foreman will handle (a question mark) | unknown |
| `f-alert-lamp.json` | `lamp` | The siren lamp over a waiting agent whose wait carries an alert | unknown |
| `c-success-check.json` | `check` | The check mark over a finished agent in the Done lounge | unknown |
| `c-brewing-coffee.json` | `coffee` | Registered in `web/src/lottie.ts`, not played by the current UI | Carolina Salazar ("Coffee cup being filled", per the file's metadata) |

The original LottieFiles pages of these animations were not recorded, so authors other than the one named in a file's own metadata are unknown. If you are the creator of one of them and want credit or a link added, please open an issue.

In the office the animations are pixelated (downsampled to a few pixels and scaled up with smoothing off); the sidebar confetti plays smoothly.

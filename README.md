# Easy Keto Carnivore Cookbook

1,000 easy keto carnivore recipes as a fast, searchable web app that installs on your phone and works offline.

## Features
- **Search everything**: titles, ingredients, steps and tips. Phrases (`"cream cheese"`), exclusions (`chicken -wings`) and nutrition filters (`protein>40`, `calories<500`, `carbs<2`, `time<=20`, `serves>=6`).
- **Filters & sorting**: category, total time, main ingredient, cooking method, budget picks, calories/protein/net-carb sliders; sort by protein per calorie, quickest, fewest carbs and more.
- **Recipe pages**: estimated nutrition per serving, serving scaler, tap-to-check ingredients, one-tap step timers, notes, star ratings, "I made this" log, print and share.
- **My lists**: ♥ Favorites, ☆ Want to try, 👍 Tried · liked, 👎 Tried · didn't like, plus a Cooked log and Recently viewed. Disliked recipes are hidden from browsing and auto-fill (toggle in filters). Finishing a recipe asks how it was.
- **Kitchen timer**: start any timer from the ⏱ button or tap a time inside a step. Multiple timers, pause, +1 min, snooze; they survive reloads and send a notification + sound + vibration when done (on iPhone the alert shows when the app is open).
- **Cook mode**: big one-step-at-a-time view, swipe or arrow keys, keeps the screen awake.
- **Meal planner**: 7-day plan with daily calorie/protein/fat/carb goals, auto-fill, household size.
- **Shopping list**: built from a recipe or the whole week, combines matching items, grouped by aisle, copy/share/print.
- **What can I make?**: enter what's in the fridge and see recipes you can cook now.
- **Installable & offline** (PWA): add to home screen; everything works with no internet after the first visit.
- Dark mode, backup/restore of your data, printable PDF download.

Your favorites, notes, plans and lists are stored in your browser on that device only (Settings → Download backup to move them).

## Put it on GitHub Pages
1. Create a new repository (or use an existing one) and upload **all files in this folder**, keeping the `icons` folder.
2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
3. After a minute your site is live at `https://<your-username>.github.io/<repo-name>/`.
4. On your phone, open that link:
   - **iPhone/iPad**: in Safari tap **Share → Add to Home Screen**.
   - **Android**: Chrome menu **⋮ → Install app** (or Add to Home screen).

## Updating the site
After changing any file, open `sw.js` and bump `VERSION` (for example `ekc-v1` → `ekc-v2`) so installed phones pick up the new version.

## Files
| File | What it is |
|---|---|
| `index.html` | page shell |
| `app.js` | the app |
| `styles.css` | look and feel |
| `recipes.js` | all 1,000 recipes with nutrition and tags |
| `sw.js` | service worker (offline) |
| `manifest.webmanifest` | app name, colors, icons |
| `icons/` | app icons (home screen, favicon) |
| `Easy_Keto_Carnivore_Cookbook.pdf` | printable cookbook (optional; delete it to hide the download link) |

Nutrition values are estimates per serving from USDA data for the listed ingredients. General cooking inspiration, not medical advice.

# Calorie Tracker

A simple calorie tracker that runs in Safari and installs on your iPhone's Home Screen like an app.
Your food log is saved **only on your phone**. Nothing is sent to GitHub or any server.

## Features

- Daily calorie ring and protein / carbs / fat bars against your goals
- Breakfast, lunch, dinner and snacks; tap an entry to change or delete it
- Food search: your own foods first, then the USDA FoodData Central database
- Barcode scanning with the camera (product data from Open Food Facts), or type the number
- Quick add calories, and custom foods from a nutrition label
- History: week and month charts, daily average, logging streak
- Export / restore a backup file (save it to Files or iCloud Drive)
- Works offline once installed (search needs a connection)

## Put it on GitHub Pages

1. Create a **public** repository, for example `calorie-tracker`.
2. Upload everything in this folder to the repository root (keep the folders as they are).
3. In the repository go to **Settings → Pages**, set **Source** to "Deploy from a branch",
   pick **main** and **/ (root)**, and save.
4. After a minute or two the app is at `https://YOUR-USERNAME.github.io/calorie-tracker/`.

## Install on iPhone

Open the link in **Safari**, tap **Share**, then **Add to Home Screen**. Always open it from that icon:
your data is kept safest that way.

## Food search key (free)

Search works out of the box with a shared demo key, but that allows only about 30 searches an hour.
Get your own free key at https://fdc.nal.usda.gov/api-key-signup and paste it into **Settings** in the app.
The key is saved on your phone only, never in the code.

## Updating the app

Change the files, bump `VERSION` in `sw.js` (for example `v1.0.1`), and upload. Phones get the new
version the next time the app is opened (sometimes it takes a second open). Saved logs are not affected.

## Where things are

| File | What it does |
| --- | --- |
| `index.html` | Page shell and tab bar |
| `css/app.css` | All styling |
| `js/app.js` | Screens and interactions |
| `js/foods.js` | USDA search, Open Food Facts barcode lookup, portion maths |
| `js/store.js` | **All saving and loading.** Replace `load()` / `save()` here to move to Firestore later |
| `sw.js` | Offline support (caches the app files, not your data) |
| `manifest.webmanifest`, `icons/` | Home Screen name and icon |
| `vendor/zxing.min.js` | Barcode reading library (MIT licence) |

## Credits

Food data: USDA FoodData Central (public domain).
Barcode data: Open Food Facts, available under the Open Database License (ODbL).
Barcode scanning: ZXing for JavaScript (MIT).
Nutrition values are estimates; check labels for anything important.

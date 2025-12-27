# Sufa Status (סטטוס כלים – סופה)

Repo סטטי שמציג טבלת סטטוס רחפנים על גבי GitHub Pages.

## מבנה
- `index.html` – המסך הראשי
- `style.css` – עיצוב
- `app.js` – לוגיקה (פילטרים, חיפוש, עריכה מקומית, ייצוא/ייבוא JSON)
- `data/drones.json` – מקור האמת (הנתונים)

## הפעלה מקומית
פתח את `index.html`.
אם `fetch` נחסם מקומית, הרץ שרת קטן:
- `python -m http.server 8000`
ואז: `http://localhost:8000`

## פרסום ב-GitHub Pages
GitHub → Settings → Pages → Deploy from branch → `main` + `/ (root)`.

## עריכה
העריכה נשמרת מקומית (LocalStorage). כדי לעדכן את הריפו:
Export JSON → החלף את `data/drones.json` → Commit.

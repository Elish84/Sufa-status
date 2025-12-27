# Sufa Status – Firebase (Firestore)

## מה זה
דף סטטוס רחפנים (GitHub Pages) עם:
- הוסף רחפן
- מיון לפי עמודה
- עריכה בטבלה
- שמירה ל-Firestore (אחרי התחברות)

## איך מחברים Firebase
1) Firebase Console → Create project  
2) Build → Firestore Database → Create database  
3) Build → Authentication → Get started → Enable **Email/Password**  
   צור משתמש (Users → Add user)

4) Project settings → Your apps → Web app → copy config  
הדבק בתוך `index.html`:
```js
window.SUFA_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  appId: "...",
};
```

## Firestore Rules (מינימום סביר)
```
// Firestore rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sufa/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
      match /drones/{droneId} {
        allow read: if true;
        allow write: if request.auth != null;
      }
    }
  }
}
```

## מודל נתונים
- `sufa/status` (doc) עם `last_updated`
- `sufa/status/drones/<id>` מסמך לכל רחפן

## פרסום
העלה את הקבצים לריפו והפעל GitHub Pages.

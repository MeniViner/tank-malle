# טנק מלא ב־Google Play

בדיקת ההכנה ב־16 בנובמבר 2026 מצאה שחבילת Android ‏1.10.0 המותקנת משתמשת ב־`com.meniviner.tankmalle`, מכוונת ל־API 36, ועוברת `zipalign -c -P 16 4`. מקטעי ELF מסוג `PT_LOAD` בספריות שלה מיושרים ל־16KB. יש לחזור על בדיקת החבילה ועל בדיקת התקנה עבור ה־AAB שמיועד להעלאה. [דרישת Target SDK](https://support.google.com/googleplay/android-developer/answer/11926878), [תמיכה ב־16KB](https://developer.android.com/guide/practices/page-sizes)

- לבנייה ל־Play יש לסנכרן את קוד הווב עם פרויקט Capacitor המקורי, להשתמש במזהה החבילה הרשום וב־`versionCode` גבוה מכל קוד שכבר הועלה. השתמשו במאזין החזרה של המאגר ובדקו שאין מאזין נוסף במעטפת. בנו AAB מסוג release, אמתו אותו עם `bundletool validate`, בדקו את המניפסט ואת הספריות בחבילה וחתמו במפתח ההעלאה של Play. בדקו התאמת חתימת ההפצה להתקנות הקיימות אם הגרסה מיועדת לעדכן אותן. [חתימה והעלאת חבילה](https://developer.android.com/studio/publish/app-signing)
- מסך פרטיות ציבורי נמצא ב־`https://tank-malle.web.app/legal/privacy`. למסך המחיקה הציבורי השתמשו ב־`https://tank-malle.web.app/legal/delete-account` בשדה Account deletion ב־Play Console. הקישור פותח את מסלול המחיקה בחשבון אחרי התחברות. [מדיניות פרטיות ומחיקה](https://support.google.com/googleplay/android-developer/answer/10144311)
- טופס Data safety צריך לשקף את גרסת ההפצה ואת ה־SDKs שבה. האפליקציה מסנכרנת דרך Firebase פרטי התחברות, רכבים, יומן תדלוק והוצאות, העדפות, משוב ונתוני התראות לפי שימוש. שיתוף דוגמאות סריקה דורש בחירה וכולל חיתוכים או תמונה מוקטנת, קריאות ונתוני החשבון. מיקום המכשיר משמש במכשיר למיון. תחנה שנבחרה יכולה להישמר ברשומת התדלוק. חיפוש לפי מספר רישוי שולח את המספר ל־data.gov.il. [הנחיות Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- אמתו במניפסט של ה־AAB שהרשאות גלריה רחבות או מיקום ברקע אינן כלולות. בדקו בחירת תמונה דרך הבורר של Android, בקשת מיקום רק לאחר פעולה מפורשת אם טרם ניתנה הרשאה, וקבלת החלטה נפרדת לפני שיתוף דוגמאות סריקה. [הרשאות מידע רגיש](https://support.google.com/googleplay/android-developer/answer/16558241)
- במסלול בדיקה פנימי ב־Play בדקו התקנה והתחברות ל־Google בחתימת ההפצה, תדלוק ומצלמה, חזרה, מחיקת חשבון והתראות. מלאו App access עם חשבון בדיקה שאינו מכיל נתונים אישיים והוראות שחוזרות על עצמן. השלימו את הצהרות התוכן ודרישות החשבון שמופיעות ב־Play Console. [גישה לסקירה](https://support.google.com/googleplay/android-developer/answer/15748846), [דרישות בדיקה לחשבונות אישיים חדשים](https://support.google.com/googleplay/android-developer/answer/14151465)

ה־APK מסוג `.backtest` שבונה `scripts/build-android-back-rc.mjs` משמש ל־DEV עם אמולטורים של Firebase. החבילה שמיועדת ל־Play תלויה בפרויקט Android ובחתימת ההעלאה של אפליקציית ההפצה.

## בניית חבילת Android מהמאגר הזה

הענף הזה משלב את פרויקט Android המקורי עם תיקוני גרסה 1.10.1. על המק המשמש לחתימה דרושים Node 22 ומעלה, JDK 21, ‏Android SDK 36, הגדרות מקומיות לפרופיל `native-personal` ומפתח החתימה הקיים. ראו גם [הגדרות ההתקנה](native-install.md).

```sh
export TANK_MALLE_SIGNING_DIR=/path/to/local/signing-directory
export TANK_MALLE_BUILD_NUMBER=4
npm ci
npm run native:prepare -- personal android
(cd android && ./gradlew :app:bundlePersonalRelease)
```

`4` הוא המספר שאחרי בנייה `3` של 1.10.0. אם כבר הועלתה בנייה למסלול ב־Play, בחרו מספר גבוה מכל המספרים שכבר שימשו שם. קובץ ההעלאה נוצר ב־`android/app/build/outputs/bundle/personalRelease/app-personal-release.aab`. מפתח החתימה, הסיסמה וההגדרות המקומיות נשארים על המק.

ב־Windows אפשר לערוך את הקוד ולהריץ `npm ci` ו־`npm test`. לבדיקה על Samsung שמריץ התקנה ישירה חתומה של 1.10.0, משתמשים ב־APK החתום של אותה בנייה עם `adb install -r <path-to-apk>` ובודקים שהמידע נשמר ופעולת ״חזור״ תקינה. אם החתימה אינה תואמת, עוצרים ומשאירים את האפליקציה הקיימת מותקנת. ה־AAB משמש להעלאה ל־Play Console ולבדיקה במסלול בדיקות.

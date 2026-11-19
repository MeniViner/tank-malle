# טנק מלא ב־Google Play

בדיקת ההכנה ב־16 בנובמבר 2026 מצאה שחבילת Android ‏1.10.0 המותקנת משתמשת ב־`com.meniviner.tankmalle`, מכוונת ל־API 36, ועוברת `zipalign -c -P 16 4`. מקטעי ELF מסוג `PT_LOAD` בספריות שלה מיושרים ל־16KB. יש לחזור על בדיקת החבילה ועל בדיקת התקנה עבור ה־AAB שמיועד להעלאה. [דרישת Target SDK](https://support.google.com/googleplay/android-developer/answer/11926878), [תמיכה ב־16KB](https://developer.android.com/guide/practices/page-sizes)

- לבנייה ל־Play יש לסנכרן את קוד הווב עם פרויקט Capacitor המקורי, להשתמש במזהה החבילה הרשום וב־`versionCode` גבוה מכל קוד שכבר הועלה. השתמשו במאזין החזרה של המאגר ובדקו שאין מאזין נוסף במעטפת. בנו AAB מסוג release, אמתו אותו עם `bundletool validate`, בדקו את המניפסט ואת הספריות בחבילה וחתמו במפתח ההעלאה של Play. בדקו התאמת חתימת ההפצה להתקנות הקיימות אם הגרסה מיועדת לעדכן אותן. [חתימה והעלאת חבילה](https://developer.android.com/studio/publish/app-signing)
- מסך פרטיות ציבורי נמצא ב־`https://tank-malle.web.app/legal/privacy`. למסך המחיקה הציבורי השתמשו ב־`https://tank-malle.web.app/legal/delete-account` בשדה Account deletion ב־Play Console. הקישור פותח את מסלול המחיקה בחשבון אחרי התחברות. [מדיניות פרטיות ומחיקה](https://support.google.com/googleplay/android-developer/answer/10144311)
- טופס Data safety צריך לשקף את גרסת ההפצה ואת ה־SDKs שבה. האפליקציה מסנכרנת דרך Firebase פרטי התחברות, רכבים, יומן תדלוק והוצאות, העדפות, משוב ונתוני התראות לפי שימוש. שיתוף דוגמאות סריקה דורש בחירה וכולל חיתוכים או תמונה מוקטנת, קריאות ונתוני החשבון. מיקום המכשיר משמש במכשיר למיון. תחנה שנבחרה יכולה להישמר ברשומת התדלוק. חיפוש לפי מספר רישוי שולח את המספר ל־data.gov.il. [הנחיות Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- אמתו במניפסט של ה־AAB שהרשאות גלריה רחבות או מיקום ברקע אינן כלולות. בדקו בחירת תמונה דרך הבורר של Android, בקשת מיקום רק לאחר פעולה מפורשת אם טרם ניתנה הרשאה, וקבלת החלטה נפרדת לפני שיתוף דוגמאות סריקה. [הרשאות מידע רגיש](https://support.google.com/googleplay/android-developer/answer/16558241)
- במסלול בדיקה פנימי ב־Play בדקו התקנה והתחברות ל־Google בחתימת ההפצה, תדלוק ומצלמה, חזרה, מחיקת חשבון והתראות. מלאו App access עם חשבון בדיקה שאינו מכיל נתונים אישיים והוראות שחוזרות על עצמן. השלימו את הצהרות התוכן ודרישות החשבון שמופיעות ב־Play Console. [גישה לסקירה](https://support.google.com/googleplay/android-developer/answer/15748846), [דרישות בדיקה לחשבונות אישיים חדשים](https://support.google.com/googleplay/android-developer/answer/14151465)

ה־APK מסוג `.backtest` שבונה `scripts/build-android-back-rc.mjs` משמש ל־DEV עם אמולטורים של Firebase. החבילה שמיועדת ל־Play תלויה בפרויקט Android ובחתימת ההעלאה של אפליקציית ההפצה.

## בנייה ואימות של חבילת ההפצה

בעותק ה־Capacitor המקורי, מזגו את `main` מ־GitHub לענף ההפצה. שמרו במיזוג את מתאמי ההתחברות, המצלמה, השיתוף וההתראות של המעטפת. ב־Android, השאירו את `AndroidBackNavigation` כמאזין החזרה היחיד והפעילו את מנגנון החזרה של תוסף `App` בתצורת Capacitor. בנו מעץ נקי אחרי המיזוג.

השתמשו בסביבת `native-personal` של פרויקט ה־Android ובמספר בנייה הגבוה מהמספר האחרון ב־Play Console ומה־APK שכבר הופץ. `npm run native:android -- personal` הוא מסלול הסנכרון והבנייה הקיים במעטפת המקורית. לאחר הסנכרון הפיקו AAB חתום של `personalRelease` דרך Android Studio, או דרך `./gradlew :app:bundlePersonalRelease` כשחתימת ההעלאה כבר מוגדרת ב־Gradle. טביעת תעודת ההעלאה עשויה להיות שונה מטביעת תעודת חתימת האפליקציה. [חתימת אפליקציות והבחנה בין המפתחות](https://developer.android.com/studio/publish/app-signing)

אמתו את ה־AAB החתום באמצעות JDK 21 ו־[bundletool](https://developer.android.com/tools/bundletool). הריצו מהשורש שבו הסקריפט נמצא. `PREVIOUS_VERSION_CODE` הוא מספר הבנייה הגבוה שכבר הופץ או נרשם ב־Play Console. `NATIVE_RELEASE_COMMIT` הוא הקומיט שממנו נבנה עותק ה־Android.

```bash
python3 scripts/verify-play-aab.py "$AAB" \
  --bundletool "$BUNDLETOOL_JAR" \
  --version 1.10.1 \
  --version-code-after "$PREVIOUS_VERSION_CODE" \
  --commit "$NATIVE_RELEASE_COMMIT" \
  --upload-cert-sha256 "$PLAY_UPLOAD_CERT_SHA256"
```

הפלט כולל את טביעת החבילה, תעודת החתימה, מזהה האפליקציה, ה־SDK, הקומיט ותוצאת בדיקת יישור ספריות ה־64 סיביות. אחרי האימות, בנו APK לבדיקה מה־AAB או השתמשו במסלול הבדיקה הפנימי של Play. בדקו שדרוג מההתקנה הקודמת, התחברות ל־Google, תדלוק, חזרה, סריקה עם ובלי שיתוף, ומחיקת חשבון בדיקה. [בדיקה מקומית של חבילה](https://developer.android.com/tools/bundletool#local-test)

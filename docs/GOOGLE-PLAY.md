# טנק מלא ב־Google Play

בדיקת ההכנה ב־16 בנובמבר 2026 מצאה שחבילת Android ‏1.10.0 המותקנת משתמשת ב־`com.meniviner.tankmalle`, מכוונת ל־API 36, ועוברת `zipalign -c -P 16 4`. מקטעי ELF מסוג `PT_LOAD` בספריות שלה מיושרים ל־16KB. יש לחזור על בדיקת החבילה ועל בדיקת התקנה עבור ה־AAB שמיועד להעלאה. [דרישת Target SDK](https://support.google.com/googleplay/android-developer/answer/11926878), [תמיכה ב־16KB](https://developer.android.com/guide/practices/page-sizes)

- לבנייה ל־Play יש לסנכרן את קוד הווב עם פרויקט Capacitor המקורי, להשתמש במזהה החבילה הרשום וב־`versionCode` גבוה מכל קוד שכבר הועלה. השתמשו במאזין החזרה של המאגר ובדקו שאין מאזין נוסף במעטפת. בנו AAB מסוג release, אמתו אותו עם `bundletool validate`, בדקו את המניפסט ואת הספריות בחבילה וחתמו במפתח ההעלאה של Play. בדקו התאמת חתימת ההפצה להתקנות הקיימות אם הגרסה מיועדת לעדכן אותן. [חתימה והעלאת חבילה](https://developer.android.com/studio/publish/app-signing)
- מסך פרטיות ציבורי נמצא ב־`https://tank-malle.web.app/legal/privacy`. למסך המחיקה הציבורי השתמשו ב־`https://tank-malle.web.app/legal/delete-account` בשדה Account deletion ב־Play Console. הקישור פותח את מסלול המחיקה בחשבון אחרי התחברות. [מדיניות פרטיות ומחיקה](https://support.google.com/googleplay/android-developer/answer/10144311)
- טופס Data safety צריך לשקף את גרסת ההפצה ואת ה־SDKs שבה. האפליקציה מסנכרנת דרך Firebase פרטי התחברות, רכבים, יומן תדלוק והוצאות, העדפות, משוב ונתוני התראות לפי שימוש. שיתוף דוגמאות סריקה דורש בחירה וכולל חיתוכים או תמונה מוקטנת, קריאות ונתוני החשבון. מיקום המכשיר משמש במכשיר למיון. תחנה שנבחרה יכולה להישמר ברשומת התדלוק. חיפוש לפי מספר רישוי שולח את המספר ל־data.gov.il. [הנחיות Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- אמתו במניפסט של ה־AAB שהרשאות גלריה רחבות או מיקום ברקע אינן כלולות. בדקו בחירת תמונה דרך הבורר של Android, בקשת מיקום רק לאחר פעולה מפורשת אם טרם ניתנה הרשאה, וקבלת החלטה נפרדת לפני שיתוף דוגמאות סריקה. [הרשאות מידע רגיש](https://support.google.com/googleplay/android-developer/answer/16558241)
- במסלול בדיקה פנימי ב־Play בדקו התקנה והתחברות ל־Google בחתימת ההפצה, תדלוק ומצלמה, חזרה, מחיקת חשבון והתראות. מלאו App access עם חשבון בדיקה שאינו מכיל נתונים אישיים והוראות שחוזרות על עצמן. השלימו את הצהרות התוכן ודרישות החשבון שמופיעות ב־Play Console. [גישה לסקירה](https://support.google.com/googleplay/android-developer/answer/15748846), [דרישות בדיקה לחשבונות אישיים חדשים](https://support.google.com/googleplay/android-developer/answer/14151465)

ה־APK מסוג `.backtest` שבונה `scripts/build-android-back-rc.mjs` משמש ל־DEV עם אמולטורים של Firebase. החבילה שמיועדת ל־Play תלויה בפרויקט Android ובחתימת ההעלאה של אפליקציית ההפצה.

## חשבון לסוקרי Google Play

גרסה 1.10.2 כוללת כניסת Firebase Authentication באימייל וסיסמה לחשבון קיים, בנוסף לכניסת Google. זו כניסה רגילה עם הרשאות המשתמש הקיימות; אין סיסמה שמוטמעת באפליקציה, טוקן עוקף או הרשאות מנהל לחשבון הסקירה. מחיקת חשבון סיסמה דורשת אימות מחדש באותה סיסמה לפני מחיקת הנתונים.

מפעילים Email/Password ב־Firebase Authentication ויוצרים שם משתמש בדיקה נפרד. מפתח Admin SDK וחשבון שירות אינם פרטי כניסה לאפליקציה. את פרטי המשתמש מוסרים רק בשדות הפרטיים של App access ב־Play Console, ללא נתונים אישיים. כתובת הסיסמה המקומית נשארת מחוץ ל־Git. יש לבדוק כניסה, פתיחה מחדש ומחיקה מקומית עם חשבון סיסמה לפני ההעלאה. פרטי Google וחתימות Play ממשיכים להיות נדרשים לכניסת Google.

הוראות לסוקר באנגלית: באפליקציה בוחרים `התחברות עם אימייל וסיסמה`, מסמנים הסכמה לתנאים ומזינים את הפרטים שנמסרו. חשבון הבדיקה הוא משתמש רגיל ויכול ליצור ולערוך רכב, תדלוק, טיפול או הוצאה. סריקה ומיקום הם רשות. אין חומת תשלום. מחיקת חשבון מתבצעת דרך `חשבון` → `מחיקת החשבון` ודורשת את סיסמת חשבון הבדיקה.

## בניית חבילת Android מהמאגר הזה

הענף הזה משלב את פרויקט Android המקורי עם תיקוני גרסה 1.10.1. על המק המשמש לחתימה דרושים Node 22 ומעלה, JDK 21, ‏Android SDK 36, הגדרות מקומיות לפרופיל `native-personal` ומפתח החתימה הקיים. ראו גם [הגדרות ההתקנה](native-install.md).

```sh
export TANK_MALLE_SIGNING_DIR=/path/to/local/signing-directory
export TANK_MALLE_BUILD_NUMBER=6
npm ci
npm run native:prepare -- personal android
(cd android && ./gradlew :app:verifyPlayBundle)
```

`6` הוא המספר שאחרי בנייה `5` של 1.10.2. אם כבר הועלתה בנייה למסלול ב־Play, בחרו מספר גבוה מכל המספרים שכבר שימשו שם. קובץ ההעלאה נוצר ב־`android/app/build/outputs/bundle/personalRelease/app-personal-release.aab`. מפתח החתימה, הסיסמה וההגדרות המקומיות נשארים על המק.

## אופטימיזציית release ותאימות Android 15

גרסה 1.10.3 מפעילה R8, ערפול, הסרת קוד ומשאבים שאינם בשימוש ואת קובץ הכללים `proguard-android-optimize.txt`, עם AGP 8.13.2. כללי השימור של תוספי Capacitor ממשיכים להגן על שיטות שנקראות דרך גשר JavaScript ועל callbacks. אין להוסיף `-dontobfuscate`, `-dontoptimize` או כללי שימור גורפים כדי להשתיק בעיית build.

המשימה `verifyPlayBundle` בונה את חבילת personal release ובודקת את התוצר: metadata של R8, התאמה בין SHA-256 של קובצי ה־DEX לבין ה־metadata, mapping מוטמע וציוני ערפול, אופטימיזציה והסרת קוד של 25% לפחות. היא מסרבת גם לחבילה ישנה שנבנתה ב־D8 לפני שההגדרות השתנו. אפשר לבדוק חבילה קיימת ללא בנייה באמצעות `./gradlew :app:verifyPlayBundle -PplayBundle=/absolute/path/to/file.aab`. ב־AGP הנוכחי הציון הוא `100 - no...Percentage` מתוך `r8.json`. [מדדי DEX](https://developer.android.com/google/play/vitals/code-optimization)

AndroidX Activity עודכנה ל־1.13.0 ו־Material ל־1.14.0; הספריות מטפלות ב־Android 15+ במסלולים המתאימים לגרסת המערכת. `SystemBars` של Capacitor מנהל את ה־insets, עם רמז התחלתי ל־`viewport-fit=cover`. אין להוסיף opt-out של edge-to-edge או קריאות לצביעת פסי המערכת ב־MainActivity. [הנחיות Android 15](https://developer.android.com/about/versions/15/behavior-changes-15), [SystemBars](https://capacitorjs.com/docs/apis/system-bars)

אזהרת Play על APIs שהוצאו משימוש אינה נסגרת רק על סמך שינוי ההגדרות. גם ספריות עדכניות מכילות קריאות תאימות לגרסאות Android ישנות. בנוסף, `ioncamera-android:1.0.2`, התלות הנוכחית של תוסף המצלמה, עדיין קוראת ל־`getStatusBarColor` ול־`getNavigationBarColor` במסך עריכת תמונה. האפליקציה משתמשת ב־`Camera.takePhoto`, ללא עריכת תמונה. יש להשוות את רשימת מקורות האזהרה לאחר עיבוד ה־AAB החדש ב־Play; אין להצהיר שההתראה נעלמה לפני הבדיקה הזאת.

בדיקת הגשר רצה מול APK ה־release הממוזער, ללא הפיכת חבילת personal ל־debuggable. היא בודקת App, Camera ו־LocalNotifications (הרשאות בלבד), SystemBars, Share (זמינות בלבד), כתיבה/קריאה/מחיקה של קובץ cache, גלישה אופקית וגבולות כפתורים מול פסי המערכת וה־cutout. מריצים על אמולטור ייעודי עם נתונים סינתטיים בלבד, במצב מחוות, שלושה כפתורים ובסיבוב מסך:

```sh
cd android
./gradlew :app:assemblePersonalRelease :app:assemblePersonalReleaseAndroidTest -PplayReleaseTest
adb -s emulator-5560 install -r app/build/outputs/apk/personal/release/app-personal-release.apk
adb -s emulator-5560 install -r app/build/outputs/apk/androidTest/personal/release/app-personal-release-androidTest.apk
adb -s emulator-5560 shell am instrument -w -r com.meniviner.tankmalle.test/com.meniviner.tankmalle.ReleaseSmokeInstrumentation
```

הצלחה מדווחת כ־`Release native bridge passed` עם `INSTRUMENTATION_CODE: -1`; כשל מחזיר `FAILED` וקוד `0`. הבדיקה אינה מכסה צילום פיזי, כניסת Google עם חתימת Play או קבלה סופית ב־Play Console.

ב־Windows אפשר לערוך את הקוד ולהריץ `npm ci` ו־`npm test`. לבדיקה על Samsung שמריץ התקנה ישירה חתומה של 1.10.0, משתמשים ב־APK החתום של אותה בנייה עם `adb install -r <path-to-apk>` ובודקים שהמידע נשמר ופעולת ״חזור״ תקינה. אם החתימה אינה תואמת, עוצרים ומשאירים את האפליקציה הקיימת מותקנת. ה־AAB משמש להעלאה ל־Play Console ולבדיקה במסלול בדיקות.

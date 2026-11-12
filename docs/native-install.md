# התקנה אישית של טנק מלא

## Android

העבירו את ה־APK החתום ל־Android ופתחו אותו במכשיר. אם Android מבקש אישור להתקנה ממקור זה, אשרו למנהל הקבצים שפתח את ה־APK. למכשיר מחובר עם USB debugging אפשר להשתמש גם ב־`adb install -r <apk>`.

עדכון מתקינים מעל האפליקציה הקיימת עם אותו מזהה חבילה ומפתח חתימה. את מפתח החתימה וקובץ הסיסמה מגבים יחד במקום פרטי. מחיקת האפליקציה או ניקוי האחסון במכשיר מוחקים שינויים מקומיים שטרם סונכרנו.

## iPhone

1. התקינו Xcode מלא בגרסה 26 ומעלה. פתחו אותו, הוסיפו את חשבון Apple תחת Settings › Accounts וחברו iPhone עם iOS 18 ומעלה. כאשר המכשיר מבקש זאת, אשרו את החיבור והפעילו Developer Mode.
2. בעותק המקור עם תלויות Node מותקנות, הריצו `npm run native:prepare -- personal ios`. לאחר מכן פתחו `ios/App/App.xcodeproj`.
3. תחת Signing & Capabilities בחרו את ה־Personal Team והפעילו Automatically manage signing. בחרו את ה־iPhone כיעד ולחצו Run.
4. החתימה החינמית תקפה שבעה ימים. לחידוש בחרו שוב באותו Team ובאותו מזהה חבילה `com.meniviner.tankmalle` והריצו על אותו iPhone. בצעו את החידוש מעל ההתקנה הקיימת כדי לשמור על האחסון שלה.

## בנייה חוזרת ובדיקת מעבר

- דרושים Node 22 ומעלה, JDK 21 ו־Android SDK 36. השתמשו ב־`npm ci`. הגדרות Firebase Web ו־Google OAuth נשמרות מקומית ב־`.env.native-personal.local` וב־`.env.native-qa.local`. קובצי Android החתומים משתמשים ב־SHA-1 של המפתח הרשום ב־Firebase. כתובת החזרה ל־Google ב־iPhone נוצרת מה־Client ID של iOS.
- בנו עם `TANK_MALLE_SIGNING_DIR=/absolute/path/to/signing TANK_MALLE_BUILD_NUMBER=2 npm run native:android -- personal`. עדכנו את מספר הבנייה במסירות הבאות. קובץ הבנייה נוצר ב־`android/app/build/outputs/apk/personal/release/`.
- עבור QA העבירו `qa` במקום `personal`. גרסת QA מזוהה כ־`com.meniviner.tankmalle.qa` ומחוברת לפרויקט Firebase נפרד. השתמשו בה עם נתוני בדיקה לבדיקות כניסה, כתיבה ומחיקת חשבון.
- לפני שימוש באפליקציה האישית, סנכרנו את כל השינויים שמופיעים ב־PWA תחת ״שינויים שעוד לא עלו לענן״. התחברו במובייל עם אותו חשבון Google ובדקו שהרכבים והרשומות מופיעים. ההתראות המקומיות מופעלות מתוך העדפות התראות במכשיר ומתעדכנות בפתיחה ובסנכרון.

[חשבון Apple והתקנה אישית](https://developer.apple.com/help/account/basics/about-your-developer-account) · [חתימת אפליקציית Android](https://developer.android.com/studio/publish/app-signing)

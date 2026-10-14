# نقل نظام الجودة (QA) إلى Swipr — خطة التنفيذ

> الحالة: الكود جاهز ومجرَّب محلياً على نسخ من بيانات الإنتاج. لم يُرفع شيء ولم يُلمس QA الشغال.
> كل خطوة تغيّر الإنتاج (Railway / GitHub / DNS) ينفذها صاحب النظام بنفسه.

## ما الذي تغيّر
- QA أصبح **موديول** داخل Swipr: الـ API تحت `/api/qa/*` والواجهة تحت `/qa/` (تطبيق Vite مستقل بتصميمه).
- الدخول بحساب Swipr. صلاحيات الجودة (الدور/الـ TL/البراندات) من شاشة **Quality Access** (للـ supervisor فقط).
- الحضور: `qa_attendance_records` أصبح View فوق بصمات Swipr؛ أزرار Check-in/out تكتب بصمات Swipr.
- جداول الجودة كلها بادئة `qa_` في نفس قاعدة Swipr. المستخدمون هم مستخدمو Swipr (ids نصية).

## قبل أي شيء (جاهزية)
1. أرقام الموظفين (`employeeId`) لـ 6 أشخاص باقين في الشركة وليس لهم حساب في Swipr: Aya، sami chaar، Carlos Naeem، Ahmed Shaheen، Hesham Sayed، Ahmed Hussain (TL) (تُضاف من شاشة Swipr بعد الاستيراد). و10 أشخاص تركوا الشركة معلَّمون `former` في `tools/user-overrides.json`: لا حساب لهم في Swipr، لكن أسماؤهم وتاريخهم يبقون في الجودة (جدول `qa_former_staff`).
2. تأكيد قواعد الصلاحيات في `qa/index.ts` (مصفوفة `RULES`) — كُتبت من قوائم الواجهة.
3. الأسماء الأربعة المختلفة بين النظامين: **تقرر اعتماد اسم Swipr** (Mamdouh Nagy Mohamed، Mostafa Mahmoud Abdelgawad، Essam El Din Barakat، Ahmed Hussein ibrahem). يُصلَّح في Swipr حرف الـ Tab داخل اسم Ahmed Hussein ibrahem من شاشة تعديل المستخدم. لا شيء يتغيّر في الكود.
4. تدوير الـ tokens وكلمة سر القاعدة التي اتشاركت في المحادثات.

## الخطوات (بالترتيب)
### 1) نشر Swipr (بدون توقف QA)
- دمج فرع `qa-merge` في `main` (PR). الـ build على Railway يشغّل: `vite build && build:qa && build:qa-ui`.
- متغيرات جديدة على Railway (Swipr):
  - `QA_XONTEL_BASE_URL`, `QA_XONTEL_USERNAME`, `QA_XONTEL_PASSWORD` (حساب M-Nagi). **لا تضعها قبل خطوة 4** — XonTel يسمح بجلسة واحدة للحساب.
  - `CLOUDINARY_*` مشتركة مع Swipr (لو غير مضبوطة تُخزَّن الصور في Postgres بحد 1MB للصورة).
  - `QA_MODULE=off` يعطّل الموديول إن لزم.
- عند أول إقلاع ينشئ Swipr جداول `qa_*` فارغة (من `qa/schema.sql`).

### 2) استيراد تجريبي (بدون كتابة)
من مجلد `qa/tools` على جهازك (يتصل بالقاعدتين عبر TCP proxy):
```
set QA_DATABASE_URL=<QA Postgres>
set SWIPR_DATABASE_URL=<Swipr Postgres>
node import-qa.cjs --source-url-env QA_DATABASE_URL --target-url-env SWIPR_DATABASE_URL --schema ../schema.sql --dry-run
```
القراءة من QA `READ ONLY` دائماً. راجع التقرير: المطابقة (35 موجودين + 16 جدد + 3 متخطَّون)، الأسماء، الأخطاء.

### 3) استيراد فعلي + تكراره
نفس الأمر بدون `--dry-run`. آمن للتكرار (يعكس حالة QA الحالية) وينتهي بالتحقق: "IMPORT VERIFIED". كرره يومياً حتى يوم النقل.
- يوم النقل لا تُنسخ إعدادات XonTel (ولا تُنسخ أصلاً).

### 4) يوم النقل (نافذة قصيرة)
1. أوقف QA القديم (أو اجعله للقراءة فقط) — **يحرر جلسة XonTel**.
2. استيراد أخير: `node import-qa.cjs ... ` ثم **من الآن** استخدم `--keep-profiles` في أي استيراد لاحق (حتى لا يكتب فوق تعديلات شاشة Quality Access).
3. أضف متغيرات `QA_XONTEL_*` على Railway لـ Swipr وأعد التشغيل؛ تحقق من `/api/qa/xontel/status`.
4. وجّه المستخدمين إلى `https://<swipr>/qa/` (زر Quality في قائمة Swipr). ضع رابطاً/تحويلاً من دومين QA القديم.
5. اختبار دخان: دخول بحساب كل دور (supervisor / cc_supervisor / qa / tl / agent) + إنشاء تقييم + تصعيد + تشغيل تسجيل مكالمة.

### 5) بعد النقل
- QA القديم يبقى للقراءة فقط ~30 يوماً (للمرجعية والتراجع).
- مسح نسخ قواعد الإنتاج المحلية (`qa-swipr-staging`) وأي credentials تُركت محلياً.
- نسخة SQL Server من Swipr (إن وُجدت) تحتاج نقل هذا الموديول لاحقاً.

## التراجع
قبل خطوة 4: لا شيء يتأثر (QA يعمل). بعدها: أعد تشغيل QA القديم، أزل `QA_XONTEL_*` من Swipr، ووجّه الرابط للنظام القديم. بيانات QA الأصلية لم تُعدَّل أبداً.

## ملاحظات أمنية
- API نظام QA الحالي **بلا مصادقة** (`/api/users` مفتوح). الموديول داخل Swipr يتطلب توكن Swipr ويفرض الدور من البروفايل.
- أي طلب مرفوض/فاشل داخل الموديول يرجع 500 فقط ولا يوقف Swipr.

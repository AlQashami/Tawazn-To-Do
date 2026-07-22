# بوصلة

لوحة قرارات وأولويات لفريق مكوّن من شخصين (أسيل ومنذر)، بدل ما تعتمد المتابعة على الذاكرة أو الرسائل. مزامنة لحظية عبر Firebase، محمية بكلمة سر مشتركة.

## الأقسام

1. **أولويات الأسبوع** — 3 فقط، تُختار بتعليم ⭐ على مشروع من القائمة النشطة.
2. **المشاريع النشطة** — كل مشروع له مسؤول واحد، خطوة تالية واحدة، وموعد (ولو تقديري).
3. **بانتظار قرار منذر** — بنود تحتاج قرارًا لا تنفيذًا، تُراجع في الاجتماع وتُحسم بزر "✓ تم البت".
4. **بنك الأفكار** — أي فكرة تُسجَّل فورًا وتُصنَّف لاحقًا (هذا الأسبوع/هذا الربع/مستقبلية) بدل ما تتحول لمشروع مباشرة.
5. **الإنجازات** — أرشيف المشاريع المغلقة، مع عداد بسيط لعدد ما أُنجز هذا الشهر.

## الإعداد لأول مرة

يستخدم هذا المشروع نفس مشروع Firebase الذي كان يخدم تطبيق "توازن" سابقًا (بنفس بوابة كلمة السر)، فلا حاجة لأي إعداد جديد في Firebase Console سوى نشر [firestore.rules](firestore.rules) المحدّثة:

**Firestore Database → Rules**، الصقي محتوى [firestore.rules](firestore.rules) كاملاً واضغطي **Publish**.

إذا احتجتِ إعداد مشروع Firebase من الصفر لاحقًا:

1. [console.firebase.google.com](https://console.firebase.google.com) → **Firestore Database → Create database** (Production mode).
2. **Firestore Database → Rules**، الصقي محتوى [firestore.rules](firestore.rules) واضغطي **Publish**.
3. **Authentication → Sign-in method**، فعّلي Email/Password، ثم من تبويب **Users** أضيفي مستخدمًا بالإيميل الموجود في `AUTH_EMAIL` داخل [js/app.js](js/app.js) وكلمة السر المشتركة.
4. **Project settings → General → Your apps**، انسخي `firebaseConfig` إلى [js/config.js](js/config.js).

## التشغيل محليًا

صفحات HTML/CSS/JS عادية بدون أي خطوة بناء (build):

```
python3 -m http.server 8080
```

ثم افتحي `http://localhost:8080` في المتصفح.

> ملاحظة: فتح `index.html` مباشرة من الملف (بدون خادم) قد لا يعمل بسبب قيود المتصفح على وحدات JavaScript (ES modules).

## النشر

نفس رابط GitHub Pages الحالي لهذا المستودع — يكفي رفع التغييرات (commit + push) على الفرع `main`.

## الخط

يستخدم التطبيق خط **ثمانية** (ThmanyahSans) حصريًا. ملفات الخط مضمّنة في [assets/fonts](assets/fonts).

## بنية البيانات (Firestore)

- **projects**: `title, owner, next_action, due_date, status ("نشط"|"منجز"), is_priority, done_at, sort_order, created_at, last_edited_by, last_edited_at`
- **decisions**: `title, created_by, created_at`
- **ideas**: `title, stage, created_by, created_at`

لا حاجة لإنشاء المجموعات (collections) يدويًا — تُنشأ تلقائيًا عند إضافة أول عنصر.

> بيانات تطبيق "توازن" القديمة (مجموعات `tasks`, `task_links`, `task_comments`) لم تُحذف تلقائيًا من Firestore. احذفيها يدويًا من Firebase Console → Firestore Database إذا ما احتجتِها بعد الآن.

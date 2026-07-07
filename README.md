# توازن

تطبيق ويب بسيط لمتابعة المهام، مخصص لشخصين (أسيل ومنذر). بدون تسجيل دخول، مزامنة لحظية عبر Firebase.

## الإعداد لأول مرة

### 1) إنشاء مشروع Firebase

1. اذهبي إلى [console.firebase.google.com](https://console.firebase.google.com) وأنشئي مشروعًا جديدًا.
2. من القائمة الجانبية: **Build → Firestore Database → Create database**، واختاري وضع الإنتاج (Production mode) وأقرب موقع لكم.
3. من **Firestore Database → Rules**، الصقي محتوى ملف [firestore.rules](firestore.rules) كاملاً ثم اضغطي **Publish**.
4. من **Project settings (⚙️) → General**، انزلي إلى **Your apps**، اضغطي أيقونة الويب `</>` لإنشاء تطبيق ويب جديد، وانسخي كائن `firebaseConfig` الذي يظهر لك.

### 2) ربط المشروع

افتحي ملف [js/config.js](js/config.js) وضعي فيه القيم التي نسختِها من Firebase بدل النصوص `YOUR_FIREBASE_...`.

### 3) التشغيل محليًا

التطبيق صفحات HTML/CSS/JS عادية بدون أي خطوة بناء (build). يكفي تشغيل خادم محلي بسيط من داخل مجلد المشروع، مثلاً:

```
python3 -m http.server 8080
```

ثم افتحي `http://localhost:8080` في المتصفح.

> ملاحظة: فتح `index.html` مباشرة من الملف (بدون خادم) قد لا يعمل بسبب قيود المتصفح على وحدات JavaScript (ES modules).

## النشر على GitHub Pages

1. ارفعي المجلد كمستودع على GitHub.
2. من إعدادات المستودع: **Settings → Pages → Build and deployment → Source: Deploy from a branch**، واختاري الفرع `main` والمجلد `/ (root)`.
3. بعد دقيقة أو دقيقتين سيصبح الموقع متاحًا على الرابط الذي يظهر في نفس الصفحة.

## الخط

يستخدم التطبيق خط **ثمانية** (ThmanyahSans) حصريًا. ملفات الخط مضمّنة في [assets/fonts](assets/fonts).

## بنية البيانات (Firestore)

- **tasks**: `title, assignee, due_date, status, notes, parent_id, sort_order, last_edited_by, last_edited_at`
- **task_links**: `source_task_id, target_task_id`

لا حاجة لإنشاء المجموعات (collections) يدويًا — تُنشأ تلقائيًا عند إضافة أول مهمة.

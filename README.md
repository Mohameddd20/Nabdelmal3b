# ⚽ نبض الملاعب AI | موقع أخبار رياضي أوتوماتيكي متكامل

منصة أخبار رياضية أوتوماتيكية متكاملة تقوم بسحب أحدث الأخبار الرياضية من موقع **يلا شوت**، وإرسال محتواها إلى **Google Gemini API (`gemini-2.5-flash`)** لإعادة صياغتها بأسلوب صحفي احترافي، حصري، ومتوافق مع معايير السيو (SEO) مع توليد:
- **عنوان جذاب وحصري**
- **ملخص ذكي (AI Summary)**
- **مقال متكامل مقسم بعناوين فرعية**
- **تصنيف رياضي + وسوم (Tags)**
- **دعم المشاركة الفورية على منصات التواصل الاجتماعي** (واتساب، إكس/تويتر، فيسبوك، تيليجرام، ونسخ الرابط)

---

## 📁 هيكل المشروع

- `scraper.py`: محرك سحب الأخبار الرياضية (`YallaShootScraper`) باستخدام `requests` و `BeautifulSoup4`.
- `ai_rewriter.py`: محرك إعادة الصياغة الذكي (`GeminiNewsRewriter`) باستخدام `google-genai` مع مخرجات JSON منظمة (`RewrittenArticleSchema`).
- `database.py`: قاعدة بيانات `SQLite` لحفظ المقالات ومنع تكرار سحب نفس الخبر.
- `main.py`: خادم `FastAPI` + مجدول المهام الأوتوماتيكي `APScheduler` الذي يعمل في الخلفية لسحب الأخبار دورياً.
- `frontend/index.html`: واجهة المستخدم الرياضية العصرية بتصميم **Dark Mode** باستخدام **Tailwind CSS** وخط **Cairo**.

---

## 🚀 خطوات التشغيل السريع

### 1. تثبيت المكتبات المطلوبة
```bash
cd C:\Users\hp\.gemini\antigravity\scratch\sports-news-portal
pip install -r requirements.txt
```

### 2. إعداد مفتاح Google Gemini API
قم بنسخ ملف `.env.example` إلى `.env` وأضف مفتاحك الخاص من [Google AI Studio](https://aistudio.google.com/):
```bash
copy .env.example .env
```
ثم عدّل القيمة داخل `.env`:
```env
GEMINI_API_KEY=AIzaSyYourActualKeyHere
SOURCE_URL=https://www.yallashoot.com/news
SCRAPE_INTERVAL_MINUTES=30
```

### 3. تشغيل الخادم والمجدول الأوتوماتيكي
```bash
uvicorn main:app --reload --port 8000
```
ثم افتح المتصفح على الرابط:
👉 `http://localhost:8000`

> **ملاحظة:** يمكنك أيضاً فتح ملف `frontend/index.html` مباشرة في المتصفح لمعاينة التصميم والمنصة فوراً، وتجربة **"استوديو Gemini"** المدمج في أعلى الصفحة لإعادة صياغة أي خبر باستخدام مفتاح Gemini API الخاص بك مباشرة.

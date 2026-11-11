import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

DB_PATH = Path(__file__).parent / "sports_news.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """إنشاء جدول الأخبار الرياضية وتجهيز بيانات أولية في حال كانت القاعدة فارغة."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            original_title TEXT,
            original_url TEXT UNIQUE,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT NOT NULL,
            tags TEXT NOT NULL,
            image_url TEXT,
            source_name TEXT DEFAULT 'يلا شوت',
            views INTEGER DEFAULT 0,
            is_breaking INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()

    # التحقق مما إذا كانت قاعدة البيانات فارغة لإضافة أخبار نموذجية أولية للمعاينة الفورية
    cursor.execute("SELECT COUNT(*) as count FROM articles")
    count = cursor.fetchone()["count"]
    conn.close()

    if count == 0:
        seed_initial_articles()


def article_exists(original_url: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM articles WHERE original_url = ?", (original_url,))
    exists = cursor.fetchone() is not None
    conn.close()
    return exists


def save_article(article_data: Dict[str, Any]) -> Optional[int]:
    """حفظ خبر معاد صياغته في قاعدة البيانات."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        tags_json = json.dumps(article_data.get("tags", []), ensure_ascii=False)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        slug = f"news-{int(datetime.now().timestamp())}-{abs(hash(article_data['title'])) % 10000}"

        cursor.execute("""
            INSERT INTO articles (
                slug, original_title, original_url, title, summary,
                content, category, tags, image_url, source_name,
                views, is_breaking, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            slug,
            article_data.get("original_title", ""),
            article_data.get("original_url", slug),
            article_data["title"],
            article_data["summary"],
            article_data["content"],
            article_data.get("category", "كرة قدم عالمية"),
            tags_json,
            article_data.get("image_url", "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80"),
            article_data.get("source_name", "يلا شوت - صياغة ذكية"),
            article_data.get("views", 1),
            1 if article_data.get("is_breaking", False) else 0,
            article_data.get("created_at", now)
        ))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def get_articles(category: Optional[str] = None, search: Optional[str] = None, limit: int = 30) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()

    query = "SELECT * FROM articles WHERE 1=1"
    params: List[Any] = []

    if category and category != "الكل":
        query += " AND category = ?"
        params.append(category)

    if search:
        query += " AND (title LIKE ? OR summary LIKE ? OR content LIKE ? OR tags LIKE ?)"
        q = f"%{search}%"
        params.extend([q, q, q, q])

    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    return [_row_to_dict(row) for row in rows]


def get_article_by_id(article_id: int, increment_views: bool = True) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()

    if increment_views:
        cursor.execute("UPDATE articles SET views = views + 1 WHERE id = ?", (article_id,))
        conn.commit()

    cursor.execute("SELECT * FROM articles WHERE id = ?", (article_id,))
    row = cursor.fetchone()
    conn.close()

    return _row_to_dict(row) if row else None


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    item = dict(row)
    try:
        item["tags"] = json.loads(item["tags"]) if item.get("tags") else []
    except Exception:
        item["tags"] = []
    item["is_breaking"] = bool(item.get("is_breaking", 0))
    return item


def seed_initial_articles() -> None:
    """إضافة مقالات رياضية افتراضية مصاغة بأسلوب Gemini لمعاينة الموقع مباشرة."""
    sample_articles = [
        {
            "original_title": "ريال مدريد يحسم الكلاسيكو الأوروبي بثنائية مثيرة في الدقائق الأخيرة",
            "original_url": "https://yallashoot.example.com/news/real-madrid-ucl-win",
            "title": "ليلة ملكية في البرنابيو: ريال مدريد يقلب الطاولة ويحسم القمة الأوروبية بثنائية قاتلة",
            "summary": "في سيناريو درامي جديد يعكس شخصية البطل، نجح نادي ريال مدريد في خطف فوز ثمين بالدقائق الأخيرة بفضل تألق خط وسطه وتغييرات تكتيكية حاسمة.",
            "content": """شهد ملعب سانتياغو برنابيو ليلة كروية استثنائية جديدة، حيث تمكن ريال مدريد من حسم المواجهة الأوروبية الكبرى بثنائية مثيرة في الأنفاس الأخيرة من عمر اللقاء، ليؤكد مجدداً هيمنته القارية وقدرته الفريدة على العودة في أصعب اللحظات.

### شوط أول تكتيكي وحذر دفاعي
بدأت المباراة بإيقاع سريع وضغط عالٍ من كلا الفريقين، مع تمركز دفاعي محكم حال دون وصول المهاجمين إلى الشباك خلال الدقائق الخمس والأربعين الأولى. واعتمد الجهاز الفني للنادي الملكي على التحولات السريعة عبر الأطراف، مما أرهق دفاعات الخصم ومهّد الطريق للسيطرة في الشوط الثاني.

### تغييرات حاسمة وثنائية في الوقت القاتل
ومع دخول الثلث الأخير من المباراة، أحدثت التبديلات الهجومية فارقاً واضحاً في سرعة نقل الكرة داخل منطقة الجزاء. وفي الدقيقة 84، افتتح التسجيل بتسديدة صاروخية سكنت الزاوية العليا، قبل أن يعزز الفريق تقدمه بالهدف الثاني في الدقيقة 91 وسط فرحة هستيرية في المدرجات.

بهذا الانتصار الثمين، يضع ريال مدريد قدماً ثابتة في الدور المقبل، موجهاً رسالة شديدة اللهجة لجميع منافسيه على اللقب القاري هذا الموسم.""",
            "category": "دوري أبطال أوروبا",
            "tags": ["ريال مدريد", "دوري أبطال أوروبا", "سانتياغو برنابيو", "كرة قدم عالمية"],
            "image_url": "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=80",
            "views": 1420,
            "is_breaking": True
        },
        {
            "original_title": "محمد صلاح يواصل تحطيم الأرقام القياسية في الدوري الإنجليزي الممتاز",
            "original_url": "https://yallashoot.example.com/news/salah-epl-record",
            "title": "الملك المصري لا يتوقف: محمد صلاح ينفرد برقم تاريخي جديد في البريميرليج",
            "summary": "واصل النجم المصري محمد صلاح كتابة التاريخ في الملاعب الإنجليزية بعدما ساهم في فوز ليفربول الأخير، متجاوزاً أساطير الدوري الإنجليزي في قائمة الأكثر مساهمة بالأهداف.",
            "content": """يواصل النجم المصري محمد صلاح، جناح نادي ليفربول، ترسيخ مكانته كأحد أعظم اللاعبين في تاريخ الدوري الإنجليزي الممتاز، بعد تسجيله هدفاً وصناعته لآخر في الجولة الأخيرة من المسابقة على ملعب أنفيلد.

### أرقام قياسية غير مسبوقة
وبفضل هذه المساهمة المزدوجة، انفرد صلاح برقم قياسي جديد كأكثر لاعب مساهمة بالأهداف (تسجيلاً وصناعة) ضد أندية الستة الكبار في المواسم السبعة الأخيرة، متفوقاً على نخبة من أبرز أساطير البريميرليج.

### إشادة واسعة من الجهاز الفني والصحافة
وأشادت الصحف البريطانية الصادرة صباح اليوم بالمستوى البدني والفني المذهل الذي يقدمه قائد المنتخب المصري، مؤكدة أن قدرته على الحسم في المباريات الكبرى تجعله الركيزة الأساسية في مشروع ليفربول للمنافسة على كافة الألقاب المحلية والقارية.""",
            "category": "الدوري الإنجليزي",
            "tags": ["محمد صلاح", "ليفربول", "الدوري الإنجليزي", "البريميرليج", "المحترفين"],
            "image_url": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80",
            "views": 985,
            "is_breaking": True
        },
        {
            "original_title": "قمة نارية مرتقبة في دوري روشن السعودي بين الهلال والنصر",
            "original_url": "https://yallashoot.example.com/news/saudi-derby-preview",
            "title": "ديربي الرياض يشتعل مبكراً: استعدادات قصوى لقمة الهلال والنصر في دوري روشن",
            "summary": "تتجه أنظار عشاق الكرة العربية والعالمية نحو العاصمة الرياض لمتابعة الكلاسيكو المرتقب وسط جاهزية تامة لأبرز النجوم العالميين في صفوف الفريقين.",
            "content": """تعيش جماهير كرة القدم العربية حالة من الترقب والحماس مع اقتراب موعد ديربي الرياض الكبير، الذي يجمع بين الهلال والنصر ضمن منافسات الجولة القادمة من دوري روشن السعودي للمحترفين.

### كتيبة مدججة بالنجوم العالميين
يدخل الفريقان اللقاء بصفوف مكتملة بعد تعافي المصابين وعودة الدوليين، حيث يسعى المتصدر لتوسيع الفارق في صدارة الترتيب، بينما يطمح غريمه التقليدي لاقتناص النقاط الثلاث وإشعال المنافسة على اللقب من جديد.

### تغطية عالمية وحضور جماهيري كامل العدد
ومن المتوقع أن تشهد المباراة حضوراً جماهيرياً كامل العدد بعد نفاد التذاكر في ساعاتها الأولى، فضلاً عن نقل تلفزيوني لأكثر من 140 دولة حول العالم، في ظل الزخم الكبير الذي باتت تحظى به المنافسات السعودية.""",
            "category": "الكرة العربية",
            "tags": ["دوري روشن", "الهلال", "النصر", "ديربي الرياض", "الكرة السعودية"],
            "image_url": "https://images.unsplash.com/photo-1518604666860-9ed391f76460?auto=format&fit=crop&w=1200&q=80",
            "views": 760,
            "is_breaking": False
        },
        {
            "original_title": "الأهلي يختتم تدريباته استعداداً لمواجهة الحسم في دوري أبطال أفريقيا",
            "original_url": "https://yallashoot.example.com/news/alahly-caf-training",
            "title": "تركيز شديد في التتش: الأهلي يضع اللمسات الأخيرة قبل موقعة الحسم الأفريقية",
            "summary": "أنهى الفريق الأول لكرة القدم بالنادي الأهلي تحضيراته الفنية والبدنية وسط روح معنوية عالية، مع استقرار الجهاز الفني على التشكيل الأساسي للمباراة.",
            "content": """اختتم الفريق الأول لكرة القدم بالنادي الأهلي تدريباته الجماعية مساء اليوم، استعداداً لخوض المواجهة المرتقبة في بطولة دوري أبطال أفريقيا، والتي يسعى من خلالها الفريق لمواصلة رحلة الدفاع عن لقبه القاري.

### محاضرة فنية بالفيديو
وعقد المدير الفني محاضرة فنية مطولة مع اللاعبين قبل انطلاق المران، استعرض خلالها نقاط القوة والضعف في صفوف المنافس، مشدداً على ضرورة استغلال أنصاف الفرص والالتزام بالانضباط التكتيكي طوال الـ 90 دقيقة.

وشهد المران مشاركة جميع العناصر الأساسية، وتألقاً لافتاً لحراس المرمى وخط الهجوم في تقسيمة الكرة، مما يمنح الجهاز الفني خيارات متعددة لحسم اللقاء مبكراً.""",
            "category": "بطولات أفريقيا",
            "tags": ["الأهلي", "دوري أبطال أفريقيا", "الكرة المصرية", "كاف"],
            "image_url": "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?auto=format&fit=crop&w=1200&q=80",
            "views": 640,
            "is_breaking": False
        }
    ]

    for item in sample_articles:
        save_article(item)

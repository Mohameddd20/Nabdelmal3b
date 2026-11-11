import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv

import database
from scraper import YallaShootScraper
from ai_rewriter import GeminiNewsRewriter

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sports-portal")

FRONTEND_DIR = Path(__file__).parent / "frontend"
scheduler = BackgroundScheduler()


def run_automated_pipeline(max_articles: int = 3, custom_api_key: Optional[str] = None) -> dict:
    """
    المهمة الأوتوماتيكية الكاملة:
    1. سحب أحدث الأخبار من يلا شوت.
    2. استبعاد الأخبار المسحوبة مسبقاً.
    3. إرسال المحتوى إلى Google Gemini API لإعادة الصياغة وتوليد العنوان والملخص والـ Tags.
    4. حفظ المقالات الحصرية في قاعدة البيانات.
    """
    scraper = YallaShootScraper()
    rewriter = GeminiNewsRewriter(api_key=custom_api_key)

    raw_articles = scraper.fetch_latest_news(max_articles=max_articles)
    saved_count = 0
    processed_titles = []

    for raw in raw_articles:
        if database.article_exists(raw["original_url"]):
            continue

        rewritten = rewriter.rewrite_article(raw)
        article_id = database.save_article(rewritten)
        if article_id:
            saved_count += 1
            processed_titles.append(rewritten["title"])

    logger.info(f"اكتملت دورة السحب الأوتوماتيكي: تم إضافة {saved_count} أخبار جديدة.")
    return {
        "status": "success",
        "scraped_candidates": len(raw_articles),
        "new_articles_saved": saved_count,
        "titles": processed_titles,
        "gemini_configured": bool(rewriter.client is not None)
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # تهيئة قاعدة البيانات عند بدء التشغيل
    database.init_db()

    # تشغيل المجدول الدوري لسحب الأخبار أوتوماتيكياً
    interval_minutes = int(os.getenv("SCRAPE_INTERVAL_MINUTES", "30"))
    scheduler.add_job(run_automated_pipeline, "interval", minutes=interval_minutes, id="yallashoot_scraper_job", replace_existing=True)
    scheduler.start()
    logger.info(f"تم تفعيل السحب الأوتوماتيكي للأخبار كل {interval_minutes} دقيقة.")
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="نبض الملاعب | منصة الأخبار الرياضية الذكية",
    description="منصة أخبار رياضية أوتوماتيكية مدعومة بـ Python و Google Gemini API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ManualScrapeRequest(BaseModel):
    max_articles: int = 2
    gemini_api_key: Optional[str] = None


class CustomRewriteRequest(BaseModel):
    original_title: str
    raw_content: str
    image_url: Optional[str] = None
    gemini_api_key: Optional[str] = None


@app.get("/api/articles")
def list_articles(
    category: Optional[str] = Query(default=None, description="فلترة حسب التصنيف"),
    search: Optional[str] = Query(default=None, description="بحث في العناوين والمحتوى والوسوم"),
    limit: int = Query(default=30, ge=1, le=100)
):
    articles = database.get_articles(category=category, search=search, limit=limit)
    return {
        "count": len(articles),
        "articles": articles
    }


@app.get("/api/articles/{article_id}")
def get_single_article(article_id: int):
    article = database.get_article_by_id(article_id, increment_views=True)
    if not article:
        raise HTTPException(status_code=404, detail="الخبر غير موجود")
    return article


@app.post("/api/scrape-now")
def trigger_scrape_now(payload: ManualScrapeRequest):
    """تشغيل السكربت فوراً لسحب أحدث الأخبار من يلا شوت وإعادة صياغتها عبر Gemini."""
    result = run_automated_pipeline(
        max_articles=payload.max_articles,
        custom_api_key=payload.gemini_api_key
    )
    return result


@app.post("/api/rewrite-custom")
def rewrite_custom_news(payload: CustomRewriteRequest):
    """اختبار إعادة صياغة أي خبر رياضي خام مباشرة عبر Gemini API وحفظه."""
    rewriter = GeminiNewsRewriter(api_key=payload.gemini_api_key)
    raw_item = {
        "original_title": payload.original_title,
        "original_url": f"https://custom.yallashoot.local/{ abs(hash(payload.original_title)) }",
        "raw_content": payload.raw_content,
        "image_url": payload.image_url or "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80",
        "source_name": "يلا شوت - صياغة فورية"
    }
    rewritten = rewriter.rewrite_article(raw_item)
    article_id = database.save_article(rewritten)
    article = database.get_article_by_id(article_id, increment_views=False) if article_id else rewritten
    return {
        "status": "success",
        "article": article,
        "gemini_used": bool(rewriter.client is not None)
    }


@app.get("/api/status")
def system_status():
    api_key = os.getenv("GEMINI_API_KEY", "")
    return {
        "status": "online",
        "gemini_configured": bool(api_key and api_key != "your_gemini_api_key_here"),
        "scrape_interval_minutes": int(os.getenv("SCRAPE_INTERVAL_MINUTES", "30")),
        "source": os.getenv("SOURCE_URL", "https://www.yallashoot.com/news")
    }


# تقديم ملفات الواجهة الأمامية
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse(FRONTEND_DIR / "index.html")

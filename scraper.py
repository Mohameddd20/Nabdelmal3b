import logging
import os
import re
from urllib.parse import urljoin
from typing import List, Dict, Optional
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

YSSCORES_NEWS_URL = os.getenv("SOURCE_URL", "https://www.ysscores.com/ar/news")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
}


class YallaShootScraper:
    """
    محرك سحب الأخبار الرياضية الفعلي من موقع يلا شوت الرسمي (https://www.ysscores.com/ar/news):
    - يستخرج أحدث روابط الأخبار من صفحة الأخبار.
    - يدخل إلى كل خبر لاستخراج:
      1. العنوان الكامل (h1.news-page__title)
      2. الصورة الأصلية عالية الدقة (og:image من imgs.ysscores.com/news/1200/...)
      3. فقرات الخبر الكاملة (div.news-content.news-page__article)
      4. البطولة والأندية واللاعبين المرتبطين بالخبر (span.news-sections__name)
    """

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or YSSCORES_NEWS_URL
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def fetch_latest_news(self, max_articles: int = 5) -> List[Dict[str, any]]:
        """سحب أحدث الأخبار الفعلية من موقع ysscores.com/ar/news."""
        try:
            logger.info(f"جاري سحب أحدث الأخبار من: {self.base_url}")
            response = self.session.get(self.base_url, timeout=15)
            response.raise_for_status()
            response.encoding = "utf-8"

            soup = BeautifulSoup(response.text, "html.parser")
            article_urls = self._extract_ysscores_links(soup)

            articles: List[Dict[str, any]] = []
            for url in article_urls:
                if len(articles) >= max_articles:
                    break
                detail = self.fetch_article_content(url)
                if detail and len(detail.get("raw_content", "")) > 50:
                    articles.append(detail)

            return articles
        except Exception as exc:
            logger.error(f"خطأ أثناء سحب الأخبار من ysscores.com: {exc}")
            return []

    def _extract_ysscores_links(self, soup: BeautifulSoup) -> List[str]:
        """استخراج روابط الأخبار التي تطابق /ar/news/{id}/{slug}."""
        urls: List[str] = []
        seen = set()
        pattern = re.compile(r"/ar/news/\d+/")

        for a_tag in soup.find_all("a", href=True):
            href = urljoin("https://www.ysscores.com", a_tag["href"])
            if pattern.search(href) and href not in seen:
                seen.add(href)
                urls.append(href)

        return urls

    def fetch_article_content(self, article_url: str) -> Optional[Dict[str, any]]:
        """الدخول لصفحة الخبر على ysscores.com واستخراج المحتوى الكامل والصورة والوسوم."""
        try:
            resp = self.session.get(article_url, timeout=12)
            if resp.status_code != 200:
                return None
            resp.encoding = "utf-8"
            soup = BeautifulSoup(resp.text, "html.parser")

            # 1. استخراج العنوان
            h1 = soup.select_one("h1.news-page__title, h1")
            title = h1.get_text(" ", strip=True) if h1 else ""
            if not title:
                return None

            # 2. استخراج الصورة الأصلية عالية الدقة (1200px)
            og_image = soup.find("meta", property="og:image")
            image_url = og_image.get("content") if og_image and og_image.get("content") else ""

            # 3. استخراج فقرات المقال من حاوية الخبر في ysscores
            content_div = soup.select_one("div.news-content.news-page__article, div.news-content")
            paragraphs: List[str] = []
            if content_div:
                for p in content_div.find_all("p"):
                    txt = p.get_text(" ", strip=True)
                    if len(txt) > 15:
                        paragraphs.append(txt)

            raw_content = "\n\n".join(paragraphs)
            if not raw_content:
                return None

            # 4. استخراج البطولة والنادي واللاعبين من قسم news-sections
            tags: List[str] = []
            category = "كرة قدم عالمية"
            for group in soup.select(".news-sections__group"):
                label_el = group.select_one(".news-sections__label")
                label = label_el.get_text(strip=True) if label_el else ""
                names = [n.get_text(strip=True) for n in group.select(".news-sections__name") if n.get_text(strip=True)]
                if label == "البطولة" and names:
                    category = names[0]
                for name in names:
                    if name not in tags:
                        tags.append(name)

            return {
                "original_title": title,
                "original_url": article_url,
                "raw_content": raw_content,
                "image_url": image_url,
                "category": category,
                "tags": tags or ["يلا شوت", "أخبار الرياضة"],
                "source_name": "يلا شوت (YSScores)"
            }
        except Exception as exc:
            logger.warning(f"فشل سحب تفاصيل الخبر {article_url}: {exc}")
            return None

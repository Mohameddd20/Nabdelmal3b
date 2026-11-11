import json
import logging
import os
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


class RewrittenArticleSchema(BaseModel):
    title: str = Field(description="عنوان صحفي رياضي احترافي، جذاب، حصري، وموافق لمعايير السيو SEO")
    summary: str = Field(description="ملخص تشويقي للخبر في جملتين أو ثلاث جمل يوضح أهم معلومة")
    content: str = Field(description="محتوى الخبر معاد صياغته بالكامل بأسلوب صحفي رياضي حصري ومقسم إلى فقرات وعناوين فرعية بصيغة Markdown (###)")
    category: str = Field(description="تصنيف الخبر، مثل: دوري أبطال أوروبا، الدوري الإنجليزي، الدوري الإسباني، الكرة العربية، بطولات أفريقيا، انتقالات اللاعبين")
    tags: List[str] = Field(description="قائمة من 4 إلى 6 وسوم (Tags) رياضية ذات صلة بالخبر")
    is_breaking: bool = Field(description="هل الخبر عاجل ومهم جداً؟")


class GeminiNewsRewriter:
    """
    وحدة الاتصال بـ Google Gemini API لإعادة صياغة الأخبار الرياضية المسحوبة
    بأسلوب احترافي، حصري، وغير مكرر مع توليد عنوان، ملخص، وتاجات.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
        self.client = None
        if self.api_key and self.api_key != "your_gemini_api_key_here":
            try:
                from google import genai
                self.client = genai.Client(api_key=self.api_key)
            except Exception as exc:
                logger.error(f"تعذر تهيئة عميل Google Gemini API: {exc}")

    def rewrite_article(self, raw_article: Dict[str, str]) -> Dict[str, Any]:
        """
        يرسل محتوى الخبر الأصلي إلى Gemini API ويعيد كائناً منظماً يحتوي على:
        (title, summary, content, category, tags, is_breaking)
        """
        original_title = raw_article.get("original_title", "")
        raw_content = raw_article.get("raw_content", "")

        if not self.client:
            logger.info("GEMINI_API_KEY غير مضبوط حالياً - استخدام المحرر الذكي المحلي الاحتياطي.")
            return self._smart_local_rewrite(raw_article)

        prompt = f"""
أنت رئيس تحرير في منصة إعلامية رياضية عربية كبرى.
مهمتك هي إعادة صياغة الخبر الرياضي التالي المسحوب من المصدر بأسلوب صحفي احترافي، حصري، مشوق، وغير منسوخ إطلاقاً (متوافق مع معايير SEO وحقوق النشر)، مع الحفاظ التام على دقة الحقائق والأسماء والأرقام.

العنوان الأصلي:
{original_title}

النص الأصلي للخبر:
{raw_content}

المطلوب في المخرجات:
1. `title`: عنوان رياضي جذاب وقوي وغير مكرر.
2. `summary`: ملخص مركز ومشوق للخبر (سطرين إلى 3 أسطر).
3. `content`: نص المقال كاملاً (3 إلى 4 فقرات غنية وواضحة) مع إضافة عنوانين فرعيين باستخدام `### عنوان فرعي`.
4. `category`: اختر التصنيف الأنسب من بين: (دوري أبطال أوروبا، الدوري الإنجليزي، الدوري الإسباني، الكرة العربية، بطولات أفريقيا، انتقالات اللاعبين، كرة قدم عالمية).
5. `tags`: قائمة من 4 إلى 6 كلمات مفتاحية (Tags) دقيقة.
6. `is_breaking`: قيمة منطقية (true/false) إذا كان الخبر عاجلاً أو مهماً.
"""

        try:
            from google.genai import types
            response = self.client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=RewrittenArticleSchema,
                    temperature=0.7,
                ),
            )
            data = json.loads(response.text)
            return {
                **raw_article,
                "title": data.get("title") or original_title,
                "summary": data.get("summary") or raw_content[:180],
                "content": data.get("content") or raw_content,
                "category": data.get("category") or "كرة قدم عالمية",
                "tags": data.get("tags") or ["كرة قدم", "أخبار الرياضة"],
                "is_breaking": bool(data.get("is_breaking", False)),
            }
        except Exception as exc:
            logger.error(f"حدث خطأ أثناء استدعاء Gemini API: {exc}")
            return self._smart_local_rewrite(raw_article)

    def _smart_local_rewrite(self, raw_article: Dict[str, str]) -> Dict[str, Any]:
        """صياغة احتياطية منظمة تعمل في حال عدم إدخال مفتاح Gemini API بعد."""
        original_title = raw_article.get("original_title", "تغطية رياضية خاصة")
        raw_content = raw_article.get("raw_content", "")

        paragraphs = [p.strip() for p in raw_content.split("\n") if p.strip()]
        summary = paragraphs[0][:210] + "..." if paragraphs else original_title

        formatted_content = (
            f"{paragraphs[0] if paragraphs else raw_content}\n\n"
            f"### تفاصيل التطورات الرياضية\n"
            f"{' '.join(paragraphs[1:]) if len(paragraphs) > 1 else raw_content}\n\n"
            f"### قراءة تحليلية للمرحلة القادمة\n"
            f"تأتي هذه التطورات في وقت حاسم من الموسم الكروي، حيث تترقب الجماهير انعكاسات هذا القرار على نتائج الفريق في الاستحقاقات المحلية والقارية المقبلة."
        )

        # استنتاج التصنيف والوسوم تلقائياً من النص
        combined_text = f"{original_title} {raw_content}"
        category = "كرة قدم عالمية"
        tags = ["أخبار الرياضة", "كرة القدم", "تغطية خاصة"]

        keyword_map = {
            "دوري أبطال أوروبا": ["أبطال أوروبا", "ريال مدريد", "برشلونة", "بايرن"],
            "الدوري الإنجليزي": ["الإنجليزي", "ليفربول", "مانشستر سيتي", "أرسنال", "صلاح", "البريميرليج"],
            "الدوري الإسباني": ["الإسباني", "الليجا", "برشلونة", "ريال مدريد", "أتلتيكو"],
            "الكرة العربية": ["السعودي", "دوري روشن", "الهلال", "النصر", "الاتحاد"],
            "بطولات أفريقيا": ["الأهلي", "الزمالك", "أبطال أفريقيا", "الترجي", "الوداد"],
        }

        for cat, words in keyword_map.items():
            for w in words:
                if w in combined_text:
                    category = cat
                    if w not in tags:
                        tags.append(w)

        return {
            **raw_article,
            "title": f"تغطية حصرية | {original_title}",
            "summary": summary,
            "content": formatted_content,
            "category": category,
            "tags": tags[:6],
            "is_breaking": True,
        }

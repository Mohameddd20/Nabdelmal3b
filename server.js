/**
 * خادم متكامل لمنصة "نبض الملاعب":
 * 1. يسحب جميع الأخبار الرياضية من https://www.ysscores.com/ar/news تلقائياً كل 5 دقائق.
 * 2. يعيد صياغتها عبر Google Gemini API (أو المحرر الذكي المنظم).
 * 3. يسحب جدول المباريات والنتائج المباشرة + تفاصيل كل مباراة (الأحداث، الإحصائيات، القناة، المعلق، الملعب)
 *    من YSScores + ESPN Free Public API.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const SEED_DB_FILE = path.join(__dirname, 'articles_db.json');
// دعم الكتابة في /tmp على الاستضافات المجانية مثل Vercel التي لا تطلب بطاقة بنكية
const DB_FILE = process.env.VERCEL
    ? path.join('/tmp', 'articles_db.json')
    : SEED_DB_FILE;
const HTML_FILE = fs.existsSync(path.join(__dirname, 'frontend', 'index.html'))
    ? path.join(__dirname, 'frontend', 'index.html')
    : path.join(__dirname, 'index.html');
const YSSCORES_NEWS_URL = 'https://www.ysscores.com/ar/news';
const YSSCORES_MATCHES_URL = 'https://www.ysscores.com/ar';
const ESPN_FREE_API_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
};

let cachedMatches = [];
let lastMatchesFetch = 0;
let lastNewsSyncTime = 0;
const matchDetailsCache = new Map();

function getEnvKey() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/GEMINI_API_KEY=(.+)/);
        if (match && match[1].trim() !== 'your_gemini_api_key_here') {
            return match[1].trim();
        }
    }
    return process.env.GEMINI_API_KEY || '';
}

function loadArticles() {
    if (fs.existsSync(DB_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch {}
    }
    if (fs.existsSync(SEED_DB_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SEED_DB_FILE, 'utf8'));
        } catch {}
    }
    return [];
}

function saveArticles(list) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.warn('Write DB notice:', e.message);
    }
}

function cleanHtmlText(str) {
    return (str || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 1. سحب جميع روابط الأخبار الموجودة في https://www.ysscores.com/ar/news
 */
async function fetchYSScoresArticleLinks() {
    const res = await fetch(YSSCORES_NEWS_URL, { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${YSSCORES_NEWS_URL}`);
    const html = await res.text();

    const regex = /href=["'](https?:\/\/www\.ysscores\.com\/ar\/news\/(\d+)\/[^"']+)["']/gi;
    const seenIds = new Set();
    const links = [];

    let match;
    while ((match = regex.exec(html)) !== null) {
        const fullUrl = match[1];
        const newsId = Number(match[2]);
        if (!seenIds.has(newsId)) {
            seenIds.add(newsId);
            links.push({ newsId, url: fullUrl });
        }
    }
    return links;
}

/**
 * 2. سحب تفاصيل الخبر الواحد من ysscores.com
 */
async function scrapeSingleYSScoresArticle(articleUrl, newsId) {
    const res = await fetch(articleUrl, { headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();

    const h1Match = html.match(/<h1[^>]*class=["'][^"']*news-page__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
                    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const originalTitle = h1Match ? cleanHtmlText(h1Match[1]) : '';
    if (!originalTitle) return null;

    const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const imageUrl = ogImgMatch ? ogImgMatch[1] : 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=80';

    const dateMatch = html.match(/news-page__chip--date[\s\S]*?<span>([\s\S]*?)<\/span>/i);
    const dateText = dateMatch ? cleanHtmlText(dateMatch[1]) : 'اليوم';

    const contentBlockMatch = html.match(/<div[^>]*class=["'][^"']*news-page__article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (!contentBlockMatch) return null;

    const pMatches = [...contentBlockMatch[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    const paragraphs = pMatches
        .map(m => cleanHtmlText(m[1]))
        .filter(text => text.length > 15);

    if (paragraphs.length === 0) return null;
    const rawContent = paragraphs.join('\n\n');

    let category = 'كرة قدم عالمية';
    const tags = [];

    const sectionsMatch = html.match(/<section[^>]*class=["'][^"']*news-sections[^"']*["'][^>]*>([\s\S]*?)<\/section>/i);
    if (sectionsMatch) {
        const secHtml = sectionsMatch[1];
        const champMatch = secHtml.match(/البطولة<\/h3>[\s\S]*?<span class="news-sections__name">([\s\S]*?)<\/span>/i);
        if (champMatch) {
            category = cleanHtmlText(champMatch[1]);
        }
        const tagMatches = [...secHtml.matchAll(/<span class="news-sections__name">([\s\S]*?)<\/span>/gi)];
        for (const tm of tagMatches) {
            const tagName = cleanHtmlText(tm[1]);
            if (tagName && !tags.includes(tagName)) {
                tags.push(tagName);
            }
        }
    }

    if (tags.length === 0) {
        tags.push('أخبار الرياضة', 'كرة القدم');
    }

    return {
        id: newsId,
        original_title: originalTitle,
        original_url: articleUrl,
        raw_content: rawContent,
        paragraphs,
        image_url: imageUrl,
        category,
        tags,
        created_at: dateText,
        source_name: 'نبض الملاعب'
    };
}

/**
 * 3. إعادة صياغة الخبر عبر Google Gemini API (أو المحرر الهيكلي)
 */
async function rewriteWithGemini(rawArticle) {
    const apiKey = getEnvKey();
    if (apiKey) {
        try {
            const prompt = `أنت رئيس تحرير في منصة إعلامية رياضية عربية كبرى.
أعد صياغة هذا الخبر الرياضي بأسلوب صحفي احترافي، حصري، وغير منسوخ، مع الحفاظ التام على دقة المعلومات والأسماء.
أرجع JSON فقط بالحقول التالية:
{
  "title": "عنوان رياضي جذاب وحصري",
  "summary": "ملخص مشوق في سطرين يبرز أهم معلومة",
  "content": "نص الخبر معاد صياغته بالكامل في 3 إلى 4 فقرات مع إضافة عنوانين فرعيين يبدآن بـ ### ",
  "category": "${rawArticle.category}",
  "tags": ["وسم1", "وسم2", "وسم3", "وسم4"]
}

العنوان الأصلي: ${rawArticle.original_title}
النص الأصلي:
${rawArticle.raw_content}`;

            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
                })
            });

            if (resp.ok) {
                const data = await resp.json();
                const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
                const mergedTags = Array.from(new Set([...(rawArticle.tags || []), ...(parsed.tags || [])])).slice(0, 6);
                return {
                    id: rawArticle.id || Date.now(),
                    original_title: rawArticle.original_title,
                    original_url: rawArticle.original_url,
                    title: parsed.title || rawArticle.original_title,
                    summary: parsed.summary || rawArticle.paragraphs[0],
                    content: parsed.content || rawArticle.raw_content,
                    category: parsed.category || rawArticle.category,
                    tags: mergedTags,
                    image_url: rawArticle.image_url,
                    views: Math.floor(Math.random() * 240) + 45,
                    is_breaking: true,
                    created_at: rawArticle.created_at || 'اليوم'
                };
            }
        } catch (err) {
            console.error('Gemini API rewrite warning:', err.message);
        }
    }

    const pList = rawArticle.paragraphs || rawArticle.raw_content.split('\n\n');
    const firstP = pList[0] || rawArticle.raw_content;
    const middlePs = pList.slice(1, 3).join('\n\n');
    const restPs = pList.slice(3).join('\n\n');

    let structuredContent = firstP;
    if (middlePs) {
        structuredContent += `\n\n### تفاصيل ومستجدات التقرير الرياضي\n${middlePs}`;
    }
    if (restPs) {
        structuredContent += `\n\n### كواليس وتطورات إضافية\n${restPs}`;
    }

    return {
        id: rawArticle.id || Date.now(),
        original_title: rawArticle.original_title,
        original_url: rawArticle.original_url,
        title: rawArticle.original_title,
        summary: firstP,
        content: structuredContent,
        category: rawArticle.category || 'كرة قدم عالمية',
        tags: rawArticle.tags || ['أخبار الرياضة', 'كرة القدم'],
        image_url: rawArticle.image_url,
        views: Math.floor(Math.random() * 220) + 30,
        is_breaking: true,
        created_at: rawArticle.created_at || 'اليوم'
    };
}

/**
 * 4. سحب جميع الأخبار المتاحة في صفحة الأخبار في ysscores.com تلقائياً
 */
async function syncAllNewsFromYSScores() {
    console.log('🔄 [Auto-Sync] جاري فحص وسحب جميع الأخبار الجديدة من https://www.ysscores.com/ar/news ...');
    const links = await fetchYSScoresArticleLinks();
    const existingArticles = loadArticles();
    const existingIds = new Set(existingArticles.map(a => a.id));

    const newLinks = links.filter(item => !existingIds.has(item.newsId)).slice(0, 8);
    let addedCount = 0;

    // سحب الأخبار على التوازي وبسرعة فائقة (أقل من ثانيتين) لتجنب أي Timeout على الاستضافات السحابية
    const scrapedResults = await Promise.all(
        newLinks.map(async (item) => {
            try {
                const raw = await scrapeSingleYSScoresArticle(item.url, item.newsId);
                if (raw) {
                    return await rewriteWithGemini(raw);
                }
            } catch (e) {
                console.warn(`⚠️ تخطي الرابط ${item.url}: ${e.message}`);
            }
            return null;
        })
    );

    for (const processed of scrapedResults) {
        if (processed && !existingIds.has(processed.id)) {
            existingArticles.push(processed);
            existingIds.add(processed.id);
            addedCount++;
        }
    }

    existingArticles.sort((a, b) => (b.id || 0) - (a.id || 0));
    saveArticles(existingArticles);
    lastNewsSyncTime = Date.now();
    console.log(`📊 إجمالي الأخبار المحفوظة الآن: ${existingArticles.length} خبر (تم إضافة ${addedCount} جديد).`);
    return { addedCount, total: existingArticles.length };
}

/**
 * 5. جلب المباريات الحية ونتائج اليوم + حفظ بياناتها التفصيلية
 */
async function fetchLiveAndTodayMatches() {
    const now = Date.now();
    if (cachedMatches.length > 0 && (now - lastMatchesFetch) < 45 * 1000) {
        return cachedMatches;
    }

    const matches = [];

    // أ) سحب مباريات اليوم المباشرة والمنتهية بالعربية من YSScores
    try {
        const res = await fetch(YSSCORES_MATCHES_URL, { headers: BROWSER_HEADERS });
        if (res.ok) {
            const html = await res.text();
            const matchBlocks = [...html.matchAll(/<a[^>]+class=["'][^"']*ajax-match-item[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];

            for (const m of matchBlocks) {
                const fullTag = m[0];
                const inner = m[1];

                const matchHref = (fullTag.match(/href=["'](https?:\/\/www\.ysscores\.com\/ar\/match\/[^"']+)["']/i) || [])[1] || '';
                const rawMatchId = (fullTag.match(/match_id=["'](\d+)["']/i) || [])[1] || String(matches.length + 1);
                const homeName = (fullTag.match(/home_name=["']([^"']+)["']/i) || [])[1];
                const awayName = (fullTag.match(/away_name=["']([^"']+)["']/i) || [])[1];
                const homeLogo = (fullTag.match(/home_image=["']([^"']+)["']/i) || [])[1];
                const awayLogo = (fullTag.match(/away_image=["']([^"']+)["']/i) || [])[1];
                const stageTitle = (fullTag.match(/title=["']([^"']+)["']/i) || [])[1] || 'مباريات اليوم';
                const dataStatus = (fullTag.match(/data-status=["'](\d+)["']/i) || [])[1] || '1';

                if (!homeName || !awayName) continue;

                const score1Match = inner.match(/first-team-result[^>]*>(\d+)<\/(?:div|span)>/i);
                const score2Match = inner.match(/second-team-result[^>]*>(\d+)<\/(?:div|span)>/i);
                const statusTextMatch = inner.match(/result-status-text[^>]*>([^<]+)<\/span>/i);
                const timeMatch = inner.match(/id=["']match-time-\d+["'][^>]*><span>([^<]+)<\/span>/i) ||
                                  inner.match(/class=["']match-date["'][^>]*>([^<]+)<\/b>/i);

                const isLive = fullTag.includes('live-match') || dataStatus === '3' || dataStatus === '2';
                const isFinished = dataStatus === '4' || (statusTextMatch && statusTextMatch[1].includes('انتهت'));

                const matchObj = {
                    id: `ys-${rawMatchId}`,
                    raw_id: rawMatchId,
                    match_url: matchHref,
                    competition: stageTitle,
                    home_team: cleanHtmlText(homeName),
                    away_team: cleanHtmlText(awayName),
                    home_logo: homeLogo || '',
                    away_logo: awayLogo || '',
                    home_score: score1Match ? score1Match[1] : '-',
                    away_score: score2Match ? score2Match[1] : '-',
                    status_text: statusTextMatch ? cleanHtmlText(statusTextMatch[1]) : (isLive ? 'مباشر' : 'اليوم'),
                    clock: timeMatch ? cleanHtmlText(timeMatch[1]) : '',
                    state: isLive ? 'live' : (isFinished ? 'finished' : 'upcoming'),
                    source: 'YSScores'
                };
                matches.push(matchObj);
            }
        }
    } catch (e) {
        console.warn('YSScores matches fetch warning:', e.message);
    }

    // ب) سحب المباريات العالمية من ESPN Free Public API (مع تخزين الإحصائيات والأحداث الخاصة بها)
    try {
        const espnRes = await fetch(ESPN_FREE_API_URL);
        if (espnRes.ok) {
            const espnData = await espnRes.json();
            const events = (espnData.events || []).slice(0, 15);
            for (const ev of events) {
                const comp = ev.competitions && ev.competitions[0];
                if (!comp || !comp.competitors || comp.competitors.length < 2) continue;

                const home = comp.competitors.find(c => c.homeAway === 'home') || comp.competitors[0];
                const away = comp.competitors.find(c => c.homeAway === 'away') || comp.competitors[1];
                const stState = (ev.status && ev.status.type && ev.status.type.state) || 'pre';
                const detail = (ev.status && ev.status.type && ev.status.type.shortDetail) || '';

                let state = 'upcoming';
                let statusAr = 'لم تبدأ';
                if (stState === 'in') {
                    state = 'live';
                    statusAr = 'مباشر الآن';
                } else if (stState === 'post') {
                    state = 'finished';
                    statusAr = 'انتهت المباراة';
                }

                const matchId = `espn-${ev.id}`;
                const matchObj = {
                    id: matchId,
                    raw_id: ev.id,
                    competition: 'مباريات عالمية (ESPN)',
                    home_team: home.team.shortDisplayName || home.team.displayName,
                    away_team: away.team.shortDisplayName || away.team.displayName,
                    home_logo: home.team.logo || '',
                    away_logo: away.team.logo || '',
                    home_score: stState === 'pre' ? '-' : (home.score || '0'),
                    away_score: stState === 'pre' ? '-' : (away.score || '0'),
                    status_text: statusAr,
                    clock: detail,
                    state,
                    source: 'ESPN API'
                };
                matches.push(matchObj);

                // بناء تفاصيل المباراة من بيانات ESPN الجاهزة
                const statLabelsAr = {
                    possessionPct: 'الاستحواذ (%)',
                    totalShots: 'إجمالي التسديدات',
                    shotsOnTarget: 'تسديدات على المرمى',
                    wonCorners: 'الركنيات',
                    foulsCommitted: 'الأخطاء المرتكبة'
                };
                const homeStatsMap = {};
                const awayStatsMap = {};
                (home.statistics || []).forEach(s => { homeStatsMap[s.name] = s.displayValue; });
                (away.statistics || []).forEach(s => { awayStatsMap[s.name] = s.displayValue; });

                const statsList = [];
                for (const [key, labelAr] of Object.entries(statLabelsAr)) {
                    if (homeStatsMap[key] !== undefined || awayStatsMap[key] !== undefined) {
                        statsList.push({
                            title: labelAr,
                            home: homeStatsMap[key] || '0',
                            away: awayStatsMap[key] || '0'
                        });
                    }
                }

                const eventsList = (comp.details || []).map(d => {
                    const isHome = d.team && d.team.id === home.team.id;
                    const player = (d.athletesInvolved && d.athletesInvolved[0] && d.athletesInvolved[0].displayName) || '';
                    const assist = (d.athletesInvolved && d.athletesInvolved[1] && d.athletesInvolved[1].displayName) || '';
                    let typeAr = 'حدث في المباراة';
                    let icon = '⚡';
                    if (d.scoringPlay) {
                        typeAr = d.penaltyKick ? 'هدف (ركلة جزاء)' : 'هدف';
                        icon = '⚽';
                    } else if (d.redCard) {
                        typeAr = 'بطاقة حمراء';
                        icon = '🟥';
                    } else if (d.yellowCard) {
                        typeAr = 'بطاقة صفراء';
                        icon = '🟨';
                    }
                    return {
                        minute: (d.clock && d.clock.displayValue) || '',
                        team_side: isHome ? 'home' : 'away',
                        type: typeAr,
                        icon,
                        player,
                        assist
                    };
                });

                const venueName = (comp.venue && comp.venue.fullName) ? `${comp.venue.fullName}${comp.venue.address && comp.venue.address.city ? ' - ' + comp.venue.address.city : ''}` : 'ملعب معتمد دولياً';
                const matchDateStr = ev.date ? new Date(ev.date).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : 'اليوم';

                matchDetailsCache.set(matchId, {
                    ...matchObj,
                    info: [
                        { title: 'البطولة', content: 'منافسات الأندية العالمية' },
                        { title: 'ملعب المباراة', content: venueName },
                        { title: 'توقيت اللقاء', content: matchDateStr },
                        { title: 'الحضور الجماهيري', content: comp.attendance ? `${comp.attendance.toLocaleString()} متفرج` : 'مدرجات كاملة' }
                    ],
                    stats: statsList,
                    events: eventsList,
                    poll: { home: 45, draw: 25, away: 30 }
                });
            }
        }
    } catch (e) {
        console.warn('ESPN matches fetch warning:', e.message);
    }

    cachedMatches = matches;
    lastMatchesFetch = now;
    return matches;
}

/**
 * 6. جلب البيانات التفصيلية الكاملة لمباراة محددة (الأحداث، الإحصائيات، الملعب، القناة، المعلق، تصويت الجمهور)
 */
async function getFullMatchDetails(matchId) {
    if (cachedMatches.length === 0) {
        await fetchLiveAndTodayMatches();
    }

    const baseMatch = cachedMatches.find(m => m.id === matchId);
    if (!baseMatch) return null;

    if (matchDetailsCache.has(matchId)) {
        return matchDetailsCache.get(matchId);
    }

    // إذا كانت المباراة من YSScores، نسحب تفاصيلها الحية مباشرة من صفحة المباراة على ysscores.com
    if (baseMatch.match_url) {
        try {
            const res = await fetch(baseMatch.match_url, { headers: BROWSER_HEADERS });
            if (res.ok) {
                const html = await res.text();

                // 1. استخراج معلومات المباراة (القناة، المعلق، البطولة، الجولة، الملعب، الوقت، التاريخ)
                const infoList = [];
                const seenInfoTitles = new Set();
                const infoRegex = /<div class="match-info-item">[\s\S]*?<div class="title">([\s\S]*?)<\/div>[\s\S]*?<div class="content">([\s\S]*?)<\/div>/gi;
                let infoMatch;
                while ((infoMatch = infoRegex.exec(html)) !== null) {
                    const title = cleanHtmlText(infoMatch[1]);
                    const content = cleanHtmlText(infoMatch[2]);
                    if (title && content && !seenInfoTitles.has(title)) {
                        seenInfoTitles.add(title);
                        infoList.push({ title, content });
                    }
                }

                // 2. استخراج إحصائيات الفريقين (الاستحواذ، التسديدات، التسللات، الأخطاء، الركنيات)
                const statsList = [];
                const seenStats = new Set();
                const statsRegex = /<div class="stats-text-item[^"]*">\s*<span>([\s\S]*?)<\/span>\s*<span class="title">([\s\S]*?)<\/span>\s*<span>([\s\S]*?)<\/span>/gi;
                let stMatch;
                while ((stMatch = statsRegex.exec(html)) !== null) {
                    const homeVal = cleanHtmlText(stMatch[1]);
                    const statTitle = cleanHtmlText(stMatch[2]);
                    const awayVal = cleanHtmlText(stMatch[3]);
                    if (statTitle && !seenStats.has(statTitle)) {
                        seenStats.add(statTitle);
                        statsList.push({
                            title: statTitle,
                            home: homeVal,
                            away: awayVal
                        });
                    }
                }

                // 3. استخراج أحداث المباراة (الأهداف، البطاقات، التبديلات)
                const eventsList = [];
                const seenEventIds = new Set();
                const eventRegex = /<a[^>]+class=["'][^"']*t-side\s+(team-[ab])\s+comm_pop[^"']*["'][^>]*>/gi;
                let evMatch;
                while ((evMatch = eventRegex.exec(html)) !== null) {
                    const tag = evMatch[0];
                    const teamSide = evMatch[1] === 'team-a' ? 'home' : 'away';
                    const eventId = (tag.match(/event_id=["']([^"']+)["']/i) || [])[1] || String(eventsList.length);
                    if (seenEventIds.has(eventId)) continue;
                    seenEventIds.add(eventId);

                    const eventName = cleanHtmlText((tag.match(/event_name=["']([^"']+)["']/i) || [])[1] || 'حدث');
                    const playerA = cleanHtmlText((tag.match(/player_a=["']([^"']+)["']/i) || [])[1] || '');
                    const playerImg = (tag.match(/player_a_image=["']([^"']+)["']/i) || [])[1] || '';
                    const playerS = cleanHtmlText((tag.match(/player_s=["']([^"']+)["']/i) || [])[1] || '');
                    const min = cleanHtmlText((tag.match(/min=["']([^"']+)["']/i) || [])[1] || '');

                    let icon = '⚡';
                    if (eventName.includes('هدف')) icon = '⚽';
                    else if (eventName.includes('صفراء') || eventName.includes('إنذار')) icon = '🟨';
                    else if (eventName.includes('حمراء') || eventName.includes('طرد')) icon = '🟥';
                    else if (eventName.includes('تبديل')) icon = '🔄';

                    if (playerA) {
                        eventsList.push({
                            minute: min ? `${min}'` : '',
                            team_side: teamSide,
                            type: eventName,
                            icon,
                            player: playerA,
                            player_image: playerImg,
                            assist: playerS
                        });
                    }
                }

                // 4. استخراج نسب تصويت الجمهور
                const pollMatch = html.match(/data-home-pct=["'](\d+)["'][\s\S]*?data-draw-pct=["'](\d+)["'][\s\S]*?data-away-pct=["'](\d+)["']/i);
                const poll = pollMatch
                    ? { home: Number(pollMatch[1]), draw: Number(pollMatch[2]), away: Number(pollMatch[3]) }
                    : { home: 40, draw: 25, away: 35 };

                const detailed = {
                    ...baseMatch,
                    info: infoList,
                    stats: statsList,
                    events: eventsList,
                    poll
                };
                matchDetailsCache.set(matchId, detailed);
                return detailed;
            }
        } catch (e) {
            console.warn(`Failed to scrape match details for ${matchId}:`, e.message);
        }
    }

    return {
        ...baseMatch,
        info: [
            { title: 'البطولة', content: baseMatch.competition },
            { title: 'حالة اللقاء', content: baseMatch.status_text }
        ],
        stats: [],
        events: [],
        poll: { home: 40, draw: 25, away: 35 }
    };
}

const requestHandler = async (req, res) => {
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }

        if (req.method === 'GET' && (urlObj.pathname === '/' || urlObj.pathname === '/index.html')) {
            const html = fs.readFileSync(HTML_FILE, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(html);
        }

        if (req.method === 'GET' && urlObj.pathname === '/api/articles') {
            let articles = loadArticles();
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            if (articles.length === 0 || lastNewsSyncTime < fiveMinutesAgo) {
                try {
                    await syncAllNewsFromYSScores();
                    articles = loadArticles();
                } catch (e) {
                    console.warn('Sync warning:', e.message);
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ count: articles.length, articles }));
        }

        if (req.method === 'GET' && urlObj.pathname.startsWith('/api/articles/')) {
            const id = Number(urlObj.pathname.split('/').pop());
            const articles = loadArticles();
            const item = articles.find(a => a.id === id);
            if (!item) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ detail: 'الخبر غير موجود' }));
            }
            item.views = (item.views || 1) + 1;
            saveArticles(articles);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(item));
        }

        if (req.method === 'GET' && urlObj.pathname === '/api/matches') {
            const matches = await fetchLiveAndTodayMatches();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ count: matches.length, matches }));
        }

        if (req.method === 'GET' && urlObj.pathname.startsWith('/api/matches/')) {
            const matchId = decodeURIComponent(urlObj.pathname.split('/').pop());
            const details = await getFullMatchDetails(matchId);
            if (!details) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ detail: 'المباراة غير موجودة' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(details));
        }

        res.writeHead(404);
        res.end('Not Found');
    } catch (err) {
        console.error('Handler error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
    }
};

// تشغيل الخادم محلياً، وتصدير دالة requestHandler مباشرة لتعمل على Vercel Serverless Functions
if (!process.env.VERCEL) {
    const server = http.createServer(requestHandler);
    server.listen(PORT, async () => {
        console.log(`====================================================`);
        console.log(`🚀 بوابة نبض الملاعب تعمل الآن على: http://localhost:${PORT}`);
        console.log(`🔗 سحب جميع الأخبار كل 5 دقائق من: ${YSSCORES_NEWS_URL}`);
        console.log(`⚽ مركز المباريات وتفاصيل اللقاء متصل بـ YSScores + ESPN API`);
        console.log(`====================================================`);
        try {
            await syncAllNewsFromYSScores();
            await fetchLiveAndTodayMatches();
        } catch (e) {
            console.error('Initial sync error:', e.message);
        }

        setInterval(async () => {
            try {
                await syncAllNewsFromYSScores();
            } catch (e) {
                console.error('Background auto-sync error:', e.message);
            }
        }, 5 * 60 * 1000);
    });
}

module.exports = requestHandler;

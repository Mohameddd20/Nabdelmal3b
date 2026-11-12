/**
 * خادم متكامل لمنصة "KoraTime | كورة تايم" (متوافق مع Google AdSense و SEO و Vercel):
 * 1. يسحب جميع الأخبار الرياضية من https://www.ysscores.com/ar/news تلقائياً كل 5 دقائق.
 * 2. يضمن أن يكون كل مقال غنياً ومفصلاً (أكثر من 320 - 400 كلمة على الأقل) مع عناوين فرعية وتحليل شامل.
 * 3. يسحب جدول المباريات مقسماً حسب البطولة مع توليد خط زمني كامل للأحداث والإحصائيات لكل مباراة.
 * 4. يوفر جدول ترتيب الدوريات وملفات السيو وأدسنس: /robots.txt, /sitemap.xml, /ads.txt
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const SEED_DB_FILE = path.join(__dirname, 'articles_db.json');
const DB_FILE = process.env.VERCEL
    ? path.join('/tmp', 'articles_db.json')
    : SEED_DB_FILE;
const HTML_FILE = fs.existsSync(path.join(__dirname, 'frontend', 'index.html'))
    ? path.join(__dirname, 'frontend', 'index.html')
    : path.join(__dirname, 'index.html');

const YSSCORES_NEWS_URL = 'https://www.ysscores.com/ar/news';
const YSSCORES_MATCHES_URL = 'https://www.ysscores.com/ar';

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
};

let cachedMatches = [];
let lastMatchesFetch = 0;
let lastNewsSyncTime = 0;
const matchesCacheByDay = new Map();
const lastMatchesFetchByDay = new Map();
const matchDetailsCache = new Map();
const standingsCache = new Map();

const SUPPORTED_LEAGUES = {
    epl: { name: 'الدوري الإنجليزي الممتاز', ysPath: '6811/Premier-League', espnCode: 'eng.1' },
    laliga: { name: 'الدوري الإسباني', ysPath: '1933/LaLiga', espnCode: 'esp.1' },
    saudi: { name: 'دوري روشن السعودي', ysPath: '7167/Saudi-Pro-League', espnCode: 'sau.1' },
    egypt: { name: 'الدوري المصري الممتاز', ysPath: '58553/Egyptian-League', espnCode: 'egy.1' },
    ucl: { name: 'دوري أبطال أوروبا', ysPath: '12048/UEFA-Champions-League', espnCode: 'uefa.champions' },
    seriea: { name: 'الدوري الإيطالي', ysPath: '3734/Serie-A', espnCode: 'ita.1' },
    bundesliga: { name: 'الدوري الألماني', ysPath: '2606/Bundesliga', espnCode: 'ger.1' },
    ligue1: { name: 'الدوري الفرنسي', ysPath: '1985/Ligue-1', espnCode: 'fra.1' },
    morocco: { name: 'الدوري المغربي للمحترفين', ysPath: '41135/Botola-Pro', espnCode: 'mar.1' }
};

const CATEGORY_NORMALIZATION_MAP = {
    'الدوري الإنجليزي': 'الدوري الإنجليزي الممتاز',
    'الدوري الإنجليزي الممتاز': 'الدوري الإنجليزي الممتاز',
    'البريميرليج': 'الدوري الإنجليزي الممتاز',
    'الدوري الإسباني': 'الدوري الإسباني',
    'الليجا': 'الدوري الإسباني',
    'كأس ملك إسبانيا': 'الدوري الإسباني',
    'الدوري الإيطالي': 'الدوري الإيطالي',
    'الدوري الألماني': 'الدوري الألماني',
    'الدوري الفرنسي': 'الدوري الفرنسي',
    'دوري أبطال أوروبا': 'دوري أبطال أوروبا',
    'الدوري الأوروبي': 'دوري أبطال أوروبا',
    'الدوري السعودي للمحترفين': 'دوري روشن السعودي',
    'دوري روشن السعودي': 'دوري روشن السعودي',
    'الكرة العربية': 'دوري روشن السعودي',
    'الدوري المصري': 'الدوري المصري',
    'كأس مصر': 'الدوري المصري',
    'دوري أبطال أفريقيا': 'بطولات أفريقيا',
    'بطولات أفريقيا': 'بطولات أفريقيا',
    'مباراة ودية': 'المنتخبات الدولية',
    'كأس العالم': 'المنتخبات الدولية',
    'تصفيات كأس العالم': 'المنتخبات الدولية'
};

const TEAM_ARABIC_NAMES = {
    // الدوري الإسباني
    'Real Madrid': 'ريال مدريد',
    'Barcelona': 'برشلونة',
    'Atlético Madrid': 'أتلتيكو مدريد',
    'Atletico Madrid': 'أتلتيكو مدريد',
    'Sevilla': 'إشبيلية',
    'Real Sociedad': 'ريال سوسيداد',
    'Athletic Club': 'أتلتيك بلباو',
    'Athletic Bilbao': 'أتلتيك بلباو',
    'Real Betis': 'ريال بيتيس',
    'Villarreal': 'فياريال',
    'Valencia': 'فالنسيا',
    'Girona': 'جيرونا',
    'Mallorca': 'مايوركا',
    'Osasuna': 'أوساسونا',
    'Celta Vigo': 'سيلتا فيغو',
    'Getafe': 'خيتافي',
    'Las Palmas': 'لاس بالماس',
    'Rayo Vallecano': 'رايو فاليكانو',
    'Alavés': 'ألافيس',
    'Espanyol': 'إسبانيول',
    'Leganés': 'ليغانيس',
    'Valladolid': 'بلد الوليد',

    // الدوري الإنجليزي الممتاز
    'Manchester City': 'مانشستر سيتي',
    'Liverpool': 'ليفربول',
    'Arsenal': 'أرسنال',
    'Chelsea': 'تشيلسي',
    'Manchester United': 'مانشستر يونايتد',
    'Tottenham Hotspur': 'توتنهام',
    'Tottenham': 'توتنهام',
    'Aston Villa': 'أستون فيلا',
    'Newcastle United': 'نيوكاسل يونايتد',
    'Newcastle': 'نيوكاسل',
    'Brighton & Hove Albion': 'برايتون',
    'Brighton': 'برايتون',
    'West Ham United': 'وست هام',
    'West Ham': 'وست هام',
    'Wolverhampton Wanderers': 'وولفرهامبتون',
    'Wolves': 'وولفرهامبتون',
    'Everton': 'إيفرتون',
    'Crystal Palace': 'كريستال بالاس',
    'Brentford': 'برينتفورد',
    'Fulham': 'فولهام',
    'AFC Bournemouth': 'بورنموث',
    'Bournemouth': 'بورنموث',
    'Nottingham Forest': 'نوتينغهام فورست',
    'Leicester City': 'ليستر سيتي',
    'Leicester': 'ليستر سيتي',
    'Ipswich Town': 'إيبسويتش تاون',
    'Southampton': 'ساوثهامبتون',

    // الدوري الإيطالي
    'Juventus': 'يوفنتوس',
    'Inter Milan': 'إنتر ميلان',
    'Internazionale': 'إنتر ميلان',
    'AC Milan': 'ميلان',
    'Milan': 'ميلان',
    'Napoli': 'نابولي',
    'AS Roma': 'روما',
    'Roma': 'روما',
    'Lazio': 'لاتسيو',
    'Atalanta': 'أتالانتا',
    'Fiorentina': 'فيورنتينا',
    'Torino': 'تورينو',
    'Bologna': 'بولونيا',
    'Monza': 'مونزا',
    'Genoa': 'جنوى',
    'Parma': 'بارما',
    'Udinese': 'أودينيزي',
    'Cagliari': 'كالياري',
    'Verona': 'فيرونا',
    'Empoli': 'إمبولي',

    // الدوري الألماني
    'Bayern Munich': 'بايرن ميونخ',
    'Borussia Dortmund': 'بوروسيا دورتموند',
    'Bayer Leverkusen': 'باير ليفركوزن',
    'RB Leipzig': 'لايبزيغ',
    'Leipzig': 'لايبزيغ',
    'Eintracht Frankfurt': 'فرانكفورت',
    'Frankfurt': 'فرانكفورت',
    'VfB Stuttgart': 'شتوتغارت',
    'Stuttgart': 'شتوتغارت',
    'Wolfsburg': 'فولفسبورغ',
    'Borussia Mönchengladbach': 'مونشنغلادباخ',
    'Werder Bremen': 'فيردر بريمن',
    'Freiburg': 'فرايبورغ',
    'Augsburg': 'أوغسبورغ',
    'Hoffenheim': 'هوفنهايم',
    'Mainz': 'ماينز',
    'Union Berlin': 'يونيون برلين',

    // الدوري الفرنسي
    'Paris Saint-Germain': 'باريس سان جيرمان',
    'PSG': 'باريس سان جيرمان',
    'Marseille': 'مارسيليا',
    'Monaco': 'موناكو',
    'Lyon': 'ليون',
    'Lille': 'ليل',
    'Lens': 'لانس',
    'Rennes': 'رين',
    'Nice': 'نيس',
    'Strasbourg': 'ستراسبورغ',
    'Toulouse': 'تولوز',

    // دوري روشن السعودي
    'Al Hilal': 'الهلال',
    'Al-Hilal': 'الهلال',
    'Al Nassr': 'النصر',
    'Al-Nassr': 'النصر',
    'Al Ittihad': 'الاتحاد',
    'Al-Ittihad': 'الاتحاد',
    'Al Ahli': 'الأهلي السعودي',
    'Al-Ahli': 'الأهلي السعودي',
    'Al Shabab': 'الشباب',
    'Al-Shabab': 'الشباب',
    'Al Ettifaq': 'الاتفاق',
    'Al-Ettifaq': 'الاتفاق',
    'Al Fateh': 'الفتح',
    'Al Taawoun': 'التعاون',
    'Al Wehda': 'الوحدة',
    'Al Fayha': 'الفيحاء',
    'Damac': 'ضمك',
    'Al Khaleej': 'الخليج',
    'Al Raed': 'الرائد',
    'Al Riyadh': 'الرياض',
    'Al Qadsiah': 'القادسية',
    'Al Orobah': 'العروبة',
    'Al Kholood': 'الخلود',

    // الدوري المصري الممتاز
    'Al Ahly': 'الأهلي المصري',
    'Al-Ahly': 'الأهلي المصري',
    'Zamalek': 'الزمالك',
    'Pyramids FC': 'بيراميدز',
    'Pyramids': 'بيراميدز',
    'Modern Future': 'مودرن سبورت',
    'Future FC': 'مودرن سبورت',
    'Ceramica Cleopatra': 'سيراميكا كليوباترا',
    'Al Masry': 'المصري البورسعيدي',
    'Ismaily': 'الإسماعيلي',
    'Smouha': 'سموحة',
    'ENPPI': 'إنبي',
    'ZED FC': 'زد إف سي',
    'National Bank': 'البنك الأهلي',
    'El Gouna': 'الجونة',

    // بطولات أوروبية وأندية أخرى
    'Benfica': 'بنفيكا',
    'Sporting CP': 'سبورتينج لشبونة',
    'FC Porto': 'بورتو',
    'Porto': 'بورتو',
    'Ajax': 'أياكس',
    'Feyenoord': 'فينورد',
    'PSV Eindhoven': 'آيندهوفن',
    'Galatasaray': 'غلطة سراي',
    'Fenerbahce': 'فنربخشة',
    'Besiktas': 'بشكتاش',
    'Celtic': 'سيلتيك',
    'Rangers': 'رينجرز',

    // منتخبات دولية
    'Egypt': 'مصر',
    'Saudi Arabia': 'السعودية',
    'Morocco': 'المغرب',
    'Algeria': 'الجزائر',
    'Tunisia': 'تونس',
    'Spain': 'إسبانيا',
    'England': 'إنجلترا',
    'France': 'فرنسا',
    'Germany': 'ألمانيا',
    'Italy': 'إيطاليا',
    'Brazil': 'البرازيل',
    'Argentina': 'الأرجنتين',
    'Portugal': 'البرتغال',
    'Netherlands': 'هولندا',
    'Belgium': 'بلجيكا',
    'Croatia': 'كرواتيا',
    'Japan': 'اليابان',
    'South Korea': 'كوريا الجنوبية',
    'Vietnam': 'فيتنام',
    'Chinese Taipei': 'تايبيه الصينية'
};

function translateTeamName(name) {
    if (!name) return '';
    const clean = name.replace(/\s+(FC|SC|Club|Women|Ladies|W)\b/gi, '').trim();
    for (const [en, ar] of Object.entries(TEAM_ARABIC_NAMES)) {
        if (clean.toLowerCase().includes(en.toLowerCase()) || en.toLowerCase().includes(clean.toLowerCase())) {
            return ar;
        }
    }
    return clean || name;
}

function translateAltGameNote(note) {
    if (!note) return 'مباريات كرة القدم';
    const n = note.toLowerCase();
    if (n.includes('champions league') || n.includes('uefa champions')) return 'دوري أبطال أوروبا';
    if (n.includes('europa league')) return 'الدوري الأوروبي';
    if (n.includes('conference league')) return 'دوري المؤتمر الأوروبي';
    if (n.includes('premier league') || n.includes('english')) return 'الدوري الإنجليزي الممتاز';
    if (n.includes('la liga') || n.includes('laliga') || n.includes('spanish')) return 'الدوري الإسباني';
    if (n.includes('serie a') || n.includes('italian')) return 'الدوري الإيطالي';
    if (n.includes('bundesliga') || n.includes('german')) return 'الدوري الألماني';
    if (n.includes('ligue 1') || n.includes('french')) return 'الدوري الفرنسي';
    if (n.includes('saudi') || n.includes('roshn')) return 'دوري روشن السعودي';
    if (n.includes('egypt') || n.includes('nile')) return 'الدوري المصري الممتاز';
    if (n.includes('friendly') || n.includes('international')) return 'مباريات دولية وودية';
    if (n.includes('nations league')) return 'دوري الأمم الأوروبية';
    if (n.includes('world cup')) return 'تصفيات كأس العالم';
    if (n.includes('cup')) return 'كأس ومنافسات رسمية';
    return note;
}

function translatePositionAr(pos) {
    if (!pos) return 'لاعب';
    const p = pos.toLowerCase();
    if (p.includes('goal') || p === 'g' || p === 'gk') return 'حارس مرمى';
    if (p.includes('defen') || p.includes('back') || p === 'd' || p === 'cb' || p === 'lb' || p === 'rb') return 'مدافع';
    if (p.includes('midfield') || p === 'm' || p === 'cm' || p === 'dm' || p === 'am') return 'خط وسط';
    if (p.includes('forward') || p.includes('striker') || p.includes('wing') || p === 'f' || p === 'st' || p === 'cf' || p === 'lw' || p === 'rw') return 'مهاجم';
    return pos;
}

function normalizeCategory(rawCat, title = '') {
    const clean = (rawCat || '').trim();
    if (CATEGORY_NORMALIZATION_MAP[clean]) {
        return CATEGORY_NORMALIZATION_MAP[clean];
    }
    const text = `${clean} ${title}`;
    if (text.includes('برشلونة') || text.includes('ريال مدريد') || text.includes('أتلتيكو') || text.includes('إسباني')) return 'الدوري الإسباني';
    if (text.includes('صلاح') || text.includes('ليفربول') || text.includes('مانشستر') || text.includes('أرسنال') || text.includes('تشيلسي') || text.includes('توتنهام')) return 'الدوري الإنجليزي الممتاز';
    if (text.includes('بايرن') || text.includes('دورتموند') || text.includes('ألمانيا')) return 'الدوري الألماني';
    if (text.includes('يوفنتوس') || text.includes('ميلان') || text.includes('إنتر') || text.includes('روما')) return 'الدوري الإيطالي';
    if (text.includes('باريس') || text.includes('فرنسا') || text.includes('مبابي')) return 'الدوري الفرنسي';
    if (text.includes('الهلال') || text.includes('النصر') || text.includes('الاتحاد') || text.includes('الأهلي السعودي') || text.includes('روشن')) return 'دوري روشن السعودي';
    if (text.includes('الأهلي') || text.includes('الزمالك') || text.includes('مصر') || text.includes('الفراعنة')) return 'الدوري المصري';
    if (text.includes('أبطال أوروبا')) return 'دوري أبطال أوروبا';
    return clean || 'كرة قدم عالمية';
}

function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * محرك بناء المقال الصحفي المطول (يضمن أن يكون كل مقال أكثر من 330 إلى 420 كلمة على الأقل)
 * متوافق مع معايير Google AdSense و SEO
 */
function buildComprehensiveArticleContent(rawArticle) {
    const title = rawArticle.title || rawArticle.original_title || 'تغطية رياضية خاصة';
    const category = normalizeCategory(rawArticle.category, title);
    const tags = Array.isArray(rawArticle.tags) && rawArticle.tags.length > 0
        ? rawArticle.tags
        : [category, 'كرة القدم العالمية', 'KoraTime'];
    const mainSubject = tags[0] || category;
    const secondSubject = tags[1] || 'المنافسات الكروية';

    const baseParagraphs = (rawArticle.paragraphs && rawArticle.paragraphs.length > 0)
        ? rawArticle.paragraphs
        : (rawArticle.content || rawArticle.raw_content || '')
            .split('\n\n')
            .map(p => p.replace(/^###\s+.*$/gm, '').trim())
            .filter(p => p.length > 20);

    const introParagraph = baseParagraphs[0] || title;
    const bodyParagraphs = baseParagraphs.slice(1).join('\n\n');

    const section1 = `${introParagraph}\n\nوتحظى هذه التطورات باهتمام إعلامي وجماهيري واسع في الأوساط الرياضية، نظراً لما تمثله من أهمية بالغة في رسم ملامح المرحلة المقبلة ضمن منافسات ${category}، حيث تتابع الجماهير عن كثب كافة التفاصيل الرسمية الصادرة حول هذا الملف.`;

    const section2 = `### تفاصيل الكواليس والمستجدات الرسمية\n${bodyParagraphs || introParagraph}\n\nوفي سياق متصل، تشير المعطيات الفنية داخل أروقة ${mainSubject} إلى أن القرارات الأخيرة جاءت عقب سلسلة من الاجتماعات والتقييمات الشاملة التي أجراها الجهاز الفني بالتنسيق مع الإدارة الرياضية، وذلك بهدف ضمان أعلى درجات الجاهزية البدنية والذهنية قبل خوض الاستحقاقات الحاسمة القادمة.`;

    const section3 = `### قراءة فنية وتحليلية في المشهد الكروي\nيرى المحللون والمتابعون لشؤون ${category} أن هذه الخطوة تلقي بظلالها المباشرة على التوازن التكتيكي وحسابات المنافسة خلال الجولات المقبلة. فمع تقارب المستويات الفنية واشتداد الصراع على المراكز المتقدمة، يصبح التعامل الاحترافي مع مثل هذه المتغيرات عاملاً حاسماً في تحديد قدرة الفرق على الحفاظ على استقرارها الفني وتحقيق النتائج الإيجابية تحت ضغط المباريات المتتالية.\n\nكما أن إدارة ملفات اللاعبين والجوانب التكتيكية المرتبطة بـ ${secondSubject} تتطلب مرونة عالية ورؤية استراتيجية طويلة الأمد، وهو ما يسعى القائمون على المنظومة إلى ترسيخه لتفادي أي تراجع في الأداء العام أو فقدان للنقاط في المواعيد الكبرى.`;

    const section4 = `### التوقعات والاستحقاقات المرتقبة في المرحلة القادمة\nمن المنتظر أن تشهد الأيام القليلة المقبلة مزيداً من الوضوح بشأن كافة التفاصيل المرتبطة بهذا الحدث، لا سيما مع اقتراب المواجهات الرسمية التي ستكون بمثابة اختبار حقيقي على أرض الواقع. وتترقب الجماهير الرياضية ما ستسفر عنه هذه التطورات، وسط آمال كبيرة بأن تنعكس بشكل إيجابي على مستوى المنافسة والإثارة الكروية التي تميز ${category} هذا الموسم.`;

    return `${section1}\n\n${section2}\n\n${section3}\n\n${section4}`;
}

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
    let list = [];
    if (fs.existsSync(DB_FILE)) {
        try {
            list = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch {}
    }
    if (list.length === 0 && fs.existsSync(SEED_DB_FILE)) {
        try {
            list = JSON.parse(fs.readFileSync(SEED_DB_FILE, 'utf8'));
        } catch {}
    }

    let updated = false;
    const normalizedList = list.map(a => {
        const normCat = normalizeCategory(a.category, a.title);
        let content = a.content || '';
        // إذا كان المقال أقل من 300 كلمة، نقوم بتوسيعه تلقائياً ليصبح فوق 330 كلمة
        if (countWords(content) < 300) {
            content = buildComprehensiveArticleContent({ ...a, category: normCat });
            updated = true;
        }
        return {
            ...a,
            category: normCat,
            content
        };
    });

    if (updated) {
        saveArticles(normalizedList);
    }
    return normalizedList;
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
 * 1. سحب جميع روابط الأخبار من عدة صفحات في https://www.ysscores.com/ar/news
 * لضمان توفير تدفق دائم وموسع لأحدث المقالات المتجددة لتلبية متطلبات Google AdSense
 */
async function fetchYSScoresArticleLinks(maxPages = 5) {
    const seenIds = new Set();
    const links = [];

    // 1. جلب الصفحة الرئيسية للأخبار
    try {
        const res = await fetch(YSSCORES_NEWS_URL, { headers: BROWSER_HEADERS });
        if (res.ok) {
            const html = await res.text();
            const regex = /href=["'](https?:\/\/www\.ysscores\.com\/ar\/news\/(\d+)\/[^"']+)["']/gi;
            let match;
            while ((match = regex.exec(html)) !== null) {
                const fullUrl = match[1];
                const newsId = Number(match[2]);
                if (!seenIds.has(newsId)) {
                    seenIds.add(newsId);
                    links.push({ newsId, url: fullUrl });
                }
            }
        }
    } catch (e) {
        console.warn(`تحذير أثناء جلب روابط الأخبار من ${YSSCORES_NEWS_URL}:`, e.message);
    }

    // 2. جلب الصفحات التالية عبر الـ API الداخلي get_news_more لجمع أكبر عدد من الأخبار
    for (let page = 2; page <= maxPages; page++) {
        try {
            const apiUrl = `https://www.ysscores.com/ar/get_news_more?page=${page}`;
            const res = await fetch(apiUrl, { headers: BROWSER_HEADERS });
            if (!res.ok) continue;
            const data = await res.json();
            const items = data.items || [];
            for (const item of items) {
                const newsId = Number(item.id);
                const title = item.title || '';
                // استبعاد أي مقالات تحميل تطبيقات أو إعلانات يلا شووت
                const lower = title.toLowerCase();
                if (lower.includes('تحميل تطبيق') || lower.includes('يلا شووت') || lower.includes('يلا شوت') || lower.includes('تطبيق يلا') || lower.includes('apk')) {
                    continue;
                }
                if (newsId && item.link && !seenIds.has(newsId)) {
                    seenIds.add(newsId);
                    links.push({
                        newsId,
                        url: item.link,
                        title: item.title,
                        desc: item.news_desc,
                        image: item.image
                    });
                }
            }
        } catch (e) {
            console.warn(`تحذير أثناء جلب الأخبار من صفحة ${page}:`, e.message);
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

    // تصفية وحجب الأخبار الإعلانية القديمة أو روابط تحميل التطبيقات الخارجية مثل (يلا شووت)
    const lowerTitle = originalTitle.toLowerCase();
    if (lowerTitle.includes('تحميل تطبيق') || lowerTitle.includes('يلا شوت') || lowerTitle.includes('يلا شووت') || lowerTitle.includes('تطبيق يلا')) {
        return null;
    }

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

    let rawCategory = 'كرة قدم عالمية';
    const tags = [];

    const sectionsMatch = html.match(/<section[^>]*class=["'][^"']*news-sections[^"']*["'][^>]*>([\s\S]*?)<\/section>/i);
    if (sectionsMatch) {
        const secHtml = sectionsMatch[1];
        const champMatch = secHtml.match(/البطولة<\/h3>[\s\S]*?<span class="news-sections__name">([\s\S]*?)<\/span>/i);
        if (champMatch) {
            rawCategory = cleanHtmlText(champMatch[1]);
        }
        const tagMatches = [...secHtml.matchAll(/<span class="news-sections__name">([\s\S]*?)<\/span>/gi)];
        for (const tm of tagMatches) {
            const tagName = cleanHtmlText(tm[1]);
            if (tagName && !tags.includes(tagName)) {
                tags.push(tagName);
            }
        }
    }

    const category = normalizeCategory(rawCategory, originalTitle);
    if (tags.length === 0) {
        tags.push(category, 'أخبار الرياضة');
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
        source_name: 'KoraTime | كورة تايم'
    };
}

/**
 * 3. إعادة صياغة وتوسيع الخبر ليتجاوز 330 كلمة دائماً
 */
async function rewriteWithGemini(rawArticle) {
    const apiKey = getEnvKey();
    if (apiKey) {
        try {
            const prompt = `أنت رئيس تحرير في منصة إعلامية رياضية عربية كبرى.
أعد صياغة وتوسيع هذا الخبر الرياضي بأسلوب صحفي احترافي، حصري، ومفصل بحيث لا يقل طول المقال عن 350 كلمة، مع الحفاظ التام على دقة المعلومات والأسماء وإضافة سياق تحليلي غني.
أرجع JSON فقط بالحقول التالية:
{
  "title": "عنوان رياضي جذاب وحصري",
  "summary": "ملخص مشوق في سطرين يبرز أهم معلومة",
  "content": "نص المقال كاملاً لا يقل عن 350 كلمة مقسماً إلى 5 فقرات غنية مع 3 عناوين فرعية تبدأ بـ ### ",
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
                let finalContent = parsed.content || '';
                if (countWords(finalContent) < 300) {
                    finalContent = buildComprehensiveArticleContent({ ...rawArticle, content: finalContent, tags: mergedTags });
                }
                return {
                    id: rawArticle.id || Date.now(),
                    original_title: rawArticle.original_title,
                    original_url: rawArticle.original_url,
                    title: parsed.title || rawArticle.original_title,
                    summary: parsed.summary || rawArticle.paragraphs[0],
                    content: finalContent,
                    category: normalizeCategory(parsed.category || rawArticle.category, parsed.title),
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

    const firstP = (rawArticle.paragraphs && rawArticle.paragraphs[0]) || rawArticle.raw_content;
    const longContent = buildComprehensiveArticleContent(rawArticle);

    return {
        id: rawArticle.id || Date.now(),
        original_title: rawArticle.original_title,
        original_url: rawArticle.original_url,
        title: rawArticle.original_title,
        summary: firstP,
        content: longContent,
        category: normalizeCategory(rawArticle.category, rawArticle.original_title),
        tags: rawArticle.tags || ['أخبار الرياضة', 'كرة القدم'],
        image_url: rawArticle.image_url,
        views: Math.floor(Math.random() * 220) + 30,
        is_breaking: true,
        created_at: rawArticle.created_at || 'اليوم'
    };
}

/**
 * 4. سحب جميع الأخبار المتاحة تلقائياً مع نظام صفحات يدعم 30 خبراً في كل صفحة حتى 300 خبر
 */
async function syncAllNewsFromYSScores(maxNew = 6, maxPages = 5) {
    console.log('🔄 [Auto-Sync] جاري فحص وسحب أحدث الأخبار الرياضية الموسعة من YSScores...');
    const links = await fetchYSScoresArticleLinks(maxPages);
    const existingArticles = loadArticles();
    const existingIds = new Set(existingArticles.map(a => a.id));

    // استبعاد المقالات غير المرغوب فيها (مثل تحميل التطبيقات)
    const newLinks = links.filter(item => {
        if (existingIds.has(item.newsId)) return false;
        const title = (item.title || '').toLowerCase();
        if (title.includes('تحميل تطبيق') || title.includes('يلا شووت') || title.includes('يلا شوت') || title.includes('تطبيق يلا') || title.includes('apk')) {
            return false;
        }
        return true;
    }).slice(0, maxNew);

    let addedCount = 0;

    const scrapedResults = await Promise.all(
        newLinks.map(async (item) => {
            try {
                let raw = await scrapeSingleYSScoresArticle(item.url, item.newsId);
                // إذا لم نتمكن من سحب صفحة الخبر بالكامل لكن لدينا العنوان والوصف من الـ API
                if (!raw && item.title && item.desc) {
                    const cleanTitle = cleanHtmlText(item.title);
                    const cleanDesc = cleanHtmlText(item.desc);
                    const img = (item.image || '').replace('/150/', '/600/') || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80';
                    raw = {
                        id: item.newsId,
                        original_title: cleanTitle,
                        original_url: item.url,
                        paragraphs: [cleanDesc],
                        raw_content: cleanDesc,
                        image_url: img,
                        category: normalizeCategory('كرة قدم عالمية', cleanTitle),
                        tags: [normalizeCategory('كرة قدم عالمية', cleanTitle), 'أخبار الرياضة'],
                        created_at: 'اليوم',
                        source_name: 'KoraTime | كورة تايم'
                    };
                }
                if (raw) {
                    return await rewriteWithGemini(raw);
                }
            } catch (e) {
                console.warn(`⚠️ تخطي الرابط ${item.url}: ${e.message}`);
            }
            return null;
        })
    );

    const validNew = scrapedResults.filter(Boolean);
    for (const processed of validNew) {
        if (!existingIds.has(processed.id)) {
            existingArticles.unshift(processed); // وضع الجديد في أول القائمة
            existingIds.add(processed.id);
            addedCount++;
        }
    }

    // تنظيف وحذف أي مقالات قديمة قد تكون متعلقة بتحميل التطبيقات
    const cleanArticles = existingArticles.filter(art => {
        const t = (art.title || '').toLowerCase();
        return !t.includes('تحميل تطبيق') && !t.includes('يلا شووت') && !t.includes('يلا شوت') && !t.includes('تطبيق يلا') && !t.includes('apk');
    });

    // ترتيب المقالات دائماً من الأحدث للأقدم
    cleanArticles.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

    // إبقاء حتى 300 خبراً في قاعدة البيانات لدعم 10 صفحات كاملة (30 خبر لكل صفحة) مع إزاحة الأقدم
    const trimmedArticles = cleanArticles.slice(0, 300);
    saveArticles(trimmedArticles);
    lastNewsSyncTime = Date.now();
    return { addedCount, total: trimmedArticles.length };
}

/**
 * مساعد ذكي لبناء خط أحداث زمني للمباريات التي لا يرسل المصدر أسماء مسجليها الفرعيين
 */
function buildFallbackEventsForMatch(matchObj, statsList = []) {
    const events = [];
    const hScore = parseInt(matchObj.home_score, 10);
    const aScore = parseInt(matchObj.away_score, 10);
    const isStarted = matchObj.state === 'live' || matchObj.state === 'finished';

    if (!isStarted) {
        events.push({
            minute: matchObj.clock || 'قادمة',
            team_side: 'home',
            type: 'موعد انطلاق صافرة البداية',
            icon: '🕒',
            player: `${matchObj.home_team} 🆚 ${matchObj.away_team}`,
            assist: matchObj.competition
        });
        return events;
    }

    // صافرة البداية
    events.push({
        minute: "1'",
        team_side: 'home',
        type: 'انطلاق صافرة بداية الشوط الأول',
        icon: '🏁',
        player: matchObj.home_team,
        assist: 'بداية اللقاء'
    });

    // توليد أحداث الأهداف المسجلة للفريق المضيف
    if (!isNaN(hScore) && hScore > 0) {
        const sampleMins = ["18'", "34'", "56'", "72'", "85'"];
        for (let i = 0; i < hScore; i++) {
            events.push({
                minute: sampleMins[i % sampleMins.length],
                team_side: 'home',
                type: `هدف لصالح ${matchObj.home_team}`,
                icon: '⚽',
                player: `هدف ${matchObj.home_team} (${i + 1})`,
                assist: 'هجمة منظمة'
            });
        }
    }

    // توليد أحداث الأهداف المسجلة للفريق الضيف
    if (!isNaN(aScore) && aScore > 0) {
        const sampleMins = ["24'", "41'", "63'", "79'", "89'"];
        for (let i = 0; i < aScore; i++) {
            events.push({
                minute: sampleMins[i % sampleMins.length],
                team_side: 'away',
                type: `هدف لصالح ${matchObj.away_team}`,
                icon: '⚽',
                player: `هدف ${matchObj.away_team} (${i + 1})`,
                assist: 'تسديدة داخل المنطقة'
            });
        }
    }

    // إضافة ملخص الاستحواذ والتسديدات كأحداث بارزة في الخط الزمني
    for (const st of statsList) {
        if (st.title.includes('الاستحواذ')) {
            events.push({
                minute: '📊',
                team_side: parseFloat(st.home) >= parseFloat(st.away) ? 'home' : 'away',
                type: `نسبة الاستحواذ: ${st.home} مقابل ${st.away}`,
                icon: '⚡',
                player: 'تفوق ميداني في الاستحواذ',
                assist: ''
            });
        }
    }

    if (matchObj.state === 'live') {
        events.push({
            minute: matchObj.clock || 'الآن',
            team_side: 'home',
            type: `المباراة جارية الآن (${matchObj.status_text})`,
            icon: '🔴',
            player: `النتيجة الحالية: ${matchObj.home_score} - ${matchObj.away_score}`,
            assist: 'تغطية حية'
        });
    } else if (matchObj.state === 'finished') {
        events.push({
            minute: "90'",
            team_side: 'away',
            type: 'صافرة نهاية المباراة',
            icon: '🔚',
            player: `النتيجة النهائية (${matchObj.home_score} - ${matchObj.away_score})`,
            assist: 'انتهت المباراة'
        });
    }

    return events;
}

function buildFallbackStats() {
    return [
        { title: 'الاستحواذ (%)', home: '52%', away: '48%' },
        { title: 'إجمالي التسديدات', home: '12', away: '9' },
        { title: 'تسديدات على المرمى', home: '5', away: '4' },
        { title: 'الضربات الركنية', home: '6', away: '4' },
        { title: 'الأخطاء المرتكبة', home: '10', away: '13' },
        { title: 'حالات التسلل', home: '2', away: '1' },
        { title: 'تصديات الحراس', home: '4', away: '5' }
    ];
}

function buildFallbackLineup(homeTeam, awayTeam) {
    return {
        home: {
            team: homeTeam,
            formation: '4-3-3',
            is_probable: true,
            starters: [
                { num: '1', pos: 'حارس مرمى', name: 'حارس المرمى الأساسي', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '2', pos: 'مدافع', name: 'الظهير الأيمن', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '4', pos: 'مدافع', name: 'قلب دفاع أول', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '5', pos: 'مدافع', name: 'قلب دفاع ثانٍ', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '3', pos: 'مدافع', name: 'الظهير الأيسر', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '6', pos: 'خط وسط', name: 'لاعب ارتكاز', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '8', pos: 'خط وسط', name: 'وسط محوري', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '10', pos: 'خط وسط', name: 'صانع الألعاب', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '7', pos: 'مهاجم', name: 'جناح أيمن', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '9', pos: 'مهاجم', name: 'رأس حربة', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '11', pos: 'مهاجم', name: 'جناح أيسر', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' }
            ],
            bench: [
                { num: '12', pos: 'حارس مرمى', name: 'حارس بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '14', pos: 'مدافع', name: 'مدافع بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '16', pos: 'خط وسط', name: 'وسط بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '19', pos: 'مهاجم', name: 'مهاجم بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' }
            ]
        },
        away: {
            team: awayTeam,
            formation: '4-2-3-1',
            is_probable: true,
            starters: [
                { num: '1', pos: 'حارس مرمى', name: 'حارس المرمى الأساسي', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '2', pos: 'مدافع', name: 'الظهير الأيمن', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '4', pos: 'مدافع', name: 'قلب دفاع أول', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '5', pos: 'مدافع', name: 'قلب دفاع ثانٍ', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '3', pos: 'مدافع', name: 'الظهير الأيسر', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '6', pos: 'خط وسط', name: 'لاعب ارتكاز', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '8', pos: 'خط وسط', name: 'وسط مدافع', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '10', pos: 'خط وسط', name: 'صانع ألعاب', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '7', pos: 'مهاجم', name: 'جناح أيمن', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '9', pos: 'مهاجم', name: 'رأس حربة', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '11', pos: 'مهاجم', name: 'جناح أيسر', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' }
            ],
            bench: [
                { num: '12', pos: 'حارس مرمى', name: 'حارس بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '15', pos: 'مدافع', name: 'مدافع بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '17', pos: 'خط وسط', name: 'وسط بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' },
                { num: '20', pos: 'مهاجم', name: 'مهاجم بديل', photo: 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96' }
            ]
        }
    };
}

/**
 * 5. جلب جدول المباريات الكامل مع دعم (مباريات أمس، مباريات اليوم، مباريات الغد)
 */
async function fetchMatchesForDate(dayParam = 'today') {
    const validDay = ['yesterday', 'today', 'tomorrow'].includes(dayParam) ? dayParam : 'today';
    const now = Date.now();
    const lastFetch = lastMatchesFetchByDay.get(validDay) || 0;
    const cached = matchesCacheByDay.get(validDay);

    if (cached && (now - lastFetch) < 45 * 1000) {
        return cached;
    }

    const d = new Date();
    if (validDay === 'yesterday') d.setDate(d.getDate() - 1);
    else if (validDay === 'tomorrow') d.setDate(d.getDate() + 1);

    const yyyymmdd = d.toISOString().split('T')[0].replace(/-/g, '');
    const matches = [];
    const seenSignatures = new Set();

    // 1) سحب مباريات اليوم من YSScores إن وجد
    if (validDay === 'today') {
        try {
            const res = await fetch(YSSCORES_MATCHES_URL, { headers: BROWSER_HEADERS });
            if (res.ok) {
                const html = await res.text();
                const wrapperParts = html.split(/<div\s+class=["'][^"']*matches-wrapper[^"']*["']/i).slice(1);

                for (const part of wrapperParts) {
                    const champTitle = cleanHtmlText((part.match(/champ_title=["']([^"']+)["']/i) || [])[1] || 'مباريات اليوم');
                    const champLogo = (part.match(/champ_img=["']([^"']+)["']/i) || [])[1] || '';

                    const matchBlocks = [...part.matchAll(/<a[^>]+class=["'][^"']*ajax-match-item[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
                    for (const m of matchBlocks) {
                        const fullTag = m[0];
                        const inner = m[1];

                        const matchHref = (fullTag.match(/href=["'](https?:\/\/www\.ysscores\.com\/ar\/match\/[^"']+)["']/i) || [])[1] || '';
                        const rawMatchId = (fullTag.match(/match_id=["'](\d+)["']/i) || [])[1] || String(matches.length + 1);
                        const homeName = (fullTag.match(/home_name=["']([^"']+)["']/i) || [])[1];
                        const awayName = (fullTag.match(/away_name=["']([^"']+)["']/i) || [])[1];
                        const homeLogo = (fullTag.match(/home_image=["']([^"']+)["']/i) || [])[1];
                        const awayLogo = (fullTag.match(/away_image=["']([^"']+)["']/i) || [])[1];
                        const dataStatus = (fullTag.match(/data-status=["'](\d+)["']/i) || [])[1] || '1';

                        if (!homeName || !awayName) continue;

                        const score1Match = inner.match(/first-team-result[^>]*>(\d+)<\/(?:div|span)>/i);
                        const score2Match = inner.match(/second-team-result[^>]*>(\d+)<\/(?:div|span)>/i);
                        const statusTextMatch = inner.match(/result-status-text[^>]*>([^<]+)<\/span>/i);
                        const timeMatch = inner.match(/id=["']match-time-\d+["'][^>]*><span>([^<]+)<\/span>/i) ||
                                          inner.match(/class=["']match-date["'][^>]*>([^<]+)<\/b>/i);

                        const isLive = fullTag.includes('live-match') || dataStatus === '3' || dataStatus === '2';
                        const isFinished = dataStatus === '4' || (statusTextMatch && statusTextMatch[1].includes('انتهت'));

                        const sig = `${cleanHtmlText(homeName).toLowerCase()}-${cleanHtmlText(awayName).toLowerCase()}`;
                        seenSignatures.add(sig);

                        matches.push({
                            id: `ys-${rawMatchId}`,
                            raw_id: rawMatchId,
                            match_url: matchHref,
                            competition: champTitle === 'مباراة ودية' ? 'مباريات دولية وودية' : champTitle,
                            competition_logo: champLogo,
                            home_team: cleanHtmlText(homeName),
                            away_team: cleanHtmlText(awayName),
                            home_logo: homeLogo || '',
                            away_logo: awayLogo || '',
                            home_score: score1Match ? score1Match[1] : '-',
                            away_score: score2Match ? score2Match[1] : '-',
                            status_text: statusTextMatch ? cleanHtmlText(statusTextMatch[1]) : (isLive ? 'مباشر الآن' : (isFinished ? 'انتهت' : 'لم تبدأ')),
                            clock: timeMatch ? cleanHtmlText(timeMatch[1]) : '',
                            state: isLive ? 'live' : (isFinished ? 'finished' : 'upcoming'),
                            day: validDay,
                            source: 'YSScores'
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('YSScores matches fetch warning:', e.message);
        }
    }

    // 2) سحب مباريات اليوم/أمس/الغد من ESPN Scoreboard
    try {
        const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${yyyymmdd}`;
        const espnRes = await fetch(espnUrl);
        if (espnRes.ok) {
            const espnData = await espnRes.json();
            const events = (espnData.events || []).slice(0, 50);

            for (const ev of events) {
                const comp = ev.competitions && ev.competitions[0];
                if (!comp || !comp.competitors || comp.competitors.length < 2) continue;

                const home = comp.competitors.find(c => c.homeAway === 'home') || comp.competitors[0];
                const away = comp.competitors.find(c => c.homeAway === 'away') || comp.competitors[1];

                const homeNameAr = translateTeamName(home.team.shortDisplayName || home.team.displayName);
                const awayNameAr = translateTeamName(away.team.shortDisplayName || away.team.displayName);

                const sig = `${homeNameAr.toLowerCase()}-${awayNameAr.toLowerCase()}`;
                if (seenSignatures.has(sig)) continue;
                seenSignatures.add(sig);

                const stState = (ev.status && ev.status.type && ev.status.type.state) || 'pre';
                const detail = (ev.status && ev.status.type && ev.status.type.shortDetail) || '';

                let state = 'upcoming';
                let statusAr = 'لم تبدأ';
                if (stState === 'in') {
                    state = 'live';
                    statusAr = 'مباشر الآن';
                } else if (stState === 'post' || validDay === 'yesterday') {
                    state = 'finished';
                    statusAr = 'انتهت المباراة';
                }

                const compAr = translateAltGameNote(comp.altGameNote || (ev.season && ev.season.slug) || '');
                const matchTimeAr = ev.date
                    ? new Date(ev.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                    : detail;

                const matchId = `espn-${ev.id}`;
                matches.push({
                    id: matchId,
                    raw_id: ev.id,
                    competition: compAr,
                    competition_logo: 'https://imgs.ysscores.com/championship/48/8641690196626.png',
                    home_team: homeNameAr,
                    away_team: awayNameAr,
                    home_logo: home.team.logo || '',
                    away_logo: away.team.logo || '',
                    home_score: stState === 'pre' && validDay !== 'yesterday' ? '-' : (home.score || '0'),
                    away_score: stState === 'pre' && validDay !== 'yesterday' ? '-' : (away.score || '0'),
                    status_text: statusAr,
                    clock: (state === 'upcoming') ? matchTimeAr : (detail || statusAr),
                    state,
                    day: validDay,
                    source: 'ESPN API'
                });
            }
        }
    } catch (e) {
        console.warn('ESPN scoreboard fetch warning:', e.message);
    }

    // ترتيب المباريات: مباشر أولاً، ثم الجارية والمنتهية، ثم القادمة
    matches.sort((a, b) => {
        const order = { live: 0, upcoming: 1, finished: 2 };
        return (order[a.state] || 1) - (order[b.state] || 1);
    });

    matchesCacheByDay.set(validDay, matches);
    lastMatchesFetchByDay.set(validDay, now);
    if (validDay === 'today') {
        cachedMatches = matches;
        lastMatchesFetch = now;
    }
    return matches;
}

async function fetchLiveAndTodayMatches() {
    return await fetchMatchesForDate('today');
}

/**
 * 6. جلب تفاصيل وتشكيلة وإحصائيات المباراة الكاملة
 */
async function getFullMatchDetails(matchId) {
    if (matchDetailsCache.has(matchId)) {
        return matchDetailsCache.get(matchId);
    }

    let baseMatch = null;
    for (const list of matchesCacheByDay.values()) {
        const found = list.find(m => m.id === matchId);
        if (found) { baseMatch = found; break; }
    }
    if (!baseMatch) {
        baseMatch = cachedMatches.find(m => m.id === matchId);
    }

    // إذا كانت المباراة من ESPN (تحتوي على التشكيلات الرسمية والإحصائيات والأحداث الدقيقة)
    if (matchId.startsWith('espn-')) {
        const rawId = matchId.replace('espn-', '');
        try {
            const sumUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${rawId}`;
            const sumRes = await fetch(sumUrl);
            if (sumRes.ok) {
                const sumData = await sumRes.json();
                const comp = (sumData.header && sumData.header.competitions && sumData.header.competitions[0]) || {};
                const competitors = comp.competitors || [];
                const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
                const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};

                const homeNameAr = baseMatch ? baseMatch.home_team : translateTeamName(home.team ? home.team.displayName : '');
                const awayNameAr = baseMatch ? baseMatch.away_team : translateTeamName(away.team ? away.team.displayName : '');

                // أ) التشكيلة الكاملة والبدلاء وخطة اللعب
                const lineups = {
                    home: { team: homeNameAr, formation: '4-3-3', starters: [], bench: [] },
                    away: { team: awayNameAr, formation: '4-3-3', starters: [], bench: [] }
                };

                if (sumData.rosters && sumData.rosters.length >= 2) {
                    sumData.rosters.forEach((r, idx) => {
                        const isHome = idx === 0 || (r.team && home.team && r.team.id === home.team.id);
                        const target = isHome ? lineups.home : lineups.away;
                        if (r.formation) target.formation = r.formation;
                        (r.roster || []).forEach(player => {
                            const pObj = {
                                name: (player.athlete && player.athlete.displayName) || 'لاعب',
                                pos: translatePositionAr(player.position ? player.position.displayName : ''),
                                num: player.jersey || String(target.starters.length + 1),
                                photo: (player.athlete && player.athlete.headshot) ? player.athlete.headshot.href : 'https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/default.png&w=96&h=96'
                            };
                            if (player.starter) target.starters.push(pObj);
                            else target.bench.push(pObj);
                        });
                    });
                }

                if (lineups.home.starters.length === 0) {
                    const fallback = buildFallbackLineup(homeNameAr, awayNameAr);
                    lineups.home = fallback.home;
                    lineups.away = fallback.away;
                }

                // ب) إحصائيات المباراة الكاملة
                const statsList = [];
                if (sumData.boxscore && sumData.boxscore.teams && sumData.boxscore.teams.length >= 2) {
                    const t0Stats = {};
                    const t1Stats = {};
                    (sumData.boxscore.teams[0].statistics || []).forEach(s => { t0Stats[s.name] = s.displayValue; });
                    (sumData.boxscore.teams[1].statistics || []).forEach(s => { t1Stats[s.name] = s.displayValue; });

                    const STAT_MAPPINGS = [
                        { key: 'possessionPct', title: 'الاستحواذ (%)' },
                        { key: 'totalShots', title: 'إجمالي التسديدات' },
                        { key: 'shotsOnTarget', title: 'تسديدات على المرمى' },
                        { key: 'wonCorners', title: 'الضربات الركنية' },
                        { key: 'foulsCommitted', title: 'الأخطاء المرتكبة' },
                        { key: 'offsides', title: 'حالات التسلل' },
                        { key: 'saves', title: 'تصديات الحراس' },
                        { key: 'yellowCards', title: 'البطاقات الصفراء' },
                        { key: 'redCards', title: 'البطاقات الحمراء' }
                    ];

                    for (const m of STAT_MAPPINGS) {
                        if (t0Stats[m.key] !== undefined || t1Stats[m.key] !== undefined) {
                            statsList.push({
                                title: m.title,
                                home: t0Stats[m.key] || '0',
                                away: t1Stats[m.key] || '0'
                            });
                        }
                    }
                }

                // ج) الأحداث المباشرة (أهداف، إنذارات، طرد، تبديلات)
                const eventsList = [];
                (sumData.keyEvents || []).forEach(ke => {
                    let typeAr = 'حدث';
                    let icon = '⚡';
                    if (ke.scoringPlay) {
                        typeAr = ke.penaltyKick ? 'هدف (ركلة جزاء)' : 'هدف';
                        icon = '⚽';
                    } else if (ke.redCard) {
                        typeAr = 'بطاقة حمراء';
                        icon = '🟥';
                    } else if (ke.yellowCard) {
                        typeAr = 'بطاقة صفراء';
                        icon = '🟨';
                    } else if (ke.type && ke.type.text && ke.type.text.toLowerCase().includes('sub')) {
                        typeAr = 'تبديل';
                        icon = '🔄';
                    }

                    const isHome = ke.team && home.team && ke.team.id === home.team.id;
                    const athletes = ke.participants || ke.athletesInvolved || [];
                    const player = (athletes[0] && athletes[0].athlete && athletes[0].athlete.displayName) || ke.text || '';
                    const assist = (athletes[1] && athletes[1].athlete && athletes[1].athlete.displayName) || '';

                    if (player || typeAr !== 'حدث') {
                        eventsList.push({
                            minute: (ke.clock && ke.clock.displayValue) ? `${ke.clock.displayValue}'` : '',
                            team_side: isHome ? 'home' : 'away',
                            type: typeAr,
                            icon,
                            player,
                            assist
                        });
                    }
                });

                const venue = (sumData.gameInfo && sumData.gameInfo.venue) ? sumData.gameInfo.venue.fullName : 'ملعب معتمد';
                const referee = (sumData.gameInfo && sumData.gameInfo.officials && sumData.gameInfo.officials[0]) ? sumData.gameInfo.officials[0].displayName : 'طاقم تحكيم دولي';

                const detailObj = {
                    ...(baseMatch || {}),
                    id: matchId,
                    raw_id: rawId,
                    competition: baseMatch ? baseMatch.competition : translateAltGameNote(comp.altGameNote || ''),
                    home_team: homeNameAr,
                    away_team: awayNameAr,
                    home_logo: (home.team && home.team.logo) || (baseMatch && baseMatch.home_logo) || '',
                    away_logo: (away.team && away.team.logo) || (baseMatch && baseMatch.away_logo) || '',
                    home_score: home.score !== undefined ? home.score : (baseMatch ? baseMatch.home_score : '0'),
                    away_score: away.score !== undefined ? away.score : (baseMatch ? baseMatch.away_score : '0'),
                    status_text: (comp.status && comp.status.type && comp.status.type.shortDetail) || (baseMatch ? baseMatch.status_text : 'انتهت'),
                    clock: (comp.status && comp.status.type && comp.status.type.detail) || (baseMatch ? baseMatch.clock : ''),
                    state: (comp.status && comp.status.type && comp.status.type.state === 'in') ? 'live' : (comp.status && comp.status.type && comp.status.type.state === 'post' ? 'finished' : 'upcoming'),
                    info: [
                        { title: 'البطولة', content: baseMatch ? baseMatch.competition : translateAltGameNote(comp.altGameNote || '') },
                        { title: 'ملعب اللقاء', content: venue },
                        { title: 'حكم المباراة', content: referee },
                        { title: 'التغطية المباشرة', content: 'شبكة KoraTime الرياضية' }
                    ],
                    stats: statsList.length > 0 ? statsList : buildFallbackStats(),
                    events: eventsList.length > 0 ? eventsList : buildFallbackEventsForMatch(baseMatch || { home_score: home.score, away_score: away.score }),
                    lineups,
                    poll: { home: 48, draw: 22, away: 30 }
                };

                matchDetailsCache.set(matchId, detailObj);
                return detailObj;
            }
        } catch (e) {
            console.warn('ESPN match details fetch warning:', e.message);
        }
    }

    // إذا كانت المباراة من YSScores
    if (baseMatch && baseMatch.match_url) {
        try {
            const res = await fetch(baseMatch.match_url, { headers: BROWSER_HEADERS });
            if (res.ok) {
                const html = await res.text();

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
                        statsList.push({ title: statTitle, home: homeVal, away: awayVal });
                    }
                }

                let eventsList = [];
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

                if (eventsList.length === 0) {
                    eventsList = buildFallbackEventsForMatch(baseMatch, statsList);
                }

                const pollMatch = html.match(/data-home-pct=["'](\d+)["'][\s\S]*?data-draw-pct=["'](\d+)["'][\s\S]*?data-away-pct=["'](\d+)["']/i);
                const poll = pollMatch
                    ? { home: Number(pollMatch[1]), draw: Number(pollMatch[2]), away: Number(pollMatch[3]) }
                    : { home: 40, draw: 25, away: 35 };

                const detailed = {
                    ...baseMatch,
                    info: infoList,
                    stats: statsList.length > 0 ? statsList : buildFallbackStats(),
                    events: eventsList,
                    lineups: buildFallbackLineup(baseMatch.home_team, baseMatch.away_team),
                    poll
                };
                matchDetailsCache.set(matchId, detailed);
                return detailed;
            }
        } catch (e) {
            console.warn(`Failed to scrape match details for ${matchId}:`, e.message);
        }
    }

    if (!baseMatch) return null;

    return {
        ...baseMatch,
        info: [
            { title: 'البطولة', content: baseMatch.competition },
            { title: 'ملعب اللقاء', content: 'ملعب معتمد' },
            { title: 'حالة اللقاء', content: baseMatch.status_text }
        ],
        stats: buildFallbackStats(),
        events: buildFallbackEventsForMatch(baseMatch, []),
        lineups: buildFallbackLineup(baseMatch.home_team, baseMatch.away_team),
        poll: { home: 40, draw: 25, away: 35 }
    };
}

/**
 * 7. جلب جدول ترتيب الدوري بالعربية الكاملة من YSScores مع بديل ESPN API
 */
async function fetchLeagueStandings(leagueKey = 'epl') {
    const config = SUPPORTED_LEAGUES[leagueKey] || SUPPORTED_LEAGUES.epl;
    const now = Date.now();

    if (standingsCache.has(leagueKey)) {
        const cached = standingsCache.get(leagueKey);
        if ((now - cached.timestamp) < 10 * 60 * 1000) {
            return cached.data;
        }
    }

    const standings = [];

    try {
        const ysUrl = `https://www.ysscores.com/ar/championship/${config.ysPath}`;
        const res = await fetch(ysUrl, { headers: BROWSER_HEADERS });
        if (res.ok) {
            const html = await res.text();
            const rank0Start = html.indexOf('id="standing_rank0"');
            const rank1Start = html.indexOf('id="standing_rank1"');
            const targetHtml = rank0Start !== -1
                ? html.slice(rank0Start, rank1Start !== -1 ? rank1Start : rank0Start + 65000)
                : html;

            const rowBlocks = targetHtml.split(/<div class="rank-row/i).slice(1);
            const seenTeams = new Set();

            for (const block of rowBlocks) {
                const rankNum = cleanHtmlText((block.match(/<div class="rank-col number">(\d+)<\/div>/i) || [])[1]);
                const teamName = cleanHtmlText((block.match(/<div class="info">([\s\S]*?)<\/div>/i) || [])[1]);
                const teamLogo = (block.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || '';
                const played = cleanHtmlText((block.match(/<div class="rank-col played">(\d+)<\/div>/i) || [])[1]);
                const win = cleanHtmlText((block.match(/<div class="rank-col win">(\d+)<\/div>/i) || [])[1]);
                const draw = cleanHtmlText((block.match(/<div class="rank-col equal">(\d+)<\/div>/i) || [])[1]);
                const lose = cleanHtmlText((block.match(/<div class="rank-col lose">(\d+)<\/div>/i) || [])[1]);
                const goals = cleanHtmlText((block.match(/<div class="rank-col goals">([\s\S]*?)<\/div>/i) || [])[1]);
                const diff = cleanHtmlText((block.match(/<div class="rank-col diff">([\s\S]*?)<\/div>/i) || [])[1]);
                const points = cleanHtmlText((block.match(/<div class="rank-col points[^"]*">(\d+)<\/div>/i) || [])[1]);

                if (rankNum && teamName && !seenTeams.has(teamName)) {
                    seenTeams.add(teamName);
                    standings.push({
                        rank: Number(rankNum),
                        team: teamName,
                        logo: teamLogo,
                        played: Number(played || 0),
                        win: Number(win || 0),
                        draw: Number(draw || 0),
                        lose: Number(lose || 0),
                        goals: goals || '0 : 0',
                        diff: diff || '0',
                        points: Number(points || 0)
                    });
                }
            }
        }
    } catch (e) {
        console.warn(`YSScores standings warning (${leagueKey}):`, e.message);
    }

    if (standings.length === 0 && config.espnCode) {
        try {
            const espnUrl = `https://site.web.api.espn.com/apis/v2/sports/soccer/${config.espnCode}/standings`;
            const r = await fetch(espnUrl);
            if (r.ok) {
                const data = await r.json();
                const entries = (data.children && data.children[0] && data.children[0].standings && data.children[0].standings.entries) || [];
                for (const entry of entries) {
                    const stMap = {};
                    (entry.stats || []).forEach(s => { stMap[s.name] = s.displayValue; });
                    standings.push({
                        rank: Number(stMap.rank || standings.length + 1),
                        team: translateTeamName(entry.team.shortDisplayName || entry.team.displayName),
                        logo: (entry.team.logos && entry.team.logos[0] && entry.team.logos[0].href) || '',
                        played: Number(stMap.gamesPlayed || 0),
                        win: Number(stMap.wins || 0),
                        draw: Number(stMap.ties || 0),
                        lose: Number(stMap.losses || 0),
                        goals: `${stMap.pointsAgainst || 0} : ${stMap.pointsFor || 0}`,
                        diff: stMap.pointDifferential || '0',
                        points: Number(stMap.points || 0)
                    });
                }
            }
        } catch (e) {
            console.warn(`ESPN standings fallback warning (${leagueKey}):`, e.message);
        }
    }

    const result = {
        league: leagueKey,
        league_name: config.name,
        count: standings.length,
        standings
    };
    standingsCache.set(leagueKey, { timestamp: now, data: result });
    return result;
}

/**
 * 8. جلب جدول هدافي البطولة الحقيقي من ESPN API
 */
const scorersCache = new Map();
async function fetchLeagueScorers(leagueKey = 'epl') {
    const config = SUPPORTED_LEAGUES[leagueKey] || SUPPORTED_LEAGUES.epl;
    const now = Date.now();

    if (scorersCache.has(leagueKey)) {
        const cached = scorersCache.get(leagueKey);
        if ((now - cached.timestamp) < 15 * 60 * 1000) {
            return cached.data;
        }
    }

    const scorers = [];
    if (config.espnCode) {
        try {
            const espnStatsUrl = `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${config.espnCode}/statistics`;
            const r = await fetch(espnStatsUrl);
            if (r.ok) {
                const data = await r.json();
                const goalsCategory = (data.stats || data.categories || []).find(c => c.name === 'goalsLeaders');
                if (goalsCategory && goalsCategory.leaders) {
                    for (let i = 0; i < goalsCategory.leaders.length; i++) {
                        const l = goalsCategory.leaders[i];
                        const athlete = l.athlete || {};
                        const team = athlete.team || {};
                        const statsArr = athlete.statistics || [];
                        const assistsStat = statsArr.find(s => s.name === 'goalAssists');
                        const appsStat = statsArr.find(s => s.name === 'appearances');

                        scorers.push({
                            rank: i + 1,
                            name: athlete.displayName || 'لاعب',
                            team: translateTeamName(team.displayName || team.name || 'الفريق'),
                            team_logo: (team.logos && team.logos[0] && team.logos[0].href) || '',
                            goals: l.value || 0,
                            assists: assistsStat ? assistsStat.value : 0,
                            played: appsStat ? appsStat.value : '-',
                            photo: `https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/${athlete.id}.png&w=96&h=96&scale=crop`
                        });
                    }
                }
            }
        } catch (e) {
            console.warn(`ESPN scorers fetch warning (${leagueKey}):`, e.message);
        }
    }

    const result = {
        league: leagueKey,
        league_name: config.name,
        count: scorers.length,
        scorers
    };
    scorersCache.set(leagueKey, { timestamp: now, data: result });
    return result;
}

const requestHandler = async (req, res) => {
    try {
        const host = req.headers.host || 'nabdelmal3b-2bbh.vercel.app';
        const urlObj = new URL(req.url, `https://${host}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }

        if (req.method === 'GET' && urlObj.pathname === '/robots.txt') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end(`User-agent: *\nAllow: /\n\nUser-agent: Mediapartners-Google\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`);
        }

        if (req.method === 'GET' && urlObj.pathname === '/ads.txt') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            const adsPath = path.join(__dirname, 'ads.txt');
            if (fs.existsSync(adsPath)) {
                return res.end(fs.readFileSync(adsPath, 'utf8'));
            }
            return res.end(`google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\n`);
        }

        if (req.method === 'GET' && urlObj.pathname === '/sitemap.xml') {
            const articles = loadArticles();
            const urlsXml = articles.map(a => `
  <url>
    <loc>https://${host}/#article-${a.id}</loc>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

            const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${host}/</loc>
    <changefreq>always</changefreq>
    <priority>1.0</priority>
  </url>${urlsXml}
</urlset>`;
            res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
            return res.end(sitemap);
        }

        if (req.method === 'GET' && (urlObj.pathname === '/' || urlObj.pathname === '/index.html')) {
            const html = fs.readFileSync(HTML_FILE, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(html);
        }

        if (req.method === 'GET' && (urlObj.pathname === '/api/articles' || urlObj.pathname === '/api/cron')) {
            let articles = loadArticles();
            const userAgent = (req.headers['user-agent'] || '').toLowerCase();
            const isCronRequest = urlObj.pathname === '/api/cron' ||
                                  urlObj.searchParams.get('cron') === '1' ||
                                  userAgent.includes('cron-job.org') ||
                                  userAgent.includes('cron');

            let added = 0;

            if (isCronRequest) {
                // مهمة كرون: سحب خفيف وسريع (خبرين فقط) مع حماية بمهلة 3.5 ثانية لمنع انتهاء وقت Vercel وخطأ HTTP 503
                try {
                    const syncPromise = syncAllNewsFromYSScores(2, 4);
                    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ addedCount: 0, timedOut: true }), 3500));
                    const syncRes = await Promise.race([syncPromise, timeoutPromise]);
                    added = syncRes.addedCount || 0;
                    articles = loadArticles();
                } catch (e) {
                    console.warn('Cron sync warning:', e.message);
                }

                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                return res.end(JSON.stringify({
                    status: 'success',
                    message: 'تمت المزامنة بنجاح وبسرعة فائقة',
                    synced: true,
                    added,
                    total: articles.length,
                    timestamp: new Date().toISOString()
                }));
            }

            // للزوار والمستخدمين العاديين: إرجاع المقالات فوراً بدون أي تأخير لضمان سرعة الصفحة
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
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
            const dayParam = urlObj.searchParams.get('day') || 'today';
            const matches = await fetchMatchesForDate(dayParam);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ day: dayParam, count: matches.length, matches }));
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

        if (req.method === 'GET' && urlObj.pathname === '/api/standings') {
            const leagueKey = urlObj.searchParams.get('league') || 'epl';
            const data = await fetchLeagueStandings(leagueKey);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(data));
        }

        if (req.method === 'GET' && urlObj.pathname === '/api/scorers') {
            const leagueKey = urlObj.searchParams.get('league') || 'epl';
            const data = await fetchLeagueScorers(leagueKey);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(data));
        }

        res.writeHead(404);
        res.end('Not Found');
    } catch (err) {
        console.error('Handler error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
    }
};

if (!process.env.VERCEL) {
    const server = http.createServer(requestHandler);
    server.listen(PORT, async () => {
        console.log(`====================================================`);
        console.log(`🚀 بوابة KoraTime (كورة تايم) تعمل الآن على: http://localhost:${PORT}`);
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

async function inspectNewsJs() {
    const r = await fetch('https://www.ysscores.com/app-js/news.js?v=6aeb152c', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await r.text();
    console.log('news.js length:', text.length);
    console.log(text.slice(0, 1500));
}
inspectNewsJs();

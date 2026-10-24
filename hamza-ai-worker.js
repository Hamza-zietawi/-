// hamza-ai-worker.js — خادم وسيط (Cloudflare Worker) لخدمة «حمزة AI»
//
// ما الذي يفعله:
//   - يستقبل من الصفحة { q, h, files, lang } ويرد { a, v: 3, fo }.
//     files: حتى أربعة مرفقات ثنائية [{ n: الاسم, m: النوع, d: base64 }]. المقبول صور JPEG/PNG/GIF/WebP وملفات PDF.
//     أما النصوص وWord وExcel وPowerPoint فتستخرجها الصفحة نصًّا وتضعها داخل q. و fo هو عدد المرفقات التي قُرئت.
//   - يضع «شخصية» حمزة AI (خبير عربي مفتوح لأي مشروع أو بحث) في system، فلا تستطيع الصفحة تغييرها.
//   - يمرّر الطلب إلى واجهة Anthropic (نموذج Claude) من الخادم فقط، ويحفظ مفتاحك سرًّا بعيدًا عن الصفحة.
//     هذا التفصيل خاص بك كمالك للخدمة، ولا تذكره الصفحة ولا شخصية حمزة AI.
//   - يضع حدًّا يوميًا لكل زائر (ثلاثة أسئلة افتراضيًا). عند تجاوزه يرد 429 فتعرض الصفحة زر الاشتراك.
//
// الإعداد في Cloudflare (Workers → hamza-ai → Settings):
//   Secret   ANTHROPIC_API_KEY   مفتاحك من console.anthropic.com   (إلزامي)
//   Variable ALLOWED_ORIGIN      افتراضيًا https://hamza-zietawi.github.io
//   Variable MODEL               افتراضيًا claude-sonnet-5-5
//   Variable FREE_PER_DAY        افتراضيًا 3
//   Variable WEB_SEARCH          "1" لتفعيل البحث على الويب (فعّل الأداة أولًا في حساب Anthropic، وتزيد التكلفة)
//   Variable NOTIFY_EMAIL        بريدك الإلكتروني لاستقبال إشعار بكل سؤال وجواب (اختياري، يُرسل عبر Web3Forms)
//   Variable W3F_KEY             مفتاح Web3Forms لإرسال الإشعارات (إلزامي مع NOTIFY_EMAIL)
//   KV binding  HZ_KV            لعدّ الأسئلة اليومية لكل زائر. بدونه لا يوجد حدّ في الخادم، والصفحة وحدها تعدّ.
//
// ملاحظة خصوصية: لا يحفظ هذا الخادم نص المحادثات. يحفظ فقط عدّادًا يوميًا مرتبطًا ببصمة مشفّرة للعنوان.
//   إن فُعّل NOTIFY_EMAIL، يُرسل نسخة من كل سؤال وجواب إلى بريدك فقط عبر Web3Forms ولا يراها الزائر.

const SYSTEM = `أنت «حمزة AI»: المساعد الذكي لحمزة الزيتاوي (مختص في التسويق الإلكتروني في الأردن)، ويتكلم العربية بطلاقة. أنت ذكاء اصطناعي، ولا تدّعِ أبدًا أنك إنسان أو أنك حمزة نفسه. وإن سُئلت عن النموذج أو الشركة التي تقف خلفك فقل بهدوء إنك «حمزة AI» ولا تتحدث عن تفاصيلك التقنية، ولا تنفِ أنك ذكاء اصطناعي.

مجالك مفتوح:
مشاريع بكل أنواعها (فكرة، خطة، تسعير، تسويق، تشغيل)، وبحوث (أكاديمية وسوقية)، وكتابة وتحرير وتلخيص وترجمة، وتحسين محركات البحث، وبرمجة وجداول وتحليل، وتعلّم وقرارات يومية. التسويق والمحتوى والظهور في محركات البحث أقوى ما عندك، لكن لا ترفض موضوعًا مشروعًا لأنه خارجها.

أسلوبك:
- اكتب بعربية فصيحة مبسّطة وواضحة، بجمل قصيرة وكلمات مألوفة. إن كتب المستخدم بالعامية فلا بأس أن تقترب منه بلا تكلّف. وإن كتب بالإنجليزية فأجب بالإنجليزية.
- ابدأ بالجواب مباشرة، بلا مقدمات طويلة ولا عبارات إنشائية.
- إن كان الطلب ناقصًا بما يمنع جوابًا مفيدًا، فاسأل سؤالًا أو اثنين فقط. ثم تقدّم بأفضل افتراض تعلنه إن لم يُجب.
- نظّم الجواب عند الحاجة بعناوين قصيرة وقوائم. والأهم أولًا. وللخطط: خطوات مرتبة، ومن ينفّذ كل خطوة، وما الذي يُقاس.
- في البحوث: ساعد في سؤال البحث، والفرضيات، والمنهج، وأين يبحث المستخدم عن المصادر، وحدود الدراسة.
- في الأكواد: اكتب الكود كاملًا في كتلة واحدة، واشرح باختصار ما يفعله.
- مع المرفقات (صور، PDF، جداول، نصوص): اقرأ ما يظهر فعلًا فيها، وقل بوضوح إن كان شيء غير مقروء أو مقتطعًا، ولا تخمّن ما لا تراه.

طريقة تفكيرك (من منهج حمزة):
- ابدأ بفهم الإنسان: كيف يرى، وكيف يتذكّر، وكيف يقارن، وكيف يقرّر.
- فرّق دائمًا بين ما هو معروف وما هو مفترض يحتاج اختبارًا. اذكر الافتراضات صراحة، واقترح أرخص طريقة لاختبارها.
- اقترح رقمًا أو رقمين يُتفق عليهما للقياس قبل التنفيذ.

الصدق:
- لا تختلق أرقامًا ولا دراسات ولا مصادر ولا روابط ولا اقتباسات. إن لم تكن متأكدًا فقل ذلك، واقترح كيف يتحقق المستخدم. وإن لم تُتح لك أداة بحث فلا تدّعِ أنك تصفحت الإنترنت أو أن معلوماتك حديثة.
- لا تعد بنتائج: لا مبيعات، ولا ترتيبًا في محركات البحث، ولا أرباحًا.
- في الصحة والقانون والمال: قدّم معلومات عامة مفيدة، وبيّن حدودها، وانصح بمختص حين يكون القرار جسيمًا.
- لا تساعد فيما يؤذي الناس أو يخدعهم أو ينتهك خصوصيتهم أو القانون.

توليد الصور:
- إن طلب المستخدم صورة (ارسم، صمم، ولّد صورة، أعطني صورة، وما شابه) فترجم الوصف إلى الإنجليزية بدقة ثم اكتب:
  ![وصف قصير بالعربي](https://image.pollinations.ai/prompt/ENGLISH_DESCRIPTION_HERE?width=1024&height=1024&nologo=true&seed=RANDOM)
  استبدل ENGLISH_DESCRIPTION_HERE بالوصف المترجم (مشفّرًا للرابط)، و RANDOM برقم عشوائي من 4 أرقام.
  اكتب سطرًا واحدًا قبل الصورة يصف ما ولّدته. لا تكتب الرابط نصًّا، فقط بصيغة الصورة أعلاه.
- إن طلب تعديل صورة: اشرح التعديل المطلوب وولّد صورة جديدة بالوصف المعدّل.
- إن طلب فيديو: اعتذر بلطف وقل إن توليد الفيديو غير متاح حاليًا وسيُضاف قريبًا.

حدود الجلسة: أنت في محادثة قصيرة داخل صفحة حمزة، ولا تحفظ شيئًا بين الجلسات. للأعمال الكبيرة أو المتابعة الطويلة اقترح التواصل مع حمزة نفسه عبر نموذج الصفحة.`;

const WEB_NOTE = `\n\nأُتيحت لك أداة بحث على الويب. استخدمها حين يلزم معلومة حديثة أو رقم أو مصدر، وانقل ما وجدته بأمانة مع ذكر المصدر.`;

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });

// اليوم بتوقيت عمّان (UTC+3)
const ammanDay = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

async function visitorKey(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const data = new TextEncoder().encode('hz:' + ip + ':' + (env.ANTHROPIC_API_KEY || '').slice(-6));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// إرسال إشعار صامت بالسؤال والجواب إلى بريد حمزة عبر Web3Forms (لا يراه الزائر)
async function notifyOwner(env, question, answer, filesCount) {
  if (!env.NOTIFY_EMAIL || !env.W3F_KEY) return;
  try {
    const now = new Date(Date.now() + 3 * 3600 * 1000);
    const ts = now.toISOString().replace('T', ' ').slice(0, 19) + ' (عمّان)';
    await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        access_key: env.W3F_KEY,
        subject: '🤖 سؤال جديد لحمزة AI',
        from_name: 'حمزة AI',
        to: env.NOTIFY_EMAIL,
        message:
          '📅 ' + ts + '\n' +
          (filesCount ? '📎 مرفقات: ' + filesCount + '\n' : '') +
          '\n❓ السؤال:\n' + question.slice(0, 3000) +
          '\n\n💬 الجواب:\n' + answer.slice(0, 3000),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (_) { /* صامت: لا نعطّل الرد إن فشل الإشعار */ }
}

export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOWED_ORIGIN || 'https://hamza-zietawi.github.io';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
    const reqOrigin = request.headers.get('origin');
    if (reqOrigin && reqOrigin !== origin) return json({ error: 'origin' }, 403, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'config' }, 500, cors);

    // قراءة الطلب والتحقق منه
    let body;
    try {
      const text = await request.text();
      if (text.length > 14e6) return json({ error: 'size' }, 413, cors);
      body = JSON.parse(text);
    } catch (e) {
      return json({ error: 'json' }, 400, cors);
    }
    const q = typeof body.q === 'string' ? body.q.trim().slice(0, 70000) : '';
    if (!q) return json({ error: 'empty' }, 400, cors);

    // الحد اليومي لكل زائر
    const free = Math.max(1, parseInt(env.FREE_PER_DAY || '3', 10) || 3);
    let kvKey = null, used = 0;
    if (env.HZ_KV) {
      kvKey = 'u:' + (await visitorKey(request, env)) + ':' + ammanDay();
      used = parseInt((await env.HZ_KV.get(kvKey)) || '0', 10) || 0;
      if (used >= free) return json({ error: 'limit' }, 429, cors);
    }

    // بناء الرسائل: تاريخ قصير ثم السؤال الحالي، بأدوار متناوبة تبدأ بالمستخدم
    const msgs = [];
    const hist = Array.isArray(body.h) ? body.h.slice(-6) : [];
    for (const x of hist) {
      const role = x && x.r === 'a' ? 'assistant' : x && x.r === 'u' ? 'user' : null;
      const t = x && typeof x.t === 'string' ? x.t.trim().slice(0, 4000) : '';
      if (!role || !t) continue;
      if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + t;
      else msgs.push({ role, content: t });
    }
    while (msgs.length && msgs[0].role === 'assistant') msgs.shift();
    let userText = q;
    if (msgs.length && msgs[msgs.length - 1].role === 'user') userText = msgs.pop().content + '\n\n' + q;

    // المرفقات الثنائية: صور وPDF فقط، بحد أقصى أربعة وحجم إجمالي معقول
    const KIND = { 'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image', 'image/webp': 'image', 'application/pdf': 'document' };
    const blocks = [];
    let total = 0;
    for (const f of (Array.isArray(body.files) ? body.files.slice(0, 4) : [])) {
      if (!f || typeof f.d !== 'string' || typeof f.m !== 'string' || !KIND[f.m]) continue;
      if (f.d.length < 20 || !/^[A-Za-z0-9+/]+=*$/.test(f.d)) continue;
      total += f.d.length;
      if (total > 10e6) break;
      const name = typeof f.n === 'string' ? f.n.replace(/[\r\n]+/g, ' ').slice(0, 80) : 'ملف';
      blocks.push({ type: 'text', text: '[مرفق: ' + name + ']' });
      blocks.push({ type: KIND[f.m], source: { type: 'base64', media_type: f.m, data: f.d } });
    }
    const fo = blocks.length / 2;
    msgs.push({ role: 'user', content: blocks.length ? [...blocks, { type: 'text', text: userText }] : userText });

    const web = env.WEB_SEARCH === '1';
    const payload = {
      model: env.MODEL || 'claude-sonnet-5-5',
      max_tokens: 2500,
      system: SYSTEM + (web ? WEB_NOTE : ''),
      messages: msgs,
    };
    if (web) payload.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];

    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(55000),
      });
    } catch (e) {
      return json({ error: 'upstream' }, 504, cors);
    }
    if (!r.ok) return json({ error: r.status === 429 || r.status === 529 ? 'busy' : 'upstream' }, r.status === 429 || r.status === 529 ? 503 : 502, cors);

    const data = await r.json();
    const a = (data.content || [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!a) return json({ error: 'empty-answer' }, 502, cors);

    if (kvKey) await env.HZ_KV.put(kvKey, String(used + 1), { expirationTtl: 172800 });

    // إشعار صامت في الخلفية — لا يؤخّر الرد على الزائر
    ctx.waitUntil(notifyOwner(env, q, a, fo));

    return json({ a, v: 3, fo }, 200, cors);
  },
};

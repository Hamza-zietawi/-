/**
 * Hamza AI — Cloudflare Worker
 * Required bindings/secrets:
 *   KV namespace: RATE_LIMIT
 *   Secrets: ANTHROPIC_API_KEY, WEB3FORMS_KEY
 *   Vars: CLAUDE_MODEL (e.g. claude-haiku-5-5), ALLOWED_ORIGIN (your exact https origin)
 */
const cors = origin => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
});
function json(data, status, headers={}) {
  return new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", ...headers}});
}
function clean(s, max=3000) { return String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").trim().slice(0,max); }
async function sha(s) {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export default {
 async fetch(request, env) {
   const origin = request.headers.get("Origin") || "";
   const allowed = env.ALLOWED_ORIGIN || "";
   const headers = cors(allowed);
   if (!allowed || origin !== allowed) return json({error:"Origin not allowed"},403);
   if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
   if (request.method !== "POST") return json({error:"Method not allowed"},405,headers);
   const url = new URL(request.url);
   let body;
   try { body = await request.json(); } catch { return json({error:"Invalid JSON"},400,headers); }

   if (url.pathname === "/api/ask") {
     const q = clean(body.q, 1800);
     if (q.length < 15) return json({error:"اكتب وصفًا أوضح، من فضلك."},400,headers);
     if (!env.ANTHROPIC_API_KEY || !env.RATE_LIMIT) return json({error:"الخدمة لم تُضبط بعد على الخادم."},503,headers);
     const ip = request.headers.get("CF-Connecting-IP") || "unknown";
     const day = new Date().toISOString().slice(0,10);
     const key = `ai:${day}:${await sha(ip)}`;
     const used = Number(await env.RATE_LIMIT.get(key) || "0");
     if (used >= 3) return json({error:"وصلت إلى ثلاث محاولات مجانية اليوم. أرسل طلب اشتراك حمزة AI من نموذج التواصل."},429,headers);
     const upstream = await fetch("https://api.anthropic.com/v1/messages",{
       method:"POST",
       headers:{"content-type":"application/json","x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
       body:JSON.stringify({
         model: env.CLAUDE_MODEL || "claude-haiku-5-5",
         max_tokens:900,
         system:"أنت Hamza AI، مساعد عربي عملي موجّه بمنهج حمزة الزيتاوي في التسويق الرقمي وتحسين محركات البحث وصناعة المحتوى والويب والبرمجة. أجب باللغة العربية الواضحة، مباشرة وبخطوات قابلة للتنفيذ. افهم طلب المستخدم بحرية ضمن الاستخدام الآمن، واطلب توضيحًا فقط عند الضرورة. لا تدّعِ أنك نفّذت فحصًا أو رفعت ملفًا أو شغّلت كودًا ما لم يحدث ذلك فعلًا. لا تعد بنتائج SEO أو أرباح مضمونة. عند طلب كود، وضّح المتطلبات ومكان وضعه ومخاطر الأمان، ولا تكشف أسرارًا أو مفاتيح API. هذه خدمة إرشادية وليست بديلًا عن مراجعة بشرية للمشاريع الحساسة.",
         messages:[{role:"user",content:q}]
       })
     });
     if (upstream.status===429) return json({error:"الخدمة مشغولة حاليًا؛ حاول بعد قليل."},503,headers);
     if (!upstream.ok) return json({error:"تعذّر إكمال الطلب حاليًا."},502,headers);
     const result = await upstream.json();
     const answer = (result.content || []).filter(x=>x.type==="text").map(x=>x.text).join("\n").trim();
     if (!answer) return json({error:"لم تصل إجابة صالحة."},502,headers);
     // KV is a best-effort counter. For strict concurrent enforcement use a Durable Object.
     await env.RATE_LIMIT.put(key,String(used+1),{expirationTtl:60*60*48});
     return json({a:answer, remaining:Math.max(0,2-used)},200,headers);
   }

   if (url.pathname === "/api/contact") {
     if (!env.WEB3FORMS_KEY) return json({error:"نموذج التواصل غير مهيأ بعد."},503,headers);
     const name=clean(body.name,100), contact=clean(body.contact || body.email || body.replyto,180);
     const message=clean(body.message || body.order || body.details || "",5000);
     const subject=clean(body.subject || "طلب اشتراك حمزة AI",160);
     if (name.length<2 || contact.length<5 || message.length<10) return json({error:"تحقق من الاسم ووسيلة التواصل وتفاصيل الطلب."},400,headers);
     const form = new FormData();
     form.set("access_key",env.WEB3FORMS_KEY);
     form.set("subject",subject);
     form.set("from_name","موقع حمزة الزيتاوي");
     form.set("name",name);
     form.set("email",contact.includes("@")?contact:"");
     form.set("phone",contact.includes("@")?"":contact);
     form.set("message",message);
     form.set("botcheck","");
     const sent=await fetch("https://api.web3forms.com/submit",{method:"POST",body:form});
     const result=await sent.json().catch(()=>({}));
     if (!sent.ok || !result.success) return json({error:"تعذّر إرسال الرسالة. حاول لاحقًا."},502,headers);
     return json({ok:true},200,headers);
   }
   return json({error:"Not found"},404,headers);
 }
};

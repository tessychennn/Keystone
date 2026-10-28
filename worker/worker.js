/* Keystone 同步後端 · Cloudflare Worker + KV

   部署時需要：
     KV 綁定名稱  STORE
     機密變數     TOKEN   （自己取一串夠長的亂數）

   GET  /sync            → { "keystone:xxx": <毫秒時間戳>, ... }   只有索引，很小
   GET  /sync/<key>      → { v:<資料>, t:<時間戳> }
   PUT  /sync/<key>      → body { v, t }；只有 t 比雲端新才會寫入
   每個請求都要帶 Authorization: Bearer <TOKEN>

   時間戳放在 KV 的 metadata，列索引時一次就拿得到，
   不用為了比對新舊把每一週的資料都讀一遍。 */

var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type"
};

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS)
  });
}

export default {
  async fetch(req, env){
    if(req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if(req.headers.get("Authorization") !== "Bearer " + env.TOKEN){
      return json({ error: "unauthorized" }, 401);
    }

    var url = new URL(req.url);

    if(req.method === "GET" && url.pathname === "/sync"){
      var out = {};
      var cursor;
      do{
        var page = await env.STORE.list({ prefix: "keystone:", cursor: cursor });
        page.keys.forEach(function(k){
          out[k.name] = (k.metadata && k.metadata.t) || 0;
        });
        cursor = page.list_complete ? null : page.cursor;
      }while(cursor);
      return json(out);
    }

    if(url.pathname.indexOf("/sync/") === 0){
      var key = decodeURIComponent(url.pathname.slice(6));
      if(key.indexOf("keystone:") !== 0) return json({ error: "bad key" }, 400);

      if(req.method === "GET"){
        var got = await env.STORE.getWithMetadata(key);
        if(got.value === null) return json({ error: "not found" }, 404);
        return json({ v: JSON.parse(got.value), t: (got.metadata && got.metadata.t) || 0 });
      }

      if(req.method === "PUT"){
        var body;
        try{ body = await req.json(); }catch(e){ return json({ error: "bad json" }, 400); }
        if(typeof body.t !== "number") return json({ error: "bad t" }, 400);

        var cur = await env.STORE.getWithMetadata(key);
        if(cur.value !== null && cur.metadata && cur.metadata.t >= body.t){
          return json({ ok: true, skipped: true });
        }
        await env.STORE.put(key, JSON.stringify(body.v), { metadata: { t: body.t } });
        return json({ ok: true });
      }
    }

    return json({ error: "not found" }, 404);
  }
};

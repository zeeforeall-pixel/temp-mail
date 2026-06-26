// supabase/functions/generate-vip-inbox/index.ts
// Deploy: supabase functions deploy generate-vip-inbox

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADJ = ["swift","calm","dark","keen","pure","bold","cool","deep","fine","glad","灵","快","静","暗","明","烈","柔","刚","寒","暖"];
const NOUN = ["fox","owl","bear","wolf","deer","hawk","lynx","swan","crow","dove","龙","凤","虎","鹤","狐","鹰","狼","鹿","蛇","蝶"];
const SUFFIX = "abcdefghijklmnopqrstuvwxyz0123456789";

function genPrefix(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  let s = "";
  for (let i = 0; i < 4 + Math.floor(Math.random() * 2); i++)
    s += SUFFIX[Math.floor(Math.random() * SUFFIX.length)];
  return `${a}.${n}.${s}`;
}

function genPassword(len = 16): string {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digit = "0123456789";
  const special = "!@#$%&*";
  const all = alpha + upper + digit + special;
  const pw = [
    alpha[Math.floor(Math.random() * alpha.length)],
    upper[Math.floor(Math.random() * upper.length)],
    digit[Math.floor(Math.random() * digit.length)],
    special[Math.floor(Math.random() * special.length)],
  ];
  for (let i = 4; i < len; i++)
    pw.push(all[Math.floor(Math.random() * all.length)]);
  for (let i = pw.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }
  return pw.join("");
}

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { owner_token, desired_local, domain } = await req.json();

    if (!owner_token || !domain) {
      return new Response(JSON.stringify({ error: "owner_token and domain required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const password = genPassword();

    for (let attempt = 0; attempt < 5; attempt++) {
      const local = (attempt === 0 && desired_local
        ? desired_local
        : genPrefix()
      ).toLowerCase().replace(/[^a-z0-9._-]/g, "");

      const address = `${local}@${domain}`;

      const { data, error } = await supabase
        .from("temp_inboxes")
        .insert({
          address,
          domain,
          owner_token,
          password_plain: password,
          is_vip: true,
        })
        .select("address, expires_at, password_plain, is_vip")
        .single();

      if (!error) {
        return new Response(
          JSON.stringify({
            address: data.address,
            expires_at: data.expires_at,
            password: data.password_plain,
            is_vip: true,
          }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }
        );
      }

      if (!/duplicate|already exists|unique/i.test(error.message)) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Failed to create VIP inbox: all prefixes exhausted" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});

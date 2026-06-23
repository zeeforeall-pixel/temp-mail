import json
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).parent
server = subprocess.Popen(
    ["python3", "-m", "http.server", "4173", "--bind", "127.0.0.1"],
    cwd=root,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

try:
    time.sleep(0.5)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.route(
                "https://esm.sh/@supabase/supabase-js@2",
                lambda route: route.fulfill(
                    content_type="application/javascript",
                    body="""
                    export function createClient() {
                      return {
                        from(table) {
                          const chain = {
                            payload: null,
                            select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, in() { return this; }, delete() { return this; },
                            insert(payload) { this.payload = Array.isArray(payload) ? payload[0] : payload; return this; },
                            maybeSingle() { return Promise.resolve({ data: null, error: null }); },
                            single() { return Promise.resolve({ data: this.payload, error: null }); },
                            then(resolve) {
                              const data = table === 'temp_domains'
                                ? [{ domain: 'moyvip.com', label: 'moyvip.com' }]
                                : table === 'temp_messages'
                                  ? []
                                  : this.payload ? [this.payload] : [];
                              resolve({ data, error: null });
                            },
                          };
                          return chain;
                        },
                        channel() { return { on() { return this; }, subscribe() { return this; } }; },
                        removeChannel() {},
                      };
                    }
                    """,
                ),
            )

            def create_inbox(route):
                body = json.loads(route.request.post_data or "{}")
                local = "".join(ch for ch in (body.get("desired_local") or "bot").lower() if ch.isalnum() or ch in "._-" ).strip("._-") or "bot"
                domain = body.get("domain") or "moyvip.com"
                vip = domain in {"moyvip.com", "moyzel.foo"}
                route.fulfill(
                    content_type="application/json",
                    body=json.dumps({
                        "address": f"{local}@{domain}",
                        "expires_at": "2099-01-01T00:00:00Z",
                        **({"is_vip": True, "password": "Aa1!aaaaaaaaaaaa"} if vip else {}),
                    }),
                )

            page.route("**/api/create-inbox", create_inbox)
            page.goto("http://127.0.0.1:4173/", wait_until="networkidle")
            page.wait_for_function("() => window.TempMailAPI")
            result = page.evaluate(
                """async () => {
                    const api = window.TempMailAPI;
                    const email = await api.generateEmail('agentcheck', 'moyvip.com');
                    const vip = await api.generateVipEmail('agentvip');
                    return {
                      email,
                      vip,
                      messages: await api.getMessages(email.address),
                      latest: api.getLatestOTP(email.address),
                      inboxes: api.getAllInboxes(),
                      current: api.getCurrentEmail(),
                      domains: api.getDomains(),
                      credentials: api.getVipCredentials(vip.address),
                      helpKeys: Object.keys(api.help().functions),
                    };
                  }"""
            )
            assert result["email"]["address"] == "agentcheck@moyvip.com"
            assert result["vip"]["is_vip"] is True
            assert result["credentials"]["password"] == "Aa1!aaaaaaaaaaaa"
            assert result["messages"] == []
            assert result["latest"] is None
            for fn in ["generateEmail", "getMessages", "waitForOTP", "waitForEmail", "quickSession", "getLatestOTP", "getAllInboxes", "getCurrentEmail", "getDomains", "copyEmail", "deleteInbox"]:
                assert any(key.startswith(fn + "(") for key in result["helpKeys"]), f"{fn} missing from help"

            for action in ["generate", "domains", "messages", "otp", "inboxes", "email", "delete"]:
                url = f"http://127.0.0.1:4173/?api={action}"
                if action in {"messages", "otp", "delete"}:
                    url += "&address=agentcheck@moyvip.com"
                page.goto(url, wait_until="networkidle")
                payload = json.loads(page.locator("pre").inner_text())
                assert payload is None or "error" not in payload or action in {"otp", "delete"}, f"{action} returned {payload}"

            print("Agent API browser smoke passed")
        finally:
            browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)

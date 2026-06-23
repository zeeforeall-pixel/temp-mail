import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).parent
server = subprocess.Popen(
    ["python3", "-m", "http.server", "4174", "--bind", "127.0.0.1"],
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
            page.goto("http://127.0.0.1:4174/index.html")
            result = page.evaluate("""async () => {
                const { extractOTP, extractVerification } = await import('/js/otp.js?v=1782180800');
                const html = `
                  <html><body>
                    <a href="https://u20216706.ct.sendgrid.net/ls/click?upn=abc">https://u20216706.ct.sendgrid.net/ls/click?upn=abc</a>
                    <p>Your ChatGPT verification code is <b>406733</b></p>
                    <a href="https://chatgpt.com/verify?token=abcdefghijklmnopqrstuvwxyz">Verify account</a>
                  </body></html>`;
                return { otp: extractOTP(html), verification: extractVerification(html) };
            }""")
            assert result["otp"] == "406733", result
            assert result["verification"]["otp"] == "406733", result
            assert result["verification"]["link"].startswith("https://chatgpt.com/verify"), result
            print("OTP browser check passed")
        finally:
            browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)

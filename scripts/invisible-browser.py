import sys
import time
from invisible_playwright import InvisiblePlaywright


def launch_invisible(url=None, proxy=None, seed=None, pin=None):
    kwargs = {}
    if proxy:
        kwargs["proxy"] = proxy
    if seed is not None:
        kwargs["seed"] = seed
    if pin:
        kwargs["pin"] = pin

    ip = InvisiblePlaywright(**kwargs)
    browser = ip.__enter__()
    page = browser.new_page()

    if url:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)

    return ip, browser, page


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://bot.sannysoft.com/"
    print(f"Launching invisible Firefox → {url}")

    ip, browser, page = launch_invisible(url=url)

    title = page.title()
    print(f"Page title: {title}")
    print("Browser is open. Press Ctrl+C to close.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        browser.close()
        ip.__exit__(None, None, None)

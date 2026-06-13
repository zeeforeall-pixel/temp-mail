import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.DOMParser = dom.window.DOMParser;

const otpPath = join(__dirname, "..", "js", "otp.js");
let otpCode = readFileSync(otpPath, "utf-8");
otpCode = otpCode.replace(/^export /gm, "");

const moduleScope = {};
const wrappedCode = otpCode + "\nmoduleScope.extractOTP = extractOTP;\nmoduleScope.extractVerifyLink = extractVerifyLink;\nmoduleScope.extractVerification = extractVerification;\n";
eval(wrappedCode);

const { extractOTP, extractVerifyLink, extractVerification } = moduleScope;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  \u2713 " + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log("  \u2717 " + name);
    console.log("    -> " + e.message);
  }
}

function eq(actual, expected, msg) {
  msg = msg || "";
  if (actual !== expected) throw new Error(msg + " Expected: " + JSON.stringify(expected) + ", Got: " + JSON.stringify(actual));
}
function notNull(val, msg) {
  if (val === null || val === undefined) throw new Error((msg || "") + " Expected non-null, got null");
}
function isNull(val, msg) {
  if (val !== null && val !== undefined) throw new Error((msg || "") + " Expected null, got: " + JSON.stringify(val));
}
function contains(val, substr, msg) {
  if (!val || !val.includes(substr)) throw new Error((msg || "") + " Expected to contain: " + substr);
}

console.log("\n=== OTP EXTRACTION - Basic ===\n");

test("6-digit OTP from plain text", () => {
  eq(extractOTP("Your verification code is 847291"), "847291");
});
test("4-digit alphanumeric code", () => {
  eq(extractOTP("Use code A5G2 to sign in"), "A5G2");
});
test("Hyphenated code from bold", () => {
  eq(extractOTP("Your OTP: <b>384-291</b>"), "384-291");
});
test("Code in heading", () => {
  eq(extractOTP("<h2>Your code is 9F8R4</h2>"), "9F8R4");
});
test("Chinese verification", () => {
  eq(extractOTP("\u9a8c\u8bc1\u7801: 847291"), "847291");
});
test("Split digits", () => {
  eq(extractOTP("<span>3</span><span>8</span><span>4</span><span>2</span>"), "3842");
});
test("Spaced digits near keyword", () => {
  eq(extractOTP("Your code is 8 4 7 2 9 1"), "847291");
});

console.log("\n=== OTP - False Positive Rejection ===\n");

test("No OTP in order confirmation", () => {
  isNull(extractOTP("Order #12345 confirmed, total .00"));
});
test("No OTP in copyright notice", () => {
  isNull(extractOTP("Copyright 2024 Corp. Ref: 98765"));
});
test("Reject all-same-digit pin", () => {
  isNull(extractOTP("Pin: 1111"));
});
test("Reject year 2024", () => {
  isNull(extractOTP("Year 2024 report attached"));
});
test("Reject base64 string", () => {
  isNull(extractOTP("Your code is aGVsbG8gd29ybG=="));
});
test("Reject sequential ascending", () => {
  isNull(extractOTP("Code: 1234"));
});
test("Reject sequential descending", () => {
  isNull(extractOTP("Sequence: 9876"));
});

console.log("\n=== CSS DIMENSION / UNIT FALSE POSITIVES ===\n");

test("400px rejected", () => {
  isNull(extractOTP("<table style=\"width:400px\"><tr><td>Hello</td></tr></table>"));
});
test("600px rejected", () => {
  isNull(extractOTP("<div style=\"width: 600px;\">Content</div>"));
});
test("300em rejected", () => {
  isNull(extractOTP("Size: 300em"));
});
test("2rem rejected", () => {
  isNull(extractOTP("Font: 2rem"));
});
test("100vh rejected", () => {
  isNull(extractOTP("Height: 100vh"));
});
test("500ms rejected", () => {
  isNull(extractOTP("Duration: 500ms"));
});
test("300dpi rejected", () => {
  isNull(extractOTP("Resolution: 300dpi"));
});
test("1080p rejected", () => {
  isNull(extractOTP("Video: 1080p"));
});
test("720p rejected", () => {
  isNull(extractOTP("Quality: 720p"));
});
test("4k rejected", () => {
  isNull(extractOTP("Display: 4k"));
});

console.log("\n=== OTP - Complex Real-World Emails ===\n");

test("Full email template with CSS and OTP", () => {
  const html = "<!DOCTYPE html><html><body><div style=\"width: 600px; margin: 0 auto; padding: 20px;\"><h2>Your verification code</h2><p style=\"font-size: 32px; font-weight: bold;\">847291</p><p>This code expires in 10 minutes.</p><table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"border: 1px solid #ccc;\"><tr><td style=\"padding: 10px;\">Footer text</td></tr></table></div></body></html>";
  eq(extractOTP(html), "847291");
});

test("Email with phone number and OTP", () => {
  const html = "<p>Call us at +1-800-555-0199. Your verification code is 847291.</p>";
  eq(extractOTP(html), "847291");
});

test("Email with price and OTP", () => {
  const html = "<p>Order total: .99. Your code: 583920.</p>";
  eq(extractOTP(html), "583920");
});

test("Email with date and OTP", () => {
  const html = "<p>Sent on January 15, 2024. Your code is 847291.</p>";
  eq(extractOTP(html), "847291");
});

test("Email with only CSS dimensions, no OTP", () => {
  const html = "<div style=\"width:400px;height:200px;background:#fff;\"><table width=\"400\"><tr><td>Welcome to our service!</td></tr></table><img src=\"logo.png\" width=\"300\" height=\"100\"></div>";
  isNull(extractOTP(html));
});

test("OTP in table cell surrounded by layout", () => {
  const html = "<table width=\"600\" cellpadding=\"0\" cellspacing=\"0\"><tr><td width=\"200\">&nbsp;</td><td width=\"200\"><strong>847291</strong></td><td width=\"200\">&nbsp;</td></tr></table>";
  eq(extractOTP(html), "847291");
});

test("Multiple codes - pick the prominent one", () => {
  const html = "<p>Ref: 12345</p><h2>Your code: <b>847291</b></h2>";
  eq(extractOTP(html), "847291");
});

console.log("\n=== VERIFY LINK - Basic ===\n");

test("Basic verify URL", () => {
  const html = "<a href=\"https://app.com/verify?token=abc123\">Verify your email</a>";
  const link = extractVerifyLink(html);
  notNull(link);
  contains(link, "verify");
});

test("Confirm URL", () => {
  notNull(extractVerifyLink("<a href=\"https://example.com/confirm?id=xyz789\">Confirm account</a>"));
});

test("Activation URL", () => {
  notNull(extractVerifyLink("<a href=\"https://site.com/activate?hash=abc\">Activate</a>"));
});

test("Signup verification URL", () => {
  notNull(extractVerifyLink("<a href=\"https://app.com/signup/verify?token=abc123\">Complete signup</a>"));
});

console.log("\n=== VERIFY LINK - False Positive Rejection ===\n");

test("Reject unsubscribe", () => {
  isNull(extractVerifyLink("<a href=\"https://example.com/unsubscribe?token=abc\">Unsubscribe</a>"));
});

test("Reject tracking/analytics", () => {
  isNull(extractVerifyLink("<a href=\"https://analytics.google.com/tracking?token=abc\">Click</a>"));
});

test("Reject static asset", () => {
  isNull(extractVerifyLink("<a href=\"https://cdn.com/image.png\">Logo</a>"));
});

test("Reject mailto", () => {
  isNull(extractVerifyLink("<a href=\"mailto:support@example.com\">Contact</a>"));
});

test("Reject anchor-only", () => {
  isNull(extractVerifyLink("<a href=\"#section\">Jump</a>"));
});

test("Reject privacy link", () => {
  isNull(extractVerifyLink("<a href=\"https://example.com/privacy\">Privacy Policy</a>"));
});

test("Reject terms link", () => {
  isNull(extractVerifyLink("<a href=\"https://example.com/terms\">Terms of Service</a>"));
});

test("Reject FAQ link", () => {
  isNull(extractVerifyLink("<a href=\"https://example.com/faq\">FAQ</a>"));
});

test("Reject contact link", () => {
  isNull(extractVerifyLink("<a href=\"https://example.com/contact\">Contact Us</a>"));
});

test("Reject relative URL", () => {
  isNull(extractVerifyLink("<a href=\"/verify?token=abc\">Verify</a>"));
});

test("Reject javascript protocol", () => {
  isNull(extractVerifyLink("<a href=\"javascript:void(0)\">Click</a>"));
});

test("Reject pixel tracking", () => {
  isNull(extractVerifyLink("<a href=\"https://facebook.com/tr?id=12345\">Pixel</a>"));
});

test("Reject doubleclick", () => {
  isNull(extractVerifyLink("<a href=\"https://doubleclick.net/track?token=abc\">Ad</a>"));
});

test("Reject mailchimp", () => {
  isNull(extractVerifyLink("<a href=\"https://mailchimp.com/unsubscribe?token=abc\">Unsub</a>"));
});

test("Reject sendgrid tracking", () => {
  isNull(extractVerifyLink("<a href=\"https://sendgrid.com/wf/open?token=abc\">Open</a>"));
});

console.log("\n=== VERIFY LINK - Priority and Ranking ===\n");

test("Pick verification link among multiple links", () => {
  const html = "<a href=\"https://example.com/home\">Home</a><a href=\"https://example.com/verify?token=abc123\">Verify Email</a><a href=\"https://example.com/unsubscribe\">Unsubscribe</a>";
  const link = extractVerifyLink(html);
  notNull(link);
  contains(link, "verify");
});

test("Boost for button-styled link", () => {
  notNull(extractVerifyLink("<a href=\"https://app.com/confirm?token=xyz\" class=\"btn btn-primary\">Confirm Your Account</a>"));
});

test("Boost for inline-block styled link", () => {
  notNull(extractVerifyLink("<a href=\"https://app.com/activate?hash=abc\" style=\"display: inline-block; padding: 10px;\">Activate Now</a>"));
});

test("Long token parameter boosts score", () => {
  notNull(extractVerifyLink("<a href=\"https://app.com/verify?token=a1b2c3d4e5f6g7h8i9j0k1l2m3\">Verify</a>"));
});

test("Prefer verify path over generic", () => {
  const html = "<a href=\"https://app.com/page?token=abc\">Some page</a><a href=\"https://app.com/verify?token=def\">Verify</a>";
  const link = extractVerifyLink(html);
  notNull(link);
  contains(link, "verify");
});

console.log("\n=== VERIFY LINK - Multilingual ===\n");

test("Spanish verification", () => {
  notNull(extractVerifyLink("<a href=\"https://app.com/verificar?token=abc\">Verificar correo</a>"));
});

test("French verification", () => {
  notNull(extractVerifyLink("<a href=\"https://app.com/confirmer?token=abc\">Confirmer votre email</a>"));
});

console.log("\n=== COMBINED EXTRACTION ===\n");

test("Extract both OTP and link", () => {
  const html = "<p>Your verification code is 847291</p><a href=\"https://app.com/verify?token=abc123\">Verify</a>";
  const result = extractVerification(html);
  eq(result.otp, "847291");
  notNull(result.link);
});

test("Only OTP, no link", () => {
  const result = extractVerification("<p>Your code is 847291</p>");
  eq(result.otp, "847291");
  isNull(result.link);
});

test("Only link, no OTP", () => {
  const result = extractVerification("<a href=\"https://app.com/verify?token=abc\">Verify</a>");
  isNull(result.otp);
  notNull(result.link);
});

test("Neither OTP nor link", () => {
  const result = extractVerification("<p>Hello, welcome to our service!</p>");
  isNull(result.otp);
  isNull(result.link);
});

test("Empty input", () => {
  const result = extractVerification("");
  isNull(result.otp);
  isNull(result.link);
});

test("Null input", () => {
  const result = extractVerification(null);
  isNull(result.otp);
  isNull(result.link);
});

console.log("\n=== COMBINED - Real-World Emails ===\n");

test("Full email template", () => {
  const html = "<!DOCTYPE html><html><head><style>body{width:600px}</style></head><body><table width=\"600\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"padding:20px\"><h2>Your verification code</h2><p style=\"font-size:32px;font-weight:bold\">847291</p><a href=\"https://app.com/verify?token=xyz789\" style=\"display:block;padding:10px;background:blue\">Or click here to verify</a></td></tr></table></body></html>";
  const result = extractVerification(html);
  eq(result.otp, "847291");
  notNull(result.link);
  contains(result.link, "verify");
});

test("Marketing email - no OTP, no verify link", () => {
  const html = "<div style=\"width:600px\"><h1>Summer Sale</h1><p>Shop now and save big. Offer valid until August 31, 2024.</p><a href=\"https://shop.com/sale\">Shop Now</a><a href=\"https://shop.com/unsubscribe\">Unsubscribe</a></div>";
  const result = extractVerification(html);
  isNull(result.otp);
  isNull(result.link);
});

test("Receipt email - no OTP", () => {
  const html = "<div style=\"width:400px\"><h2>Order Confirmation</h2><p>Order #12345 - Total: .00</p><p>Tracking: 1Z999AA10123456784</p><a href=\"https://shop.com/tracking?id=12345\">Track Order</a></div>";
  const result = extractVerification(html);
  isNull(result.otp);
});

test("Welcome email with verify link, no OTP", () => {
  const html = "<div style=\"width:500px\"><h1>Welcome to App!</h1><p>Click the button below to verify your email address.</p><a href=\"https://app.com/verify-email?token=eyJhbGciOiJIUzI1NiJ9\" class=\"btn\" style=\"display:inline-block\">Verify Email</a><p>If you did not sign up, ignore this email.</p><a href=\"https://app.com/unsubscribe\">Unsubscribe</a></div>";
  const result = extractVerification(html);
  isNull(result.otp);
  notNull(result.link);
  contains(result.link, "verify");
});

test("2FA email with only OTP", () => {
  const html = "<div style=\"width:400px\"><p>Hi there,</p><p>Your one-time password is:</p><h2><b>384291</b></h2><p>This code expires in 10 minutes. Do not share it.</p><p style=\"color:#999\">2024 App Inc. All rights reserved.</p></div>";
  const result = extractVerification(html);
  eq(result.otp, "384291");
  isNull(result.link);
});

console.log("\n=== EDGE CASES ===\n");

test("OTP code that looks like CSS but is not (P5X3)", () => {
  eq(extractOTP("Your code is P5X3"), "P5X3");
});

test("Code with letters reversed (xp400)", () => {
  eq(extractOTP("Your code is xp400"), "XP400");
});

test("Alphanumeric code starting with numbers", () => {
  eq(extractOTP("Code: 9F8R4"), "9F8R4");
});

test("OTP with leading zeros preserved", () => {
  eq(extractOTP("Your code is 007291"), "007291");
});

test("Very long text with OTP buried in middle", () => {
  const longText = "Lorem ipsum ".repeat(50) + " Your verification code is 847291. " + " dolor sit amet ".repeat(50);
  eq(extractOTP(longText), "847291");
});

test("OTP in subject line context", () => {
  eq(extractOTP("Subject: Your verification code is 847291\n\nBody text here."), "847291");
});

test("No false positive from tracking number", () => {
  isNull(extractOTP("Your tracking number is 1Z999AA10123456784"));
});

test("No false positive from IP address", () => {
  isNull(extractOTP("Your IP: 192.168.1.1"));
});

test("No false positive from percentage", () => {
  isNull(extractOTP("You scored 85% on the test"));
});

test("No false positive from currency", () => {
  isNull(extractOTP("Total: .00 USD"));
});

test("Verify link in complex HTML email with tables", () => {
  const html = "<table width=\"600\"><tr><td><table width=\"400\" style=\"width:400px\"><tr><td><p>Your code is 123456</p></td></tr><tr><td><a href=\"https://app.com/confirm?token=longtoken123\" style=\"display:block;background:#0078d4;color:#fff;padding:12px;text-align:center\">Confirm Your Email</a></td></tr></table></td></tr></table>";
  const result = extractVerification(html);
  eq(result.otp, "123456");
  notNull(result.link);
  contains(result.link, "confirm");
});

console.log("\n===============================================");
console.log("Results: " + passed + " passed, " + failed + " failed out of " + (passed + failed) + " tests");
if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log("  X " + f.name + ": " + f.error));
}
console.log("===============================================\n");

process.exit(failed > 0 ? 1 : 0);
